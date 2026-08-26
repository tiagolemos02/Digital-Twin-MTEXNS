from __future__ import annotations

from datetime import UTC, datetime, timedelta
from pathlib import Path

import pytest
import yaml

from mtex_pdm.contracts import CANONICAL_NUMERIC_ATTRIBUTES, ComponentKey, DatasetSplit, DataSource
from mtex_pdm.generator import (
    BehaviorParameters,
    GenerationConfig,
    GenerationMode,
    GeneratorCheckpoint,
    GeneratorEngine,
    InMemoryOutput,
    MachineBehavior,
    MachineSimulationSpec,
    MachineState,
    NumericSignal,
    ObservableMachineState,
    assemble_maintenance_events,
    supported_scenario_ids,
)
from mtex_pdm.telemetry_catalog import MachineStatus

ML_ROOT = Path(__file__).resolve().parents[1]


def _run_scenario(
    scenario_id: str,
    *,
    start_at: datetime = datetime(2026, 1, 5, 8, 0, tzinfo=UTC),
    ticks: int = 12,
    step_seconds: int = 300,
    master_seed: int = 20260729,
    behavior: MachineBehavior | None = None,
    initial_state: MachineState | None = None,
    split: DatasetSplit = DatasetSplit.TRAIN,
) -> InMemoryOutput:
    machine = MachineSimulationSpec(
        machine_id="synthetic-train-01",
        scenario_id=scenario_id,
        data_source=DataSource.SYNTHETIC_HISTORICAL,
        split=split,
        initial_state=initial_state or MachineState(),
    )
    config = GenerationConfig(
        mode=GenerationMode.OFFLINE,
        start_at=start_at,
        end_at=start_at + timedelta(seconds=step_seconds * ticks),
        step_seconds=step_seconds,
        master_seed=master_seed,
        machines=(machine,),
    )
    output = InMemoryOutput()
    GeneratorEngine(config, transition=behavior or MachineBehavior()).run(output)
    return output


def _value(output: InMemoryOutput, index: int, name: str) -> float:
    value = output.telemetry[index].observable.value(name)
    assert value is not None
    return value


def test_normal_operation_produces_complete_coherent_machine_state() -> None:
    output = _run_scenario("normal_operation")

    first = output.telemetry[0].observable
    assert {signal.name for signal in first.numeric_signals} == set(CANONICAL_NUMERIC_ATTRIBUTES)
    statuses = {_value(output, index, "machine_status") for index in range(len(output.telemetry))}
    assert statuses == {
        float(MachineStatus.PREPARING_TO_PRINT),
        float(MachineStatus.READY_TO_PRINT),
        float(MachineStatus.PRINTING),
        float(MachineStatus.PAUSED),
    }
    assert max(_value(output, index, "copies_requested") for index in range(12)) > 0.0
    assert max(_value(output, index, "copies_printed") for index in range(12)) > 0.0
    assert max(_value(output, index, "speed_mms_print_bar") for index in range(12)) > 0.0
    assert max(_value(output, index, "speed_mms_transport") for index in range(12)) > 0.0
    assert _value(output, 0, "print_bar_time_since_last_pm_maximum") == 90.0
    assert _value(output, 0, "print_bar_traveled_distance_since_last_pm_maximum") == 250.0
    assert _value(output, -1, "print_bar_time_since_last_pm") > _value(
        output, 0, "print_bar_time_since_last_pm"
    )
    assert _value(output, -1, "copies_printed") <= _value(output, -1, "copies_requested")
    assert len(output.ground_truth[-1].hidden.components) == 4
    assert output.events == ()


def test_calendar_uses_days_and_distance_only_advances_while_printing() -> None:
    active = _run_scenario("normal_operation", ticks=12)
    inactive = _run_scenario(
        "normal_operation",
        start_at=datetime(2026, 1, 5, 2, 0, tzinfo=UTC),
        ticks=12,
    )

    assert _value(active, -1, "print_bar_time_since_last_pm") == pytest.approx(1.0 / 24.0)
    assert _value(inactive, -1, "print_bar_time_since_last_pm") == pytest.approx(1.0 / 24.0)
    assert _value(active, -1, "print_bar_traveled_distance_since_last_pm") > 0.0
    assert _value(inactive, -1, "print_bar_traveled_distance_since_last_pm") == 0.0


