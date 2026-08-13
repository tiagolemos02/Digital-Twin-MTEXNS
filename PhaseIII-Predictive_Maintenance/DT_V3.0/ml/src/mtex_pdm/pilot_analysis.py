"""Read-only profiling and scale decisions for draft synthetic pilots."""

from __future__ import annotations

import hashlib
import json
import math
import statistics
from bisect import bisect_right
from collections import Counter, defaultdict
from dataclasses import dataclass
from datetime import datetime, timedelta
from itertools import pairwise
from pathlib import Path
from typing import Any

import pyarrow as pa
import pyarrow.dataset as ds
import pyarrow.parquet as pq
import yaml

from mtex_pdm import __version__
from mtex_pdm.contracts import (
    CANONICAL_NUMERIC_ATTRIBUTES,
    ComponentKey,
    DatasetManifest,
    DatasetSplit,
    DataSource,
    LabelSource,
    MaintenanceEvent,
    canonical_json_bytes,
)
from mtex_pdm.generator.dataset import verify_dataset


@dataclass(frozen=True, slots=True)
class RealMachineReference:
    """An anonymized, source-native observation used only as pilot evidence."""

    reference_id: str
    confirmed_units: dict[str, str]
    canonical_values: dict[str, float]
    ignored_attributes: tuple[str, ...]


@dataclass(frozen=True, slots=True)
class PilotAnalysisReceipt:
    """Published analysis path plus its three human/audit-facing reports."""

    analysis_path: Path
    healthy: bool
    profile: dict[str, Any]
    events: dict[str, Any]
    scale_decision: dict[str, Any]


@dataclass(frozen=True, slots=True)
class PilotAnalysisVerificationReport:
    """Integrity and cross-report verification for one published pilot analysis."""

    healthy: bool
    dataset_id: str | None
    checked_file_count: int
    errors: tuple[str, ...]


@dataclass(frozen=True, slots=True)
class PilotMachineAssignment:
    """Validated identity and deterministic seed for one pilot machine."""

    machine_id: str
    scenario_id: str
    data_source: DataSource
    split: DatasetSplit
    machine_seed: int


def _finite_float(value: object, *, field: str) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float, str)):
        raise ValueError(f"{field} must be a finite numeric value")
    try:
        parsed = float(value)
    except ValueError as error:
        raise ValueError(f"{field} must be a finite numeric value") from error
    if not math.isfinite(parsed):
        raise ValueError(f"{field} must be a finite numeric value")
    return parsed


def load_real_machine_reference(path: Path) -> RealMachineReference:
    """Validate and flatten one anonymized source-native machine observation."""

    payload = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(payload, dict):
        raise ValueError("real-machine reference must be a JSON object")
    reference_id = payload.get("reference_id")
    observations = payload.get("observations")
    confirmed_units = payload.get("confirmed_units")
    if not isinstance(reference_id, str) or not reference_id.strip():
        raise ValueError("real-machine reference requires reference_id")
    if not isinstance(observations, dict) or not isinstance(confirmed_units, dict):
        raise ValueError("real-machine reference requires observations and confirmed_units")

    canonical: dict[str, float] = {}
    ignored: list[str] = []
    known = set(CANONICAL_NUMERIC_ATTRIBUTES)
    for attribute, raw_value in observations.items():
        if not isinstance(attribute, str):
            raise ValueError("observation attribute names must be strings")
        flattened: dict[str, float]
        if isinstance(raw_value, dict):
            if set(raw_value) != {"maximum", "value"}:
                raise ValueError(f"structured observation {attribute!r} requires value and maximum")
            value = _finite_float(raw_value["value"], field=f"{attribute}.value")
            maximum = _finite_float(raw_value["maximum"], field=f"{attribute}.maximum")
            if maximum <= 0.0 or value < 0.0 or value > maximum:
                raise ValueError(f"structured observation {attribute!r} has invalid bounds")
            flattened = {attribute: value, f"{attribute}_maximum": maximum}
        else:
            flattened = {attribute: _finite_float(raw_value, field=attribute)}
        accepted = False
        for name, value in flattened.items():
            if name in known:
                canonical[name] = value
                accepted = True
        if not accepted:
            ignored.append(attribute)

    units: dict[str, str] = {}
    for attribute, unit in confirmed_units.items():
        if attribute not in canonical or not isinstance(unit, str) or not unit.strip():
            raise ValueError("confirmed units must reference observed canonical attributes")
        units[attribute] = unit

    return RealMachineReference(
        reference_id=reference_id,
        confirmed_units=dict(sorted(units.items())),
        canonical_values=dict(sorted(canonical.items())),
        ignored_attributes=tuple(sorted(ignored)),
    )


def _round(value: float | None) -> float | None:
    return None if value is None else round(value, 10)


def _percentile(sorted_values: list[float], fraction: float) -> float | None:
    if not sorted_values:
        return None
    position = (len(sorted_values) - 1) * fraction
    lower = math.floor(position)
    upper = math.ceil(position)
    if lower == upper:
        return sorted_values[lower]
    weight = position - lower
    return sorted_values[lower] * (1.0 - weight) + sorted_values[upper] * weight


