# Phase II - Security

**This phase introduces a major security and architecture upgrade over the previous version.**
Please contact the developer for the previous folders/versions for instructions and explanations of files that were not changed, as unchanged details are not duplicated here.

This README contains the **main changes introduced in this version**, including the new authentication flow, authorization improvements, and updated portal/admin behavior.

## Project Identification

**Repository**: `tiagolemos02/PhaseII-Security/DT_V2.3`

**Version**: `1.3.0`

**Author**: Tiago Lemos

**Licence**: MIT

---

## New in v1.3.0

### ✅ Machine registration control — portal-only "Machines in Use"

Previously, any device that the IoT Agent had ever auto-provisioned (e.g. via the MQTT broker) would appear in **Machines in Use** as soon as the page loaded or a service group was created, even if it was never explicitly registered through the portal form.

**What changed:**

* A `localStorage` registry (`dt_portal_registered_devices`) now tracks which device IDs have been explicitly registered through the portal
* `fetchMachines()` filters the IoT Agent device list against this registry instead of relying on `static_attributes` (which the custom IoT Agent build does not return in GET responses)
* Creating a service group no longer triggers an automatic machine fetch that surfaced unrelated devices
* Registering a machine writes its `deviceId` to the registry; deleting it removes the entry

---

### ✅ Device picker in "Add Machine" form

When the user selects a service group in the **Add Machine** form, a collapsible **"Available device IDs from IoT Agent"** section now appears beneath the Device ID field.

**What was added:**

* Devices already present in the IoT Agent for that service group are listed as clickable buttons — clicking one fills the Device ID field automatically
* Devices already registered through the portal show a **Registered** badge and are not clickable (they cannot be registered twice)
* The picker refreshes after every successful registration
* New HTML element `#deviceIdPickerWrapper` added to `index.html`; five new exports added to `dom-elements.js`

---

### ✅ Auto-provisioned device registration (PUT instead of POST)

When a device is already present in the IoT Agent (auto-provisioned by the MQTT broker before any portal interaction), attempting to register it via `POST /iot/devices` would fail with a duplicate-device error.

**What changed:**

* `handleMachineSubmit()` now checks `allIotDevices` before submitting
* If the device already exists in the IoT Agent: sends `PUT /iot/devices/{id}` to attach portal metadata (friendly name, static attributes, entity name)
* If the device does not exist: sends `POST /iot/devices` as before
* The localStorage registry is updated on success regardless of which method was used

---

### ✅ Duplicate machine row fix

When registering an auto-provisioned device via PUT, the IoT Agent ends up holding two records with the same `deviceId` but different `entityName` values.

Example:

* Auto-provisioned record: `Machine:00:00:1B:C4:58:GB` (format used by the MQTT binding)
* Portal PUT record: `urn:ngsi-ld:Machine:00-00-1B-C4-58-GB` (format used by `buildEntityName`)

Because `mergeDuplicateDevices` keys on `[deviceId, entityName, serviceKey]`, both records survived deduplication and both passed the localStorage filter, causing two rows to appear for the same physical machine — and deleting the ghost row also deleted the real registration.

**What changed:**

* `fetchMachines()` now deduplicates the filtered machine list by `deviceId`, keeping only the preferred entry
* Preference: `urn:ngsi-ld:` entity name wins over the auto-provisioned format; more static attributes breaks ties
* A new private helper `isPreferredMachineEntry()` encapsulates the preference logic
* `mergeDuplicateDevices` itself is unchanged (its composite key is intentional for other scenarios)

---

### ✅ Orion Logs — registered machines and attributes only

The Orion Logs tab previously showed every Orion entity of type `Machine`, and for each entity it displayed every attribute the MQTT broker had ever published — including sensor readings not registered through the portal and all system-generated static attributes.

**What changed:**

* **Entity filter**: only entities whose `id` appears in the portal's registered machine set are shown. Before any machine is registered, an instructional placeholder is displayed.
* **Attribute filter**: for each entity, only attributes matching the registered telemetry attribute names (both the camelCase `name` and the snake_case last segment of `object_id`) and user-defined static attribute names are shown. Attributes sent by the broker but not registered through the portal are hidden.
* System-generated static attributes (`serviceGroupKey`, `friendlyName`, `operationalStatus`, `serviceGroupResource`, `serviceGroupFiware`, `serviceGroupSubservice`) are excluded from the log rows.

---

### ✅ Datetime hex value decoding in Orion Logs

