from __future__ import annotations

import json
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from mtex_pdm import __version__
from mtex_pdm.config_validation import ConfigValidationError, validate_frozen_config
from mtex_pdm.environment import (
    collect_environment_report,
    lightgbm_smoke_test,
    parquet_smoke_test,
)

ML_ROOT = Path(__file__).resolve().parents[1]
CONFIG_DIR = ML_ROOT / "config"


class FrozenConfigTests(unittest.TestCase):
    def test_frozen_configuration_is_valid(self) -> None:
        report = validate_frozen_config(CONFIG_DIR)

        self.assertEqual(report.config_version, "1.0.0")
        self.assertEqual(report.component_count, 4)
        self.assertEqual(report.horizons_hours, (24, 168))
        self.assertEqual(
            report.checked_files,
            (
                "components.yaml",
                "decision_policy.yaml",
                "mvp.yaml",
                "scenarios.yaml",
            ),
        )

    def test_changed_configuration_is_rejected_by_checksum(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            copied_config = Path(temporary_directory) / "config"
            shutil.copytree(CONFIG_DIR, copied_config)
            mvp_path = copied_config / "mvp.yaml"
            mvp_path.write_text(
                mvp_path.read_text(encoding="utf-8") + "\n# unversioned change\n",
                encoding="utf-8",
            )

            with self.assertRaisesRegex(
                ConfigValidationError,
                "checksum mismatch.*mvp.yaml",
            ):
                validate_frozen_config(copied_config)


class EnvironmentTests(unittest.TestCase):
    def test_package_version_matches_release(self) -> None:
        self.assertEqual(__version__, "1.1.2")

    def test_parquet_round_trip(self) -> None:
        result = parquet_smoke_test()

        self.assertEqual(result["rows"], 3)
        self.assertEqual(result["component"], "print_bar_calendar")

    def test_lightgbm_can_fit_and_score(self) -> None:
        result = lightgbm_smoke_test()

        self.assertGreaterEqual(result["minimum_probability"], 0.0)
        self.assertLessEqual(result["maximum_probability"], 1.0)
        self.assertEqual(result["rows"], 8)

    def test_environment_report_is_healthy(self) -> None:
        report = collect_environment_report(CONFIG_DIR, run_smoke_tests=True)

        self.assertTrue(report["healthy"])
        self.assertEqual(report["python"]["required"], ">=3.12,<3.13")
        self.assertIn(report["platform"]["architecture"], {"arm64", "x86_64"})
        self.assertEqual(report["config"]["component_count"], 4)
        self.assertEqual(report["config"]["horizons_hours"], [24, 168])
        self.assertEqual(report["smoke_tests"]["parquet"]["rows"], 3)
        self.assertEqual(report["smoke_tests"]["lightgbm"]["rows"], 8)

    def test_native_smoke_tests_are_skipped_when_dependency_contract_fails(self) -> None:
        with (
            patch(
                "mtex_pdm.environment._dependency_versions",
                return_value=({}, ["lightgbm"], []),
            ),
            patch("mtex_pdm.environment.parquet_smoke_test") as parquet_check,
            patch("mtex_pdm.environment.lightgbm_smoke_test") as lightgbm_check,
        ):
            report = collect_environment_report(CONFIG_DIR, run_smoke_tests=True)

        self.assertFalse(report["healthy"])
        self.assertIn("lightgbm", report["dependencies"]["missing"])
        self.assertEqual(
            report["smoke_tests"]["skipped"]["reason"],
            "dependency contract failed before native smoke tests",
        )
        parquet_check.assert_not_called()
        lightgbm_check.assert_not_called()

    def test_module_cli_returns_json_report(self) -> None:
        process = subprocess.run(
            [
                sys.executable,
                "-m",
                "mtex_pdm",
                "config-check",
                "--config-dir",
                str(CONFIG_DIR),
                "--json",
            ],
            cwd=ML_ROOT,
            check=False,
            capture_output=True,
            text=True,
        )

        self.assertEqual(process.returncode, 0, process.stderr)
        report = json.loads(process.stdout)
        self.assertTrue(report["healthy"])
        self.assertEqual(report["config_version"], "1.0.0")


if __name__ == "__main__":
    unittest.main()
