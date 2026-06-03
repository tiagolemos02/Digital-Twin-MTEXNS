#ifndef MQTT_MANAGER_H
#define MQTT_MANAGER_H

#include <PubSubClient.h>
#include <WiFi.h>

class MQTTManager {
private:
  static WiFiClient wifiClient;
  static PubSubClient mqttClient;
  
public:
  static void initialize();
  static void connect();
  static bool isConnected();
  static void loop();
  static bool publish(const String& topic, const String& payload);
};

#endif
