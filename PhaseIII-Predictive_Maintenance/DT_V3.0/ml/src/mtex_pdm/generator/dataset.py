"""Deterministic Parquet materialization for synthetic historical datasets."""

from __future__ import annotations

import hashlib
import json
import re
import shutil
from collections import Counter, defaultdict
from dataclasses import dataclass
from datetime import UTC, date, datetime, timedelta
from pathlib import Path
from typing import Any
from urllib.parse import quote

import pyarrow as pa
import pyarrow.parquet as pq
import yaml
from pydantic import ValidationError

from mtex_pdm import __version__
from mtex_pdm.config_validation import CONFIG_FILENAMES, validate_frozen_config
from mtex_pdm.contracts import (
    ATTRIBUTE_UNITS,
    MAINTENANCE_EVENT_ARROW_SCHEMA,
    TELEMETRY_ARROW_SCHEMA,
    ArtifactFile,
    ArtifactStatus,
    ComponentKey,
    DatasetManifest,
    DatasetSplit,
    DatasetSplitSummary,
    DataSource,
    MaintenanceEvent,
    TelemetryRecord,
    arrow_schema_descriptor,
    artifact_file,
    canonical_json_bytes,
    canonical_sha256,
)
from mtex_pdm.generator.behavior import MachineBehavior
from mtex_pdm.generator.engine import GeneratorEngine, derive_machine_seed
from mtex_pdm.generator.events import assemble_maintenance_events
from mtex_pdm.generator.models import (
    GenerationConfig,
    GenerationMode,
    GenerationSummary,
    GroundTruthEvent,
    GroundTruthSnapshot,
    MachineSimulationSpec,
    TelemetrySnapshot,
)

_DATASET_ID = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$")
_CHECKSUM_LINE = re.compile(r"^(?P<digest>[0-9a-f]{64})  (?P<path>[^\\]+)$")
_PARQUET_OPTIONS: dict[str, Any] = {
    "compression": "zstd",
    "compression_level": 3,
    "data_page_version": "1.0",
    "use_dictionary": False,
    "version": "2.6",
    "write_statistics": True,
}


@dataclass(frozen=True, slots=True)
class DatasetGenerationReceipt:
    """Published dataset path and its validated identity documents."""

    dataset_path: Path
    manifest: DatasetManifest
    report: dict[str, Any]


@dataclass(frozen=True, slots=True)
class DatasetVerificationReport:
    """Read-only integrity and semantic verification result."""

    healthy: bool
    dataset_id: str | None
    checked_file_count: int
    telemetry_row_count: int
    maintenance_event_count: int
    errors: tuple[str, ...]


def _sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _arrow_payload(record: TelemetryRecord | MaintenanceEvent) -> dict[str, Any]:
    payload = record.model_dump(mode="python")
    for key, value in tuple(payload.items()):
        if hasattr(value, "value"):
            payload[key] = value.value
    return payload


def _write_parquet(path: Path, table: pa.Table) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    pq.write_table(
        table,
        path,
        row_group_size=max(1, min(table.num_rows, 4096)),
        **_PARQUET_OPTIONS,
    )


def _read_parquet_file(path: Path) -> pa.Table:
    return pq.ParquetFile(path).read()


