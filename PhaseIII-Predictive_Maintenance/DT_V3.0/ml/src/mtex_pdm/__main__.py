"""Command-line entry point for ML configuration and contract diagnostics."""

from __future__ import annotations

import argparse
import json
import os
import sys
from collections.abc import Sequence
from datetime import date, datetime
from pathlib import Path
from typing import Any

from mtex_pdm import __version__
from mtex_pdm.component_registry import collect_component_registry_report
from mtex_pdm.config_validation import ConfigValidationError, validate_frozen_config
from mtex_pdm.contracts import validate_contract_bundle, write_contract_schemas
from mtex_pdm.environment import collect_environment_report
from mtex_pdm.generator import generate_pilot_dataset, verify_dataset


def _add_config_directory(parser: argparse.ArgumentParser) -> None:
    parser.add_argument(
        "--config-dir",
        type=Path,
        help="Path to ml/config; otherwise auto-discovered or read from MTEX_PDM_CONFIG_DIR.",
    )
    parser.add_argument(
        "--json",
        action="store_true",
        help="Emit compact JSON instead of indented JSON.",
    )


def _default_ml_directory(name: str, environment_variable: str) -> Path:
    configured = os.environ.get(environment_variable)
    if configured:
        return Path(configured)
    return Path(__file__).resolve().parents[2] / name


def build_parser() -> argparse.ArgumentParser:
    """Build the public diagnostic command interface."""

    parser = argparse.ArgumentParser(
        prog="mtex-pdm",
        description="MTEX predictive-maintenance configuration and environment diagnostics.",
    )
    parser.add_argument(
        "--version",
        action="version",
        version=f"mtex-pdm {__version__}",
    )
    subparsers = parser.add_subparsers(dest="command", required=True)

    config_parser = subparsers.add_parser(
        "config-check",
        help="Validate frozen YAML checksums and critical cross-file invariants.",
    )
    _add_config_directory(config_parser)

    components_parser = subparsers.add_parser(
        "components-check",
        help="Validate and summarize the four-component operational registry.",
    )
    _add_config_directory(components_parser)

    environment_parser = subparsers.add_parser(
        "environment-check",
        help="Validate Python, architecture, dependencies, config, Parquet, and LightGBM.",
    )
    _add_config_directory(environment_parser)
    environment_parser.add_argument(
        "--skip-smoke-tests",
        action="store_true",
        help="Skip the Parquet round-trip and tiny LightGBM fit.",
    )

    contracts_parser = subparsers.add_parser(
        "contracts-check",
        help="Validate generated schemas, examples, and an optional CrateDB snapshot.",
    )
    contracts_parser.add_argument(
        "--schemas-dir",
        type=Path,
        default=_default_ml_directory("schemas", "MTEX_PDM_SCHEMAS_DIR"),
        help="Generated schema directory; defaults to ml/schemas.",
    )
    contracts_parser.add_argument(
        "--examples-dir",
        type=Path,
        default=_default_ml_directory("examples/contracts", "MTEX_PDM_EXAMPLES_DIR"),
        help="Valid contract examples; defaults to ml/examples/contracts.",
    )
    contracts_parser.add_argument(
        "--crate-schema",
        type=Path,
        help="Optional JSON snapshot of the enterprise CrateDB table schema.",
    )
    contracts_parser.add_argument(
        "--json",
        action="store_true",
        help="Emit compact JSON instead of indented JSON.",
    )

    export_parser = subparsers.add_parser(
        "contracts-export",
        help="Regenerate JSON and Arrow schema descriptors with checksums.",
    )
    export_parser.add_argument(
        "--output-dir",
        type=Path,
        default=_default_ml_directory("schemas", "MTEX_PDM_SCHEMAS_DIR"),
        help="Output directory; defaults to ml/schemas.",
    )

    dataset_parser = subparsers.add_parser(
        "dataset-check",
        help="Verify dataset checksums, contracts, schemas, partitions, and counts.",
    )
    dataset_parser.add_argument("dataset_path", type=Path, help="Published dataset directory.")
    dataset_parser.add_argument(
        "--json",
        action="store_true",
        help="Emit compact JSON instead of indented JSON.",
    )

    pilot_parser = subparsers.add_parser(
        "dataset-generate-pilot",
        help="Generate the deterministic three-machine draft pilot dataset.",
    )
    pilot_parser.add_argument("--output-root", type=Path, required=True)
    pilot_parser.add_argument("--dataset-id", required=True)
    pilot_parser.add_argument("--code-commit", required=True)
    pilot_parser.add_argument("--start-date", type=date.fromisoformat, required=True)
    pilot_parser.add_argument("--days", type=int, default=7)
    pilot_parser.add_argument("--created-at", type=datetime.fromisoformat, required=True)
    pilot_parser.add_argument("--master-seed", type=int, default=20260729)
    _add_config_directory(pilot_parser)
    export_parser.add_argument(
        "--json",
        action="store_true",
        help="Emit compact JSON instead of indented JSON.",
    )

    return parser


