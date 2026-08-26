"""Causal pilot behavior for the four synthetic maintenance components."""

from __future__ import annotations

import hashlib
import math
import random
from dataclasses import asdict, dataclass
from datetime import datetime, timedelta
from pathlib import Path

from pydantic import BaseModel, ConfigDict, Field, model_validator

from mtex_pdm.contracts import (
    CANONICAL_NUMERIC_ATTRIBUTES,
    ComponentKey,
    DatasetSplit,
    DataSource,
    LabelSource,
    canonical_sha256,
)
from mtex_pdm.generator.models import (
    ComponentHiddenState,
    GroundTruthEvent,
    GroundTruthEventKind,
    HiddenMachineState,
    MachineState,
    MaintenanceLifecycleStatus,
    MaintenanceSeverity,
    ObservableMachineState,
    StepContext,
    StepOutcome,
    TelemetryEmission,
)
from mtex_pdm.telemetry_catalog import MachineStatus, load_telemetry_catalog


class BehaviorParameters(BaseModel):
    """Typed TPPPS4 pilot parameters with explicit physical units and assumptions."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    ambient_temperature_baseline: float = 22.0
    ambient_humidity_baseline: float = 48.0
    print_bar_speed_mms_maximum: float = Field(default=800.0, gt=0.0)
    print_bar_speed_rpm_maximum: float = Field(default=1200.0, gt=0.0)
    transport_speed_mms_maximum: float = Field(default=700.0, gt=0.0)
    transport_speed_rpm_maximum: float = Field(default=1200.0, gt=0.0)
    copies_per_hour: float = Field(default=72.0, gt=0.0)
    print_bar_calendar_maximum: float = Field(default=90.0, gt=0.0)
    print_bar_distance_maximum: float = Field(default=250.0, gt=0.0)
    vacuum_work_maximum: float = Field(default=144_000.0, gt=0.0)
    pump_work_maximum: float = Field(default=2_880_000.0, gt=0.0)
    print_bar_effective_motion_fraction: float = Field(default=1.0 / 288.0, gt=0.0, le=1.0)
    vacuum_condition_acceleration: float = Field(default=1.0, gt=0.0)
    pump_condition_acceleration: float = Field(default=1.0, gt=0.0)
    process_noise_fraction: float = Field(default=0.04, ge=0.0)
    measurement_noise_scale: float = Field(default=0.03, ge=0.0)
    urgent_delay_min_hours: int = Field(default=1, ge=1)
    urgent_delay_max_hours: int = Field(default=8, ge=1)
    planned_delay_min_hours: int = Field(default=24, ge=1)
    planned_delay_max_hours: int = Field(default=72, ge=1)

    @model_validator(mode="after")
    def validate_delay_ranges(self) -> BehaviorParameters:
        if self.urgent_delay_min_hours > self.urgent_delay_max_hours:
            raise ValueError("urgent maintenance delay range is reversed")
        if self.planned_delay_min_hours > self.planned_delay_max_hours:
            raise ValueError("planned maintenance delay range is reversed")
        return self


@dataclass(frozen=True, slots=True)
class ScenarioProfile:
    production_multiplier: float = 1.0
    intermittent: bool = False
    temperature_offset: float = 0.0
    humidity_offset: float = 0.0
    degradation_multiplier: float = 1.0
    pump_stress_multiplier: float = 1.0
    sensor_noise_multiplier: float = 1.0
    telemetry_effect: str = "normal"
    maintenance_policy: str = "normal"
    distance_limit_multiplier: float = 1.0


_SCENARIOS: dict[str, ScenarioProfile] = {
    "normal_operation": ScenarioProfile(),
    "high_production": ScenarioProfile(production_multiplier=1.55),
    "intermittent_operation": ScenarioProfile(intermittent=True),
    "temperature_stress": ScenarioProfile(temperature_offset=8.0),
    "humidity_stress": ScenarioProfile(humidity_offset=22.0),
    "supply_pump_stress": ScenarioProfile(pump_stress_multiplier=1.8),
    "planned_maintenance": ScenarioProfile(maintenance_policy="planned"),
    "unseen_combined_stress": ScenarioProfile(
        production_multiplier=1.4,
        temperature_offset=7.0,
        humidity_offset=15.0,
        degradation_multiplier=1.8,
        pump_stress_multiplier=1.4,
    ),
    "unseen_accelerated_degradation": ScenarioProfile(degradation_multiplier=3.0),
    "limit_reconfiguration": ScenarioProfile(distance_limit_multiplier=0.8),
    "long_telemetry_gap": ScenarioProfile(telemetry_effect="long_gap"),
    "high_sensor_noise": ScenarioProfile(sensor_noise_multiplier=8.0),
    "invalid_sensor_burst": ScenarioProfile(telemetry_effect="invalid_burst"),
    "prospective_healthy": ScenarioProfile(),
    "prospective_calendar_wear": ScenarioProfile(),
    "prospective_intense_production": ScenarioProfile(production_multiplier=1.6),
    "prospective_temperature_stress": ScenarioProfile(temperature_offset=8.0),
    "prospective_pump_stress": ScenarioProfile(pump_stress_multiplier=1.8),
    "prospective_combined_stress": ScenarioProfile(
        production_multiplier=1.4,
        temperature_offset=7.0,
        degradation_multiplier=1.8,
        pump_stress_multiplier=1.4,
    ),
    "prospective_telemetry_gap": ScenarioProfile(telemetry_effect="long_gap"),
    "prospective_maintenance_reset": ScenarioProfile(degradation_multiplier=4.0),
    "prospective_delayed_intervention": ScenarioProfile(maintenance_policy="delayed"),
    "delayed_intervention": ScenarioProfile(maintenance_policy="delayed"),
    "sensor_missing": ScenarioProfile(telemetry_effect="sensor_missing"),
    "telemetry_duplicate": ScenarioProfile(telemetry_effect="duplicate"),
    "telemetry_delayed": ScenarioProfile(telemetry_effect="delayed"),
    "return_after_unavailability": ScenarioProfile(telemetry_effect="long_gap"),
}

_ROBUSTNESS_SCENARIOS = {
    "unseen_combined_stress",
    "unseen_accelerated_degradation",
    "limit_reconfiguration",
    "long_telemetry_gap",
    "high_sensor_noise",
    "invalid_sensor_burst",
    "sensor_missing",
    "telemetry_duplicate",
    "telemetry_delayed",
    "return_after_unavailability",
}
_PROSPECTIVE_SCENARIOS = {
    scenario_id for scenario_id in _SCENARIOS if scenario_id.startswith("prospective_")
}


def supported_scenario_ids() -> tuple[str, ...]:
    return tuple(_SCENARIOS)


def _initial_observable(parameters: BehaviorParameters) -> ObservableMachineState:
    values = {name: 0.0 for name in CANONICAL_NUMERIC_ATTRIBUTES}
    values.update(
        {
            "machine_status": float(MachineStatus.STANDBY),
            "ambient_temperature": parameters.ambient_temperature_baseline,
            "ambient_humidity": parameters.ambient_humidity_baseline,
            "ink_area_temperature": parameters.ambient_temperature_baseline,
            "ink_area_humidity": parameters.ambient_humidity_baseline,
            "print_bar_time_since_last_pm_maximum": (parameters.print_bar_calendar_maximum),
            "print_bar_traveled_distance_since_last_pm_maximum": (
                parameters.print_bar_distance_maximum
            ),
            "transport_vacuum_work_time_since_last_air_filter_pm_maximum": (
                parameters.vacuum_work_maximum
            ),
            "pump_supply_color_1_work_time_since_replacement_maximum": (
                parameters.pump_work_maximum
            ),
        }
    )
    return ObservableMachineState().with_values(values)


def _initial_hidden() -> HiddenMachineState:
    return HiddenMachineState(
        components=tuple(
            ComponentHiddenState(component_key=component, degradation=0.0)
            for component in ComponentKey
        ),
        scenario_phase="initialized",
    )


def _merge_initial_state(
    state: MachineState,
    parameters: BehaviorParameters,
) -> MachineState:
    observable = _initial_observable(parameters).with_values(
        {signal.name: float(signal.value) for signal in state.observable.numeric_signals}
    )
    provided_hidden = {component.component_key: component for component in state.hidden.components}
    hidden = _initial_hidden().model_copy(
        update={
            "components": tuple(
                provided_hidden.get(component.component_key, component)
                for component in _initial_hidden().components
            ),
            "scenario_phase": state.hidden.scenario_phase,
        }
    )
    return MachineState(observable=observable, hidden=hidden)


def _value(state: ObservableMachineState, name: str) -> float:
    value = state.value(name)
    if value is None:
        raise ValueError(f"behavior state is missing required signal {name!r}")
    return value


def _mean_revert(current: float, target: float, gain: float, noise: float) -> float:
    return current + (target - current) * gain + noise


def _measurement_rng(context: StepContext) -> random.Random:
    payload = f"{context.machine_seed}\0{context.step_index}\0measurement".encode()
    seed = int.from_bytes(hashlib.sha256(payload).digest()[:8], byteorder="big")
    return random.Random(seed)


def _telemetry_emissions(
    profile: ScenarioProfile,
    context: StepContext,
    measured: ObservableMachineState,
) -> tuple[TelemetryEmission, ...]:
    effect = profile.telemetry_effect
    phase = context.step_index % 24
    if effect == "long_gap" and 6 <= phase < 12:
        return ()
    if effect == "invalid_burst" and 8 <= phase < 10:
        measured = measured.with_value("ambient_temperature", -999.0)
    elif effect == "sensor_missing":
        measured = measured.without("ambient_humidity")
    if effect == "duplicate":
        emission = TelemetryEmission(time_index=context.time_index, observable=measured)
        return (emission, emission)
    if effect == "delayed" and context.step_index > 0:
        return (
            TelemetryEmission(
                time_index=context.time_index - timedelta(seconds=context.step_seconds),
                observable=measured,
            ),
        )
    return (TelemetryEmission(time_index=context.time_index, observable=measured),)


_COUNTER_BY_COMPONENT = {
    ComponentKey.PRINT_BAR_CALENDAR: "print_bar_time_since_last_pm",
    ComponentKey.PRINT_BAR_DISTANCE: "print_bar_traveled_distance_since_last_pm",
    ComponentKey.TRANSPORT_VACUUM_FILTER: ("transport_vacuum_work_time_since_last_air_filter_pm"),
    ComponentKey.SUPPLY_PUMP_COLOR_1: "pump_supply_color_1_work_time_since_replacement",
}
_MAXIMUM_BY_COMPONENT = {
    ComponentKey.PRINT_BAR_CALENDAR: "print_bar_time_since_last_pm_maximum",
    ComponentKey.PRINT_BAR_DISTANCE: "print_bar_traveled_distance_since_last_pm_maximum",
}
_CONDITION_COMPONENTS = {
    ComponentKey.TRANSPORT_VACUUM_FILTER,
    ComponentKey.SUPPLY_PUMP_COLOR_1,
}


def _event_id(context: StepContext, component: ComponentKey, sequence: int) -> str:
    payload = (
        f"{context.machine_seed}\0{context.machine_id}\0{component.value}\0{sequence}".encode()
    )
    digest = hashlib.sha256(payload).hexdigest()[:16]
    return f"evt-{component.value}-{sequence:04d}-{digest}"


def _label_source(component: ComponentKey) -> LabelSource:
    if component in _CONDITION_COMPONENTS:
        return LabelSource.SIMULATED_CONDITION_EVENT
    return LabelSource.THRESHOLD_PROXY


def _is_due(
    component: ComponentHiddenState,
    process: ObservableMachineState,
) -> bool:
    if component.component_key in _CONDITION_COMPONENTS:
        return component.degradation >= 1.0
    counter = _value(process, _COUNTER_BY_COMPONENT[component.component_key])
    maximum = _value(process, _MAXIMUM_BY_COMPONENT[component.component_key])
    return counter >= maximum


def _severity(component: ComponentKey, profile: ScenarioProfile) -> MaintenanceSeverity:
    if profile.maintenance_policy == "planned" or component not in _CONDITION_COMPONENTS:
        return MaintenanceSeverity.PLANNED
    return MaintenanceSeverity.URGENT


def _planned_time(
    context: StepContext,
    severity: MaintenanceSeverity,
    profile: ScenarioProfile,
    parameters: BehaviorParameters,
    rng: random.Random,
) -> datetime | None:
    if profile.maintenance_policy == "delayed":
        return None
    if severity is MaintenanceSeverity.URGENT:
        delay = rng.randint(
            parameters.urgent_delay_min_hours,
            parameters.urgent_delay_max_hours,
        )
    else:
        delay = rng.randint(
            parameters.planned_delay_min_hours,
            parameters.planned_delay_max_hours,
        )
    return context.time_index + timedelta(hours=delay)


def _runtime_event(
    *,
    component: ComponentHiddenState,
    kind: GroundTruthEventKind,
    context: StepContext,
) -> GroundTruthEvent:
    if (
        component.active_event_id is None
        or component.maintenance_due_at is None
        or component.active_severity is None
    ):
        raise ValueError("active maintenance component is missing event metadata")
    return GroundTruthEvent(
        event_id=component.active_event_id,
        kind=kind,
        machine_id=context.machine_id,
        component_key=component.component_key,
        label_source=_label_source(component.component_key),
        data_source=context.data_source,
        split=context.split,
        scenario_id=context.scenario_id,
        occurred_at=context.time_index,
        maintenance_due_at=component.maintenance_due_at,
        severity=component.active_severity,
    )


def _apply_maintenance(
    process: ObservableMachineState,
    hidden: HiddenMachineState,
    context: StepContext,
    profile: ScenarioProfile,
    parameters: BehaviorParameters,
    rng: random.Random,
) -> tuple[ObservableMachineState, HiddenMachineState, tuple[GroundTruthEvent, ...]]:
    updated_components: list[ComponentHiddenState] = []
    events: list[GroundTruthEvent] = []
    reset_values: dict[str, float] = {}
    performed_any = False

    for component in hidden.components:
        if (
            component.maintenance_status is MaintenanceLifecycleStatus.AWAITING_INTERVENTION
            and component.planned_maintenance_at is not None
            and component.planned_maintenance_at <= context.time_index
        ):
            events.append(
                _runtime_event(
                    component=component,
                    kind=GroundTruthEventKind.MAINTENANCE_PERFORMED,
                    context=context,
                )
            )
            reset_values[_COUNTER_BY_COMPONENT[component.component_key]] = 0.0
            updated_components.append(
                component.model_copy(
                    update={
                        "degradation": 0.0,
                        "synthetic_cause": "maintenance_reset",
                        "maintenance_status": MaintenanceLifecycleStatus.NORMAL,
                        "maintenance_due_at": None,
                        "planned_maintenance_at": None,
                        "active_event_id": None,
                        "active_severity": None,
                    }
                )
            )
            performed_any = True
            continue

        if component.maintenance_status is MaintenanceLifecycleStatus.NORMAL and _is_due(
            component, process
        ):
            sequence = component.event_sequence + 1
            severity = _severity(component.component_key, profile)
            active = component.model_copy(
                update={
                    "maintenance_status": MaintenanceLifecycleStatus.AWAITING_INTERVENTION,
                    "maintenance_due_at": context.time_index,
                    "planned_maintenance_at": _planned_time(
                        context,
                        severity,
                        profile,
                        parameters,
                        rng,
                    ),
                    "active_event_id": _event_id(
                        context,
                        component.component_key,
                        sequence,
                    ),
                    "active_severity": severity,
                    "event_sequence": sequence,
                }
            )
            events.append(
                _runtime_event(
                    component=active,
                    kind=GroundTruthEventKind.MAINTENANCE_DUE,
                    context=context,
                )
            )
            updated_components.append(active)
        else:
            updated_components.append(component)

    if performed_any:
        reset_values["machine_status"] = float(MachineStatus.MAINTENANCE)
    process = process.with_values(reset_values)
    hidden = hidden.model_copy(
        update={
            "components": tuple(updated_components),
            "scenario_phase": "maintenance" if performed_any else hidden.scenario_phase,
        }
    )
    return process, hidden, tuple(events)


def _operating_status(context: StepContext, profile: ScenarioProfile) -> MachineStatus:
    """Return a categorical TPPPS4 state without treating status codes as ordinal."""

    hour = context.time_index.hour
    if not 6 <= hour < 22:
        if hour in {5, 22}:
            return MachineStatus.STANDBY
        return MachineStatus.SHUTDOWN

    if profile.intermittent and (context.step_index // 2) % 2 != 0:
        return MachineStatus.PAUSED
    if context.step_seconds > 15 * 60:
        return MachineStatus.PRINTING

    steps_per_hour = max(4, 3600 // context.step_seconds)
    phase = context.step_index % steps_per_hour
    if phase == 0:
        return MachineStatus.PREPARING_TO_PRINT
    if phase == 1:
        return MachineStatus.READY_TO_PRINT
    if phase >= steps_per_hour - 2:
        return MachineStatus.PAUSED
    return MachineStatus.PRINTING


class MachineBehavior:
    """State transition with causal operation, environment, counters, and wear."""

    def __init__(self, parameters: BehaviorParameters | None = None) -> None:
        self.parameters = parameters or BehaviorParameters()

    def validate_catalog_alignment(self, config_directory: str | Path | None = None) -> None:
        """Fail before generation when behavior maxima diverge from the frozen catalog."""

        catalog = load_telemetry_catalog(config_directory)
        maxima = catalog.mvp_selection.derived_maximum_attributes
        expected = {
            "print_bar_calendar_maximum": maxima[
                "print_bar_time_since_last_pm_maximum"
            ].official_maximum,
            "print_bar_distance_maximum": maxima[
                "print_bar_traveled_distance_since_last_pm_maximum"
            ].official_maximum,
            "vacuum_work_maximum": maxima[
                "transport_vacuum_work_time_since_last_air_filter_pm_maximum"
            ].official_maximum,
            "pump_work_maximum": maxima[
                "pump_supply_color_1_work_time_since_replacement_maximum"
            ].official_maximum,
        }
        actual = {name: getattr(self.parameters, name) for name in expected}
        if actual != expected:
            raise ValueError(
                "behavior maxima do not match frozen TPPPS4 catalog: "
                f"expected={expected}, actual={actual}"
            )

    @property
    def fingerprint(self) -> str:
        """Bind checkpoints to this behavior version, parameters, and scenario catalog."""

        return canonical_sha256(
            {
                "behavior_version": "pilot-1.1.5",
                "parameters": self.parameters.model_dump(mode="json"),
                "scenarios": {
                    scenario_id: asdict(profile)
                    for scenario_id, profile in sorted(_SCENARIOS.items())
                },
            }
        )

    def __call__(
        self,
        state: MachineState,
        context: StepContext,
        rng: random.Random,
    ) -> StepOutcome:
        profile = _SCENARIOS.get(context.scenario_id)
        if profile is None:
            raise ValueError(f"unsupported generator scenario: {context.scenario_id!r}")
        if context.scenario_id in _ROBUSTNESS_SCENARIOS and context.split is DatasetSplit.TRAIN:
            raise ValueError(f"scenario {context.scenario_id!r} is reserved from training")
        if (
            context.scenario_id in _PROSPECTIVE_SCENARIOS
            and context.data_source is not DataSource.MQTT_PROSPECTIVE
        ):
            raise ValueError(f"scenario {context.scenario_id!r} requires mqtt_prospective data")
        if (
            context.data_source is DataSource.MQTT_PROSPECTIVE
            and context.scenario_id not in _PROSPECTIVE_SCENARIOS
        ):
            raise ValueError("mqtt_prospective machines require a prospective scenario")
        current = _merge_initial_state(state, self.parameters)
        step_hours = context.step_seconds / 3600.0
        machine_status = _operating_status(context, profile)
        active = machine_status is MachineStatus.PRINTING

        previous_requested = _value(current.observable, "copies_requested")
        previous_printed = _value(current.observable, "copies_printed")
        if active and (previous_requested <= 0.0 or previous_printed >= previous_requested):
            requested = float(
                rng.randint(
                    round(90 * profile.production_multiplier),
                    round(240 * profile.production_multiplier),
                )
            )
            printed = 0.0
        else:
            requested = previous_requested
            printed = previous_printed
        if active:
            printed = min(
                requested,
                printed + max(1.0, self.parameters.copies_per_hour * step_hours),
            )

        load = profile.production_multiplier if active else 0.0
        print_target = self.parameters.print_bar_speed_mms_maximum * 0.72 * load
        transport_target = self.parameters.transport_speed_mms_maximum * 0.76 * load
        print_mms = min(
            self.parameters.print_bar_speed_mms_maximum,
            max(
                0.0,
                _mean_revert(
                    _value(current.observable, "speed_mms_print_bar"),
                    print_target,
                    0.35,
                    rng.gauss(0.0, 0.3),
                ),
            ),
        )
        transport_mms = min(
            self.parameters.transport_speed_mms_maximum,
            max(
                0.0,
                _mean_revert(
                    _value(current.observable, "speed_mms_transport"),
                    transport_target,
                    0.35,
                    rng.gauss(0.0, 0.3),
                ),
            ),
        )
        print_rpm = min(
            self.parameters.print_bar_speed_rpm_maximum,
            print_mms
            / self.parameters.print_bar_speed_mms_maximum
            * self.parameters.print_bar_speed_rpm_maximum,
        )
        transport_rpm = min(
            self.parameters.transport_speed_rpm_maximum,
            transport_mms
            / self.parameters.transport_speed_mms_maximum
            * self.parameters.transport_speed_rpm_maximum,
        )

        day_angle = (
            2.0 * math.pi * (context.time_index.hour + context.time_index.minute / 60.0) / 24.0
        )
        ambient_target = (
            self.parameters.ambient_temperature_baseline
            + 1.8 * math.sin(day_angle - math.pi / 2.0)
            + profile.temperature_offset
        )
        ambient_temperature = _mean_revert(
            _value(current.observable, "ambient_temperature"),
            ambient_target,
            0.08,
            rng.gauss(0.0, 0.04),
        )
        humidity_target = (
            self.parameters.ambient_humidity_baseline
            - 4.0 * math.sin(day_angle - math.pi / 2.0)
            + profile.humidity_offset
        )
        ambient_humidity = min(
            100.0,
            max(
                0.0,
                _mean_revert(
                    _value(current.observable, "ambient_humidity"),
                    humidity_target,
                    0.08,
                    rng.gauss(0.0, 0.08),
                ),
            ),
        )
        ink_temperature = _mean_revert(
            _value(current.observable, "ink_area_temperature"),
            ambient_temperature + 5.0 * load,
            0.12,
            rng.gauss(0.0, 0.03),
        )
        ink_humidity = min(
            100.0,
            max(
                0.0,
                _mean_revert(
                    _value(current.observable, "ink_area_humidity"),
                    ambient_humidity - 2.0 * load,
                    0.10,
                    rng.gauss(0.0, 0.06),
                ),
            ),
        )
        distance_maximum = _value(
            current.observable,
            "print_bar_traveled_distance_since_last_pm_maximum",
        )
        if profile.distance_limit_multiplier != 1.0 and context.step_index >= 12:
            distance_maximum = (
                self.parameters.print_bar_distance_maximum * profile.distance_limit_multiplier
            )

        calendar_counter = min(
            self.parameters.print_bar_calendar_maximum,
            _value(current.observable, "print_bar_time_since_last_pm") + step_hours / 24.0,
        )
        effective_motion_seconds = (
            context.step_seconds * self.parameters.print_bar_effective_motion_fraction
            if active
            else 0.0
        )
        distance_counter = min(
            distance_maximum,
            _value(current.observable, "print_bar_traveled_distance_since_last_pm")
            + print_mms * effective_motion_seconds / 1000.0,
        )
        active_seconds = float(context.step_seconds if active else 0)
        vacuum_counter = min(
            self.parameters.vacuum_work_maximum,
            _value(
                current.observable,
                "transport_vacuum_work_time_since_last_air_filter_pm",
            )
            + active_seconds,
        )
        pump_counter = min(
            self.parameters.pump_work_maximum,
            _value(current.observable, "pump_supply_color_1_work_time_since_replacement")
            + active_seconds,
        )
        process = current.observable.with_values(
            {
                "machine_status": float(machine_status),
                "copies_requested": requested,
                "copies_printed": printed,
                "ambient_temperature": ambient_temperature,
                "ambient_humidity": ambient_humidity,
                "ink_area_temperature": ink_temperature,
                "ink_area_humidity": ink_humidity,
                "speed_mms_print_bar": print_mms,
                "speed_rpm_print_bar": print_rpm,
                "speed_mms_transport": transport_mms,
                "speed_rpm_transport": transport_rpm,
                "print_bar_time_since_last_pm": calendar_counter,
                "print_bar_traveled_distance_since_last_pm": distance_counter,
                "transport_vacuum_work_time_since_last_air_filter_pm": vacuum_counter,
                "pump_supply_color_1_work_time_since_replacement": pump_counter,
                "print_bar_traveled_distance_since_last_pm_maximum": distance_maximum,
            }
        )

        hidden_by_key = {
            component.component_key: component for component in current.hidden.components
        }
        updated_hidden: list[ComponentHiddenState] = []
        for component_key in ComponentKey:
            component = hidden_by_key[component_key]
            if component_key is ComponentKey.PRINT_BAR_CALENDAR:
                degradation = calendar_counter / self.parameters.print_bar_calendar_maximum
                cause = "elapsed_time"
            elif component_key is ComponentKey.PRINT_BAR_DISTANCE:
                degradation = distance_counter / distance_maximum
                cause = "production_distance"
            elif component_key is ComponentKey.TRANSPORT_VACUUM_FILTER:
                stress = (
                    profile.degradation_multiplier
                    * (1.0 + max(0.0, ambient_humidity - 65.0) / 70.0)
                    * (1.0 + max(0.0, profile.production_multiplier - 1.0) * 0.35)
                )
                degradation = component.degradation + (
                    active_seconds
                    / self.parameters.vacuum_work_maximum
                    * self.parameters.vacuum_condition_acceleration
                    * stress
                    * max(0.2, 1.0 + rng.gauss(0.0, self.parameters.process_noise_fraction))
                )
                cause = "vacuum_work_and_environment"
            else:
                temperature_stress = max(0.0, ink_temperature - 27.0) / 20.0
                production_stress = max(0.0, profile.production_multiplier - 1.0) * 0.35
                stress = (
                    profile.degradation_multiplier
                    * profile.pump_stress_multiplier
                    * (1.0 + temperature_stress + production_stress)
                )
                degradation = component.degradation + (
                    active_seconds
                    / self.parameters.pump_work_maximum
                    * self.parameters.pump_condition_acceleration
                    * stress
                    * max(0.2, 1.0 + rng.gauss(0.0, self.parameters.process_noise_fraction))
                )
                cause = "pump_work_temperature_production"
            updated_hidden.append(
                component.model_copy(
                    update={
                        "degradation": min(1.0, degradation),
                        "synthetic_cause": cause,
                    }
                )
            )
        hidden = current.hidden.model_copy(
            update={
                "components": tuple(updated_hidden),
                "scenario_phase": "active" if active else "idle",
            }
        )
        process, hidden, events = _apply_maintenance(
            process,
            hidden,
            context,
            profile,
            self.parameters,
            rng,
        )
        next_state = MachineState(observable=process, hidden=hidden)
        measurement_rng = _measurement_rng(context)
        measurement_scale = (
            self.parameters.measurement_noise_scale * profile.sensor_noise_multiplier
        )
        measured = process.with_values(
            {
                "ambient_temperature": ambient_temperature
                + measurement_rng.gauss(0.0, measurement_scale),
                "ambient_humidity": ambient_humidity
                + measurement_rng.gauss(0.0, measurement_scale * 2.0),
                "ink_area_temperature": ink_temperature
                + measurement_rng.gauss(0.0, measurement_scale),
                "ink_area_humidity": ink_humidity
                + measurement_rng.gauss(0.0, measurement_scale * 2.0),
                "speed_mms_print_bar": max(
                    0.0,
                    print_mms + measurement_rng.gauss(0.0, measurement_scale * 10.0),
                ),
                "speed_mms_transport": max(
                    0.0,
                    transport_mms + measurement_rng.gauss(0.0, measurement_scale * 10.0),
                ),
            }
        )
        return StepOutcome(
            next_state=next_state,
            telemetry=_telemetry_emissions(profile, context, measured),
            events=events,
        )


__all__ = [
    "BehaviorParameters",
    "MachineBehavior",
    "ScenarioProfile",
    "supported_scenario_ids",
]
