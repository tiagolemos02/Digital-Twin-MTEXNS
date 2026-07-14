# MQTT Simulator

The MQTT Simulator is an ESP32/Arduino sketch that publishes realistic-looking test telemetry for three independent printing machines. Its purpose is to exercise the Digital Twin Portal, Orion, and the telemetry ingestion path. The generated values are synthetic and must not be used to train, validate, or demonstrate predictive-maintenance models.

## Simulated machines

The simulator publishes data for these fixed Device IDs:

| Device ID | Profile | Typical operating states |
| --- | --- | --- |
| `00:00:0A:B3:47:FA` | Production | Preparing to print, Ready to print, Printing, Paused |
| `00:00:1B:C4:58:FB` | Intermittent | Idle, Standby, occasional print cycles |
| `00:00:2C:D5:69:FC` | Maintenance | Maintenance, Cleaning, Idle |

Each machine keeps its own temperatures, humidity, job counters, speeds, pressures, maintenance counters, and operating-state sequence. Values from one machine are not reused for another machine.

## MQTT contract

Every attribute is published as a separate MQTT message:

```text
<device-id>/state/<attribute-name>
```

Examples:

```text
00:00:0A:B3:47:FA/state/iamalive
00:00:1B:C4:58:FB/state/machine_status
00:00:2C:D5:69:FC/state/ambient_temperature
```

Messages use MQTT QoS 0 and are not retained. Stopping the simulator therefore stops new heartbeats and lets the portal move the machine from Online to Stale and then Offline.

A full batch for all three machines is published every 8 seconds. Each machine publishes 105 attributes, grouped as follows:

- Connectivity and operation: `iamalive`, `machine_status`, environmental values, and copy counters.
- Preventive-maintenance values: traveled distance, elapsed time, vacuum work time, and component usage.
- Wiper suction pressure for heads 1 through 5.
- Linear and rotational speeds for the stacker, feeder, transport, cap station, print bar, and exit belt.
- Supply, recirculation, wiper waste, wiper suction, cap waste, and positive-pressure pump counters.

The authoritative topic catalogue, including exact spelling, maximums, and initial values, is in `src/sensors/sensor_generators.cpp`.

## Payload formats

### Heartbeat

`iamalive` is generated from the ESP32 clock in Lisbon local time:

```text
2026-07-14 16:42:08
```

The clock is synchronized by NTP. If no valid time is available, the simulator continues publishing other telemetry but skips `iamalive`. It retries NTP periodically. This produces an Unknown connectivity state instead of a false heartbeat.

### Numeric values

Temperatures, humidity, pressures, and speeds are published as decimal numbers. Status and usage values are published as integers.

```text
26.6
52.9
-0.2
203
```

### Maintenance counters

Preventive-maintenance and replacement counters are compact JSON objects. Both fields intentionally remain strings to match the source-machine examples:

```json
{"maximum":"250","value":"10"}
```

The maximum is fixed. The value is initialized near the supplied test baseline, never decreases, and never exceeds its maximum.

## Simulation behavior

The data changes continuously without replacing every value with unrelated random noise:

- Temperature and humidity follow bounded random walks.
- Pressures change gradually within conservative test ranges.
- Speeds rise and decay according to the current operating state.
- Idle, Standby, and Maintenance keep production speeds at or near zero.
- Printing increases copies, traveled distances, pump work, and related counters.
- Cleaning and Maintenance can increase cleaning-pump counters.
- `copies_printed` never exceeds `copies_requested`.
- Machine states change every 30 to 90 seconds using a profile-specific sequence.

These relationships make tables and charts easier to test, but they are only approximations for UI validation.

## Optional fault simulation

Faults are disabled by default:

```cpp
#define SIMULATE_FAULTS false
```

Set the value to `true` in `config.h` to introduce rare Emergency, Critical error, Printing error, or Cleaning error states. Keep it disabled for ordinary portal tests so synthetic alarms are not mistaken for real incidents.

## Configuration

Edit `config.h` before compiling:

```cpp
#define WIFI_SSID "your-network"
#define WIFI_PASSWORD "your-password"
#define MQTT_SERVER "192.0.2.10"
#define MQTT_PORT 1883
```

The same file contains the publish interval, status-change interval, MQTT buffer size, NTP servers, Lisbon timezone rule, and fault-simulation flag.

Review `config.h` before committing or distributing the project because it may contain local network credentials.

## Build and run

1. Open `MQTTSimulator.ino` in the Arduino IDE.
2. Select the correct ESP32 board and serial port.
3. Make the bundled `libraries/PubSubClient` library available to the Arduino build, or install a compatible PubSubClient release through the Arduino Library Manager.
4. Check the Wi-Fi and MQTT values in `config.h`.
5. Compile and upload the sketch.
6. Open the Serial Monitor at `115200` baud to inspect NTP, MQTT, topic, and payload output.

The simulator reconnects to Wi-Fi and MQTT when a connection is lost. It uses one MQTT client connection to publish telemetry for all three virtual Device IDs.

## Portal provisioning

Provision the three simulated Device IDs in the portal before relying on their telemetry. Configure each simulated machine with the attributes that you want the IoT Agent to ingest. In particular, new portal machines require the canonical heartbeat mapping where both Object ID and Name are `iamalive`.

This simulator does not provide or enforce a global telemetry mapping. Real machines can expose different topics and must be provisioned with their own machine-specific attribute mappings.

## Source layout

| Path | Responsibility |
| --- | --- |
| `MQTTSimulator.ino` | ESP32 setup, reconnect loop, and 8-second scheduler |
| `config.h` | Network, MQTT, timing, NTP, and fault options |
| `src/connectivity/wifi_manager.*` | Wi-Fi connection management |
| `src/connectivity/mqtt_manager.*` | MQTT connection and non-retained publishing |
| `src/connectivity/time_manager.*` | NTP synchronization and Lisbon timestamps |
| `src/sensors/machine_state.h` | Per-machine runtime state and profiles |
| `src/sensors/machine_config.*` | Device IDs and per-machine publication loop |
| `src/sensors/sensor_generators.*` | Topic catalogue, state evolution, and payload serialization |
| `src/utils/helpers.*` | Random floating-point utility |

## Adding or changing a simulated machine

The three profiles are intentionally fixed for this portal test. To change an ID or profile, edit the `machines` array in `src/sensors/machine_config.cpp` and recompile:

```cpp
Machine MachineConfig::machines[] = {
  { "00:00:0A:B3:47:FA", PROFILE_PRODUCTION, {} },
  { "00:00:1B:C4:58:FB", PROFILE_INTERMITTENT, {} },
  { "00:00:2C:D5:69:FC", PROFILE_MAINTENANCE, {} }
};
```

When adding another machine, also choose the profile that controls its status sequence and numeric ranges. No manual topic strings are required because every configured machine uses the shared simulator catalogue.
