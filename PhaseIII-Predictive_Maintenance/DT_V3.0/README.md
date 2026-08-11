# Phase III - Predictive Maintenance v1.0.2

**Version 1.0.2 adds versioned logical and physical data contracts for CrateDB telemetry, canonical ML records, maintenance events, datasets, exports, features, and models while preserving the frozen v1.0.0 experiment and the v1.0.1 environment.**

Version `1.0.2` adds strict Pydantic contracts, generated JSON Schemas, Arrow/Parquet schemas, valid and invalid fixtures,
CrateDB physical-type validation, privacy-safe normalization, versioned manifests, deterministic SHA-256 integrity,
feature/model compatibility checks, CLI validation/export commands, Docker build checks, and expanded ML documentation.

Version `1.0.2` does not yet generate synthetic history, calculate labels or features, train or run MVP models, connect to
or export enterprise CrateDB data, write predictions to FIWARE, change the portal placeholder, or alter MQTT, IoT Agent,
Orion, QuantumLeap, CrateDB, BFF, authentication, authorization, connectivity, or machine-state behavior.

The existing Phase II security model remains the baseline: browser traffic goes through the portal, PEP Proxy, API Gateway, Keyrock, and AuthzForce policies. CrateDB and QuantumLeap are intentionally kept internal-only.

## Project Identification

**Repository**: `tiagolemos02/PhaseIII-PM/DT_V3.0.1`

**Phase**: `Phase III - Predictive Maintenance`

**Version**: `1.0.2`

**Author**: Tiago Lemos

**Licence**: MIT

---

## Scope of v1.0.2

### Implemented

- Independent schema contract version `1.0.0`, separate from software release `1.0.2`
- Strict canonical telemetry records for `synthetic_historical`, `mqtt_prospective`, and `real_shadow` sources
- CrateDB source-row validation for `TEXT`, `REAL`, and `TIMESTAMP WITH TIME ZONE` data returned by QuantumLeap history
- Explicit acceptance of CrateDB HTTP Unix-millisecond timestamps and timezone-qualified ISO-8601 timestamps
- UTC normalization, finite-number enforcement, source/split consistency, and pseudonymized machine identifiers
- Safe removal of raw enterprise `entity_id` and unrelated CrateDB columns from canonical ML records
- Independent maintenance-event records with component/label-source and causal timestamp invariants
- Dataset manifests with machine-disjoint splits, generator/code/config/schema lineage, units, scenarios, files, and status
- Enforcement of the frozen 100/30/30 independent-event gates when a dataset becomes `complete`
- Blocking of complete dataset manifests while source-native physical units remain unconfirmed
- Enterprise export manifests with requested and actual intervals, watermarks, row/machine counts, pseudonymization, status,
  and optional artifact receipt
- Rejection of raw enterprise identifiers from export attribute lists
- Ordered feature schemas with types, windows, units, imputation rules, component applicability, and leakage exclusions
- Model manifests with exact horizons/components, hyperparameters, seeds, calibration, validation thresholds, metrics,
  lineage, status, and portable files
- Canonical feature-schema SHA-256 and fail-closed feature/model compatibility validation
- Relative-path, size, media-type, role, row-count, and SHA-256 descriptors for portable artifacts
- Generated JSON Schemas for seven typed records/manifests and Arrow descriptors for telemetry and maintenance-event tables
- Generated-schema checksum manifest, atomic schema export, and stale-schema detection
- Valid fixtures for all contracts and deliberate invalid fixtures for leakage and timezone validation
- `contracts-export` and `contracts-check` CLI commands, including optional schema-only CrateDB snapshot validation
- Docker build-time contract, fixture, checksum, and regression validation

### New

| File | Purpose |
|------|---------|
| `ml/src/mtex_pdm/contracts/models.py` | Defines strict telemetry, event, artifact, dataset, export, feature, and model contracts |
| `ml/src/mtex_pdm/contracts/tabular.py` | Defines CrateDB physical-type validation and Arrow/Parquet table schemas |
| `ml/src/mtex_pdm/contracts/registry.py` | Generates schemas, hashes artifacts, validates bundles, and checks feature/model compatibility |
| `ml/src/mtex_pdm/contracts/__init__.py` | Exposes the supported public contracts API |
| `ml/schemas/*.schema.json` | Generated JSON Schemas for serialised contract records and manifests |
| `ml/schemas/*_table.arrow.json` | Generated, language-neutral descriptions of the two Parquet table layouts |
| `ml/schemas/checksums.sha256` | Detects stale or modified generated schema files |
| `ml/examples/contracts/*.example.json` | Supplies privacy-safe valid examples for every contract |
| `ml/examples/contracts/invalid/*.json` | Confirms that leakage and naive timestamps remain invalid |
| `ml/tests/test_contracts.py` | Protects CrateDB parsing, Arrow types, manifests, integrity, leakage, compatibility, and CLI behavior |

### Why

- Establish the exact data interfaces before synthetic generation, enterprise export, feature engineering, and training
- Prevent CrateDB `REAL`, text, or timestamp values from being silently misinterpreted by Python or Parquet
- Keep raw company entity identifiers out of ML datasets, manifests, examples, logs, and the repository
- Prevent training/test machine leakage and enforce the event-volume gates already frozen in v1.0.0
- Make every dataset, export, feature set, and model reproducible from immutable versions and SHA-256 receipts
- Stop a trained model from receiving missing, renamed, reordered, or semantically changed feature columns
- Avoid unsupported claims by preserving the separation between supervised synthetic data and unlabelled real shadow data
- Record unknown physical units honestly and block dataset freeze until the generator pilot confirms them
- Allow a schema-only enterprise check over SSH/SFTP without exposing CrateDB publicly or copying production telemetry
- Give the thesis concrete, inspectable evidence of data governance, provenance, leakage prevention, and reproducibility

### Not Changed

- No synthetic historical or MQTT generator and no added simulated machines
- No labels, computed features, dataset generation, model training, calibration execution, SHAP, or inference jobs
- No live CrateDB connection, enterprise data extraction, SSH/SFTP automation, or scheduled collection
- No machine registration, `MaintenancePrediction` entities, prediction persistence, BFF endpoints, or portal panel
- No changes to the four frozen YAML files or their v1.0.0 checksums
- No changes to MQTT topics, IoT Agent, Orion, QuantumLeap, CrateDB tables, security, connectivity, or machine-state behavior
- No assumption that undocumented temperature, humidity, counter, or pressure units have already been confirmed
- No claim of validated production predictive performance

Full contract, setup, CrateDB snapshot, unit-freeze, Docker, and validation instructions are in
[`ml/README.md`](ml/README.md).

---

## Scope of v1.0.1

### Implemented

- Installable Python package and `mtex-pdm` command-line interface for environment diagnostics
- CPython contract frozen to `>=3.12,<3.13` across Windows, macOS ARM64, and Linux x86-64
- Exact direct dependencies and fully resolved transitive lock with accepted distribution hashes
- Deliberate NumPy `2.4.6` compatibility pin for the SHAP/Numba toolchain
- Integrity and semantic validation of the four v1.0.0 frozen YAML configuration files
- Detection of unversioned configuration edits through the existing SHA-256 manifest
- Cross-file checks for the four canonical components, 24-hour and 7-day horizons, validation-only unset thresholds,
  historical split, objective name, and leakage exclusions
- Parquet/Zstandard write-and-read smoke test
- Deterministic eight-row LightGBM fit and probability smoke test using one worker
- pytest regression suite, Ruff lint/format configuration, and strict mypy configuration
- Official Python `3.12.13-slim-bookworm` Docker base pinned by a multi-architecture manifest digest
- Hash-verified package installation, build-time configuration validation, and tests in the Docker image
- Non-root final container process and one-thread native-library defaults
- Separate ARM64 and x86-64 build instructions and conservative device resource profiles
- Git and Docker exclusions for environments, caches, generated datasets, model artifacts, and reports

### New

| File | Purpose |
|------|---------|
| `ml/README.md` | Documents setup, validation commands, architecture builds, device limits, outputs, and current scope |
| `ml/pyproject.toml` | Defines the package, Python contract, direct dependency groups, CLI, and quality tools |
| `ml/requirements.in` | Records the intentional direct dependency versions |
| `ml/requirements.lock` | Freezes the complete transitive dependency graph with package hashes |
| `ml/Dockerfile.training` | Builds and verifies the same non-root training environment on ARM64 and x86-64 |
| `ml/.dockerignore` | Prevents local environments, caches, data, and artifacts from entering the build context |
| `ml/src/mtex_pdm/__init__.py` | Exposes the module release version |
| `ml/src/mtex_pdm/__main__.py` | Provides `config-check` and `environment-check` commands |
| `ml/src/mtex_pdm/config_validation.py` | Validates checksums and critical frozen-contract invariants |
| `ml/src/mtex_pdm/environment.py` | Checks Python, architecture, dependencies, Parquet, and LightGBM |
| `ml/tests/test_environment.py` | Protects configuration integrity, package version, CLI, and native-stack smoke behavior |

