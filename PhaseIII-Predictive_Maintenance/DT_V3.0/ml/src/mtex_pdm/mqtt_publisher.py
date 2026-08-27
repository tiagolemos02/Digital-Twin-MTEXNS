"""Prospective MQTT publisher for TPPPS4-compatible synthetic machines."""

from __future__ import annotations

import json
import math
import os
import threading
import time
from collections.abc import Callable, Mapping
from contextlib import AbstractContextManager
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any, Literal, Protocol, Self
from zoneinfo import ZoneInfo

import yaml
from pydantic import BaseModel, ConfigDict, Field, model_validator

from mtex_pdm import __version__
from mtex_pdm.config_validation import validate_frozen_config
from mtex_pdm.contracts import DatasetSplit, DataSource, canonical_sha256
from mtex_pdm.generator import (
    GenerationConfig,
    GenerationMode,
    GeneratorCheckpoint,
    GeneratorEngine,
    GroundTruthEvent,
    InMemoryOutput,
    MachineBehavior,
    MachineSimulationSpec,
    TelemetrySnapshot,
    supported_scenario_ids,
)
from mtex_pdm.generator.models import RuntimeIdentifier
from mtex_pdm.telemetry_catalog import (
    CatalogAttribute,
    TelemetryCatalog,
    load_telemetry_catalog,
    machine_status_name,
)

PUBLISHER_SETTINGS_VERSION: Literal["1.0.0"] = "1.0.0"
PUBLISHER_STATE_VERSION: Literal["1.0.0"] = "1.0.0"
_CONTINUOUS_SECONDS = 60
_DEMONSTRATION_SECONDS = 8
_MINIMUM_MACHINES = 4
_MAXIMUM_MACHINES = 6
_STATE_HORIZON_DAYS = 36_500
_LISBON = ZoneInfo("Europe/Lisbon")
_HISTORICAL_ID_PREFIXES = (
    "synthetic-train-",
    "synthetic-validation-",
    "synthetic-test-",
)
_PROSPECTIVE_SCENARIOS = frozenset(
    scenario_id
    for scenario_id in supported_scenario_ids()
    if scenario_id.startswith("prospective_")
)

_NON_PUMP_COUNTER_MAXIMA: dict[str, float] = {
    "print_bar_traveled_distance_since_last_pm": 250.0,
    "print_bar_time_since_last_pm": 90.0,
    "cap_station_traveled_distance_since_last_pm": 500.0,
    "cap_station_time_since_last_pm": 90.0,
    "transport_traveled_distance_since_last_pm": 100_000.0,
    "transport_time_since_last_pm": 60.0,
    "transport_vacuum_work_time_since_last_air_filter_pm": 144_000.0,
    "web_cleaner_vacuum_work_time_since_last_air_filter_pm": 144_000.0,
    "exit_belt_traveled_distance_since_last_pm": 800_000.0,
    "exit_belt_time_since_last_pm": 90.0,
    "feeder_overall_time_since_last_pm": 90.0,
    "feeder_transport_time_since_last_pm": 90.0,
    "feeder_transport_traveled_distance_since_last_pm": 800_000.0,
    "feeder_vacuum_work_time_since_last_air_filter_pm": 144_000.0,
    "stacker_overall_time_since_last_pm": 90.0,
    "stacker_lift_time_since_last_pm": 90.0,
    "stacker_lift_traveled_distance_since_last_pm": 1_000.0,
}


class _FrozenModel(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True, str_strip_whitespace=True)


class MqttBrokerSettings(_FrozenModel):
    """Connection settings without embedded credentials."""

    host: str = Field(min_length=1, max_length=253)
    port: int = Field(default=1883, ge=1, le=65_535)
    tls: bool = False
    ca_file: Path | None = None
    client_id: str = Field(default="mtex-pdm-prospective", min_length=1, max_length=128)
    username_env: str | None = Field(
        default="MTEX_PDM_MQTT_USERNAME",
        pattern=r"^[A-Z_][A-Z0-9_]*$",
    )
    password_env: str | None = Field(
        default="MTEX_PDM_MQTT_PASSWORD",
        pattern=r"^[A-Z_][A-Z0-9_]*$",
    )
    keepalive_seconds: int = Field(default=60, ge=10, le=3_600)
    connect_timeout_seconds: int = Field(default=10, ge=1, le=300)
    publish_timeout_seconds: int = Field(default=10, ge=1, le=300)

    @model_validator(mode="after")
    def validate_transport_security(self) -> MqttBrokerSettings:
        if any(character.isspace() for character in self.host):
            raise ValueError("MQTT host cannot contain whitespace")
        if self.ca_file is not None and not self.tls:
            raise ValueError("ca_file requires tls=true")
        if self.password_env is not None and self.username_env is None:
            raise ValueError("password_env requires username_env")
        return self

    def credentials(self) -> tuple[str | None, str | None]:
        """Read optional credentials without copying their values into settings or reports."""

        username = os.environ.get(self.username_env) if self.username_env else None
        password = os.environ.get(self.password_env) if self.password_env else None
        if password and not username:
            raise ValueError("MQTT password is set but the username is missing")
        return username or None, password or None


