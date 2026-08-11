# MTEX Predictive-Maintenance Module

Version `1.0.3` turns the four frozen maintenance definitions into a typed,
validated operational registry shared by later generator, label, feature,
training, inference, and portal work. It preserves the reproducible environment
from v1.0.1 and the versioned data contracts from v1.0.2.

This version loads and verifies component definitions only. It does not generate
telemetry, calculate labels or features, train models, connect to enterprise
CrateDB, publish MQTT messages, run inference, write predictions to FIWARE, or
change the portal. The frozen configuration and schema contracts remain at
`1.0.0`; the software release is `1.0.3`. They evolve independently.

## Environment Contract

| Item | Frozen choice | Reason |
|------|---------------|--------|
| Python | CPython `>=3.12,<3.13` | One exact minor version across Windows, macOS ARM64, and Linux x86-64 |
| Container base | Official `python:3.12.13-slim-bookworm`, pinned by multi-platform digest | Repeatable ARM64 and x86-64 builds |
| Data frame and files | Polars, PyArrow, Parquet with Zstandard compression | Efficient time-series processing and portable columnar artifacts |
| Model stack | scikit-learn, LightGBM, SHAP, Matplotlib | Baselines, deployed candidate, offline explanations, and thesis figures |
| Configuration | PyYAML and Pydantic | Frozen YAML integrity plus strict typed component and artifact contracts |
| Verification | pytest, Ruff, mypy | Regression tests, lint/format checks, and strict static typing |
| Default native threads | `1` inside Docker | Avoid competing with unrelated workloads on domestic devices |

NumPy is fixed at `2.4.6`, rather than `2.5.x`, because Numba `0.66.0`—used by
SHAP—supports NumPy 2.x below 2.5. This deliberate compatibility pin prevents
the resolver from falling back to obsolete Numba releases that do not support
Python 3.12.

## Module Layout

```text
ml/
├── config/                  # Frozen v1.0.0 MVP contract and checksums
├── examples/contracts/      # Valid and deliberately invalid contract fixtures
├── schemas/                 # Generated JSON/Arrow schemas and SHA-256 checksums
├── src/mtex_pdm/
│   ├── component_registry.py # Typed four-component operational registry
│   └── contracts/           # Typed records, manifests, physical schemas, registry
├── tests/                   # Environment, configuration, contract, and component tests
├── .dockerignore
├── Dockerfile.training      # ARM64/x86-64 training and verification image
├── pyproject.toml           # Package metadata and tool configuration
├── requirements.in          # Direct dependency decisions
├── requirements.lock        # Full transitive lock with package hashes
└── README.md
```

The `requirements.in` file records intentional direct dependencies.
`requirements.lock` is generated from it with Python 3.12 and freezes all
transitive dependencies and accepted package hashes. Install from the lock for
normal work. Regenerate it only as an explicit dependency update, followed by
all checks and a versioned documentation entry.

## Data Contract v1.0.0

Pydantic models are the source of truth for JSON records and manifests. PyArrow
is the source of truth for the two Parquet table layouts. Files under `schemas/`
are generated views of those sources and are committed so that other languages,
the thesis, and future jobs can inspect the contract without importing Python.

| Contract | Purpose | Critical guarantees |
|----------|---------|---------------------|
| `CrateTelemetryRow` | Boundary row from `mtopeniot.etmachine` | Crate timestamp, text, and `REAL` values are validated; unrelated columns are ignored |
| `TelemetryRecord` | Canonical row used by ML | UTC, pseudonymized machine ID, finite numbers, and source/split compatibility |
| `MaintenanceEvent` | One independent due/performed lifecycle | Component-label consistency, causal time ordering, and no real shadow labels |
| `DatasetManifest` | Frozen generated dataset identity | Split-disjoint machines, event gates, config/schema hashes, units, files, and provenance |
| `ExportManifest` | Read-only enterprise export receipt | Requested/actual ranges, watermarks, pseudonymization version, status, and artifact hash |
| `FeatureSchema` | Ordered model input interface | Stable zero-based order, types, windows, units, imputation, and leakage exclusions |
| `ModelManifest` | Portable trained-model receipt | Exact dataset/code/generator lineage, horizons, components, thresholds, metrics, and files |

