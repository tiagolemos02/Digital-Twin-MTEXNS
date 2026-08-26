"""Physical CrateDB and Arrow schemas at the ingestion/storage boundary."""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from typing import Any

import pyarrow as pa
from pydantic import BaseModel, ConfigDict, Field, model_validator

from mtex_pdm.contracts.models import CONTRACT_VERSION

CRATEDB_REQUIRED_NUMERIC_ATTRIBUTES = (
    "machine_status",
    "copies_requested",
    "copies_printed",
    "ambient_temperature",
    "ambient_humidity",
    "ink_area_temperature",
    "ink_area_humidity",
    "print_bar_time_since_last_pm",
    "print_bar_time_since_last_pm_maximum",
    "print_bar_traveled_distance_since_last_pm",
    "print_bar_traveled_distance_since_last_pm_maximum",
    "transport_vacuum_work_time_since_last_air_filter_pm",
    "transport_vacuum_work_time_since_last_air_filter_pm_maximum",
    "pump_supply_color_1_work_time_since_replacement",
    "pump_supply_color_1_work_time_since_replacement_maximum",
    "speed_mms_print_bar",
    "speed_rpm_print_bar",
    "speed_mms_transport",
    "speed_rpm_transport",
)

CANONICAL_NUMERIC_ATTRIBUTES = (*CRATEDB_REQUIRED_NUMERIC_ATTRIBUTES,)

ATTRIBUTE_UNITS: dict[str, str] = {
    "machine_status": "status_code",
    "copies_requested": "count",
    "copies_printed": "count",
    "ambient_temperature": "degC",
    "ambient_humidity": "%",
    "ink_area_temperature": "degC",
    "ink_area_humidity": "%",
    "print_bar_time_since_last_pm": "d",
    "print_bar_time_since_last_pm_maximum": "d",
    "print_bar_traveled_distance_since_last_pm": "m",
    "print_bar_traveled_distance_since_last_pm_maximum": "m",
    "transport_vacuum_work_time_since_last_air_filter_pm": "s",
    "transport_vacuum_work_time_since_last_air_filter_pm_maximum": "s",
    "pump_supply_color_1_work_time_since_replacement": "s",
    "pump_supply_color_1_work_time_since_replacement_maximum": "s",
    "speed_mms_print_bar": "mm/s",
    "speed_rpm_print_bar": "rpm",
    "speed_mms_transport": "mm/s",
    "speed_rpm_transport": "rpm",
}


class _ImmutableModel(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True, str_strip_whitespace=True)


class CrateColumn(_ImmutableModel):
    name: str = Field(min_length=1)
    data_type: str = Field(min_length=1)
    nullable: bool


class CrateSchemaSnapshot(_ImmutableModel):
    """Portable snapshot of information_schema.columns for one CrateDB table."""

    table: str = Field(min_length=1)
    columns: tuple[CrateColumn, ...]

    @model_validator(mode="after")
    def unique_columns(self) -> CrateSchemaSnapshot:
        names = [column.name for column in self.columns]
        if len(names) != len(set(names)):
            raise ValueError("CrateDB schema snapshot contains duplicate columns")
        return self

    @classmethod
    def from_sql_response(
        cls,
        *,
        table: str,
        response: Mapping[str, Any],
    ) -> CrateSchemaSnapshot:
        """Parse CrateDB HTTP ``_sql`` cols/rows output without type guessing."""

        cols = response.get("cols")
        rows = response.get("rows")
        if not isinstance(cols, list) or not all(isinstance(item, str) for item in cols):
            raise ValueError("CrateDB SQL response requires a string 'cols' list")
        if not isinstance(rows, list):
            raise ValueError("CrateDB SQL response requires a 'rows' list")
        expected = {"column_name", "data_type", "is_nullable"}
        if set(cols) != expected:
            raise ValueError(
                "CrateDB SQL response columns must be column_name, data_type, is_nullable"
            )
        indexes = {name: cols.index(name) for name in expected}
        parsed: list[CrateColumn] = []
        for row in rows:
            if not isinstance(row, list) or len(row) != len(cols):
                raise ValueError("each CrateDB SQL response row must match cols")
            nullable_value = row[indexes["is_nullable"]]
            if isinstance(nullable_value, bool):
                nullable = nullable_value
            elif isinstance(nullable_value, str) and nullable_value.upper() in {"YES", "NO"}:
                nullable = nullable_value.upper() == "YES"
            else:
                raise ValueError("is_nullable must be YES, NO, or a boolean")
            parsed.append(
                CrateColumn(
                    name=str(row[indexes["column_name"]]),
                    data_type=str(row[indexes["data_type"]]).strip().lower(),
                    nullable=nullable,
                )
            )
        return cls(table=table, columns=tuple(parsed))