The MQTT simulator encodes `datetime`-type attribute values as ASCII-hex strings (e.g. `323032362d30342d30312031303a31343a3332` represents `2026-04-01 10:14:32`). These were previously displayed as-is, showing unreadable garbage.

**What changed:**

* A `tryDecodeHexValue()` helper detects strings of even-length hex characters, decodes them to ASCII, and validates the result as a parseable date
* If decoding succeeds, the readable date string is shown instead of the raw hex

---

### ✅ Orion Logs — machine label instead of raw entity URI

Device header rows in the Orion Logs table previously showed the full Orion entity URI (e.g. `urn:ngsi-ld:Machine:5C-8D-E5-09-5E-D1`).

**What changed:**

* Header rows now show `"Friendly Name (DeviceID)"` when a friendly name exists, or just `"DeviceID"` when it does not
* A new exported helper `getMachineLabel(entityId)` in `inventory.js` provides this lookup

---

### ✅ Attributes modal — legend and controls repositioned

The color legend (indigo = user-defined, amber = system-generated) and the **Show/Hide system** toggle button were previously rendered inside the **Static Attributes** section, making them invisible when viewing the Telemetry section alone.

**What changed:**

* The legend row and the Show/Hide button are now rendered at the **top of the visual panel**, above the Telemetry Attributes table, so they are always visible regardless of scroll position
* The Static Attributes heading is now a plain heading with no controls attached

---

### ✅ New exported helpers in `inventory.js`

Two new module exports were added alongside the existing `getRegisteredMachineEntityIds()`:

| Function | Purpose |
|----------|---------|
| `getRegisteredMachineAttributeNames(entityId)` | Returns a `Set` of allowed Orion attribute names for a given entity (telemetry names + `object_id` last segments + user-defined static names) |
| `getMachineLabel(entityId)` | Returns a human-readable label: `"Friendly Name (DeviceID)"` or `"DeviceID"` |

---

### Technical summary — files changed in v1.3.0

| File | Changes |
|------|---------|
| `web/digital-twin-portal/js/inventory.js` | localStorage helpers; `fetchMachines()` dedup; PUT-for-existing in `handleMachineSubmit()`; `handleDeleteMachine()` cleanup; picker event listeners and `handleServiceGroupPickerChange()`; `isPreferredMachineEntry()`; two new exports; attributes modal legend repositioned |
| `web/digital-twin-portal/js/orion-logs.js` | Import updated; `escapeHtml` local helper; `tryDecodeHexValue()`; attribute filter in `processDeviceData()`; `getMachineLabel()` in `createDeviceRow()` |
| `web/digital-twin-portal/index.html` | Device picker HTML block added to Add Machine form |
| `web/digital-twin-portal/js/dom-elements.js` | Five new picker element exports |

---

## Fix in v1.2.2

### ✅ IoT Agent MongoDB connection — credential embedding and authSource

`IOTA_MONGO_URI` (introduced in v1.2.1) is not recognized by the version of `iotagent-node-lib` bundled in the custom image. When set, the library ignores it and falls back to `localhost:27017`, causing an immediate `ECONNREFUSED`.

**Root cause:** The custom image uses an older version of `iotagent-node-lib` that constructs the MongoDB URI from individual `IOTA_MONGO_HOST` / `IOTA_MONGO_PORT` / `IOTA_MONGO_DB` variables. When `IOTA_MONGO_USER` and `IOTA_MONGO_PASSWORD` are also set, the library additionally injects `auth: { user, pass }` as a separate Mongoose option — a format MongoDB driver v4 rejects (v1.2.0 issue). When they are not set, no auth option is injected and the URI is passed through cleanly.

**What changed:**

* Replaced `IOTA_MONGO_URI` with the three individual vars the old library actually reads
* Credentials are embedded directly in `IOTA_MONGO_HOST` (as `user:pass@mongo-db`) so no separate `auth` option is injected
* `?authSource=admin` is appended to `IOTA_MONGO_DB` so the driver authenticates against the `admin` database where the root user lives
* Final URI the library constructs: `mongodb://user:pass@mongo-db:27017/iotagentjson?authSource=admin`

---

## Fix in v1.2.1

### ✅ IoT Agent MongoDB connection with authentication

After enabling MongoDB authentication in v1.2.0, `fiware-custom-agent` was exiting immediately with a `MongoParseError: credentials must be an object with 'username' and 'password' properties`.

**Root cause:** `iotagent-node-lib` was building the connection URI with credentials embedded (`mongodb://user:pass@host/db`) but simultaneously passing the credentials as a separate `auth: { user, pass }` object to Mongoose. MongoDB driver v4 rejects the old `{ user, pass }` format and requires `{ username, password }`, causing the conflict.