def _summary(values: list[float | None]) -> dict[str, Any]:
    finite = sorted(value for value in values if value is not None and math.isfinite(value))
    non_finite = sum(value is not None and not math.isfinite(value) for value in values)
    nulls = sum(value is None for value in values)
    return {
        "row_count": len(values),
        "finite_count": len(finite),
        "null_count": nulls,
        "non_finite_count": non_finite,
        "distinct_finite_count": len(set(finite)),
        "minimum": _round(finite[0] if finite else None),
        "p01": _round(_percentile(finite, 0.01)),
        "p25": _round(_percentile(finite, 0.25)),
        "median": _round(_percentile(finite, 0.50)),
        "mean": _round(statistics.fmean(finite) if finite else None),
        "p75": _round(_percentile(finite, 0.75)),
        "p99": _round(_percentile(finite, 0.99)),
        "maximum": _round(finite[-1] if finite else None),
        "population_stddev": _round(statistics.pstdev(finite) if len(finite) > 1 else 0.0),
    }


def _sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _unit_status(unit: str) -> str:
    if unit == "source_native_unconfirmed":
        return "source_native_unconfirmed"
    if unit == "synthetic_only":
        return "synthetic_only"
    return "confirmed"


def _read_manifest(dataset_path: Path) -> DatasetManifest:
    return DatasetManifest.model_validate_json(
        (dataset_path / "manifests" / "dataset_manifest.json").read_bytes()
    )


def _read_assignments(
    dataset_path: Path,
    manifest: DatasetManifest,
) -> tuple[PilotMachineAssignment, ...]:
    payload = json.loads(
        (dataset_path / "configs" / "scenario_assignments.json").read_text(encoding="utf-8")
    )
    if not isinstance(payload, list) or not all(isinstance(item, dict) for item in payload):
        raise ValueError("scenario assignments must be a list of objects")
    required = {"data_source", "machine_id", "machine_seed", "scenario_id", "split"}
    assignments: list[PilotMachineAssignment] = []
    for item in payload:
        if set(item) != required:
            raise ValueError("scenario assignment fields do not match the canonical contract")
        machine_id = item["machine_id"]
        scenario_id = item["scenario_id"]
        machine_seed = item["machine_seed"]
        if (
            not isinstance(machine_id, str)
            or not machine_id
            or not isinstance(scenario_id, str)
            or not scenario_id
            or isinstance(machine_seed, bool)
            or not isinstance(machine_seed, int)
            or machine_seed < 0
        ):
            raise ValueError("scenario assignment identity and seed types are invalid")
        assignments.append(
            PilotMachineAssignment(
                machine_id=machine_id,
                scenario_id=scenario_id,
                data_source=DataSource(item["data_source"]),
                split=DatasetSplit(item["split"]),
                machine_seed=machine_seed,
            )
        )

    machine_ids = [item.machine_id for item in assignments]
    if len(machine_ids) != len(set(machine_ids)):
        raise ValueError("scenario assignments contain duplicate machine IDs")
    expected_split_by_machine = {
        machine_id: split
        for split, summary in manifest.splits.items()
        for machine_id in summary.machine_ids
    }
    if set(machine_ids) != set(expected_split_by_machine):
        raise ValueError("scenario assignments do not match manifest machines")
    for assignment in assignments:
        if assignment.split is not expected_split_by_machine[assignment.machine_id]:
            raise ValueError(f"scenario assignment split mismatch for {assignment.machine_id!r}")
        if assignment.data_source is not DataSource.SYNTHETIC_HISTORICAL:
            raise ValueError("historical pilot assignments require synthetic_historical source")
    if {item.scenario_id for item in assignments} != set(manifest.scenarios):
        raise ValueError("scenario assignments do not match manifest scenarios")
    return tuple(assignments)


def _read_telemetry(dataset_path: Path) -> pa.Table:
    return ds.dataset(dataset_path / "telemetry", format="parquet").to_table()


def _validate_telemetry_identity(
    table: pa.Table,
    assignments: tuple[PilotMachineAssignment, ...],
) -> None:
    assignment_by_machine = {item.machine_id: item for item in assignments}
    machine_ids = table.column("machine_id").to_pylist()
    splits = table.column("split").to_pylist()
    data_sources = table.column("data_source").to_pylist()
    for machine_id, split, data_source in zip(machine_ids, splits, data_sources, strict=True):
        assignment = assignment_by_machine.get(str(machine_id))
        if assignment is None:
            raise ValueError(f"telemetry references unassigned machine {machine_id!r}")
        if split != assignment.split.value:
            raise ValueError(f"telemetry split mismatch for {machine_id!r}")
        if data_source != assignment.data_source.value:
            raise ValueError(f"telemetry data-source mismatch for {machine_id!r}")