### Why

- Detect Python, native-wheel, architecture, or dependency incompatibilities before dataset generation and training
- Give the ARM64 MacBook and x86-64 home server equivalent environments without transferring incompatible images
- Keep local Windows analysis aligned with the same dependency and configuration contract
- Prevent unnoticed changes to targets, horizons, component definitions, data splits, or decision thresholds
- Make thesis results reproducible from an exact dependency graph and frozen experimental configuration
- Verify early that the selected stack can create portable Parquet data and execute the intended LightGBM library
- Limit default CPU contention on domestic devices that continue running unrelated processes
- Establish one documented module boundary for later generator, training, inference, export, and FIWARE work

### Not Changed

- No synthetic historical or MQTT telemetry generator
- No data schemas, dataset manifests, labels, features, model training, calibration, SHAP reports, or inference jobs
- No machine registration, enterprise CrateDB export, scheduled collection, SSH, or SFTP automation
- No `MaintenancePrediction` entities, QuantumLeap subscription, CrateDB prediction table, or BFF endpoints
- No predictive-maintenance portal panel, external notification, automatic work order, or machine control
- No changes to the four frozen YAML files or their v1.0.0 checksums
- No changes to MQTT topics, IoT Agent, Orion, QuantumLeap, CrateDB, security, connectivity, operational state, or 3D views
- No claim of validated production predictive performance

Full setup and operational instructions are in [`ml/README.md`](ml/README.md).

---

## Scope of v1.0.0

### Implemented

- Frozen MVP configuration version `1.0.0` under `ml/config`
- Canonical `maintenanceNeedProbability` objective, explicitly separated from real failure-probability claims
- Four initial components covering calendar, distance, vacuum-filter condition, and supply-pump condition maintenance
- Shared 24-hour lookback with 24-hour and 7-day prediction horizons
- One global LightGBM contract per horizon, with ETA and logistic regression retained as mandatory offline comparisons
- Machine-disjoint train, validation, test, and prospective MQTT boundaries
- Minimum independent-event gates per component before a dataset may be frozen
- Causal missing-data, forward-fill, stale-telemetry, reset, and data-coverage policies
- Validation-only threshold selection and visual status precedence
- ARM64 training and x86-64 runtime responsibilities with portable model artifacts
- Synthetic, prospective MQTT, and real-enterprise data-source boundaries
- Explicit included and excluded scope for the four-week implementation
- SHA-256 checksums covering every frozen YAML configuration file

### New

| File | Purpose |
|------|---------|
| `ml/config/mvp.yaml` | Freezes the objective, time, models, datasets, quality gates, device roles, and MVP scope |
| `ml/config/components.yaml` | Defines the four components, observable signals, label sources, hidden-state boundaries, ETA roles, and forbidden features |
| `ml/config/scenarios.yaml` | Freezes seeds, generation modes, split scenario pools, robustness reservations, prospective MQTT boundaries, event gates, and intervention policy |
| `ml/config/decision_policy.yaml` | Defines prediction availability, threshold-selection rules, alert episodes, horizon coherence, portal statuses, and non-automated actions |
| `ml/config/checksums.sha256` | Detects any unversioned change to the frozen configuration |

The predictive Python simulator may expose `pressure_supply_color_1` for the supply-pump condition experiment. This is
declared as a synthetic extension because the current ESP32 catalogue only exposes wiper-suction pressure signals. It is
optional for real-data shadow execution and must not be confused with an existing real-machine sensor.

### Why

- Prevent target, horizon, component, split, or threshold-policy changes after model results are observed
- Keep dataset generation, training, inference, FIWARE persistence, and thesis reporting aligned to one contract
- Make every future dataset and model traceable to an exact configuration checksum
- Keep hidden synthetic degradation and prospective machines out of training features
- Distinguish synthetic quantitative validation from unlabelled real-enterprise profiling and shadow inference
- Allow MacBook training and home-server inference without treating container images as cross-architecture artefacts
- Protect the one-month implementation window by recording optional work and non-goals before coding begins

### Not Changed

- No synthetic telemetry generator, labels, features, model training, calibration, SHAP, or inference service
- No `MaintenancePrediction` Orion entities, QuantumLeap subscription, CrateDB prediction table, or BFF endpoints
- No predictive-maintenance portal panel or external notifications
- No enterprise ML deployment, automatic retraining, automatic work orders, or machine control
- No changes to the existing ESP32 simulator, MQTT topics/payloads, IoT Agent, Orion, QuantumLeap, CrateDB, or historical subscription
- No changes to OAuth Authorization Code flow, Keyrock, PEP Proxy, AuthzForce, FIWARE tenant headers, connectivity thresholds, operational-state mappings, 3D factory, or personal layouts
- No claim that synthetic model results represent validated production performance

This release establishes the immutable experimental boundary for the implementation that follows. A future change to
the frozen contract requires a version bump, a recorded reason, regenerated checksums, and explicit identification of
the affected datasets and models.

---

## Scope of v0.8.1

### Implemented

- Numeric NGSI contract for all 75 bounded maintenance counters in the canonical simulator/provisioning mapping
- Normalized IoT Agent measure types allowed to override stale provisioned types without mutating the persisted device object
- Generated `_minimum` and `_maximum` attributes discovered from Orion even when their base attribute is registered as `Number`
- Contract regression test covering the complete set of 75 maintenance counters
- One-shot, idempotent IoT Agent registry migration with an original-document MongoDB backup
- One-shot, idempotent CrateDB migration from `OBJECT` to `REAL`, retaining each old column with the `__legacy_bounded_number_v1` suffix
- Automatic capture and reconstruction of views that depend on migrated historical columns
- Historical schema synchronization that validates existing column types and fails visibly on incompatible contracts
- Node.js schema synchronization and migration tools with no package downloads during container startup
- Optional localhost-only CrateDB diagnostics override through `docker-compose.diagnostics.yml`
- Portal, IoT Agent, Compose, migration, live Orion, QuantumLeap, CrateDB, and idempotency validation

### Not Changed

- Real-machine MQTT topic format `<deviceId>/state/<attribute>` or bounded `{ value, minimum, maximum }` payloads
- Generated limit names or their read-only behavior in the portal
- Connectivity thresholds, operational-state mappings, 3D factory behavior, or personal layout persistence
- OAuth Authorization Code flow, Keyrock, PEP Proxy, AuthzForce, or FIWARE tenant headers
- ML training, anomaly detection, remaining useful life, forecasts, or prediction write-back

This patch removes the schema mismatch that caused `print_bar_traveled_distance_since_last_pm` and the other bounded
counter values to appear as `NULL` in CrateDB while preserving all pre-migration data for an explicit later retention
decision.

---

## Scope of v0.8

### Implemented

- Always-visible nine-pixel connectivity dot before the Asset ID on each black machine plate, using the existing Online, Stale, Offline, and Unknown colors
- Operational-state ground ring separated from connectivity and colored from the canonical mappings in `machine-status.js`
- Connectivity-aware ring attenuation: `0.92` Online, `0.68` Stale, `0.38` Offline, and `0.52` Unknown or monitoring unavailable
- Ring updates applied on the existing shared four-second machine snapshot without creating another request, subscription, or timer
- Emergency (`1`) and Critical error (`14`) pulse limited to Online machines, with pulse disabled when reduced motion is requested
- Expanded hover details with independent **Connectivity** and **Operational** or **Last operational** lines, including connectivity age and the operational code
- Solid-dot and outlined-ring symbols in hover details so status remains understandable without relying on color alone
- Compact map legend, closed by default, explaining the dot and ring channels plus all four connectivity colors
- Accessible legend interaction through a standard info button, tooltip, `aria-expanded`, visible keyboard focus, outside click, and `Escape`
- Legend hidden during loading, error, and empty-map states and closed automatically when leaving the 3D Digital Twin
- Pure visual-state resolver and unit coverage for channel separation, attenuation, critical pulse eligibility, reduced motion, unavailable monitoring, and unknown operational codes

### Not Changed

- Shared four-second activity polling, Orion query modes, failure handling, or tab-visibility recovery
- Connectivity thresholds or operational-state code and color definitions
- Current State, Machines In Use, or selected-machine inspector content and behavior
- Asset ID values, machine identity colors, GLB model, factory environment, camera, selection, or layout editing
- MQTT topics and payloads, simulator, custom IoT Agent, Orion, QuantumLeap, CrateDB, BFF, OAuth Authorization Code, Keyrock, PEP Proxy, or AuthzForce behavior
- Predictive-maintenance forecasts, ML training, anomaly detection, or remaining useful life calculation

