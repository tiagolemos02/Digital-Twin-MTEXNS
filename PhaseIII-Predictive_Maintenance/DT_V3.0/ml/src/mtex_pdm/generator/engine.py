"""Deterministic, output-agnostic state engine for synthetic machines."""

from __future__ import annotations

import hashlib
import random
from collections.abc import Callable
from dataclasses import dataclass
from datetime import timedelta

from mtex_pdm.contracts import canonical_sha256
from mtex_pdm.generator.models import (
    GenerationConfig,
    GenerationSummary,
    GeneratorCheckpoint,
    GroundTruthSnapshot,
    MachineCheckpoint,
    MachineSimulationSpec,
    MachineState,
    StepContext,
    StepOutcome,
    TelemetryEmission,
    TelemetrySnapshot,
)
from mtex_pdm.generator.output import GeneratorOutput

StateTransition = Callable[
    [MachineState, StepContext, random.Random],
    MachineState | StepOutcome,
]


def _transition_sha256(transition: StateTransition) -> str:
    explicit = getattr(transition, "fingerprint", None)
    if isinstance(explicit, str):
        return explicit
    module = getattr(transition, "__module__", transition.__class__.__module__)
    name = getattr(transition, "__qualname__", transition.__class__.__qualname__)
    return canonical_sha256({"callable": f"{module}:{name}"})


def derive_machine_seed(master_seed: int, machine_id: str, scenario_id: str) -> int:
    """Derive one stable 64-bit RNG seed without Python's process-randomized hash."""

    payload = f"{master_seed}\0{machine_id}\0{scenario_id}".encode()
    return int.from_bytes(hashlib.sha256(payload).digest()[:8], byteorder="big")


def passthrough_transition(
    state: MachineState,
    context: StepContext,
    rng: random.Random,
) -> MachineState:
    """Keep the basic state unchanged until physical behavior is implemented."""

    del context, rng
    return state


@dataclass(slots=True)
class _MachineRuntime:
    spec: MachineSimulationSpec
    state: MachineState
    machine_seed: int
    rng: random.Random
    step_index: int = 0