def _profile_machines(
    *,
    table: pa.Table,
    assignments: tuple[PilotMachineAssignment, ...],
    expected_step: timedelta,
) -> tuple[dict[str, dict[str, Any]], dict[str, list[datetime]]]:
    assignment_by_machine = {item.machine_id: item for item in assignments}
    machine_ids = table.column("machine_id").to_pylist()
    timestamps = table.column("time_index").to_pylist()
    times_by_machine: dict[str, list[datetime]] = defaultdict(list)
    for machine_id, timestamp in zip(machine_ids, timestamps, strict=True):
        times_by_machine[str(machine_id)].append(timestamp)

    profiles: dict[str, dict[str, Any]] = {}
    for machine_id, raw_times in sorted(times_by_machine.items()):
        ordered = sorted(raw_times)
        unique = sorted(set(ordered))
        deltas = [later - earlier for earlier, later in pairwise(unique)]
        assignment = assignment_by_machine[machine_id]
        profiles[machine_id] = {
            "split": assignment.split.value,
            "scenario_id": assignment.scenario_id,
            "row_count": len(ordered),
            "unique_timestamp_count": len(unique),
            "duplicate_timestamp_count": len(ordered) - len(unique),
            "gap_count": sum(delta > expected_step for delta in deltas),
            "out_of_cadence_count": sum(delta != expected_step for delta in deltas),
            "first_timestamp": unique[0].isoformat().replace("+00:00", "Z"),
            "last_timestamp": unique[-1].isoformat().replace("+00:00", "Z"),
        }
        times_by_machine[machine_id] = unique
    return profiles, dict(times_by_machine)


def _reference_comparison(
    *,
    attribute: str,
    summary: dict[str, Any],
    reference: RealMachineReference | None,
) -> dict[str, Any] | None:
    if reference is None or attribute not in reference.canonical_values:
        return None
    observed = reference.canonical_values[attribute]
    minimum = summary["minimum"]
    maximum = summary["maximum"]
    if minimum is None or maximum is None:
        position = "not_comparable"
    elif observed < minimum:
        position = "below_synthetic_range"
    elif observed > maximum:
        position = "above_synthetic_range"
    else:
        position = "within_synthetic_range"
    return {"observed_value": observed, "position": position}


def _profile_numeric_attributes(
    *,
    table: pa.Table,
    manifest: DatasetManifest,
    assignments: tuple[PilotMachineAssignment, ...],
    reference: RealMachineReference | None,
) -> dict[str, dict[str, Any]]:
    machine_ids = [str(value) for value in table.column("machine_id").to_pylist()]
    assignment_by_machine = {item.machine_id: item for item in assignments}
    scenarios_by_row = [assignment_by_machine[machine].scenario_id for machine in machine_ids]
    result: dict[str, dict[str, Any]] = {}
    for attribute in CANONICAL_NUMERIC_ATTRIBUTES:
        values = [None if value is None else float(value) for value in table.column(attribute)]
        global_summary = _summary(values)
        by_machine: dict[str, list[float | None]] = defaultdict(list)
        by_scenario: dict[str, list[float | None]] = defaultdict(list)
        for machine_id, scenario_id, value in zip(
            machine_ids, scenarios_by_row, values, strict=True
        ):
            by_machine[machine_id].append(value)
            by_scenario[scenario_id].append(value)
        unit = manifest.units[attribute]
        reference_unit = reference.confirmed_units.get(attribute) if reference else None
        if reference_unit is not None and reference_unit != unit:
            raise ValueError(
                f"real reference unit for {attribute!r} does not match dataset unit "
                f"({reference_unit!r} != {unit!r}); explicit conversion is required"
            )
        result[attribute] = {
            "unit": unit,
            "unit_status": _unit_status(unit),
            **global_summary,
            "by_machine": {
                key: _summary(group_values) for key, group_values in sorted(by_machine.items())
            },
            "by_scenario": {
                key: _summary(group_values) for key, group_values in sorted(by_scenario.items())
            },
            "reference_observation": _reference_comparison(
                attribute=attribute,
                summary=global_summary,
                reference=reference,
            ),
        }
    return result


def _profile_dataset(
    *,
    dataset_path: Path,
    manifest: DatasetManifest,
    table: pa.Table,
    assignments: tuple[PilotMachineAssignment, ...],
    reference: RealMachineReference | None,
) -> tuple[dict[str, Any], dict[str, list[datetime]]]:
    step = timedelta(minutes=manifest.resample_minutes)
    machines, times_by_machine = _profile_machines(
        table=table,
        assignments=assignments,
        expected_step=step,
    )
    scenarios = Counter(
        item.scenario_id
        for item in assignments
        for _ in range(machines[item.machine_id]["row_count"])
    )
    duplicate_count = sum(item["duplicate_timestamp_count"] for item in machines.values())
    reference_report: dict[str, Any] | None = None
    if reference is not None:
        reference_report = {
            "reference_id": reference.reference_id,
            "confirmed_units": reference.confirmed_units,
            "canonical_attribute_count": len(reference.canonical_values),
            "ignored_attributes": list(reference.ignored_attributes),
            "usage": "single anonymized observation for pilot range evidence; not a population",
        }
    profile = {
        "analysis_version": "1.0.0",
        "dataset_id": manifest.dataset_id,
        "generator_version": manifest.generator_version,
        "analysis_software_version": __version__,
        "status": "draft",
        "telemetry_row_count": table.num_rows,
        "machine_count": len(machines),
        "partition_count": len(tuple((dataset_path / "telemetry").rglob("*.parquet"))),
        "resample_minutes": manifest.resample_minutes,
        "start_time": manifest.start_time.isoformat().replace("+00:00", "Z"),
        "end_time": manifest.end_time.isoformat().replace("+00:00", "Z"),
        "duplicate_timestamp_count": duplicate_count,
        "gap_count": sum(item["gap_count"] for item in machines.values()),
        "rows_by_split": {
            split.value: manifest.splits[split].row_count
            for split in (DatasetSplit.TRAIN, DatasetSplit.VALIDATION, DatasetSplit.TEST)
        },
        "rows_by_scenario": dict(sorted(scenarios.items())),
        "machines": machines,
        "numeric_attributes": _profile_numeric_attributes(
            table=table,
            manifest=manifest,
            assignments=assignments,
            reference=reference,
        ),
        "reference_observation": reference_report,
        "limitations": [
            "unconfirmed source-native units are profiled but not judged physically valid",
            "one real observation supports parsing and range evidence, not distribution fitting",
            "synthetic profiling does not establish industrial predictive performance",
        ],
    }
    return profile, times_by_machine