This release makes connectivity and operational state independently readable directly on the factory map, avoiding the previous ambiguity in which the ground ring was overwritten with the connectivity color.

---

## Scope of v0.7.3

### Implemented

- Shared machine-activity source for Current State, Machines In Use, and the 3D Digital Twin
- Common four-second refresh cycle replacing the independent 1.5-second Current State and slower inventory status timers
- Lightweight Orion activity queries outside Current State, limited to `iamalive`, `machine_status`, and `TimeInstant`
- Full Orion telemetry queries while Current State is visible, with the same response also updating shared connectivity and operational state
- Exact canonical matching by the IoT Agent `entity_name`, with `device_id` used only as a fallback and no inferred entity URNs
- Canonical inventory records updated before table rendering and 3D subscriber snapshots, preventing valid activity from being discarded with temporary merged objects
- Immediate refresh when opening Current State, Machines & Services, or 3D Digital Twin; when returning to a visible browser tab; and after machine provision, edit, or deletion
- Existing Current State filters and expanded rows preserved during refreshes
- Existing 3D machine selection, hover, camera position, layout, and edit state preserved during status-only updates
- Existing failure policy retained: two failed polls keep the last known state, while the third reports monitoring as unavailable without discarding the last operational state
- Unit coverage for query modes, four-second polling, canonical entity matching, Device ID fallback, and in-place machine updates

### Not Changed

- Connectivity thresholds: Online through 2 minutes, Stale through 10 minutes, Offline after 10 minutes, and Unknown without a valid heartbeat
- Operational-state code mappings or colors
- MQTT topics, payloads, simulator behavior, or custom IoT Agent implementation
- Orion, QuantumLeap, CrateDB, BFF, OAuth Authorization Code, Keyrock, PEP Proxy, or AuthzForce behavior
- Personal 3D layout persistence, factory visuals, machine model, or predictive-maintenance scope

This patch removes inconsistent `Unknown` values from inventory and 3D views by ensuring that every live portal surface reads the same activity record instead of updating disposable machine copies.

---

## Scope of v0.7.2

### Implemented

- Custom IoT Agent normalization for MQTT objects containing numeric `value` with optional `minimum` and `maximum`
- Base telemetry attribute emitted as `Number`, with generated `<attribute>_minimum` and `<attribute>_maximum` `Number` attributes when the corresponding limits exist
- Numeric strings converted to finite numbers without requiring any change to the real machine MQTT topics or payload format
- Last valid Orion value preserved when `value` is invalid, and last valid limits preserved when later payloads omit them or provide invalid values
- Unchanged limits suppressed after their first observation so static thresholds are not resent on every telemetry cycle
- Unsupported bounded-object fields ignored with rate-limited warnings, while unrelated objects and arrays remain single `StructuredValue` attributes
- Plain non-JSON MQTT payloads preserved as UTF-8 text
- Size-limited bounded-metric cache and warning limiter
- Bounded telemetry queue with per-machine ordering, coalescing by machine/attribute, global concurrency `10`, and at most `1000` pending unique pairs
- MQTT payload size limit of `256 KiB`, periodic queue statistics, and bounded graceful shutdown
- Portal discovery of generated limit attributes only after they exist in Orion
- Generated limits shown as read-only values in the machine attributes view, accepted by registered-attribute filters, and available in Historical Data queries without adding them to Add/Edit Machine forms
- Orion entity snapshots attached separately from IoT Agent registration records so existing machine editing and service-group behavior remains unchanged
- Custom-agent Dockerfile changed to build the reviewed local checkout and pin `iotagent-node-lib` to the Node 16-compatible commit `78ad1289f5b4b3c1b611cae07d295f091e04788b`
- Compose defaults for `restart: unless-stopped`, a `1 GB` container memory limit, a `768 MB` Node old-space limit, and the telemetry queue controls
- Intended image tag changed to `lemostiago/custom-iotagent:3.7.1-mtexns` in `.env.example`
- Custom-agent implementation notes added to `FIWARE-custom-agent/lib/README.md`
- Unit tests added for bounded telemetry normalization, queue behavior, and portal generated-limit discovery

### Not Changed

- Real-machine topic contract `<deviceId>/state/<attribute>` or machine-generated payloads
- Machine provisioning contract: bounded JSON telemetry remains provisioned as `StructuredValue`
- MQTT simulator mappings and payload generation established by v0.7.1
- Existing Add Machine and Edit Machine fields; generated limits are system-owned and read-only
- Orion, QuantumLeap, CrateDB, BFF, OAuth Authorization Code, Keyrock, PEP Proxy, or AuthzForce implementations
- Connectivity thresholds, 3D factory behavior, personal layout persistence, or predictive-maintenance logic

The custom-agent tests, image build, container recreation, FIWARE integration tests, and soak tests are intentionally deferred until the owner transfers these files to the complete custom-agent repository and publishes the new image. Portal-only JavaScript tests can be executed independently.

This patch retains the original machine interface while making bounded counters usable as numeric time series and keeping their maintenance limits available for later preventive and predictive analysis. The backpressure controls address the failure mode in which sustained MQTT work exhausted the Node.js heap.

---

## Scope of v0.7.1

### Implemented

- Automatic Telemetry Attributes and Static Attributes builders restricted to `Number`, `Text`, `Boolean`, `StructuredValue`, and `DateTime` in both Add Machine and Edit Machine
- Legacy `integer`, `float`, `number`, `string`, `text`, `boolean`, `structuredvalue`, and `datetime` aliases normalized to their canonical project types when records are handled through the automatic builders
- Manual JSON mode kept unrestricted so machine-specific or custom IoT Agent types remain available
- Automatic static values converted to real JSON values: finite numbers, booleans, objects or arrays, timezone-qualified ISO 8601 timestamps, and text
- Existing unsupported custom types preserved instead of being removed during an explicit automatic edit
- Portal-generated status placeholder codes and inferred Orion numeric values standardized on `Number` instead of `Integer`
- Structured static values rendered as compact JSON instead of `[object Object]` in machine attribute views
- Simulator `maximum/value` counters published as raw JSON objects containing numeric fields
- All 75 simulator maintenance-counter mappings changed from `Text` to `StructuredValue`, while `iamalive` remains `Text` and scalar telemetry remains `Number`
- Simulator documentation updated with the new payload contract and the known custom-IoT-Agent compatibility boundary
- Unit coverage for type aliases, static-value conversion, invalid values, timezone requirements, inference, and structured-value formatting

### Not Changed

- The custom IoT Agent implementation or its MQTT object-routing behavior
- Existing provisioned machines until a user explicitly saves an edit or provisions the machine again
- The real-machine `iamalive` format or its `Text` mapping
- OAuth Authorization Code flow, Keyrock, PEP Proxy, AuthzForce, Orion, QuantumLeap, CrateDB, or 3D layout persistence
- Predictive-maintenance forecasts, ML training, anomaly detection, or remaining useful life calculation

This patch aligns the portal's generated provisioning data with the NGSI type names used by Orion while keeping advanced manual mappings and existing records under explicit operator control.

---

## Scope of v0.7

### Implemented

- Connectivity calculated from the `iamalive` heartbeat instead of assuming that the last `machine_status` value is still current
- Four explicit connectivity states: **Online** through 2 minutes, **Stale / Communication delayed** after 2 and through 10 minutes, **Offline** after 10 minutes, and **Unknown** when no valid heartbeat exists
- Orion attribute receive metadata or entity `TimeInstant` used before the machine-supplied heartbeat timestamp, with `Europe/Lisbon` parsing for timestamps that do not include an offset
- Authenticated background monitoring every 30 seconds, independent of the active portal tab, with page-visibility recovery and in-flight request protection
- Monitoring failures kept separate from machine failures: three consecutive Orion failures change connectivity to unavailable instead of incorrectly marking machines Offline
- Canonical `iamalive` telemetry mapping required for newly provisioned machines, with both Object ID and Name set to `iamalive`
- Backward compatibility for existing machines without a valid heartbeat; they remain visible and display Unknown with guidance rather than being blocked or rewritten
- Separate **Connectivity** and **Operational state** presentation in Machines In Use, Current State, and the 3D machine inspector
- Last contact and last operational-state report timestamps shown independently
- 3D connectivity rings with Online, delayed, Offline, and unavailable colors
- Offline machines retained in the factory map with a gray pedestal and identity plate plus non-destructive per-instance GLB desaturation that restores automatically when connectivity returns
- Critical operational-state animation limited to Online machines so stale or offline equipment never continues to pulse as if actively processing
- Dedicated anonymous authentication gate with a sanitized WebP render of the procedural factory, MTEX NS styling, responsive desktop/mobile composition, and one **Continue to secure sign-in** action
- Existing Keyrock BFF-managed OAuth Authorization Code redirect kept unchanged at `/auth/login`; no portal-side username or password fields were added
- Entire authenticated shell hidden until `/auth/session` confirms the BFF session
- Restricted modules represented by an explicit lock and **Restricted** state while their inaccessible forms and tables remain hidden
- Silent table and map refreshes without per-machine notifications
- Unit coverage for thresholds, timestamp priority, monitoring failures, layout behavior, Asset ID behavior, and mandatory new-machine heartbeat mapping

