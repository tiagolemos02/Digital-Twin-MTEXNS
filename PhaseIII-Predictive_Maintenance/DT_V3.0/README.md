# Phase III - Predictive Maintenance v0.2
=======

**This phase starts the predictive maintenance roadmap by adding the historical telemetry foundation required for later machine learning.**

Version `0.2` does **not** train or run ML predictions yet. Its purpose is to persist machine telemetry over time using the FIWARE-recommended `QuantumLeap + CrateDB` architecture, expose that data safely through the existing security chain, add a first portal view for querying trends, and improve machine inventory/status handling.

The existing Phase II security model remains the baseline: browser traffic goes through the portal, PEP Proxy, API Gateway, Keyrock, and AuthzForce policies. CrateDB and QuantumLeap are intentionally kept internal-only.

## Project Identification

**Repository**: `tiagolemos02/PhaseIII-PM/DT_V3.0`

**Phase**: `Phase III - Predictive Maintenance`

**Version**: `0.2`

**Author**: Tiago Lemos

**Licence**: MIT

---

## Scope of v0.2

### Implemented

- Historical telemetry persistence with **QuantumLeap** and **CrateDB**
- Secured historical data access through:
  - `portal-bff`
  - `pep-proxy`
  - `api-gateway`
  - `quantumleap`
- Internal-only CrateDB and QuantumLeap services
- Idempotent Orion subscription bootstrap for `Machine` entities
- CrateDB schema synchronization helper for newly detected `Machine` attributes
- Portal **Historical Data** tab
- Historical chart and table for registered machine telemetry
- Auto-refresh toggle for historical queries every 5 seconds
- Keyrock/AuthzForce permissions for historical data routes
- Portal-only machine registration control for **Machines in Use**
- Service-group-aware IoT Agent device picker in the **Add Machine** form
- Dynamic `machine_status` code badges in **Machines in Use** and **Orion Logs**
- IEC 60073-aligned machine status color palette

### Not Implemented Yet

- ML model training
- Anomaly detection
- Remaining useful life prediction
- Prediction tables in CrateDB
- Writing prediction results back to Orion
- Dashboards for predictive maintenance

This phase deliberately separates **data collection** from **prediction**. Predictive maintenance models need enough clean historical data first; this version creates that data layer.

---

## New in v0.2

### ✅ Machine registration control - portal-only "Machines in Use"

Previously, IoT Agent devices could be surfaced in **Machines in Use** even when they were only auto-provisioned by telemetry traffic and had not been explicitly registered through the portal.

What changed:

- **Machines in Use** now shows only IoT Agent devices that carry portal registration metadata.
- Auto-provisioned IoT Agent devices remain available for onboarding, but are not treated as registered machines.
- Stale browser `localStorage` entries no longer decide whether a machine is registered.
- Registering a machine writes portal metadata to the IoT Agent static attributes.
- Deleting or updating a machine refreshes the inventory and picker state.

The relevant registration marker is stored in static attributes such as:

```text
serviceGroupKey
serviceGroupResource
serviceGroupApikey
serviceGroupFiware
serviceGroupSubservice
```

---

### ✅ Device picker in "Add Machine" form

When the user selects a service group in the **Add Machine** form, the portal immediately refreshes the IoT Agent device list and shows a collapsible **Available device IDs from IoT Agent** picker.

What was added:

- Devices already present in the IoT Agent for the selected service group appear as clickable device IDs.
- Clicking a device ID fills the **Device ID** field automatically.
- Already registered devices are filtered out of the picker instead of being shown again.
- Duplicate IoT Agent records for the same `device_id` are collapsed before rendering.
- The picker refreshes after service group selection, registration, deletion, and service group changes.

This avoids the previous manual page-refresh requirement after selecting an existing service group.

---

### ✅ Dynamic `machine_status` codes and colors

The runtime machine status shown in **Machines in Use** and **Orion Logs** is now driven by live Orion telemetry, not by the form status tag.

What changed:

- The portal reads live `machine_status` / `machineStatus` attributes from Orion entities.
- The status badge shows both the status name and numeric code, for example:

```text
Printing (203)
Critical error (14)
Unknown (999)
```

- Missing, malformed, or unmapped status values fall back to `Unknown (999)`.
- The add/edit **Status tag** is now only a placeholder/default metadata field.
- Placeholder metadata is stored separately as:

```text
machineStatusPlaceholderCode
machineStatusPlaceholderName
```

- Status colors are shared by Machines in Use, Orion Logs, and the form preview through `web/digital-twin-portal/js/machine-status.js`.

