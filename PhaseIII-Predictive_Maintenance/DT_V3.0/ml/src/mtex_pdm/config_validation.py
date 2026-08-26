"""Validation of the frozen predictive-maintenance MVP configuration."""

from __future__ import annotations

import hashlib
import os
import re
from collections.abc import Mapping
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any, cast

import yaml

CONFIG_VERSION = "1.1.0"
CONFIG_FILENAMES = (
    "components.yaml",
    "decision_policy.yaml",
    "mvp.yaml",
    "scenarios.yaml",
    "tppps4_telemetry_catalog.json",
)
COMPONENT_KEYS = (
    "print_bar_calendar",
    "print_bar_distance",
    "transport_vacuum_filter",
    "supply_pump_color_1",
)
HORIZONS_HOURS = (24, 168)
_CHECKSUM_LINE = re.compile(r"^(?P<digest>[0-9a-f]{64})  (?P<filename>[A-Za-z0-9_.-]+)$")
_SECRET_ASSIGNMENT = re.compile(
    r"(?im)^\s*(?:api[_-]?key|access[_-]?token|client[_-]?secret|password)\s*:"
)


class ConfigValidationError(ValueError):
    """Raised when the frozen configuration no longer satisfies its contract."""


@dataclass(frozen=True, slots=True)
class FrozenConfigReport:
    """Small, serializable summary of the validated MVP contract."""

    config_directory: str
    config_version: str
    component_count: int
    component_keys: tuple[str, ...]
    horizons_hours: tuple[int, ...]
    checked_files: tuple[str, ...]
    checksum_algorithm: str = "sha256"
    frozen: bool = True

    def to_dict(self) -> dict[str, Any]:
        """Return a JSON-compatible representation."""

        result = asdict(self)
        result["component_keys"] = list(self.component_keys)
        result["horizons_hours"] = list(self.horizons_hours)
        result["checked_files"] = list(self.checked_files)
        return result


def discover_config_directory(explicit_path: str | Path | None = None) -> Path:
    """Find the configuration directory without depending on one launch directory."""

    if explicit_path is not None:
        candidates = [Path(explicit_path)]
    elif configured_path := os.getenv("MTEX_PDM_CONFIG_DIR"):
        candidates = [Path(configured_path)]
    else:
        source_root = Path(__file__).resolve().parents[2]
        candidates = [
            Path.cwd() / "config",
            Path.cwd() / "ml" / "config",
            source_root / "config",
        ]

    for candidate in candidates:
        resolved = candidate.expanduser().resolve()
        if (resolved / "checksums.sha256").is_file():
            return resolved

    rendered_candidates = ", ".join(str(candidate) for candidate in candidates)
    raise ConfigValidationError(
        "frozen configuration not found; checked: "
        f"{rendered_candidates}. Pass --config-dir or set MTEX_PDM_CONFIG_DIR."
    )


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _read_checksum_manifest(config_directory: Path) -> dict[str, str]:
    manifest_path = config_directory / "checksums.sha256"
    if not manifest_path.is_file():
        raise ConfigValidationError(f"checksum manifest not found: {manifest_path}")

    entries: dict[str, str] = {}
    for line_number, raw_line in enumerate(
        manifest_path.read_text(encoding="utf-8").splitlines(),
        start=1,
    ):
        line = raw_line.strip()
        if not line:
            continue
        match = _CHECKSUM_LINE.fullmatch(line)
        if match is None:
            raise ConfigValidationError(
                f"invalid checksum manifest line {line_number}: {raw_line!r}"
            )
        filename = match.group("filename")
        if filename in entries:
            raise ConfigValidationError(f"duplicate checksum entry: {filename}")
        entries[filename] = match.group("digest")

    expected = set(CONFIG_FILENAMES)
    actual = set(entries)
    if actual != expected:
        missing = sorted(expected - actual)
        unexpected = sorted(actual - expected)
        raise ConfigValidationError(
            f"checksum manifest file set mismatch; missing={missing}, unexpected={unexpected}"
        )
    return entries


def _verify_checksums(config_directory: Path) -> None:
    for filename, expected_digest in _read_checksum_manifest(config_directory).items():
        config_path = config_directory / filename
        if not config_path.is_file():
            raise ConfigValidationError(f"configuration file not found: {config_path}")
        actual_digest = _sha256(config_path)
        if actual_digest != expected_digest:
            raise ConfigValidationError(
                f"checksum mismatch for {filename}: "
                f"expected {expected_digest}, found {actual_digest}"
            )