class ParquetDatasetOutput:
    """Generator output that keeps at most one UTC day of telemetry per machine."""

    def __init__(self, *, output_root: Path, dataset_id: str) -> None:
        if _DATASET_ID.fullmatch(dataset_id) is None:
            raise ValueError("dataset_id must be a safe portable directory name")
        output_root.mkdir(parents=True, exist_ok=True)
        self.dataset_id = dataset_id
        self.final_path = output_root / dataset_id
        self.staging_path = output_root / f".{dataset_id}.tmp"
        if self.final_path.exists() or self.staging_path.exists():
            raise FileExistsError(
                f"dataset target or staging path already exists for {dataset_id!r}"
            )
        self.staging_path.mkdir()
        self._active_dates: dict[str, date] = {}
        self._buffers: dict[str, list[TelemetryRecord]] = defaultdict(list)
        self._events: list[GroundTruthEvent] = []
        self._ground_truth_count = 0
        self._ground_truth_identity: dict[str, tuple[str, int]] = {}
        self._transition_sha256: str | None = None
        self._row_count_by_split: Counter[DatasetSplit] = Counter()
        self._row_count_by_machine: Counter[str] = Counter()
        self._partition_rows: dict[str, int] = {}
        self._missing_values: Counter[str] = Counter()
        self._last_timestamp: dict[str, datetime] = {}
        self._duplicate_timestamp_count = 0

    @property
    def ground_truth_count(self) -> int:
        return self._ground_truth_count

    @property
    def runtime_events(self) -> tuple[GroundTruthEvent, ...]:
        return tuple(self._events)

    @property
    def row_count_by_split(self) -> Counter[DatasetSplit]:
        return self._row_count_by_split.copy()

    @property
    def row_count_by_machine(self) -> Counter[str]:
        return self._row_count_by_machine.copy()

    @property
    def partition_rows(self) -> dict[str, int]:
        return dict(self._partition_rows)

    @property
    def missing_values(self) -> Counter[str]:
        return self._missing_values.copy()

    @property
    def duplicate_timestamp_count(self) -> int:
        return self._duplicate_timestamp_count

    def emit_telemetry(self, snapshot: TelemetrySnapshot) -> None:
        numeric = {
            signal.name: float(signal.value) for signal in snapshot.observable.numeric_signals
        }
        record = TelemetryRecord.model_validate(
            {
                "machine_id": snapshot.machine_id,
                "time_index": snapshot.time_index,
                "data_source": snapshot.data_source,
                "split": snapshot.split,
                "iamalive": snapshot.observable.iamalive,
                **numeric,
            }
        )
        machine_id = record.machine_id
        partition_date = record.time_index.astimezone(UTC).date()
        active_date = self._active_dates.get(machine_id)
        if active_date is not None and partition_date < active_date:
            raise ValueError(f"telemetry for {machine_id!r} moved to an earlier UTC partition")
        if active_date is not None and partition_date > active_date:
            self._flush_machine(machine_id)
        self._active_dates[machine_id] = partition_date
        self._buffers[machine_id].append(record)
        self._row_count_by_split[record.split] += 1
        self._row_count_by_machine[machine_id] += 1
        previous = self._last_timestamp.get(machine_id)
        if previous is not None and record.time_index == previous:
            self._duplicate_timestamp_count += 1
        if previous is not None and record.time_index < previous:
            raise ValueError(f"telemetry for {machine_id!r} is not time ordered")
        self._last_timestamp[machine_id] = record.time_index
        for field_name, value in record.model_dump(mode="python").items():
            if value is None:
                self._missing_values[field_name] += 1

    def emit_ground_truth(self, snapshot: GroundTruthSnapshot) -> None:
        identity = (snapshot.scenario_id, snapshot.machine_seed)
        previous = self._ground_truth_identity.setdefault(snapshot.machine_id, identity)
        if previous != identity:
            raise ValueError(f"ground-truth provenance changed for {snapshot.machine_id!r}")
        self._ground_truth_count += 1

    def emit_event(self, event: GroundTruthEvent) -> None:
        self._events.append(event)

    def bind_transition(self, transition_sha256: str) -> None:
        if self._transition_sha256 is not None and self._transition_sha256 != transition_sha256:
            raise ValueError("one dataset output cannot mix different generator transitions")
        self._transition_sha256 = transition_sha256

    def close_telemetry(self) -> None:
        for machine_id in sorted(tuple(self._buffers)):
            self._flush_machine(machine_id)

    def finalize(
        self,
        *,
        config: GenerationConfig,
        behavior: MachineBehavior,
        code_commit: str,
        created_at: datetime,
        config_directory: Path,
    ) -> DatasetGenerationReceipt:
        """Validate and atomically publish every stream emitted to this output."""

        if config.step_seconds % 60 != 0:
            raise ValueError("dataset generation requires a whole-minute step")
        if config.mode is not GenerationMode.OFFLINE:
            raise ValueError("Parquet historical datasets require offline generation mode")
        if created_at.tzinfo is None or created_at.utcoffset() is None:
            raise ValueError("created_at must include a timezone")
        expected_ticks = int((config.end_at - config.start_at).total_seconds()) // (
            config.step_seconds
        )
        expected_ground_truth = expected_ticks * len(config.machines)
        if self.ground_truth_count != expected_ground_truth:
            raise ValueError(
                "incomplete generator run cannot be finalized: "
                f"expected {expected_ground_truth} ground-truth snapshots, "
                f"received {self.ground_truth_count}"
            )
        expected_identity = {
            machine.machine_id: (
                machine.scenario_id,
                derive_machine_seed(
                    config.master_seed,
                    machine.machine_id,
                    machine.scenario_id,
                ),
            )
            for machine in config.machines
        }
        if self._ground_truth_identity != expected_identity:
            raise ValueError("observed generator provenance does not match finalization config")
        if self._transition_sha256 != behavior.fingerprint:
            raise ValueError("observed transition provenance does not match finalization behavior")
        self.close_telemetry()
        events = _write_events(
            self.staging_path,
            self.runtime_events,
            finalize_at=config.end_at,
        )
        config_checksums = _copy_effective_config(
            staging_path=self.staging_path,
            config_directory=config_directory.resolve(),
            config=config,
            behavior=behavior,
        )
        summary = GenerationSummary(
            tick_count=self.ground_truth_count // len(config.machines),
            machine_count=len(config.machines),
            telemetry_snapshot_count=sum(self.row_count_by_split.values()),
            ground_truth_snapshot_count=self.ground_truth_count,
            ground_truth_event_count=len(self.runtime_events),
            next_time_index=None,
        )
        report = _write_report(
            staging_path=self.staging_path,
            dataset_id=self.dataset_id,
            summary=summary,
            output=self,
            events=events,
        )
        artifacts = _artifacts_before_manifest(
            self.staging_path,
            self.partition_rows,
            len(events),
        )
        event_counts = _event_counts(events)
        machines_by_split = {
            split: tuple(
                machine.machine_id for machine in config.machines if machine.split is split
            )
            for split in (DatasetSplit.TRAIN, DatasetSplit.VALIDATION, DatasetSplit.TEST)
        }
        manifest = DatasetManifest(
            dataset_id=self.dataset_id,
            generator_version=__version__,
            code_commit=code_commit,
            created_at=created_at,
            master_seed=config.master_seed,
            start_time=config.start_at,
            end_time=config.end_at,
            resample_minutes=config.step_seconds // 60,
            splits={
                split: DatasetSplitSummary(
                    machine_ids=machines_by_split[split],
                    row_count=self.row_count_by_split[split],
                    event_count_by_component=event_counts[split],
                )
                for split in (DatasetSplit.TRAIN, DatasetSplit.VALIDATION, DatasetSplit.TEST)
            },
            scenarios=tuple(sorted({machine.scenario_id for machine in config.machines})),
            units={"time_index": "UTC", **ATTRIBUTE_UNITS},
            schema_hashes={
                "telemetry": canonical_sha256(arrow_schema_descriptor(TELEMETRY_ARROW_SCHEMA)),
                "maintenance_events": canonical_sha256(
                    arrow_schema_descriptor(MAINTENANCE_EVENT_ARROW_SCHEMA)
                ),
            },
            config_checksums=config_checksums,
            files=artifacts,
            status=ArtifactStatus.DRAFT,
        )
        manifest_path = self.staging_path / "manifests" / "dataset_manifest.json"
        manifest_path.parent.mkdir(parents=True, exist_ok=True)
        manifest_path.write_bytes(canonical_json_bytes(manifest) + b"\n")
        _write_checksums(self.staging_path)

        verification = verify_dataset(self.staging_path)
        if not verification.healthy:
            raise RuntimeError(
                "generated dataset failed verification: " + "; ".join(verification.errors)
            )
        self.staging_path.replace(self.final_path)
        return DatasetGenerationReceipt(
            dataset_path=self.final_path,
            manifest=manifest,
            report=report,
        )

    def _flush_machine(self, machine_id: str) -> None:
        records = self._buffers.pop(machine_id, [])
        if not records:
            return
        partition_date = self._active_dates[machine_id]
        encoded_machine = quote(machine_id, safe="-._")
        relative = Path(
            "telemetry",
            f"machine={encoded_machine}",
            f"date={partition_date.isoformat()}",
            "part-00000.parquet",
        )
        path = self.staging_path / relative
        if path.exists():
            raise ValueError(f"duplicate telemetry partition: {relative.as_posix()}")
        table = pa.Table.from_pylist(
            [_arrow_payload(record) for record in records],
            schema=TELEMETRY_ARROW_SCHEMA,
        )
        _write_parquet(path, table)
        self._partition_rows[relative.as_posix()] = table.num_rows