def _event_key(event: MaintenanceEvent) -> tuple[str, ComponentKey]:
    return event.machine_id, event.component_key


def _preliminary_windows(
    *,
    manifest: DatasetManifest,
    events: tuple[MaintenanceEvent, ...],
    times_by_machine: dict[str, list[datetime]],
    assignments: tuple[PilotMachineAssignment, ...],
    horizon_hours: int,
) -> dict[str, Any]:
    horizon = timedelta(hours=horizon_hours)
    by_key: dict[tuple[str, ComponentKey], list[MaintenanceEvent]] = defaultdict(list)
    for event in events:
        by_key[_event_key(event)].append(event)
    for key in by_key:
        by_key[key].sort(key=lambda event: event.maintenance_due_at)

    component_counts = {
        component: Counter({"positive": 0, "negative": 0, "future_censored": 0, "overdue": 0})
        for component in ComponentKey
    }
    split_counts: dict[str, Counter[str]] = defaultdict(Counter)
    scenario_counts: dict[str, Counter[str]] = defaultdict(Counter)
    component_split_counts: dict[tuple[ComponentKey, str], Counter[str]] = defaultdict(Counter)
    component_scenario_counts: dict[tuple[ComponentKey, str], Counter[str]] = defaultdict(Counter)
    label_source_counts: Counter[str] = Counter()
    component_label_source_counts: dict[ComponentKey, Counter[str]] = defaultdict(Counter)
    assignment_by_machine = {item.machine_id: item for item in assignments}
    for machine_id, times in times_by_machine.items():
        assignment = assignment_by_machine[machine_id]
        split = assignment.split.value
        scenario_id = assignment.scenario_id
        for component in ComponentKey:
            component_events = by_key[(machine_id, component)]
            due_times = [event.maintenance_due_at for event in component_events]
            counts = component_counts[component]
            for prediction_time in times:
                if prediction_time + horizon > manifest.end_time:
                    counts["future_censored"] += 1
                    split_counts[split]["future_censored"] += 1
                    scenario_counts[scenario_id]["future_censored"] += 1
                    component_split_counts[(component, split)]["future_censored"] += 1
                    component_scenario_counts[(component, scenario_id)]["future_censored"] += 1
                    continue
                previous_index = bisect_right(due_times, prediction_time) - 1
                if previous_index >= 0:
                    previous = component_events[previous_index]
                    if (
                        previous.maintenance_performed_at is None
                        or prediction_time < previous.maintenance_performed_at
                    ):
                        counts["overdue"] += 1
                        split_counts[split]["overdue"] += 1
                        scenario_counts[scenario_id]["overdue"] += 1
                        component_split_counts[(component, split)]["overdue"] += 1
                        component_scenario_counts[(component, scenario_id)]["overdue"] += 1
                        continue
                next_index = bisect_right(due_times, prediction_time)
                positive = (
                    next_index < len(due_times)
                    and due_times[next_index] <= prediction_time + horizon
                )
                outcome = "positive" if positive else "negative"
                counts[outcome] += 1
                split_counts[split][outcome] += 1
                scenario_counts[scenario_id][outcome] += 1
                component_split_counts[(component, split)][outcome] += 1
                component_scenario_counts[(component, scenario_id)][outcome] += 1
                if positive:
                    label_source = component_events[next_index].label_source.value
                    label_source_counts[label_source] += 1
                    component_label_source_counts[component][label_source] += 1

    by_component: dict[str, Any] = {}
    total: Counter[str] = Counter()
    for component, counts in component_counts.items():
        total.update(counts)
        eligible = counts["positive"] + counts["negative"]
        by_component[component.value] = {
            "eligible_count": eligible,
            "positive_count": counts["positive"],
            "negative_count": counts["negative"],
            "future_censored_count": counts["future_censored"],
            "excluded_overdue_count": counts["overdue"],
            "prevalence": _round(counts["positive"] / eligible) if eligible else None,
        }
    eligible_total = total["positive"] + total["negative"]

    def group_report(counts: Counter[str]) -> dict[str, Any]:
        eligible = counts["positive"] + counts["negative"]
        return {
            "eligible_count": eligible,
            "positive_count": counts["positive"],
            "negative_count": counts["negative"],
            "future_censored_count": counts["future_censored"],
            "excluded_overdue_count": counts["overdue"],
            "prevalence": _round(counts["positive"] / eligible) if eligible else None,
        }

    return {
        "horizon_hours": horizon_hours,
        "estimable": eligible_total > 0,
        "eligible_count": eligible_total,
        "positive_count": total["positive"],
        "negative_count": total["negative"],
        "future_censored_count": total["future_censored"],
        "excluded_overdue_count": total["overdue"],
        "prevalence": _round(total["positive"] / eligible_total) if eligible_total else None,
        "by_component": by_component,
        "by_split": {key: group_report(value) for key, value in sorted(split_counts.items())},
        "by_scenario": {key: group_report(value) for key, value in sorted(scenario_counts.items())},
        "by_component_and_split": {
            component.value: {
                split.value: group_report(component_split_counts[(component, split.value)])
                for split in (DatasetSplit.TRAIN, DatasetSplit.VALIDATION, DatasetSplit.TEST)
            }
            for component in ComponentKey
        },
        "by_component_and_scenario": {
            component.value: {
                scenario_id: group_report(component_scenario_counts[(component, scenario_id)])
                for scenario_id in sorted(scenario_counts)
            }
            for component in ComponentKey
        },
        "positive_window_counts_by_label_source": {
            source.value: label_source_counts[source.value] for source in LabelSource
        },
        "positive_window_counts_by_component_and_label_source": {
            component.value: {
                source.value: component_label_source_counts[component][source.value]
                for source in LabelSource
            }
            for component in ComponentKey
        },
        "method": "preliminary event-window projection without Day-6/7 quality filters",
        "final_for_model_evaluation": False,
    }


