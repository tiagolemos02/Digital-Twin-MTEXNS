#include "sensor_generators.h"
#include "../utils/helpers.h"

const Sensor SensorGenerators::sensors[] = {
  { "machine_status",      true,  genStatus           },
  { "ambient_temperature", false, genAmbientTemp      },
  { "ambient_humidity",    false, genAmbientHumidity  },
  { "pressure_positive",   false, genPressurePositive },
  { "pressure_negative",   false, genPressureNegative },
  { "pressure_degassing",  false, genPressureDegassing},
  { "pressure_subtank",    false, genPressureSubtank  }
};

const uint8_t SensorGenerators::SENSOR_COUNT = sizeof(sensors) / sizeof(sensors[0]);

float SensorGenerators::genStatus() {
  return 1;
}

float SensorGenerators::genAmbientTemp() {
  return Helpers::randomFloat(18.0, 30.0);
}

float SensorGenerators::genAmbientHumidity() {
  return Helpers::randomFloat(40.0, 80.0);
}

float SensorGenerators::genPressurePositive() {
  return Helpers::randomFloat(-30.0, -20.0);
}

float SensorGenerators::genPressureNegative() {
  return Helpers::randomFloat(0.0, 5.0);
}

float SensorGenerators::genPressureDegassing() {
  return Helpers::randomFloat(20.0, 25.0);
}

float SensorGenerators::genPressureSubtank() {
  return Helpers::randomFloat(-5.0, 5.0);
}

const Sensor& SensorGenerators::getSensor(uint8_t index) {
  return sensors[index];
}

uint8_t SensorGenerators::getSensorCount() {
  return SENSOR_COUNT;
}
