from __future__ import annotations

import json
import subprocess
import sys
from datetime import UTC, datetime, timedelta
from pathlib import Path

import pyarrow as pa
import pyarrow.dataset as ds
import pyarrow.parquet as pq
import pytest
from pydantic import ValidationError

from mtex_pdm.contracts import (
    MAINTENANCE_EVENT_ARROW_SCHEMA,
    TELEMETRY_ARROW_SCHEMA,
    ArtifactStatus,
    DatasetSplit,
    DataSource,
)
from mtex_pdm.generator import (
    BehaviorParameters,
    DatasetGenerationReceipt,
    GenerationConfig,
    GenerationMode,
    GeneratorEngine,
    MachineBehavior,
    MachineSimulationSpec,
    MachineState,
    NumericSignal,
    ObservableMachineState,
    ParquetDatasetOutput,
    generate_synthetic_dataset,
    verify_dataset,
)

ML_ROOT = Path(__file__).resolve().parents[1]
FIXTURE_COMMIT = "0123456789abcdef0123456789abcdef01234567"


def _pilot_config(*, days: int = 1, seed: int = 20260729) -> GenerationConfig:
    start_at = datetime(2026, 1, 1, 23, 55, tzinfo=UTC)
    machines = tuple(
        MachineSimulationSpec(
            machine_id=f"synthetic-{split.value}-01",
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
    return GenerationConfig(
        mode=GenerationMode.OFFLINE,
        start_at=start_at,
        end_at=start_at + timedelta(days=days, minutes=15),
        step_seconds=300,
        master_seed=seed,
        machines=machines,
    )


def test_dataset_output_round_trips_partitioned_telemetry_and_events(tmp_path: Path) -> None:
    receipt = generate_synthetic_dataset(
        output_root=tmp_path,
        dataset_id="pilot-round-trip",
        config=_pilot_config(days=0),
        behavior=MachineBehavior(),
        code_commit=FIXTURE_COMMIT,
        created_at=datetime(2026, 8, 12, 12, 0, tzinfo=UTC),
        config_directory=ML_ROOT / "config",
    )

    telemetry = ds.dataset(
        receipt.dataset_path / "telemetry",
        format="parquet",
    ).to_table()
    events = pq.read_table(receipt.dataset_path / "ground_truth" / "events.parquet")

    assert telemetry.num_rows == 9
    assert telemetry.schema.equals(TELEMETRY_ARROW_SCHEMA, check_metadata=True)
    assert not {
        "hidden_degradation",
        "synthetic_cause",
        "scenario_id",
        "simulator_seed",
        "event_id",
    }.intersection(telemetry.column_names)
    assert events.num_rows == 0
    assert events.schema.equals(MAINTENANCE_EVENT_ARROW_SCHEMA, check_metadata=True)
    assert len(tuple((receipt.dataset_path / "telemetry").rglob("*.parquet"))) == 6
    assert receipt.manifest.status is ArtifactStatus.DRAFT
    assert receipt.manifest.machine_profile == "TPPPS4"
    assert receipt.manifest.print_architecture == "multipass"
    assert receipt.manifest.telemetry_catalog_version == "1.0.0"
    assert receipt.manifest.synthetic_assumptions == (
        "print_bar_effective_motion_is_time_compressed",
        "condition_events_are_synthetic_and_anchored_to_official_maxima",
        "momentary_enterprise_snapshot_does_not_calibrate_distributions",
    )
    assert {split: summary.row_count for split, summary in receipt.manifest.splits.items()} == {
        DatasetSplit.TRAIN: 3,
        DatasetSplit.VALIDATION: 3,
        DatasetSplit.TEST: 3,
    }
    assert verify_dataset(receipt.dataset_path).healthy


def test_dataset_generation_rejects_behavior_maxima_that_diverge_from_catalog(
    tmp_path: Path,
) -> None:
    behavior = MachineBehavior(BehaviorParameters(print_bar_calendar_maximum=91.0))

    with pytest.raises(ValueError, match="behavior maxima do not match frozen TPPPS4 catalog"):
        generate_synthetic_dataset(
            output_root=tmp_path,
            dataset_id="pilot-mismatched-maxima",
            config=_pilot_config(days=0),
            behavior=behavior,
            code_commit=FIXTURE_COMMIT,
            created_at=datetime(2026, 8, 12, 12, 0, tzinfo=UTC),
            config_directory=ML_ROOT / "config",
        )

    assert not (tmp_path / "pilot-mismatched-maxima").exists()


def _dataset_bytes(dataset_path: Path) -> dict[str, bytes]:
    return {
        path.relative_to(dataset_path).as_posix(): path.read_bytes()
        for path in dataset_path.rglob("*")
        if path.is_file()
    }


def _generate_fixture_dataset(
    output_root: Path,
    config: GenerationConfig,
    behavior: MachineBehavior,
) -> DatasetGenerationReceipt:
    return generate_synthetic_dataset(
        output_root=output_root,
        dataset_id="pilot-reproducible",
        config=config,
        behavior=behavior,
        code_commit=FIXTURE_COMMIT,
        created_at=datetime(2026, 8, 12, 12, 0, tzinfo=UTC),
        config_directory=ML_ROOT / "config",
    )


def test_repeated_and_checkpoint_resumed_runs_produce_identical_packages(
    tmp_path: Path,
) -> None:
    config = _pilot_config(days=1)
    behavior = MachineBehavior()
    first = _generate_fixture_dataset(tmp_path / "first", config, behavior)
    repeated = _generate_fixture_dataset(tmp_path / "repeated", config, behavior)

    resumed_output = ParquetDatasetOutput(
        output_root=tmp_path / "resumed",
        dataset_id="pilot-reproducible",
    )
    first_engine = GeneratorEngine(config, transition=behavior)
    first_engine.run(resumed_output, max_ticks=37)
    checkpoint = first_engine.checkpoint()
    GeneratorEngine.from_checkpoint(config, checkpoint, transition=behavior).run(resumed_output)
    resumed = resumed_output.finalize(
        config=config,
        behavior=behavior,
        code_commit=FIXTURE_COMMIT,
        created_at=datetime(2026, 8, 12, 12, 0, tzinfo=UTC),
        config_directory=ML_ROOT / "config",
    )

    assert _dataset_bytes(first.dataset_path) == _dataset_bytes(repeated.dataset_path)
    assert _dataset_bytes(first.dataset_path) == _dataset_bytes(resumed.dataset_path)


def _eventful_config() -> GenerationConfig:
    start_at = datetime(2026, 1, 5, 8, 0, tzinfo=UTC)
    machines = tuple(
        MachineSimulationSpec(
            machine_id=f"synthetic-{split.value}-event-01",
            scenario_id="normal_operation",
            data_source=DataSource.SYNTHETIC_HISTORICAL,
            split=split,
            initial_state=MachineState(
                observable=ObservableMachineState(
                    numeric_signals=(
                        NumericSignal(name="print_bar_time_since_last_pm", value=89.99),
                    )
                )
            ),
        )
        for split in (DatasetSplit.TRAIN, DatasetSplit.VALIDATION, DatasetSplit.TEST)
    )
    return GenerationConfig(
        mode=GenerationMode.OFFLINE,
        start_at=start_at,
        end_at=start_at + timedelta(hours=2),
        step_seconds=3600,
        master_seed=20260729,
        machines=machines,
    )


def test_finalization_writes_independent_events_and_matching_manifest_counts(
    tmp_path: Path,
) -> None:
    receipt = generate_synthetic_dataset(
        output_root=tmp_path,
        dataset_id="pilot-events",
        config=_eventful_config(),
        behavior=MachineBehavior(
            BehaviorParameters(
                planned_delay_min_hours=1,
                planned_delay_max_hours=1,
            )
        ),
        code_commit=FIXTURE_COMMIT,
        created_at=datetime(2026, 8, 12, 12, 0, tzinfo=UTC),
        config_directory=ML_ROOT / "config",
    )

    events = pq.read_table(receipt.dataset_path / "ground_truth" / "events.parquet")
    assert events.num_rows == 3
    assert events.column("censored").to_pylist() == [False, False, False]
    assert set(events.column("component_key").to_pylist()) == {"print_bar_calendar"}
    for split in (DatasetSplit.TRAIN, DatasetSplit.VALIDATION, DatasetSplit.TEST):
        assert receipt.manifest.splits[split].event_count_by_component == {
            "print_bar_calendar": 1,
            "print_bar_distance": 0,
            "transport_vacuum_filter": 0,
            "supply_pump_color_1": 0,
        }
    assert receipt.report["maintenance_event_count"] == 3
    assert receipt.report["runtime_event_marker_count"] == 6


def test_verifier_rejects_corruption_and_failed_finalization_is_not_published(
    tmp_path: Path,
) -> None:
    receipt = _generate_fixture_dataset(
        tmp_path / "corrupt",
        _pilot_config(days=0),
        MachineBehavior(),
    )
    report_path = receipt.dataset_path / "reports" / "generation_report.json"
    report_path.write_bytes(report_path.read_bytes() + b" ")

    verification = verify_dataset(receipt.dataset_path)
    assert not verification.healthy
    assert any("checksum mismatch" in error for error in verification.errors)

    failed_root = tmp_path / "failed"
    with pytest.raises(ValidationError, match="code_commit"):
        generate_synthetic_dataset(
            output_root=failed_root,
            dataset_id="pilot-invalid-provenance",
            config=_pilot_config(days=0),
            behavior=MachineBehavior(),
            code_commit="not-a-git-commit",
            created_at=datetime(2026, 8, 12, 12, 0, tzinfo=UTC),
            config_directory=ML_ROOT / "config",
        )
    assert not (failed_root / "pilot-invalid-provenance").exists()
    assert (failed_root / ".pilot-invalid-provenance.tmp").is_dir()


def test_dataset_check_cli_reports_a_valid_published_dataset(tmp_path: Path) -> None:
    receipt = _generate_fixture_dataset(
        tmp_path,
        _pilot_config(days=0),
        MachineBehavior(),
    )

    process = subprocess.run(
        [
            sys.executable,
            "-m",
            "mtex_pdm",
            "dataset-check",
            str(receipt.dataset_path),
            "--json",
        ],
        cwd=ML_ROOT,
        check=False,
        capture_output=True,
        text=True,
    )

    assert process.returncode == 0, process.stderr
    report = json.loads(process.stdout)
    assert report["healthy"]
    assert report["dataset_id"] == "pilot-reproducible"
    assert report["telemetry_row_count"] == 9


def test_dataset_generate_pilot_cli_creates_three_split_draft(tmp_path: Path) -> None:
    process = subprocess.run(
        [
            sys.executable,
            "-m",
            "mtex_pdm",
            "dataset-generate-pilot",
            "--output-root",
            str(tmp_path),
            "--dataset-id",
            "pilot-cli",
            "--code-commit",
            FIXTURE_COMMIT,
            "--start-date",
            "2026-01-01",
            "--days",
            "1",
            "--created-at",
            "2026-08-12T12:00:00Z",
            "--json",
        ],
        cwd=ML_ROOT,
        check=False,
        capture_output=True,
        text=True,
    )

    assert process.returncode == 0, process.stderr
    report = json.loads(process.stdout)
    assert report["healthy"]
    assert report["status"] == "draft"
    assert report["telemetry_row_count"] == 864
    assert report["machine_count"] == 3
    assert verify_dataset(tmp_path / "pilot-cli").healthy


def test_incomplete_run_cannot_be_finalized_as_a_published_dataset(tmp_path: Path) -> None:
    config = _pilot_config(days=1)
    behavior = MachineBehavior()
    output = ParquetDatasetOutput(output_root=tmp_path, dataset_id="pilot-incomplete")
    GeneratorEngine(config, transition=behavior).run(output, max_ticks=10)

    with pytest.raises(ValueError, match="incomplete generator run"):
        output.finalize(
            config=config,
            behavior=behavior,
            code_commit=FIXTURE_COMMIT,
            created_at=datetime(2026, 8, 12, 12, 0, tzinfo=UTC),
            config_directory=ML_ROOT / "config",
        )

    assert not (tmp_path / "pilot-incomplete").exists()
    assert (tmp_path / ".pilot-incomplete.tmp").is_dir()


def test_output_rejects_finalization_with_different_generation_provenance(
    tmp_path: Path,
) -> None:
    config = _pilot_config(days=0)
    behavior = MachineBehavior()
    output = ParquetDatasetOutput(output_root=tmp_path, dataset_id="pilot-wrong-config")
    GeneratorEngine(config, transition=behavior).run(output)

    with pytest.raises(ValueError, match="provenance does not match"):
        output.finalize(
            config=config.model_copy(update={"master_seed": config.master_seed + 1}),
            behavior=behavior,
            code_commit=FIXTURE_COMMIT,
            created_at=datetime(2026, 8, 12, 12, 0, tzinfo=UTC),
            config_directory=ML_ROOT / "config",
        )

    behavior_output = ParquetDatasetOutput(
        output_root=tmp_path,
        dataset_id="pilot-wrong-behavior",
    )
    GeneratorEngine(config, transition=behavior).run(behavior_output)
    with pytest.raises(ValueError, match="transition provenance does not match"):
        behavior_output.finalize(
            config=config,
            behavior=MachineBehavior(BehaviorParameters(copies_per_hour=144.0)),
            code_commit=FIXTURE_COMMIT,
            created_at=datetime(2026, 8, 12, 12, 0, tzinfo=UTC),
            config_directory=ML_ROOT / "config",
        )


def test_changing_seed_changes_content_but_preserves_the_physical_schema(tmp_path: Path) -> None:
    first = _generate_fixture_dataset(
        tmp_path / "first",
        _pilot_config(days=0, seed=20260729),
        MachineBehavior(),
    )
    changed = _generate_fixture_dataset(
        tmp_path / "changed",
        _pilot_config(days=0, seed=20260730),
        MachineBehavior(),
    )
    first_file = sorted((first.dataset_path / "telemetry").rglob("*.parquet"))[0]
    changed_file = sorted((changed.dataset_path / "telemetry").rglob("*.parquet"))[0]

    assert first_file.read_bytes() != changed_file.read_bytes()
    assert _read_schema(first_file).equals(TELEMETRY_ARROW_SCHEMA, check_metadata=True)
    assert _read_schema(changed_file).equals(TELEMETRY_ARROW_SCHEMA, check_metadata=True)


def test_adding_a_machine_does_not_change_existing_machine_partitions(tmp_path: Path) -> None:
    original_config = _pilot_config(days=0)
    original = _generate_fixture_dataset(
        tmp_path / "original",
        original_config,
        MachineBehavior(),
    )
    extra_machine = MachineSimulationSpec(
        machine_id="synthetic-train-02",
        scenario_id="normal_operation",
        data_source=DataSource.SYNTHETIC_HISTORICAL,
        split=DatasetSplit.TRAIN,
    )
    extended_config = original_config.model_copy(
        update={"machines": (*original_config.machines, extra_machine)}
    )
    extended = _generate_fixture_dataset(
        tmp_path / "extended",
        extended_config,
        MachineBehavior(),
    )

    for machine in original_config.machines:
        directory = f"machine={machine.machine_id}"
        original_files = {
            path.relative_to(original.dataset_path / "telemetry" / directory).as_posix(): (
                path.read_bytes()
            )
            for path in (original.dataset_path / "telemetry" / directory).rglob("*.parquet")
        }
        extended_files = {
            path.relative_to(extended.dataset_path / "telemetry" / directory).as_posix(): (
                path.read_bytes()
            )
            for path in (extended.dataset_path / "telemetry" / directory).rglob("*.parquet")
        }
        assert extended_files == original_files


def _read_schema(path: Path) -> pa.Schema:
    return pq.ParquetFile(path).schema_arrow
