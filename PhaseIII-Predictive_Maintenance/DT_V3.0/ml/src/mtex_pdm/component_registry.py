"""Typed registry for the four predictive-maintenance MVP components."""

from __future__ import annotations

from collections.abc import Mapping
from enum import StrEnum
from pathlib import Path
from typing import Any, Literal, cast

import yaml
from pydantic import BaseModel, ConfigDict, Field, ValidationError, model_validator

from mtex_pdm.config_validation import discover_config_directory, validate_frozen_config
from mtex_pdm.contracts import ComponentKey, LabelSource
from mtex_pdm.contracts.models import FORBIDDEN_FEATURE_NAMES
from mtex_pdm.contracts.tabular import (
    CANONICAL_NUMERIC_ATTRIBUTES,
    CRATEDB_REQUIRED_NUMERIC_ATTRIBUTES,
)
from mtex_pdm.telemetry_catalog import load_telemetry_catalog


class ComponentConfigError(ValueError):
    """Raised when component configuration cannot form a valid registry."""


class MaintenanceMode(StrEnum):
    THRESHOLD = "threshold"
    CONDITION = "condition"


class EventRule(StrEnum):
    OBSERVED_VALUE_REACHES_ASOF_MAXIMUM = "observed_value_reaches_asof_maximum"
    HIDDEN_DEGRADATION_REACHES_THRESHOLD = "hidden_degradation_reaches_threshold"


class ResetRule(StrEnum):
    OBSERVED_COUNTER_DROP_AFTER_MAINTENANCE = "observed_counter_drop_after_maintenance"
    GROUND_TRUTH_MAINTENANCE_EVENT_RESETS_HIDDEN_DEGRADATION = (
        "ground_truth_maintenance_event_resets_hidden_degradation"
    )


class _FrozenModel(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True, str_strip_whitespace=True)


class LabelContract(_FrozenModel):
    target: str = Field(min_length=1)
    allowed_initial_sources: tuple[LabelSource, ...]
    horizons_hours: tuple[int, ...]
    hidden_ground_truth_visibility: str = Field(min_length=1)

    @model_validator(mode="after")
    def validate_frozen_label_contract(self) -> LabelContract:
        if self.target != "maintenance_due_within_horizon":
            raise ValueError("label target must be maintenance_due_within_horizon")
        if self.allowed_initial_sources != tuple(LabelSource):
            raise ValueError("allowed_initial_sources must preserve both label sources")
        if self.horizons_hours != (24, 168):
            raise ValueError("horizons_hours must be ordered as [24, 168]")
        if self.hidden_ground_truth_visibility != "evaluation_only":
            raise ValueError("hidden ground truth visibility must be evaluation_only")
        return self


class SharedObservableAttributes(_FrozenModel):
    connectivity: tuple[str, ...]
    operation: tuple[str, ...]
    environment: tuple[str, ...]

    @property
    def all_attributes(self) -> tuple[str, ...]:
        return _unique((*self.connectivity, *self.operation, *self.environment))


class EtaDefinition(_FrozenModel):
    enabled: bool
    source_attribute: str = Field(min_length=1)
    role: str | None = None


class HiddenStateDefinition(_FrozenModel):
    published_to_mqtt: bool
    permitted_in_features: bool
    drivers: tuple[str, ...]


class SyntheticExtension(_FrozenModel):
    model_config = ConfigDict(
        extra="forbid",
        frozen=True,
        str_strip_whitespace=True,
        populate_by_name=True,
    )

    attribute: str = Field(min_length=1)
    ngsi_type: Literal["Number"] = Field(alias="type")
    purpose: str = Field(min_length=1)
    present_in_esp32_simulator: bool
    required_for_real_shadow: bool