The v0.2 status color palette follows the IEC 60073-style proposal used by the project:

| Status | Code | RGB |
|--------|------|-----|
| Unknown | `999` | `RGB(158,158,158)` |
| Uninitialized | `7` | `RGB(189,189,189)` |
| Standby | `12` | `RGB(245,245,245)` |
| Spinning | `303` | `RGB(56,142,60)` |
| Shutdown | `13` | `RGB(117,117,117)` |
| Sequence interrupted | `8` | `RGB(255,193,7)` |
| Reserved | `300` | `RGB(189,189,189)` |
| Ready to spin | `302` | `RGB(46,125,50)` |
| Ready to print | `202` | `RGB(46,125,50)` |
| Printing error | `206` | `RGB(211,47,47)` |
| Printing | `203` | `RGB(56,142,60)` |
| Preparing to spin | `301` | `RGB(255,160,0)` |
| Preparing to print | `201` | `RGB(255,160,0)` |
| Paused | `9` | `RGB(255,193,7)` |
| Manual | `3` | `RGB(25,118,210)` |
| Maintenance | `11` | `RGB(25,118,210)` |
| Invalid | `0` | `RGB(211,47,47)` |
| Initializing error | `15` | `RGB(211,47,47)` |
| Initializing | `6` | `RGB(66,165,245)` |
| Idle | `2` | `RGB(129,199,132)` |
| Emergency | `1` | `RGB(198,40,40)` |
| Diagnostic | `5` | `RGB(30,136,229)` |
| Critical error | `14` | `RGB(183,28,28)` |
| Cleaning error | `205` | `RGB(211,47,47)` |
| Cleaning | `200` | `RGB(102,187,106)` |

---

## Why Historical Data Was Needed

Orion Context Broker stores the current state of each entity. When a new MQTT sensor value arrives through the IoT Agent, Orion updates the entity attribute and overwrites the previous value.

That is correct for live context, but it is not enough for:

- trend analysis
- anomaly detection
- model training
- failure forecasting
- remaining useful life estimation

For predictive maintenance, the system needs a durable time-series history. In this version, that role is handled by:

| Component | Responsibility |
|----------|----------------|
| Orion Context Broker | Current machine state |
| QuantumLeap | Converts Orion NGSI notifications into time-series rows |
| CrateDB | Stores historical machine telemetry |
| Portal Historical Data tab | Queries historical values through QuantumLeap |

---

## Architecture

Runtime flow:

```text
Machine data
        |
        v
MQTT Broker
        |
        v
IoT Agent JSON
        |
        v
Orion Context Broker
        |
        | NGSI-v2 subscription
        v
QuantumLeap
        |
        v
CrateDB
```

Portal query flow:

```text
Browser
  |
  v
portal-bff
  |
  v
pep-proxy
  |
  v
api-gateway
  |
  v
QuantumLeap
  |
  v
CrateDB
```

CrateDB is not exposed to the host. The portal never connects directly to CrateDB.

---

## New Services

### `crate-db`

CrateDB stores time-series rows generated by QuantumLeap.

Important properties:

- Container name: `db-crate`
- Internal hostname: `crate-db`
- Internal HTTP SQL port: `4200`
- Internal PostgreSQL wire port: `5432`
- No host port is published
- Persistent volume: `crate-db`

The first table created by QuantumLeap for `Machine` entities is expected to be:

```text
mtopeniot.etmachine
```

Where:

- `mtopeniot` is derived from `Fiware-Service: openiot`
- `etmachine` is derived from entity type `Machine`

### `quantumleap`

QuantumLeap receives Orion notifications and writes them into CrateDB.

Important configuration:

```env
CRATE_HOST=crate-db
CRATE_PORT=4200
USE_GEOCODING=False
LOGLEVEL=${QUANTUMLEAP_LOG_LEVEL}
```

QuantumLeap is not exposed to the host. Browser access goes through:

```text
/bff/fiware/quantumleap/v2/...
```

### `historical-subscription`

This bootstrap service creates or updates the Orion subscription that sends `Machine` telemetry to QuantumLeap.

The subscription:

- targets all `Machine` entities
- sends notifications to `http://quantumleap:8668/v2/notify`
- uses normalized NGSI attributes
- includes `dateCreated` and `dateModified` metadata
- uses `onlyChangedAttrs: true`
- disables metadata-only notifications

The important subscription behavior is:

```json
{
  "notification": {
    "attrsFormat": "normalized",
    "onlyChangedAttrs": true,
    "metadata": ["dateCreated", "dateModified"]
  },
  "subject": {
    "condition": {
      "attrs": [],
      "notifyOnMetadataChange": false
    }
  }
}
```

