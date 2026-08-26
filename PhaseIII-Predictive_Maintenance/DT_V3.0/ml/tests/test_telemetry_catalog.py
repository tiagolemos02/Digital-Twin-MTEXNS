from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

import pytest

from mtex_pdm.telemetry_catalog import (
    MachineStatus,
    TelemetryCatalogError,
    load_telemetry_catalog,
    machine_status_name,
)

ML_ROOT = Path(__file__).resolve().parents[1]
CONFIG_DIR = ML_ROOT / "config"


def test_tppps4_catalog_preserves_the_authorized_105_attribute_contract() -> None:
    catalog = load_telemetry_catalog(CONFIG_DIR)

    assert catalog.machine_model == "TPPPS4"
    assert catalog.print_architecture == "multipass"
    assert len(catalog.attributes) == 105
    assert len(catalog.attribute_codes) == 105
    assert len(catalog.machine_statuses) == 25
    assert len(catalog.mvp_selection.source_attributes) == 16
    assert len(catalog.mvp_selection.derived_maximum_attributes) == 4
    assert len(catalog.mvp_attributes) == 20
    assert "pressure_subtank_1" not in catalog.attribute_codes
    assert "pressure_supply_color_1" not in catalog.mvp_attributes


def test_catalog_distinguishes_enterprise_type_mqtt_shape_and_normalized_unit() -> None:
    catalog = load_telemetry_catalog(CONFIG_DIR)

    calendar = catalog.get_attribute("print_bar_time_since_last_pm")
    pump = catalog.get_attribute("pump_supply_color_1_work_time_since_replacement")
    humidity = catalog.get_attribute("ambient_humidity")

    assert calendar.enterprise_data_type == "JSON"
    assert calendar.mqtt_payload_shape == "bounded_value"
    assert catalog.unit_for("print_bar_time_since_last_pm") == "d"
    assert pump.enterprise_data_type == "Integer"
    assert pump.mqtt_payload_shape == "bounded_value"
    assert catalog.unit_for("pump_supply_color_1_work_time_since_replacement") == "s"
    assert humidity.unit == "Percentage"
    assert catalog.unit_for("ambient_humidity") == "%"


def test_every_authorized_source_attribute_has_a_canonical_unit() -> None:
    catalog = load_telemetry_catalog(CONFIG_DIR)

    units = {code: catalog.unit_for(code) for code in catalog.attribute_codes}

    assert len(units) == 105
    assert units["safety_relay_usage_emergency"] == "count"
    assert units["safety_relay_usage_motion"] == "count"
    assert units["contactor_usage_standby"] == "count"


def test_official_tppps4_maxima_are_typed_derived_contract_fields() -> None:
    catalog = load_telemetry_catalog(CONFIG_DIR)

    maxima = catalog.mvp_selection.derived_maximum_attributes
    assert maxima["print_bar_time_since_last_pm_maximum"].official_maximum == 90
    assert maxima["print_bar_time_since_last_pm_maximum"].unit == "d"
    assert maxima["print_bar_traveled_distance_since_last_pm_maximum"].official_maximum == 250
    assert (
        maxima["transport_vacuum_work_time_since_last_air_filter_pm_maximum"].official_maximum
        == 144_000
    )
    assert (
        maxima["pump_supply_color_1_work_time_since_replacement_maximum"].official_maximum
        == 2_880_000
    )


def test_machine_status_codes_are_named_categories_not_an_ordinal_scale() -> None:
    catalog = load_telemetry_catalog(CONFIG_DIR)

    assert int(MachineStatus.IDLE) == 2
    assert int(MachineStatus.MAINTENANCE) == 11
    assert int(MachineStatus.PRINTING) == 203
    assert catalog.machine_status_by_code[203].name == "Printing"
    assert machine_status_name(206) == "Printing error"
    with pytest.raises(TelemetryCatalogError, match="unknown TPPPS4 machine status"):
        machine_status_name(4)


def test_catalog_records_why_the_confirmed_color_1_pressure_is_deferred() -> None:
    catalog = load_telemetry_catalog(CONFIG_DIR)

    mapping = catalog.deferred_enterprise_mappings[0]
    assert mapping.code == "pressure_subtank_1"
    assert mapping.mapping == "position_1_corresponds_to_color_1"
    assert mapping.mvp_status == "excluded_not_in_tppps4_105_stream"


def test_contracts_check_includes_the_tppps4_catalog() -> None:
    process = subprocess.run(
        [
            sys.executable,
            "-m",
            "mtex_pdm",
            "contracts-check",
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
    assert report["contract_version"] == "1.1.0"
    assert report["telemetry_catalog"]["machine_model"] == "TPPPS4"
    assert report["telemetry_catalog"]["attribute_count"] == 105
    assert report["telemetry_catalog"]["machine_status_count"] == 25