class ComponentDefinition(_FrozenModel):
    key: ComponentKey
    display_name: str = Field(min_length=1)
    maintenance_mode: MaintenanceMode
    label_source: LabelSource
    primary_attribute: str = Field(min_length=1)
    observable_limit_attribute: str = Field(min_length=1)
    event_rule: EventRule
    reset_rule: ResetRule
    component_attributes: tuple[str, ...]
    contextual_attributes: tuple[str, ...]
    synthetic_extensions: tuple[SyntheticExtension, ...] = ()
    hidden_state: HiddenStateDefinition | None = None
    eta: EtaDefinition

    @model_validator(mode="after")
    def validate_component_semantics(self) -> ComponentDefinition:
        if self.maintenance_mode is MaintenanceMode.THRESHOLD:
            expected_label = LabelSource.THRESHOLD_PROXY
            expected_event = EventRule.OBSERVED_VALUE_REACHES_ASOF_MAXIMUM
            expected_reset = ResetRule.OBSERVED_COUNTER_DROP_AFTER_MAINTENANCE
        else:
            expected_label = LabelSource.SIMULATED_CONDITION_EVENT
            expected_event = EventRule.HIDDEN_DEGRADATION_REACHES_THRESHOLD
            expected_reset = ResetRule.GROUND_TRUTH_MAINTENANCE_EVENT_RESETS_HIDDEN_DEGRADATION
        if self.label_source is not expected_label:
            raise ValueError(
                f"{self.maintenance_mode.value} maintenance requires "
                f"label_source {expected_label.value}"
            )
        if self.event_rule is not expected_event:
            raise ValueError(
                f"{self.maintenance_mode.value} maintenance requires "
                f"event_rule {expected_event.value}"
            )
        if self.reset_rule is not expected_reset:
            raise ValueError(
                f"{self.maintenance_mode.value} maintenance requires "
                f"reset_rule {expected_reset.value}"
            )
        if self.maintenance_mode is MaintenanceMode.THRESHOLD and self.hidden_state is not None:
            raise ValueError("threshold maintenance cannot define hidden state")
        if self.maintenance_mode is MaintenanceMode.CONDITION and self.hidden_state is None:
            raise ValueError("condition maintenance requires hidden state")
        if self.hidden_state is not None and (
            self.hidden_state.published_to_mqtt or self.hidden_state.permitted_in_features
        ):
            raise ValueError("hidden state cannot be published to MQTT or permitted in features")
        if self.hidden_state is not None and (
            not self.hidden_state.drivers
            or len(self.hidden_state.drivers) != len(set(self.hidden_state.drivers))
        ):
            raise ValueError("hidden state requires unique drivers")
        if self.primary_attribute not in self.component_attributes:
            raise ValueError("primary_attribute must be listed in component_attributes")
        attribute_references = (
            *self.component_attributes,
            *self.contextual_attributes,
            self.observable_limit_attribute,
        )
        if len(attribute_references) != len(set(attribute_references)):
            raise ValueError("component attribute lists must be unique and non-overlapping")
        if "iamalive" in self.observable_attributes:
            raise ValueError("iamalive is connectivity-only and cannot be a component feature")
        if not self.eta.enabled:
            raise ValueError("ETA must remain enabled for every MVP component")
        if self.eta.source_attribute != self.primary_attribute:
            raise ValueError("ETA source must equal primary_attribute")
        if self.maintenance_mode is MaintenanceMode.THRESHOLD and self.eta.role is not None:
            raise ValueError("threshold ETA cannot define a condition-baseline role")
        if (
            self.maintenance_mode is MaintenanceMode.CONDITION
            and self.eta.role != "imperfect_condition_baseline"
        ):
            raise ValueError("condition ETA role must be imperfect_condition_baseline")
        if any(extension.present_in_esp32_simulator for extension in self.synthetic_extensions):
            raise ValueError("synthetic extensions cannot be present in the ESP32 simulator")
        if any(extension.required_for_real_shadow for extension in self.synthetic_extensions):
            raise ValueError("synthetic extensions cannot be required for real shadow data")
        return self

    @property
    def observable_attributes(self) -> tuple[str, ...]:
        return _unique(
            (
                *self.component_attributes,
                *self.contextual_attributes,
                self.observable_limit_attribute,
            )
        )


