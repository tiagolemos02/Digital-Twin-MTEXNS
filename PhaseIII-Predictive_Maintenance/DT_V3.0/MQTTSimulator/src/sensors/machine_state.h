#ifndef MACHINE_STATE_H
#define MACHINE_STATE_H

#include <Arduino.h>

static const uint8_t PRESSURE_HEAD_COUNT = 5;
static const uint8_t SPEED_COMPONENT_COUNT = 7;
static const uint8_t MAINTENANCE_COUNTER_COUNT = 75;

enum MachineProfile : uint8_t {
  PROFILE_PRODUCTION = 0,
  PROFILE_INTERMITTENT = 1,
  PROFILE_MAINTENANCE = 2
};

enum SpeedComponent : uint8_t {
  SPEED_STACKER_LIFT = 0,
  SPEED_FEEDER_TRANSPORT = 1,
  SPEED_TRANSPORT = 2,
  SPEED_CAP_STATION = 3,
  SPEED_PRINT_BAR = 4,
  SPEED_EXIT_BELT = 5,
  SPEED_FEEDER_DISPENSER = 6
};

struct MachineState {
  bool initialized;
  uint16_t machineStatus;
  uint8_t statusStep;
  unsigned long nextStatusChangeMs;
  uint32_t cycles;

  float ambientHumidity;
  float ambientTemperature;
  float inkAreaHumidity;
  float inkAreaTemperature;
  float pressureWiperSuction[PRESSURE_HEAD_COUNT];
  float speedMms[SPEED_COMPONENT_COUNT];
  float speedRpm[SPEED_COMPONENT_COUNT];

  uint32_t copiesRequested;
  uint32_t copiesPrinted;
  uint32_t safetyRelayUsageEmergency;
  uint32_t safetyRelayUsageMotion;
  uint32_t contactorUsageStandby;
  uint32_t maintenanceCounters[MAINTENANCE_COUNTER_COUNT];
};

struct Machine {
  const char* id;
  MachineProfile profile;
  MachineState state;
};

#endif