`onlyChangedAttrs: true` is important because MQTT publishes each sensor topic separately. Without it, Orion sends the full machine snapshot for every individual attribute update, which creates repeated historical values.

### `historical-schema-sync`

CrateDB tables created by QuantumLeap use a strict column policy. If a new machine attribute appears after the table has already been created, QuantumLeap can fail to insert normal rows because the column does not exist.

The schema sync service:

- reads current `Machine` attributes from Orion
- checks the CrateDB table schema
- adds missing columns internally
- runs every `${HISTORICAL_SCHEMA_SYNC_INTERVAL_SECONDS}` seconds

This keeps the table compatible with newly registered machine telemetry attributes without exposing CrateDB.

---

## Security Model

The historical data feature follows the existing Phase II security architecture.

### Internal-only services

These services are **not** published to the host:

| Service | Port | Exposed to host? |
|---------|------|------------------|
| CrateDB HTTP SQL | `4200` | No |
| CrateDB PostgreSQL wire | `5432` | No |
| QuantumLeap API | `8668` | No |

### API Gateway route

The API Gateway proxies:

```text
/quantumleap/ -> http://quantumleap:8668/
```

The browser uses:

```text
/bff/fiware/quantumleap/v2/...
```

### Authorization

Historical data permissions were added to Keyrock/AuthzForce:

| Role | Permission |
|------|------------|
| Admin | `GET ^/quantumleap/v2/.*` |
| Viewer | `GET ^/quantumleap/v2/entities/.*` with the same Lisbon working-hours ABAC pattern used for Orion logs |

Orion to QuantumLeap notifications are internal service-to-service traffic and do not go through browser authorization.

---

## Portal Changes

The portal now includes a **Historical Data** tab.

Features:

- Select registered machine
- Select registered telemetry attribute
- Select time range
- Load historical samples
- Trend chart
- Data table
- Auto refresh every 5 seconds
- Empty states for missing machines, attributes, or historical samples

The portal uses the registered machine metadata from the Inventory module. It does not expose arbitrary entity or attribute querying to the user.

Historical query format:

```http
GET /bff/fiware/quantumleap/v2/entities/{entityId}/attrs/{attr}?type=Machine&fromDate=...&toDate=...&lastN=500
```

The UI shows the registered friendly attribute name, but queries the stored object-id attribute name when needed. Example:

| Portal label | Stored Orion / CrateDB attribute |
|-------------|-----------------------------------|
| `PressureNegative` | `pressure_negative` |
| `AmbientTemperature` | `ambient_temperature` |

---

## Files Added or Changed

### Docker / Bootstrap

| File | Purpose |
|------|---------|
| `docker_compose/docker-compose.yml` | Adds `crate-db`, `quantumleap`, `historical-subscription`, and `historical-schema-sync` |
| `docker_compose/.env.example` | Adds image/config variables for CrateDB, QuantumLeap, and schema sync |
| `docker_compose/bootstrap/historical-subscription.sh` | Creates/updates the Orion subscription for QuantumLeap |
| `docker_compose/bootstrap/historical-schema-sync.sh` | Adds missing CrateDB columns for new Machine attributes |
| `docker_compose/gateway/default.conf` | Adds `/quantumleap/` internal proxy route |
| `docker_compose/bootstrap/keyrock-bootstrap.sh` | Adds historical data permissions |

### Portal

| File | Purpose |
|------|---------|
| `web/digital-twin-portal/index.html` | Adds Historical Data tab and section |
| `web/digital-twin-portal/js/historical-data.js` | Implements historical query, chart, table, and auto-refresh |
| `web/digital-twin-portal/js/dom-elements.js` | Adds DOM exports for historical UI |
| `web/digital-twin-portal/js/main.js` | Initializes historical data module |
| `web/digital-twin-portal/js/auth.js` | Refreshes historical state after login/session changes |
| `web/digital-twin-portal/js/ui-helpers.js` | Adds Historical Data tab behavior |
| `web/digital-twin-portal/js/inventory.js` | Exposes registered machine metadata, controls Machines in Use, refreshes the IoT Agent device picker, and renders dynamic machine status badges |
| `web/digital-twin-portal/js/device-activity.js` | Extracts live Orion activity and `machine_status` metadata for portal views |
| `web/digital-twin-portal/js/orion-logs.js` | Renders Orion Logs device headers with live machine status badges |
| `web/digital-twin-portal/js/machine-status.js` | Defines machine status code mappings, RGB colors, dropdown options, parsing, and shared badge rendering |

