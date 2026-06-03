/*  
 *  Simulate any number of machines and publish their data to MQTT
 *  ---------------------------------------------------------------
 *  HOW TO ADD ANOTHER MACHINE?
 *    1️⃣  Scroll to machine_config.h in src/sensors/ folder.
 *    2️⃣  Add its ID string to the machines array.
 *    3️⃣  Re-compile / flash.
 *  That's it—no extra constants, no manual topic strings.
 */

#include "config.h"
#include "src/connectivity/wifi_manager.h"
#include "src/connectivity/mqtt_manager.h"
#include "src/sensors/machine_config.h"
#include "src/sensors/sensor_generators.h"

// Timing variables
unsigned long lastPublish = 0;

void setup() {
  Serial.begin(115200);
  
  // Initialize WiFi
  WiFiManager::connect();
  
  // Initialize MQTT
  MQTTManager::initialize();
  MQTTManager::connect();
}

void loop() {
  // Ensure MQTT connection
  if (!MQTTManager::isConnected()) {
    MQTTManager::connect();
  }
  MQTTManager::loop();

  unsigned long now = millis();
  if (now - lastPublish >= PUBLISH_INTERVAL_MS) {
    lastPublish = now;

    // Publish data for all machines
    MachineConfig::publishAllMachines();
    
    Serial.println("-- batch complete --\n");
  }
}
