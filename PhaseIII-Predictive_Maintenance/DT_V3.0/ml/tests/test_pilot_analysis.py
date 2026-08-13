from __future__ import annotations

import hashlib
import json
import subprocess
import sys
from datetime import UTC, datetime, timedelta
from pathlib import Path

import pyarrow as pa
import pyarrow.parquet as pq

from mtex_pdm.contracts import (
    MAINTENANCE_EVENT_ARROW_SCHEMA,
    ComponentKey,
    DatasetSplit,
    DataSource,
    canonical_json_bytes,
)
from mtex_pdm.generator import (
    BehaviorParameters,
    ComponentHiddenState,
    GenerationConfig,
    GenerationMode,
    HiddenMachineState,
    MachineBehavior,
    MachineSimulationSpec,
    MachineState,
    NumericSignal,
    ObservableMachineState,
    generate_synthetic_dataset,
)
from mtex_pdm.pilot_analysis import (
    analyze_pilot_dataset,
    load_real_machine_reference,
    verify_pilot_analysis,
)

ML_ROOT = Path(__file__).resolve().parents[1]
FIXTURE_COMMIT = "0123456789abcdef0123456789abcdef01234567"


def _sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def _resign_dataset_file(dataset_path: Path, relative: str) -> None:
    changed_path = dataset_path / relative
    manifest_path = dataset_path / "manifests" / "dataset_manifest.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    artifact = next(item for item in manifest["files"] if item["path"] == relative)
    artifact["sha256"] = _sha256(changed_path)
    artifact["size_bytes"] = changed_path.stat().st_size
    manifest_path.write_bytes(canonical_json_bytes(manifest) + b"\n")

    checksums_path = dataset_path / "manifests" / "checksums.sha256"
    checksum_lines = []
    changed = {relative, "manifests/dataset_manifest.json"}
    for line in checksums_path.read_text(encoding="utf-8").splitlines():
        digest, separator, checksum_relative = line.partition("  ")
        if checksum_relative in changed:
            digest = _sha256(dataset_path / checksum_relative)
        checksum_lines.append(f"{digest}{separator}{checksum_relative}")
    checksums_path.write_text("\n".join(checksum_lines) + "\n", encoding="utf-8")


