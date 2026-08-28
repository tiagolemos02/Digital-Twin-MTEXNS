# MTEX Predictive-Maintenance Module

Version `1.1.7` hardens the prospective MQTT publisher's state-file lock across
Windows, macOS, and Linux. It preserves the complete v1.1.6 MQTT and checkpoint
contract while making the platform-specific native locking boundary verifiable
by mypy on all three operating-system targets.

The company workbook is the authority for names, units, types, hierarchies, and
counter limits. The supplied live TPPPS4 observation is only a format example and
is not used to calibrate distributions or event frequencies. The software release
is `1.1.7`, configuration and persisted contracts are `1.1.0`, and the source
catalogue is `1.0.0`. This release implements local rendering, scheduling,
publication, and restart state; it does not register portal machines, deploy to
the company server, contact a broker, create labels/features/models, read the
enterprise database, persist FIWARE predictions, or change the portal.

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
├── config/                  # Frozen v1.1.0 contract, source catalogue, and checksums
│   └── archive/v1.0.0/      # Superseded configuration retained unchanged
├── examples/contracts/      # Valid and deliberately invalid contract fixtures
├── examples/mqtt/           # Secret-free prospective publisher example
├── examples/pilot/          # Minimal anonymized real reference observation
├── schemas/                 # Generated JSON/Arrow schemas and SHA-256 checksums
├── src/mtex_pdm/
│   ├── component_registry.py # Typed four-component operational registry
│   ├── telemetry_catalog.py  # TPPPS4 catalogue and machine-status contract
│   ├── contracts/           # Typed records, manifests, physical schemas, registry
│   ├── generator/           # Engine, behaviour, Parquet datasets, events, checkpoints
│   ├── mqtt_publisher.py     # MQTT rendering, transport, scheduling, state, and resume
│   └── pilot_analysis.py    # Profiling, event prevalence, scale decision, verification
├── tests/                   # Contracts, generator, dataset, and pilot-analysis tests
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

## Data Contract v1.1.0

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

### TPPPS4 catalogue, units, and dataset compatibility

`config/tppps4_telemetry_catalog.json` is the versioned machine-source contract.
It contains exactly 105 attributes from the TPPPS4 payload, including fields not
selected for predictive modelling, and records the authorised type, unit,
hierarchy, and optional maximum semantics. The main unit families are:

| Signal family | Canonical unit |
|---------------|----------------|
| Temperatures | `degC` |
| Humidity | `%` |
| Production and relay/contactor usage | `count` |
| Calendar counters | `d` |
| Travelled-distance counters | `m` |
| Work-time counters | `s` |
| Linear speed | `mm/s` |
| Rotational speed | `rpm` |
| `machine_status` | `status_code` (categorical) |

The source encodes bounded counters as `{ "value": "...", "maximum": "..." }`.
The canonical predictive record flattens the selected four counters into value
and `<attribute>_maximum` columns while preserving the counter's unit. The
official maxima are 90 days for print-bar calendar maintenance, 250 metres for
print-bar travel, 144000 seconds for transport-vacuum filter work, and 2880000
seconds for colour-1 supply-pump work.

`config-check`, `environment-check`, and the contract registry reuse the same
typed catalogue validator for the exact status names/codes, all 105 canonical
units, the 16+4 selection, and the four official maxima. Dataset generation also
compares its effective behavior parameters with those frozen maxima before it
creates an output directory, preventing configuration and simulated physics from
silently diverging.

`machine_status` is physically stored as a numeric CrateDB/Parquet value for
compatibility, but it is semantically categorical. The catalogue and
`MachineStatus` enum accept only the 25 authorised integer codes; their numeric
distance has no modelling meaning.

The 16 selected source attributes are `iamalive`, `machine_status`, four
environment variables, two production counts, the four target counters, and the
four relevant speed signals. Four derived maximum fields bring the canonical
predictive telemetry width to 20. `pressure_supply_color_1` was removed because
it does not exist in the authorised 105-attribute payload. The confirmed mapping
of `pressure_subtank_1` position 1 to colour 1 is documented for a later version,
but that source field is also outside this strict TPPPS4 payload and is not used
by the initial pump model.

