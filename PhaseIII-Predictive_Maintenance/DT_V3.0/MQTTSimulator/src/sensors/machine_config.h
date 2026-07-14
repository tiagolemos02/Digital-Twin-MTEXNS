#ifndef MACHINE_CONFIG_H
#define MACHINE_CONFIG_H

#include <Arduino.h>
#include "machine_state.h"

class MachineConfig {
private:
  static Machine machines[];
  static const uint8_t MACHINE_COUNT;
  
public:
  static void initialize();
  static void publishAllMachines();
  static void publishMachine(Machine& machine, const String& heartbeat, bool hasValidHeartbeat);
  static uint8_t getMachineCount();
  static Machine& getMachine(uint8_t index);
};

#endif