def _load_mapping(path: Path) -> Mapping[str, Any]:
    raw_text = path.read_text(encoding="utf-8")
    if _SECRET_ASSIGNMENT.search(raw_text):
        raise ConfigValidationError(f"possible secret material found in {path.name}")
    loaded = yaml.safe_load(raw_text)
    if not isinstance(loaded, Mapping):
        raise ConfigValidationError(f"{path.name} must contain a YAML mapping")
    return cast(Mapping[str, Any], loaded)


def _require(condition: bool, message: str) -> None:
    if not condition:
        raise ConfigValidationError(message)


def _validate_semantics(configs: Mapping[str, Mapping[str, Any]]) -> None:
    for filename, config in configs.items():
        if filename == "tppps4_telemetry_catalog.json":
            continue
        _require(
            config.get("config_version") == CONFIG_VERSION,
            f"{filename} config_version must be {CONFIG_VERSION}",
        )

    mvp = configs["mvp.yaml"]
    components = configs["components.yaml"]
    scenarios = configs["scenarios.yaml"]
    decision_policy = configs["decision_policy.yaml"]
    catalog_payload = configs["tppps4_telemetry_catalog.json"]
    try:
        from mtex_pdm.telemetry_catalog import TelemetryCatalog

        TelemetryCatalog.model_validate(catalog_payload)
    except ValueError as error:
        raise ConfigValidationError(f"invalid TPPPS4 catalog: {error}") from error

    freeze = cast(Mapping[str, Any], mvp.get("freeze", {}))
    _require(freeze.get("status") == "frozen", "mvp.yaml freeze.status must be frozen")

    objective = cast(Mapping[str, Any], mvp.get("objective", {}))
    _require(
        objective.get("probability_name") == "maintenanceNeedProbability",
        "mvp.yaml must preserve the maintenanceNeedProbability objective",
    )

    configured_components = cast(Mapping[str, Any], components.get("components", {}))
    _require(
        tuple(configured_components) == COMPONENT_KEYS,
        "components.yaml must preserve the four canonical component keys and order",
    )

    time_contract = cast(Mapping[str, Any], mvp.get("time_contract", {}))
    configured_horizons = cast(list[Mapping[str, Any]], time_contract.get("horizons", []))
    mvp_horizons = tuple(item.get("hours") for item in configured_horizons)
    _require(
        mvp_horizons == HORIZONS_HOURS,
        "mvp.yaml horizons must remain 24 and 168 hours",
    )

    prediction = cast(Mapping[str, Any], decision_policy.get("prediction", {}))
    decision_horizons = tuple(prediction.get("horizons_hours", []))
    _require(
        decision_horizons == HORIZONS_HOURS,
        "decision_policy.yaml horizons must remain 24 and 168 hours",
    )

    thresholds = cast(Mapping[str, Any], decision_policy.get("threshold_selection", {}))
    _require(
        thresholds.get("source_split") == "validation",
        "thresholds must be selected from the validation split",
    )
    _require(
        thresholds.get("threshold_24h") is None and thresholds.get("threshold_7d") is None,
        "decision thresholds must remain unset before validation",
    )
    _require(
        thresholds.get("test_data_may_select_thresholds") is False,
        "test data must not select decision thresholds",
    )

    historical_split = cast(Mapping[str, Any], scenarios.get("historical_split", {}))
    split_counts = tuple(
        cast(Mapping[str, Any], historical_split.get(split_name, {})).get("machine_count")
        for split_name in ("train", "validation", "test")
    )
    _require(
        split_counts == (7, 2, 3),
        "historical machine split must remain 7 train, 2 validation, and 3 test",
    )

    feature_exclusions = set(cast(list[str], components.get("feature_exclusions", [])))
    _require(
        {
            "machine_id",
            "simulator_seed",
            "hidden_degradation",
            "label",
        }.issubset(feature_exclusions),
        "components.yaml is missing mandatory leakage exclusions",
    )


def validate_frozen_config(
    config_directory: str | Path | None = None,
) -> FrozenConfigReport:
    """Verify file integrity and the critical cross-file MVP invariants."""

    resolved_directory = discover_config_directory(config_directory)
    _verify_checksums(resolved_directory)
    configs = {
        filename: _load_mapping(resolved_directory / filename) for filename in CONFIG_FILENAMES
    }
    _validate_semantics(configs)

    return FrozenConfigReport(
        config_directory=str(resolved_directory),
        config_version=CONFIG_VERSION,
        component_count=len(COMPONENT_KEYS),
        component_keys=COMPONENT_KEYS,
        horizons_hours=HORIZONS_HOURS,
        checked_files=CONFIG_FILENAMES,
    )