**What changed:**

* Replaced the five individual `IOTA_MONGO_HOST` / `IOTA_MONGO_PORT` / `IOTA_MONGO_DB` / `IOTA_MONGO_USER` / `IOTA_MONGO_PASSWORD` env vars in the `iot-agent` service with a single `IOTA_MONGO_URI`
* When the library receives a full URI it passes it directly to Mongoose without injecting the broken `auth` options object

---

## Security hardening in v1.2.0

### ✅ MongoDB authentication and port hardening

MongoDB was previously exposed on host port `27017` with no authentication, making it reachable by anyone with network access to the server. An automated ransomware bot exploited this to drop all databases.

**What changed:**

* `mongo-db` no longer binds port `27017` to the host — it is only reachable within the Docker internal network (`fiware_net`)
* MongoDB now requires authentication: `MONGO_INITDB_ROOT_USERNAME` / `MONGO_INITDB_ROOT_PASSWORD` are set on startup
* Orion's `-dbURI` and the IoT Agent's `IOTA_MONGO_USER` / `IOTA_MONGO_PASSWORD` are updated to authenticate with MongoDB
* `MONGO_ROOT_PASSWORD` is auto-generated by `prepare-env.ps1` using the same 40-character alphanumeric `New-RandomSecret` logic as all other secrets

### ✅ MySQL port removed from host

MySQL was also bound to the host on `${MYSQL_DB_PORT}:3306`. It is only used internally by Keyrock and already has authentication via Docker secrets, so the external binding was unnecessary exposure.

**What changed:**

* `mysql-db` no longer publishes port `3306` to the host

### ✅ New environment variables

`prepare-env.ps1` now auto-generates `MONGO_ROOT_PASSWORD` on first run (and on `-RotateSecrets`). The `.env.example` template includes two new entries:

```
MONGO_ROOT_USERNAME=admin
MONGO_ROOT_PASSWORD=        # auto-generated
```

No manual action is needed — running `./bootstrap/prepare-env.ps1` handles everything as before.

---

## New in v1.1.0

### ✅ Machine edit modal

Machines in the **Machine & Services** tab now have an **Edit** button that opens a modal overlay pre-populated with all the machine's current settings.

**What was added:**

* Edit button next to the existing Delete button in the Machines table
* Full-featured modal with the same fields as the Add Machine form:
  * Device ID (read-only)
  * Service group selector
  * Name, model, description, operational status
  * Telemetry attributes section with Manual/Automatic toggle
  * Static attributes section with Manual/Automatic toggle
* Changes are submitted via `PUT /iot/devices/{deviceId}`
* On success the table refreshes automatically

**Authorization:**

The IoT Agent's PUT endpoint was not covered by the original XACML policy. A new rule was added to both `keyrock-bootstrap.sh` and `existing-policy-v8.xml` granting the `admin` role PUT access to `/iot/devices/{id}`.

> After updating these files, re-run the bootstrap service to push the new permission into the live Keyrock/AuthzForce instance:
> ```bash
> docker compose up keyrock-bootstrap
> ```

---

### ✅ Attribute details modal

The **Attributes** count shown in the Details column of the Machines table is now accurate and interactive.

**What was fixed:**

* The count previously included system-generated static attributes (e.g. `friendlyName`, `model`, `operationalStatus`, `serviceGroupKey`, etc.), inflating the number. It now shows only user-defined telemetry and custom static attributes.

**What was added:**

* The count is now a clickable link that opens an **Attributes modal** showing:

  * **Left panel — Visual view**: two tables, one for telemetry attributes (Object ID / Name / Type) and one for custom static attributes (Name / Type / Value)
  * **Right panel — JSON view**: the raw attribute arrays formatted as JSON

* **Color coding** (consistent across both panels):

  | Color | Meaning |
  |-------|---------|
  | Indigo | User-defined attributes |
  | Amber | System-generated static attributes |

* **Eye toggle button** in the Static Attributes header: shows or hides the system-generated entries in both the visual table and the JSON panel simultaneously. Hidden by default to reduce noise.
* A **legend** below the section header identifies the two colors.

---

## What changed

 ### ✅ New Backend-for-Frontend (BFF) + Authorization Code flow

The biggest architectural change in this version is the introduction of a **backend-for-frontend (`portal-bff`)** for authentication.

**Before** (old behavior):

* Browser handled authentication more directly.
* OAuth configuration was inconsistent with the intended Authorization Code flow.
* Logout/session behavior could leave the user effectively logged into Keyrock SSO.