def _analyze_events(
    *,
    manifest: DatasetManifest,
    event_table: pa.Table,
    times_by_machine: dict[str, list[datetime]],
    assignments: tuple[PilotMachineAssignment, ...],
) -> dict[str, Any]:
    events = tuple(MaintenanceEvent.model_validate(item) for item in event_table.to_pylist())
    event_ids = [event.event_id for event in events]
    if len(event_ids) != len(set(event_ids)):
        raise ValueError("maintenance events are not independent by event_id")
    assignment_by_machine = {item.machine_id: item for item in assignments}
    for event in events:
        assignment = assignment_by_machine.get(event.machine_id)
        if assignment is None:
            raise ValueError(f"maintenance event references unknown machine {event.machine_id!r}")
        if event.split is not assignment.split:
            raise ValueError(f"maintenance event split mismatch for {event.event_id!r}")
        if event.scenario_id != assignment.scenario_id:
            raise ValueError(f"maintenance event scenario mismatch for {event.event_id!r}")
        if event.data_source is not assignment.data_source:
            raise ValueError(f"maintenance event data-source mismatch for {event.event_id!r}")
        if not manifest.start_time <= event.maintenance_due_at < manifest.end_time:
            raise ValueError(f"maintenance due time is outside dataset range: {event.event_id!r}")
        if (
            event.maintenance_performed_at is not None
            and not manifest.start_time <= event.maintenance_performed_at < manifest.end_time
        ):
            raise ValueError(
                f"maintenance performed time is outside dataset range: {event.event_id!r}"
            )
    by_component = Counter(event.component_key.value for event in events)
    by_split = {
        split.value: Counter(event.component_key.value for event in events if event.split is split)
        for split in (DatasetSplit.TRAIN, DatasetSplit.VALIDATION, DatasetSplit.TEST)
    }
    by_scenario = Counter(event.scenario_id for event in events)
    delays = sorted(
        (event.maintenance_performed_at - event.maintenance_due_at).total_seconds() / 3600.0
        for event in events
        if event.maintenance_performed_at is not None
    )
    machine_days = sum(
        len(times) * manifest.resample_minutes / (24.0 * 60.0)
        for times in times_by_machine.values()
    )
    return {
        "analysis_version": "1.0.0",
        "dataset_id": manifest.dataset_id,
        "independent_event_count": len(events),
        "censored_event_count": sum(event.censored for event in events),
        "censored_event_fraction": _round(
            sum(event.censored for event in events) / len(events) if events else 0.0
        ),
        "counts_by_component": {
            component.value: by_component[component.value] for component in ComponentKey
        },
        "counts_by_split_and_component": {
            split.value: {
                component.value: by_split[split.value][component.value]
                for component in ComponentKey
            }
            for split in (DatasetSplit.TRAIN, DatasetSplit.VALIDATION, DatasetSplit.TEST)
        },
        "counts_by_scenario": dict(sorted(by_scenario.items())),
        "machine_days_observed": _round(machine_days),
        "events_per_machine_day_by_component": {
            component.value: _round(by_component[component.value] / machine_days)
            if machine_days
            else None
            for component in ComponentKey
        },
        "intervention_delay_hours": {
            "count": len(delays),
            "minimum": _round(delays[0] if delays else None),
            "median": _round(_percentile(delays, 0.5)),
            "maximum": _round(delays[-1] if delays else None),
        },
        "preliminary_label_windows": {
            str(horizon): _preliminary_windows(
                manifest=manifest,
                events=events,
                times_by_machine=times_by_machine,
                assignments=assignments,
                horizon_hours=horizon,
            )
            for horizon in (24, 168)
        },
        "limitations": [
            "event density, not repeated positive rows, drives scale decisions",
            "24h/168h window prevalence is preliminary until Day-6/7 labeling rules exist",
            "zero observed events make rate projection inconclusive rather than proving zero risk",
        ],
    }


