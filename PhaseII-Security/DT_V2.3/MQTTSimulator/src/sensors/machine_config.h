#ifndef MACHINE_CONFIG_H
#define MACHINE_CONFIG_H

#include <Arduino.h>

struct Machine {
  const char* id;
};

class MachineConfig {
private:
  static const Machine machines[];
  static const uint8_t MACHINE_COUNT;
  
public:
  static void publishAllMachines();
  static void publishMachine(const Machine& machine);
  static uint8_t getMachineCount();
  static const Machine& getMachine(uint8_t index);
};

#endif
