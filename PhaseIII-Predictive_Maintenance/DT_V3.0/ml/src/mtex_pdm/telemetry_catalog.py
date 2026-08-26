"""Typed TPPPS4 telemetry and machine-status catalog."""

from __future__ import annotations

import json
from enum import IntEnum
from pathlib import Path
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

from mtex_pdm.config_validation import discover_config_directory

CATALOG_FILENAME = "tppps4_telemetry_catalog.json"
CATALOG_VERSION = "1.0.0"


class TelemetryCatalogError(ValueError):
    """Raised when the authorized TPPPS4 catalog is missing or inconsistent."""


class MachineStatus(IntEnum):
    """Non-ordinal TPPPS4 operating-state codes supplied by the company."""

    INVALID = 0
    EMERGENCY = 1
    IDLE = 2
    MANUAL = 3
    DIAGNOSTIC = 5
    INITIALIZING = 6
    UNINITIALIZED = 7
    SEQUENCE_INTERRUPTED = 8
    PAUSED = 9
    MAINTENANCE = 11
    STANDBY = 12
    SHUTDOWN = 13
    CRITICAL_ERROR = 14
    INITIALIZING_ERROR = 15
    CLEANING = 200
    PREPARING_TO_PRINT = 201
    READY_TO_PRINT = 202
    PRINTING = 203
    CLEANING_ERROR = 205
    PRINTING_ERROR = 206
    RESERVED = 300
    PREPARING_TO_SPIN = 301
    READY_TO_SPIN = 302
    SPINNING = 303
    UNKNOWN = 999


MACHINE_STATUS_LABELS: dict[MachineStatus, str] = {
    MachineStatus.INVALID: "Invalid",
    MachineStatus.EMERGENCY: "Emergency",
    MachineStatus.IDLE: "Idle",
    MachineStatus.MANUAL: "Manual",
    MachineStatus.DIAGNOSTIC: "Diagnostic",
    MachineStatus.INITIALIZING: "Initializing",
    MachineStatus.UNINITIALIZED: "Uninitialized",
    MachineStatus.SEQUENCE_INTERRUPTED: "Sequence interrupted",
    MachineStatus.PAUSED: "Paused",
    MachineStatus.MAINTENANCE: "Maintenance",
    MachineStatus.STANDBY: "Standby",
    MachineStatus.SHUTDOWN: "Shutdown",
    MachineStatus.CRITICAL_ERROR: "Critical error",
    MachineStatus.INITIALIZING_ERROR: "Initializing error",
    MachineStatus.CLEANING: "Cleaning",
    MachineStatus.PREPARING_TO_PRINT: "Preparing to print",
    MachineStatus.READY_TO_PRINT: "Ready to print",
    MachineStatus.PRINTING: "Printing",
    MachineStatus.CLEANING_ERROR: "Cleaning error",
    MachineStatus.PRINTING_ERROR: "Printing error",
    MachineStatus.RESERVED: "Reserved",
    MachineStatus.PREPARING_TO_SPIN: "Preparing to spin",
    MachineStatus.READY_TO_SPIN: "Ready to spin",
    MachineStatus.SPINNING: "Spinning",
    MachineStatus.UNKNOWN: "Unknown",
}

OFFICIAL_MVP_MAXIMA: dict[str, tuple[str, float, str]] = {
    "print_bar_time_since_last_pm_maximum": (
        "print_bar_time_since_last_pm",
        90.0,
        "d",
    ),
    "print_bar_traveled_distance_since_last_pm_maximum": (
        "print_bar_traveled_distance_since_last_pm",
        250.0,
        "m",
    ),
    "transport_vacuum_work_time_since_last_air_filter_pm_maximum": (
        "transport_vacuum_work_time_since_last_air_filter_pm",
        144_000.0,
        "s",
    ),
    "pump_supply_color_1_work_time_since_replacement_maximum": (
        "pump_supply_color_1_work_time_since_replacement",
        2_880_000.0,
        "s",
    ),
}


class _FrozenModel(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True, str_strip_whitespace=True)


