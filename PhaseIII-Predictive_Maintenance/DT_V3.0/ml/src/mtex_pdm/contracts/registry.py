"""Schema registry, deterministic hashing, and contract-bundle verification."""

from __future__ import annotations

import hashlib
import json
import os
from collections.abc import Mapping
from pathlib import Path
from tempfile import NamedTemporaryFile
from typing import Any

from pydantic import BaseModel, ValidationError

from mtex_pdm.config_validation import validate_frozen_config
from mtex_pdm.contracts.models import (
    CONTRACT_VERSION,
    ArtifactFile,
    CrateTelemetryRow,
    DatasetManifest,
    ExportManifest,
    FeatureSchema,
    MaintenanceEvent,
    ModelManifest,
    TelemetryRecord,
)
from mtex_pdm.contracts.tabular import (
    MAINTENANCE_EVENT_ARROW_SCHEMA,
    TELEMETRY_ARROW_SCHEMA,
    CrateSchemaSnapshot,
    arrow_schema_descriptor,
    validate_cratedb_schema,
)
from mtex_pdm.telemetry_catalog import collect_telemetry_catalog_report

_SCHEMA_MODELS: dict[str, type[BaseModel]] = {
    "crate_telemetry_row.schema.json": CrateTelemetryRow,
    "dataset_manifest.schema.json": DatasetManifest,
    "export_manifest.schema.json": ExportManifest,
    "feature_schema.schema.json": FeatureSchema,
    "maintenance_event.schema.json": MaintenanceEvent,
    "model_manifest.schema.json": ModelManifest,
    "telemetry_record.schema.json": TelemetryRecord,
}

_EXAMPLE_MODELS: dict[str, type[BaseModel]] = {
    "crate_schema_snapshot.example.json": CrateSchemaSnapshot,
    "crate_telemetry_row.example.json": CrateTelemetryRow,
    "dataset_manifest.example.json": DatasetManifest,
    "export_manifest.example.json": ExportManifest,
    "feature_schema.example.json": FeatureSchema,
    "maintenance_event.example.json": MaintenanceEvent,
    "model_manifest.example.json": ModelManifest,
    "telemetry_record.example.json": TelemetryRecord,
}

_INVALID_EXAMPLE_MODELS: dict[str, type[BaseModel]] = {
    "invalid/feature_schema.leakage.json": FeatureSchema,
    "invalid/telemetry_record.naive_timestamp.json": TelemetryRecord,
}


def canonical_json_bytes(value: BaseModel | Mapping[str, Any] | list[Any]) -> bytes:
    """Encode JSON with stable ordering and no platform-dependent whitespace."""

    serializable: Any
    if isinstance(value, BaseModel):
        serializable = value.model_dump(mode="json", exclude_none=False)
    else:
        serializable = value
    return json.dumps(
        serializable,
        ensure_ascii=False,
        allow_nan=False,
        separators=(",", ":"),
        sort_keys=True,
    ).encode("utf-8")


def canonical_sha256(value: BaseModel | Mapping[str, Any] | list[Any] | bytes) -> str:
    """Hash serialized contracts or already-materialized artifact bytes."""

    payload = value if isinstance(value, bytes) else canonical_json_bytes(value)
    return hashlib.sha256(payload).hexdigest()


def artifact_file(
    path: Path,
    *,
    root: Path,
    media_type: str,
    role: str,
    row_count: int | None = None,
) -> ArtifactFile:
    """Describe a file without embedding an absolute, device-specific path."""

    resolved_path = path.resolve(strict=True)
    resolved_root = root.resolve(strict=True)
    relative = resolved_path.relative_to(resolved_root).as_posix()
    content = resolved_path.read_bytes()
    return ArtifactFile(
        path=relative,
        sha256=hashlib.sha256(content).hexdigest(),
        size_bytes=len(content),
        media_type=media_type,
        role=role,
        row_count=row_count,
    )


def verify_feature_model_compatibility(
    feature_schema: FeatureSchema,
    model_manifest: ModelManifest,
) -> None:
    """Fail closed when inference feature order differs from model training."""

    actual_hash = canonical_sha256(feature_schema)
    if actual_hash != model_manifest.feature_schema_hash:
        raise ValueError(
            "feature schema hash does not match the model manifest: "
            f"expected {model_manifest.feature_schema_hash}, got {actual_hash}"
        )
    if feature_schema.horizons_hours != model_manifest.horizons_hours:
        raise ValueError("feature and model horizons do not match")


def _json_document(value: Mapping[str, Any]) -> bytes:
    return (
        json.dumps(
            value,
            ensure_ascii=False,
            indent=2,
            sort_keys=True,
        )
        + "\n"
    ).encode("utf-8")


def _schema_documents() -> dict[str, bytes]:
    documents = {
        name: _json_document(
            {
                "$id": f"https://mtex.local/schemas/v1.1/{name}",
                **model.model_json_schema(mode="validation"),
            }
        )
        for name, model in _SCHEMA_MODELS.items()
    }
    documents["maintenance_events_table.arrow.json"] = _json_document(
        arrow_schema_descriptor(MAINTENANCE_EVENT_ARROW_SCHEMA)
    )
    documents["telemetry_table.arrow.json"] = _json_document(
        arrow_schema_descriptor(TELEMETRY_ARROW_SCHEMA)
    )
    return dict(sorted(documents.items()))


