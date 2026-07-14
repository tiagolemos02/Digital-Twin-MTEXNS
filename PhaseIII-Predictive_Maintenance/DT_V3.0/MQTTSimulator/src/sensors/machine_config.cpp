#include "machine_config.h"
#include "sensor_generators.h"
#include "../connectivity/mqtt_manager.h"
#include "../connectivity/time_manager.h"

Machine MachineConfig::machines[] = {
  { "00:00:0A:B3:47:FA", PROFILE_PRODUCTION, {} },
  { "00:00:1B:C4:58:FB", PROFILE_INTERMITTENT, {} },
  { "00:00:2C:D5:69:FC", PROFILE_MAINTENANCE, {} }
};

const uint8_t MachineConfig::MACHINE_COUNT = sizeof(machines) / sizeof(machines[0]);

void MachineConfig::initialize() {
  for (uint8_t i = 0; i < MACHINE_COUNT; ++i) {
    SensorGenerators::initializeMachine(machines[i]);
  }
}

void MachineConfig::publishAllMachines() {
  String heartbeat;
  const bool hasValidHeartbeat = TimeManager::currentTimestamp(heartbeat);

  for (uint8_t i = 0; i < MACHINE_COUNT; ++i) {
    SensorGenerators::advanceMachine(machines[i], millis());
    publishMachine(machines[i], heartbeat, hasValidHeartbeat);
  }
}

void MachineConfig::publishMachine(Machine& machine, const String& heartbeat, bool hasValidHeartbeat) {
  for (uint8_t s = 0; s < SensorGenerators::getSensorCount(); ++s) {
    const Sensor& sensor = SensorGenerators::getSensor(s);

    if (sensor.kind == SENSOR_HEARTBEAT && !hasValidHeartbeat) {
      continue;
    }

    String topic = String(machine.id) + "/state/" + sensor.suffix;
    String payload;

    SensorGenerators::buildPayload(sensor, machine, heartbeat, payload);
    MQTTManager::publish(topic, payload);

    if ((s % 16) == 15) {
      MQTTManager::loop();
    }
  }
}

uint8_t MachineConfig::getMachineCount() {
  return MACHINE_COUNT;
}

Machine& MachineConfig::getMachine(uint8_t index) {
  return machines[index];
}
