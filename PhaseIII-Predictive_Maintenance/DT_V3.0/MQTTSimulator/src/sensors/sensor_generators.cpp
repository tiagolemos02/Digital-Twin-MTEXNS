#include "sensor_generators.h"

#include "../../config.h"
#include "../utils/helpers.h"

#define VALUE_SENSOR(name, valueKind, valueParameter) \
  { name, valueKind, valueParameter, 0, 0, COUNTER_NONE }

#define COUNTER_SENSOR(name, counterIndex, counterMaximum, counterInitial, mode) \
  { name, SENSOR_MAINTENANCE_COUNTER, counterIndex, counterMaximum, counterInitial, mode }

const Sensor SensorGenerators::sensors[] = {
  VALUE_SENSOR("iamalive", SENSOR_HEARTBEAT, 0),
  VALUE_SENSOR("machine_status", SENSOR_MACHINE_STATUS, 0),
  VALUE_SENSOR("ambient_humidity", SENSOR_AMBIENT_HUMIDITY, 0),
  VALUE_SENSOR("ambient_temperature", SENSOR_AMBIENT_TEMPERATURE, 0),
  VALUE_SENSOR("ink_area_humidity", SENSOR_INK_AREA_HUMIDITY, 0),
  VALUE_SENSOR("ink_area_temperature", SENSOR_INK_AREA_TEMPERATURE, 0),
  VALUE_SENSOR("copies_requested", SENSOR_COPIES_REQUESTED, 0),
  VALUE_SENSOR("copies_printed", SENSOR_COPIES_PRINTED, 0),

  COUNTER_SENSOR("print_bar_traveled_distance_since_last_pm", 0, 250, 10, COUNTER_PRODUCTION_DISTANCE),
  COUNTER_SENSOR("print_bar_time_since_last_pm", 1, 90, 42, COUNTER_CALENDAR_TIME),
  VALUE_SENSOR("pressure_wiper_suction_head_1", SENSOR_PRESSURE_WIPER_SUCTION, 0),
  VALUE_SENSOR("pressure_wiper_suction_head_2", SENSOR_PRESSURE_WIPER_SUCTION, 1),
  VALUE_SENSOR("pressure_wiper_suction_head_3", SENSOR_PRESSURE_WIPER_SUCTION, 2),
  VALUE_SENSOR("pressure_wiper_suction_head_4", SENSOR_PRESSURE_WIPER_SUCTION, 3),
  VALUE_SENSOR("pressure_wiper_suction_head_5", SENSOR_PRESSURE_WIPER_SUCTION, 4),
  COUNTER_SENSOR("cap_station_traveled_distance_since_last_pm", 2, 500, 32, COUNTER_PRODUCTION_DISTANCE),
  COUNTER_SENSOR("cap_station_time_since_last_pm", 3, 90, 42, COUNTER_CALENDAR_TIME),
  VALUE_SENSOR("safety_relay_usage_emergency", SENSOR_SAFETY_RELAY_EMERGENCY, 0),
  VALUE_SENSOR("safety_relay_usage_motion", SENSOR_SAFETY_RELAY_MOTION, 0),
  VALUE_SENSOR("contactor_usage_standby", SENSOR_CONTACTOR_STANDBY, 0),

  COUNTER_SENSOR("transport_traveled_distance_since_last_pm", 4, 100000, 227, COUNTER_PRODUCTION_DISTANCE),
  COUNTER_SENSOR("transport_time_since_last_pm", 5, 60, 42, COUNTER_CALENDAR_TIME),
  COUNTER_SENSOR("transport_vacuum_work_time_since_last_air_filter_pm", 6, 144000, 1833, COUNTER_VACUUM_WORK),
  COUNTER_SENSOR("web_cleaner_vacuum_work_time_since_last_air_filter_pm", 7, 144000, 44, COUNTER_VACUUM_WORK),
  COUNTER_SENSOR("exit_belt_traveled_distance_since_last_pm", 8, 800000, 23685, COUNTER_PRODUCTION_DISTANCE),
  COUNTER_SENSOR("exit_belt_time_since_last_pm", 9, 90, 42, COUNTER_CALENDAR_TIME),
  COUNTER_SENSOR("feeder_overall_time_since_last_pm", 10, 90, 42, COUNTER_CALENDAR_TIME),
  COUNTER_SENSOR("feeder_transport_time_since_last_pm", 11, 90, 42, COUNTER_CALENDAR_TIME),
  COUNTER_SENSOR("feeder_transport_traveled_distance_since_last_pm", 12, 800000, 158, COUNTER_PRODUCTION_DISTANCE),
  COUNTER_SENSOR("feeder_vacuum_work_time_since_last_air_filter_pm", 13, 144000, 1835, COUNTER_VACUUM_WORK),
  COUNTER_SENSOR("stacker_overall_time_since_last_pm", 14, 90, 42, COUNTER_CALENDAR_TIME),
  COUNTER_SENSOR("stacker_lift_time_since_last_pm", 15, 90, 42, COUNTER_CALENDAR_TIME),
  COUNTER_SENSOR("stacker_lift_traveled_distance_since_last_pm", 16, 1000, 0, COUNTER_PRODUCTION_DISTANCE),

  VALUE_SENSOR("speed_mms_stacker_lift", SENSOR_SPEED_MMS, SPEED_STACKER_LIFT),
  VALUE_SENSOR("speed_rpm_stacker_lift", SENSOR_SPEED_RPM, SPEED_STACKER_LIFT),
  VALUE_SENSOR("speed_mms_feeder_transport", SENSOR_SPEED_MMS, SPEED_FEEDER_TRANSPORT),
  VALUE_SENSOR("speed_rpm_feeder_transport", SENSOR_SPEED_RPM, SPEED_FEEDER_TRANSPORT),
  VALUE_SENSOR("speed_mms_transport", SENSOR_SPEED_MMS, SPEED_TRANSPORT),
  VALUE_SENSOR("speed_rpm_transport", SENSOR_SPEED_RPM, SPEED_TRANSPORT),
  VALUE_SENSOR("speed_mms_cap_station", SENSOR_SPEED_MMS, SPEED_CAP_STATION),
  VALUE_SENSOR("speed_rpm_cap_station", SENSOR_SPEED_RPM, SPEED_CAP_STATION),
  VALUE_SENSOR("speed_mms_print_bar", SENSOR_SPEED_MMS, SPEED_PRINT_BAR),
  VALUE_SENSOR("speed_rpm_print_bar", SENSOR_SPEED_RPM, SPEED_PRINT_BAR),
  VALUE_SENSOR("speed_mms_exit_belt", SENSOR_SPEED_MMS, SPEED_EXIT_BELT),
  VALUE_SENSOR("speed_rpm_exit_belt", SENSOR_SPEED_RPM, SPEED_EXIT_BELT),
  VALUE_SENSOR("speed_mms_feeder_dispenser", SENSOR_SPEED_MMS, SPEED_FEEDER_DISPENSER),
  VALUE_SENSOR("speed_rpm_feeder_dispenser", SENSOR_SPEED_RPM, SPEED_FEEDER_DISPENSER),

  COUNTER_SENSOR("pump_supply_color_1_work_time_since_replacement", 17, 2880000, 112, COUNTER_SUPPLY_PUMP_WORK),
  COUNTER_SENSOR("pump_supply_color_1_time_since_replacement", 18, 360, 87, COUNTER_CALENDAR_TIME),
  COUNTER_SENSOR("pump_supply_color_2_work_time_since_replacement", 19, 2880000, 98, COUNTER_SUPPLY_PUMP_WORK),
  COUNTER_SENSOR("pump_supply_color_2_time_since_replacement", 20, 360, 87, COUNTER_CALENDAR_TIME),
  COUNTER_SENSOR("pump_supply_color_3_work_time_since_replacement", 21, 2880000, 59, COUNTER_SUPPLY_PUMP_WORK),
  COUNTER_SENSOR("pump_supply_color_3_time_since_replacement", 22, 360, 87, COUNTER_CALENDAR_TIME),
  COUNTER_SENSOR("pump_supply_color_4_work_time_since_replacement", 23, 2880000, 151, COUNTER_SUPPLY_PUMP_WORK),
  COUNTER_SENSOR("pump_supply_color_4_time_since_replacement", 24, 360, 87, COUNTER_CALENDAR_TIME),

  COUNTER_SENSOR("pump_recirculation_head_1_work_time_since_replacement", 25, 2880000, 4306, COUNTER_SUPPLY_PUMP_WORK),
  COUNTER_SENSOR("pump_recirculation_head_1_time_since_replacement", 26, 360, 87, COUNTER_CALENDAR_TIME),
  COUNTER_SENSOR("pump_recirculation_head_2_work_time_since_replacement", 27, 2880000, 3966, COUNTER_SUPPLY_PUMP_WORK),
  COUNTER_SENSOR("pump_recirculation_head_2_time_since_replacement", 28, 360, 87, COUNTER_CALENDAR_TIME),
  COUNTER_SENSOR("pump_recirculation_head_3_work_time_since_replacement", 29, 2880000, 4136, COUNTER_SUPPLY_PUMP_WORK),
  COUNTER_SENSOR("pump_recirculation_head_3_time_since_replacement", 30, 360, 87, COUNTER_CALENDAR_TIME),
  COUNTER_SENSOR("pump_recirculation_head_4_work_time_since_replacement", 31, 2880000, 3966, COUNTER_SUPPLY_PUMP_WORK),
  COUNTER_SENSOR("pump_recirculation_head_4_time_since_replacement", 32, 360, 87, COUNTER_CALENDAR_TIME),
  COUNTER_SENSOR("pump_recirculation_head_5_work_time_since_replacement", 33, 2880000, 4307, COUNTER_SUPPLY_PUMP_WORK),
  COUNTER_SENSOR("pump_recirculation_head_5_time_since_replacement", 34, 360, 87, COUNTER_CALENDAR_TIME),

  COUNTER_SENSOR("pump_wiper_waste_head_1_work_time_since_replacement", 35, 2880000, 137, COUNTER_CLEANING_PUMP_WORK),
  COUNTER_SENSOR("pump_wiper_waste_head_1_time_since_replacement", 36, 360, 87, COUNTER_CALENDAR_TIME),
  COUNTER_SENSOR("pump_wiper_waste_head_2_work_time_since_replacement", 37, 2880000, 137, COUNTER_CLEANING_PUMP_WORK),
  COUNTER_SENSOR("pump_wiper_waste_head_2_time_since_replacement", 38, 360, 87, COUNTER_CALENDAR_TIME),
  COUNTER_SENSOR("pump_wiper_waste_head_3_work_time_since_replacement", 39, 2880000, 137, COUNTER_CLEANING_PUMP_WORK),
  COUNTER_SENSOR("pump_wiper_waste_head_3_time_since_replacement", 40, 360, 87, COUNTER_CALENDAR_TIME),
  COUNTER_SENSOR("pump_wiper_waste_head_4_work_time_since_replacement", 41, 2880000, 137, COUNTER_CLEANING_PUMP_WORK),
  COUNTER_SENSOR("pump_wiper_waste_head_4_time_since_replacement", 42, 360, 87, COUNTER_CALENDAR_TIME),
  COUNTER_SENSOR("pump_wiper_waste_head_5_work_time_since_replacement", 43, 2880000, 137, COUNTER_CLEANING_PUMP_WORK),
  COUNTER_SENSOR("pump_wiper_waste_head_5_time_since_replacement", 44, 360, 87, COUNTER_CALENDAR_TIME),

  COUNTER_SENSOR("pump_wiper_suction_head_1_work_time_since_replacement", 45, 2880000, 519, COUNTER_CLEANING_PUMP_WORK),
  COUNTER_SENSOR("pump_wiper_suction_head_1_time_since_replacement", 46, 360, 87, COUNTER_CALENDAR_TIME),
  COUNTER_SENSOR("pump_wiper_suction_head_2_work_time_since_replacement", 47, 2880000, 440, COUNTER_CLEANING_PUMP_WORK),
  COUNTER_SENSOR("pump_wiper_suction_head_2_time_since_replacement", 48, 360, 87, COUNTER_CALENDAR_TIME),
  COUNTER_SENSOR("pump_wiper_suction_head_3_work_time_since_replacement", 49, 2880000, 483, COUNTER_CLEANING_PUMP_WORK),
  COUNTER_SENSOR("pump_wiper_suction_head_3_time_since_replacement", 50, 360, 87, COUNTER_CALENDAR_TIME),
  COUNTER_SENSOR("pump_wiper_suction_head_4_work_time_since_replacement", 51, 2880000, 467, COUNTER_CLEANING_PUMP_WORK),
  COUNTER_SENSOR("pump_wiper_suction_head_4_time_since_replacement", 52, 360, 87, COUNTER_CALENDAR_TIME),
  COUNTER_SENSOR("pump_wiper_suction_head_5_work_time_since_replacement", 53, 2880000, 547, COUNTER_CLEANING_PUMP_WORK),
  COUNTER_SENSOR("pump_wiper_suction_head_5_time_since_replacement", 54, 360, 87, COUNTER_CALENDAR_TIME),

  COUNTER_SENSOR("pump_cap_waste_head_1_work_time_since_replacement", 55, 2880000, 564, COUNTER_CLEANING_PUMP_WORK),
  COUNTER_SENSOR("pump_cap_waste_head_1_time_since_replacement", 56, 360, 87, COUNTER_CALENDAR_TIME),
  COUNTER_SENSOR("pump_cap_waste_head_2_work_time_since_replacement", 57, 2880000, 515, COUNTER_CLEANING_PUMP_WORK),
  COUNTER_SENSOR("pump_cap_waste_head_2_time_since_replacement", 58, 360, 87, COUNTER_CALENDAR_TIME),
  COUNTER_SENSOR("pump_cap_waste_head_3_work_time_since_replacement", 59, 2880000, 539, COUNTER_CLEANING_PUMP_WORK),
  COUNTER_SENSOR("pump_cap_waste_head_3_time_since_replacement", 60, 360, 87, COUNTER_CALENDAR_TIME),
  COUNTER_SENSOR("pump_cap_waste_head_4_work_time_since_replacement", 61, 2880000, 515, COUNTER_CLEANING_PUMP_WORK),
  COUNTER_SENSOR("pump_cap_waste_head_4_time_since_replacement", 62, 360, 87, COUNTER_CALENDAR_TIME),
  COUNTER_SENSOR("pump_cap_waste_head_5_work_time_since_replacement", 63, 2880000, 564, COUNTER_CLEANING_PUMP_WORK),
  COUNTER_SENSOR("pump_cap_waste_head_5_time_since_replacement", 64, 360, 87, COUNTER_CALENDAR_TIME),

  COUNTER_SENSOR("pump_positive_pressure_head_1_work_time_since_replacement", 65, 2880000, 9, COUNTER_CLEANING_PUMP_WORK),
  COUNTER_SENSOR("pump_positive_pressure_head_1_time_since_replacement", 66, 360, 87, COUNTER_CALENDAR_TIME),
  COUNTER_SENSOR("pump_positive_pressure_head_2_work_time_since_replacement", 67, 2880000, 9, COUNTER_CLEANING_PUMP_WORK),
  COUNTER_SENSOR("pump_positive_pressure_head_2_time_since_replacement", 68, 360, 87, COUNTER_CALENDAR_TIME),
  COUNTER_SENSOR("pump_positive_pressure_head_3_work_time_since_replacement", 69, 2880000, 9, COUNTER_CLEANING_PUMP_WORK),
  COUNTER_SENSOR("pump_positive_pressure_head_3_time_since_replacement", 70, 360, 87, COUNTER_CALENDAR_TIME),
  COUNTER_SENSOR("pump_positive_pressure_head_4_work_time_since_replacement", 71, 2880000, 9, COUNTER_CLEANING_PUMP_WORK),
  COUNTER_SENSOR("pump_positive_pressure_head_4_time_since_replacement", 72, 360, 87, COUNTER_CALENDAR_TIME),
  COUNTER_SENSOR("pump_positive_pressure_head_5_work_time_since_replacement", 73, 2880000, 9, COUNTER_CLEANING_PUMP_WORK),
  COUNTER_SENSOR("pump_positive_pressure_head_5_time_since_replacement", 74, 360, 87, COUNTER_CALENDAR_TIME)
};

