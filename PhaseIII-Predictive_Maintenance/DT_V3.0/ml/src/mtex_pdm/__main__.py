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
from mtex_pdm.contracts import CONTRACT_VERSION, validate_contract_bundle, write_contract_schemas
from mtex_pdm.environment import collect_environment_report
from mtex_pdm.generator import DatasetGenerationReceipt, generate_pilot_dataset, verify_dataset
from mtex_pdm.mqtt_publisher import (
    DryRunMqttTransport,
    PahoMqttTransport,
    ProspectivePublisher,
    ProspectivePublisherSettings,
)
from mtex_pdm.pilot_analysis import analyze_pilot_dataset, verify_pilot_analysis


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
    source_layout_candidate = Path(__file__).resolve().parents[2] / name
    if source_layout_candidate.exists():
        return source_layout_candidate
    working_directory_candidate = Path.cwd() / name
    if working_directory_candidate.exists():
        return working_directory_candidate
    return source_layout_candidate


def _add_pilot_generation_arguments(parser: argparse.ArgumentParser) -> None:
    parser.add_argument("--output-root", type=Path, required=True)
    parser.add_argument("--dataset-id", required=True)
    parser.add_argument("--code-commit", required=True)
    parser.add_argument("--start-date", type=date.fromisoformat, required=True)
    parser.add_argument("--days", type=int, default=7)
    parser.add_argument("--created-at", type=datetime.fromisoformat, required=True)
    parser.add_argument("--master-seed", type=int, default=20260729)
    parser.add_argument("--train-machines", type=int, default=1)
    parser.add_argument("--validation-machines", type=int, default=1)
    parser.add_argument("--test-machines", type=int, default=1)


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
    _add_config_directory(contracts_parser)
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
        help="Generate a deterministic configurable draft pilot dataset.",
    )
    _add_pilot_generation_arguments(pilot_parser)
    _add_config_directory(pilot_parser)

    analysis_parser = subparsers.add_parser(
        "pilot-analyze",
        help="Profile a verified draft dataset and recommend scale without modifying it.",
    )
    analysis_parser.add_argument("dataset_path", type=Path)
    analysis_parser.add_argument("--analysis-root", type=Path, required=True)
    analysis_parser.add_argument("--reference-snapshot", type=Path)
    analysis_parser.add_argument("--json", action="store_true")

    analysis_check_parser = subparsers.add_parser(
        "pilot-analysis-check",
        help="Verify analysis checksums, report agreement, and optional dataset lineage.",
    )
    analysis_check_parser.add_argument("analysis_path", type=Path)
    analysis_check_parser.add_argument("--dataset-path", type=Path)
    analysis_check_parser.add_argument("--json", action="store_true")

    run_parser = subparsers.add_parser(
        "pilot-run",
        help="Generate, verify, profile, and assess one draft pilot experiment.",
    )
    _add_pilot_generation_arguments(run_parser)
    run_parser.add_argument("--analysis-root", type=Path, required=True)
    run_parser.add_argument("--reference-snapshot", type=Path)
    _add_config_directory(run_parser)

    mqtt_parser = subparsers.add_parser(
        "mqtt-publish",
        help="Publish persistent prospective TPPPS4 telemetry to MQTT.",
    )
    mqtt_parser.add_argument("--settings", type=Path, required=True)
    mqtt_parser.add_argument(
        "--max-ticks",
        type=int,
        help="Stop after this many batches; omit for continuous operation.",
    )
    mqtt_parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Render and validate one or more batches without network or state writes.",
    )
    _add_config_directory(mqtt_parser)
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


