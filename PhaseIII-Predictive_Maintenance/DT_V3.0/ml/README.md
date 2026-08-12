# MTEX Predictive-Maintenance Module

Version `1.1.3` materializes the causal generator as deterministic, partitioned
Parquet datasets. It writes daily telemetry per machine, canonical maintenance
events, effective configuration, a validated `DatasetManifest`, SHA-256
checksums, and a generation report through an atomic staging boundary. Repeated
and checkpoint-resumed runs produce byte-identical packages in the locked local
runtime, and `dataset-check` independently verifies the published result.

The first generated pilot remains a `draft`: source-native physical units and
ranges still require confirmation, and a short pilot does not assert the final
100/30/30 independent-event gate. This release does not yet publish MQTT,
calculate labels or features, train models, connect to enterprise CrateDB, write
predictions to FIWARE, or change the portal. Frozen configuration and schema
contracts remain at `1.0.0`; the software release is `1.1.3`.

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
│   ├── contracts/           # Typed records, manifests, physical schemas, registry
│   └── generator/           # Engine, behaviour, Parquet datasets, events, checkpoints
├── tests/                   # Contracts, generator, behaviour, and dataset reproducibility
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

`config/components.yaml` remains the frozen source of truth. The registry
introduced in version 1.0.3 does not alter that file or its checksum; it validates
the complete document and exposes immutable definitions through
`mtex_pdm.component_registry`.

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

## Executable generator core (introduced in v1.1.1)

`mtex_pdm.generator` now provides the common state engine for future offline and
MQTT generation. The core is deliberately output-agnostic and does not sleep:
it advances a half-open UTC interval `[start_at, end_at)` and sends each result
immediately to a `GeneratorOutput`. Future wall-clock scheduling belongs to the
MQTT adapter, not to this state loop.

The run modes preserve the frozen names `offline`, `mqtt_continuous`, and
`mqtt_demonstration`. Offline machines must use `synthetic_historical` with a
train, validation, or test split; MQTT machines must use `mqtt_prospective` with
the prospective split. The engine rejects real-shadow machines because real
enterprise observations are ingested, not simulated.

### Public core interface

```python
from datetime import UTC, datetime

from mtex_pdm.contracts import DataSource, DatasetSplit
from mtex_pdm.generator import (
    GenerationConfig,
    GenerationMode,
    GeneratorEngine,
    InMemoryOutput,
    MachineBehavior,
    MachineSimulationSpec,
)

machine = MachineSimulationSpec(
    machine_id="synthetic-train-01",
    scenario_id="normal_operation",
    data_source=DataSource.SYNTHETIC_HISTORICAL,
    split=DatasetSplit.TRAIN,
)
config = GenerationConfig(
    mode=GenerationMode.OFFLINE,
    start_at=datetime(2026, 1, 1, tzinfo=UTC),
    end_at=datetime(2026, 1, 1, 0, 15, tzinfo=UTC),
    step_seconds=300,
    master_seed=20260729,
    machines=(machine,),
)
output = InMemoryOutput()
summary = GeneratorEngine(config, transition=MachineBehavior()).run(output)

assert summary.tick_count == 3
assert len(output.telemetry) == 3
assert len(output.ground_truth) == 3
```

The default `passthrough_transition` is retained for core-boundary tests and
custom transition development. Production of pilot synthetic histories uses
`MachineBehavior`, which implements the same public `StateTransition` seam and
returns an immutable `StepOutcome` for every step.

### Observable and hidden state

- `ObservableMachineState` accepts `iamalive` and finite numeric signals only
  from the canonical telemetry vocabulary.
- `HiddenMachineState` holds bounded component degradation and an optional
  synthetic cause.
- `TelemetrySnapshot` contains only observable state, source, split, machine,
  and time.
- `GroundTruthSnapshot` contains only hidden state, scenario, derived seed,
  machine, and time.

This separation occurs in the Python type boundary before feature engineering.
`hidden_degradation`, scenario, seed, synthetic cause, and future events cannot
be added as observable numeric signal names.