class GeneratorEngine:
    """Advance all configured machines over a bounded half-open UTC interval."""

    def __init__(
        self,
        config: GenerationConfig,
        transition: StateTransition = passthrough_transition,
    ) -> None:
        self.config = config
        self._transition = transition
        self._transition_sha256 = _transition_sha256(transition)
        self._next_time_index = config.start_at
        self._runtimes = tuple(self._initialize_runtime(machine) for machine in config.machines)

    def _initialize_runtime(self, machine: MachineSimulationSpec) -> _MachineRuntime:
        seed = derive_machine_seed(
            self.config.master_seed,
            machine.machine_id,
            machine.scenario_id,
        )
        return _MachineRuntime(
            spec=machine,
            state=machine.initial_state,
            machine_seed=seed,
            rng=random.Random(seed),
        )

    @classmethod
    def from_checkpoint(
        cls,
        config: GenerationConfig,
        checkpoint: GeneratorCheckpoint,
        transition: StateTransition = passthrough_transition,
    ) -> GeneratorEngine:
        """Restore a run only when the complete deterministic config still matches."""

        expected_hash = canonical_sha256(config)
        if checkpoint.config_sha256 != expected_hash:
            raise ValueError("checkpoint does not match the generation config")
        configured_ids = tuple(machine.machine_id for machine in config.machines)
        checkpoint_ids = tuple(machine.machine_id for machine in checkpoint.machines)
        if checkpoint_ids != configured_ids:
            raise ValueError("checkpoint machine order does not match generation config")
        if not config.start_at <= checkpoint.next_time_index <= config.end_at:
            raise ValueError("checkpoint next_time_index is outside the generation interval")

        engine = cls(config, transition=transition)
        if checkpoint.transition_sha256 != engine._transition_sha256:
            raise ValueError("checkpoint transition does not match the current transition")
        engine._next_time_index = checkpoint.next_time_index
        restored_runtimes: list[_MachineRuntime] = []
        for runtime, saved in zip(engine._runtimes, checkpoint.machines, strict=True):
            if runtime.machine_seed != saved.machine_seed:
                raise ValueError("checkpoint machine seed does not match generation config")
            runtime.state = saved.state
            runtime.step_index = saved.step_index
            runtime.rng.setstate(
                (
                    saved.rng_version,
                    tuple(saved.rng_internal_state),
                    saved.rng_gauss_next,
                )
            )
            restored_runtimes.append(runtime)
        engine._runtimes = tuple(restored_runtimes)
        return engine

    def checkpoint(self) -> GeneratorCheckpoint:
        """Capture state and RNG streams so a run can resume exactly."""

        machines: list[MachineCheckpoint] = []
        for runtime in self._runtimes:
            rng_version, rng_internal_state, rng_gauss_next = runtime.rng.getstate()
            machines.append(
                MachineCheckpoint(
                    machine_id=runtime.spec.machine_id,
                    machine_seed=runtime.machine_seed,
                    step_index=runtime.step_index,
                    state=runtime.state,
                    rng_version=rng_version,
                    rng_internal_state=tuple(rng_internal_state),
                    rng_gauss_next=rng_gauss_next,
                )
            )
        return GeneratorCheckpoint(
            config_sha256=canonical_sha256(self.config),
            transition_sha256=self._transition_sha256,
            next_time_index=self._next_time_index,
            machines=tuple(machines),
        )

    def run(
        self,
        output: GeneratorOutput,
        *,
        max_ticks: int | None = None,
    ) -> GenerationSummary:
        """Emit each machine step incrementally until the configured exclusive end."""

        if max_ticks is not None and max_ticks <= 0:
            raise ValueError("max_ticks must be positive when provided")

        tick_count = 0
        telemetry_count = 0
        ground_truth_count = 0
        event_count = 0
        step_delta = timedelta(seconds=self.config.step_seconds)

        while self._next_time_index < self.config.end_at and (
            max_ticks is None or tick_count < max_ticks
        ):
            time_index = self._next_time_index
            for runtime in self._runtimes:
                context = StepContext(
                    machine_id=runtime.spec.machine_id,
                    scenario_id=runtime.spec.scenario_id,
                    time_index=time_index,
                    step_index=runtime.step_index,
                    step_seconds=self.config.step_seconds,
                    machine_seed=runtime.machine_seed,
                    data_source=runtime.spec.data_source,
                    split=runtime.spec.split,
                )
                transition_result = self._transition(runtime.state, context, runtime.rng)
                if isinstance(transition_result, MachineState):
                    outcome = StepOutcome(
                        next_state=transition_result,
                        telemetry=(
                            TelemetryEmission(
                                time_index=time_index,
                                observable=transition_result.observable,
                            ),
                        ),
                    )
                elif isinstance(transition_result, StepOutcome):
                    outcome = transition_result
                else:
                    raise TypeError("state transition must return MachineState or StepOutcome")
                next_state = outcome.next_state
                runtime.state = next_state
                for emission in outcome.telemetry:
                    output.emit_telemetry(
                        TelemetrySnapshot(
                            machine_id=runtime.spec.machine_id,
                            time_index=emission.time_index,
                            data_source=runtime.spec.data_source,
                            split=runtime.spec.split,
                            observable=emission.observable,
                        )
                    )
                    telemetry_count += 1
                output.emit_ground_truth(
                    GroundTruthSnapshot(
                        machine_id=runtime.spec.machine_id,
                        time_index=time_index,
                        scenario_id=runtime.spec.scenario_id,
                        machine_seed=runtime.machine_seed,
                        hidden=next_state.hidden,
                    )
                )
                ground_truth_count += 1
                for event in outcome.events:
                    output.emit_event(event)
                    event_count += 1
                runtime.step_index += 1
            tick_count += 1
            self._next_time_index += step_delta

        return GenerationSummary(
            tick_count=tick_count,
            machine_count=len(self._runtimes),
            telemetry_snapshot_count=telemetry_count,
            ground_truth_snapshot_count=ground_truth_count,
            ground_truth_event_count=event_count,
            next_time_index=(
                None if self._next_time_index >= self.config.end_at else self._next_time_index
            ),
        )


__all__ = [
    "GeneratorCheckpoint",
    "GeneratorEngine",
    "StateTransition",
    "derive_machine_seed",
    "passthrough_transition",
]