class CrateTypeMismatch(_ImmutableModel):
    column: str
    expected: str
    actual: str


class CrateSchemaValidationReport(_ImmutableModel):
    table: str
    compatible: bool
    checked_columns: tuple[str, ...]
    missing_columns: tuple[str, ...]
    type_mismatches: tuple[CrateTypeMismatch, ...]


def validate_cratedb_schema(
    snapshot: CrateSchemaSnapshot,
    *,
    required_numeric_attributes: Sequence[str] | None = None,
) -> CrateSchemaValidationReport:
    """Compare a snapshot with the project QuantumLeap/CrateDB contract."""

    numeric = (
        CRATEDB_REQUIRED_NUMERIC_ATTRIBUTES
        if required_numeric_attributes is None
        else tuple(required_numeric_attributes)
    )
    expected = {
        "entity_id": "text",
        "entity_type": "text",
        "time_index": "timestamp with time zone",
        "iamalive": "text",
        **dict.fromkeys(numeric, "real"),
    }
    actual = {column.name: column.data_type for column in snapshot.columns}
    missing = tuple(sorted(set(expected).difference(actual)))
    mismatches = tuple(
        CrateTypeMismatch(column=name, expected=expected_type, actual=actual[name])
        for name, expected_type in sorted(expected.items())
        if name in actual and actual[name] != expected_type
    )
    return CrateSchemaValidationReport(
        table=snapshot.table,
        compatible=not missing and not mismatches,
        checked_columns=tuple(sorted(expected)),
        missing_columns=missing,
        type_mismatches=mismatches,
    )


def _telemetry_arrow_schema() -> pa.Schema:
    fields = [
        pa.field("schema_version", pa.string(), nullable=False),
        pa.field("machine_id", pa.string(), nullable=False),
        pa.field("time_index", pa.timestamp("ms", tz="UTC"), nullable=False),
        pa.field("data_source", pa.string(), nullable=False),
        pa.field("split", pa.string(), nullable=False),
        pa.field("iamalive", pa.string()),
        *(pa.field(attribute, pa.float64()) for attribute in CANONICAL_NUMERIC_ATTRIBUTES),
    ]
    metadata = {
        b"contract_version": CONTRACT_VERSION.encode(),
        b"timezone": b"UTC",
        b"source.cratedb.numeric": b"REAL",
        b"canonical.parquet.numeric": b"float64",
        b"semantic.machine_status": b"categorical_code",
        **{
            f"unit.{attribute}".encode(): unit.encode()
            for attribute, unit in ATTRIBUTE_UNITS.items()
        },
    }
    return pa.schema(fields, metadata=metadata)


TELEMETRY_ARROW_SCHEMA = _telemetry_arrow_schema()

MAINTENANCE_EVENT_ARROW_SCHEMA = pa.schema(
    [
        pa.field("schema_version", pa.string(), nullable=False),
        pa.field("event_id", pa.string(), nullable=False),
        pa.field("machine_id", pa.string(), nullable=False),
        pa.field("component_key", pa.string(), nullable=False),
        pa.field("label_source", pa.string(), nullable=False),
        pa.field("data_source", pa.string(), nullable=False),
        pa.field("split", pa.string(), nullable=False),
        pa.field("scenario_id", pa.string(), nullable=False),
        pa.field("maintenance_due_at", pa.timestamp("ms", tz="UTC"), nullable=False),
        pa.field("maintenance_performed_at", pa.timestamp("ms", tz="UTC")),
        pa.field("censored", pa.bool_(), nullable=False),
    ],
    metadata={
        b"contract_version": CONTRACT_VERSION.encode(),
        b"timezone": b"UTC",
        b"event_semantics": b"one independent due/performed maintenance lifecycle",
    },
)


def arrow_schema_descriptor(schema: pa.Schema) -> dict[str, Any]:
    """Return a deterministic JSON-safe representation of an Arrow schema."""

    return {
        "fields": [
            {
                "name": field.name,
                "type": str(field.type),
                "nullable": field.nullable,
            }
            for field in schema
        ],
        "metadata": {
            key.decode(): value.decode() for key, value in sorted((schema.metadata or {}).items())
        },
    }