def test_sensor_noise_changes_measurements_without_changing_hidden_process() -> None:
    noisy = _run_scenario("high_sensor_noise", split=DatasetSplit.TEST)
    clean = _run_scenario(
        "high_sensor_noise",
        split=DatasetSplit.TEST,
        behavior=MachineBehavior(
            BehaviorParameters(measurement_noise_scale=0.0),
        ),
    )

    clean_temperatures = [
        snapshot.observable.value("ambient_temperature") for snapshot in clean.telemetry
    ]
    noisy_temperatures = [
        snapshot.observable.value("ambient_temperature") for snapshot in noisy.telemetry
    ]
    assert noisy_temperatures != clean_temperatures
    assert [snapshot.hidden for snapshot in noisy.ground_truth] == [
        snapshot.hidden for snapshot in clean.ground_truth
    ]


def test_telemetry_gap_suppresses_measurements_but_process_keeps_advancing() -> None:
    output = _run_scenario("long_telemetry_gap", ticks=24, split=DatasetSplit.TEST)

    assert len(output.telemetry) == 18
    assert len(output.ground_truth) == 24
    assert _value(output, -1, "print_bar_time_since_last_pm") > _value(
        output, 0, "print_bar_time_since_last_pm"
    )
    vacuum = next(
        component
        for component in output.ground_truth[-1].hidden.components
        if component.component_key.value == "transport_vacuum_filter"
    )
    assert vacuum.degradation > 0.0


def test_limit_reconfiguration_changes_only_after_the_scheduled_boundary() -> None:
    output = _run_scenario("limit_reconfiguration", ticks=24, split=DatasetSplit.TEST)

    assert _value(output, 0, "print_bar_traveled_distance_since_last_pm_maximum") == 250.0
    assert _value(output, 11, "print_bar_traveled_distance_since_last_pm_maximum") == 250.0
    assert _value(output, 12, "print_bar_traveled_distance_since_last_pm_maximum") == 200.0
    assert _value(output, -1, "print_bar_traveled_distance_since_last_pm_maximum") == 200.0


def test_due_event_is_emitted_once_then_intervention_resets_only_that_component() -> None:
    initial_state = MachineState(
        observable=ObservableMachineState(
            numeric_signals=(NumericSignal(name="print_bar_time_since_last_pm", value=89.99),)
        )
    )
    behavior = MachineBehavior(
        BehaviorParameters(
            planned_delay_min_hours=1,
            planned_delay_max_hours=1,
        )
    )

    output = _run_scenario(
        "planned_maintenance",
        ticks=3,
        step_seconds=3600,
        behavior=behavior,
        initial_state=initial_state,
    )

    assert [event.kind.value for event in output.events] == [
        "maintenance_due",
        "maintenance_performed",
    ]
    assert output.events[0].event_id == output.events[1].event_id
    assert output.events[0].component_key is ComponentKey.PRINT_BAR_CALENDAR
    assert output.events[0].occurred_at == datetime(2026, 1, 5, 8, 0, tzinfo=UTC)
    assert output.events[1].occurred_at == datetime(2026, 1, 5, 9, 0, tzinfo=UTC)
    assert _value(output, 1, "print_bar_time_since_last_pm") == 0.0
    assert _value(output, 2, "print_bar_time_since_last_pm") == pytest.approx(1.0 / 24.0)
    assert _value(output, 1, "print_bar_traveled_distance_since_last_pm") > _value(
        output, 0, "print_bar_traveled_distance_since_last_pm"
    )


def test_runtime_markers_assemble_completed_and_censored_lifecycles() -> None:
    initial_state = MachineState(
        observable=ObservableMachineState(
            numeric_signals=(NumericSignal(name="print_bar_time_since_last_pm", value=89.99),)
        )
    )
    completed_output = _run_scenario(
        "planned_maintenance",
        ticks=3,
        step_seconds=3600,
        initial_state=initial_state,
        behavior=MachineBehavior(
            BehaviorParameters(planned_delay_min_hours=1, planned_delay_max_hours=1)
        ),
    )
    censored_output = _run_scenario(
        "delayed_intervention",
        ticks=1,
        step_seconds=3600,
        initial_state=initial_state,
    )

    completed = assemble_maintenance_events(
        completed_output.events,
        finalize_at=datetime(2026, 1, 5, 11, 0, tzinfo=UTC),
    )
    censored = assemble_maintenance_events(
        censored_output.events,
        finalize_at=datetime(2026, 1, 5, 9, 0, tzinfo=UTC),
    )

    assert len(completed) == 1
    assert completed[0].maintenance_performed_at == datetime(2026, 1, 5, 9, 0, tzinfo=UTC)
    assert not completed[0].censored
    assert len(censored) == 1
    assert censored[0].maintenance_performed_at is None
    assert censored[0].censored


