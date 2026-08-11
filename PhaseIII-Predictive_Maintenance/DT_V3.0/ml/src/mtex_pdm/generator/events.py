"""Assembly of append-only runtime markers into canonical maintenance lifecycles."""

from __future__ import annotations

from collections import defaultdict
from collections.abc import Iterable
from datetime import UTC, datetime

from mtex_pdm.contracts import MaintenanceEvent
from mtex_pdm.generator.models import GroundTruthEvent, GroundTruthEventKind


def assemble_maintenance_events(
    events: Iterable[GroundTruthEvent],
    *,
    finalize_at: datetime,
) -> tuple[MaintenanceEvent, ...]:
    """Join due/performed markers and censor lifecycles still open at finalization."""

    if finalize_at.tzinfo is None or finalize_at.utcoffset() is None:
        raise ValueError("finalize_at must include a timezone")
    normalized_finalize_at = finalize_at.astimezone(UTC)
    grouped: dict[str, list[GroundTruthEvent]] = defaultdict(list)
    for event in events:
        if event.occurred_at > normalized_finalize_at:
            raise ValueError("ground-truth event occurs after dataset finalization")
        grouped[event.event_id].append(event)

    lifecycles: list[MaintenanceEvent] = []
    for event_id, markers in grouped.items():
        ordered = sorted(markers, key=lambda marker: (marker.occurred_at, marker.kind.value))
        due_markers = [
            marker for marker in ordered if marker.kind is GroundTruthEventKind.MAINTENANCE_DUE
        ]
        performed_markers = [
            marker
            for marker in ordered
            if marker.kind is GroundTruthEventKind.MAINTENANCE_PERFORMED
        ]
        if len(due_markers) != 1:
            raise ValueError(f"event {event_id!r} must contain exactly one maintenance_due")
        if len(performed_markers) > 1:
            raise ValueError(f"event {event_id!r} contains duplicate maintenance_performed")
        due = due_markers[0]
        for marker in ordered:
            identity = (
                marker.machine_id,
                marker.component_key,
                marker.label_source,
                marker.data_source,
                marker.split,
                marker.scenario_id,
                marker.maintenance_due_at,
                marker.severity,
            )
            expected = (
                due.machine_id,
                due.component_key,
                due.label_source,
                due.data_source,
                due.split,
                due.scenario_id,
                due.maintenance_due_at,
                due.severity,
            )
            if identity != expected:
                raise ValueError(f"event {event_id!r} markers have inconsistent identity")
        performed_at = performed_markers[0].occurred_at if performed_markers else None
        lifecycles.append(
            MaintenanceEvent.model_validate(
                {
                    "event_id": event_id,
                    "machine_id": due.machine_id,
                    "component_key": due.component_key,
                    "label_source": due.label_source,
                    "data_source": due.data_source,
                    "split": due.split,
                    "scenario_id": due.scenario_id,
                    "maintenance_due_at": due.maintenance_due_at,
                    "maintenance_performed_at": performed_at,
                    "censored": performed_at is None,
                }
            )
        )
    return tuple(sorted(lifecycles, key=lambda event: (event.maintenance_due_at, event.event_id)))


__all__ = ["assemble_maintenance_events"]