### Seeds and machine isolation

Each machine seed is the first 64 bits of a SHA-256 digest over the master seed,
machine ID, and scenario ID. It does not use Python's process-randomized
`hash()`. Every machine owns a separate `random.Random` stream; consequently,
adding another machine does not change the existing machine's random sequence.
The generator transition receives that RNG explicitly rather than reading
global random state.

### Checkpoint and exact resume

`engine.run(output, max_ticks=N)` pauses after complete timestamps. Calling
`engine.checkpoint()` captures the next UTC time, machine state, step indexes,
derived seeds, and full RNG continuation. The checkpoint is a frozen Pydantic
model and can be serialized with `model_dump_json()`.

Restore it with `GeneratorEngine.from_checkpoint(...)`. Restoration fails
closed if either the SHA-256 of the complete generation configuration or the
transition fingerprint changes, if machine order or derived seeds differ, or if
the continuation time is outside the configured interval. The behaviour
fingerprint covers its version, typed parameters, and scenario catalogue. Tests
verify that uninterrupted telemetry, hidden state, and events are exactly equal
to output produced before and after a serialized checkpoint.

### In-memory output boundary

`InMemoryOutput` stores immutable tuples for small unit tests and demonstrations.
The engine itself emits incrementally and does not retain past snapshots. Do not
use the memory output for the planned 12 × 180-day dataset; the later Parquet
adapter will consume the same streaming interface and write bounded partitions.

## Machine behaviour v1.1.2

`MachineBehavior` is the first complete pilot implementation of the state
transition. Its parameters are immutable and validated by `BehaviorParameters`.
The defaults are software-versioned working assumptions, not confirmed
industrial calibration: units, safe ranges, maxima, and degradation rates must
be reviewed with source data and frozen under a new generator-configuration
version before producing the definitive historical dataset.

### Causal step order

Every five-minute step follows one direction only:

1. Read the previous observable and hidden state.
2. Apply the assigned scenario and deterministic process variation.
3. Advance production, work, calendar, distance, and component degradation.
4. Detect threshold- or condition-based maintenance due events.
5. Perform a scheduled intervention when its causal timestamp is reached.
6. Reset only the affected component's counter and hidden degradation.
7. Apply measurement noise or telemetry transport effects to the emitted copy.
8. Emit observable telemetry, a separate hidden snapshot, and zero or more
   ground-truth lifecycle markers.

Process variation and measurement noise use independent deterministic random
streams. Increasing sensor noise therefore changes the measured values without
changing the physical trajectory, degradation, or event times. Missing,
delayed, duplicated, invalid, and temporarily absent telemetry affect emissions
only; the machine continues evolving internally.

### Four component dynamics

| Component | Main causal drivers | Due rule | Intervention reset |
|-----------|---------------------|----------|--------------------|
| Print bar — calendar | Elapsed calendar time | Counter reaches current calendar maximum | Calendar counter and component degradation |
| Print bar — distance | Produced copies and travelled distance | Distance reaches current configured maximum | Distance counter and component degradation |
| Transport vacuum air filter | Active time, load, and humidity | Work counter or hidden condition reaches limit | Vacuum-work counter and component degradation |
| Supply pump colour 1 | Active time, ink-area temperature, and supply pressure instability | Work counter or hidden condition reaches limit | Pump-work counter and component degradation |

Limits remain observable and may change prospectively. The
`limit_reconfiguration` scenario, for example, lowers the distance maximum
during the run; no past label or event is rewritten.

### Scenarios and split reservations

The catalogue implements every scenario ID frozen in `config/scenarios.yaml`:
normal/high/intermittent production, temperature, humidity and bounded pressure stress,
planned maintenance, held-out robustness cases, and prospective MQTT cases. It
also provides explicit pilot aliases for delayed intervention, missing sensors,
duplicates, delayed telemetry, and return after unavailability.

Robustness scenarios are rejected from the training split. Prospective scenario
IDs require `mqtt_prospective`, and prospective machines cannot use historical
scenario IDs. These checks keep the future evaluation stream separate from
historical model development.