### Not Implemented Yet

- Predictive-maintenance forecasts or telemetry inside the machine inspector
- ML model training
- Anomaly detection
- Remaining useful life prediction
- Prediction tables in CrateDB
- Writing prediction results back to Orion

This version prevents stale operational values from presenting a disconnected machine as active. It also keeps machine health, FIWARE infrastructure availability, and the last reported operating mode as distinct concepts so operators can understand what the portal actually knows.

---

## Scope of v0.6

### Implemented

- Direct first-click machine selection on the 3D map, while retaining the machine selector as an equivalent navigation path
- Camera focus that recenters the selected asset without replacing the operator's current orbit angle or zoom distance
- Stable per-machine visual identity derived from Asset ID, using a restrained deterministic color palette and an identifying pedestal while preserving the original GLB materials
- Compact always-visible Asset ID plates and expanded identity/status labels for selected or hovered machines
- Independent status visualization, including status rings, status dots, and reduced-motion-aware pulsing only for active processing states
- Procedural MTEX NS factory environment with a slab floor, grid, safety aisle, perimeter walls and fencing, loading gate, cabinets, pallets, barriers, pipework, and signage
- Edit-layout grid visibility only while editing, with mouse/touch drag thresholds, invalid-drop rollback, collision prevention, and explicit save/cancel behavior
- Version 2 personal layout metadata with persisted factory bounds and modular two-cell expansion that never shrinks an existing factory
- Required Asset ID in Add Machine and Edit Machine, stored canonically as the static `assetId` attribute
- Asset ID validation, case-insensitive uniqueness checks, contextual help, examples, inline errors, and explicit confirmation before changing an existing identity
- Backward-compatible reading of `assetId`, `asset_id`, `assetID`, and legacy `model` values without silently rewriting existing machine records
- Missing-Asset-ID warnings and Device ID fallback plates for legacy machines
- Responsive desktop/mobile framing and reduced-motion behavior for camera transitions and status animation

### Not Implemented Yet

- Predictive-maintenance forecasts or telemetry inside the machine inspector
- ML model training
- Anomaly detection
- Remaining useful life prediction
- Prediction tables in CrateDB
- Writing prediction results back to Orion

This version makes the factory map a reliable operational navigation surface: identity is visible and stable, status remains semantically separate, and the surrounding factory gives spatial context without introducing additional 3D asset dependencies.

---

## Scope of v0.5

### Implemented

- Interactive Three.js factory map containing all portal-registered machines
- Reuse of the existing static GLB model for every machine instance
- Automatic placement in the first free grid cell and automatic grid expansion
- Visible `Machine Name (Device ID)` labels, with Device ID fallback when no machine name exists
- Current operational status displayed directly on the map through textual labels and status-colored rings
- Machine selection with the existing rotatable and zoomable 3D viewer in a lateral inspector
- Inspector sections for machine identity, current status, and `Sem previsão disponível`
- Personal **Edit layout** mode with grid-snapped movement, unrestricted Y-axis rotation, collision prevention, **Save**, and **Cancel**
- Per-user account persistence through `portal-bff`, including revision conflict detection and cross-device synchronization
- Layout coordinates and rotation stored only in portal metadata, outside Orion, IoT Agent, and FIWARE entities
- Automatic layout cleanup after machine deprovisioning
- Empty-map action that opens **Machines & Services** for machine provisioning
- Responsive desktop and mobile presentation aligned with the MTEX NS operational visual system

### Not Implemented Yet

- Predictive-maintenance forecasts or telemetry inside the machine inspector
- ML model training
- Anomaly detection
- Remaining useful life prediction
- Prediction tables in CrateDB
- Writing prediction results back to Orion

This version turns the previous single-machine 3D view into a personal factory-level digital-twin workspace while preserving the existing FIWARE machine model and security architecture.

---

## Scope of v0.4

### Implemented

- MTEX NS-branded portal shell using the company red, charcoal, gray, and neutral palette in a restrained operational style
- Improved typography using separate display and interface font families for headings, navigation, labels, and dense operational text
- Post-login **Access profile** visibility for signed-in user, effective role/access, FIWARE service/subservice, allowed modules, blocked modules, and the capability check behind each tab
- Collapsible left sidebar navigation grouped into **Operations**, **Telemetry**, and **Administration**
- Icon-only collapsed sidebar mode for wider working space
- User identity and logout controls moved to the bottom of the sidebar
- Machine registration split into an inline stepper:
  - service group
  - machine identity
  - telemetry mapping
  - generated IoT Agent / NGSI payload preview
  - register
- Generated registration preview showing the target IoT Agent request and JSON body before submission
- Role color tags with an explicit color-selection workflow, custom hex input, preview, and colored assignment badges
- Recovery-oriented error and denied states using cause + check + next action messaging for Keyrock, PEP/AuthzForce, IoT Agent, Orion, and QuantumLeap paths
- Inline denied-state placeholders instead of disruptive browser alerts
- Quieter operational visual system:
  - flatter panels
  - reduced shadows
  - no hover-lift on static cards
  - restrained icon badges
  - non-gradient mode toggles
  - denser tables and toolbars

### Not Implemented Yet

- ML model training
- Anomaly detection
- Remaining useful life prediction
- Prediction tables in CrateDB
- Writing prediction results back to Orion
- Dashboards for predictive maintenance

This version focuses on portal operability. The system now organizes operator workflows more clearly, exposes recovery context where access or telemetry calls fail, and improves visual fit for MTEX NS while keeping predictive-maintenance modeling as future work.

---

## Scope of v0.3

### Implemented

- Reliable MQTT-to-IoT-Agent-to-Orion updates after portal machine registration
- Safe `portalTelemetryAttributes` storage using `b64url:` encoded metadata
- Portal metadata decoding for encoded telemetry allowlists
- Canonical NGSI-LD-style entity IDs using `urn:ngsi-ld:<entity_type>:<unique_id>`
- Portal registration and edits enforce URN entity names even when MQTT created a non-URN auto-provisioned record first
- IoT Agent healthcheck fix for images that do not include `curl`

### Not Implemented Yet

- ML model training
- Anomaly detection
- Remaining useful life prediction
- Prediction tables in CrateDB
- Writing prediction results back to Orion
- Dashboards for predictive maintenance

This version focuses on ingestion correctness. Historical data and future ML work depend on Orion receiving each telemetry update successfully and QuantumLeap writing those updates against the same stable entity IDs.

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

## New in v0.7.3

### ✅ Synchronized live machine activity

What changed:

- Current State, Machines In Use, and the 3D Digital Twin now consume the same connectivity and operational-state store.
- Activity is refreshed every four seconds, with full telemetry requested only while Current State is visible.
- Machine activity is resolved using the exact `entity_name` returned by the IoT Agent before falling back to `device_id`.
- Inventory and 3D snapshots are updated from canonical machine records, while filters, expanded rows, machine selection, hover, camera, and layout remain stable.
- Relevant tabs, browser visibility recovery, and successful machine mutations trigger an immediate refresh.

Why this was done:

- Current State already displayed valid Orion activity, but Machines In Use and the 3D Digital Twin continued to show `Unknown` because updates were applied to temporary merged machine objects.
- Independent polling intervals allowed portal views to display different states for the same machine.
- A shared activity source ensures that connectivity age, monitoring failures, and the last operational state have one consistent interpretation throughout the portal.

---

## New in v0.7.2

### ✅ Numeric bounded telemetry with retained limits

What changed:

- A `StructuredValue` payload containing `value` and at least one of `minimum` or `maximum` is now normalized inside the custom IoT Agent.
- The original attribute name receives the numeric operational value, while `_minimum` and `_maximum` attributes retain the available numeric limits.
- Numeric strings are converted to real numbers; invalid values are rejected without overwriting the last valid Orion state.
- Known limits are sent only on first observation or change, and missing or invalid later limits preserve the previous valid values.
- JSON objects and arrays that do not follow this bounded-metric shape remain one `StructuredValue`.

Why this was done:

