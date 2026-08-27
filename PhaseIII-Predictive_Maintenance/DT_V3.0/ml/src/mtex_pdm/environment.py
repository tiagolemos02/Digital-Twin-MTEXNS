"""Runtime diagnostics for the predictive-maintenance Python environment."""

from __future__ import annotations

import platform
import sys
import tempfile
from importlib import metadata
from pathlib import Path
from typing import Any

from mtex_pdm import __version__
from mtex_pdm.config_validation import validate_frozen_config

PYTHON_REQUIREMENT = ">=3.12,<3.13"
EXPECTED_DEPENDENCIES = {
    "lightgbm": "4.7.0",
    "matplotlib": "3.11.1",
    "numpy": "2.4.6",
    "paho-mqtt": "2.1.0",
    "polars": "1.43.0",
    "pyarrow": "25.0.0",
    "pydantic": "2.13.4",
    "PyYAML": "6.0.3",
    "scikit-learn": "1.9.0",
    "shap": "0.52.0",
}
SUPPORTED_ARCHITECTURES = {"arm64", "x86_64"}


def normalize_architecture(machine: str) -> str:
    """Normalize platform-specific architecture names used by the two target devices."""

    normalized = machine.strip().lower().replace("-", "_")
    aliases = {
        "aarch64": "arm64",
        "arm64": "arm64",
        "amd64": "x86_64",
        "x64": "x86_64",
        "x86_64": "x86_64",
    }
    return aliases.get(normalized, normalized)


def _dependency_versions() -> tuple[dict[str, str], list[str], list[str]]:
    versions: dict[str, str] = {}
    missing: list[str] = []
    mismatched: list[str] = []

    for distribution, expected_version in EXPECTED_DEPENDENCIES.items():
        try:
            installed_version = metadata.version(distribution)
        except metadata.PackageNotFoundError:
            missing.append(distribution)
            continue
        versions[distribution] = installed_version
        if installed_version != expected_version:
            mismatched.append(
                f"{distribution}: expected {expected_version}, found {installed_version}"
            )

    return versions, missing, mismatched


def parquet_smoke_test() -> dict[str, Any]:
    """Write and read a tiny compressed Parquet dataset."""

    import pyarrow as pa
    import pyarrow.parquet as parquet

    table = pa.table(
        {
            "machine_id": ["smoke-01", "smoke-01", "smoke-01"],
            "component": ["print_bar_calendar"] * 3,
            "value": [10.0, 10.5, 11.0],
        }
    )
    with tempfile.TemporaryDirectory(prefix="mtex-pdm-parquet-") as directory:
        output_path = Path(directory) / "smoke.parquet"
        parquet.write_table(table, output_path, compression="zstd")
        restored = parquet.read_table(output_path)

    return {
        "healthy": restored.num_rows == 3,
        "rows": restored.num_rows,
        "component": restored.column("component")[0].as_py(),
        "compression": "zstd",
    }


def lightgbm_smoke_test() -> dict[str, Any]:
    """Fit and score a deterministic, tiny classifier using one CPU worker."""

    import lightgbm as lgb
    import numpy as np

    features = np.asarray(
        [
            [0.00, 0.10],
            [0.10, 0.20],
            [0.20, 0.10],
            [0.30, 0.25],
            [0.70, 0.75],
            [0.80, 0.70],
            [0.90, 0.85],
            [1.00, 0.90],
        ],
        dtype=np.float64,
    )
    labels = np.asarray([0, 0, 0, 0, 1, 1, 1, 1], dtype=np.int8)
    model = lgb.LGBMClassifier(
        n_estimators=5,
        num_leaves=3,
        min_child_samples=1,
        n_jobs=1,
        random_state=20260729,
        verbosity=-1,
    )
    model.fit(features, labels)
    probability_matrix = np.asarray(model.predict_proba(features), dtype=np.float64)
    probabilities = probability_matrix[:, 1]

    return {
        "healthy": bool(np.isfinite(probabilities).all()),
        "rows": int(probabilities.shape[0]),
        "minimum_probability": float(probabilities.min()),
        "maximum_probability": float(probabilities.max()),
        "workers": 1,
    }


def collect_environment_report(
    config_directory: str | Path | None = None,
    *,
    run_smoke_tests: bool = True,
) -> dict[str, Any]:
    """Collect dependency, architecture, configuration, and optional smoke-test results."""

    architecture = normalize_architecture(platform.machine())
    python_compatible = sys.version_info[:2] == (3, 12)
    dependency_versions, missing, mismatched = _dependency_versions()
    config_report = validate_frozen_config(config_directory)
    smoke_tests: dict[str, Any] = {}

    if run_smoke_tests and not missing and not mismatched:
        smoke_tests = {
            "parquet": parquet_smoke_test(),
            "lightgbm": lightgbm_smoke_test(),
        }
    elif run_smoke_tests:
        smoke_tests = {
            "skipped": {
                "healthy": False,
                "reason": "dependency contract failed before native smoke tests",
            }
        }

    smoke_healthy = all(bool(result.get("healthy")) for result in smoke_tests.values())
    healthy = (
        python_compatible
        and architecture in SUPPORTED_ARCHITECTURES
        and not missing
        and not mismatched
        and config_report.frozen
        and smoke_healthy
    )

    return {
        "healthy": healthy,
        "package_version": __version__,
        "python": {
            "version": platform.python_version(),
            "implementation": platform.python_implementation(),
            "required": PYTHON_REQUIREMENT,
            "compatible": python_compatible,
        },
        "platform": {
            "system": platform.system(),
            "architecture": architecture,
            "supported": architecture in SUPPORTED_ARCHITECTURES,
        },
        "dependencies": {
            "versions": dependency_versions,
            "missing": missing,
            "mismatched": mismatched,
        },
        "config": config_report.to_dict(),
        "smoke_tests": smoke_tests,
    }