def _analysis_dataset(tmp_path: Path) -> Path:
    start_at = datetime(2026, 1, 1, tzinfo=UTC)
    initial_state = MachineState(
        observable=ObservableMachineState(
            numeric_signals=(NumericSignal(name="print_bar_time_since_last_pm", value=65.0),)
        ),
        hidden=HiddenMachineState(
            components=tuple(
                ComponentHiddenState(component_key=component, degradation=0.0)
                for component in ComponentKey
            )
        ),
    )
    machines = tuple(
        MachineSimulationSpec(
            machine_id=f"analysis-{split.value}-01",
            scenario_id=scenario,
            data_source=DataSource.SYNTHETIC_HISTORICAL,
            split=split,
            initial_state=initial_state,
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
        end_at=start_at + timedelta(days=3),
        step_seconds=1800,
        master_seed=20260729,
        machines=machines,
    )
    receipt = generate_synthetic_dataset(
        output_root=tmp_path / "datasets",
        dataset_id="analysis-fixture",
        config=config,
        behavior=MachineBehavior(
            BehaviorParameters(
                planned_delay_min_hours=1,
                planned_delay_max_hours=1,
                print_bar_distance_maximum=1_000_000_000.0,
            )
        ),
        code_commit=FIXTURE_COMMIT,
        created_at=datetime(2026, 8, 13, 8, 0, tzinfo=UTC),
        config_directory=ML_ROOT / "config",
    )
    return receipt.dataset_path


def test_real_reference_flattens_structured_counters_without_inventing_units() -> None:
    reference = load_real_machine_reference(
        ML_ROOT / "examples" / "pilot" / "real_machine_snapshot.example.json"
    )

    assert reference.confirmed_units == {
        "ambient_temperature": "degC",
        "ink_area_temperature": "degC",
    }
    assert reference.canonical_values["ambient_temperature"] == 26.6
    assert reference.canonical_values["print_bar_time_since_last_pm"] == 42.0
    assert reference.canonical_values["print_bar_time_since_last_pm_maximum"] == 90.0
    assert (
        reference.canonical_values["transport_vacuum_work_time_since_last_air_filter_pm_maximum"]
        == 144_000.0
    )
    assert (
        reference.canonical_values["pump_supply_color_1_work_time_since_replacement_maximum"]
        == 2_880_000.0
    )
    assert "pressure_wiper_suction_head_4" in reference.ignored_attributes
    parameters = BehaviorParameters()
    assert parameters.print_bar_calendar_maximum == 90.0
    assert parameters.print_bar_distance_maximum == 250.0
    assert parameters.vacuum_work_maximum == 144_000.0
    assert parameters.pump_work_maximum == 2_880_000.0


def test_analysis_writes_deterministic_profiles_without_mutating_dataset(tmp_path: Path) -> None:
    dataset_path = _analysis_dataset(tmp_path)
    before = {
        path.relative_to(dataset_path).as_posix(): path.read_bytes()
        for path in dataset_path.rglob("*")
        if path.is_file()
    }
    reference_path = ML_ROOT / "examples" / "pilot" / "real_machine_snapshot.example.json"

    first = analyze_pilot_dataset(
        dataset_path=dataset_path,
        output_root=tmp_path / "analysis-1",
        reference_path=reference_path,
    )
    second = analyze_pilot_dataset(
        dataset_path=dataset_path,
        output_root=tmp_path / "analysis-2",
        reference_path=reference_path,
    )

    assert first.healthy
    assert first.profile["telemetry_row_count"] == 432
    assert first.profile["machine_count"] == 3
    assert first.profile["duplicate_timestamp_count"] == 0
    temperature = first.profile["numeric_attributes"]["ambient_temperature"]
    assert temperature["unit"] == "degC"
    assert temperature["unit_status"] == "confirmed"
    assert temperature["finite_count"] == 432
    assert first.profile["reference_observation"]["reference_id"] == (
        "anonymized-real-machine-snapshot-2026-08"
    )
    assert first.events["independent_event_count"] == 3
    assert first.events["counts_by_component"]["print_bar_calendar"] == 3
    assert first.events["preliminary_label_windows"]["24"]["estimable"]
    assert not first.events["preliminary_label_windows"]["168"]["estimable"]
    assert set(first.events["preliminary_label_windows"]["24"]["by_split"]) == {
        "test",
        "train",
        "validation",
    }
    assert set(first.events["preliminary_label_windows"]["24"]["by_scenario"]) == {
        "high_production",
        "intermittent_operation",
        "normal_operation",
    }
    assert (
        first.events["preliminary_label_windows"]["24"]["by_component_and_split"][
            "print_bar_calendar"
        ]["train"]["positive_count"]
        > 0
    )
    assert (
        first.events["preliminary_label_windows"]["24"]["by_component_and_scenario"][
            "print_bar_calendar"
        ]["normal_operation"]["positive_count"]
        > 0
    )
    assert first.events["preliminary_label_windows"]["24"][
        "positive_window_counts_by_label_source"
    ] == {
        "simulated_condition_event": 0,
        "threshold_proxy": 144,
    }
    assert first.scale_decision["decision"] == "increase_both"
    assert not first.scale_decision["freeze_ready"]
    assert set(first.scale_decision["zero_event_components"]) == {
        "print_bar_distance",
        "transport_vacuum_filter",
        "supply_pump_color_1",
    }
    assert first.scale_decision["recommended_machine_count_by_split"] == {
        "test": 3,
        "train": 7,
        "validation": 2,
    }
    assert first.scale_decision["recommended_days_per_machine"] >= 180
    assert before == {
        path.relative_to(dataset_path).as_posix(): path.read_bytes()
        for path in dataset_path.rglob("*")
        if path.is_file()
    }
    assert {
        path.relative_to(first.analysis_path).as_posix()
        for path in first.analysis_path.rglob("*")
        if path.is_file()
    } == {
        "analysis_manifest.json",
        "checksums.sha256",
        "event_analysis.json",
        "profile_report.md",
        "profile_summary.json",
        "scale_decision.json",
    }
    assert verify_pilot_analysis(first.analysis_path, dataset_path=dataset_path).healthy
    assert {
        path.relative_to(first.analysis_path).as_posix(): path.read_bytes()
        for path in first.analysis_path.rglob("*")
        if path.is_file() and path.name not in {"analysis_manifest.json", "checksums.sha256"}
    } == {
        path.relative_to(second.analysis_path).as_posix(): path.read_bytes()
        for path in second.analysis_path.rglob("*")
        if path.is_file() and path.name not in {"analysis_manifest.json", "checksums.sha256"}
    }


def test_analysis_refuses_a_corrupt_dataset(tmp_path: Path) -> None:
    dataset_path = _analysis_dataset(tmp_path)
    report_path = dataset_path / "reports" / "generation_report.json"
    report_path.write_bytes(report_path.read_bytes() + b" ")

    try:
        analyze_pilot_dataset(dataset_path=dataset_path, output_root=tmp_path / "analysis")
    except ValueError as error:
        assert "dataset verification failed" in str(error)
    else:
        raise AssertionError("corrupt datasets must not be profiled")


def test_analysis_requires_reference_and_dataset_units_to_match(tmp_path: Path) -> None:
    dataset_path = _analysis_dataset(tmp_path)
    reference_path = ML_ROOT / "examples" / "pilot" / "real_machine_snapshot.example.json"
    payload = json.loads(reference_path.read_text(encoding="utf-8"))
    payload["confirmed_units"]["ambient_temperature"] = "degF"
    mismatched_path = tmp_path / "mismatched-reference.json"
    mismatched_path.write_text(json.dumps(payload), encoding="utf-8")

    try:
        analyze_pilot_dataset(
            dataset_path=dataset_path,
            output_root=tmp_path / "analysis",
            reference_path=mismatched_path,
        )
    except ValueError as error:
        assert "explicit conversion is required" in str(error)
    else:
        raise AssertionError("reference units must not silently relabel dataset values")


def test_analysis_rejects_checksum_consistent_event_assignment_mismatch(tmp_path: Path) -> None:
    dataset_path = _analysis_dataset(tmp_path)
    event_path = dataset_path / "ground_truth" / "events.parquet"
    rows = pq.read_table(event_path).to_pylist()
    assert rows
    rows[0]["scenario_id"] = "mismatched_scenario"
    pq.write_table(
        pa.Table.from_pylist(rows, schema=MAINTENANCE_EVENT_ARROW_SCHEMA),
        event_path,
        compression="zstd",
        compression_level=3,
        use_dictionary=False,
        write_statistics=False,
    )

    _resign_dataset_file(dataset_path, "ground_truth/events.parquet")

    try:
        analyze_pilot_dataset(dataset_path=dataset_path, output_root=tmp_path / "analysis")
    except ValueError as error:
        assert "event scenario mismatch" in str(error)
    else:
        raise AssertionError("event identity must match its machine assignment")


def test_analysis_rejects_checksum_consistent_assignment_split_mismatch(
    tmp_path: Path,
) -> None:
    dataset_path = _analysis_dataset(tmp_path)
    assignments_path = dataset_path / "configs" / "scenario_assignments.json"
    assignments = json.loads(assignments_path.read_text(encoding="utf-8"))
    assignments[0]["split"] = "validation"
    assignments_path.write_bytes(canonical_json_bytes(assignments) + b"\n")
    _resign_dataset_file(dataset_path, "configs/scenario_assignments.json")

    try:
        analyze_pilot_dataset(dataset_path=dataset_path, output_root=tmp_path / "analysis")
    except ValueError as error:
        assert "assignment split mismatch" in str(error)
    else:
        raise AssertionError("assignment identity must match the dataset manifest")


def test_analysis_verifier_rejects_a_changed_report(tmp_path: Path) -> None:
    dataset_path = _analysis_dataset(tmp_path)
    receipt = analyze_pilot_dataset(
        dataset_path=dataset_path,
        output_root=tmp_path / "analysis",
    )
    profile_path = receipt.analysis_path / "profile_summary.json"
    profile_path.write_bytes(profile_path.read_bytes() + b" ")

    verification = verify_pilot_analysis(receipt.analysis_path, dataset_path=dataset_path)

    assert not verification.healthy
    assert any("checksum mismatch" in error for error in verification.errors)


def test_pilot_run_cli_generates_profiles_and_scale_decision(tmp_path: Path) -> None:
    process = subprocess.run(
        [
            sys.executable,
            "-m",
            "mtex_pdm",
            "pilot-run",
            "--output-root",
            str(tmp_path / "datasets"),
            "--analysis-root",
            str(tmp_path / "analyses"),
            "--dataset-id",
            "pilot-run-cli",
            "--code-commit",
            FIXTURE_COMMIT,
            "--start-date",
            "2026-01-01",
            "--days",
            "1",
            "--train-machines",
            "7",
            "--validation-machines",
            "2",
            "--test-machines",
            "3",
            "--created-at",
            "2026-08-13T08:00:00Z",
            "--reference-snapshot",
            str(ML_ROOT / "examples" / "pilot" / "real_machine_snapshot.example.json"),
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
    assert report["dataset_id"] == "pilot-run-cli"
    assert report["telemetry_row_count"] == 3456
    assert report["machine_count"] == 12
    assert report["scale_decision"] == "increase_both"
    assert Path(report["dataset_path"]).is_dir()
    assert Path(report["analysis_path"]).is_dir()
    scale = json.loads(
        (Path(report["analysis_path"]) / "scale_decision.json").read_text(encoding="utf-8")
    )
    assert scale["zero_event_components"]
    assert scale["recommended_machine_count_by_split"] == {
        "test": 4,
        "train": 9,
        "validation": 3,
    }
    assert scale["recommended_days_per_machine"] == 180

    verification_process = subprocess.run(
        [
            sys.executable,
            "-m",
            "mtex_pdm",
            "pilot-analysis-check",
            report["analysis_path"],
            "--dataset-path",
            report["dataset_path"],
            "--json",
        ],
        cwd=ML_ROOT,
        check=False,
        capture_output=True,
        text=True,
    )
    assert verification_process.returncode == 0, verification_process.stderr
    verification = json.loads(verification_process.stdout)
    assert verification["healthy"]
    assert verification["checked_file_count"] == 5