const uint8_t SensorGenerators::SENSOR_COUNT = sizeof(sensors) / sizeof(sensors[0]);

namespace {

const uint16_t PRODUCTION_STATUS_SEQUENCE[] = { 203, 203, 9, 201, 202, 203, 203 };
const uint16_t INTERMITTENT_STATUS_SEQUENCE[] = { 2, 12, 2, 201, 202, 203, 2 };
const uint16_t MAINTENANCE_STATUS_SEQUENCE[] = { 11, 200, 200, 2, 11 };

const float SPEED_MMS_MAXIMUMS[SPEED_COMPONENT_COUNT] = {
  90.0f, 420.0f, 700.0f, 90.0f, 800.0f, 600.0f, 160.0f
};

const float SPEED_RPM_MAXIMUMS[SPEED_COMPONENT_COUNT] = {
  700.0f, 900.0f, 1200.0f, 450.0f, 1200.0f, 1000.0f, 650.0f
};

float clampFloat(float value, float minimum, float maximum) {
  if (value < minimum) return minimum;
  if (value > maximum) return maximum;
  return value;
}

uint32_t clampCounter(uint32_t value, uint32_t maximum) {
  return value > maximum ? maximum : value;
}

float randomWalk(float current, float minimum, float maximum, float maximumStep) {
  const float next = current + Helpers::randomFloat(-maximumStep, maximumStep);
  return clampFloat(next, minimum, maximum);
}

float profileActivityScale(MachineProfile profile) {
  switch (profile) {
    case PROFILE_PRODUCTION: return 1.0f;
    case PROFILE_INTERMITTENT: return 0.72f;
    case PROFILE_MAINTENANCE: return 0.45f;
    default: return 1.0f;
  }
}

float profileCounterScale(MachineProfile profile) {
  switch (profile) {
    case PROFILE_PRODUCTION: return 1.0f;
    case PROFILE_INTERMITTENT: return 0.65f;
    case PROFILE_MAINTENANCE: return 0.85f;
    default: return 1.0f;
  }
}

bool isPrinting(uint16_t status) {
  return status == 203;
}

bool isPreparing(uint16_t status) {
  return status == 201 || status == 202;
}

bool isCleaning(uint16_t status) {
  return status == 200 || status == 11;
}

bool isMotionActive(uint16_t status) {
  return isPrinting(status) || isPreparing(status) || status == 200;
}

unsigned long randomStatusDuration() {
  return (unsigned long)random(
    (long)STATUS_CHANGE_MIN_MS,
    (long)STATUS_CHANGE_MAX_MS + 1L
  );
}

void statusSequence(MachineProfile profile, const uint16_t*& sequence, uint8_t& count) {
  switch (profile) {
    case PROFILE_PRODUCTION:
      sequence = PRODUCTION_STATUS_SEQUENCE;
      count = sizeof(PRODUCTION_STATUS_SEQUENCE) / sizeof(PRODUCTION_STATUS_SEQUENCE[0]);
      break;
    case PROFILE_INTERMITTENT:
      sequence = INTERMITTENT_STATUS_SEQUENCE;
      count = sizeof(INTERMITTENT_STATUS_SEQUENCE) / sizeof(INTERMITTENT_STATUS_SEQUENCE[0]);
      break;
    case PROFILE_MAINTENANCE:
    default:
      sequence = MAINTENANCE_STATUS_SEQUENCE;
      count = sizeof(MAINTENANCE_STATUS_SEQUENCE) / sizeof(MAINTENANCE_STATUS_SEQUENCE[0]);
      break;
  }
}

uint16_t simulatedFault(MachineProfile profile) {
  if (random(0, 4) == 0) {
    return 1;
  }

  switch (profile) {
    case PROFILE_PRODUCTION: return 206;
    case PROFILE_INTERMITTENT: return 14;
    case PROFILE_MAINTENANCE: return 205;
    default: return 14;
  }
}

bool advanceStatus(Machine& machine, unsigned long now) {
  MachineState& state = machine.state;
  if ((int32_t)(now - state.nextStatusChangeMs) < 0) {
    return false;
  }

  const uint16_t* sequence;
  uint8_t count;
  statusSequence(machine.profile, sequence, count);
  state.statusStep = (state.statusStep + 1) % count;
  state.machineStatus = sequence[state.statusStep];

  if (SIMULATE_FAULTS && random(0, 100) < 3) {
    state.machineStatus = simulatedFault(machine.profile);
  }

  state.nextStatusChangeMs = now + randomStatusDuration();
  return true;
}

void initializeEnvironment(Machine& machine) {
  MachineState& state = machine.state;

  switch (machine.profile) {
    case PROFILE_PRODUCTION:
      state.ambientTemperature = Helpers::randomFloat(25.5f, 27.5f);
      state.ambientHumidity = Helpers::randomFloat(49.0f, 56.0f);
      state.inkAreaTemperature = Helpers::randomFloat(26.0f, 28.5f);
      state.inkAreaHumidity = Helpers::randomFloat(50.0f, 58.0f);
      break;
    case PROFILE_INTERMITTENT:
      state.ambientTemperature = Helpers::randomFloat(21.0f, 24.5f);
      state.ambientHumidity = Helpers::randomFloat(43.0f, 53.0f);
      state.inkAreaTemperature = Helpers::randomFloat(22.0f, 25.5f);
      state.inkAreaHumidity = Helpers::randomFloat(45.0f, 55.0f);
      break;
    case PROFILE_MAINTENANCE:
    default:
      state.ambientTemperature = Helpers::randomFloat(23.0f, 26.0f);
      state.ambientHumidity = Helpers::randomFloat(51.0f, 61.0f);
      state.inkAreaTemperature = Helpers::randomFloat(23.5f, 27.0f);
      state.inkAreaHumidity = Helpers::randomFloat(52.0f, 63.0f);
      break;
  }

  for (uint8_t head = 0; head < PRESSURE_HEAD_COUNT; ++head) {
    const float base = head == 3 ? -0.2f : 0.0f;
    state.pressureWiperSuction[head] = clampFloat(
      base + Helpers::randomFloat(-0.08f, 0.08f),
      -1.2f,
      0.2f
    );
  }
}

void advanceEnvironment(Machine& machine) {
  MachineState& state = machine.state;
  float ambientTempMin;
  float ambientTempMax;
  float ambientHumidityMin;
  float ambientHumidityMax;
  float inkTempMin;
  float inkTempMax;
  float inkHumidityMin;
  float inkHumidityMax;

  switch (machine.profile) {
    case PROFILE_PRODUCTION:
      ambientTempMin = 23.5f; ambientTempMax = 30.0f;
      ambientHumidityMin = 44.0f; ambientHumidityMax = 62.0f;
      inkTempMin = 24.0f; inkTempMax = 32.0f;
      inkHumidityMin = 45.0f; inkHumidityMax = 64.0f;
      break;
    case PROFILE_INTERMITTENT:
      ambientTempMin = 19.0f; ambientTempMax = 27.0f;
      ambientHumidityMin = 38.0f; ambientHumidityMax = 58.0f;
      inkTempMin = 20.0f; inkTempMax = 29.0f;
      inkHumidityMin = 40.0f; inkHumidityMax = 60.0f;
      break;
    case PROFILE_MAINTENANCE:
    default:
      ambientTempMin = 21.0f; ambientTempMax = 29.0f;
      ambientHumidityMin = 46.0f; ambientHumidityMax = 66.0f;
      inkTempMin = 21.0f; inkTempMax = 30.0f;
      inkHumidityMin = 48.0f; inkHumidityMax = 68.0f;
      break;
  }

  state.ambientTemperature = randomWalk(state.ambientTemperature, ambientTempMin, ambientTempMax, 0.18f);
  state.ambientHumidity = randomWalk(state.ambientHumidity, ambientHumidityMin, ambientHumidityMax, 0.45f);
  state.inkAreaTemperature = randomWalk(state.inkAreaTemperature, inkTempMin, inkTempMax, 0.20f);
  state.inkAreaHumidity = randomWalk(state.inkAreaHumidity, inkHumidityMin, inkHumidityMax, 0.50f);

  const float pressureMinimum = machine.profile == PROFILE_MAINTENANCE ? -1.2f : -0.8f;
  for (uint8_t head = 0; head < PRESSURE_HEAD_COUNT; ++head) {
    state.pressureWiperSuction[head] = randomWalk(
      state.pressureWiperSuction[head],
      pressureMinimum,
      0.2f,
      0.08f
    );
  }
}

float speedTargetFactor(uint16_t status, uint8_t component) {
  if (isPrinting(status)) {
    return Helpers::randomFloat(0.55f, 0.95f);
  }

  if (isPreparing(status)) {
    return Helpers::randomFloat(0.05f, 0.20f);
  }

  if (status == 200) {
    if (component == SPEED_CAP_STATION || component == SPEED_PRINT_BAR) {
      return Helpers::randomFloat(0.10f, 0.30f);
    }
    if (component == SPEED_FEEDER_DISPENSER) {
      return Helpers::randomFloat(0.03f, 0.12f);
    }
  }

  if (status == 11 && component == SPEED_CAP_STATION) {
    return Helpers::randomFloat(0.02f, 0.08f);
  }

  return 0.0f;
}

void advanceSpeeds(Machine& machine) {
  MachineState& state = machine.state;
  const float activityScale = profileActivityScale(machine.profile);

  for (uint8_t component = 0; component < SPEED_COMPONENT_COUNT; ++component) {
    const float factor = speedTargetFactor(state.machineStatus, component) * activityScale;
    const float targetMms = SPEED_MMS_MAXIMUMS[component] * factor;
    const float targetRpm = SPEED_RPM_MAXIMUMS[component] * factor;

    state.speedMms[component] += (targetMms - state.speedMms[component]) * 0.35f;
    state.speedRpm[component] += (targetRpm - state.speedRpm[component]) * 0.35f;

    state.speedMms[component] = clampFloat(
      state.speedMms[component] + Helpers::randomFloat(-0.6f, 0.6f),
      0.0f,
      SPEED_MMS_MAXIMUMS[component]
    );
    state.speedRpm[component] = clampFloat(
      state.speedRpm[component] + Helpers::randomFloat(-1.5f, 1.5f),
      0.0f,
      SPEED_RPM_MAXIMUMS[component]
    );

    if (factor == 0.0f && state.speedMms[component] < 0.8f) state.speedMms[component] = 0.0f;
    if (factor == 0.0f && state.speedRpm[component] < 2.0f) state.speedRpm[component] = 0.0f;
  }
}

void startPrintJob(MachineState& state, MachineProfile profile) {
  state.copiesRequested = profile == PROFILE_PRODUCTION
    ? (uint32_t)random(180, 451)
    : (uint32_t)random(60, 221);
  state.copiesPrinted = 0;
}

void advanceCopies(Machine& machine, bool statusChanged) {
  MachineState& state = machine.state;

  if (statusChanged && state.machineStatus == 201) {
    startPrintJob(state, machine.profile);
  }

  if (!isPrinting(state.machineStatus)) {
    return;
  }

  if (state.copiesRequested == 0 || state.copiesPrinted >= state.copiesRequested) {
    startPrintJob(state, machine.profile);
  }

  const uint32_t increment = machine.profile == PROFILE_PRODUCTION
    ? (uint32_t)random(2, 10)
    : (uint32_t)random(1, 6);
  state.copiesPrinted += increment;
  if (state.copiesPrinted > state.copiesRequested) {
    state.copiesPrinted = state.copiesRequested;
  }
}

uint32_t counterIncrement(const Sensor& sensor, const MachineState& state) {
  switch (sensor.counterMode) {
    case COUNTER_PRODUCTION_DISTANCE:
      return isPrinting(state.machineStatus) ? (uint32_t)random(1, 16) : 0;
    case COUNTER_CALENDAR_TIME:
      return state.cycles > 0 && (state.cycles % 450) == 0 ? 1 : 0;
    case COUNTER_VACUUM_WORK:
      return (isPrinting(state.machineStatus) || state.machineStatus == 200)
        ? (uint32_t)random(1, 6)
        : 0;
    case COUNTER_SUPPLY_PUMP_WORK:
      return isPrinting(state.machineStatus) ? (uint32_t)random(1, 6) : 0;
    case COUNTER_CLEANING_PUMP_WORK:
      return isCleaning(state.machineStatus) ? (uint32_t)random(1, 6) : 0;
    case COUNTER_NONE:
    default:
      return 0;
  }
}

void advanceCounters(Machine& machine) {
  MachineState& state = machine.state;
  for (uint8_t i = 0; i < SensorGenerators::getSensorCount(); ++i) {
    const Sensor& sensor = SensorGenerators::getSensor(i);
    if (sensor.kind != SENSOR_MAINTENANCE_COUNTER || sensor.parameter >= MAINTENANCE_COUNTER_COUNT) {
      continue;
    }

    const uint32_t current = state.maintenanceCounters[sensor.parameter];
    const uint32_t increment = counterIncrement(sensor, state);
    const uint32_t remaining = sensor.maximum - current;
    state.maintenanceCounters[sensor.parameter] = current + (increment > remaining ? remaining : increment);
  }
}

void advanceUsageCounters(MachineState& state, bool statusChanged) {
  if (statusChanged && state.machineStatus == 1) {
    ++state.safetyRelayUsageEmergency;
  }
  if (statusChanged && state.machineStatus == 12) {
    ++state.contactorUsageStandby;
  }
  if (statusChanged && isMotionActive(state.machineStatus)) {
    ++state.safetyRelayUsageMotion;
  }
  if (isMotionActive(state.machineStatus) && random(0, 100) < 20) {
    ++state.safetyRelayUsageMotion;
  }
}

String counterPayload(uint32_t maximum, uint32_t value) {
  String payload;
  payload.reserve(48);
  payload = "{\"maximum\":";
  payload += String((unsigned long)maximum);
  payload += ",\"value\":";
  payload += String((unsigned long)value);
  payload += "}";
  return payload;
}

String textPayload(const String& value) {
  String payload;
  payload.reserve(value.length() + 2);
  payload = '"';
  payload += value;
  payload += '"';
  return payload;
}

}  // namespace

