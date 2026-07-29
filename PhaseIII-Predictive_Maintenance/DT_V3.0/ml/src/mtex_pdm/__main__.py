"""Command-line entry point for environment and configuration diagnostics."""

from __future__ import annotations

import argparse
import json
import sys
from collections.abc import Sequence
from pathlib import Path
from typing import Any

from mtex_pdm import __version__
from mtex_pdm.config_validation import ConfigValidationError, validate_frozen_config
from mtex_pdm.environment import collect_environment_report


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


def build_parser() -> argparse.ArgumentParser:
    """Build the public diagnostic command interface."""

    parser = argparse.ArgumentParser(
        prog="mtex-pdm",
        description="MTEX predictive-maintenance environment diagnostics.",
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
        else:
            report = collect_environment_report(
                arguments.config_dir,
                run_smoke_tests=not arguments.skip_smoke_tests,
            )
    except (ConfigValidationError, ImportError, OSError, RuntimeError, ValueError) as error:
        print(f"mtex-pdm check failed: {error}", file=sys.stderr)
        return 1

    print(_render(report, arguments.json))
    return 0 if report["healthy"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
