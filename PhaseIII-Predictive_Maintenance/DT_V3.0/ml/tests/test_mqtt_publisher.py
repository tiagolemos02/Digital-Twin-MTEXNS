from __future__ import annotations

import json
import subprocess
import sys
from collections.abc import Callable
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import pytest
import yaml
from pydantic import ValidationError

import mtex_pdm.mqtt_publisher as mqtt_publisher
from mtex_pdm.contracts import DatasetSplit, DataSource
from mtex_pdm.generator import NumericSignal, ObservableMachineState, TelemetrySnapshot
from mtex_pdm.mqtt_publisher import (
    MqttBrokerSettings,
    MqttMessage,
    PahoMqttTransport,
    ProspectivePublisher,
    ProspectivePublisherSettings,
    render_snapshot_messages,
)
from mtex_pdm.telemetry_catalog import load_telemetry_catalog

ML_ROOT = Path(__file__).resolve().parents[1]
CONFIG_DIR = ML_ROOT / "config"


class _RecordingTransport:
    def __init__(self, fail_at_message: int | None = None) -> None:
        self.connected = False
        self.disconnected = False
        self.messages: list[MqttMessage] = []
        self._fail_at_message = fail_at_message

    def connect(self) -> None:
        self.connected = True

    def publish(self, message: MqttMessage) -> None:
        if self._fail_at_message is not None and len(self.messages) == self._fail_at_message:
            raise RuntimeError("synthetic MQTT failure")
        self.messages.append(message)

    def disconnect(self) -> None:
        self.disconnected = True


def _settings_payload(state_path: Path, *, master_seed: int = 20260729) -> dict[str, Any]:
    return {
        "settings_version": "1.0.0",
        "mode": "mqtt_continuous",
        "master_seed": master_seed,
        "state_path": str(state_path),
        "broker": {
            "host": "mqtt.example.internal",
            "port": 1883,
            "tls": False,
            "client_id": "mtex-pdm-prospective",
            "username_env": "MTEX_PDM_MQTT_USERNAME",
            "password_env": "MTEX_PDM_MQTT_PASSWORD",
            "keepalive_seconds": 60,
            "connect_timeout_seconds": 10,
            "publish_timeout_seconds": 10,
        },
        "machines": [
            {
                "machine_id": "pdm-prospective-01",
                "scenario_id": "prospective_healthy",
            },
            {
                "machine_id": "pdm-prospective-02",
                "scenario_id": "prospective_calendar_wear",
            },
            {
                "machine_id": "pdm-prospective-03",
                "scenario_id": "prospective_intense_production",
            },
            {
                "machine_id": "pdm-prospective-04",
                "scenario_id": "prospective_pump_stress",
            },
        ],
    }


def _write_settings(
    path: Path,
    state_path: Path,
    *,
    master_seed: int = 20260729,
) -> ProspectivePublisherSettings:
    path.write_text(
        yaml.safe_dump(
            _settings_payload(state_path, master_seed=master_seed),
            sort_keys=False,
        ),
        encoding="utf-8",
    )
    return ProspectivePublisherSettings.load(path)


def _fixed_clock() -> datetime:
    return datetime(2026, 8, 27, 16, 30, tzinfo=UTC)


def _no_sleep(_: float) -> None:
    return None


def _monotonic_counter() -> Callable[[], float]:
    current = -1.0

    def monotonic() -> float:
        nonlocal current
        current += 1.0
        return current

    return monotonic


def _payload_for(messages: list[MqttMessage], suffix: str) -> object:
    message = next(item for item in messages if item.topic.endswith(f"/state/{suffix}"))
    return json.loads(message.payload)