def _copy_effective_config(
    *,
    staging_path: Path,
    config_directory: Path,
    config: GenerationConfig,
    behavior: MachineBehavior,
) -> dict[str, str]:
    validate_frozen_config(config_directory)
    destination = staging_path / "configs"
    destination.mkdir(parents=True, exist_ok=True)
    checksums: dict[str, str] = {}
    for filename in CONFIG_FILENAMES:
        source = config_directory / filename
        target = destination / filename
        shutil.copyfile(source, target)
        checksums[filename] = _sha256_file(target)

    effective = {
        "generator_version": __version__,
        "generation": config.model_dump(mode="json"),
        "behavior_fingerprint": behavior.fingerprint,
        "behavior_parameters": behavior.parameters.model_dump(mode="json"),
        "parquet": {
            **_PARQUET_OPTIONS,
            "partitioning": ["machine", "date"],
            "rows_per_file": "one_utc_day_per_machine",
        },
    }
    (destination / "generator.yaml").write_text(
        yaml.safe_dump(effective, allow_unicode=True, sort_keys=True),
        encoding="utf-8",
        newline="\n",
    )
    assignments = [
        {
            "data_source": machine.data_source.value,
            "machine_id": machine.machine_id,
            "machine_seed": derive_machine_seed(
                config.master_seed,
                machine.machine_id,
                machine.scenario_id,
            ),
            "scenario_id": machine.scenario_id,
            "split": machine.split.value,
        }
        for machine in config.machines
    ]
    (destination / "scenario_assignments.json").write_bytes(
        canonical_json_bytes(assignments) + b"\n"
    )
    return checksums


