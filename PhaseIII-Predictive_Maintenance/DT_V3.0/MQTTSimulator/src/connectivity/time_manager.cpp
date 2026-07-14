#include "time_manager.h"

#include <time.h>

#include "../../config.h"

unsigned long TimeManager::lastSyncAttempt = 0;

void TimeManager::requestSync() {
  lastSyncAttempt = millis();
  configTzTime(TIME_ZONE, NTP_SERVER_PRIMARY, NTP_SERVER_SECONDARY);
}

bool TimeManager::waitForValidTime(unsigned long timeoutMs) {
  struct tm timeInfo;
  return getLocalTime(&timeInfo, timeoutMs) && timeInfo.tm_year >= (2024 - 1900);
}

void TimeManager::initialize() {
  Serial.print("Clock: synchronizing with NTP... ");
  requestSync();

  if (waitForValidTime(INITIAL_TIME_SYNC_TIMEOUT_MS)) {
    Serial.println("OK");
  } else {
    Serial.println("unavailable; iamalive will be skipped until synchronization succeeds");
  }
}

void TimeManager::loop() {
  if (isTimeValid()) {
    return;
  }

  const unsigned long now = millis();
  if (now - lastSyncAttempt < TIME_SYNC_RETRY_INTERVAL_MS) {
    return;
  }

  Serial.println("Clock: retrying NTP synchronization");
  requestSync();
}

bool TimeManager::isTimeValid() {
  struct tm timeInfo;
  return getLocalTime(&timeInfo, 10) && timeInfo.tm_year >= (2024 - 1900);
}

bool TimeManager::currentTimestamp(String& timestamp) {
  struct tm timeInfo;
  if (!getLocalTime(&timeInfo, 10) || timeInfo.tm_year < (2024 - 1900)) {
    timestamp = "";
    return false;
  }

  char buffer[20];
  if (strftime(buffer, sizeof(buffer), "%Y-%m-%d %H:%M:%S", &timeInfo) == 0) {
    timestamp = "";
    return false;
  }

  timestamp = buffer;
  return true;
}