class ProspectiveMachineSettings(_FrozenModel):
    """One MQTT-only machine identity and its frozen prospective scenario."""

    machine_id: RuntimeIdentifier
    scenario_id: RuntimeIdentifier

    @model_validator(mode="after")
    def validate_prospective_boundary(self) -> ProspectiveMachineSettings:
        if self.machine_id.startswith(_HISTORICAL_ID_PREFIXES):
            raise ValueError("prospective machine ID cannot reuse a historical split identity")
        if self.scenario_id not in _PROSPECTIVE_SCENARIOS:
            raise ValueError("MQTT machines require a prospective scenario")
        return self


class ProspectivePublisherSettings(_FrozenModel):
    """Versioned, secret-free configuration for one publisher process."""

    settings_version: Literal["1.0.0"] = PUBLISHER_SETTINGS_VERSION
    mode: GenerationMode
    master_seed: int = Field(default=20260729, ge=0, le=2**64 - 1)
    state_path: Path
    broker: MqttBrokerSettings
    machines: tuple[ProspectiveMachineSettings, ...]

    @model_validator(mode="after")
    def validate_prospective_run(self) -> ProspectivePublisherSettings:
        if self.mode not in {
            GenerationMode.MQTT_CONTINUOUS,
            GenerationMode.MQTT_DEMONSTRATION,
        }:
            raise ValueError("publisher mode must be mqtt_continuous or mqtt_demonstration")
        if not _MINIMUM_MACHINES <= len(self.machines) <= _MAXIMUM_MACHINES:
            raise ValueError("publisher requires between 4 and 6 prospective machines")
        machine_ids = [machine.machine_id for machine in self.machines]
        if len(machine_ids) != len(set(machine_ids)):
            raise ValueError("publisher contains duplicate machine IDs")
        return self

    @property
    def publish_seconds(self) -> int:
        return (
            _CONTINUOUS_SECONDS
            if self.mode is GenerationMode.MQTT_CONTINUOUS
            else _DEMONSTRATION_SECONDS
        )

    @property
    def simulation_fingerprint(self) -> str:
        return canonical_sha256(
            {
                "settings_version": self.settings_version,
                "mode": self.mode.value,
                "master_seed": self.master_seed,
                "publish_seconds": self.publish_seconds,
                "machines": [machine.model_dump(mode="json") for machine in self.machines],
            }
        )

    @classmethod
    def load(cls, path: Path) -> ProspectivePublisherSettings:
        """Load YAML and resolve local paths relative to the settings file."""

        resolved_settings = path.resolve()
        try:
            payload = yaml.safe_load(resolved_settings.read_text(encoding="utf-8"))
        except (OSError, yaml.YAMLError) as error:
            raise ValueError(f"cannot read publisher settings: {error}") from error
        if not isinstance(payload, Mapping):
            raise ValueError("publisher settings must contain a YAML object")
        settings = cls.model_validate(payload)
        base = resolved_settings.parent
        broker = settings.broker
        if broker.ca_file is not None and not broker.ca_file.is_absolute():
            broker = broker.model_copy(update={"ca_file": (base / broker.ca_file).resolve()})
        if broker.ca_file is not None and not broker.ca_file.is_file():
            raise ValueError(f"MQTT CA file does not exist: {broker.ca_file}")
        state_path = settings.state_path
        if not state_path.is_absolute():
            state_path = (base / state_path).resolve()
        if state_path == resolved_settings:
            raise ValueError("publisher state_path cannot overwrite the settings file")
        return settings.model_copy(update={"broker": broker, "state_path": state_path})


