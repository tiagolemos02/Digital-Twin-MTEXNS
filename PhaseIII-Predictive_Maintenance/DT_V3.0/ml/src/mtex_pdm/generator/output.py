"""Streaming output boundary and temporary in-memory implementation."""

from __future__ import annotations

from typing import Protocol

from mtex_pdm.generator.models import (
    GroundTruthEvent,
    GroundTruthSnapshot,
    TelemetrySnapshot,
)


class GeneratorOutput(Protocol):
    """Receives separated generator streams without defining their persistence."""

    def emit_telemetry(self, snapshot: TelemetrySnapshot) -> None: ...

    def emit_ground_truth(self, snapshot: GroundTruthSnapshot) -> None: ...

    def emit_event(self, event: GroundTruthEvent) -> None: ...

    def bind_transition(self, transition_sha256: str) -> None: ...


class InMemoryOutput:
    """Small test/demo output; it is intentionally unsuitable for full datasets."""

    def __init__(self) -> None:
        self._telemetry: list[TelemetrySnapshot] = []
        self._ground_truth: list[GroundTruthSnapshot] = []
        self._events: list[GroundTruthEvent] = []

    @property
    def telemetry(self) -> tuple[TelemetrySnapshot, ...]:
        return tuple(self._telemetry)

    @property
    def ground_truth(self) -> tuple[GroundTruthSnapshot, ...]:
        return tuple(self._ground_truth)

    @property
    def events(self) -> tuple[GroundTruthEvent, ...]:
        return tuple(self._events)

    def emit_telemetry(self, snapshot: TelemetrySnapshot) -> None:
        self._telemetry.append(snapshot)

    def emit_ground_truth(self, snapshot: GroundTruthSnapshot) -> None:
        self._ground_truth.append(snapshot)

    def emit_event(self, event: GroundTruthEvent) -> None:
        self._events.append(event)

    def bind_transition(self, transition_sha256: str) -> None:
        del transition_sha256


__all__ = ["GeneratorOutput", "InMemoryOutput"]