def _generate_pilot_from_arguments(arguments: argparse.Namespace) -> DatasetGenerationReceipt:
    return generate_pilot_dataset(
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
        train_machine_count=arguments.train_machines,
        validation_machine_count=arguments.validation_machines,
        test_machine_count=arguments.test_machines,
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
                config_directory=arguments.config_dir,
            )
        elif arguments.command == "dataset-check":
            dataset_verification = verify_dataset(arguments.dataset_path)
            report = {
                "healthy": dataset_verification.healthy,
                "dataset_id": dataset_verification.dataset_id,
                "checked_file_count": dataset_verification.checked_file_count,
                "telemetry_row_count": dataset_verification.telemetry_row_count,
                "maintenance_event_count": dataset_verification.maintenance_event_count,
                "errors": list(dataset_verification.errors),
            }
        elif arguments.command == "dataset-generate-pilot":
            receipt = _generate_pilot_from_arguments(arguments)
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
        elif arguments.command == "pilot-analyze":
            analysis = analyze_pilot_dataset(
                dataset_path=arguments.dataset_path,
                output_root=(arguments.analysis_root / f"{arguments.dataset_path.name}-analysis"),
                reference_path=arguments.reference_snapshot,
            )
            report = {
                "healthy": analysis.healthy,
                "dataset_id": analysis.profile["dataset_id"],
                "analysis_path": str(analysis.analysis_path.resolve()),
                "telemetry_row_count": analysis.profile["telemetry_row_count"],
                "maintenance_event_count": analysis.events["independent_event_count"],
                "scale_decision": analysis.scale_decision["decision"],
                "freeze_ready": analysis.scale_decision["freeze_ready"],
            }
        elif arguments.command == "pilot-analysis-check":
            analysis_verification = verify_pilot_analysis(
                arguments.analysis_path,
                dataset_path=arguments.dataset_path,
            )
            report = {
                "healthy": analysis_verification.healthy,
                "dataset_id": analysis_verification.dataset_id,
                "checked_file_count": analysis_verification.checked_file_count,
                "errors": list(analysis_verification.errors),
            }
        elif arguments.command == "pilot-run":
            receipt = _generate_pilot_from_arguments(arguments)
            analysis = analyze_pilot_dataset(
                dataset_path=receipt.dataset_path,
                output_root=arguments.analysis_root / f"{arguments.dataset_id}-analysis",
                reference_path=arguments.reference_snapshot,
            )
            report = {
                "healthy": analysis.healthy,
                "dataset_id": receipt.manifest.dataset_id,
                "dataset_path": str(receipt.dataset_path.resolve()),
                "analysis_path": str(analysis.analysis_path.resolve()),
                "status": receipt.manifest.status.value,
                "machine_count": analysis.profile["machine_count"],
                "telemetry_row_count": analysis.profile["telemetry_row_count"],
                "maintenance_event_count": analysis.events["independent_event_count"],
                "scale_decision": analysis.scale_decision["decision"],
                "freeze_ready": analysis.scale_decision["freeze_ready"],
            }
        elif arguments.command == "mqtt-publish":
            settings = ProspectivePublisherSettings.load(arguments.settings)
            dry_run = bool(arguments.dry_run)
            max_ticks = arguments.max_ticks
            if dry_run and max_ticks is None:
                max_ticks = 1
            transport = DryRunMqttTransport() if dry_run else PahoMqttTransport(settings.broker)

            def log_batch(batch_count: int, message_count: int) -> None:
                if not dry_run:
                    print(
                        f"mqtt batch {batch_count} complete: {message_count} messages",
                        file=sys.stderr,
                        flush=True,
                    )

            publisher_report = ProspectivePublisher(
                settings,
                config_directory=(
                    arguments.config_dir or _default_ml_directory("config", "MTEX_PDM_CONFIG_DIR")
                ),
                transport=transport,
                dry_run=dry_run,
                on_batch=log_batch,
            ).run(max_ticks=max_ticks)
            report = {
                "healthy": True,
                "dry_run": dry_run,
                "mode": publisher_report.mode.value,
                "machine_count": publisher_report.machine_count,
                "attribute_count": publisher_report.attribute_count,
                "batch_count": publisher_report.batch_count,
                "message_count": publisher_report.message_count,
                "ground_truth_event_count": publisher_report.ground_truth_event_count,
                "resumed": publisher_report.resumed,
                "state_path": str(publisher_report.state_path),
            }
        else:
            written = write_contract_schemas(arguments.output_dir)
            report = {
                "healthy": True,
                "contract_version": CONTRACT_VERSION,
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
