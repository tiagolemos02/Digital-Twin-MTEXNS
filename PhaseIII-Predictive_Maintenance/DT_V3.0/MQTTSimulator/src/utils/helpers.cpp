#include "helpers.h"
#include <Arduino.h>

float Helpers::randomFloat(float minVal, float maxVal) {
  float r = (float)random(0, 10000) / 10000.0;   // 0-0.9999
  return r * (maxVal - minVal) + minVal;
}
