# MTEX Predictive-Maintenance Module

Version `1.0.1` prepares the reproducible Python and Docker environment for the
predictive-maintenance MVP. It validates the frozen v1.0.0 experimental contract,
the supported processor architecture, the exact Python dependencies, Parquet
input/output, and a minimal LightGBM fit before later implementation work uses
the environment.

This version is environment preparation only. It does not generate telemetry,
create labels or features, train the two production-candidate models, run
inference, query CrateDB, publish MQTT messages, write predictions to FIWARE, or
change the portal.

## Environment Contract

| Item | Frozen choice | Reason |
|------|---------------|--------|
| Python | CPython `>=3.12,<3.13` | One exact minor version across Windows, macOS ARM64, and Linux x86-64 |
| Container base | Official `python:3.12.13-slim-bookworm`, pinned by multi-platform digest | Repeatable ARM64 and x86-64 builds |
| Data frame and files | Polars, PyArrow, Parquet with Zstandard compression | Efficient time-series processing and portable columnar artifacts |
| Model stack | scikit-learn, LightGBM, SHAP, Matplotlib | Baselines, deployed candidate, offline explanations, and thesis figures |
| Configuration | PyYAML and Pydantic | Frozen YAML validation now and typed schemas in the next implementation target |
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
├── src/mtex_pdm/            # Diagnostic Python package
├── tests/                   # Environment and configuration contract tests
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

`--config-dir PATH` may be passed to either check. The alternative
`MTEX_PDM_CONFIG_DIR` environment variable is useful inside containers. No
credential or connection string belongs in the frozen YAML files.

## Docker

Build from `DT_V3.0/ml`. The build installs only packages accepted by the
hash-locked requirements file, installs the local package without resolving a
second dependency graph, validates the frozen configuration, and runs the test
suite. The final process uses a non-root user.

```bash
docker build --file Dockerfile.training --tag mtex-pdm-training:1.0.1 .
docker run --rm --cpus 2 --memory 4g mtex-pdm-training:1.0.1
docker run --rm mtex-pdm-training:1.0.1 config-check --json
```

The image defaults to the full `environment-check`. Its entry point is
`mtex-pdm`, so an explicit entry-point override is required to run development
tools:

```bash
docker run --rm --entrypoint python mtex-pdm-training:1.0.1 -m pytest
```

### Device-specific builds

On the M1 Pro MacBook:

```bash
docker buildx build \
  --platform linux/arm64 \
  --load \
  --file Dockerfile.training \
  --tag mtex-pdm-training:1.0.1-arm64 \
  .
```

On the x86-64 home server:

```bash
docker buildx build \
  --platform linux/amd64 \
  --load \
  --file Dockerfile.training \
  --tag mtex-pdm-training:1.0.1-amd64 \
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
- Parquet and LightGBM smoke tests.
- Reproducible, non-root ARM64/x86-64 Docker build.
- Conservative default thread use and documented launch-time device limits.

Intentionally deferred to the next targets:

- Typed data schemas and dataset manifests.
- Generator, feature, training, and inference component implementations.
- Machine registration and prospective MQTT scenarios.
- Read-only enterprise CrateDB export.
- FIWARE prediction persistence and portal integration.