---

## Environment Variables

New or relevant variables:

```env
CRATE_IMAGE=crate:5.6
QUANTUMLEAP_IMAGE=orchestracities/quantumleap:1.0.0
QUANTUMLEAP_LOG_LEVEL=INFO
CRATE_HEAP_SIZE=1g
HISTORICAL_SCHEMA_SYNC_INTERVAL_SECONDS=30
```

Production note for CrateDB:

```bash
sudo sysctl -w vm.max_map_count=262144
```

For permanent Linux configuration:

```bash
echo "vm.max_map_count=262144" | sudo tee -a /etc/sysctl.conf
sudo sysctl -p
```

**Why?** It permanently raises Linux’s virtual memory map limit so CrateDB can run reliably after reboot without hitting Elasticsearch/Lucene memory-mapping limits.

---

## First-time Setup

Open PowerShell in:

```powershell
cd DT_V3.0/docker_compose
```

Generate local secrets and `.env` values:

```powershell
./bootstrap/prepare-env.ps1
```

For linux users run:
```shell
pwsh-lts -File ./prepare-env.ps1
```

Start the stack:

```powershell
docker compose up -d --build
```

Open the portal (localhost or ip):

```text
http://localhost:8001
```

Sign in through Keyrock.

The generated credentials are in:

```text
DT_V2.3/docker_compose/.env
```

---

## Updating an Existing Stack

If the stack was already running before the historical services were added:

```powershell
cd DT_V2.3/docker_compose
docker compose up -d --build crate-db quantumleap historical-schema-sync
docker compose run --rm historical-subscription
docker compose up -d --force-recreate api-gateway portal-bff pep-proxy keyrock-bootstrap
```

Check service status:

```powershell
docker ps --format "table {{.Names}}\t{{.Status}}"
```

Check QuantumLeap logs:

```powershell
docker logs fiware-quantumleap --tail 100
```

Check schema sync logs:

```powershell
docker logs historical-schema-sync --tail 100
```

---

## Querying Historical Data Through QuantumLeap

From inside the Docker network:

```powershell
docker run --rm --network docker_compose_fiware_net curlimages/curl:8.6.0 -sS `
  -H "Fiware-Service: openiot" `
  -H "Fiware-ServicePath: /" `
  "http://quantumleap:8668/v2/entities/urn%3Angsi-ld%3AMachine%3A00-00-1B-C4-58-GB/attrs/pressure_negative?type=Machine&lastN=10"
```

With a time range:

```powershell
docker run --rm --network docker_compose_fiware_net curlimages/curl:8.6.0 -sS `
  -H "Fiware-Service: openiot" `
  -H "Fiware-ServicePath: /" `
  "http://quantumleap:8668/v2/entities/urn%3Angsi-ld%3AMachine%3A00-00-1B-C4-58-GB/attrs/pressure_negative?type=Machine&fromDate=2026-05-26T16%3A00%3A00.000Z&toDate=2026-05-26T17%3A00%3A00.000Z&lastN=500"
```

Expected response shape:

```json
{
  "attrName": "pressure_negative",
  "entityId": "urn:ngsi-ld:Machine:00-00-1B-C4-58-GB",
  "entityType": "Machine",
  "index": [
    "2026-05-26T16:21:04.323+00:00"
  ],
  "values": [
    "2.293"
  ]
}
```

---

## Accessing CrateDB Without Exposing It

CrateDB is internal-only, so use `docker exec` or a temporary container on the Compose network.

### Open an interactive Crate shell

```powershell
docker exec -it db-crate crash --hosts http://localhost:4200
```

Then run SQL:

```sql
SHOW TABLES;
SHOW CREATE TABLE "mtopeniot"."etmachine";
SELECT COUNT(*) FROM "mtopeniot"."etmachine";
```

### Run one-off SQL commands

Show the auto-created Machine table:

```powershell
docker exec db-crate crash --hosts http://localhost:4200 -c 'SHOW CREATE TABLE "mtopeniot"."etmachine"'
```

Count historical rows:

```powershell
docker exec db-crate crash --hosts http://localhost:4200 -c 'SELECT COUNT(*) AS total_rows FROM "mtopeniot"."etmachine"'
```

List columns:

```powershell
docker exec db-crate crash --hosts http://localhost:4200 -c 'SELECT column_name, data_type FROM information_schema.columns WHERE table_schema = ''mtopeniot'' AND table_name = ''etmachine'' ORDER BY ordinal_position'
```

Query recent samples for one machine:

