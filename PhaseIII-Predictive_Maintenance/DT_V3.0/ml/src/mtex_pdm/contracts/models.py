"""Versioned, serialisable contracts for predictive-maintenance artifacts."""

from __future__ import annotations

from datetime import UTC, datetime
from enum import StrEnum
from pathlib import PurePosixPath
from typing import Annotated, Any, Literal

from pydantic import (
    AfterValidator,
    AwareDatetime,
    BaseModel,
    BeforeValidator,
    ConfigDict,
    Field,
    FiniteFloat,
    PositiveInt,
    StringConstraints,
    WithJsonSchema,
    field_validator,
    model_validator,
)

from mtex_pdm.telemetry_catalog import machine_status_name

CONTRACT_VERSION: Literal["1.1.0"] = "1.1.0"
CONFIG_VERSION: Literal["1.1.0"] = "1.1.0"

SyntheticAssumption = Literal[
    "print_bar_effective_motion_is_time_compressed",
    "condition_events_are_synthetic_and_anchored_to_official_maxima",
    "momentary_enterprise_snapshot_does_not_calibrate_distributions",
]
DEFAULT_SYNTHETIC_ASSUMPTIONS: tuple[SyntheticAssumption, ...] = (
    "print_bar_effective_motion_is_time_compressed",
    "condition_events_are_synthetic_and_anchored_to_official_maxima",
    "momentary_enterprise_snapshot_does_not_calibrate_distributions",
)

Identifier = Annotated[
    str,
    StringConstraints(pattern=r"^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$"),
]
SemVer = Annotated[
    str,
    StringConstraints(pattern=r"^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$"),
]
Sha256 = Annotated[str, StringConstraints(pattern=r"^[0-9a-f]{64}$")]
GitCommit = Annotated[str, StringConstraints(pattern=r"^[0-9a-f]{7,64}$")]
Probability = Annotated[FiniteFloat, Field(ge=0.0, le=1.0)]
RelativeArtifactPath = Annotated[str, StringConstraints(min_length=1, max_length=512)]
UTCDateTime = Annotated[AwareDatetime, AfterValidator(lambda value: value.astimezone(UTC))]


def _parse_cratedb_timestamp(value: Any) -> Any:
    if isinstance(value, bool):
        raise ValueError("time_index cannot be a boolean")
    if isinstance(value, (int, float)):
        if not 100_000_000_000 <= value < 100_000_000_000_000:
            raise ValueError("numeric CrateDB time_index must be Unix milliseconds")
        return datetime.fromtimestamp(value / 1000, tz=UTC)
    return value


CrateTimestamp = Annotated[
    UTCDateTime,
    BeforeValidator(_parse_cratedb_timestamp),
    WithJsonSchema(
        {
            "oneOf": [
                {
                    "type": "integer",
                    "minimum": 100_000_000_000,
                    "exclusiveMaximum": 100_000_000_000_000,
                    "description": "CrateDB HTTP Unix timestamp in milliseconds",
                },
                {
                    "type": "string",
                    "format": "date-time",
                    "description": "Timezone-qualified ISO-8601 timestamp",
                },
            ]
        }
    ),
]


class ContractModel(BaseModel):
    """Strict base model shared by all persisted contracts."""

    model_config = ConfigDict(
        extra="forbid",
        frozen=True,
        str_strip_whitespace=True,
        use_enum_values=False,
    )


class DataSource(StrEnum):
    """Permitted provenance labels, kept distinct by experimental purpose."""

    SYNTHETIC_HISTORICAL = "synthetic_historical"
    MQTT_PROSPECTIVE = "mqtt_prospective"
    REAL_SHADOW = "real_shadow"


class DatasetSplit(StrEnum):
    TRAIN = "train"
    VALIDATION = "validation"
    TEST = "test"
    PROSPECTIVE = "prospective"
    SHADOW = "shadow"


class ComponentKey(StrEnum):
    PRINT_BAR_CALENDAR = "print_bar_calendar"
    PRINT_BAR_DISTANCE = "print_bar_distance"
    TRANSPORT_VACUUM_FILTER = "transport_vacuum_filter"
    SUPPLY_PUMP_COLOR_1 = "supply_pump_color_1"


class LabelSource(StrEnum):
    THRESHOLD_PROXY = "threshold_proxy"
    SIMULATED_CONDITION_EVENT = "simulated_condition_event"


class ArtifactStatus(StrEnum):
    DRAFT = "draft"
    COMPLETE = "complete"
    PARTIAL = "partial"
    FAILED = "failed"
    REJECTED = "rejected"
    PROMOTED = "promoted"