- The real machine MQTT contract cannot be changed and exposes maintenance counters as JSON objects.
- Operational values need to be numeric time series for portal and historical analysis, while static limits are needed later for preventive and predictive maintenance.
- Normalizing at the ingestion boundary keeps machine firmware, simulator payloads, provisioning forms, Orion consumers, and future analytics decoupled.

---

### ✅ MQTT backpressure and bounded memory behavior

What changed:

- Pending telemetry is coalesced by machine and attribute so only the newest waiting sample for that pair is retained.
- Updates remain ordered per machine while up to 10 different machines can progress globally.
- The queue, bounded-metric cache, warning limiter, and accepted MQTT payload size all have explicit limits.
- Repeated malformed-data and drop warnings are rate-limited without logging payload contents.
- Queue counters are logged periodically and shutdown has a finite drain interval.
- Compose reserves 1 GB for the container and limits the Node old-space heap to 768 MB, with automatic restart unless explicitly stopped.

Why this was done:

- The previous direct message-to-update path allowed incoming work and object expansion to outpace Context Broker updates.
- Increasing the heap alone would delay another out-of-memory failure without controlling the number of pending operations.
- Coalescing is appropriate for live portal state because the latest pending sample is more useful than an unbounded backlog of obsolete intermediate values.

---

### ✅ Read-only limits in the secured portal

What changed:

- The portal discovers generated `_minimum` and `_maximum` attributes only when Orion actually exposes them.
- Generated limits are displayed with their source, type, and current value in a dedicated read-only section.
- The same attributes are accepted by registered-machine filters and offered in Historical Data.
- Orion snapshots enrich IoT Agent inventory records through a separate `orionRaw` field instead of replacing registration data.
- Add Machine and Edit Machine remain unchanged; operators never provision or edit generated limits manually.

Why this was done:

- Operators need visibility into the retained limits without confusing them with machine-provisioning inputs.
- Checking the real Orion entity avoids inventing limit attributes for unrelated generic `StructuredValue` telemetry.
- Keeping Orion state separate from IoT Agent registration preserves existing service-group and edit behavior.

---

## New in v0.7.1

### ✅ Canonical attribute types and typed static values

What changed:

- Add Machine and Edit Machine now expose the same five automatic type choices: `Number`, `Text`, `Boolean`, `StructuredValue`, and `DateTime`.
- Integer and decimal values share the `Number` type, matching the project's NGSIv2 model.
- Known legacy aliases are normalized when an existing record is loaded into an automatic builder.
- The manual JSON editors remain unrestricted and continue to preserve custom types when saved in manual mode.
- Automatic static attributes are validated and converted before they enter the provisioning payload.
- `StructuredValue` requires a JSON object or array, and `DateTime` requires ISO 8601 with `Z` or an explicit timezone offset.
- Portal-generated and inferred numeric metadata now uses `Number`; structured values are displayed as JSON in attribute lists.

Why this was done:

- Presenting `integer`, `float`, and `string` beside NGSI names mixed programming-language terminology with Orion attribute types.
- A type label is not sufficient if the associated value is still serialized as text.
- Keeping manual mode open preserves compatibility with machine-specific mappings without weakening the predictable automatic workflow.

---

### ✅ Structured MQTT maintenance counters

What changed:

- The MQTT simulator now publishes every `maximum/value` counter directly as `{"maximum":250,"value":10}`.
- `maximum` and `value` are JSON numbers instead of quoted strings.
- The simulator provisioning map assigns `StructuredValue` to all 75 counter attributes.
- `iamalive` remains a `Text` value in the real-machine-compatible `YYYY-MM-DD HH:mm:ss` format.
- No IoT Agent source or container configuration was changed.
- Existing devices are not migrated silently; the new mapping takes effect only after explicit provisioning or saving.

Why this was done:

- Maintenance counters are structured data and should remain queryable as structured data rather than encoded JSON text.
- Numeric nested fields avoid repeated string parsing in portal, historical-data, and future maintenance logic.
- Leaving the IoT Agent unchanged makes any object-routing incompatibility visible at the correct integration boundary instead of hiding it in the simulator.

---

## New in v0.7

### ✅ Heartbeat-based connectivity

What changed:

- `iamalive` is now the authoritative machine heartbeat used to derive connectivity.
- A heartbeat age of 0 to 2 minutes is Online, over 2 through 10 minutes is Communication delayed, and over 10 minutes is Offline.
- Missing or invalid `iamalive` values produce Unknown instead of inferring connectivity from unrelated attributes.
- When present, the receive timestamp in `iamalive` metadata or the entity `TimeInstant` takes priority over the timestamp supplied by the machine.
- Machine timestamps without an explicit UTC offset are interpreted in the configurable factory time zone, which defaults to `Europe/Lisbon`.
- Connectivity is recalculated from the current clock whenever views render, so a machine transitions to delayed or Offline even when Orion continues to hold its last entity value.

Why this was done:

- Orion correctly persists the last value but persistence alone does not prove that a machine is still communicating.
- A previous `machine_status` such as Printing must remain visible as the last reported operating mode without being presented as live connectivity.
- Explicit thresholds make stale-data behavior deterministic and testable.

---

### ✅ Central authenticated monitoring

What changed:

- The portal polls only `iamalive`, `machine_status`, and `TimeInstant` every 30 seconds after the BFF session is confirmed.
- The monitor runs independently of the active authenticated tab and refreshes when a hidden page becomes visible again.
- Concurrent polls are prevented and in-flight requests are aborted when the session ends.
- One or two failed polls retain the previous machine state silently; after three consecutive failures the monitor reports Monitoring unavailable.
- A successful poll resets the failure counter and restores normal connectivity calculation.
- A single global notice appears only when connectivity monitoring itself is unavailable.

Why this was done:

- Polling per view would duplicate requests and allow different tabs to disagree about the same machine.
- Orion or network failure is an infrastructure condition, not evidence that every machine became Offline.
- Silent updates preserve an operational interface without repetitive per-machine notifications.

---

### ✅ Mandatory heartbeat for new machines with legacy compatibility

What changed:

- Add Machine now requires an IoT Agent telemetry mapping whose `object_id` and `name` are both exactly `iamalive`, case-insensitively.
- The Telemetry mapping step includes the canonical JSON example `{"object_id":"iamalive","name":"iamalive","type":"Text"}`.
- Payload preview and registration remain blocked until this mapping is present.
- Editing an existing machine does not retroactively enforce the rule.
- Existing machines without a valid heartbeat remain registered and visible with Unknown and a clear missing-heartbeat indication.

Why this was done:

- New registrations need one predictable contract for connectivity monitoring.
- Retroactively rejecting legacy machines would remove operational visibility and force an unsafe bulk migration.
- The mapping stays in IoT Agent provisioning; no portal layout metadata is written to Orion or FIWARE.

---

### ✅ Connectivity in tables and the 3D factory

What changed:

- Machines In Use now has separate Connectivity and Operational state columns.
- Current State device rows show connectivity, the last operational-state badge, and heartbeat age together without merging their meanings.
- The 3D inspector shows connectivity, last contact, operational state, and the timestamp of the last operational report as separate rows.
- Map rings use connectivity colors; delayed machines use amber and unavailable machines use neutral gray.
- Offline machines remain selectable and keep their saved placement.
- Offline pedestals and identity plates become gray and each offline GLB instance is desaturated through cloned materials; reconnecting restores the original material colors.
- Operational critical-state pulsing runs only while the same machine is Online.

Why this was done:

- Operators need to distinguish “the last state was Printing” from “the machine is communicating now.”
- Keeping disconnected machines in place preserves spatial and asset context.
- Per-instance material cloning avoids mutating the shared GLB template or changing the appearance of other machines.

---

### ✅ Focused authentication and restricted-access states

What changed:

- The anonymous first screen is now a dedicated authentication gate rather than an inactive portal form.
- A sanitized static WebP captured from the same procedural factory environment carries the digital-twin context without using account or machine data.
- The gate contains one action, **Continue to secure sign-in**, which keeps the existing `/auth/login` redirect and BFF-managed Keyrock Authorization Code flow.
- Unused portal email/password inputs and the previous Security Information panel were removed.
- The portal sidebar, headers, forms, tables, and 3D workspace remain hidden until `/auth/session` confirms authentication.
- Modules denied by capability checks keep their sidebar entry but show a lock, a Restricted label, the required capability, and the recovery action.
- Restricted module content is not rendered visibly behind a gray disabled treatment.

Why this was done:

- The previous inputs implied that credentials were processed by the portal even though authentication already occurred in Keyrock.
- One explicit redirect action makes the security boundary accurate and easier to understand.
- Clear restricted states explain authorization without exposing unusable forms or making the whole interface appear broken.

The predictive-maintenance panel remains intentionally unchanged and displays `Sem previsão disponível` until real prediction data is integrated.

---

