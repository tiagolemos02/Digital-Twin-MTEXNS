#ifndef TIME_MANAGER_H
#define TIME_MANAGER_H

#include <Arduino.h>

class TimeManager {
public:
  static void initialize();
  static void loop();
  static bool isTimeValid();
  static bool currentTimestamp(String& timestamp);

private:
  static unsigned long lastSyncAttempt;
  static bool waitForValidTime(unsigned long timeoutMs);
  static void requestSync();
};

#endif