class FeatureDType(StrEnum):
    FLOAT64 = "float64"
    INT64 = "int64"
    BOOLEAN = "boolean"
    CATEGORY = "category"


class CrateTelemetryRow(ContractModel):
    """A row returned by the current QuantumLeap/CrateDB historical table."""

    model_config = ConfigDict(
        extra="ignore",
        frozen=True,
        str_strip_whitespace=True,
        use_enum_values=False,
    )

    entity_id: str = Field(min_length=1)
    entity_type: Literal["Machine"]
    time_index: CrateTimestamp
    fiware_servicepath: str | None = None
    iamalive: str | None = None
    machine_status: FiniteFloat | None = None
    copies_requested: FiniteFloat | None = None
    copies_printed: FiniteFloat | None = None
    ambient_temperature: FiniteFloat | None = None
    ambient_humidity: FiniteFloat | None = None
    ink_area_temperature: FiniteFloat | None = None
    ink_area_humidity: FiniteFloat | None = None
    print_bar_time_since_last_pm: FiniteFloat | None = None
    print_bar_time_since_last_pm_maximum: FiniteFloat | None = None
    print_bar_traveled_distance_since_last_pm: FiniteFloat | None = None
    print_bar_traveled_distance_since_last_pm_maximum: FiniteFloat | None = None
    transport_vacuum_work_time_since_last_air_filter_pm: FiniteFloat | None = None
    transport_vacuum_work_time_since_last_air_filter_pm_maximum: FiniteFloat | None = None
    pump_supply_color_1_work_time_since_replacement: FiniteFloat | None = None
    pump_supply_color_1_work_time_since_replacement_maximum: FiniteFloat | None = None
    speed_mms_print_bar: FiniteFloat | None = None
    speed_rpm_print_bar: FiniteFloat | None = None
    speed_mms_transport: FiniteFloat | None = None
    speed_rpm_transport: FiniteFloat | None = None

    @field_validator("machine_status")
    @classmethod
    def validate_machine_status(cls, value: float | None) -> float | None:
        if value is not None:
            machine_status_name(value)
        return value


class TelemetryRecord(ContractModel):
    """Canonical, privacy-safe row used after source ingestion."""

    schema_version: Literal["1.1.0"] = CONTRACT_VERSION
    machine_id: Identifier
    time_index: UTCDateTime
    data_source: DataSource
    split: DatasetSplit
    iamalive: str | None = None
    machine_status: FiniteFloat | None = None
    copies_requested: FiniteFloat | None = None
    copies_printed: FiniteFloat | None = None
    ambient_temperature: FiniteFloat | None = None
    ambient_humidity: FiniteFloat | None = None
    ink_area_temperature: FiniteFloat | None = None
    ink_area_humidity: FiniteFloat | None = None
    print_bar_time_since_last_pm: FiniteFloat | None = None
    print_bar_time_since_last_pm_maximum: FiniteFloat | None = None
    print_bar_traveled_distance_since_last_pm: FiniteFloat | None = None
    print_bar_traveled_distance_since_last_pm_maximum: FiniteFloat | None = None
    transport_vacuum_work_time_since_last_air_filter_pm: FiniteFloat | None = None
    transport_vacuum_work_time_since_last_air_filter_pm_maximum: FiniteFloat | None = None
    pump_supply_color_1_work_time_since_replacement: FiniteFloat | None = None
    pump_supply_color_1_work_time_since_replacement_maximum: FiniteFloat | None = None
    speed_mms_print_bar: FiniteFloat | None = None
    speed_rpm_print_bar: FiniteFloat | None = None
    speed_mms_transport: FiniteFloat | None = None
    speed_rpm_transport: FiniteFloat | None = None

    @field_validator("time_index")
    @classmethod
    def normalize_time_index(cls, value: datetime) -> datetime:
        return value.astimezone(UTC)

    @field_validator("machine_status")
    @classmethod
    def validate_machine_status(cls, value: float | None) -> float | None:
        if value is not None:
            machine_status_name(value)
        return value

    @model_validator(mode="after")
    def validate_source_split(self) -> TelemetryRecord:
        allowed = {
            DataSource.SYNTHETIC_HISTORICAL: {
                DatasetSplit.TRAIN,
                DatasetSplit.VALIDATION,
                DatasetSplit.TEST,
            },
            DataSource.MQTT_PROSPECTIVE: {DatasetSplit.PROSPECTIVE},
            DataSource.REAL_SHADOW: {DatasetSplit.SHADOW},
        }
        if self.split not in allowed[self.data_source]:
            raise ValueError(
                f"split {self.split.value!r} is incompatible with "
                f"data source {self.data_source.value!r}"
            )
        return self