Datasets written by v1.1.4 used the superseded v1.0.0 contract and old generator
dynamics. Keep them as technical evidence for portability, determinism, and
resource use, but do not reuse their event counts or prevalence as v1.1.5 model
evidence. Regenerate a new dataset and analysis package; manifests fail closed on
the old schema/config version instead of being edited in place.

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

`config/components.yaml` remains the frozen source of truth. Version 1.1.5 moves
that configuration to v1.1.0 while retaining v1.0.0 in the archive; the registry validates
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
- a synthetic extension is made mandatory for real shadow data;
- the selected source catalogue is not exactly 16 attributes plus four derived maxima.

Run the diagnostic from `DT_V3.0/ml`:

```bash
python -m mtex_pdm components-check
python -m mtex_pdm components-check --json
```

The current report contains four components, eight shared observables, 20 unique
canonical observables, two condition components with hidden state, zero synthetic
extensions, nine mandatory leakage exclusions, and lineage to all 105 source
catalogue attributes.

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
industrial calibration. Units and official counter maxima are now confirmed;
safe ranges, distributions, time-compression, and degradation rates must still
be reviewed before producing the definitive historical dataset.

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
| Supply pump colour 1 | Active time, ink-area temperature, and production load | Work counter or hidden condition reaches limit | Pump-work counter and component degradation |

Calendar time advances in days as `step_seconds / 86400`. Print-bar distance is
integrated only while status is Printing, using the linear `mm/s` speed and the
configurable `print_bar_effective_motion_fraction`. Its default `1/288` is an
explicit accelerated-history assumption that preserves the previous pilot scale;
it is not a measured TPPPS4 duty cycle. Vacuum and pump condition degradation are
normalized against their official work-time maxima, with documented scenario
stress multipliers allowing earlier synthetic condition events.

Limits remain observable and may change prospectively. The
`limit_reconfiguration` scenario, for example, lowers the distance maximum
during the run; no past label or event is rewritten.

### Scenarios and split reservations

The catalogue implements every scenario ID frozen in `config/scenarios.yaml`:
normal/high/intermittent production, temperature, humidity, and supply-pump stress,
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
`complete` dataset while the 100/30/30 event gate is not reached or the reviewed
v1.1.5 provenance/compatibility requirements are absent. Do not invent a commit or reduce the gates
after observing results. The official Day-5 pilot must run from a valid Git
clone; development fixtures may use an explicit test SHA only inside tests.

## Pilot profiling and scale decision (introduced in v1.1.4)

Implementation D is a decision checkpoint, not model training. It answers four
questions before producing the expensive historical candidate:

1. Was a structurally valid pilot generated with the intended machines,
   scenarios, splits, cadence, and partitions?
2. Are all observable columns numerically usable, and how do their ranges differ
   globally, by machine, and by scenario?
3. How many independent maintenance lifecycles occurred per component and split,
   and what preliminary class prevalence would the 24-hour and 168-hour horizons
   create?
4. Is the evidence sufficient to retain the frozen 7/2/3-machine, 180-day design,
   or should machines, duration, or provisional behaviour parameters be reviewed?

### Public commands

`pilot-run` is the normal first-pass command. It generates and independently
verifies the draft dataset, profiles it, analyzes its event table, calculates a
scale recommendation, verifies the analysis package, and only then publishes the
analysis directory.

```powershell
$commit = git -C "<repository-root>" rev-parse HEAD

python -m mtex_pdm pilot-run `
  --output-root data/pilots `
  --analysis-root reports/pilots `
  --dataset-id synthetic-pilot-day5-v1 `
  --code-commit $commit `
  --start-date 2026-01-01 `
  --days 7 `
  --train-machines 1 `
  --validation-machines 1 `
  --test-machines 1 `
  --created-at 2026-08-13T08:00:00Z `
  --reference-snapshot examples/pilot/real_machine_snapshot.example.json `
  --json
```

