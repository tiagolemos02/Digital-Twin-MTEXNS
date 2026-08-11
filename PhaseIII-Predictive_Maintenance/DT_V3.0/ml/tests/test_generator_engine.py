from __future__ import annotations

import random
from datetime import UTC, datetime

import pytest
from pydantic import ValidationError

from mtex_pdm.contracts import ComponentKey, DatasetSplit, DataSource
from mtex_pdm.generator import (
    ComponentHiddenState,
    GenerationConfig,
    GenerationMode,
    GeneratorCheckpoint,
    GeneratorEngine,
    HiddenMachineState,
    InMemoryOutput,
    MachineSimulationSpec,
    MachineState,
    NumericSignal,
    ObservableMachineState,
    StepContext,
)


def _machine(
    machine_id: str = "synthetic-train-01",
    *,
    scenario_id: str = "normal_operation",
) -> MachineSimulationSpec:
    return MachineSimulationSpec(
        machine_id=machine_id,
        scenario_id=scenario_id,
        data_source=DataSource.SYNTHETIC_HISTORICAL,
        split=DatasetSplit.TRAIN,
        initial_state=MachineState(
            observable=ObservableMachineState(
                numeric_signals=(NumericSignal(name="machine_status", value=1.0),)
            ),
            hidden=HiddenMachineState(
                components=(
                    ComponentHiddenState(
                        component_key=ComponentKey.TRANSPORT_VACUUM_FILTER,
                        degradation=0.0,
                    ),
                )
            ),
        ),
    )


def _config(*machines: MachineSimulationSpec, master_seed: int = 20260729) -> GenerationConfig:
    return GenerationConfig(
        mode=GenerationMode.OFFLINE,
        start_at=datetime(2026, 1, 1, tzinfo=UTC),
        end_at=datetime(2026, 1, 1, 0, 15, tzinfo=UTC),
        step_seconds=300,
        master_seed=master_seed,
        machines=machines or (_machine(),),
    )


def test_engine_emits_half_open_utc_steps_and_separates_hidden_state() -> None:
    output = InMemoryOutput()

    summary = GeneratorEngine(_config()).run(output)

    assert [snapshot.time_index for snapshot in output.telemetry] == [
        datetime(2026, 1, 1, 0, 0, tzinfo=UTC),
        datetime(2026, 1, 1, 0, 5, tzinfo=UTC),
        datetime(2026, 1, 1, 0, 10, tzinfo=UTC),
    ]
    assert output.telemetry[0].observable.value("machine_status") == 1.0
    assert not hasattr(output.telemetry[0], "hidden")
    assert output.ground_truth[0].hidden.components[0].degradation == 0.0
    assert not hasattr(output.ground_truth[0], "observable")
    assert summary.tick_count == 3
    assert summary.telemetry_snapshot_count == 3
    assert summary.ground_truth_snapshot_count == 3


def _random_temperature_transition(
    state: MachineState,
    context: StepContext,
    rng: random.Random,
) -> MachineState:
    del context
    return state.model_copy(
        update={
            "observable": state.observable.with_value(
                "ambient_temperature",
                rng.random(),
            )
        }
    )


def _temperature_trace(output: InMemoryOutput, machine_id: str) -> list[float | None]:
    return [
        snapshot.observable.value("ambient_temperature")
        for snapshot in output.telemetry
        if snapshot.machine_id == machine_id
    ]


def test_seeded_transitions_repeat_and_each_machine_owns_its_rng_stream() -> None:
    first = InMemoryOutput()
    repeated = InMemoryOutput()
    different_seed = InMemoryOutput()
    with_extra_machine = InMemoryOutput()

    GeneratorEngine(_config(), transition=_random_temperature_transition).run(first)
    GeneratorEngine(_config(), transition=_random_temperature_transition).run(repeated)
    GeneratorEngine(
        _config(master_seed=20260730),
        transition=_random_temperature_transition,
    ).run(different_seed)
    GeneratorEngine(
        _config(_machine(), _machine("synthetic-train-02")),
        transition=_random_temperature_transition,
    ).run(with_extra_machine)

    baseline = _temperature_trace(first, "synthetic-train-01")
    assert baseline == _temperature_trace(repeated, "synthetic-train-01")
    assert baseline != _temperature_trace(different_seed, "synthetic-train-01")
    assert baseline == _temperature_trace(with_extra_machine, "synthetic-train-01")


def test_serialized_checkpoint_resumes_without_changing_future_steps() -> None:
    config = _config()
    uninterrupted = InMemoryOutput()
    resumed = InMemoryOutput()

    GeneratorEngine(config, transition=_random_temperature_transition).run(uninterrupted)

    first_engine = GeneratorEngine(config, transition=_random_temperature_transition)
    partial_summary = first_engine.run(resumed, max_ticks=1)
    serialized = first_engine.checkpoint().model_dump_json()
    checkpoint = GeneratorCheckpoint.model_validate_json(serialized)
    second_engine = GeneratorEngine.from_checkpoint(
        config,
        checkpoint,
        transition=_random_temperature_transition,
    )
    resumed_summary = second_engine.run(resumed)

    assert partial_summary.tick_count == 1
    assert partial_summary.next_time_index == datetime(2026, 1, 1, 0, 5, tzinfo=UTC)
    assert resumed_summary.tick_count == 2
    assert resumed.telemetry == uninterrupted.telemetry
    assert resumed.ground_truth == uninterrupted.ground_truth


def test_generation_config_rejects_duplicate_machines_and_naive_time() -> None:
    with pytest.raises(ValidationError, match="duplicate machine IDs"):
        _config(_machine(), _machine())

    with pytest.raises(ValidationError):
        GenerationConfig(
            mode=GenerationMode.OFFLINE,
            start_at=datetime(2026, 1, 1),
            end_at=datetime(2026, 1, 1, 0, 15, tzinfo=UTC),
            step_seconds=300,
            master_seed=20260729,
            machines=(_machine(),),
        )


def test_checkpoint_fails_closed_when_deterministic_config_changes() -> None:
    original = _config()
    engine = GeneratorEngine(original, transition=_random_temperature_transition)
    engine.run(InMemoryOutput(), max_ticks=1)
    checkpoint = engine.checkpoint()

    with pytest.raises(ValueError, match="does not match the generation config"):
        GeneratorEngine.from_checkpoint(
            _config(master_seed=original.master_seed + 1),
            checkpoint,
            transition=_random_temperature_transition,
        )


def test_observable_state_rejects_unknown_or_non_finite_signals() -> None:
    with pytest.raises(ValidationError, match="unknown canonical numeric signal"):
        NumericSignal(name="hidden_degradation", value=0.2)

    with pytest.raises(ValidationError):
        NumericSignal(name="ambient_temperature", value=float("nan"))
