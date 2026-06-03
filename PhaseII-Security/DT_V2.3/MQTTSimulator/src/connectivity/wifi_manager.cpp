#include "wifi_manager.h"
#include "../../config.h"

void WiFiManager::connect() {
  Serial.print("Wi-Fi: connecting to ");
  Serial.println(WIFI_SSID);
  
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  
  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print('.');
  }
  
  Serial.print("\nWi-Fi OK  IP=");
  Serial.println(WiFi.localIP());
}

bool WiFiManager::isConnected() {
  return WiFi.status() == WL_CONNECTED;
}

String WiFiManager::getMacAddress() {
  return WiFi.macAddress();
}