## New in v0.6

### ✅ Direct selection and camera continuity

What changed:

- A machine can be selected with the first click or tap on its 3D model, pedestal, or status ring.
- The existing machine selector remains available and follows the same selection path.
- Pointer-down captures the target Device ID so a later camera or pointer movement does not require a second raycast to identify the machine.
- Dragging uses separate mouse and touch thresholds, while an ordinary click remains a selection action.
- Selecting a machine opens the inspector and recenters the map camera while preserving the current viewing angle and zoom distance.
- Empty-floor clicks do not change the selection.

Why this was done:

- The map itself is the primary navigation surface and should not require a preparatory dropdown action.
- Preserving the operator's camera context avoids disorientation when moving between nearby machines.
- A shared selection path keeps the map, selector, labels, and inspector synchronized.

---

### ✅ Individual machine identity and Asset ID

What changed:

- **Model / Asset ID** was replaced by the required **Asset ID** field in Add Machine and Edit Machine.
- New machines store the value as the canonical static attribute `assetId`.
- Asset IDs are trimmed, must contain 2 to 20 ASCII letters, digits, hyphens, or underscores, and must be unique among visible machines without regard to letter case.
- Valid examples include `CNC_04`, `LINE3-PRESS`, and `HP-2000`.
- The information control beside the field explains the rules, examples, and distinction between Machine Name, Asset ID, and Device ID.
- Validation is shown inline and prevents registration or saving until corrected.
- Changing an existing Asset ID requires explicit confirmation because the value is presented as the machine's physical identity.
- Existing records can still be read from `assetId`, `asset_id`, `assetID`, or legacy `model`; legacy aliases are preserved when editing unrelated machine data.
- Machines without a canonical Asset ID display a warning and use Device ID on the map plate until an Asset ID is assigned.

Why this was done:

- Machine Name is a human-readable label and Device ID is the IoT provisioning identity; neither is a dependable short identifier for a physical asset plate.
- A canonical, validated Asset ID gives the portal one stable source for visual identity without changing FIWARE entity IDs.
- Compatibility prevents the v0.6 UI from breaking or silently mutating machines provisioned by earlier versions.

---

### ✅ Deterministic visual identity and status

What changed:

- Every machine receives a deterministic color derived from its Asset ID, with Device ID as the compatibility fallback.
- Color is applied to a compact octagonal pedestal rather than recoloring the existing GLB model.
- The same identity always produces the same color across sessions and devices.
- Asset ID plates remain visible on the map; hover and selection add Machine Name, Asset ID, Device ID, and current status.
- Operational state remains independent from identity color through a status ring and status dot.
- Only active processing status codes pulse, and animation is disabled when the browser requests reduced motion.

Why this was done:

- Operators need to distinguish machines even while one shared 3D model is reused.
- Keeping identity color on the pedestal preserves the source model and prevents color from being confused with machine health.
- Text labels remain authoritative, so color is an aid rather than the only identity or status signal.

---

### ✅ Procedural MTEX NS factory environment

What changed:

- The plain grid is now a light industrial factory floor with an inset slab, subtle grid, safety aisle, walls, fences, a loading gate, cabinets, pallets, barriers, pipework, and restrained signage.
- The environment is generated from reusable Three.js primitives and instanced meshes, without adding new GLB or image dependencies.
- Visual weight stays around the perimeter so machines and interaction space remain unobstructed.
- MTEX NS red is reserved for selection and safety accents, supported by charcoal, neutral gray, white, muted metal, and limited identity colors.
- The editing grid appears only in Edit layout mode.
- Reset view calculates a fit from the persisted factory rectangle and adapts it to desktop and mobile aspect ratios.

Why this was done:

- The factory needs enough physical context to read as an operational site rather than an empty 3D editor.
- Procedural geometry keeps the scene maintainable, lightweight, and consistent as each user's factory expands.
- Restrained decoration supports the existing portal design instead of competing with labels, machine status, or editing controls.

---

### ✅ Layout metadata version 2

What changed:

- Personal layout documents now persist explicit factory bounds alongside machine placements.
- Existing v1 layouts are migrated in memory to v2-compatible bounds.
- New factories start with a usable 7 by 7 grid and expand in two-cell modules on the required side.
- Factory bounds never shrink automatically, including after machines are removed.
- Invalid moves revert to the machine's original placement and occupied cells remain unavailable.

Why this was done:

- Persisted bounds keep the procedural environment and camera framing stable between sessions and devices.
- Modular non-shrinking growth avoids noticeable factory reshaping as machines are provisioned or rearranged.
- The metadata remains a portal concern and is not written to Orion or IoT Agent.

The predictive-maintenance panel remains intentionally unchanged and displays `Sem previsão disponível` until real prediction data is integrated.

---

## New in v0.5

### ✅ Personal 3D factory layout

The **3D Digital Twin** tab now presents all portal-registered machines on an interactive factory grid.

What changed:

- Every registered machine uses the existing static GLB model and is placed automatically in the first free grid cell.
- Machine labels use `Machine Name (Device ID)` and fall back to the Device ID when no machine name was supplied.
- Operators can orbit, pan, zoom, reset the camera, select a machine, and inspect the existing rotatable/zoomable machine viewer in a lateral panel.
- The inspector exposes identity, current status, and the placeholder `Sem previsão disponível` because predictive-maintenance data is not generated in this version.
- **Edit layout** enables grid-snapped movement and unrestricted Y-axis rotation with explicit **Save** and **Cancel** actions.
- Occupied cells cannot be reused, and the grid expands automatically as machines are added.
- Layouts are private to the signed-in Keyrock user and follow that account across devices.
- Layout coordinates and rotation are stored by `portal-bff` in its own persistent volume. They are never written to Orion, IoT Agent, or other FIWARE entities.
- Concurrent saves use layout revisions so one browser session cannot silently overwrite a newer layout.
- Deprovisioning a machine removes its placement from all saved layouts. Reprovisioning it assigns the first free cell again.
- An empty layout links directly to **Machines & Services** so an operator can provision the first machine.
- The workspace adapts to desktop and mobile while retaining the restrained MTEX NS red, charcoal, gray, and neutral visual language.

Why this was done:

- Operators need factory-level spatial context instead of opening an isolated machine model without seeing the other provisioned assets.
- Reusing the existing machine viewer preserves detailed rotation and zoom behavior while the map handles navigation and selection across the factory.
- Personal layouts let each user organize the same registered machines around their own workflow without imposing one shared arrangement on every account.
- Keeping layout metadata in the portal avoids mixing presentation concerns with Orion machine state or IoT Agent provisioning data.
- Automatic placement, collision prevention, and the provisioning action keep the workflow usable from an empty factory through later machine additions.
- The identity/status inspector creates a stable operational surface without presenting predictive information before real prediction data exists.

The 3D scene shows current operational status, but no prediction or predictive telemetry is generated in this version.

---

## New in v0.4

### ✅ Access profile and permission visibility

After sign-in, the portal exposes the user's access context as part of the secured operating surface.

It covers:

- signed-in user
- effective role/access label
- FIWARE service
- FIWARE service path
- allowed modules
- blocked modules
- live capability checks behind each tab

Why this was done:

- Admin and Viewer users need to distinguish role restrictions from service-group issues, PEP/PDP policy failures, missing backend sessions, and unavailable service capability.
- The portal should explain the current access envelope before a user hits a denied tab or failed query.
- Security state should be visible in the UI instead of being hidden behind generic "no access" messages.

Complementary v0.4 refinements:

- Denied tabs now keep capability context at the point of failure.
- Recovery messages now describe the likely cause, checked endpoint, and next action.
- The sidebar user block keeps the signed-in identity and logout action available without crowding the main workflow area.

---

### ✅ Collapsible workflow sidebar

Authenticated navigation now lives in a left sidebar instead of a wide row of peer tabs.

What changed:

- The sidebar expands to show group labels and tab names.
- The sidebar collapses to an icon-only rail when the operator needs more workspace.
- User identity and logout controls live at the bottom of the sidebar.
- Navigation is grouped into **Operations**, **Telemetry**, and **Administration**.
- Access and denied-state context remains available where it affects the user, especially in denied tabs and recovery messages.

Why this was done:

- Operators need a stable app shell that keeps machine workflows visible without taking over the page.
- Admin and Viewer users still need clear access feedback, while the main navigation should remain compact enough for repeated operator workflows.

---

### ✅ Workflow-based navigation

The authenticated portal navigation is now grouped by operator task family instead of implementation module.

Navigation groups:

| Group | Tabs |
|------|------|
| Operations | Machines & Services, Current State, Historical Data |
| Telemetry | 3D Digital Twin |
| Administration | User Management, Roles & Permissions, Audit Logs, Security Settings |

