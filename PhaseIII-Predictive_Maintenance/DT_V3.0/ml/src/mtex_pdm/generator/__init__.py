"""Public API for the synthetic generator core."""

from mtex_pdm.generator.engine import (
    GeneratorEngine,
    StateTransition,
    derive_machine_seed,
    passthrough_transition,
)
from mtex_pdm.generator.models import (
    ComponentHiddenState,
    GenerationConfig,
    GenerationMode,
    GenerationSummary,
    GeneratorCheckpoint,
    GroundTruthSnapshot,
    HiddenMachineState,
    MachineCheckpoint,
    MachineSimulationSpec,
    MachineState,
    NumericSignal,
    ObservableMachineState,
    StepContext,
    TelemetrySnapshot,
)
from mtex_pdm.generator.output import GeneratorOutput, InMemoryOutput

__all__ = [
    "ComponentHiddenState",
    "GenerationConfig",
    "GenerationMode",
    "GenerationSummary",
    "GeneratorCheckpoint",
    "GeneratorEngine",
    "GeneratorOutput",
    "GroundTruthSnapshot",
    "HiddenMachineState",
    "InMemoryOutput",
    "MachineCheckpoint",
    "MachineSimulationSpec",
    "MachineState",
    "NumericSignal",
    "ObservableMachineState",
    "StateTransition",
    "StepContext",
    "TelemetrySnapshot",
    "derive_machine_seed",
    "passthrough_transition",
]
