#ifndef SENSOR_GENERATORS_H
#define SENSOR_GENERATORS_H

#include <Arduino.h>

struct Sensor {
  const char* suffix;        // e.g. "ambient_temperature"
  bool        isInt;         // true = publish as integer
  float (*gen)();            // pointer to generator function
};

class SensorGenerators {
private:
  static const Sensor sensors[];
  static const uint8_t SENSOR_COUNT;
  
  // Generator functions
  static float genStatus();
  static float genAmbientTemp();
  static float genAmbientHumidity();
  static float genPressurePositive();
  static float genPressureNegative();
  static float genPressureDegassing();
  static float genPressureSubtank();
  
public:
  static const Sensor& getSensor(uint8_t index);
  static uint8_t getSensorCount();
};

#endif