Use `pilot-analyze` when the dataset already exists. It is read-only with respect
to that dataset and refuses to analyze it when `dataset-check` would fail.

```powershell
python -m mtex_pdm pilot-analyze `
  data/pilots/synthetic-pilot-day5-v1 `
  --analysis-root reports/pilots `
  --reference-snapshot examples/pilot/real_machine_snapshot.example.json `
  --json
```

Verify a copied or archived analysis and, preferably, its link to the original
dataset:

```powershell
python -m mtex_pdm pilot-analysis-check `
  reports/pilots/synthetic-pilot-day5-v1-analysis `
  --dataset-path data/pilots/synthetic-pilot-day5-v1 `
  --json
```

All destinations are create-once. Reusing an existing dataset, analysis, or
staging path fails instead of overwriting evidence. The `--created-at` timestamp
is provenance supplied by the operator; it does not affect generated physical
time. Machine counts must be positive. Scenario pools are taken from the seven
historical scenarios already frozen for each split and cycled deterministically
when a split has more machines than scenarios.

### Analysis package

```text
<dataset-id>-analysis/
├── profile_summary.json   # Structure plus numeric distributions and reference comparison
├── event_analysis.json    # Independent events, censoring, delays, density, 24 h/168 h windows
├── scale_decision.json    # Current evidence, gates, recommendation, reasons, freeze status
├── profile_report.md      # Short thesis/operator-readable summary
├── analysis_manifest.json # Dataset lineage plus artefact size/hash metadata
└── checksums.sha256       # Integrity of every other analysis file
```

The profiler reports row and partition counts, machines and scenarios, split
counts, first/last timestamps, cadence deviations, duplicates, gaps, null and
non-finite counts, distinct values, minimum, p01, p25, median, mean, p75, p99,
maximum, and population standard deviation. Numerical summaries are emitted for
every canonical attribute globally, by machine, and by scenario.

The committed real reference is deliberately minimal and anonymized. Only
canonical fields needed for this pilot are retained; wiper-suction pressure is
recorded as ignored because it is a cleaning signal rather than the deferred
colour-1 supply-pressure mapping.
No host, credential, enterprise machine ID, timestamp precise enough to identify
production, or complete operational payload is committed. The observation is
used only to validate source formatting and show whether its individual values
fall inside or outside the synthetic pilot range; it does not confirm units or
calibrate the synthetic population.

### Event prevalence and scale rules

An event is one unique due/performed maintenance lifecycle, not every telemetry
row whose future window is positive. Counts are reported per component, split,
and scenario, with censored lifecycles and due-to-intervention delays separated.
The 24-hour and 168-hour prevalence calculations are explicitly preliminary.
Prevalence is reported overall and crossed by component/split and
component/scenario; positive-window counts are also separated by label source.
Rows without a complete future horizon are future-censored, and intervals where
maintenance is already overdue are excluded. The final Day-6/7 label pipeline
will define full label-source denominators and add its quality/leakage rules.

Before profiling, assignments must have unique/exact manifest machine coverage,
valid identity/seed types, the manifest split, the historical source, and the
manifest scenario set; every telemetry row must repeat its assigned split and
source. Before counting an event, the analysis also verifies that its machine
exists, its split/scenario/source match that assignment, and its due and performed
timestamps fall inside the dataset interval. The scale decision then
compares observed independent-event density with the frozen
targets of 100 events per component in train and 30 per component in validation
and test. Nonzero pilot density is projected to required machine-days with a 25%
safety margin. A zero-event component is marked inconclusive—never interpreted
as zero risk—and recommends increasing both diversity and duration. If the pilot
already has at least the frozen machine counts and duration, the next bounded
experiment increases each axis by at least 25%. The possible decisions are:

| Decision | Meaning |
|----------|---------|
| `increase_both` | Missing event evidence and/or both machine diversity and exposure are inadequate |
| `increase_machines` | Duration is sufficient, but split diversity is below the frozen design |
| `increase_days` | Machine counts are sufficient, but exposure is below the conservative projection |
| `review_parameters` | Scale alone is not the issue; reference ranges, dynamics, or gate behavior need human review |
| `ready_for_freeze` | Current units, diversity, duration, and independent-event gates pass |

The recommendation never edits YAML, lowers gates, copies events between splits,
or promotes a dataset from `draft`. `freeze_ready` can only become true when the
decision is `ready_for_freeze`, all event gates pass, and the catalogue/unit
contract is complete. Configuration changes require a separate versioned,
human-approved implementation after examining these reports.

### Windows first, MacBook second

Implement, lint, and run the short 1/1/1-machine pilot on Windows first. This
quick run checks software and report semantics; it is not intended to satisfy
event gates. Commit v1.1.5 before producing new research evidence so the manifest can
record the exact Git SHA. Keep the dataset and analysis outside Git.

After reviewing `profile_report.md`, `profile_summary.json`,
`event_analysis.json`, and `scale_decision.json`, copy or clone the same committed
code to the M1 Pro MacBook. Create its own Python 3.12 environment or ARM64 Docker
image, run `environment-check`, and execute the recommended larger pilot there.
Start with the frozen 7/2/3-machine, 180-day design only if the short pilot has no
structural or parameter defect; otherwise run a smaller adjusted pilot first.
The implementation stays in Git and is identical on both computers—the MacBook
is the execution device for the larger workload, not a separate code branch.

The unit catalogue is now confirmed, but physical distribution and event-rate
calibration still require human review. Run a short v1.1.5 pilot first, inspect
its reports, and only then execute the larger MacBook candidate and decide whether
the dataset can be frozen.

## Cross-platform publisher lock v1.1.7

### Implemented

- Lazy native-module loading behind typed Windows and POSIX lock protocols
- Preserved `msvcrt.locking` byte-range behavior on Windows
- Preserved non-blocking `fcntl.flock` behavior on macOS and Linux
- One host-independent regression test covering acquire and release on both APIs
- Release type checks for `win32`, `darwin`, and `linux`
- Cache-safe validation commands for a read-only server deployment

### New

| File | Purpose |
|------|---------|
| `src/mtex_pdm/mqtt_publisher.py` | Typed lazy boundary for the two native state-file lock APIs |
| `tests/test_mqtt_publisher.py` | Cross-platform adapter regression independent of the test host |
| `README.md` | Native Linux prerequisite, portability gate, and immutable-checkout commands |

### Why

- Allow strict mypy validation of one source tree on Windows, macOS, and Linux
- Keep the runtime lock native to each operating system without importing an unavailable module
- Preserve single-process checkpoint ownership before starting the server warm-up
- Avoid weakening `/opt` permissions or running validation tools as `root` only to create caches

### Technical boundary

The publisher still holds one advisory lock for the full lifetime of a process,
so two processes cannot advance the same state file concurrently. Version 1.1.7
places the two native implementations behind one typed lazy-loading boundary:

| Platform | Native API | Preserved behavior |
|----------|------------|--------------------|
| Windows | `msvcrt.locking` | Non-blocking one-byte lock with an initialized marker byte |
| macOS | `fcntl.flock` | Non-blocking exclusive advisory lock |
| Linux | `fcntl.flock` | Non-blocking exclusive advisory lock |

Only the module for the running platform is imported. This keeps runtime behavior
native while preventing POSIX mypy runs from checking unavailable Windows-only
members. The focused regression test drives both adapters with controlled native
API substitutes, independent of the host used to run pytest.

The release portability gate checks the production source explicitly for all
three targets:

```bash
python -m mypy --platform win32 --cache-dir .mypy_cache/win32 src
python -m mypy --platform darwin --cache-dir .mypy_cache/darwin src
python -m mypy --platform linux --cache-dir .mypy_cache/linux src
```

These checks supplement, rather than replace, the full pytest, Ruff, format, and
native-host mypy runs. MQTT payloads, settings, state schema, checkpoint ordering,
failure replay, and ground-truth boundaries are unchanged from v1.1.6.

## Prospective MQTT Publisher v1.1.6

Implementation E turns the existing causal generator into a wall-clock publisher
for prospective synthetic machines. It deliberately does not replay a historical
Parquet dataset: every batch advances each local machine by one new simulation
step, renders a current TPPPS4 snapshot, publishes the full batch, and only then
persists the continuation state. These machines therefore belong exclusively to
the `mqtt_prospective` boundary and must never be included in historical training
splits.

### Frozen operating profiles

| Profile | YAML mode | Batch interval | Intended use |
|---------|-----------|----------------|--------------|
| Continuous warm-up | `mqtt_continuous` | 60 seconds | Multi-hour/day prospective collection after portal provisioning |
| Bounded demonstration | `mqtt_demonstration` | 8 seconds | Short observable integration demonstration |

Both profiles require four to six distinct machine IDs and one authorised
prospective scenario per machine. `--max-ticks` limits either profile to an exact
number of complete batches; omitting it runs until `Ctrl+C`. A normal stop occurs
after the current complete batch and leaves the last checkpoint available for
resume.

Copy `examples/mqtt/prospective.example.yaml` to a local, deployment-specific
settings file. Replace the six placeholder device IDs with IDs provisioned in the
portal and verify the broker/TLS options. Keep the chosen machine IDs, scenarios,
master seed, mode, and cadence frozen for an evaluation run. The publisher refuses
to resume an existing state file if any of those simulation-defining settings
change; use a reviewed new settings/state pair for a genuinely new experiment.

### MQTT contract

One simulation tick normally produces one complete logical snapshot per machine:

| Property | Contract |
|----------|----------|
| Topic | `<device-id>/state/<attribute>` |
| Source attributes | Exactly the 105 names and catalogue order in `config/tppps4_telemetry_catalog.json` |
| Delivery | MQTT 3.1.1, QoS `0`, `retain=false` |
| Scalar payload | JSON number |
| Maintenance-counter payload | JSON object `{"maximum": number, "value": number}` |
| `iamalive` payload | JSON string using Europe/Lisbon local wall time: `YYYY-MM-DD HH:MM:SS` |
| `machine_status` | One of the 25 authorised integer codes |

The 16 selected source attributes are advanced dynamically by the v1.1.5 causal
engine. The four selected counter maxima come from the authorised catalogue. The
remaining 89 source attributes are emitted as type-correct neutral compatibility
values (`0`, `0.0`, or a bounded object with `value: 0`); they preserve the current
105-topic device contract but are not calibrated predictive signals. They must not
be described as realistic degradation trajectories in the thesis. Source fields
declared as integers are serialized as JSON integers; this includes copy counters
whose internal 60-second simulation increment can be fractional.

The `prospective_telemetry_gap` scenario is the deliberate exception to a snapshot
on every tick. During its configured gap phase, that machine emits no partial
snapshot—zero of its topics are published—while the other machines still emit
complete 105-message snapshots. Advancing the local checkpoint in this case
records an intentional simulated absence, not a partially published machine.

The publisher never places the scenario name, master/machine seed, hidden wear,
health score, event ID, due date, scheduled/performed maintenance date, reset
marker, or future label on MQTT. `iamalive` indicates the synthetic publisher's
current connectivity only; it is not a simulated historical measurement time.
Ground truth stays in the local state/evaluation boundary.

### Safe dry-run

Run this before any broker or portal operation:

```bash
python -m mtex_pdm mqtt-publish \
  --settings examples/mqtt/prospective.example.yaml \
  --dry-run \
  --max-ticks 1 \
  --json