const Sensor& SensorGenerators::getSensor(uint8_t index) {
  return sensors[index];
}

uint8_t SensorGenerators::getSensorCount() {
  return SENSOR_COUNT;
}

void SensorGenerators::initializeMachine(Machine& machine) {
  MachineState emptyState = {};
  machine.state = emptyState;
  MachineState& state = machine.state;

  const uint16_t* sequence;
  uint8_t statusCount;
  statusSequence(machine.profile, sequence, statusCount);
  state.machineStatus = sequence[0];
  state.statusStep = 0;
  state.nextStatusChangeMs = millis() + randomStatusDuration();
  state.safetyRelayUsageEmergency = (uint32_t)(322.0f * profileCounterScale(machine.profile));
  state.safetyRelayUsageMotion = (uint32_t)(378.0f * profileCounterScale(machine.profile));
  state.contactorUsageStandby = (uint32_t)(174.0f * profileCounterScale(machine.profile));

  initializeEnvironment(machine);

  if (machine.profile == PROFILE_PRODUCTION) {
    startPrintJob(state, machine.profile);
    state.copiesPrinted = (uint32_t)random(0, (long)(state.copiesRequested / 3) + 1L);
  }

  for (uint8_t i = 0; i < SENSOR_COUNT; ++i) {
    const Sensor& sensor = sensors[i];
    if (sensor.kind != SENSOR_MAINTENANCE_COUNTER || sensor.parameter >= MAINTENANCE_COUNTER_COUNT) {
      continue;
    }

    float scale = profileCounterScale(machine.profile);
    if (machine.profile == PROFILE_MAINTENANCE && sensor.counterMode == COUNTER_CLEANING_PUMP_WORK) {
      scale = 1.15f;
    }
    const float jitter = Helpers::randomFloat(0.92f, 1.08f);
    const uint32_t initial = (uint32_t)(sensor.initialValue * scale * jitter);
    state.maintenanceCounters[sensor.parameter] = clampCounter(initial, sensor.maximum);
  }

  state.initialized = true;
}