class MqttMessage(_FrozenModel):
    """One non-retained QoS-0 message accepted by the current IoT Agent binding."""

    topic: str = Field(min_length=1, max_length=512)
    payload: str = Field(min_length=1)
    qos: Literal[0] = 0
    retain: Literal[False] = False


class MqttTransport(Protocol):
    """Small testable transport boundary around the MQTT client implementation."""

    def connect(self) -> None: ...

    def publish(self, message: MqttMessage) -> None: ...

    def disconnect(self) -> None: ...


class DryRunMqttTransport:
    """Validate publisher behavior without opening a network connection."""

    def connect(self) -> None:
        return None

    def publish(self, message: MqttMessage) -> None:
        del message

    def disconnect(self) -> None:
        return None


class PahoMqttTransport:
    """Paho MQTT 3.1.1 transport with bounded connect and publish waits."""

    def __init__(self, settings: MqttBrokerSettings) -> None:
        self.settings = settings
        self._client: Any = None
        self._mqtt: Any = None
        self._connected = threading.Event()
        self._connect_error: str | None = None

    def connect(self) -> None:
        try:
            import paho.mqtt.client as mqtt
            from paho.mqtt.enums import CallbackAPIVersion
        except ImportError as error:
            raise ImportError(
                "paho-mqtt is required for network publishing; install the v1.1.6 lock file"
            ) from error

        self._mqtt = mqtt
        callback_api_version: Any = CallbackAPIVersion.VERSION2
        client = mqtt.Client(
            callback_api_version=callback_api_version,
            client_id=self.settings.client_id,
            protocol=mqtt.MQTTv311,
        )
        username, password = self.settings.credentials()
        if username is not None:
            client.username_pw_set(username, password)
        if self.settings.tls:
            ca_certs = str(self.settings.ca_file) if self.settings.ca_file else None
            client.tls_set(ca_certs=ca_certs)

        def on_connect(
            client_instance: Any,
            userdata: Any,
            flags: Any,
            reason_code: Any,
            properties: Any,
        ) -> None:
            del client_instance, userdata, flags, properties
            if reason_code == 0:
                self._connected.set()
            else:
                self._connect_error = str(reason_code)
                self._connected.set()

        client.on_connect = on_connect
        self._client = client
        client.reconnect_delay_set(min_delay=1, max_delay=30)
        result = client.connect(
            self.settings.host,
            self.settings.port,
            self.settings.keepalive_seconds,
        )
        if result != mqtt.MQTT_ERR_SUCCESS:
            raise ConnectionError(f"MQTT connect call failed with code {result}")
        client.loop_start()
        if not self._connected.wait(self.settings.connect_timeout_seconds):
            self.disconnect()
            raise TimeoutError("timed out waiting for MQTT CONNACK")
        if self._connect_error is not None:
            self.disconnect()
            raise ConnectionError(f"MQTT broker rejected the connection: {self._connect_error}")

    def publish(self, message: MqttMessage) -> None:
        if self._client is None or self._mqtt is None:
            raise RuntimeError("MQTT transport is not connected")
        receipt = self._client.publish(
            message.topic,
            message.payload,
            qos=message.qos,
            retain=message.retain,
        )
        if receipt.rc != self._mqtt.MQTT_ERR_SUCCESS:
            raise ConnectionError(f"MQTT publish failed with code {receipt.rc}")
        receipt.wait_for_publish(timeout=self.settings.publish_timeout_seconds)
        if not receipt.is_published():
            raise TimeoutError(f"timed out publishing MQTT topic {message.topic!r}")

    def disconnect(self) -> None:
        if self._client is None:
            return
        try:
            self._client.disconnect()
        finally:
            self._client.loop_stop()
            self._client = None


def _normalized_number(value: float) -> int | float:
    if not math.isfinite(value):
        raise ValueError("MQTT payload values must be finite")
    return int(value) if value.is_integer() else value


def _counter_maximum(code: str) -> float:
    explicit = _NON_PUMP_COUNTER_MAXIMA.get(code)
    if explicit is not None:
        return explicit
    if code.startswith("pump_") and code.endswith("_work_time_since_replacement"):
        return 2_880_000.0
    if code.startswith("pump_") and code.endswith("_time_since_replacement"):
        return 360.0
    raise ValueError(f"no authorized MQTT maximum for bounded attribute {code!r}")


def _observable_values(snapshot: TelemetrySnapshot) -> dict[str, float]:
    return {signal.name: float(signal.value) for signal in snapshot.observable.numeric_signals}