All persisted contract models reject unknown fields, except the source
`CrateTelemetryRow`: a CrateDB query can return unrelated machine attributes,
which are deliberately ignored and never copied to the canonical record. The
selected ML columns still have strict types.

### CrateDB type boundary

The repository's QuantumLeap schema synchronization maps the current values as
follows:

| Historical value | NGSI type | CrateDB type | Canonical Parquet type |
|------------------|-----------|--------------|------------------------|
| `entity_id`, `entity_type`, `iamalive` | `Text` | `TEXT` | UTF-8 string |
| `time_index` | `DateTime` | `TIMESTAMP WITH TIME ZONE` | `timestamp[ms, UTC]` |
| Selected telemetry and generated `_maximum` values | `Number` | `REAL` | `float64` |

CrateDB HTTP `_sql` timestamps may be supplied as Unix milliseconds or as an
ISO-8601 string with an explicit timezone. Naive timestamps, non-finite numeric
values, wrong physical column types, missing essential columns, and raw
enterprise IDs in export attribute lists are rejected.

The real schema can be captured read-only with this query:

```sql
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_schema = 'mtopeniot'
  AND table_name = 'etmachine'
ORDER BY column_name;
```

Save the HTTP result as JSON and validate it directly. The validator accepts
either the raw CrateDB `cols`/`rows` response or the normalized snapshot format
shown in `examples/contracts/crate_schema_snapshot.example.json`.

```bash
python -m mtex_pdm contracts-check \
  --crate-schema path/to/cratedb-schema.json
```

No database credential, hostname, enterprise entity ID, or raw production row
belongs in the repository. The supplied snapshot is a schema-only example.

### Units and dataset freeze

Attribute names that encode their units use `mm/s` and `rpm`, and all timestamps
use UTC. The existing simulator and portal mapping do not document authoritative
physical units for temperatures, humidity, counters, or pressure. Those fields
are therefore marked `source_native_unconfirmed` instead of being guessed.
A draft manifest may record that state; a `complete` dataset manifest cannot.
The units and physical ranges must be confirmed during the generator pilot,
before the first dataset freeze, as required by `config/scenarios.yaml`.

### Manifest integrity and compatibility

Every portable file descriptor contains a relative POSIX path, size, media type,
role, optional row count, and SHA-256. Absolute paths and `..` traversal are
invalid. JSON hashing uses sorted, whitespace-independent canonical encoding.
Model loading must call `verify_feature_model_compatibility`; a different
feature name, order, type, window, unit, imputation rule, or component scope
changes the feature-schema hash and fails closed.

`schemas/checksums.sha256` protects the generated schemas themselves. Regenerate
them only after an intentional contract change:

```bash
python -m mtex_pdm contracts-export
python -m mtex_pdm contracts-check
```

The second command also validates all committed valid fixtures, confirms that
the deliberately invalid leakage/naive-time fixtures are rejected, and checks
the example feature schema against the example model manifest.

## Four-component operational registry

`config/components.yaml` remains the frozen source of truth. Version 1.0.3 does
not alter that file or its checksum; it validates the complete document and
exposes immutable definitions through `mtex_pdm.component_registry`.

| Component key | Mode | Label source | Principal observable |
|---------------|------|--------------|----------------------|
| `print_bar_calendar` | `threshold` | `threshold_proxy` | `print_bar_time_since_last_pm` |
| `print_bar_distance` | `threshold` | `threshold_proxy` | `print_bar_traveled_distance_since_last_pm` |
| `transport_vacuum_filter` | `condition` | `simulated_condition_event` | `transport_vacuum_work_time_since_last_air_filter_pm` |
| `supply_pump_color_1` | `condition` | `simulated_condition_event` | `pump_supply_color_1_work_time_since_replacement` |