def _load_dataset_contract(dataset_path: Path) -> dict[str, Any]:
    payload = yaml.safe_load((dataset_path / "configs" / "mvp.yaml").read_text(encoding="utf-8"))
    contract = payload.get("dataset_contract") if isinstance(payload, dict) else None
    if not isinstance(contract, dict):
        raise ValueError("copied mvp.yaml is missing dataset_contract")
    return contract


def _decide_scale(
    *,
    dataset_path: Path,
    manifest: DatasetManifest,
    profile: dict[str, Any],
    events: dict[str, Any],
) -> dict[str, Any]:
    contract = _load_dataset_contract(dataset_path)
    planned_machines = {
        str(split): int(count) for split, count in contract["split_machines"].items()
    }
    planned_days = int(contract["historical_days_per_machine"])
    gates = {
        str(split): int(count)
        for split, count in contract["minimum_independent_events_per_component"].items()
    }
    duration_days = (manifest.end_time - manifest.start_time).total_seconds() / 86_400.0
    current_machines = {
        split.value: len(manifest.splits[split].machine_ids)
        for split in (DatasetSplit.TRAIN, DatasetSplit.VALIDATION, DatasetSplit.TEST)
    }
    counts = events["counts_by_split_and_component"]
    required_machine_days: dict[str, dict[str, float | None]] = {}
    projected_days: list[int] = [planned_days]
    zero_components: set[str] = set()
    gate_failures: list[str] = []
    for split in ("train", "validation", "test"):
        exposure = current_machines[split] * duration_days
        required_machine_days[split] = {}
        for component in ComponentKey:
            observed = int(counts[split][component.value])
            if observed < gates[split]:
                gate_failures.append(f"{split}:{component.value}")
            if observed == 0 or exposure <= 0.0:
                required_machine_days[split][component.value] = None
                zero_components.add(component.value)
                continue
            density = observed / exposure
            required = math.ceil((gates[split] / density) * 1.25)
            required_machine_days[split][component.value] = float(required)
            projected_days.append(math.ceil(required / planned_machines[split]))

    unconfirmed = sorted(
        attribute
        for attribute, details in profile["numeric_attributes"].items()
        if details["unit_status"] == "source_native_unconfirmed"
    )
    reference_outside = sorted(
        attribute
        for attribute, details in profile["numeric_attributes"].items()
        if details["reference_observation"] is not None
        and details["reference_observation"]["position"]
        in {"below_synthetic_range", "above_synthetic_range"}
    )
    recommended_machines = dict(planned_machines)
    recommended_days = max(projected_days)
    if zero_components:
        # With no observed rate there is no defensible gate projection. Propose a
        # bounded next experiment that grows both exposure axes by at least 25%.
        recommended_machines = {
            split: max(planned_machines[split], math.ceil(current_machines[split] * 1.25))
            for split in planned_machines
        }
        recommended_days = max(
            recommended_days,
            math.ceil(duration_days * 1.25),
        )
    needs_machines = any(
        current_machines[split] < planned_machines[split] for split in planned_machines
    )
    needs_days = duration_days < recommended_days
    if zero_components or (needs_machines and needs_days):
        decision = "increase_both"
    elif reference_outside:
        decision = "review_parameters"
    elif needs_days:
        decision = "increase_days"
    elif needs_machines:
        decision = "increase_machines"
    elif gate_failures or unconfirmed:
        decision = "review_parameters"
    else:
        decision = "ready_for_freeze"

    freeze_ready = decision == "ready_for_freeze" and not gate_failures and not unconfirmed
    reasons = []
    if zero_components:
        reasons.append("some components have zero observed events; their rate is inconclusive")
    if needs_machines:
        reasons.append("pilot machine diversity is below the frozen initial design")
    if needs_days:
        reasons.append("pilot exposure is below the conservative projected duration")
    if unconfirmed:
        reasons.append("source-native units remain unconfirmed and block the final freeze")
    if reference_outside:
        reasons.append("one or more real reference values fall outside the synthetic pilot range")
    if not reasons:
        reasons.append("event gates, diversity, duration, and unit confirmation are satisfied")

    return {
        "analysis_version": "1.0.0",
        "dataset_id": manifest.dataset_id,
        "decision": decision,
        "freeze_ready": freeze_ready,
        "decision_requires_human_approval": True,
        "configuration_was_modified": False,
        "current_machine_count_by_split": current_machines,
        "current_days_per_machine": _round(duration_days),
        "recommended_machine_count_by_split": dict(sorted(recommended_machines.items())),
        "recommended_days_per_machine": recommended_days,
        "event_gates_by_split": dict(sorted(gates.items())),
        "gate_failures": sorted(gate_failures),
        "zero_event_components": sorted(zero_components),
        "required_machine_days_by_split_and_component": required_machine_days,
        "unconfirmed_unit_attributes": unconfirmed,
        "reference_outside_synthetic_range": reference_outside,
        "reasons": reasons,
        "prohibited_automatic_actions": [
            "edit frozen YAML configuration",
            "lower event-volume gates",
            "copy events between splits",
            "promote a draft dataset",
        ],
    }


