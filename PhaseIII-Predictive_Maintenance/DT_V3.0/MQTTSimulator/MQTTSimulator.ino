/*
 * Simulates three independent printing machines and publishes their
 * telemetry to MQTT. See README.md for profiles, topics and setup.
 */

#include "config.h"
#include "src/connectivity/wifi_manager.h"
#include "src/connectivity/mqtt_manager.h"
#include "src/connectivity/time_manager.h"
#include "src/sensors/machine_config.h"

unsigned long lastPublish = 0;

void setup() {
  Serial.begin(115200);
  randomSeed((uint32_t)ESP.getEfuseMac());

  WiFiManager::connect();
  TimeManager::initialize();
  MQTTManager::initialize();
  MQTTManager::connect();
  MachineConfig::initialize();
}

void loop() {
  if (!WiFiManager::isConnected()) {
    WiFiManager::connect();
  }

  if (!MQTTManager::isConnected()) {
    MQTTManager::connect();
  }

  MQTTManager::loop();
  TimeManager::loop();

  const unsigned long now = millis();
  if (now - lastPublish >= PUBLISH_INTERVAL_MS) {
    lastPublish = now;
    MachineConfig::publishAllMachines();
    Serial.println("-- MQTT batch complete --\n");
  }
}