What changed:

- These groups are presented inside the collapsible sidebar.
- **Machines & Services**, **Current State**, and **Historical Data** now sit together because they form the main operational telemetry workflow.
- The previous **Orion Logs** user-facing label was clarified as **Current State** while still using Orion as the data source.
- Administration tasks are separated from operator telemetry tasks.

Why this was done:

- Operators should not need to infer workflow order from backend implementation names.
- Machine registration, live state, and historical telemetry are adjacent because users naturally move between them.

---

### ✅ MTEX NS visual system and typography

The portal now uses a subtler MTEX NS visual direction instead of a generic SaaS dashboard look.

What changed:

- Brand text was updated to **MTEX NS Digital Twin Portal**.
- The interface uses MTEX NS red as a restrained accent for selected navigation, primary actions, links, and chart emphasis.
- Charcoal, gray, white, and neutral surfaces form the operational base palette.
- Headings and brand/navigation moments use a display font, while tables, forms, and controls use a denser interface font.
- Decorative gradients and broad accent blocks were reduced.

Why this was done:

- The portal should feel connected to MTEX NS without turning every panel red.
- Dense telemetry and security screens need typography that separates headings, labels, data, and actions clearly.

---

### ✅ Role color tags

Roles can now carry explicit color tags that are reused across role management and user assignments.

What changed:

- Creating a role requires selecting a color tag.
- The role form opens a **Select color tag** palette with smaller swatches, custom hex input, and live preview.
- If no color is selected, the form warns the Admin before creating the role.
- The role table shows the role ID, colored role tag, and delete action only.
- Assignment badges in **Assign Roles To Users / Delete Users** use the colors configured in role management.

Why this was done:

- Role identity is easier to scan when assignments carry the same color language as the role-management table.
- The color workflow is explicit, so roles are not created with accidental or invisible tag colors.

---

### ✅ Guided machine registration stepper

The **Add Machine** form is now split into a guided inline stepper.

Stepper flow:

1. Service group
2. Machine identity
3. Telemetry mapping
4. Review payload
5. Register

What changed:

- Service group selection is separated from machine identity fields.
- Telemetry and static attribute mapping are separated from identity and service setup.
- The portal generates an IoT Agent / NGSI request preview before submission.
- The preview shows whether the portal will create or update the IoT Agent device and displays the JSON request body.
- Form validation can now support preview updates without interrupting the user with premature errors.

Why this was done:

- Registration previously mixed service group, Context Broker URL, IoT Agent device ID, registration mode, telemetry attributes, static attributes, status, and notes in one broad surface.
- The new flow lets an Admin verify the generated IoT payload before it changes IoT Agent state.

---

### ✅ Recovery-oriented errors and denied states

Portal errors now use a shared message pattern:

```text
<System> could not <action> (HTTP <status>). Check: <endpoint>. Detail: <backend detail>. Next: <recovery action>.
```

Examples:

```text
PEP/Orion could not load current machine state (HTTP 403). Check: GET /bff/fiware/v2/entities?type=Machine&options=keyValues. Next: PEP/AuthzForce denied this request. Ask an admin to assign the required role or permission.
```

```text
IoT Agent could not register the machine. Check: POST /iot/devices. Next: The portal could not reach the backend. Verify the stack is running and your session is still valid, then try again.
```

What changed:

- Generic messages such as "network error" and "no access" were replaced on the main portal paths.
- Keyrock user/role management, IoT Agent service/device requests, Orion current-state reads, QuantumLeap historical reads, and authentication errors now return cause + check + next action copy.
- Denied tabs now use persistent inline placeholders instead of disruptive browser alerts.

Why this was done:

- Security and telemetry failures are predictable in this stack.
- Users need to know whether to sign in again, switch service group, ask for a role/permission, check PEP/PDP policy, or inspect a backend container.

---

### ✅ Quieter operations-console visual system

The portal visual system was reduced to feel more like an engineering console and less like a decorative SaaS dashboard.

What changed:

- Static cards no longer lift on hover.
- Operational panels are flatter and use borders instead of broad soft shadows.
- Shadows are reserved mainly for overlays and dropdowns.
- Repeated decorative icon badges were toned down.
- Registration mode toggles no longer use gradients.
- Tables use denser spacing and smaller type for scanning.
- Accent color is reserved for selected navigation, primary actions, links, chart emphasis, and meaningful state.
- Reduced-motion support was added for non-essential transitions.

Why this was done:

- The interface should feel precise, calm, and trustworthy under security and telemetry failure.
- Visual energy now follows task importance instead of decorating every panel equally.

---

## New in v0.3

### ✅ Machine telemetry registration reliability fix

This maintenance release fixes a blocking telemetry issue found after registering machines through the portal.

Previously, registered machines appeared correctly in the portal and historical data could show older samples, but new MQTT values could stop reaching Orion. The IoT Agent was receiving MQTT measurements, then Orion rejected each upsert with:

```text
400 BadRequest: Invalid characters in attribute value
```

The rejected value was the `portalTelemetryAttributes` static attribute. In v0.2.1, the portal stored the selected telemetry allowlist as raw JSON text inside an Orion/IoT Agent `Text` attribute. That raw JSON contains quote characters, which Orion rejects in this path.

What changed:

- `portalTelemetryAttributes` is now stored as safe `b64url:` encoded JSON text.
- The portal can still read older raw JSON metadata for backward compatibility.
- New and edited machines write encoded metadata automatically.
- The fix is implemented in the registration/edit code path, so the IoT Agent sends Orion-safe metadata by default.

Example stored value:

```text
portalTelemetryAttributes=b64url:W3sibmFtZSI6...
```

Why this was done:

- Keep the Viewer/Admin telemetry allowlist introduced in v0.2.1.
- Avoid Orion `Invalid characters in attribute value` errors.
- Preserve the registration metadata without exposing arbitrary telemetry attributes.
- Keep MQTT ingestion, Orion current state, and QuantumLeap history working together.

---

### ✅ Canonical URN-style `Machine` entity IDs

The portal now treats the Orion entity ID as a technical identifier, separate from the human machine name shown in the UI.

The canonical entity ID format is:

```text
urn:ngsi-ld:<entity_type>:<unique_id>
```

For machines this means:

```text
urn:ngsi-ld:Machine:00-00-1B-C4-58-GB
```

The machine name entered in the web portal is stored only as friendly metadata, for example:

```text
friendlyName=Machine B
```

It does not decide or replace the Orion entity ID.

What changed:

- New machine registration always builds `entity_name` as `urn:ngsi-ld:<entity_type>:<sanitized_device_id>`.
- Editing an existing machine rewrites the IoT Agent device to the same canonical URN format.
- If MQTT traffic auto-provisioned an incorrect non-URN entity such as `Machine:<device_id>`, portal registration corrects the IoT Agent record to the URN format.
- Duplicate IoT Agent records for the same device are merged for portal display, preferring portal-registered URN records.

Why this was done:

- Align entity IDs with the project convention: `scheme:prefix:entity type:Unique ID`.
- Keep the display name and the technical entity identifier separate.
- Avoid duplicate machine rows caused by one physical device having multiple entity IDs.
- Keep Orion and QuantumLeap using the same canonical entity ID for new telemetry after registration.

---

### ✅ IoT Agent healthcheck fix

The `fiware-custom-agent` container could appear unhealthy even when the IoT Agent API was running. The configured healthcheck used `curl`, but the custom IoT Agent image does not include `curl`.

What changed:

- The healthcheck now uses Node's built-in HTTP client against:

```text
http://127.0.0.1:4041/iot/about
```

Why this was done:

- Make Docker health reflect the actual IoT Agent service state.
- Avoid confusing a missing utility inside the image with a broken telemetry service.

---

### ✅ Code-level registry consistency fix

Version 0.3 fixes registry consistency directly in the application code.

What changed:

- Registration builds canonical URN entity names before sending `POST /iot/devices` or `PUT /iot/devices/{device_id}`.
- Edits reuse the same canonical URN builder.
- Duplicate IoT Agent records are collapsed in the portal by device/service identity, with portal-registered URN records preferred for display.
- `portalTelemetryAttributes` is encoded before it reaches the IoT Agent, so new records are created correctly from the start.

This makes the fix part of normal machine registration and editing behavior.

---

## New in v0.2.1

### ✅ Viewer Orion Logs and Historical Data filtering fix

This maintenance update tightens the Viewer read path for **Orion Logs** and **Historical Data**.

Previously, Viewer sessions could fall back to raw Orion `Machine` entities when they could not read IoT Agent inventory. That made the tabs accessible, but it could expose:

- auto-provisioned Orion entities that were communicating but had not been registered by Admin
- all Orion telemetry attributes for a registered machine instead of only the topics selected by Admin