The public interface is deliberately small:

```python
from mtex_pdm.component_registry import load_component_registry

registry = load_component_registry()
components = registry.list_components()
distance = registry.get("print_bar_distance")
attributes = registry.observable_attributes(distance.key)
all_attributes = registry.all_observable_attributes
```

The registry fails closed when:

- the four canonical keys or their order change;
- a referenced attribute is absent from the canonical telemetry schema;
- threshold and condition modes use the wrong label, event, or reset rule;
- a primary attribute is not a component signal;
- the ETA is disabled, uses a different source, or has a role incompatible with its mode;
- a condition component lacks unique hidden-degradation drivers;
- hidden ground truth is published to MQTT or permitted in features;
- an obligatory leakage exclusion is removed;
- component attribute lists overlap or contain duplicates;
- `iamalive` is used as a component feature instead of connectivity evidence;
- a synthetic-only signal is not declared as an extension;
- a synthetic extension is made mandatory for real shadow data.

`pressure_supply_color_1` is the one current synthetic extension. It is an
observable signal for the Python predictive simulator, is absent from the ESP32
simulator, and remains optional for real shadow data.

Run the diagnostic from `DT_V3.0/ml`:

```bash
python -m mtex_pdm components-check
python -m mtex_pdm components-check --json
```

The current report contains four components, eight shared observables, 21 unique
observables in total, two condition components with hidden state, one synthetic
extension, and nine mandatory leakage exclusions.

## Local Setup

Run the following commands from `DT_V3.0/ml`.

### Windows PowerShell

```powershell
py -3.12 -m venv .venv
.\.venv\Scripts\python.exe -m pip install --require-hashes -r requirements.lock
.\.venv\Scripts\python.exe -m pip install --no-deps --no-build-isolation -e .
.\.venv\Scripts\python.exe -m mtex_pdm environment-check
```

### macOS or Linux

```bash
python3.12 -m venv .venv
./.venv/bin/python -m pip install --require-hashes -r requirements.lock
./.venv/bin/python -m pip install --no-deps --no-build-isolation -e .
./.venv/bin/python -m mtex_pdm environment-check
```

The diagnostic command exits with `0` only when all of these checks succeed:

- CPython is in the supported 3.12 minor-version range.
- The machine architecture normalizes to `arm64` or `x86_64`.
- Every direct runtime and ML dependency has the exact expected version.
- Every frozen YAML file matches `checksums.sha256`.
- The four canonical component keys and the 24-hour/168-hour horizons remain
  coherent across the configuration files.
- Decision thresholds remain unset and validation-only.
- A small Zstandard Parquet file can be written and read.
- LightGBM can fit and score a deterministic eight-row dataset with one worker.

For a faster check that does not import the native model/file stack:

```bash
python -m mtex_pdm environment-check --skip-smoke-tests
```

## Commands

```bash
# Package version
python -m mtex_pdm --version

# Frozen YAML integrity and semantic invariants
python -m mtex_pdm config-check

# Typed four-component registry and cross-contract references
python -m mtex_pdm components-check

# Generated schemas, examples, checksums, and compatibility
python -m mtex_pdm contracts-check

# Optional schema-only snapshot from the enterprise CrateDB
python -m mtex_pdm contracts-check --crate-schema path/to/cratedb-schema.json

# Intentional regeneration after changing Python contract sources
python -m mtex_pdm contracts-export

# Full machine/environment report
python -m mtex_pdm environment-check

# Machine-readable compact output
python -m mtex_pdm environment-check --json

# Regression tests
python -m pytest

# Code quality
python -m ruff check .
python -m ruff format --check .
python -m mypy
```

