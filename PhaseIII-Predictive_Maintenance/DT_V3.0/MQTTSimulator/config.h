#ifndef CONFIG_H
#define CONFIG_H

// Wi-Fi Configuration
#define WIFI_SSID "some_ssid"
#define WIFI_PASSWORD "some_pass"

// MQTT Configuration
#define MQTT_SERVER "192.168.68.63"
#define MQTT_PORT 1883
#define MQTT_BUFFER_SIZE 384

// Timing Configuration
#define PUBLISH_INTERVAL_MS 8000UL
#define STATUS_CHANGE_MIN_MS 30000UL
#define STATUS_CHANGE_MAX_MS 90000UL

// Clock Configuration (Europe/Lisbon, including daylight saving time)
#define NTP_SERVER_PRIMARY "pool.ntp.org"
#define NTP_SERVER_SECONDARY "time.google.com"
#define TIME_ZONE "WET0WEST,M3.5.0/1,M10.5.0"
#define INITIAL_TIME_SYNC_TIMEOUT_MS 10000UL
#define TIME_SYNC_RETRY_INTERVAL_MS 60000UL

// Disabled by default so normal portal tests do not show false alarms.
#define SIMULATE_FAULTS false

#endif