def _bounded_payload(
    attribute: CatalogAttribute,
    values: Mapping[str, float],
    catalog: TelemetryCatalog,
) -> str:
    maximum = _counter_maximum(attribute.code)
    for derived in catalog.mvp_selection.derived_maximum_attributes.values():
        if derived.source_attribute == attribute.code:
            maximum = values.get(f"{attribute.code}_maximum", derived.official_maximum)
            break
    value = values.get(attribute.code, 0.0)
    if value < 0.0 or value > maximum:
        raise ValueError(f"bounded MQTT value {attribute.code!r}={value} is outside [0, {maximum}]")
    return json.dumps(
        {
            "maximum": _normalized_number(float(maximum)),
            "value": _normalized_number(float(value)),
        },
        separators=(",", ":"),
    )


def _scalar_payload(attribute: CatalogAttribute, values: Mapping[str, float]) -> str:
    value = values.get(attribute.code, 0.0)
    if attribute.code == "machine_status":
        machine_status_name(value)
    numeric = float(value)
    if not math.isfinite(numeric):
        raise ValueError("MQTT payload values must be finite")
    normalized = (
        round(numeric)
        if attribute.enterprise_data_type == "Integer"
        else _normalized_number(numeric)
    )
    return json.dumps(normalized, separators=(",", ":"))


def render_snapshot_messages(
    snapshot: TelemetrySnapshot,
    catalog: TelemetryCatalog,
    *,
    heartbeat_at: datetime,
) -> tuple[MqttMessage, ...]:
    """Render exactly the authorized 105 source attributes and no hidden state."""

    if snapshot.data_source is not DataSource.MQTT_PROSPECTIVE:
        raise ValueError("MQTT renderer only accepts mqtt_prospective telemetry")
    if snapshot.split is not DatasetSplit.PROSPECTIVE:
        raise ValueError("MQTT renderer only accepts prospective split telemetry")
    if heartbeat_at.tzinfo is None or heartbeat_at.utcoffset() is None:
        raise ValueError("heartbeat timestamp must be timezone-aware")
    values = _observable_values(snapshot)
    heartbeat = heartbeat_at.astimezone(_LISBON).strftime("%Y-%m-%d %H:%M:%S")
    messages: list[MqttMessage] = []
    for attribute in catalog.attributes:
        if attribute.code == "iamalive":
            payload = json.dumps(heartbeat, separators=(",", ":"))
        elif attribute.mqtt_payload_shape == "bounded_value":
            payload = _bounded_payload(attribute, values, catalog)
        else:
            payload = _scalar_payload(attribute, values)
        messages.append(
            MqttMessage(
                topic=f"{snapshot.machine_id}/state/{attribute.code}",
                payload=payload,
            )
        )
    if len(messages) != 105:
        raise ValueError("TPPPS4 MQTT batch must contain exactly 105 attributes")
    return tuple(messages)


class _PersistedPublisherState(_FrozenModel):
    state_version: Literal["1.0.0"] = PUBLISHER_STATE_VERSION
    publisher_version: str
    simulation_fingerprint: str = Field(pattern=r"^[0-9a-f]{64}$")
    saved_at: datetime
    generation_config: GenerationConfig
    checkpoint: GeneratorCheckpoint
    published_batch_count: int = Field(ge=0)
    published_message_count: int = Field(ge=0)
    ground_truth_event_count: int = Field(ge=0)
    ground_truth_events: tuple[GroundTruthEvent, ...] = ()

    @model_validator(mode="after")
    def validate_ground_truth_audit(self) -> _PersistedPublisherState:
        if self.ground_truth_event_count != len(self.ground_truth_events):
            raise ValueError("ground-truth event count does not match the local audit trail")
        return self


class PublisherRunReport(_FrozenModel):
    mode: GenerationMode
    machine_count: int
    attribute_count: Literal[105] = 105
    batch_count: int = Field(ge=0)
    message_count: int = Field(ge=0)
    ground_truth_event_count: int = Field(ge=0)
    lifetime_batch_count: int = Field(ge=0)
    lifetime_message_count: int = Field(ge=0)
    resumed: bool
    interrupted: bool
    state_path: Path