_TELEMETRY_FIELDS = tuple(
    name
    for name in TelemetryRecord.model_fields
    if name not in {"schema_version", "machine_id", "time_index", "data_source", "split"}
)


def parse_cratedb_telemetry(
    row: dict[str, Any],
    *,
    machine_id: str,
) -> TelemetryRecord:
    """Validate a CrateDB row and remove its enterprise entity identifier."""

    source = CrateTelemetryRow.model_validate(row)
    values = source.model_dump(include=set(_TELEMETRY_FIELDS))
    return TelemetryRecord(
        machine_id=machine_id,
        time_index=source.time_index,
        data_source=DataSource.REAL_SHADOW,
        split=DatasetSplit.SHADOW,
        **values,
    )


class MaintenanceEvent(ContractModel):
    """One independent maintenance due/performed lifecycle."""

    schema_version: Literal["1.1.0"] = CONTRACT_VERSION
    event_id: Identifier
    machine_id: Identifier
    component_key: ComponentKey
    label_source: LabelSource
    data_source: Literal[
        DataSource.SYNTHETIC_HISTORICAL,
        DataSource.MQTT_PROSPECTIVE,
    ]
    split: Literal[
        DatasetSplit.TRAIN,
        DatasetSplit.VALIDATION,
        DatasetSplit.TEST,
        DatasetSplit.PROSPECTIVE,
    ]
    scenario_id: Identifier
    maintenance_due_at: UTCDateTime
    maintenance_performed_at: UTCDateTime | None = None
    censored: bool = False

    @model_validator(mode="after")
    def validate_event(self) -> MaintenanceEvent:
        if (
            self.data_source is DataSource.SYNTHETIC_HISTORICAL
            and self.split is DatasetSplit.PROSPECTIVE
        ):
            raise ValueError("synthetic historical events cannot use the prospective split")
        if (
            self.data_source is DataSource.MQTT_PROSPECTIVE
            and self.split is not DatasetSplit.PROSPECTIVE
        ):
            raise ValueError("MQTT prospective events require the prospective split")
        if (
            self.maintenance_performed_at is not None
            and self.maintenance_performed_at < self.maintenance_due_at
        ):
            raise ValueError("maintenance_performed_at cannot precede maintenance_due_at")
        if self.censored and self.maintenance_performed_at is not None:
            raise ValueError("a censored event cannot have maintenance_performed_at")
        threshold_components = {
            ComponentKey.PRINT_BAR_CALENDAR,
            ComponentKey.PRINT_BAR_DISTANCE,
        }
        expected = (
            LabelSource.THRESHOLD_PROXY
            if self.component_key in threshold_components
            else LabelSource.SIMULATED_CONDITION_EVENT
        )
        if self.label_source is not expected:
            raise ValueError(f"{self.component_key.value} requires label_source {expected.value}")
        return self


class ArtifactFile(ContractModel):
    path: RelativeArtifactPath
    sha256: Sha256
    size_bytes: int = Field(ge=0)
    media_type: str = Field(min_length=1)
    role: Identifier
    row_count: int | None = Field(default=None, ge=0)

    @field_validator("path")
    @classmethod
    def validate_relative_path(cls, value: str) -> str:
        path = PurePosixPath(value)
        if (
            value in {".", "/"}
            or value.endswith("/")
            or path.is_absolute()
            or ".." in path.parts
            or "\\" in value
        ):
            raise ValueError("artifact path must be a safe relative POSIX path")
        return value


class DatasetSplitSummary(ContractModel):
    machine_ids: tuple[Identifier, ...]
    row_count: int = Field(ge=0)
    event_count_by_component: dict[ComponentKey, int]

    @field_validator("machine_ids")
    @classmethod
    def unique_machine_ids(cls, value: tuple[str, ...]) -> tuple[str, ...]:
        if len(value) != len(set(value)):
            raise ValueError("machine_ids must be unique")
        return value

    @field_validator("event_count_by_component")
    @classmethod
    def validate_event_counts(
        cls,
        value: dict[ComponentKey, int],
    ) -> dict[ComponentKey, int]:
        if set(value) != set(ComponentKey):
            raise ValueError("event_count_by_component must contain all four components")
        if any(count < 0 for count in value.values()):
            raise ValueError("event counts cannot be negative")
        return value