```

With the six-machine example, the expected report is healthy with
`machine_count: 6`, `attribute_count: 105`, `batch_count: 1`,
`message_count: 630`, `ground_truth_event_count: 0`, and `resumed: false`.
Dry-run validates and renders all messages but opens no network connection,
sleeps for no wall-clock interval, and neither creates nor advances the state
file. Omitting `--max-ticks` in dry-run still performs only one safe batch.

### State, restart, and failure boundary

The local JSON state contains the full synthetic checkpoint, including hidden
component state, RNG continuation, and an append-only in-state audit trail of
ground-truth maintenance markers. It therefore belongs below ignored `ml/data/`,
must not be published, copied into the portal, or committed, and is created with
owner-only permissions on POSIX systems where supported. A sibling lock file
prevents two publisher processes from advancing the same state.

Before the first network connection, the publisher atomically writes a zero-batch
initial checkpoint. Subsequent state is written through a temporary file and
atomic replacement only after all messages for every emitted snapshot have
completed publication. If a process fails partway through a QoS-0 batch, the
persisted state does not advance; on restart, that exact logical batch may be
replayed, but the publisher does not silently skip the failed simulation step.
The audit trail retains event ID, kind, machine, component, scenario, occurrence,
due time, and severity locally after resets. MQTT QoS 0 does not guarantee broker
delivery, and this local checkpoint is not an end-to-end transaction across MQTT,
IoT Agent, Orion, QuantumLeap, and CrateDB.

### Credentials and network execution

Username and password values are read from the environment-variable names in the
settings file; no secret value belongs in YAML, Git, command history, or logs.
Enable TLS and set `ca_file` for a TLS broker. The transport uses bounded connect
and publish waits plus MQTT reconnection delays, and fails instead of advancing
state when a connection/publication operation is not confirmed locally.

Only after the machine IDs and attributes are provisioned and the company has
approved the broker endpoint should a one-batch network test be run:

```bash
read -r -p 'MQTT username: ' MTEX_PDM_MQTT_USERNAME
read -r -s -p 'MQTT password: ' MTEX_PDM_MQTT_PASSWORD && printf '\n'
export MTEX_PDM_MQTT_USERNAME MTEX_PDM_MQTT_PASSWORD
python -m mtex_pdm mqtt-publish \
  --settings path/to/reviewed-prospective.yaml \
  --max-ticks 1 \
  --json