def _markdown_report(
    profile: dict[str, Any],
    events: dict[str, Any],
    scale: dict[str, Any],
) -> str:
    component_rows = "\n".join(
        f"| `{component.value}` | {events['counts_by_component'][component.value]} |"
        for component in ComponentKey
    )
    reasons = "\n".join(f"- {reason}" for reason in scale["reasons"])
    return f"""# Pilot profiling report — {profile["dataset_id"]}

Status: `draft`  
Analysis software: `{profile["analysis_software_version"]}`  
Decision: `{scale["decision"]}`  
Freeze ready: `{str(scale["freeze_ready"]).lower()}`

## Structural summary

| Metric | Value |
|---|---:|
| Machines | {profile["machine_count"]} |
| Telemetry rows | {profile["telemetry_row_count"]} |
| Parquet partitions | {profile["partition_count"]} |
| Duplicate timestamps | {profile["duplicate_timestamp_count"]} |
| Gaps | {profile["gap_count"]} |
| Independent events | {events["independent_event_count"]} |
| Censored events | {events["censored_event_count"]} |

## Events by component

| Component | Independent events |
|---|---:|
{component_rows}

## Scale decision

Recommended machines: `{json.dumps(scale["recommended_machine_count_by_split"], sort_keys=True)}`  
Recommended days per machine: `{scale["recommended_days_per_machine"]}`

{reasons}

## Interpretation boundary

This report validates a synthetic draft pilot. Preliminary 24 h/168 h window counts are
not the final Day-6/7 labels, and synthetic results do not establish industrial predictive
performance. Configuration changes require a separate human-approved, versioned step.
"""


def _publish_analysis(
    *,
    dataset_path: Path,
    output_root: Path,
    manifest: DatasetManifest,
    profile: dict[str, Any],
    events: dict[str, Any],
    scale: dict[str, Any],
) -> Path:
    final = output_root.resolve()
    staging = final.parent / f".{final.name}.tmp"
    if final.exists() or staging.exists():
        raise FileExistsError(f"analysis target or staging path already exists: {final}")
    staging.mkdir(parents=True)
    try:
        reports = {
            "profile_summary.json": canonical_json_bytes(profile) + b"\n",
            "event_analysis.json": canonical_json_bytes(events) + b"\n",
            "scale_decision.json": canonical_json_bytes(scale) + b"\n",
        }
        for name, content in reports.items():
            (staging / name).write_bytes(content)
        (staging / "profile_report.md").write_text(
            _markdown_report(profile, events, scale), encoding="utf-8", newline="\n"
        )
        artifacts = []
        for path in sorted(candidate for candidate in staging.iterdir() if candidate.is_file()):
            artifacts.append(
                {
                    "path": path.name,
                    "sha256": _sha256_file(path),
                    "size_bytes": path.stat().st_size,
                }
            )
        analysis_manifest = {
            "analysis_version": "1.0.0",
            "analysis_software_version": __version__,
            "dataset_id": manifest.dataset_id,
            "dataset_code_commit": manifest.code_commit,
            "dataset_generator_version": manifest.generator_version,
            "source_manifest_sha256": _sha256_file(
                dataset_path / "manifests" / "dataset_manifest.json"
            ),
            "artifacts": artifacts,
            "status": "draft",
        }
        (staging / "analysis_manifest.json").write_bytes(
            canonical_json_bytes(analysis_manifest) + b"\n"
        )
        checksum_lines = [
            f"{_sha256_file(path)}  {path.name}"
            for path in sorted(candidate for candidate in staging.iterdir() if candidate.is_file())
        ]
        (staging / "checksums.sha256").write_text(
            "\n".join(checksum_lines) + "\n", encoding="utf-8", newline="\n"
        )
        verification = verify_pilot_analysis(staging, dataset_path=dataset_path)
        if not verification.healthy:
            raise RuntimeError(
                "generated pilot analysis failed verification: " + "; ".join(verification.errors)
            )
        staging.replace(final)
    except Exception:
        # Preserve staging evidence for diagnosis. ``final`` cannot exist here:
        # the target is rejected up front and is only created by the final rename.
        raise
    return final