class DatasetManifest(ContractModel):
    schema_version: Literal["1.1.0"] = CONTRACT_VERSION
    dataset_id: Identifier
    config_version: Literal["1.1.0"] = CONFIG_VERSION
    machine_profile: Literal["TPPPS4"] = "TPPPS4"
    print_architecture: Literal["multipass"] = "multipass"
    telemetry_catalog_version: Literal["1.0.0"] = "1.0.0"
    synthetic_assumptions: tuple[SyntheticAssumption, ...] = DEFAULT_SYNTHETIC_ASSUMPTIONS
    generator_version: SemVer
    code_commit: GitCommit
    created_at: UTCDateTime
    master_seed: int = Field(ge=0)
    start_time: UTCDateTime
    end_time: UTCDateTime
    resample_minutes: PositiveInt
    splits: dict[
        Literal[
            DatasetSplit.TRAIN,
            DatasetSplit.VALIDATION,
            DatasetSplit.TEST,
        ],
        DatasetSplitSummary,
    ]
    scenarios: tuple[Identifier, ...]
    units: dict[str, str]
    schema_hashes: dict[str, Sha256]
    config_checksums: dict[str, Sha256]
    files: tuple[ArtifactFile, ...]
    status: Literal[ArtifactStatus.DRAFT, ArtifactStatus.COMPLETE]

    @model_validator(mode="after")
    def validate_dataset(self) -> DatasetManifest:
        if self.synthetic_assumptions != DEFAULT_SYNTHETIC_ASSUMPTIONS:
            raise ValueError("dataset manifest must preserve the frozen synthetic assumptions")
        if self.end_time <= self.start_time:
            raise ValueError("end_time must be later than start_time")
        if set(self.splits) != {
            DatasetSplit.TRAIN,
            DatasetSplit.VALIDATION,
            DatasetSplit.TEST,
        }:
            raise ValueError("dataset manifest requires train, validation, and test splits")
        seen: set[str] = set()
        for split, summary in self.splits.items():
            overlap = seen.intersection(summary.machine_ids)
            if overlap:
                raise ValueError(
                    f"machine IDs must be split-disjoint; {sorted(overlap)!r} repeated at {split}"
                )
            seen.update(summary.machine_ids)
        paths = [artifact.path for artifact in self.files]
        if len(paths) != len(set(paths)):
            raise ValueError("artifact paths must be unique")
        if self.status is ArtifactStatus.COMPLETE and (
            not self.files or any(summary.row_count == 0 for summary in self.splits.values())
        ):
            raise ValueError("complete datasets require files and non-empty splits")
        if self.status is ArtifactStatus.COMPLETE:
            gates = (
                (self.splits[DatasetSplit.TRAIN], 100, "train"),
                (self.splits[DatasetSplit.VALIDATION], 30, "validation"),
                (self.splits[DatasetSplit.TEST], 30, "test"),
            )
            for summary, minimum, split_name in gates:
                counts = summary.event_count_by_component
                if any(count < minimum for count in counts.values()):
                    raise ValueError(
                        f"complete {split_name} split requires at least "
                        f"{minimum} independent events per component"
                    )
            if set(self.schema_hashes) != {"telemetry", "maintenance_events"}:
                raise ValueError(
                    "complete datasets require telemetry and maintenance_events schema hashes"
                )
            expected_configs = {
                "components.yaml",
                "decision_policy.yaml",
                "mvp.yaml",
                "scenarios.yaml",
                "tppps4_telemetry_catalog.json",
            }
            if set(self.config_checksums) != expected_configs:
                raise ValueError("complete datasets require all five frozen config checksums")
            numeric_unit_fields = set(_TELEMETRY_FIELDS).difference({"iamalive"})
            if not numeric_unit_fields.issubset(self.units) or "time_index" not in self.units:
                raise ValueError(
                    "complete datasets require units for time_index and every numeric "
                    "telemetry field"
                )
            if any(unit == "source_native_unconfirmed" for unit in self.units.values()):
                raise ValueError("complete datasets cannot contain unconfirmed source-native units")
        return self


