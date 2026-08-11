"""Typed runtime models for the synthetic generator core."""

from __future__ import annotations

import math
from datetime import UTC
from enum import StrEnum
from typing import Annotated

from pydantic import (
    AfterValidator,
    AwareDatetime,
    BaseModel,
    ConfigDict,
    Field,
    FiniteFloat,
    StringConstraints,
    field_validator,
    model_validator,
)

from mtex_pdm.contracts import (
    CANONICAL_NUMERIC_ATTRIBUTES,
    ComponentKey,
    DatasetSplit,
    DataSource,
)

RuntimeIdentifier = Annotated[
    str,
    StringConstraints(pattern=r"^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$"),
]
RuntimeUTCDateTime = Annotated[
    AwareDatetime,
    AfterValidator(lambda value: value.astimezone(UTC)),
]
Sha256Digest = Annotated[str, StringConstraints(pattern=r"^[0-9a-f]{64}$")]


class _RuntimeModel(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
        frozen=True,
        str_strip_whitespace=True,
        use_enum_values=False,
    )


class GenerationMode(StrEnum):
    """Clock/output profiles supported by the shared state engine."""

    OFFLINE = "offline"
    MQTT_CONTINUOUS = "mqtt_continuous"
    MQTT_DEMONSTRATION = "mqtt_demonstration"


class NumericSignal(_RuntimeModel):
    """One observable numeric value from the canonical telemetry vocabulary."""

    name: RuntimeIdentifier
    value: FiniteFloat

    @field_validator("name")
    @classmethod
    def require_canonical_name(cls, value: str) -> str:
        if value not in CANONICAL_NUMERIC_ATTRIBUTES:
            raise ValueError(f"unknown canonical numeric signal: {value!r}")
        return value


class ObservableMachineState(_RuntimeModel):
    """Telemetry-visible state; it cannot contain degradation or future events."""

    iamalive: str = Field(default="true", min_length=1)
    numeric_signals: tuple[NumericSignal, ...] = ()

    @model_validator(mode="after")
    def require_unique_signal_names(self) -> ObservableMachineState:
        names = [signal.name for signal in self.numeric_signals]
        if len(names) != len(set(names)):
            raise ValueError("observable state contains duplicate numeric signal names")
        return self

    def value(self, name: str) -> float | None:
        """Return one observable value without exposing internal representation."""

        for signal in self.numeric_signals:
            if signal.name == name:
                return float(signal.value)
        return None

    def with_value(self, name: str, value: float) -> ObservableMachineState:
        """Return a new state with one canonical numeric signal replaced or appended."""

        if not math.isfinite(value):
            raise ValueError("observable numeric values must be finite")
        replacement = NumericSignal(name=name, value=value)
        updated = [signal for signal in self.numeric_signals if signal.name != name]
        updated.append(replacement)
        updated.sort(key=lambda signal: signal.name)
        return self.model_copy(update={"numeric_signals": tuple(updated)})


class ComponentHiddenState(_RuntimeModel):
    """Basic, simulation-only state for one maintenance component."""

    component_key: ComponentKey
    degradation: FiniteFloat = Field(ge=0.0, le=1.0)
    synthetic_cause: str | None = Field(default=None, min_length=1)


class HiddenMachineState(_RuntimeModel):
    """Ground truth which must never enter telemetry or model features."""

    components: tuple[ComponentHiddenState, ...] = ()

    @model_validator(mode="after")
    def require_unique_components(self) -> HiddenMachineState:
        keys = [component.component_key for component in self.components]
        if len(keys) != len(set(keys)):
            raise ValueError("hidden state contains duplicate component keys")
        return self


class MachineState(_RuntimeModel):
    """Internal state envelope kept by the engine between steps."""

    observable: ObservableMachineState = Field(default_factory=ObservableMachineState)
    hidden: HiddenMachineState = Field(default_factory=HiddenMachineState)