def _atomic_write(path: Path, content: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with NamedTemporaryFile(
        mode="wb",
        dir=path.parent,
        delete=False,
        prefix=f".{path.name}.",
        suffix=".tmp",
    ) as temporary:
        temporary.write(content)
        temporary.flush()
        os.fsync(temporary.fileno())
        temporary_path = Path(temporary.name)
    os.replace(temporary_path, path)


def write_contract_schemas(output_directory: Path) -> tuple[str, ...]:
    """Materialize all generated schemas and their SHA-256 manifest."""

    documents = _schema_documents()
    output_directory.mkdir(parents=True, exist_ok=True)
    for name, content in documents.items():
        _atomic_write(output_directory / name, content)
    checksum_lines = [
        f"{hashlib.sha256(content).hexdigest()}  {name}" for name, content in documents.items()
    ]
    _atomic_write(
        output_directory / "checksums.sha256",
        ("\n".join(checksum_lines) + "\n").encode(),
    )
    return tuple(documents)


def _validate_examples(examples_dir: Path) -> tuple[int, list[str]]:
    errors: list[str] = []
    count = 0
    for name, model in _EXAMPLE_MODELS.items():
        path = examples_dir / name
        if not path.is_file():
            errors.append(f"missing example: {name}")
            continue
        count += 1
        try:
            model.model_validate_json(path.read_text(encoding="utf-8"))
        except (ValidationError, ValueError) as error:
            errors.append(f"invalid example {name}: {error}")
    feature_path = examples_dir / "feature_schema.example.json"
    model_path = examples_dir / "model_manifest.example.json"
    if feature_path.is_file() and model_path.is_file():
        try:
            verify_feature_model_compatibility(
                FeatureSchema.model_validate_json(feature_path.read_text(encoding="utf-8")),
                ModelManifest.model_validate_json(model_path.read_text(encoding="utf-8")),
            )
        except (ValidationError, ValueError) as error:
            errors.append(f"incompatible feature/model examples: {error}")
    for name, model in _INVALID_EXAMPLE_MODELS.items():
        path = examples_dir / name
        if not path.is_file():
            errors.append(f"missing invalid example: {name}")
            continue
        count += 1
        try:
            model.model_validate_json(path.read_text(encoding="utf-8"))
        except (ValidationError, ValueError):
            continue
        errors.append(f"invalid example was unexpectedly accepted: {name}")
    return count, errors


def validate_contract_bundle(
    *,
    schemas_dir: Path,
    examples_dir: Path | None = None,
    crate_schema_path: Path | None = None,
    config_directory: Path | None = None,
) -> dict[str, Any]:
    """Verify checked-in schemas, checksums, examples, and an optional live snapshot."""

    expected = _schema_documents()
    errors: list[str] = []
    telemetry_catalog: dict[str, object] | None = None
    try:
        validate_frozen_config(config_directory)
        telemetry_catalog = collect_telemetry_catalog_report(config_directory)
    except (OSError, ValueError) as error:
        errors.append(f"invalid TPPPS4 telemetry catalog: {error}")
    for name, content in expected.items():
        path = schemas_dir / name
        if not path.is_file():
            errors.append(f"missing schema: {name}")
        elif path.read_bytes() != content:
            errors.append(f"generated schema is stale or modified: {name}")

    checksums_path = schemas_dir / "checksums.sha256"
    expected_checksums = (
        "\n".join(
            f"{hashlib.sha256(content).hexdigest()}  {name}" for name, content in expected.items()
        )
        + "\n"
    )
    if not checksums_path.is_file():
        errors.append("missing schema checksum manifest: checksums.sha256")
    elif checksums_path.read_text(encoding="utf-8") != expected_checksums:
        errors.append("schema checksum manifest is stale or modified")

    example_count = 0
    if examples_dir is not None:
        example_count, example_errors = _validate_examples(examples_dir)
        errors.extend(example_errors)

    crate_report: dict[str, Any] | None = None
    if crate_schema_path is not None:
        try:
            crate_payload = json.loads(crate_schema_path.read_text(encoding="utf-8"))
            if not isinstance(crate_payload, dict):
                raise ValueError("CrateDB schema snapshot root must be an object")
            if "cols" in crate_payload and "rows" in crate_payload:
                snapshot = CrateSchemaSnapshot.from_sql_response(
                    table=str(crate_payload.get("table", "etmachine")),
                    response=crate_payload,
                )
            else:
                snapshot = CrateSchemaSnapshot.model_validate(crate_payload)
            report = validate_cratedb_schema(snapshot)
            crate_report = report.model_dump(mode="json")
            if not report.compatible:
                errors.append("CrateDB schema snapshot is incompatible")
        except (OSError, ValidationError, ValueError) as error:
            errors.append(f"invalid CrateDB schema snapshot: {error}")

    return {
        "healthy": not errors,
        "contract_version": CONTRACT_VERSION,
        "schema_count": len(expected),
        "example_count": example_count,
        "crate_schema": crate_report,
        "telemetry_catalog": telemetry_catalog,
        "errors": errors,
    }