```powershell
docker exec db-crate crash --hosts http://localhost:4200 -c 'SELECT entity_id, time_index, pressure_negative FROM "mtopeniot"."etmachine" WHERE entity_id = ''urn:ngsi-ld:Machine:00-00-1B-C4-58-GB'' AND pressure_negative IS NOT NULL ORDER BY time_index DESC LIMIT 20'
```

Query recent multi-attribute samples:

```powershell
docker exec db-crate crash --hosts http://localhost:4200 -c 'SELECT entity_id, time_index, ambient_temperature, ambient_humidity, pressure_positive, pressure_negative, pressure_degassing, pressure_subtank, machine_status FROM "mtopeniot"."etmachine" ORDER BY time_index DESC LIMIT 20'
```

Aggregate by minute:

```powershell
docker exec db-crate crash --hosts http://localhost:4200 -c 'SELECT date_trunc(''minute'', time_index) AS minute, AVG(CAST(pressure_negative AS DOUBLE)) AS avg_pressure_negative FROM "mtopeniot"."etmachine" WHERE pressure_negative IS NOT NULL GROUP BY minute ORDER BY minute DESC LIMIT 30'
```

Check failed fallback rows:

```powershell
docker exec db-crate crash --hosts http://localhost:4200 -c 'SELECT entity_id, time_index, __original_ngsi_entity__[''error''] AS error FROM "mtopeniot"."etmachine" WHERE __original_ngsi_entity__[''error''] IS NOT NULL ORDER BY time_index DESC LIMIT 10'
```

Fallback rows can appear if QuantumLeap receives an attribute before the CrateDB column exists. The `historical-schema-sync` service reduces this risk for future attributes.

---

## Inspecting the Orion Subscription

List all subscriptions:

```powershell
docker run --rm --network docker_compose_fiware_net curlimages/curl:8.6.0 -sS `
  -H "Fiware-Service: openiot" `
  -H "Fiware-ServicePath: /" `
  "http://orion-v2:1026/v2/subscriptions?limit=1000"
```

The historical subscription should include:

```json
{
  "notification": {
    "onlyChangedAttrs": true,
    "attrsFormat": "normalized",
    "http": {
      "url": "http://quantumleap:8668/v2/notify"
    }
  }
}
```

Re-run the bootstrap if needed:

```powershell
docker compose run --rm historical-subscription
```

---

## Validation Checklist

### Infrastructure

```powershell
docker compose config --quiet
docker ps --format "table {{.Names}}\t{{.Status}}"
```

Expected services include:

- `db-crate`
- `fiware-quantumleap`
- `historical-schema-sync`
- `historical-subscription` as a completed bootstrap run

### QuantumLeap

```powershell
docker logs fiware-quantumleap --tail 100
```

Look for:

```text
Notification successfully processed
```

### CrateDB

```powershell
docker exec db-crate crash --hosts http://localhost:4200 -c 'SELECT COUNT(*) AS total_rows FROM "mtopeniot"."etmachine"'
```

### Portal

1. Open `http://localhost:8001`.
2. Sign in.
3. Register a machine in the portal.
4. Confirm the telemetry attributes match MQTT object IDs.
5. Start telemetry publishing.
6. Open **Historical Data**.
7. Select machine, attribute, and range.
8. Click **Load history**.
9. Optionally enable auto refresh.

---

## Known Behavior

### Historical data begins only after subscription

Orion keeps only current state. Values overwritten before the QuantumLeap subscription existed cannot be recovered from Orion.

### Repeated historical rows

Older data may contain repeated values if it was stored before the subscription was changed to `onlyChangedAttrs: true`.

New data should be closer to one stored row per real attribute update.

### Attribute names

The portal may show a friendly registered name such as:

```text
PressureNegative
```

But QuantumLeap and CrateDB store the Orion attribute name derived from the MQTT object ID:

```text
pressure_negative
```

This is expected.

### CrateDB column types

The current IoT Agent/Orion flow may store some numeric values as `Text` attributes. The portal converts numeric-looking values for charting. Later ML extraction should explicitly cast values in SQL when building training datasets.

Example:

```sql
CAST(pressure_negative AS DOUBLE)
```

---

## Secret Rotation

To rotate generated secrets:

```powershell
cd DT_V2.3/docker_compose
./bootstrap/prepare-env.ps1 -RotateSecrets
docker compose up -d --build --force-recreate
```

---

## Licence

MIT © Tiago Lemos

---

*Platform built with FIWARE Generic Enablers, CrateDB, QuantumLeap, and modern web technologies.*