**Now** (new behavior):

* A new **`portal-bff`** service starts the **Authorization Code** flow with Keyrock.
* The BFF exchanges the authorization code for tokens **server-side**.
* Tokens are stored in a **server session backed by HttpOnly cookies**.
* The browser no longer needs to store OAuth secrets/tokens directly.
* The BFF proxies FIWARE and Keyrock admin API requests, so the front-end talks to the BFF instead of exposing secrets in the browser.

This aligns the portal with a safer authentication model and fixes the previous mismatch between the BFF’s use of `response_type=code` and the Keyrock application grant configuration. 

---

### ✅ OAuth flow and session fixes

Several authentication bugs were fixed as part of the BFF migration:

* Enforced **`authorization_code`** grant type during bootstrap.
* Added bootstrap logic to **repair/update existing Keyrock app settings** on every run.
* Removed invalid attempts to patch `response_type` directly.
* Added safer login behavior with:

  * `prompt=login`
  * `max_age=0`
* Added local session reset on login start, callback errors, and state mismatch.
* Fixed logout so it now clears the BFF session **and** redirects through Keyrock external logout, solving the SSO persistence issue.

These changes make login/logout behavior predictable and prevent stale sessions or accidental cross-user reuse. 

---

### ✅ One secure portal entrypoint

The portal is now meant to be accessed through the BFF entrypoint:

* **Portal URL:** `http://localhost:8001`

From there:

* Click **Sign In**
* You are redirected to Keyrock
* After authentication, you return to the portal already authenticated via the BFF session

This replaces the previous browser-token-style interaction model. The final normalized configuration keeps the portal on port `8001` across env files, templates, compose, and docs. 

---

### ✅ Authzforce-backed ABAC (working hours + viewer constraints)

This version also upgrades authorization from basic role-based behavior to a real **Authzforce-backed ABAC** flow for restricted users.

**What was added:**

* A **custom Authzforce request context injector** for the PEP:

  * injects `lisbon-weekday`
  * injects `lisbon-time`
* A **Keyrock Authzforce template override** to improve generated rule behavior
* A **persistent Keyrock runtime patch** to fix the Authzforce request path issue in the PEP → Keyrock → Authzforce chain
* A **working-hours XACML rule** for the `viewer` role:

  * Monday to Friday only
  * `09:00–13:00` or `14:00–18:00`
  * evaluated using Lisbon timezone values

**Why this matters:**
- Advanced XACML rules didn't exist in the previous stack. Now with AuthzForce is possible to create permissions with extra-granularity. This is possible updating an XACML rule for permissions (a button to help create this rules is provided in the XACML rule section).
- This **viewer** role was created as a *test* to implemeent AuthZForce and also to create this permission from the deplyment phase. Since is not a regular XACMl rule it has some dependent files related to that. But any XACMl rule is permitted in the portal (*using the rules and references for that*).
- Any other type of rule that goes behind the scope can be added like this **working-hours XACML rule**
---

### ✅ Bootstrap automation and reproducibility

This version adds more deterministic setup through dedicated bootstrap scripts.

**Added:**

* **MySQL bootstrap script flow**

  * Moves DB initialization logic out of inline compose commands
  * Keeps initialization more scripted and repeatable
* **Keyrock bootstrap automation**

  * Creates/synchronizes:

    * application
    * PEP credentials
    * roles
    * users
    * permissions
    * Authzforce-related policy sync behavior

This replaces more manual or ad-hoc setup steps and makes the stack easier to recreate consistently.  

---

### ✅ BFF proxy correctness fixes

The BFF now correctly forwards request bodies to proxied services.

**What changed:**

* Added raw-body-first middleware handling
* Added proper proxy body forwarding for:

  * buffer
  * string
  * object payloads
* Removed the fragile previous forwarding logic

**Why:**

Without this fix, some Keyrock admin operations (such as role/permission creation) could fail because the JSON body was being consumed or reshaped before proxying. 

---

### ✅ Full Roles & Permissions management in the portal

The portal now includes a much more complete **Roles & Permissions** administration experience.

**Implemented in the UI:**

1. Create roles
2. Delete roles
3. Create permissions
4. Edit permissions
5. Delete permissions globally
6. Assign permissions to a role
7. Remove permissions from a role
8. Assign roles to users
9. Remove roles from users
10. Delete users

**Also added:**

* Support for both basic permissions and advanced **XACML** permissions
* An **XACML help modal** with FIWARE/Authzforce guidance and example rules

This replaces the earlier placeholder-style Roles & Permissions area with a much more complete admin interface that mirrors Keyrock capabilities. 

