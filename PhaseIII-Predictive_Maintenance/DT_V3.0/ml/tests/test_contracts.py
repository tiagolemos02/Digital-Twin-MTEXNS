from __future__ import annotations

import json
import subprocess
import sys
from datetime import UTC, datetime
from pathlib import Path

import pyarrow as pa
import pytest
from pydantic import ValidationError

from mtex_pdm.contracts import (
    TELEMETRY_ARROW_SCHEMA,
    ArtifactStatus,
    ComponentKey,
    CrateSchemaSnapshot,
    DatasetManifest,
    DatasetSplit,
    DatasetSplitSummary,
    DataSource,
    FeatureDefinition,
    FeatureDType,
    FeatureSchema,
    LabelSource,
    MaintenanceEvent,
    ModelManifest,
    artifact_file,
    canonical_sha256,
    parse_cratedb_telemetry,
    validate_contract_bundle,
    validate_cratedb_schema,
    verify_feature_model_compatibility,
    write_contract_schemas,
)


def test_cratedb_row_is_normalized_to_canonical_telemetry() -> None:
    record = parse_cratedb_telemetry(
        {
            "entity_id": "urn:ngsi-ld:Machine:enterprise-001",
            "entity_type": "Machine",
            "time_index": 1_774_742_400_000,
            "fiware_servicepath": "/",
            "iamalive": "true",
            "ambient_temperature": 22,
            "ambient_humidity": 47.5,
            "speed_mms_print_bar": 120,
            "unselected_enterprise_column": {"kept": "only in CrateDB"},
        },
        machine_id="real-shadow-001",
    )

    assert record.machine_id == "real-shadow-001"
    assert record.data_source is DataSource.REAL_SHADOW
    assert record.split is DatasetSplit.SHADOW
    assert record.time_index == datetime(2026, 3, 29, 0, 0, tzinfo=UTC)
    assert record.ambient_temperature == 22.0
    assert record.speed_mms_print_bar == 120.0
    assert not hasattr(record, "entity_id")
    assert not hasattr(record, "unselected_enterprise_column")


def test_non_finite_cratedb_number_is_rejected() -> None:
    with pytest.raises(ValidationError, match="finite number"):
        parse_cratedb_telemetry(
            {
                "entity_id": "urn:ngsi-ld:Machine:enterprise-001",
                "entity_type": "Machine",
                "time_index": "2026-03-29T00:00:00Z",
                "ambient_temperature": float("nan"),
            },
            machine_id="real-shadow-001",
        )


def test_maintenance_event_enforces_component_label_and_time_order() -> None:
    event = MaintenanceEvent(
        event_id="event-001",
        machine_id="synthetic-001",
        component_key=ComponentKey.PRINT_BAR_CALENDAR,
        label_source=LabelSource.THRESHOLD_PROXY,
        data_source=DataSource.SYNTHETIC_HISTORICAL,
        split=DatasetSplit.TRAIN,
        scenario_id="normal-operation",
        maintenance_due_at=datetime(2026, 3, 29, 0, 0, tzinfo=UTC),
        maintenance_performed_at=datetime(2026, 3, 29, 2, 0, tzinfo=UTC),
    )

    assert event.maintenance_performed_at is not None
    with pytest.raises(ValidationError, match="requires label_source"):
        event.model_copy(
            update={"label_source": LabelSource.SIMULATED_CONDITION_EVENT},
        ).__class__.model_validate(
            {
                **event.model_dump(),
                "label_source": LabelSource.SIMULATED_CONDITION_EVENT,
            }
        )
    with pytest.raises(ValidationError, match="cannot precede"):
        MaintenanceEvent.model_validate(
            {
                **event.model_dump(),
                "maintenance_performed_at": "2026-03-28T23:00:00Z",
            }
        )