def verify_pilot_analysis(
    analysis_path: Path,
    *,
    dataset_path: Path | None = None,
) -> PilotAnalysisVerificationReport:
    """Verify checksums, report agreement, and optional source-dataset lineage."""

    root = analysis_path.resolve()
    errors: list[str] = []
    checked = 0
    dataset_id: str | None = None
    manifest: dict[str, Any] | None = None
    try:
        parsed = json.loads((root / "analysis_manifest.json").read_text(encoding="utf-8"))
        if not isinstance(parsed, dict):
            raise ValueError("analysis manifest must be an object")
        manifest = parsed
        value = parsed.get("dataset_id")
        dataset_id = value if isinstance(value, str) else None
    except (OSError, ValueError, json.JSONDecodeError) as error:
        errors.append(f"invalid analysis manifest: {error}")

    try:
        entries: dict[str, str] = {}
        for line_number, line in enumerate(
            (root / "checksums.sha256").read_text(encoding="utf-8").splitlines(), 1
        ):
            digest, separator, relative = line.partition("  ")
            candidate = Path(relative)
            if (
                not separator
                or len(digest) != 64
                or any(character not in "0123456789abcdef" for character in digest)
                or not relative
                or candidate.is_absolute()
                or ".." in candidate.parts
                or relative in entries
            ):
                raise ValueError(f"invalid checksum line {line_number}")
            entries[relative] = digest
        actual = {
            path.relative_to(root).as_posix()
            for path in root.rglob("*")
            if path.is_file() and path.name != "checksums.sha256"
        }
        if set(entries) != actual:
            errors.append("checksum file set does not match analysis files")
        for relative, expected in entries.items():
            candidate = root / relative
            if not candidate.is_file() or _sha256_file(candidate) != expected:
                errors.append(f"checksum mismatch: {relative}")
            else:
                checked += 1
    except (OSError, ValueError) as error:
        errors.append(f"invalid analysis checksums: {error}")

    reports: dict[str, dict[str, Any]] = {}
    for filename in ("profile_summary.json", "event_analysis.json", "scale_decision.json"):
        try:
            parsed_report = json.loads((root / filename).read_text(encoding="utf-8"))
            if not isinstance(parsed_report, dict):
                raise ValueError("report must be an object")
            reports[filename] = parsed_report
            if dataset_id is not None and parsed_report.get("dataset_id") != dataset_id:
                errors.append(f"dataset ID mismatch: {filename}")
        except (OSError, ValueError, json.JSONDecodeError) as error:
            errors.append(f"invalid {filename}: {error}")

    if manifest is not None:
        artifacts = manifest.get("artifacts")
        if not isinstance(artifacts, list):
            errors.append("analysis manifest artifacts must be a list")
        else:
            expected_artifacts = {
                "profile_summary.json",
                "event_analysis.json",
                "scale_decision.json",
                "profile_report.md",
            }
            artifact_paths = {item.get("path") for item in artifacts if isinstance(item, dict)}
            if artifact_paths != expected_artifacts:
                errors.append("analysis manifest artifact set is incomplete")
            for item in artifacts:
                if not isinstance(item, dict) or not isinstance(item.get("path"), str):
                    errors.append("analysis manifest contains an invalid artifact")
                    continue
                candidate = root / item["path"]
                if not candidate.is_file():
                    errors.append(f"analysis artifact is missing: {item['path']}")
                    continue
                if item.get("sha256") != _sha256_file(candidate):
                    errors.append(f"analysis manifest hash mismatch: {item['path']}")
                if item.get("size_bytes") != candidate.stat().st_size:
                    errors.append(f"analysis manifest size mismatch: {item['path']}")

    if dataset_path is not None and manifest is not None:
        source_manifest = dataset_path.resolve() / "manifests" / "dataset_manifest.json"
        if not source_manifest.is_file():
            errors.append("source dataset manifest is missing")
        elif manifest.get("source_manifest_sha256") != _sha256_file(source_manifest):
            errors.append("source dataset manifest hash mismatch")
        else:
            try:
                source = DatasetManifest.model_validate_json(source_manifest.read_bytes())
                if source.dataset_id != dataset_id:
                    errors.append("source dataset ID does not match analysis")
                if manifest.get("dataset_code_commit") != source.code_commit:
                    errors.append("source dataset commit does not match analysis")
            except (OSError, ValueError) as error:
                errors.append(f"invalid source dataset manifest: {error}")

    return PilotAnalysisVerificationReport(
        healthy=not errors,
        dataset_id=dataset_id,
        checked_file_count=checked,
        errors=tuple(errors),
    )


def analyze_pilot_dataset(
    *,
    dataset_path: Path,
    output_root: Path,
    reference_path: Path | None = None,
) -> PilotAnalysisReceipt:
    """Profile a verified draft dataset and publish a separate analysis package."""

    resolved_dataset = dataset_path.resolve()
    verification = verify_dataset(resolved_dataset)
    if not verification.healthy:
        raise ValueError("dataset verification failed: " + "; ".join(verification.errors))
    manifest = _read_manifest(resolved_dataset)
    assignments = _read_assignments(resolved_dataset, manifest)
    reference = load_real_machine_reference(reference_path) if reference_path else None
    telemetry = _read_telemetry(resolved_dataset)
    _validate_telemetry_identity(telemetry, assignments)
    profile, times_by_machine = _profile_dataset(
        dataset_path=resolved_dataset,
        manifest=manifest,
        table=telemetry,
        assignments=assignments,
        reference=reference,
    )
    event_table = pq.read_table(resolved_dataset / "ground_truth" / "events.parquet")
    events = _analyze_events(
        manifest=manifest,
        event_table=event_table,
        times_by_machine=times_by_machine,
        assignments=assignments,
    )
    scale = _decide_scale(
        dataset_path=resolved_dataset,
        manifest=manifest,
        profile=profile,
        events=events,
    )
    analysis_path = _publish_analysis(
        dataset_path=resolved_dataset,
        output_root=output_root,
        manifest=manifest,
        profile=profile,
        events=events,
        scale=scale,
    )
    return PilotAnalysisReceipt(
        analysis_path=analysis_path,
        healthy=True,
        profile=profile,
        events=events,
        scale_decision=scale,
    )


__all__ = [
    "PilotAnalysisReceipt",
    "PilotAnalysisVerificationReport",
    "RealMachineReference",
    "analyze_pilot_dataset",
    "load_real_machine_reference",
    "verify_pilot_analysis",
]