class CatalogSource(_FrozenModel):
    document: str = Field(min_length=1)
    sheet: str = Field(min_length=1)
    range: str = Field(min_length=1)
    company_catalog_attribute_count: Literal[168]
    selected_simulator_attribute_count: Literal[105]
    workbook_sha256: str = Field(pattern=r"^[0-9a-f]{64}$")
    snapshot_role: Literal["format_example_only"]


class MachineStatusDefinition(_FrozenModel):
    name: str = Field(min_length=1)
    code: int


class CatalogAttribute(_FrozenModel):
    source_index: int = Field(ge=1)
    name: str = Field(min_length=1)
    code: str = Field(pattern=r"^[a-z][a-z0-9_]*$")
    domain: str = Field(min_length=1)
    category: str = Field(min_length=1)
    component: str = Field(min_length=1)
    sub_component: str = Field(min_length=1)
    instance: str = Field(min_length=1)
    location: str = Field(min_length=1)
    position: str | int
    attribute: str = Field(min_length=1)
    unit: str = Field(min_length=1)
    enterprise_data_type: Literal["Datetime", "Decimal", "Integer", "JSON"]
    mqtt_payload_shape: Literal["scalar", "bounded_value"]


class DerivedMaximum(_FrozenModel):
    source_attribute: str = Field(pattern=r"^[a-z][a-z0-9_]*$")
    official_maximum: float = Field(gt=0)
    unit: Literal["d", "m", "s"]


class MvpSelection(_FrozenModel):
    source_attributes: tuple[str, ...]
    derived_maximum_attributes: dict[str, DerivedMaximum]


class DeferredEnterpriseMapping(_FrozenModel):
    code: str = Field(pattern=r"^[a-z][a-z0-9_]*$")
    mapping: str = Field(min_length=1)
    mvp_status: str = Field(min_length=1)


_CANONICAL_UNITS = {
    "Degrees Celsius": "degC",
    "Kilopascals": "kPa",
    "Meters": "m",
    "Millimeters": "mm",
    "Millimeters per Second": "mm/s",
    "Newton": "N",
    "Percentage": "%",
    "Rotations per Minute": "rpm",
    "Seconds": "s",
    "Days": "d",
}
_UNITLESS_OVERRIDES = {
    "iamalive": "UTC_timestamp",
    "machine_status": "status_code",
    "copies_requested": "count",
    "copies_printed": "count",
    "safety_relay_usage_emergency": "count",
    "safety_relay_usage_motion": "count",
    "contactor_usage_standby": "count",
}