def _write_events(
    staging_path: Path,
    runtime_events: tuple[GroundTruthEvent, ...],
    *,
    finalize_at: datetime,
) -> tuple[MaintenanceEvent, ...]:
    events = assemble_maintenance_events(runtime_events, finalize_at=finalize_at)
    table = pa.Table.from_pylist(
        [_arrow_payload(event) for event in events],
        schema=MAINTENANCE_EVENT_ARROW_SCHEMA,
    )
    _write_parquet(staging_path / "ground_truth" / "events.parquet", table)
    return events


def _artifact_role(path: Path) -> str:
    relative = path.as_posix()
    if relative.startswith("telemetry/"):
        return "telemetry_partition"
    if relative == "ground_truth/events.parquet":
        return "maintenance_events"
    if relative == "reports/generation_report.json":
        return "generation_report"
    if relative.endswith("scenario_assignments.json"):
        return "scenario_assignments"
    return "generation_config"


def _artifacts_before_manifest(
    staging_path: Path,
    partition_rows: dict[str, int],
    event_count: int,
) -> tuple[ArtifactFile, ...]:
    artifacts: list[ArtifactFile] = []
    for path in sorted(candidate for candidate in staging_path.rglob("*") if candidate.is_file()):
        relative = path.relative_to(staging_path)
        row_count: int | None = None
        if relative.as_posix() in partition_rows:
            row_count = partition_rows[relative.as_posix()]
        elif relative.as_posix() == "ground_truth/events.parquet":
            row_count = event_count
        media_type = (
            "application/vnd.apache.parquet"
            if path.suffix == ".parquet"
            else ("application/yaml" if path.suffix in {".yaml", ".yml"} else "application/json")
        )
        artifacts.append(
            artifact_file(
                path,
                root=staging_path,
                media_type=media_type,
                role=_artifact_role(relative),
                row_count=row_count,
            )
        )
    return tuple(artifacts)


def _event_counts(
    events: tuple[MaintenanceEvent, ...],
) -> dict[DatasetSplit, dict[ComponentKey, int]]:
    result = {
        split: {component: 0 for component in ComponentKey}
        for split in (DatasetSplit.TRAIN, DatasetSplit.VALIDATION, DatasetSplit.TEST)
    }
    for event in events:
        if event.split in result:
            result[event.split][event.component_key] += 1
    return result