### Maintenance lifecycle and event assembly

A component emits a deterministic `due` marker once when its first threshold or
condition rule becomes true. Normal and planned policies assign a future
intervention time inside the configured delay range; the delayed-intervention
policy deliberately leaves the event open. On the intervention tick the engine
emits `performed`, sets machine status to maintenance for that tick, and resets
only the affected component.

`assemble_maintenance_events(output.events, finalize_at=...)` converts the
append-only runtime markers into canonical `MaintenanceEvent` records. Joined
due/performed pairs are completed events; due markers without a performed marker
at finalization become censored events. The assembler fails closed on duplicate,
missing, temporally inconsistent, or cross-component marker pairs.

The generator tests cover deterministic directions, process/measurement
separation, telemetry anomalies, scenario reservations, threshold and condition
events, delayed interventions, component-local resets, completed/censored event
assembly, and exact checkpoint resume.

## Reproducible Parquet datasets v1.1.3

`ParquetDatasetOutput` implements the same streaming `GeneratorOutput` boundary
as `InMemoryOutput`, but retains at most one UTC day per machine. It validates
each snapshot as a canonical `TelemetryRecord`, rotates a partition when the day
changes, and writes the exact `TELEMETRY_ARROW_SCHEMA` with Zstandard level 3,
fixed Parquet options, deterministic paths, one writer thread, and a bounded row
group. Missing sensors become null values in a stable schema.

Telemetry is stored as:

```text
telemetry/machine=<id>/date=<yyyy-mm-dd>/part-00000.parquet
```

Runtime due/performed markers are assembled at finalization into one canonical
`MaintenanceEvent` per independent lifecycle and written to
`ground_truth/events.parquet`. Hidden degradation snapshots are counted for
audit but deliberately excluded from the training telemetry package.

### Atomic package finalization

Generation starts below `.<dataset-id>.tmp`. `finalize()` refuses an incomplete
engine run, closes telemetry, assembles events, copies the four verified frozen
configs, and records effective generation/behaviour/Parquet parameters plus
scenario assignments and derived machine seeds. It then writes:

```text
<dataset-id>/
├── telemetry/machine=<id>/date=<yyyy-mm-dd>/part-00000.parquet
├── ground_truth/events.parquet
├── configs/{generator.yaml,scenario_assignments.json,<four frozen YAMLs>}
├── manifests/{dataset_manifest.json,checksums.sha256}
└── reports/generation_report.json
```

The `DatasetManifest` is built from files actually closed on disk. Every
`ArtifactFile` records a safe relative path, SHA-256, size, media type, role,
and, for Parquet, row count. The report records tick/row/event/partition counts,
rows per machine and split, events per component, censored events, missing
values, duplicate timestamps, bytes, and the required synthetic-data
limitations. Only after the whole staging package passes `verify_dataset()` is
the directory atomically renamed to its published name.

### Verification and reproducibility

`verify_dataset()` and the `dataset-check` command fail closed on:

- missing, unexpected, unsafe, duplicate, changed, or corrupt checksum entries;
- invalid manifest, telemetry, event, scenario-assignment, or report contracts;
- Arrow schema or UTC partition mismatches;
- inconsistent artifact sizes or row counts;
- disagreement between Parquet, manifest, report, scenarios, machines, events,
  schema hashes, or copied frozen-config checksums;
- duplicate maintenance lifecycle IDs.

Tests prove exact repeat-run equality, continuous versus checkpoint-resumed
equality, Parquet round trips across UTC day boundaries, component event counts,
corruption detection, failure atomicity, seed variation, machine isolation,
physical-schema stability, leakage exclusions, CLI generation, and CLI
verification. Byte equality is expected in the locked runtime; cross-device
validation should also compare semantic content because codec implementations
may evolve independently of the records.

### Generate and verify the draft pilot

The pilot command creates three historical machines—one per split—at five-minute
resolution. `--code-commit` is mandatory and must be the real Git SHA associated
with the running code.