class ExportManifest(ContractModel):
    schema_version: Literal["1.1.0"] = CONTRACT_VERSION
    export_id: Identifier
    requested_start_time: UTCDateTime
    requested_end_time: UTCDateTime
    actual_start_time: UTCDateTime | None = None
    actual_end_time: UTCDateTime | None = None
    lower_watermark: UTCDateTime | None = None
    upper_watermark: UTCDateTime | None = None
    row_count: int = Field(ge=0)
    machine_count: int = Field(ge=0)
    attributes: tuple[str, ...]
    pseudonymization_version: SemVer
    status: Literal[
        ArtifactStatus.COMPLETE,
        ArtifactStatus.PARTIAL,
        ArtifactStatus.FAILED,
    ]
    artifact: ArtifactFile | None = None
    created_at: UTCDateTime

    @model_validator(mode="after")
    def validate_export(self) -> ExportManifest:
        if self.requested_end_time <= self.requested_start_time:
            raise ValueError("requested export interval is invalid")
        if len(self.attributes) != len(set(self.attributes)):
            raise ValueError("export attributes must be unique")
        forbidden_attributes = {"entity_id", "__original_ngsi_entity__"}
        if forbidden_attributes.intersection(self.attributes):
            raise ValueError("export attributes cannot contain raw enterprise identifiers")
        if self.status is ArtifactStatus.COMPLETE:
            required = (
                self.actual_start_time,
                self.actual_end_time,
                self.lower_watermark,
                self.upper_watermark,
                self.artifact,
            )
            if any(value is None for value in required):
                raise ValueError("complete exports require actual range, watermarks, and artifact")
            if self.row_count == 0 or self.machine_count == 0:
                raise ValueError("complete exports must contain rows and machines")
        if (
            self.actual_start_time is not None
            and self.actual_end_time is not None
            and self.actual_end_time < self.actual_start_time
        ):
            raise ValueError("actual export interval is invalid")
        return self


class FeatureDefinition(ContractModel):
    name: Identifier
    position: int = Field(ge=0)
    dtype: FeatureDType
    unit: str = Field(min_length=1)
    window_hours: int | None = Field(default=None, gt=0)
    nullable: bool
    imputation: str = Field(min_length=1)
    components: tuple[ComponentKey, ...]

    @field_validator("components")
    @classmethod
    def validate_components(
        cls,
        value: tuple[ComponentKey, ...],
    ) -> tuple[ComponentKey, ...]:
        if not value or len(value) != len(set(value)):
            raise ValueError("components must be non-empty and unique")
        return value


FORBIDDEN_FEATURE_NAMES = frozenset(
    {
        "machine_id",
        "nominal_machine_profile",
        "simulator_seed",
        "scenario_id",
        "future_event_time",
        "hidden_degradation",
        "synthetic_cause",
        "label",
        "future_machine_status",
    }
)


class FeatureSchema(ContractModel):
    schema_version: Literal["1.1.0"] = CONTRACT_VERSION
    feature_set_id: Identifier
    target: Literal["maintenanceNeedProbability"]
    horizons_hours: tuple[Literal[24, 168], Literal[24, 168]]
    features: tuple[FeatureDefinition, ...]

    @model_validator(mode="after")
    def validate_feature_order(self) -> FeatureSchema:
        if self.horizons_hours != (24, 168):
            raise ValueError("horizons_hours must be ordered as [24, 168]")
        names = [feature.name for feature in self.features]
        if not names or len(names) != len(set(names)):
            raise ValueError("feature names must be non-empty and unique")
        forbidden = FORBIDDEN_FEATURE_NAMES.intersection(names)
        if forbidden:
            raise ValueError(f"forbidden leakage features: {sorted(forbidden)!r}")
        positions = [feature.position for feature in self.features]
        if positions != list(range(len(self.features))):
            raise ValueError("feature positions must be contiguous and ordered from zero")
        return self


class ModelManifest(ContractModel):
    schema_version: Literal["1.1.0"] = CONTRACT_VERSION
    model_version: SemVer
    dataset_id: Identifier
    generator_version: SemVer
    code_commit: GitCommit
    created_at: UTCDateTime
    architecture: Literal["global_per_horizon"]
    horizons_hours: tuple[Literal[24, 168], Literal[24, 168]]
    components: tuple[ComponentKey, ...]
    feature_schema_hash: Sha256
    hyperparameters: dict[str, Any]
    seeds: dict[str, int]
    calibration: dict[str, Any]
    thresholds: dict[Literal["24h", "7d"], Probability]
    metrics: dict[str, FiniteFloat]
    status: Literal[
        ArtifactStatus.DRAFT,
        ArtifactStatus.REJECTED,
        ArtifactStatus.PROMOTED,
    ]
    files: tuple[ArtifactFile, ...]

    @model_validator(mode="after")
    def validate_model(self) -> ModelManifest:
        if self.horizons_hours != (24, 168):
            raise ValueError("model horizons must be ordered as [24, 168]")
        if set(self.components) != set(ComponentKey) or len(self.components) != 4:
            raise ValueError("model must cover each canonical component exactly once")
        if set(self.thresholds) != {"24h", "7d"}:
            raise ValueError("thresholds must contain 24h and 7d")
        paths = [artifact.path for artifact in self.files]
        if len(paths) != len(set(paths)):
            raise ValueError("model artifact paths must be unique")
        if self.status is ArtifactStatus.PROMOTED and not self.files:
            raise ValueError("promoted models require artifact files")
        return self