```

After verifying the complete 105-attribute snapshots downstream, continuous
warm-up is the same command without `--max-ticks`. Detailed server service,
restart policy, logs, resource limits, and downstream verification steps are a
separate deployment procedure to perform after this implementation is committed
and the company-side prerequisites are known.

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

On Ubuntu or Debian, install the native OpenMP runtime required by LightGBM
before running the environment smoke test:

```bash
sudo apt update
sudo apt install -y libgomp1
```

This operating-system library is intentionally outside `requirements.lock`; the
training Dockerfile installs the same package in its Linux image. It is not an
extra installation step on Windows or macOS.

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

# Generate the default three-machine draft pilot (requires a real Git SHA)
python -m mtex_pdm dataset-generate-pilot --output-root data/pilots \
  --dataset-id synthetic-pilot-v1 --code-commit <real-git-sha> \
  --start-date 2026-01-01 --days 7 --created-at 2026-08-12T12:00:00Z

# Verify checksums, schemas, partitions, counts, manifest, configs, and report
python -m mtex_pdm dataset-check data/pilots/synthetic-pilot-v1

# Analyze an existing verified pilot without modifying it
python -m mtex_pdm pilot-analyze data/pilots/synthetic-pilot-v1 \
  --analysis-root reports/pilots \
  --reference-snapshot examples/pilot/real_machine_snapshot.example.json

# Verify analysis integrity and source-dataset lineage
python -m mtex_pdm pilot-analysis-check \
  reports/pilots/synthetic-pilot-v1-analysis \
  --dataset-path data/pilots/synthetic-pilot-v1

# Or run generation, verification, profiling, and scale decision together
python -m mtex_pdm pilot-run --output-root data/pilots \
  --analysis-root reports/pilots --dataset-id synthetic-pilot-v2 \
  --code-commit <real-git-sha> --start-date 2026-01-01 --days 7 \
  --created-at 2026-08-13T08:00:00Z \
  --reference-snapshot examples/pilot/real_machine_snapshot.example.json

# Render and validate one six-machine MQTT batch without network or state writes
python -m mtex_pdm mqtt-publish \
  --settings examples/mqtt/prospective.example.yaml \
  --dry-run --max-ticks 1 --json

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

For an immutable server checkout owned by `root`, run the verification tools as
the normal deployment user while redirecting or disabling their caches:

```bash
python -m pytest -q -p no:cacheprovider
python -m ruff check --no-cache .
python -m ruff format --check --no-cache .
python -m mypy --cache-dir /tmp/mtex-pdm-mypy-cache
```

Do not use `sudo` for these checks and do not make the application tree writable
just to store disposable tool caches.

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
docker build --file Dockerfile.training --tag mtex-pdm-training:1.1.7 .
docker run --rm --cpus 2 --memory 4g mtex-pdm-training:1.1.7
docker run --rm mtex-pdm-training:1.1.7 components-check --json
```

