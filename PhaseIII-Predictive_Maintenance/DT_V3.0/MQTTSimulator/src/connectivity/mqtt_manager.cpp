#include "mqtt_manager.h"
#include "wifi_manager.h"
#include "../../config.h"

WiFiClient MQTTManager::wifiClient;
PubSubClient MQTTManager::mqttClient(wifiClient);

void MQTTManager::initialize() {
  mqttClient.setServer(MQTT_SERVER, MQTT_PORT);
  mqttClient.setBufferSize(MQTT_BUFFER_SIZE);
}

void MQTTManager::connect() {
  while (!mqttClient.connected()) {
    Serial.print("MQTT: connecting... ");
    
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
  const bool success = mqttClient.publish(topic.c_str(), payload.c_str(), false);
  
  if (success) {
    Serial.printf("PUB %s -> %s\n", topic.c_str(), payload.c_str());
  } else {
    Serial.printf("ERR %s -> %s (publish failed)\n", topic.c_str(), payload.c_str());
  }
  
  return success;
}