def test_cratedb_schema_matches_quantumleap_physical_types() -> None:
    snapshot = CrateSchemaSnapshot.from_sql_response(
        table="etmachine",
        response={
            "cols": ["column_name", "data_type", "is_nullable"],
            "rows": [
                ["entity_id", "text", "NO"],
                ["entity_type", "text", "NO"],
                ["time_index", "timestamp with time zone", "NO"],
                ["iamalive", "text", "YES"],
                ["ambient_temperature", "real", "YES"],
                ["ambient_humidity", "real", "YES"],
                ["machine_status", "real", "YES"],
            ],
        },
    )

    report = validate_cratedb_schema(
        snapshot,
        required_numeric_attributes=(
            "ambient_temperature",
            "ambient_humidity",
            "machine_status",
        ),
    )

    assert report.compatible
    assert report.missing_columns == ()
    assert report.type_mismatches == ()


def test_cratedb_schema_reports_missing_and_wrong_columns() -> None:
    snapshot = CrateSchemaSnapshot.from_sql_response(
        table="etmachine",
        response={
            "cols": ["column_name", "data_type", "is_nullable"],
            "rows": [
                ["entity_id", "text", "NO"],
                ["entity_type", "text", "NO"],
                ["time_index", "timestamp without time zone", "NO"],
                ["ambient_temperature", "text", "YES"],
            ],
        },
    )

    report = validate_cratedb_schema(
        snapshot,
        required_numeric_attributes=("ambient_temperature", "ambient_humidity"),
    )

    assert not report.compatible
    assert report.missing_columns == ("ambient_humidity", "iamalive")
    assert {mismatch.column for mismatch in report.type_mismatches} == {
        "ambient_temperature",
        "time_index",
    }


def test_telemetry_arrow_schema_preserves_utc_and_contract_metadata() -> None:
    assert TELEMETRY_ARROW_SCHEMA.field("time_index").type == pa.timestamp("ms", tz="UTC")
    assert TELEMETRY_ARROW_SCHEMA.field("ambient_temperature").type == pa.float64()
    assert TELEMETRY_ARROW_SCHEMA.metadata is not None
    assert TELEMETRY_ARROW_SCHEMA.metadata[b"contract_version"] == b"1.0.0"
    assert TELEMETRY_ARROW_SCHEMA.metadata[b"unit.ambient_temperature"] == b"degC"
    assert TELEMETRY_ARROW_SCHEMA.metadata[b"unit.ink_area_temperature"] == b"degC"
    assert (
        TELEMETRY_ARROW_SCHEMA.metadata[b"unit.ink_area_humidity"] == b"source_native_unconfirmed"
    )


def _event_counts(count: int = 1) -> dict[ComponentKey, int]:
    return dict.fromkeys(ComponentKey, count)


def _feature_schema() -> FeatureSchema:
    return FeatureSchema(
        feature_set_id="mvp-observable-v1",
        target="maintenanceNeedProbability",
        horizons_hours=(24, 168),
        features=(
            FeatureDefinition(
                name="ambient_temperature_mean_1h",
                position=0,
                dtype=FeatureDType.FLOAT64,
                unit="source_native_unconfirmed",
                window_hours=1,
                nullable=False,
                imputation="causal_forward_fill_10m",
                components=tuple(ComponentKey),
            ),
            FeatureDefinition(
                name="speed_mms_print_bar_mean_6h",
                position=1,
                dtype=FeatureDType.FLOAT64,
                unit="mm/s",
                window_hours=6,
                nullable=True,
                imputation="causal_forward_fill_10m_then_missing_indicator",
                components=(ComponentKey.PRINT_BAR_DISTANCE,),
            ),
        ),
    )


def test_dataset_manifest_rejects_machine_leakage_between_splits() -> None:
    split = DatasetSplitSummary(
        machine_ids=("machine-shared",),
        row_count=100,
        event_count_by_component=_event_counts(),
    )
    with pytest.raises(ValidationError, match="split-disjoint"):
        DatasetManifest(
            dataset_id="dataset-v1",
            generator_version="1.0.0",
            code_commit="abcdef1",
            created_at=datetime(2026, 3, 29, 0, 0, tzinfo=UTC),
            master_seed=20260729,
            start_time=datetime(2026, 1, 1, 0, 0, tzinfo=UTC),
            end_time=datetime(2026, 3, 29, 0, 0, tzinfo=UTC),
            resample_minutes=5,
            splits={
                DatasetSplit.TRAIN: split,
                DatasetSplit.VALIDATION: split,
                DatasetSplit.TEST: split,
            },
            scenarios=("normal-operation",),
            units={"ambient_temperature": "source_native_unconfirmed"},
            schema_hashes={"telemetry": "a" * 64},
            config_checksums={"mvp.yaml": "b" * 64},
            files=(),
            status=ArtifactStatus.DRAFT,
        )