class ComponentRegistry(_FrozenModel):
    config_version: Literal["1.1.0"]
    label_contract: LabelContract
    shared_observable_attributes: SharedObservableAttributes
    components: tuple[ComponentDefinition, ...]
    feature_exclusions: tuple[str, ...]

    @model_validator(mode="after")
    def validate_telemetry_references(self) -> ComponentRegistry:
        if self.component_keys != tuple(ComponentKey):
            raise ValueError("registry must preserve the four canonical component keys and order")
        known_attributes = {"iamalive", *CANONICAL_NUMERIC_ATTRIBUTES}
        referenced_attributes = set(self.shared_observable_attributes.all_attributes)
        synthetic_only_attributes = set(CANONICAL_NUMERIC_ATTRIBUTES).difference(
            CRATEDB_REQUIRED_NUMERIC_ATTRIBUTES
        )
        for component in self.components:
            referenced_attributes.update(component.observable_attributes)
            declared_extensions = {
                extension.attribute for extension in component.synthetic_extensions
            }
            referenced_attributes.update(declared_extensions)
            undeclared_synthetic = sorted(
                set(component.observable_attributes)
                .intersection(synthetic_only_attributes)
                .difference(declared_extensions)
            )
            if undeclared_synthetic:
                raise ValueError(
                    "synthetic-only attributes must be declared as extensions: "
                    f"{undeclared_synthetic}"
                )
            extensions_outside_component = sorted(
                declared_extensions.difference(component.component_attributes)
            )
            if extensions_outside_component:
                raise ValueError(
                    "synthetic extensions must be listed in component_attributes: "
                    f"{extensions_outside_component}"
                )
        unknown_attributes = sorted(referenced_attributes.difference(known_attributes))
        if unknown_attributes:
            raise ValueError(f"unknown telemetry attributes: {unknown_attributes}")
        missing_exclusions = sorted(FORBIDDEN_FEATURE_NAMES.difference(self.feature_exclusions))
        if missing_exclusions:
            raise ValueError(f"missing leakage exclusions: {missing_exclusions}")
        return self

    @property
    def component_keys(self) -> tuple[ComponentKey, ...]:
        return tuple(component.key for component in self.components)

    def list_components(self) -> tuple[ComponentDefinition, ...]:
        """Return component definitions in their frozen configuration order."""

        return self.components

    def get(self, key: ComponentKey | str) -> ComponentDefinition:
        """Return one component or raise a domain-specific lookup error."""

        try:
            normalized_key = ComponentKey(key)
        except ValueError as error:
            raise ComponentConfigError(f"unknown component key: {key!r}") from error
        for component in self.components:
            if component.key is normalized_key:
                return component
        raise ComponentConfigError(f"component is not configured: {normalized_key.value}")

    def observable_attributes(self, key: ComponentKey | str) -> tuple[str, ...]:
        """Return the stable, de-duplicated telemetry interface for a component."""

        return self.get(key).observable_attributes

    @property
    def all_observable_attributes(self) -> tuple[str, ...]:
        """Return every telemetry attribute referenced by the four components."""

        values = list(self.shared_observable_attributes.all_attributes)
        for component in self.components:
            values.extend(component.observable_attributes)
        return _unique(tuple(values))


def _unique(values: tuple[str, ...]) -> tuple[str, ...]:
    return tuple(dict.fromkeys(values))


def parse_component_registry(document: Mapping[str, Any]) -> ComponentRegistry:
    """Parse one already-loaded components document through the public contract."""

    configured_components = document.get("components")
    if not isinstance(configured_components, Mapping):
        raise ComponentConfigError("components.yaml must contain a components mapping")
    prepared_components: list[dict[str, Any]] = []
    for raw_key, raw_definition in configured_components.items():
        if not isinstance(raw_definition, Mapping):
            raise ComponentConfigError(f"component {raw_key!r} must contain a mapping")
        prepared_components.append({"key": raw_key, **dict(raw_definition)})

    payload = {
        **dict(document),
        "components": prepared_components,
    }
    try:
        return ComponentRegistry.model_validate(payload)
    except ValidationError as error:
        raise ComponentConfigError(f"invalid component configuration: {error}") from error


def load_component_registry(
    config_directory: str | Path | None = None,
) -> ComponentRegistry:
    """Validate the frozen config and load its typed component registry."""

    resolved_directory = discover_config_directory(config_directory)
    validate_frozen_config(resolved_directory)
    components_path = resolved_directory / "components.yaml"
    loaded = yaml.safe_load(components_path.read_text(encoding="utf-8"))
    if not isinstance(loaded, Mapping):
        raise ComponentConfigError("components.yaml must contain a YAML mapping")
    return parse_component_registry(cast(Mapping[str, Any], loaded))


def collect_component_registry_report(
    config_directory: str | Path | None = None,
) -> dict[str, Any]:
    """Load the public registry and return a JSON-safe diagnostic summary."""

    resolved_directory = discover_config_directory(config_directory)
    registry = load_component_registry(resolved_directory)
    catalog = load_telemetry_catalog(resolved_directory)
    return {
        "healthy": True,
        "config_directory": str(resolved_directory),
        "config_version": registry.config_version,
        "component_count": len(registry.components),
        "component_keys": [key.value for key in registry.component_keys],
        "shared_observable_attribute_count": len(
            registry.shared_observable_attributes.all_attributes
        ),
        "all_observable_attribute_count": len(registry.all_observable_attributes),
        "hidden_state_component_count": sum(
            component.hidden_state is not None for component in registry.components
        ),
        "synthetic_extension_count": sum(
            len(component.synthetic_extensions) for component in registry.components
        ),
        "feature_exclusion_count": len(registry.feature_exclusions),
        "source_catalog_attribute_count": len(catalog.attributes),
        "selected_source_attribute_count": len(catalog.mvp_selection.source_attributes),
        "derived_attribute_count": len(catalog.mvp_selection.derived_maximum_attributes),
    }