class _StateFileLock(AbstractContextManager["_StateFileLock"]):
    """Hold one cross-platform advisory lock for the lifetime of the publisher."""

    def __init__(self, state_path: Path) -> None:
        self.path = state_path.with_name(f"{state_path.name}.lock")
        self._handle: Any = None

    def __enter__(self) -> Self:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        handle = self.path.open("a+b")
        try:
            if os.name == "nt":
                import msvcrt

                handle.seek(0)
                if handle.read(1) == b"":
                    handle.write(b"0")
                    handle.flush()
                handle.seek(0)
                msvcrt.locking(handle.fileno(), msvcrt.LK_NBLCK, 1)
            else:
                import fcntl as fcntl_module

                portable_fcntl: Any = fcntl_module
                portable_fcntl.flock(
                    handle.fileno(),
                    portable_fcntl.LOCK_EX | portable_fcntl.LOCK_NB,
                )
        except (OSError, PermissionError) as error:
            handle.close()
            raise RuntimeError(f"another publisher is using state file {self.path}") from error
        self._handle = handle
        return self

    def __exit__(self, exc_type: Any, exc_value: Any, traceback: Any) -> None:
        del exc_type, exc_value, traceback
        if self._handle is None:
            return
        if os.name == "nt":
            import msvcrt

            self._handle.seek(0)
            msvcrt.locking(self._handle.fileno(), msvcrt.LK_UNLCK, 1)
        else:
            import fcntl as fcntl_module

            portable_fcntl: Any = fcntl_module
            portable_fcntl.flock(self._handle.fileno(), portable_fcntl.LOCK_UN)
        self._handle.close()
        self._handle = None


def _write_state(path: Path, state: _PersistedPublisherState) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(f".{path.name}.{os.getpid()}.tmp")
    payload = state.model_dump_json(indent=2) + "\n"
    try:
        with temporary.open("w", encoding="utf-8", newline="\n") as handle:
            handle.write(payload)
            handle.flush()
            os.fsync(handle.fileno())
        if os.name != "nt":
            temporary.chmod(0o600)
        os.replace(temporary, path)
    finally:
        if temporary.exists():
            temporary.unlink()


def _read_state(path: Path) -> _PersistedPublisherState:
    try:
        return _PersistedPublisherState.model_validate_json(path.read_bytes())
    except (OSError, ValueError) as error:
        raise ValueError(f"invalid MQTT publisher state {path}: {error}") from error


def _aware_utc(clock: Callable[[], datetime]) -> datetime:
    value = clock()
    if value.tzinfo is None or value.utcoffset() is None:
        raise ValueError("publisher clock must return a timezone-aware timestamp")
    return value.astimezone(UTC)