def test_scenario_catalog_covers_frozen_pools_and_enforces_reservations() -> None:
    document = yaml.safe_load((ML_ROOT / "config" / "scenarios.yaml").read_text("utf-8"))
    configured: set[str] = set()
    for split in document["historical_split"].values():
        configured.update(split["scenario_pool"])
    configured.update(document["robustness_scenarios"]["scenarios"])
    configured.update(document["prospective_mqtt"]["scenario_pool"])

    assert configured <= set(supported_scenario_ids())
    with pytest.raises(ValueError, match="reserved from training"):
        _run_scenario("long_telemetry_gap")
    with pytest.raises(ValueError, match="requires mqtt_prospective"):
        _run_scenario("prospective_healthy")


def test_operation_scenarios_change_load_and_component_use_in_expected_direction() -> None:
    normal = _run_scenario("normal_operation", ticks=48)
    high = _run_scenario("high_production", ticks=48)
    intermittent = _run_scenario("intermittent_operation", ticks=48)

    normal_distance = _value(normal, -1, "print_bar_traveled_distance_since_last_pm")
    high_distance = _value(high, -1, "print_bar_traveled_distance_since_last_pm")
    intermittent_distance = _value(
        intermittent,
        -1,
        "print_bar_traveled_distance_since_last_pm",
    )
    assert high_distance > normal_distance > intermittent_distance


def test_physical_stress_scenarios_raise_relevant_signals_and_hidden_wear() -> None:
    normal = _run_scenario("normal_operation", ticks=96)
    hot = _run_scenario("temperature_stress", ticks=96)
    pump_stress = _run_scenario("supply_pump_stress", ticks=96)

    assert _value(hot, -1, "ambient_temperature") > _value(normal, -1, "ambient_temperature")
    normal_pump = next(
        component
        for component in normal.ground_truth[-1].hidden.components
        if component.component_key is ComponentKey.SUPPLY_PUMP_COLOR_1
    )
    hot_pump = next(
        component
        for component in hot.ground_truth[-1].hidden.components
        if component.component_key is ComponentKey.SUPPLY_PUMP_COLOR_1
    )
    stressed_pump = next(
        component
        for component in pump_stress.ground_truth[-1].hidden.components
        if component.component_key is ComponentKey.SUPPLY_PUMP_COLOR_1
    )
    assert hot_pump.degradation > normal_pump.degradation
    assert stressed_pump.degradation > normal_pump.degradation


def test_condition_wear_is_anchored_to_the_official_work_time_maximum() -> None:
    output = _run_scenario(
        "normal_operation",
        ticks=1,
        step_seconds=3600,
        behavior=MachineBehavior(BehaviorParameters(process_noise_fraction=0.0)),
    )

    vacuum = next(
        component
        for component in output.ground_truth[-1].hidden.components
        if component.component_key is ComponentKey.TRANSPORT_VACUUM_FILTER
    )
    pump = next(
        component
        for component in output.ground_truth[-1].hidden.components
        if component.component_key is ComponentKey.SUPPLY_PUMP_COLOR_1
    )
    assert vacuum.degradation == pytest.approx(3_600 / 144_000)
    assert pump.degradation == pytest.approx(3_600 / 2_880_000)