What changed:

- Viewer fallback machine discovery now accepts only machines with portal registration metadata or cached Admin inventory metadata.
- Auto-provisioned Orion-only entities are not treated as registered machines.
- Registered machine topic visibility is restricted to the Admin-selected telemetry attributes.
- New and edited machines store the allowed telemetry list in the static attribute:

```text
portalTelemetryAttributes
```

- Admin inventory loading also refreshes a browser-local metadata cache so an Admin logout followed by a Viewer login in the same browser preserves the correct allowlist.
- Keyrock/AuthzForce permissions were not changed; Viewer still uses the same Lisbon working-hours ABAC rules for Orion and QuantumLeap reads.

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

Personal 3D layout flow:

```text
Browser 3D Digital Twin
  |
  | authenticated GET/PUT
  v
portal-bff
  |
  v
portal-bff-data volume
```

The Keyrock user ID is hashed before it becomes a storage key. Layout writes use revisions to detect concurrent edits from another browser session. Layout data remains separate from FIWARE machine state.

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
- verifies that existing CrateDB types still match the Orion/NGSI contract
- exits and restarts on a type mismatch by default instead of silently accepting an incompatible column
- runs every `${HISTORICAL_SCHEMA_SYNC_INTERVAL_SECONDS}` seconds

The service runs with Node.js from the existing IoT Agent image and does not download tools during container startup.
This keeps the table compatible with newly registered machine telemetry attributes without exposing CrateDB. Set
`HISTORICAL_SCHEMA_TYPE_MISMATCH_POLICY=warn` only for a temporary investigation; production should keep the default
`fail` policy.

### Bounded maintenance counter migration

Maintenance counters whose MQTT payload contains `{ value, minimum, maximum }` have a numeric NGSI contract:

- the base attribute is `Number`
- generated `_minimum` and `_maximum` attributes are `Number`
- the corresponding CrateDB columns are `REAL`

The `maintenance` Compose profile provides two idempotent one-shot migrations. Both run as dry-runs by default:

```powershell
cd DT_V3.0/docker_compose
docker compose --profile maintenance run --rm --no-deps bounded-telemetry-registry-migration
docker compose --profile maintenance run --rm --no-deps bounded-history-migration
```

For an existing stack, use a short write pause and apply them in this order:

```powershell
docker compose stop quantumleap historical-schema-sync
docker compose --profile maintenance run --rm --no-deps -e MIGRATION_APPLY=true bounded-telemetry-registry-migration
docker compose restart iot-agent

# Wait for fresh telemetry. The next command refuses to run until Orion exposes Number.
docker compose --profile maintenance run --rm --no-deps -e MIGRATION_APPLY=true bounded-history-migration

docker compose -f docker-compose.yml -f docker-compose.diagnostics.yml up -d --no-deps quantumleap historical-schema-sync
```

The registry migration copies each original device document once to
`devices_backup_bounded_number_v1`. The historical migration does not drop the old data: each incompatible column is
renamed with `__legacy_bounded_number_v1`, a new `REAL` column receives the original name, and dependent views are
rebuilt. `MIGRATION_ID` and the backup collection can be changed through the variables documented in `.env.example`.

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
| `docker_compose/docker-compose.yml` | Adds `crate-db`, `quantumleap`, historical bootstrap services, the Node-based IoT Agent healthcheck, and the persistent `portal-bff-data` layout volume |
| `docker_compose/bff/layout-store.js` | Validates and atomically persists revisioned per-user 3D layouts outside FIWARE |
| `docker_compose/bff/layout-store.test.js` | Covers layout normalization, user isolation, conflicts, and deprovision cleanup |
| `docker_compose/.env.example` | Adds image/config variables for CrateDB, QuantumLeap, and schema sync |
| `docker_compose/bootstrap/historical-subscription.sh` | Creates/updates the Orion subscription for QuantumLeap |
| `docker_compose/bootstrap/historical-schema-sync.js` | Adds missing CrateDB columns and rejects incompatible existing column types without runtime package downloads |
| `docker_compose/gateway/default.conf` | Adds `/quantumleap/` internal proxy route |
| `docker_compose/bootstrap/keyrock-bootstrap.sh` | Adds historical data permissions |

### Portal

| File | Purpose |
|------|---------|
| `web/digital-twin-portal/index.html` | Adds Historical Data and multi-machine 3D Digital Twin workspaces; adds Access profile visibility, the MTEX NS sidebar shell, workflow-grouped navigation, guided machine registration stepper, IoT/NGSI payload preview, role color picker UI, and the accessible 3D map legend |
| `web/digital-twin-portal/js/digital-twin.js` | Coordinates personal layout loading, inventory updates, selection, edit/save/cancel state, machine inspector, and map-legend lifecycle |
| `web/digital-twin-portal/js/digital-twin-scene.js` | Renders the Three.js factory grid, static machine instances, operational rings, connectivity markers, hover details, camera controls, dragging, and rotation |
| `web/digital-twin-portal/js/digital-twin-visual-state.js` | Resolves separate connectivity and operational map channels, ring attenuation, hover copy, and critical pulse eligibility |
| `web/digital-twin-portal/js/digital-twin-visual-state.test.js` | Covers visual-channel separation, attenuation, critical pulses, reduced motion, monitoring availability, and unknown operational states |
| `web/digital-twin-portal/js/digital-twin-layout.js` | Implements deterministic placement, collision checks, layout reconciliation, movement, rotation, and bounds calculations |
| `web/digital-twin-portal/js/digital-twin-layout.test.js` | Covers placement, reconciliation, collisions, rotation, bounds, and label fallback behavior |
| `web/digital-twin-portal/js/historical-data.js` | Implements historical query, chart, table, auto-refresh, and MTEX NS chart accent styling |
| `web/digital-twin-portal/js/dom-elements.js` | Adds DOM exports for historical UI, access/profile context, sidebar controls, registration payload preview, and role color picker controls |
| `web/digital-twin-portal/js/main.js` | Initializes historical and 3D twin modules, controls sidebar behavior, and routes the empty-map CTA to machine provisioning |
| `web/digital-twin-portal/js/auth.js` | Refreshes historical state after login/session changes and applies authenticated access/profile and tab access rules |
| `web/digital-twin-portal/js/ui-helpers.js` | Adds Historical Data tab behavior, workflow tab access handling, access/profile helpers, and inline denied placeholders |
| `web/digital-twin-portal/js/error-messages.js` | Centralizes recovery-oriented HTTP, network, and denied-state message formatting |
| `web/digital-twin-portal/js/inventory.js` | Exposes reactive registered-machine metadata, controls Machines in Use, permits optional machine names, cleans saved placements after deprovisioning, enforces canonical entity IDs, and drives registration/status workflows |
| `web/digital-twin-portal/js/device-activity.js` | Owns the shared four-second activity monitor, lightweight/full Orion query modes, failure state, and Current State telemetry snapshot |
| `web/digital-twin-portal/js/device-activity.test.js` | Covers polling frequency, Orion query modes, heartbeat timestamps, operational-state separation, and monitoring failures |
| `web/digital-twin-portal/js/machine-activity.js` | Applies shared activity to canonical inventory and Orion-fallback machine records using exact entity identity |
| `web/digital-twin-portal/js/machine-activity.test.js` | Covers exact entity-name matching, Device ID fallback, and in-place canonical machine updates |
| `web/digital-twin-portal/js/orion-logs.js` | Renders Current State from the shared full-telemetry snapshot while preserving filters and expanded rows |
| `web/digital-twin-portal/js/users.js` | Uses recovery-oriented Keyrock user-management messages |
| `web/digital-twin-portal/js/roles-permissions.js` | Uses recovery-oriented Keyrock role/permission-management messages and manages role color metadata, color validation, palette selection, custom hex preview, and colored assignment badges |
| `web/digital-twin-portal/js/machine-status.js` | Defines machine status code mappings, RGB colors, dropdown options, parsing, and shared badge rendering |
| `web/digital-twin-portal/css/styles.css` | Adds MTEX NS color/typography tokens, responsive 3D workspace and map-status styling, sidebar layout, role color picker styling, flatter operational panels, denser tables, and reduced-motion behavior |
| `web/digital-twin-portal/css/custom.css` | Replaces decorative gradient mode toggles with quieter segmented-control styling |

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
cd DT_V2.3/docker_compose
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

Open the portal:

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

Bounded maintenance counters are normalized to NGSI `Number` and stored as CrateDB `REAL`. The mapping contract test
prevents the 75 canonical counters from being registered as `StructuredValue` again. Their `_minimum` and `_maximum`
limits remain separate numeric attributes.

Other custom attributes may still be intentionally registered as `Text`. ML extraction should explicitly cast only
those text attributes when building training datasets.

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