void SensorGenerators::advanceMachine(Machine& machine, unsigned long now) {
  if (!machine.state.initialized) {
    initializeMachine(machine);
  }

  MachineState& state = machine.state;
  const bool statusChanged = advanceStatus(machine, now);
  advanceEnvironment(machine);
  advanceSpeeds(machine);
  advanceCopies(machine, statusChanged);
  advanceUsageCounters(state, statusChanged);
  advanceCounters(machine);
  ++state.cycles;
}

void SensorGenerators::buildPayload(
  const Sensor& sensor,
  const Machine& machine,
  const String& heartbeat,
  String& payload
) {
  const MachineState& state = machine.state;

  switch (sensor.kind) {
    case SENSOR_HEARTBEAT:
      payload = textPayload(heartbeat);
      break;
    case SENSOR_MACHINE_STATUS:
      payload = String(state.machineStatus);
      break;
    case SENSOR_AMBIENT_HUMIDITY:
      payload = String(state.ambientHumidity, 1);
      break;
    case SENSOR_AMBIENT_TEMPERATURE:
      payload = String(state.ambientTemperature, 1);
      break;
    case SENSOR_INK_AREA_HUMIDITY:
      payload = String(state.inkAreaHumidity, 1);
      break;
    case SENSOR_INK_AREA_TEMPERATURE:
      payload = String(state.inkAreaTemperature, 1);
      break;
    case SENSOR_COPIES_REQUESTED:
      payload = String((unsigned long)state.copiesRequested);
      break;
    case SENSOR_COPIES_PRINTED:
      payload = String((unsigned long)state.copiesPrinted);
      break;
    case SENSOR_PRESSURE_WIPER_SUCTION:
      if (sensor.parameter < PRESSURE_HEAD_COUNT) {
        const float pressure = state.pressureWiperSuction[sensor.parameter];
        payload = String(pressure > -0.05f && pressure < 0.05f ? 0.0f : pressure, 1);
      } else {
        payload = "0.0";
      }
      break;
    case SENSOR_SAFETY_RELAY_EMERGENCY:
      payload = String((unsigned long)state.safetyRelayUsageEmergency);
      break;
    case SENSOR_SAFETY_RELAY_MOTION:
      payload = String((unsigned long)state.safetyRelayUsageMotion);
      break;
    case SENSOR_CONTACTOR_STANDBY:
      payload = String((unsigned long)state.contactorUsageStandby);
      break;
    case SENSOR_MAINTENANCE_COUNTER:
      payload = counterPayload(
        sensor.maximum,
        sensor.parameter < MAINTENANCE_COUNTER_COUNT
          ? state.maintenanceCounters[sensor.parameter]
          : 0
      );
      break;
    case SENSOR_SPEED_MMS:
      payload = sensor.parameter < SPEED_COMPONENT_COUNT
        ? String(state.speedMms[sensor.parameter], 1)
        : String("0.0");
      break;
    case SENSOR_SPEED_RPM:
      payload = sensor.parameter < SPEED_COMPONENT_COUNT
        ? String(state.speedRpm[sensor.parameter], 1)
        : String("0.0");
      break;
    default:
      payload = "";
      break;
  }
}

#undef VALUE_SENSOR
#undef COUNTER_SENSOR