def test_feature_schema_rejects_leakage_and_unstable_order() -> None:
    valid = _feature_schema()
    with pytest.raises(ValidationError, match="forbidden leakage"):
        FeatureSchema.model_validate(
            {
                **valid.model_dump(),
                "features": [
                    {
                        **valid.features[0].model_dump(),
                        "name": "machine_id",
                    }
                ],
            }
        )
    with pytest.raises(ValidationError, match="contiguous"):
        FeatureSchema.model_validate(
            {
                **valid.model_dump(),
                "features": [
                    {
                        **valid.features[0].model_dump(),
                        "position": 2,
                    }
                ],
            }
        )


def test_model_manifest_must_match_exact_feature_schema_hash() -> None:
    feature_schema = _feature_schema()
    manifest = ModelManifest(
        model_version="1.0.0",
        dataset_id="dataset-v1",
        generator_version="1.0.0",
        code_commit="abcdef1",
        created_at=datetime(2026, 3, 29, 0, 0, tzinfo=UTC),
        architecture="global_per_horizon",
        horizons_hours=(24, 168),
        components=tuple(ComponentKey),
        feature_schema_hash=canonical_sha256(feature_schema),
        hyperparameters={"num_leaves": 31},
        seeds={"training": 20260729},
        calibration={"method": "isotonic_validation_only"},
        thresholds={"24h": 0.65, "7d": 0.55},
        metrics={"validation_recall_24h": 0.8},
        status=ArtifactStatus.DRAFT,
        files=(),
    )

    verify_feature_model_compatibility(feature_schema, manifest)
    incompatible = ModelManifest.model_validate(
        {**manifest.model_dump(), "feature_schema_hash": "0" * 64}
    )
    with pytest.raises(ValueError, match="feature schema hash"):
        verify_feature_model_compatibility(feature_schema, incompatible)


def test_artifact_file_records_content_integrity(tmp_path: Path) -> None:
    artifact_path = tmp_path / "train.parquet"
    artifact_path.write_bytes(b"portable parquet placeholder")

    descriptor = artifact_file(
        artifact_path,
        root=tmp_path,
        media_type="application/vnd.apache.parquet",
        role="train-telemetry",
        row_count=123,
    )

    assert descriptor.path == "train.parquet"
    assert descriptor.size_bytes == 28
    assert descriptor.sha256 == canonical_sha256(b"portable parquet placeholder")


def test_generated_schema_bundle_is_deterministic_and_valid(
    tmp_path: Path,
) -> None:
    schemas_dir = tmp_path / "schemas"
    write_contract_schemas(schemas_dir)

    report = validate_contract_bundle(schemas_dir=schemas_dir)

    assert report["healthy"]
    assert report["schema_count"] == 9
    assert (schemas_dir / "checksums.sha256").is_file()


def test_contracts_check_cli_validates_checked_in_bundle() -> None:
    ml_root = Path(__file__).resolve().parents[1]
    process = subprocess.run(
        [
            sys.executable,
            "-m",
            "mtex_pdm",
            "contracts-check",
            "--schemas-dir",
            str(ml_root / "schemas"),
            "--examples-dir",
            str(ml_root / "examples" / "contracts"),
            "--crate-schema",
            str(ml_root / "examples" / "contracts" / "crate_schema_snapshot.example.json"),
            "--json",
        ],
        cwd=ml_root,
        check=False,
        capture_output=True,
        text=True,
    )

    assert process.returncode == 0, process.stderr
    report = json.loads(process.stdout)
    assert report["healthy"]
    assert report["crate_schema"]["compatible"]