class TelemetryCatalog(_FrozenModel):
    catalog_version: Literal["1.0.0"]
    machine_model: Literal["TPPPS4"]
    print_architecture: Literal["multipass"]
    source: CatalogSource
    machine_statuses: tuple[MachineStatusDefinition, ...]
    attributes: tuple[CatalogAttribute, ...]
    mvp_selection: MvpSelection
    deferred_enterprise_mappings: tuple[DeferredEnterpriseMapping, ...]
    synthetic_assumptions: tuple[str, ...]

    @model_validator(mode="after")
    def validate_catalog_contract(self) -> TelemetryCatalog:
        if len(self.attributes) != self.source.selected_simulator_attribute_count:
            raise ValueError("TPPPS4 catalog must contain exactly 105 simulator attributes")
        if len(self.attribute_codes) != len(self.attributes):
            raise ValueError("TPPPS4 catalog contains duplicate attribute codes")
        if len({attribute.source_index for attribute in self.attributes}) != len(self.attributes):
            raise ValueError("TPPPS4 catalog contains duplicate company source indexes")

        expected_statuses = {status.value: label for status, label in MACHINE_STATUS_LABELS.items()}
        actual_statuses = {
            code: definition.name for code, definition in self.machine_status_by_code.items()
        }
        if actual_statuses != expected_statuses or len(self.machine_statuses) != len(
            expected_statuses
        ):
            raise ValueError("machine-status catalog must contain the exact 25 TPPPS4 codes/names")

        selected = self.mvp_selection.source_attributes
        if len(selected) != 16 or len(selected) != len(set(selected)):
            raise ValueError("MVP must contain exactly 16 unique source attributes")
        unknown_selected = sorted(set(selected).difference(self.attribute_codes))
        if unknown_selected:
            raise ValueError(
                f"MVP references attributes outside the TPPPS4 stream: {unknown_selected}"
            )
        if "pressure_subtank_1" in selected or "pressure_supply_color_1" in selected:
            raise ValueError("the initial MVP must preserve the authorized 105-attribute stream")

        derived = self.mvp_selection.derived_maximum_attributes
        if len(derived) != 4 or len(derived) != len(set(derived)):
            raise ValueError("MVP must define exactly four unique normalized maximum fields")
        for name, definition in derived.items():
            if not name.endswith("_maximum"):
                raise ValueError("derived maximum names must end in _maximum")
            source = self.get_attribute(definition.source_attribute)
            if source.mqtt_payload_shape != "bounded_value":
                raise ValueError(f"derived maximum source is not bounded: {source.code}")
        actual_maxima = {
            name: (definition.source_attribute, definition.official_maximum, definition.unit)
            for name, definition in derived.items()
        }
        if actual_maxima != OFFICIAL_MVP_MAXIMA:
            raise ValueError("MVP derived fields must preserve the four official TPPPS4 maxima")
        if len(self.mvp_attributes) != len(set(self.mvp_attributes)):
            raise ValueError("MVP source and derived attributes must not overlap")
        for code in self.attribute_codes:
            self.unit_for(code)
        return self

    @property
    def attribute_codes(self) -> tuple[str, ...]:
        return tuple(attribute.code for attribute in self.attributes)

    @property
    def machine_status_by_code(self) -> dict[int, MachineStatusDefinition]:
        return {status.code: status for status in self.machine_statuses}

    @property
    def mvp_attributes(self) -> tuple[str, ...]:
        return (
            *self.mvp_selection.source_attributes,
            *self.mvp_selection.derived_maximum_attributes,
        )

    def get_attribute(self, code: str) -> CatalogAttribute:
        for attribute in self.attributes:
            if attribute.code == code:
                return attribute
        raise TelemetryCatalogError(f"unknown TPPPS4 telemetry attribute: {code!r}")

    def unit_for(self, code: str) -> str:
        derived = self.mvp_selection.derived_maximum_attributes.get(code)
        if derived is not None:
            return derived.unit
        attribute = self.get_attribute(code)
        if attribute.unit in _CANONICAL_UNITS:
            return _CANONICAL_UNITS[attribute.unit]
        override = _UNITLESS_OVERRIDES.get(code)
        if override is None:
            raise TelemetryCatalogError(f"no canonical unit defined for TPPPS4 attribute {code!r}")
        return override


def load_telemetry_catalog(config_directory: str | Path | None = None) -> TelemetryCatalog:
    """Load the checked-in, company-authorized TPPPS4 catalog."""

    resolved = discover_config_directory(config_directory)
    path = resolved / CATALOG_FILENAME
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
        return TelemetryCatalog.model_validate(payload)
    except (OSError, ValueError) as error:
        raise TelemetryCatalogError(f"invalid TPPPS4 telemetry catalog: {error}") from error


def machine_status_name(code: int | float) -> str:
    """Return the categorical status label while rejecting unknown or fractional codes."""

    if isinstance(code, float) and not code.is_integer():
        raise TelemetryCatalogError(f"unknown TPPPS4 machine status: {code!r}")
    try:
        normalized = MachineStatus(int(code))
    except (TypeError, ValueError) as error:
        raise TelemetryCatalogError(f"unknown TPPPS4 machine status: {code!r}") from error
    return MACHINE_STATUS_LABELS[normalized]


def collect_telemetry_catalog_report(
    config_directory: str | Path | None = None,
) -> dict[str, object]:
    """Return a compact JSON-safe catalog validation report."""

    catalog = load_telemetry_catalog(config_directory)
    return {
        "catalog_version": catalog.catalog_version,
        "machine_model": catalog.machine_model,
        "print_architecture": catalog.print_architecture,
        "attribute_count": len(catalog.attributes),
        "machine_status_count": len(catalog.machine_statuses),
        "selected_source_attribute_count": len(catalog.mvp_selection.source_attributes),
        "derived_attribute_count": len(catalog.mvp_selection.derived_maximum_attributes),
        "mvp_attribute_count": len(catalog.mvp_attributes),
        "snapshot_role": catalog.source.snapshot_role,
    }