---

### ✅ Improved Roles & Permissions UX

The Roles & Permissions screen was also redesigned for better usability.

**Changes:**

* Removed the old User Management “Actions” column
* Removed the global permissions table view
* Switched to **role-scoped permissions only**
* Reworked the layout into a **split-screen master-detail view**:

  * **Left:** roles list
  * **Right:** permissions for the selected role
* Added a cleaner empty state with an inline **“Create new permission”** action

**Why:**

- Permissions are now contextual to the selected role, reducing noise and making role administration clearer and safer. 

- This also removes the necessity to use keyrock for this operations

---

### ✅ Restricted-user UX improvements

For users without access to certain tabs or actions:

* Restricted tabs can now show a denied placeholder
* The UI can grey out unavailable sections
* Unauthorized sections are hidden more cleanly
* The portal avoids unnecessary restricted data refreshes/calls where possible

This complements backend authorization enforcement by making the front-end behavior cleaner and less confusing for limited users.  

---

## Technical summary of updated files

Below is a high-level summary of the main files and areas changed in this version.

### Docker / Bootstrap / Security

* `docker_compose/docker-compose.yml`

  * Updated to include the new `portal-bff`
  * Includes bootstrap/runtime patch wiring
  * Includes Authzforce custom policy integration
  * *(v1.2.0)* MongoDB authentication added; host port bindings removed for MongoDB and MySQL

* `docker_compose/.env.example`

  * *(v1.2.0)* Added `MONGO_ROOT_USERNAME` and `MONGO_ROOT_PASSWORD`

* `docker_compose/bootstrap/prepare-env.ps1`

  * *(v1.2.0)* Added `MONGO_ROOT_PASSWORD` to the auto-generated secrets list

* `docker_compose/bootstrap/mysql-bootstrap.sh`

  * Dedicated MySQL initialization flow

* `docker_compose/bootstrap/keyrock-bootstrap.sh`

  * Automates Keyrock application, roles, users, permissions, PEP, and OAuth configuration
  * Handles idempotent re-runs and config convergence

* `docker_compose/bootstrap/pep-authzforce-custom-policy.js`

  * Injects Lisbon weekday/time into the PDP request context

* `docker_compose/bootstrap/keyrock-authzforce-rule.ejs`

  * Custom rule template override for Keyrock/Authzforce integration

* `docker_compose/bff/server.js`

  * Implements the BFF auth/session/proxy logic
  * Includes login, callback, logout, and body-forwarding fixes

These infrastructure and backend-auth changes are the core of the new security model.  

### Portal / Front-End

* `web/digital-twin-portal/index.html`
* `web/digital-twin-portal/js/roles-permissions.js`
* `web/digital-twin-portal/js/dom-elements.js`
* `web/digital-twin-portal/js/main.js`
* `web/digital-twin-portal/js/auth.js`
* `web/digital-twin-portal/js/users.js`
* `web/digital-twin-portal/js/ui-helpers.js`
* `web/digital-twin-portal/css/custom.css`

These changes implement:

* full Roles & Permissions management
* improved role/permission UX
* XACML help UI
* restricted-tab placeholders and cleaner denied states
* better role-scoped admin flows

All of these were part of the portal-focused technical changes in the uploaded summaries.  

---

## Validation highlights

This version was validated with the following expected behavior:

* `admin` can access Orion + IoT operations
* `viewer` can access Orion logs
* `viewer` is denied IoT operations
* Working-hours ABAC behaves as expected:

  * `Wed 10:00` → Permit
  * `Sat 10:00` → Deny
  * `Wed 13:30` → Deny

This confirms that both role restrictions and time-based ABAC rules are working correctly. 

---

## First-time setup

For Windows users, open **PowerShell** in `docker_compose` and run:

```powershell
./bootstrap/prepare-env.ps1
```

For Linux users run:

```terminal
pwsh-lts -File ./prepare-env.ps1
```

Then start the stack:

```powershell
docker compose up -d --build
```

After that, open the portal at:

`http://localhost:8001`

Open the .env file inside docker_compose folder to see the passwords generated.

Click **Sign In**. You will be redirected to Keyrock, and after authentication you will be returned to the portal. This setup flow is part of the new BFF-based security baseline you provided. 

---

## Secret rotation

To rotate generated secrets:

```powershell
./bootstrap/prepare-env.ps1 -RotateSecrets
```

Then recreate the stack.

---

## Licença

MIT © Tiago Lemos

---

*Plataforma construída com FIWARE Generic Enablers e tecnologias web modernas*