class MachineSimulationSpec(_RuntimeModel):
    """Stable identity and initial state for one simulated machine."""

    machine_id: RuntimeIdentifier
    scenario_id: RuntimeIdentifier
    data_source: DataSource
    split: DatasetSplit
    initial_state: MachineState = Field(default_factory=MachineState)

    @model_validator(mode="after")
    def validate_source_split(self) -> MachineSimulationSpec:
        allowed = {
            DataSource.SYNTHETIC_HISTORICAL: {
                DatasetSplit.TRAIN,
                DatasetSplit.VALIDATION,
                DatasetSplit.TEST,
            },
            DataSource.MQTT_PROSPECTIVE: {DatasetSplit.PROSPECTIVE},
        }
        if self.data_source not in allowed:
            raise ValueError("the generator cannot simulate real_shadow data")
        if self.split not in allowed[self.data_source]:
            raise ValueError(
                f"split {self.split.value!r} is incompatible with "
                f"generated source {self.data_source.value!r}"
            )
        return self


class GenerationConfig(_RuntimeModel):
    """One bounded, deterministic generator execution."""

    mode: GenerationMode
    start_at: RuntimeUTCDateTime
    end_at: RuntimeUTCDateTime
    step_seconds: int = Field(gt=0, le=86_400)
    master_seed: int = Field(ge=0, le=2**64 - 1)
    machines: tuple[MachineSimulationSpec, ...] = Field(min_length=1)

    @model_validator(mode="after")
    def validate_execution_boundary(self) -> GenerationConfig:
        if self.end_at <= self.start_at:
            raise ValueError("end_at must be later than start_at")
        duration_seconds = (self.end_at - self.start_at).total_seconds()
        if duration_seconds % self.step_seconds != 0:
            raise ValueError("execution duration must contain complete generator steps")
        machine_ids = [machine.machine_id for machine in self.machines]
        if len(machine_ids) != len(set(machine_ids)):
            raise ValueError("generation config contains duplicate machine IDs")
        expected_source = (
            DataSource.SYNTHETIC_HISTORICAL
            if self.mode is GenerationMode.OFFLINE
            else DataSource.MQTT_PROSPECTIVE
        )
        incompatible = [
            machine.machine_id
            for machine in self.machines
            if machine.data_source is not expected_source
        ]
        if incompatible:
            raise ValueError(
                f"mode {self.mode.value!r} is incompatible with machines {incompatible}"
            )
        return self


class StepContext(_RuntimeModel):
    """Deterministic context passed to a state transition."""

    machine_id: RuntimeIdentifier
    scenario_id: RuntimeIdentifier
    time_index: RuntimeUTCDateTime
    step_index: int = Field(ge=0)
    step_seconds: int = Field(gt=0)


class TelemetrySnapshot(_RuntimeModel):
    """One telemetry-visible result emitted after a generator step."""

    machine_id: RuntimeIdentifier
    time_index: RuntimeUTCDateTime
    data_source: DataSource
    split: DatasetSplit
    observable: ObservableMachineState


class GroundTruthSnapshot(_RuntimeModel):
    """Separate simulation trace; never accepted by telemetry outputs."""

    machine_id: RuntimeIdentifier
    time_index: RuntimeUTCDateTime
    scenario_id: RuntimeIdentifier
    machine_seed: int = Field(ge=0, le=2**64 - 1)
    hidden: HiddenMachineState


class GenerationSummary(_RuntimeModel):
    """Small receipt returned by one engine run call."""

    tick_count: int = Field(ge=0)
    machine_count: int = Field(gt=0)
    telemetry_snapshot_count: int = Field(ge=0)
    ground_truth_snapshot_count: int = Field(ge=0)
    next_time_index: RuntimeUTCDateTime | None


class MachineCheckpoint(_RuntimeModel):
    """Serializable machine state and Python RNG continuation."""

    machine_id: RuntimeIdentifier
    machine_seed: int = Field(ge=0, le=2**64 - 1)
    step_index: int = Field(ge=0)
    state: MachineState
    rng_version: int = Field(gt=0)
    rng_internal_state: tuple[int, ...] = Field(min_length=1)
    rng_gauss_next: FiniteFloat | None = None


class GeneratorCheckpoint(_RuntimeModel):
    """Portable in-progress engine state tied to one exact run configuration."""

    config_sha256: Sha256Digest
    next_time_index: RuntimeUTCDateTime
    machines: tuple[MachineCheckpoint, ...] = Field(min_length=1)

    @model_validator(mode="after")
    def require_unique_machine_ids(self) -> GeneratorCheckpoint:
        machine_ids = [machine.machine_id for machine in self.machines]
        if len(machine_ids) != len(set(machine_ids)):
            raise ValueError("checkpoint contains duplicate machine IDs")
        return self