def test_condition_event_uses_hidden_threshold_and_urgent_delay() -> None:
    output = _run_scenario(
        "normal_operation",
        ticks=2,
        step_seconds=3600,
        behavior=MachineBehavior(
            BehaviorParameters(
                vacuum_condition_acceleration=40.0,
                process_noise_fraction=0.0,
                urgent_delay_min_hours=1,
                urgent_delay_max_hours=1,
            )
        ),
    )

    vacuum_events = [
        event
        for event in output.events
        if event.component_key is ComponentKey.TRANSPORT_VACUUM_FILTER
    ]
    assert [event.kind.value for event in vacuum_events] == [
        "maintenance_due",
        "maintenance_performed",
    ]
    assert vacuum_events[0].label_source.value == "simulated_condition_event"
    assert vacuum_events[0].severity.value == "urgent"
    assert (
        _value(
            output,
            1,
            "transport_vacuum_work_time_since_last_air_filter_pm",
        )
        == 0.0
    )


def test_machine_behavior_checkpoint_repeats_telemetry_hidden_state_and_events() -> None:
    start_at = datetime(2026, 1, 5, 8, 0, tzinfo=UTC)
    machine = MachineSimulationSpec(
        machine_id="synthetic-train-01",
        scenario_id="high_production",
        data_source=DataSource.SYNTHETIC_HISTORICAL,
        split=DatasetSplit.TRAIN,
    )
    config = GenerationConfig(
        mode=GenerationMode.OFFLINE,
        start_at=start_at,
        end_at=start_at + timedelta(hours=6),
        step_seconds=300,
        master_seed=20260729,
        machines=(machine,),
    )
    uninterrupted = InMemoryOutput()
    resumed = InMemoryOutput()
    GeneratorEngine(config, transition=MachineBehavior()).run(uninterrupted)

    first = GeneratorEngine(config, transition=MachineBehavior())
    first.run(resumed, max_ticks=17)
    checkpoint = GeneratorCheckpoint.model_validate_json(first.checkpoint().model_dump_json())
    GeneratorEngine.from_checkpoint(
        config,
        checkpoint,
        transition=MachineBehavior(),
    ).run(resumed)

    assert resumed.telemetry == uninterrupted.telemetry
    assert resumed.ground_truth == uninterrupted.ground_truth
    assert resumed.events == uninterrupted.events


def test_observation_scenarios_keep_invalid_missing_duplicate_and_delay_distinct() -> None:
    invalid = _run_scenario("invalid_sensor_burst", ticks=10, split=DatasetSplit.TEST)
    missing = _run_scenario("sensor_missing", ticks=1, split=DatasetSplit.TEST)
    duplicate = _run_scenario("telemetry_duplicate", ticks=2, split=DatasetSplit.TEST)
    delayed = _run_scenario("telemetry_delayed", ticks=2, split=DatasetSplit.TEST)

    assert _value(invalid, 8, "ambient_temperature") == -999.0
    assert missing.telemetry[0].observable.value("ambient_humidity") is None
    assert len(duplicate.telemetry) == 4
    assert len(duplicate.ground_truth) == 2
    assert delayed.telemetry[0].time_index == delayed.telemetry[1].time_index


def test_delayed_intervention_latches_one_due_event_without_reset() -> None:
    output = _run_scenario(
        "delayed_intervention",
        ticks=4,
        step_seconds=3600,
        initial_state=MachineState(
            observable=ObservableMachineState(
                numeric_signals=(NumericSignal(name="print_bar_time_since_last_pm", value=89.99),)
            )
        ),
    )

    assert [event.kind.value for event in output.events] == ["maintenance_due"]
    assert _value(output, -1, "print_bar_time_since_last_pm") == 90.0


def test_checkpoint_rejects_changed_behavior_parameters() -> None:
    start_at = datetime(2026, 1, 5, 8, 0, tzinfo=UTC)
    machine = MachineSimulationSpec(
        machine_id="synthetic-train-01",
        scenario_id="normal_operation",
        data_source=DataSource.SYNTHETIC_HISTORICAL,
        split=DatasetSplit.TRAIN,
    )
    config = GenerationConfig(
        mode=GenerationMode.OFFLINE,
        start_at=start_at,
        end_at=start_at + timedelta(hours=1),
        step_seconds=300,
        master_seed=20260729,
        machines=(machine,),
    )
    engine = GeneratorEngine(config, transition=MachineBehavior())
    engine.run(InMemoryOutput(), max_ticks=1)

    with pytest.raises(ValueError, match="transition does not match"):
        GeneratorEngine.from_checkpoint(
            config,
            engine.checkpoint(),
            transition=MachineBehavior(BehaviorParameters(copies_per_hour=144.0)),
        )
