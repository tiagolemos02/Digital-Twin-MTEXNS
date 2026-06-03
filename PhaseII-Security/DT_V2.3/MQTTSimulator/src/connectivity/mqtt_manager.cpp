#include "mqtt_manager.h"
#include "wifi_manager.h"
#include "../../config.h"

WiFiClient MQTTManager::wifiClient;
PubSubClient MQTTManager::mqttClient(wifiClient);

void MQTTManager::initialize() {
  mqttClient.setServer(MQTT_SERVER, MQTT_PORT);
}

void MQTTManager::connect() {
  while (!mqttClient.connected()) {
    Serial.print("MQTT: connecting… ");
    
    // Generate unique client ID
    String clientId = "ESP32-Sim-" + WiFiManager::getMacAddress();
    
    if (mqttClient.connect(clientId.c_str())) {
      Serial.println("OK");
    } else {
      Serial.print("err=");
      Serial.println(mqttClient.state());
      delay(3000);
    }
  }
}

bool MQTTManager::isConnected() {
  return mqttClient.connected();
}

void MQTTManager::loop() {
  mqttClient.loop();
}

bool MQTTManager::publish(const String& topic, const String& payload) {
  bool success = mqttClient.publish(topic.c_str(), payload.c_str());
  
  if (success) {
    Serial.printf("▲ %s  ->  %s\n", topic.c_str(), payload.c_str());
  } else {
    Serial.printf("× %s  ->  %s (fail)\n", topic.c_str(), payload.c_str());
  }
  
  return success;
}
