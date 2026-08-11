"""Streaming output boundary and temporary in-memory implementation."""

from __future__ import annotations

from typing import Protocol

from mtex_pdm.generator.models import GroundTruthSnapshot, TelemetrySnapshot


class GeneratorOutput(Protocol):
    """Receives separated generator streams without defining their persistence."""

    def emit_telemetry(self, snapshot: TelemetrySnapshot) -> None: ...

    def emit_ground_truth(self, snapshot: GroundTruthSnapshot) -> None: ...


class InMemoryOutput:
    """Small test/demo output; it is intentionally unsuitable for full datasets."""

    def __init__(self) -> None:
        self._telemetry: list[TelemetrySnapshot] = []
        self._ground_truth: list[GroundTruthSnapshot] = []

    @property
    def telemetry(self) -> tuple[TelemetrySnapshot, ...]:
        return tuple(self._telemetry)

    @property
    def ground_truth(self) -> tuple[GroundTruthSnapshot, ...]:
        return tuple(self._ground_truth)

    def emit_telemetry(self, snapshot: TelemetrySnapshot) -> None:
        self._telemetry.append(snapshot)

    def emit_ground_truth(self, snapshot: GroundTruthSnapshot) -> None:
        self._ground_truth.append(snapshot)


__all__ = ["GeneratorOutput", "InMemoryOutput"]