def _render(report: dict[str, Any], compact: bool) -> str:
    return json.dumps(
        report,
        indent=None if compact else 2,
        sort_keys=True,
    )


def main(argv: Sequence[str] | None = None) -> int:
    """Run one diagnostic command and return a process exit code."""

    parser = build_parser()
    arguments = parser.parse_args(argv)

    try:
        if arguments.command == "config-check":
            config_report = validate_frozen_config(arguments.config_dir)
            report = {"healthy": True, **config_report.to_dict()}
        elif arguments.command == "components-check":
            report = collect_component_registry_report(arguments.config_dir)
        elif arguments.command == "environment-check":
            report = collect_environment_report(
                arguments.config_dir,
                run_smoke_tests=not arguments.skip_smoke_tests,
            )
        elif arguments.command == "contracts-check":
            report = validate_contract_bundle(
                schemas_dir=arguments.schemas_dir,
                examples_dir=arguments.examples_dir,
                crate_schema_path=arguments.crate_schema,
            )
        elif arguments.command == "dataset-check":
            verification = verify_dataset(arguments.dataset_path)
            report = {
                "healthy": verification.healthy,
                "dataset_id": verification.dataset_id,
                "checked_file_count": verification.checked_file_count,
                "telemetry_row_count": verification.telemetry_row_count,
                "maintenance_event_count": verification.maintenance_event_count,
                "errors": list(verification.errors),
            }
        elif arguments.command == "dataset-generate-pilot":
            receipt = generate_pilot_dataset(
                output_root=arguments.output_root,
                dataset_id=arguments.dataset_id,
                code_commit=arguments.code_commit,
                start_date=arguments.start_date,
                days=arguments.days,
                created_at=arguments.created_at,
                config_directory=(
                    arguments.config_dir or _default_ml_directory("config", "MTEX_PDM_CONFIG_DIR")
                ),
                master_seed=arguments.master_seed,
            )
            report = {
                "healthy": True,
                "dataset_id": receipt.manifest.dataset_id,
                "dataset_path": str(receipt.dataset_path.resolve()),
                "status": receipt.manifest.status.value,
                "machine_count": sum(
                    len(summary.machine_ids) for summary in receipt.manifest.splits.values()
                ),
                "telemetry_row_count": receipt.report["telemetry_row_count"],
                "maintenance_event_count": receipt.report["maintenance_event_count"],
            }
        else:
            written = write_contract_schemas(arguments.output_dir)
            report = {
                "healthy": True,
                "contract_version": "1.0.0",
                "output_directory": str(arguments.output_dir.resolve()),
                "written": list(written),
            }
    except (ConfigValidationError, ImportError, OSError, RuntimeError, ValueError) as error:
        print(f"mtex-pdm check failed: {error}", file=sys.stderr)
        return 1

    print(_render(report, arguments.json))
    return 0 if report["healthy"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