```bash
python -m mtex_pdm dataset-generate-pilot \
  --output-root data/pilots \
  --dataset-id synthetic-pilot-v1 \
  --code-commit <real-git-sha> \
  --start-date 2026-01-01 \
  --days 7 \
  --created-at 2026-08-12T12:00:00Z

python -m mtex_pdm dataset-check data/pilots/synthetic-pilot-v1
```

The command always creates a `draft`. The existing manifest contract blocks a
`complete` dataset while units contain `source_native_unconfirmed` or the
100/30/30 event gate is not reached. Do not invent a commit or reduce the gates
after observing results. The official Day-5 pilot must run from a valid Git
clone; development fixtures may use an explicit test SHA only inside tests.

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

# Generate the three-machine draft pilot (requires a real Git SHA)
python -m mtex_pdm dataset-generate-pilot --output-root data/pilots \
  --dataset-id synthetic-pilot-v1 --code-commit <real-git-sha> \
  --start-date 2026-01-01 --days 7 --created-at 2026-08-12T12:00:00Z

# Verify checksums, schemas, partitions, counts, manifest, configs, and report
python -m mtex_pdm dataset-check data/pilots/synthetic-pilot-v1

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
docker build --file Dockerfile.training --tag mtex-pdm-training:1.1.3 .
docker run --rm --cpus 2 --memory 4g mtex-pdm-training:1.1.3
docker run --rm mtex-pdm-training:1.1.3 components-check --json
```

The image defaults to the full `environment-check`. Its entry point is
`mtex-pdm`, so an explicit entry-point override is required to run development
tools:

```bash
docker run --rm --entrypoint python mtex-pdm-training:1.1.3 -m pytest
```

### Device-specific builds

On the M1 Pro MacBook:

```bash
docker buildx build \
  --platform linux/arm64 \
  --load \
  --file Dockerfile.training \
  --tag mtex-pdm-training:1.1.3-arm64 \
  .
```

On the x86-64 home server:

```bash
docker buildx build \
  --platform linux/amd64 \
  --load \
  --file Dockerfile.training \
  --tag mtex-pdm-training:1.1.3-amd64 \
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
- Executable UTC generator loop for bounded offline and future MQTT run profiles.
- Immutable basic observable and hidden machine-state types with separated streams.
- Stable per-machine seed derivation and isolated RNG streams.
- Incremental output protocol with a temporary in-memory implementation.
- Causal pilot behaviour for all four component definitions and canonical signals.
- Historical, robustness, prospective, and telemetry-anomaly scenario catalogue.
- Separate physical and measurement randomness so sensor noise cannot alter wear.
- Threshold- and condition-based due events, scheduled/delayed interventions,
  and component-local maintenance resets.
- Append-only runtime markers and strict completed/censored event assembly.
- JSON-serializable, config- and behaviour-bound checkpoints with exact resume.
- Bounded daily/machine Parquet output with fixed schema and Zstandard options.
- Atomic draft dataset publication with effective configs and scenario assignments.
- Validated dataset manifest, SHA-256 file integrity, and generation report.
- Independent dataset verifier and three-machine pilot-generation commands.
- Byte-identical repeat/checkpoint-resume tests plus semantic integrity gates.
- Parquet and LightGBM smoke tests.
- Reproducible, non-root ARM64/x86-64 Docker build.
- Conservative default thread use and documented launch-time device limits.

Intentionally deferred to the next targets:

- Confirmation of source-native physical units during the generator pilot.
- Review and freeze of pilot physical ranges and degradation rates before dataset generation.
- Official Day-5 pilot from a valid Git clone and subsequent profiling/event review.
- Full 12-machine × 180-day dataset after unit/parameter review and freeze.
- MQTT output and wall-clock scheduling for prospective machines.
- Complete dataset/event-volume reproducibility gate, labels, feature computation,
  training, and inference.
- Machine registration and prospective MQTT scenarios.
- Read-only enterprise CrateDB export.
- FIWARE prediction persistence and portal integration.