def _write_report(
    *,
    staging_path: Path,
    dataset_id: str,
    summary: GenerationSummary,
    output: ParquetDatasetOutput,
    events: tuple[MaintenanceEvent, ...],
) -> dict[str, Any]:
    event_counts = _event_counts(events)
    telemetry_paths = sorted((staging_path / "telemetry").rglob("*.parquet"))
    event_path = staging_path / "ground_truth" / "events.parquet"
    report: dict[str, Any] = {
        "dataset_id": dataset_id,
        "generator_version": __version__,
        "status": ArtifactStatus.DRAFT.value,
        "tick_count": summary.tick_count,
        "machine_count": summary.machine_count,
        "telemetry_row_count": summary.telemetry_snapshot_count,
        "ground_truth_snapshot_count": summary.ground_truth_snapshot_count,
        "runtime_event_marker_count": summary.ground_truth_event_count,
        "maintenance_event_count": len(events),
        "censored_event_count": sum(event.censored for event in events),
        "partition_count": len(output.partition_rows),
        "telemetry_size_bytes": sum(path.stat().st_size for path in telemetry_paths),
        "maintenance_events_size_bytes": event_path.stat().st_size,
        "row_count_by_machine": dict(sorted(output.row_count_by_machine.items())),
        "row_count_by_split": {
            split.value: output.row_count_by_split[split]
            for split in (DatasetSplit.TRAIN, DatasetSplit.VALIDATION, DatasetSplit.TEST)
        },
        "event_count_by_split_and_component": {
            split.value: {component.value: count for component, count in counts.items()}
            for split, counts in event_counts.items()
        },
        "missing_value_count": dict(sorted(output.missing_values.items())),
        "duplicate_timestamp_count": output.duplicate_timestamp_count,
        "limitations": [
            "pilot physical ranges and source-native units remain unconfirmed",
            "draft datasets do not assert the final 100/30/30 event-volume gate",
            "synthetic results do not establish industrial predictive performance",
        ],
    }
    report_path = staging_path / "reports" / "generation_report.json"
    report_path.parent.mkdir(parents=True, exist_ok=True)
    report_path.write_bytes(canonical_json_bytes(report) + b"\n")
    return report


def _write_checksums(staging_path: Path) -> None:
    path = staging_path / "manifests" / "checksums.sha256"
    entries = []
    for candidate in sorted(file for file in staging_path.rglob("*") if file.is_file()):
        if candidate == path:
            continue
        relative = candidate.relative_to(staging_path).as_posix()
        entries.append(f"{_sha256_file(candidate)}  {relative}")
    path.write_text("\n".join(entries) + "\n", encoding="utf-8", newline="\n")


def generate_synthetic_dataset(
    *,
    output_root: Path,
    dataset_id: str,
    config: GenerationConfig,
    behavior: MachineBehavior,
    code_commit: str,
    created_at: datetime,
    config_directory: Path,
) -> DatasetGenerationReceipt:
    """Generate, validate, and atomically publish one deterministic draft dataset."""

    output = ParquetDatasetOutput(output_root=output_root, dataset_id=dataset_id)
    GeneratorEngine(config, transition=behavior).run(output)
    return output.finalize(
        config=config,
        behavior=behavior,
        code_commit=code_commit,
        created_at=created_at,
        config_directory=config_directory,
    )


def generate_pilot_dataset(
    *,
    output_root: Path,
    dataset_id: str,
    code_commit: str,
    start_date: date,
    days: int,
    created_at: datetime,
    config_directory: Path,
    master_seed: int = 20260729,
) -> DatasetGenerationReceipt:
    """Generate the small three-machine draft used before the full historical freeze."""

    if days <= 0:
        raise ValueError("pilot days must be positive")
    start_at = datetime.combine(start_date, datetime.min.time(), tzinfo=UTC)
    machines = tuple(
        MachineSimulationSpec(
            machine_id=f"synthetic-{split.value}-pilot-01",
            scenario_id=scenario,
            data_source=DataSource.SYNTHETIC_HISTORICAL,
            split=split,
        )
        for split, scenario in (
            (DatasetSplit.TRAIN, "normal_operation"),
            (DatasetSplit.VALIDATION, "high_production"),
            (DatasetSplit.TEST, "intermittent_operation"),
        )
    )
    config = GenerationConfig(
        mode=GenerationMode.OFFLINE,
        start_at=start_at,
        end_at=start_at + timedelta(days=days),
        step_seconds=300,
        master_seed=master_seed,
        machines=machines,
    )
    return generate_synthetic_dataset(
        output_root=output_root,
        dataset_id=dataset_id,
        config=config,
        behavior=MachineBehavior(),
        code_commit=code_commit,
        created_at=created_at,
        config_directory=config_directory,
    )