`--config-dir PATH` may be passed to configuration, component, or environment
checks. The alternative
`MTEX_PDM_CONFIG_DIR` environment variable is useful inside containers. No
credential or connection string belongs in the frozen YAML files.

## Docker

Build from `DT_V3.0/ml`. The build installs only packages accepted by the
hash-locked requirements file, installs the local package without resolving a
second dependency graph, validates the frozen configuration, and runs the test
suite. The final process uses a non-root user.

```bash
docker build --file Dockerfile.training --tag mtex-pdm-training:1.0.3 .
docker run --rm --cpus 2 --memory 4g mtex-pdm-training:1.0.3
docker run --rm mtex-pdm-training:1.0.3 components-check --json
```

The image defaults to the full `environment-check`. Its entry point is
`mtex-pdm`, so an explicit entry-point override is required to run development
tools:

```bash
docker run --rm --entrypoint python mtex-pdm-training:1.0.3 -m pytest
```

### Device-specific builds

On the M1 Pro MacBook:

```bash
docker buildx build \
  --platform linux/arm64 \
  --load \
  --file Dockerfile.training \
  --tag mtex-pdm-training:1.0.3-arm64 \
  .
```

On the x86-64 home server:

```bash
docker buildx build \
  --platform linux/amd64 \
  --load \
  --file Dockerfile.training \
  --tag mtex-pdm-training:1.0.3-amd64 \
  .
```

Do not copy an ARM64 container image from the MacBook to the x86-64 server.
Build the same Dockerfile and lock independently on each architecture, then
transfer only portable Parquet datasets, JSON manifests, figures, and later
LightGBM model artifacts.

## Domestic-Device Resource Profiles

Start conservatively because all three devices have unrelated workloads.
Resource limits are launch-time controls and therefore are not hard-coded in
the image.

| Device and role | Initial Docker limit | Intended use |
|-----------------|----------------------|--------------|
| MacBook Pro M1 Pro, 16 GB | `--cpus 6 --memory 8g` | Historical generation and model training |
| Home server, 32 GB | `--cpus 4 --memory 6g` | Synthetic MQTT, scheduled inference, and later batch jobs |
| Windows PC, 16 GB | Prefer the local venv; otherwise `--cpus 4 --memory 6g` | Read-only enterprise export analysis and shadow tests |

The container defaults native math, Polars, and OpenMP thread pools to one
thread. A later training command may raise these explicitly within the device
limit after resource observation; no training job should assume all advertised
CPU cores or RAM are available.

## Outputs and Repository Hygiene

Local virtual environments, caches, generated datasets, trained models,
artifacts, and reports are ignored by Git. Later implementation steps must
write generated data below `ml/data`, portable model outputs below
`ml/artifacts` or `ml/models`, and thesis-ready generated reports below
`ml/reports`. Only small schemas, manifests, checksums, source code, tests, and
documentation should be committed.

## Current Boundary

Available now:

- Installable `mtex-pdm` package and command-line diagnostics.
- Hash-locked Python 3.12 environment.
- Frozen-config integrity and cross-file invariant checks.
- Immutable operational registry for the four MVP maintenance components.
- Cross-validation of labels, events, resets, ETA, telemetry, hidden state,
  leakage exclusions, and the optional synthetic pressure extension.
- Strict CrateDB ingestion and canonical telemetry/event records.
- Dataset, enterprise-export, feature, and model manifests.
- Generated JSON Schemas and Arrow/Parquet physical schemas.
- Valid/invalid examples, SHA-256 integrity, and compatibility checks.
- Parquet and LightGBM smoke tests.
- Reproducible, non-root ARM64/x86-64 Docker build.
- Conservative default thread use and documented launch-time device limits.

Intentionally deferred to the next targets:

- Confirmation of source-native physical units during the generator pilot.
- Generator, labels, feature computation, training, and inference implementations.
- Machine registration and prospective MQTT scenarios.
- Read-only enterprise CrateDB export.
- FIWARE prediction persistence and portal integration.