The image defaults to the full `environment-check`. Its entry point is
`mtex-pdm`, so an explicit entry-point override is required to run development
tools:

```bash
docker run --rm --entrypoint python mtex-pdm-training:1.1.7 -m pytest
```

### Device-specific builds

On the M1 Pro MacBook:

```bash
docker buildx build \
  --platform linux/arm64 \
  --load \
  --file Dockerfile.training \
  --tag mtex-pdm-training:1.1.7-arm64 \
  .
```

On the x86-64 home server:

```bash
docker buildx build \
  --platform linux/amd64 \
  --load \
  --file Dockerfile.training \
  --tag mtex-pdm-training:1.1.7-amd64 \
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
  leakage exclusions, TPPPS4 catalogue selection, and deferred-pressure boundary.
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
- Independent dataset verifier and configurable pilot-generation commands.
- Read-only numerical/cadence profiling globally, by machine, and by scenario.
- Independent-event, censorship, intervention-delay, and preliminary 24 h/168 h prevalence reports.
- Conservative scale recommendation against the frozen machine/day/event targets.
- Atomic, checksummed analysis packages with optional source-dataset lineage verification.
- Authorised 105-attribute TPPPS4 multipass source catalogue with confirmed metadata.
- Strict 25-code categorical machine-status dictionary and 20-field predictive telemetry contract.
- Persistent prospective publisher for four to six machines with 60-second continuous and 8-second demonstration profiles.
- Exact 105-topic TPPPS4 rendering with QoS 0, retention disabled, and hidden/ground-truth fields excluded.
- Safe no-network dry-run, bounded publication, process locking, atomic checkpointing, and deterministic restart continuation.
- MQTT 3.1.1 transport with optional TLS, environment-only credentials, bounded waits, and reconnect delays.
- Byte-identical repeat/checkpoint-resume tests plus semantic integrity gates.
- Parquet and LightGBM smoke tests.
- Reproducible, non-root ARM64/x86-64 Docker build.
- Conservative default thread use and documented launch-time device limits.

Intentionally deferred to the next targets:

- Human review and versioned freeze of pilot physical ranges and degradation rates.
- Review and final freeze decision for the regenerated v1.1.5 MacBook scale evidence.
- Full 12-machine × 180-day dataset after unit/parameter review and freeze.
- Complete dataset/event-volume reproducibility gate, labels, feature computation,
  training, and inference.
- Company-side machine registration, reviewed deployment settings, server service,
  downstream verification, and prospective MQTT warm-up/soak operation.
- Read-only enterprise CrateDB export.
- FIWARE prediction persistence and portal integration.
