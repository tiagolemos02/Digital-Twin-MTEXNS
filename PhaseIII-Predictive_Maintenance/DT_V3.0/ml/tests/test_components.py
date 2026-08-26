from __future__ import annotations

import json
import subprocess
import sys
from copy import deepcopy
from pathlib import Path
from typing import Any, cast

import pytest
import yaml

from mtex_pdm.component_registry import (
    ComponentConfigError,
    MaintenanceMode,
    load_component_registry,
    parse_component_registry,
)
from mtex_pdm.contracts import ComponentKey, LabelSource

ML_ROOT = Path(__file__).resolve().parents[1]
CONFIG_DIR = ML_ROOT / "config"


def _components_document() -> dict[str, Any]:
    loaded = yaml.safe_load((CONFIG_DIR / "components.yaml").read_text(encoding="utf-8"))
    return cast(dict[str, Any], loaded)


def test_frozen_component_registry_exposes_the_four_mvp_components() -> None:
    registry = load_component_registry(CONFIG_DIR)

    assert registry.component_keys == tuple(ComponentKey)
    assert len(registry.list_components()) == 4

    distance = registry.get(ComponentKey.PRINT_BAR_DISTANCE)
    assert distance.maintenance_mode is MaintenanceMode.THRESHOLD
    assert distance.label_source is LabelSource.THRESHOLD_PROXY
    assert distance.primary_attribute == "print_bar_traveled_distance_since_last_pm"
    assert registry.observable_attributes(distance.key) == (
        "print_bar_traveled_distance_since_last_pm",
        "speed_mms_print_bar",
        "speed_rpm_print_bar",
        "machine_status",
        "copies_requested",
        "copies_printed",
        "ink_area_temperature",
        "ink_area_humidity",
        "print_bar_traveled_distance_since_last_pm_maximum",
    )


def test_registry_rejects_component_attributes_outside_telemetry_contract() -> None:
    document = deepcopy(_components_document())
    document["components"]["print_bar_calendar"]["component_attributes"].append(
        "unregistered_sensor"
    )

    with pytest.raises(
        ComponentConfigError,
        match=r"unknown telemetry attributes.*unregistered_sensor",
    ):
        parse_component_registry(document)


def test_registry_requires_the_exact_four_canonical_components() -> None:
    document = deepcopy(_components_document())
    del document["components"]["supply_pump_color_1"]

    with pytest.raises(ComponentConfigError, match="four canonical component keys and order"):
        parse_component_registry(document)


def test_registry_rejects_label_source_incompatible_with_maintenance_mode() -> None:
    document = deepcopy(_components_document())
    document["components"]["print_bar_calendar"]["label_source"] = "simulated_condition_event"

    with pytest.raises(
        ComponentConfigError,
        match=r"threshold.*requires label_source threshold_proxy",
    ):
        parse_component_registry(document)


def test_registry_rejects_event_and_reset_rules_from_the_wrong_mode() -> None:
    document = deepcopy(_components_document())
    document["components"]["transport_vacuum_filter"]["event_rule"] = (
        "observed_value_reaches_asof_maximum"
    )

    with pytest.raises(ComponentConfigError, match=r"condition.*event_rule"):
        parse_component_registry(document)


def test_registry_keeps_hidden_ground_truth_out_of_mqtt_and_features() -> None:
    document = deepcopy(_components_document())
    document["components"]["transport_vacuum_filter"]["hidden_state"]["permitted_in_features"] = (
        True
    )

    with pytest.raises(
        ComponentConfigError,
        match=r"hidden state cannot be published.*features",
    ):
        parse_component_registry(document)


def test_registry_requires_eta_to_use_the_component_primary_attribute() -> None:
    document = deepcopy(_components_document())
    document["components"]["print_bar_distance"]["eta"]["source_attribute"] = "speed_mms_print_bar"

    with pytest.raises(ComponentConfigError, match="ETA source must equal primary_attribute"):
        parse_component_registry(document)


def test_supply_pump_uses_only_signals_in_the_authorized_tppps4_stream() -> None:
    registry = load_component_registry(CONFIG_DIR)
    pump = registry.get(ComponentKey.SUPPLY_PUMP_COLOR_1)

    assert pump.component_attributes == ("pump_supply_color_1_work_time_since_replacement",)
    assert pump.synthetic_extensions == ()


def test_registry_requires_every_frozen_leakage_exclusion() -> None:
    document = deepcopy(_components_document())
    document["feature_exclusions"].remove("hidden_degradation")

    with pytest.raises(
        ComponentConfigError,
        match=r"missing leakage exclusions.*hidden_degradation",
    ):
        parse_component_registry(document)


def test_primary_attribute_must_be_a_component_signal() -> None:
    document = deepcopy(_components_document())
    calendar = document["components"]["print_bar_calendar"]
    calendar["primary_attribute"] = "machine_status"
    calendar["eta"]["source_attribute"] = "machine_status"

    with pytest.raises(ComponentConfigError, match="primary_attribute must be listed"):
        parse_component_registry(document)


def test_registry_preserves_the_frozen_label_contract() -> None:
    document = deepcopy(_components_document())
    document["label_contract"]["horizons_hours"] = [24]

    with pytest.raises(ComponentConfigError, match="horizons_hours"):
        parse_component_registry(document)


def test_components_check_cli_reports_the_operational_registry() -> None:
    process = subprocess.run(
        [
            sys.executable,
            "-m",
            "mtex_pdm",
            "components-check",
            "--config-dir",
            str(CONFIG_DIR),
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
    assert report["component_count"] == 4
    assert report["component_keys"] == [component.value for component in ComponentKey]
    assert report["shared_observable_attribute_count"] == 8
    assert report["all_observable_attribute_count"] == 20
    assert report["hidden_state_component_count"] == 2
    assert report["synthetic_extension_count"] == 0
    assert report["source_catalog_attribute_count"] == 105
    assert report["selected_source_attribute_count"] == 16
    assert report["derived_attribute_count"] == 4


def test_iamalive_remains_connectivity_only_not_a_component_feature() -> None:
    document = deepcopy(_components_document())
    document["components"]["print_bar_calendar"]["contextual_attributes"].append("iamalive")

    with pytest.raises(ComponentConfigError, match="iamalive is connectivity-only"):
        parse_component_registry(document)


def test_eta_is_enabled_for_every_mvp_component() -> None:
    document = deepcopy(_components_document())
    document["components"]["print_bar_calendar"]["eta"]["enabled"] = False

    with pytest.raises(ComponentConfigError, match="ETA must remain enabled"):
        parse_component_registry(document)


def test_registry_rejects_duplicate_component_attribute_references() -> None:
    document = deepcopy(_components_document())
    document["components"]["print_bar_distance"]["contextual_attributes"].append("machine_status")

    with pytest.raises(ComponentConfigError, match="attribute lists must be unique"):
        parse_component_registry(document)


def test_condition_component_requires_hidden_degradation_drivers() -> None:
    document = deepcopy(_components_document())
    document["components"]["transport_vacuum_filter"]["hidden_state"]["drivers"] = []

    with pytest.raises(ComponentConfigError, match="hidden state requires unique drivers"):
        parse_component_registry(document)


def test_condition_eta_is_explicitly_an_imperfect_baseline() -> None:
    document = deepcopy(_components_document())
    document["components"]["transport_vacuum_filter"]["eta"]["role"] = None

    with pytest.raises(ComponentConfigError, match="condition ETA role"):
        parse_component_registry(document)