def _read_checksum_entries(path: Path) -> dict[str, str]:
    entries: dict[str, str] = {}
    for line_number, raw_line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
        match = _CHECKSUM_LINE.fullmatch(raw_line)
        if match is None:
            raise ValueError(f"invalid checksum line {line_number}")
        relative = match.group("path")
        candidate = Path(relative)
        if candidate.is_absolute() or ".." in candidate.parts or relative in entries:
            raise ValueError(f"unsafe or duplicate checksum path at line {line_number}")
        entries[relative] = match.group("digest")
    return entries


def verify_dataset(dataset_path: Path) -> DatasetVerificationReport:
    """Verify checksums, persisted contracts, schemas, partitions, and manifest counts."""

    errors: list[str] = []
    dataset_id: str | None = None
    manifest: DatasetManifest | None = None
    checked_files = 0
    telemetry_rows = 0
    maintenance_events = 0
    row_count_by_artifact: dict[str, int] = {}
    machines_by_split: dict[DatasetSplit, set[str]] = defaultdict(set)
    root = dataset_path.resolve()

    try:
        manifest_path = root / "manifests" / "dataset_manifest.json"
        manifest = DatasetManifest.model_validate_json(manifest_path.read_bytes())
        dataset_id = manifest.dataset_id
    except (OSError, ValidationError, ValueError) as error:
        errors.append(f"invalid dataset manifest: {error}")

    try:
        checksum_path = root / "manifests" / "checksums.sha256"
        checksum_entries = _read_checksum_entries(checksum_path)
        actual_paths = {
            path.relative_to(root).as_posix()
            for path in root.rglob("*")
            if path.is_file() and path != checksum_path
        }
        if set(checksum_entries) != actual_paths:
            errors.append("checksum file set does not match dataset files")
        for relative, expected in checksum_entries.items():
            candidate = root / Path(relative)
            if not candidate.is_file() or _sha256_file(candidate) != expected:
                errors.append(f"checksum mismatch: {relative}")
            else:
                checked_files += 1
    except (OSError, ValueError) as error:
        errors.append(f"invalid checksum manifest: {error}")

    row_count_by_split: Counter[DatasetSplit] = Counter()
    telemetry_files = sorted((root / "telemetry").rglob("*.parquet"))
    for path in telemetry_files:
        try:
            table = _read_parquet_file(path)
            if not table.schema.equals(TELEMETRY_ARROW_SCHEMA, check_metadata=True):
                errors.append(f"telemetry schema mismatch: {path.relative_to(root).as_posix()}")
                continue
            telemetry_rows += table.num_rows
            relative_path = path.relative_to(root).as_posix()
            row_count_by_artifact[relative_path] = table.num_rows
            payloads = table.to_pylist()
            for payload in payloads:
                record = TelemetryRecord.model_validate(payload)
                row_count_by_split[record.split] += 1
                machines_by_split[record.split].add(record.machine_id)
                expected_machine = f"machine={quote(record.machine_id, safe='-._')}"
                expected_date = f"date={record.time_index.astimezone(UTC).date().isoformat()}"
                parts = path.relative_to(root).parts
                if expected_machine not in parts or expected_date not in parts:
                    errors.append(f"telemetry row is in the wrong partition: {record.machine_id}")
                    break
        except (OSError, ValidationError, ValueError, pa.ArrowException) as error:
            errors.append(f"invalid telemetry file {path.relative_to(root).as_posix()}: {error}")

    event_count_by_split = _event_counts(())
    event_path = root / "ground_truth" / "events.parquet"
    try:
        event_table = _read_parquet_file(event_path)
        if not event_table.schema.equals(MAINTENANCE_EVENT_ARROW_SCHEMA, check_metadata=True):
            errors.append("maintenance-event schema mismatch")
        else:
            parsed_events = tuple(
                MaintenanceEvent.model_validate(payload) for payload in event_table.to_pylist()
            )
            maintenance_events = len(parsed_events)
            row_count_by_artifact["ground_truth/events.parquet"] = maintenance_events
            if len({event.event_id for event in parsed_events}) != len(parsed_events):
                errors.append("maintenance event IDs are not unique")
            event_count_by_split = _event_counts(parsed_events)
    except (OSError, ValidationError, ValueError, pa.ArrowException) as error:
        errors.append(f"invalid maintenance-event file: {error}")

    if manifest is not None:
        manifest_paths = {artifact.path for artifact in manifest.files}
        expected_manifest_paths = {
            path.relative_to(root).as_posix()
            for path in root.rglob("*")
            if path.is_file()
            and path.relative_to(root).as_posix()
            not in {"manifests/dataset_manifest.json", "manifests/checksums.sha256"}
        }
        if manifest_paths != expected_manifest_paths:
            errors.append("manifest artifact set does not match generated artifacts")
        for artifact in manifest.files:
            candidate = root / Path(artifact.path)
            if not candidate.is_file():
                errors.append(f"manifest artifact is missing: {artifact.path}")
                continue
            if _sha256_file(candidate) != artifact.sha256:
                errors.append(f"manifest artifact hash mismatch: {artifact.path}")
            if candidate.stat().st_size != artifact.size_bytes:
                errors.append(f"manifest artifact size mismatch: {artifact.path}")
            if (
                artifact.row_count is not None
                and row_count_by_artifact.get(artifact.path) != artifact.row_count
            ):
                errors.append(f"manifest artifact row count mismatch: {artifact.path}")
        for split, split_summary in manifest.splits.items():
            if split_summary.row_count != row_count_by_split[split]:
                errors.append(f"manifest row count mismatch for {split.value}")
            if set(split_summary.machine_ids) != machines_by_split[split]:
                errors.append(f"manifest machine set mismatch for {split.value}")
            if split_summary.event_count_by_component != event_count_by_split[split]:
                errors.append(f"manifest event count mismatch for {split.value}")
        expected_schema_hashes = {
            "telemetry": canonical_sha256(arrow_schema_descriptor(TELEMETRY_ARROW_SCHEMA)),
            "maintenance_events": canonical_sha256(
                arrow_schema_descriptor(MAINTENANCE_EVENT_ARROW_SCHEMA)
            ),
        }
        if manifest.schema_hashes != expected_schema_hashes:
            errors.append("manifest schema hashes do not match current contracts")
        actual_config_checksums = {
            filename: _sha256_file(root / "configs" / filename)
            for filename in CONFIG_FILENAMES
            if (root / "configs" / filename).is_file()
        }
        if manifest.config_checksums != actual_config_checksums:
            errors.append("manifest config checksums do not match copied configs")
        try:
            assignments = json.loads(
                (root / "configs" / "scenario_assignments.json").read_text(encoding="utf-8")
            )
            assignment_machines = {item["machine_id"] for item in assignments}
            manifest_machines = {
                machine_id
                for summary in manifest.splits.values()
                for machine_id in summary.machine_ids
            }
            if len(assignments) != len(assignment_machines) or (
                assignment_machines != manifest_machines
            ):
                errors.append("scenario assignments do not match manifest machines")
            if {item["scenario_id"] for item in assignments} != set(manifest.scenarios):
                errors.append("scenario assignments do not match manifest scenarios")
            if any(not isinstance(item.get("machine_seed"), int) for item in assignments):
                errors.append("scenario assignments are missing derived machine seeds")
        except (OSError, TypeError, ValueError, KeyError, json.JSONDecodeError) as error:
            errors.append(f"invalid scenario assignments: {error}")
        try:
            report = json.loads(
                (root / "reports" / "generation_report.json").read_text(encoding="utf-8")
            )
            if report.get("dataset_id") != manifest.dataset_id:
                errors.append("generation report dataset ID does not match manifest")
            if report.get("telemetry_row_count") != telemetry_rows:
                errors.append("generation report telemetry count does not match files")
            if report.get("maintenance_event_count") != maintenance_events:
                errors.append("generation report event count does not match files")
        except (OSError, ValueError, json.JSONDecodeError) as error:
            errors.append(f"invalid generation report: {error}")

    return DatasetVerificationReport(
        healthy=not errors,
        dataset_id=dataset_id,
        checked_file_count=checked_files,
        telemetry_row_count=telemetry_rows,
        maintenance_event_count=maintenance_events,
        errors=tuple(errors),
    )


__all__ = [
    "DatasetGenerationReceipt",
    "DatasetVerificationReport",
    "ParquetDatasetOutput",
    "generate_pilot_dataset",
    "generate_synthetic_dataset",
    "verify_dataset",
]