class ProspectivePublisher:
    """Run wall-clock batches while preserving deterministic machine state locally."""

    def __init__(
        self,
        settings: ProspectivePublisherSettings,
        *,
        config_directory: Path,
        transport: MqttTransport,
        dry_run: bool = False,
        clock: Callable[[], datetime] = lambda: datetime.now(UTC),
        sleep: Callable[[float], None] = time.sleep,
        monotonic: Callable[[], float] = time.monotonic,
        on_batch: Callable[[int, int], None] | None = None,
    ) -> None:
        self.settings = settings
        self.config_directory = config_directory
        self.transport = transport
        self.dry_run = dry_run
        self.clock = clock
        self.sleep = sleep
        self.monotonic = monotonic
        self.on_batch = on_batch
        validate_frozen_config(config_directory)
        self.catalog = load_telemetry_catalog(config_directory)
        self.behavior = MachineBehavior()
        self.behavior.validate_catalog_alignment(config_directory)

    def _new_engine(self) -> tuple[GenerationConfig, GeneratorEngine]:
        start_at = _aware_utc(self.clock)
        machines = tuple(
            MachineSimulationSpec(
                machine_id=machine.machine_id,
                scenario_id=machine.scenario_id,
                data_source=DataSource.MQTT_PROSPECTIVE,
                split=DatasetSplit.PROSPECTIVE,
            )
            for machine in self.settings.machines
        )
        config = GenerationConfig(
            mode=self.settings.mode,
            start_at=start_at,
            end_at=start_at + timedelta(days=_STATE_HORIZON_DAYS),
            step_seconds=self.settings.publish_seconds,
            master_seed=self.settings.master_seed,
            machines=machines,
        )
        return config, GeneratorEngine(config, transition=self.behavior)

    def _load_engine(
        self,
    ) -> tuple[GenerationConfig, GeneratorEngine, _PersistedPublisherState | None]:
        if self.dry_run or not self.settings.state_path.exists():
            config, engine = self._new_engine()
            return config, engine, None
        state = _read_state(self.settings.state_path)
        if state.simulation_fingerprint != self.settings.simulation_fingerprint:
            raise ValueError(
                "publisher state does not match the current simulation settings; "
                "use the original settings or a new state path"
            )
        engine = GeneratorEngine.from_checkpoint(
            state.generation_config,
            state.checkpoint,
            transition=self.behavior,
        )
        return state.generation_config, engine, state

    def _run_locked(self, max_ticks: int | None) -> PublisherRunReport:
        if max_ticks is not None and max_ticks <= 0:
            raise ValueError("max_ticks must be positive when provided")
        config, engine, previous = self._load_engine()
        resumed = previous is not None
        lifetime_batches = previous.published_batch_count if previous else 0
        lifetime_messages = previous.published_message_count if previous else 0
        lifetime_events = previous.ground_truth_event_count if previous else 0
        ground_truth_events = list(previous.ground_truth_events) if previous else []
        run_batches = 0
        run_messages = 0
        run_events = 0
        interrupted = False
        next_deadline = self.monotonic()

        if not self.dry_run and previous is None:
            _write_state(
                self.settings.state_path,
                _PersistedPublisherState(
                    publisher_version=__version__,
                    simulation_fingerprint=self.settings.simulation_fingerprint,
                    saved_at=_aware_utc(self.clock),
                    generation_config=config,
                    checkpoint=engine.checkpoint(),
                    published_batch_count=0,
                    published_message_count=0,
                    ground_truth_event_count=0,
                    ground_truth_events=(),
                ),
            )

        self.transport.connect()
        try:
            while max_ticks is None or run_batches < max_ticks:
                output = InMemoryOutput()
                summary = engine.run(output, max_ticks=1)
                if summary.tick_count != 1:
                    raise RuntimeError("prospective generator ended before the requested batch")
                heartbeat_at = _aware_utc(self.clock)
                messages = tuple(
                    message
                    for snapshot in output.telemetry
                    for message in render_snapshot_messages(
                        snapshot,
                        self.catalog,
                        heartbeat_at=heartbeat_at,
                    )
                )
                for message in messages:
                    self.transport.publish(message)

                run_batches += 1
                run_messages += len(messages)
                run_events += len(output.events)
                ground_truth_events.extend(output.events)
                lifetime_batches += 1
                lifetime_messages += len(messages)
                lifetime_events += len(output.events)
                if not self.dry_run:
                    _write_state(
                        self.settings.state_path,
                        _PersistedPublisherState(
                            publisher_version=__version__,
                            simulation_fingerprint=self.settings.simulation_fingerprint,
                            saved_at=heartbeat_at,
                            generation_config=config,
                            checkpoint=engine.checkpoint(),
                            published_batch_count=lifetime_batches,
                            published_message_count=lifetime_messages,
                            ground_truth_event_count=lifetime_events,
                            ground_truth_events=tuple(ground_truth_events),
                        ),
                    )
                if self.on_batch is not None:
                    self.on_batch(run_batches, len(messages))
                if max_ticks is not None and run_batches >= max_ticks:
                    break
                if self.dry_run:
                    continue
                next_deadline += self.settings.publish_seconds
                delay = max(0.0, next_deadline - self.monotonic())
                try:
                    self.sleep(delay)
                except KeyboardInterrupt:
                    interrupted = True
                    break
        except KeyboardInterrupt:
            interrupted = True
        finally:
            self.transport.disconnect()

        return PublisherRunReport(
            mode=self.settings.mode,
            machine_count=len(self.settings.machines),
            batch_count=run_batches,
            message_count=run_messages,
            ground_truth_event_count=run_events,
            lifetime_batch_count=lifetime_batches,
            lifetime_message_count=lifetime_messages,
            resumed=resumed,
            interrupted=interrupted,
            state_path=self.settings.state_path.resolve(),
        )

    def run(self, *, max_ticks: int | None = None) -> PublisherRunReport:
        """Publish until bounded completion or interruption, with single-process state access."""

        if self.dry_run:
            return self._run_locked(max_ticks)
        with _StateFileLock(self.settings.state_path):
            return self._run_locked(max_ticks)


__all__ = [
    "DryRunMqttTransport",
    "MqttBrokerSettings",
    "MqttMessage",
    "MqttTransport",
    "PahoMqttTransport",
    "ProspectiveMachineSettings",
    "ProspectivePublisher",
    "ProspectivePublisherSettings",
    "PublisherRunReport",
    "render_snapshot_messages",
]
