#ifndef SENSOR_GENERATORS_H
#define SENSOR_GENERATORS_H

#include <Arduino.h>

#include "machine_state.h"

enum SensorKind : uint8_t {
  SENSOR_HEARTBEAT = 0,
  SENSOR_MACHINE_STATUS,
  SENSOR_AMBIENT_HUMIDITY,
  SENSOR_AMBIENT_TEMPERATURE,
  SENSOR_INK_AREA_HUMIDITY,
  SENSOR_INK_AREA_TEMPERATURE,
  SENSOR_COPIES_REQUESTED,
  SENSOR_COPIES_PRINTED,
  SENSOR_PRESSURE_WIPER_SUCTION,
  SENSOR_SAFETY_RELAY_EMERGENCY,
  SENSOR_SAFETY_RELAY_MOTION,
  SENSOR_CONTACTOR_STANDBY,
  SENSOR_MAINTENANCE_COUNTER,
  SENSOR_SPEED_MMS,
  SENSOR_SPEED_RPM
};

enum CounterMode : uint8_t {
  COUNTER_NONE = 0,
  COUNTER_PRODUCTION_DISTANCE,
  COUNTER_CALENDAR_TIME,
  COUNTER_VACUUM_WORK,
  COUNTER_SUPPLY_PUMP_WORK,
  COUNTER_CLEANING_PUMP_WORK
};

struct Sensor {
  const char* suffix;
  SensorKind kind;
  uint8_t parameter;
  uint32_t maximum;
  uint32_t initialValue;
  CounterMode counterMode;
};

class SensorGenerators {
private:
  static const Sensor sensors[];
  static const uint8_t SENSOR_COUNT;

public:
  static const Sensor& getSensor(uint8_t index);
  static uint8_t getSensorCount();
  static void initializeMachine(Machine& machine);
  static void advanceMachine(Machine& machine, unsigned long now);
  static void buildPayload(
    const Sensor& sensor,
    const Machine& machine,
    const String& heartbeat,
    String& payload
  );
};

#endif
