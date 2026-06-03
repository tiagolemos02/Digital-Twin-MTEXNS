#include "machine_config.h"
#include "sensor_generators.h"
#include "../connectivity/mqtt_manager.h"

const Machine MachineConfig::machines[] = {
  { "00:00:0A:B3:47:FA" },
  { "00:00:1B:C4:58:GB" }  // ← new machine? just add a line
};

const uint8_t MachineConfig::MACHINE_COUNT = sizeof(machines) / sizeof(machines[0]);

void MachineConfig::publishAllMachines() {
  for (uint8_t i = 0; i < MACHINE_COUNT; ++i) {
    publishMachine(machines[i]);
  }
}

void MachineConfig::publishMachine(const Machine& machine) {
  for (uint8_t s = 0; s < SensorGenerators::getSensorCount(); ++s) {
    const Sensor& sensor = SensorGenerators::getSensor(s);
    
    String topic = String(machine.id) + "/state/" + sensor.suffix;
    String payload;
    
    if (sensor.isInt) {
      payload = String((int)sensor.gen());
    } else {
      payload = String(sensor.gen(), 3);
    }
    
    MQTTManager::publish(topic, payload);
  }
}

uint8_t MachineConfig::getMachineCount() {
  return MACHINE_COUNT;
}

const Machine& MachineConfig::getMachine(uint8_t index) {
  return machines[index];
}