def test_platform_file_lock_adapter_routes_windows_and_posix_calls(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    calls: list[tuple[str, int, int]] = []

    class _WindowsLock:
        LK_NBLCK = 1
        LK_UNLCK = 2

        def locking(self, fd: int, mode: int, nbytes: int) -> None:
            calls.append(("windows", mode, nbytes))

    class _PosixLock:
        LOCK_EX = 4
        LOCK_NB = 8
        LOCK_UN = 16

        def flock(self, fd: int, operation: int) -> None:
            calls.append(("posix", operation, fd))

    modules = {"msvcrt": _WindowsLock(), "fcntl": _PosixLock()}
    monkeypatch.setattr(mqtt_publisher, "import_module", modules.__getitem__)

    with (tmp_path / "windows.lock").open("a+b") as handle:
        mqtt_publisher._acquire_platform_file_lock(handle, "nt")
        mqtt_publisher._release_platform_file_lock(handle, "nt")
        handle.seek(0)
        assert handle.read() == b"0"

    with (tmp_path / "posix.lock").open("a+b") as handle:
        posix_fd = handle.fileno()
        mqtt_publisher._acquire_platform_file_lock(handle, "posix")
        mqtt_publisher._release_platform_file_lock(handle, "posix")

    assert calls == [
        ("windows", 1, 1),
        ("windows", 2, 1),
        ("posix", 12, posix_fd),
        ("posix", 16, posix_fd),
    ]


def test_payload_renderer_emits_exact_authorized_catalog_without_ground_truth() -> None:
    catalog = load_telemetry_catalog(CONFIG_DIR)
    snapshot = TelemetrySnapshot(
        machine_id="pdm-prospective-01",
        time_index=datetime(2026, 8, 27, 15, 30, tzinfo=UTC),
        data_source=DataSource.MQTT_PROSPECTIVE,
        split=DatasetSplit.PROSPECTIVE,
        observable=ObservableMachineState(
            numeric_signals=(
                NumericSignal(name="machine_status", value=203),
                NumericSignal(name="ambient_temperature", value=26.6),
                NumericSignal(name="print_bar_traveled_distance_since_last_pm", value=10),
                NumericSignal(
                    name="print_bar_traveled_distance_since_last_pm_maximum",
                    value=250,
                ),
            )
        ),
    )

    messages = render_snapshot_messages(snapshot, catalog, heartbeat_at=_fixed_clock())

    assert len(messages) == 105
    assert [message.topic.rsplit("/", 1)[-1] for message in messages] == list(
        catalog.attribute_codes
    )
    assert all(message.qos == 0 and not message.retain for message in messages)
    assert json.loads(messages[0].payload) == "2026-08-27 17:30:00"
    assert _payload_for(list(messages), "machine_status") == 203
    assert _payload_for(list(messages), "ambient_temperature") == 26.6
    assert _payload_for(list(messages), "print_bar_traveled_distance_since_last_pm") == {
        "maximum": 250,
        "value": 10,
    }
    assert _payload_for(list(messages), "cap_station_time_since_last_pm") == {
        "maximum": 90,
        "value": 0,
    }
    serialized = "\n".join(f"{message.topic} {message.payload}" for message in messages)
    assert "degradation" not in serialized
    assert "scenario" not in serialized
    assert "maintenance_due_at" not in serialized


def test_settings_require_four_to_six_disjoint_prospective_machines(tmp_path: Path) -> None:
    payload = _settings_payload(tmp_path / "state.json")
    payload["machines"] = list(payload["machines"])[:3]
    with pytest.raises(ValidationError, match="between 4 and 6"):
        ProspectivePublisherSettings.model_validate(payload)

    invalid = _settings_payload(tmp_path / "state.json")
    invalid["machines"][0]["scenario_id"] = "normal_operation"
    with pytest.raises(ValidationError, match="prospective scenario"):
        ProspectivePublisherSettings.model_validate(invalid)

    reused = _settings_payload(tmp_path / "state.json")
    reused["machines"][0]["machine_id"] = "synthetic-train-pilot-01"
    with pytest.raises(ValidationError, match="historical split"):
        ProspectivePublisherSettings.model_validate(reused)


def test_checked_in_settings_example_covers_six_distinct_scenarios() -> None:
    settings = ProspectivePublisherSettings.load(
        ML_ROOT / "examples" / "mqtt" / "prospective.example.yaml"
    )

    assert settings.mode.value == "mqtt_continuous"
    assert settings.publish_seconds == 60
    assert len(settings.machines) == 6
    assert len({machine.machine_id for machine in settings.machines}) == 6
    assert len({machine.scenario_id for machine in settings.machines}) == 6
    assert settings.state_path == (ML_ROOT / "data/mqtt/prospective-state.json").resolve()


def test_publisher_persists_and_resumes_state_after_complete_batches(tmp_path: Path) -> None:
    state_path = tmp_path / "publisher-state.json"
    settings = _write_settings(tmp_path / "publisher.yaml", state_path)
    first_transport = _RecordingTransport()
    first = ProspectivePublisher(
        settings,
        config_directory=CONFIG_DIR,
        transport=first_transport,
        clock=_fixed_clock,
        sleep=_no_sleep,
        monotonic=_monotonic_counter(),
    )

    first_report = first.run(max_ticks=1)
    first_calendar = _payload_for(
        first_transport.messages,
        "print_bar_time_since_last_pm",
    )

    assert first_transport.connected and first_transport.disconnected
    assert state_path.is_file()
    assert first_report.resumed is False
    assert first_report.batch_count == 1
    assert first_report.message_count == 4 * 105
    assert first_report.ground_truth_event_count == 0

    second_transport = _RecordingTransport()
    second_report = ProspectivePublisher(
        settings,
        config_directory=CONFIG_DIR,
        transport=second_transport,
        clock=_fixed_clock,
        sleep=_no_sleep,
        monotonic=_monotonic_counter(),
    ).run(max_ticks=1)
    second_calendar = _payload_for(
        second_transport.messages,
        "print_bar_time_since_last_pm",
    )

    assert second_report.resumed is True
    assert second_report.batch_count == 1
    assert second_report.lifetime_batch_count == 2
    assert second_calendar["value"] > first_calendar["value"]  # type: ignore[index]
    persisted = json.loads(state_path.read_text(encoding="utf-8"))
    assert persisted["published_batch_count"] == 2
    assert "checkpoint" in persisted
    assert persisted["ground_truth_event_count"] == len(persisted["ground_truth_events"])


def test_publisher_refuses_changed_simulation_settings_for_existing_state(
    tmp_path: Path,
) -> None:
    state_path = tmp_path / "publisher-state.json"
    original = _write_settings(tmp_path / "original.yaml", state_path)
    ProspectivePublisher(
        original,
        config_directory=CONFIG_DIR,
        transport=_RecordingTransport(),
        clock=_fixed_clock,
        sleep=_no_sleep,
        monotonic=_monotonic_counter(),
    ).run(max_ticks=1)
    changed = _write_settings(
        tmp_path / "changed.yaml",
        state_path,
        master_seed=20260730,
    )

    with pytest.raises(ValueError, match="state does not match"):
        ProspectivePublisher(
            changed,
            config_directory=CONFIG_DIR,
            transport=_RecordingTransport(),
            clock=_fixed_clock,
            sleep=_no_sleep,
            monotonic=_monotonic_counter(),
        ).run(max_ticks=1)


def test_failed_first_batch_keeps_a_replayable_initial_checkpoint(tmp_path: Path) -> None:
    state_path = tmp_path / "publisher-state.json"
    settings = _write_settings(tmp_path / "publisher.yaml", state_path)
    failed_transport = _RecordingTransport(fail_at_message=17)
    publisher = ProspectivePublisher(
        settings,
        config_directory=CONFIG_DIR,
        transport=failed_transport,
        clock=_fixed_clock,
        sleep=_no_sleep,
        monotonic=_monotonic_counter(),
    )

    with pytest.raises(RuntimeError, match="synthetic MQTT failure"):
        publisher.run(max_ticks=1)

    initial_state = json.loads(state_path.read_text(encoding="utf-8"))
    assert initial_state["published_batch_count"] == 0
    assert initial_state["published_message_count"] == 0
    assert initial_state["ground_truth_events"] == []

    replay_transport = _RecordingTransport()
    replay = ProspectivePublisher(
        settings,
        config_directory=CONFIG_DIR,
        transport=replay_transport,
        clock=_fixed_clock,
        sleep=_no_sleep,
        monotonic=_monotonic_counter(),
    ).run(max_ticks=1)

    assert replay.resumed is True
    assert replay_transport.messages[:17] == failed_transport.messages


def test_continuous_integer_payloads_remain_valid_beyond_the_first_tick(tmp_path: Path) -> None:
    settings = _write_settings(tmp_path / "publisher.yaml", tmp_path / "state.json")
    transport = _RecordingTransport()

    report = ProspectivePublisher(
        settings,
        config_directory=CONFIG_DIR,
        transport=transport,
        dry_run=True,
        clock=_fixed_clock,
        sleep=lambda _: pytest.fail("dry-run must not sleep"),
        monotonic=_monotonic_counter(),
    ).run(max_ticks=3)

    copies_printed = [
        json.loads(message.payload)
        for message in transport.messages
        if message.topic.endswith("/state/copies_printed")
    ]
    assert report.message_count == 3 * 4 * 105
    assert len(copies_printed) == 3 * 4
    assert all(isinstance(value, int) for value in copies_printed)
    assert not settings.state_path.exists()


def test_telemetry_gap_is_an_intentional_missing_snapshot_not_a_partial_machine_batch(
    tmp_path: Path,
) -> None:
    payload = _settings_payload(tmp_path / "state.json")
    payload["machines"][0]["scenario_id"] = "prospective_telemetry_gap"
    settings_path = tmp_path / "publisher.yaml"
    settings_path.write_text(yaml.safe_dump(payload, sort_keys=False), encoding="utf-8")
    settings = ProspectivePublisherSettings.load(settings_path)
    transport = _RecordingTransport()

    report = ProspectivePublisher(
        settings,
        config_directory=CONFIG_DIR,
        transport=transport,
        dry_run=True,
        clock=_fixed_clock,
        sleep=lambda _: pytest.fail("dry-run must not sleep"),
        monotonic=_monotonic_counter(),
    ).run(max_ticks=7)

    assert report.batch_count == 7
    assert report.message_count == (6 * 4 * 105) + (3 * 105)
    message_counts = {
        machine.machine_id: sum(
            message.topic.startswith(f"{machine.machine_id}/state/")
            for message in transport.messages
        )
        for machine in settings.machines
    }
    assert message_counts["pdm-prospective-01"] == 6 * 105
    assert all(
        count == 7 * 105
        for machine_id, count in message_counts.items()
        if machine_id != "pdm-prospective-01"
    )


def test_paho_transport_uses_qos_zero_non_retained_and_environment_credentials(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    import paho.mqtt.client as mqtt

    calls: dict[str, Any] = {}

    class _Receipt:
        rc = mqtt.MQTT_ERR_SUCCESS

        def wait_for_publish(self, timeout: int) -> None:
            calls["publish_timeout"] = timeout

        def is_published(self) -> bool:
            return True

    class _Client:
        on_connect: Any = None

        def __init__(self, **kwargs: Any) -> None:
            calls["client"] = kwargs

        def username_pw_set(self, username: str, password: str | None) -> None:
            calls["credentials"] = (username, password)

        def reconnect_delay_set(self, *, min_delay: int, max_delay: int) -> None:
            calls["reconnect"] = (min_delay, max_delay)

        def connect(self, host: str, port: int, keepalive: int) -> int:
            calls["connect"] = (host, port, keepalive)
            assert self.on_connect is not None
            self.on_connect(self, None, None, 0, None)
            return mqtt.MQTT_ERR_SUCCESS

        def loop_start(self) -> None:
            calls["loop_start"] = True

        def publish(self, topic: str, payload: str, *, qos: int, retain: bool) -> _Receipt:
            calls["publish"] = (topic, payload, qos, retain)
            return _Receipt()

        def disconnect(self) -> None:
            calls["disconnect"] = True

        def loop_stop(self) -> None:
            calls["loop_stop"] = True

    monkeypatch.setattr(mqtt, "Client", _Client)
    monkeypatch.setenv("MTEX_PDM_MQTT_USERNAME", "publisher-user")
    monkeypatch.setenv("MTEX_PDM_MQTT_PASSWORD", "publisher-password")
    transport = PahoMqttTransport(
        MqttBrokerSettings(
            host="mqtt.example.internal",
            port=1883,
            client_id="mtex-pdm-test",
        )
    )

    transport.connect()
    transport.publish(MqttMessage(topic="machine/state/status", payload="203"))
    transport.disconnect()

    assert calls["credentials"] == ("publisher-user", "publisher-password")
    assert calls["connect"] == ("mqtt.example.internal", 1883, 60)
    assert calls["reconnect"] == (1, 30)
    assert calls["publish"] == ("machine/state/status", "203", 0, False)
    assert calls["publish_timeout"] == 10
    assert calls["disconnect"] and calls["loop_stop"]


def test_mqtt_publish_cli_dry_run_is_bounded_and_does_not_write_state(tmp_path: Path) -> None:
    state_path = tmp_path / "publisher-state.json"
    settings_path = tmp_path / "publisher.yaml"
    _write_settings(settings_path, state_path)
    process = subprocess.run(
        [
            sys.executable,
            "-m",
            "mtex_pdm",
            "mqtt-publish",
            "--settings",
            str(settings_path),
            "--config-dir",
            str(CONFIG_DIR),
            "--dry-run",
            "--max-ticks",
            "1",
            "--json",
        ],
        cwd=ML_ROOT,
        check=False,
        capture_output=True,
        text=True,
    )

    assert process.returncode == 0, process.stderr
    report = json.loads(process.stdout)
    assert report == {
        "attribute_count": 105,
        "batch_count": 1,
        "dry_run": True,
        "ground_truth_event_count": 0,
        "healthy": True,
        "machine_count": 4,
        "message_count": 420,
        "mode": "mqtt_continuous",
        "resumed": False,
        "state_path": str(state_path.resolve()),
    }
    assert not state_path.exists()
