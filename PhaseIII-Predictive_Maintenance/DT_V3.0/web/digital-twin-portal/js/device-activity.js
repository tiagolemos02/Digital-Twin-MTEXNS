import { ENTITY_TYPE, FACTORY_TIME_ZONE, sessionToken } from './config.js';
import { apiFetch } from './api-client.js';
import { extractMachineStatusFromEntity } from './machine-status.js';
import {
  CONNECTIVITY_OFFLINE_AFTER_MS,
  resolveConnectivity
} from './connectivity-status.js';

export const ACTIVITY_POLL_INTERVAL_MS = 4 * 1000;
export const MONITOR_FAILURE_LIMIT = 3;
export const OFFLINE_THRESHOLD_MS = CONNECTIVITY_OFFLINE_AFTER_MS;

const activityStore = new Map();
let lastFetchMs = 0;
let consecutiveFailures = 0;
let lastMonitorError = '';
let pollTimer = null;
let pollInFlight = false;
let pollPromise = null;
let pollAbortController = null;
let visibilityHandler = null;
let telemetryMode = false;
let activePollIncludesTelemetry = false;
let queuedFullTelemetryPoll = false;
let latestFullSnapshot = {
  entities: [],
  fetchedAt: 0,
  rttMs: null
};

function rawValue(value) {
  if (value && typeof value === 'object' && Object.prototype.hasOwnProperty.call(value, 'value')) {
    return rawValue(value.value);
  }
  return value;
}

function findAttribute(entity, expectedName) {
  const normalizedExpected = String(expectedName).toLowerCase();
  return Object.entries(entity || {}).find(([name]) => String(name).toLowerCase() === normalizedExpected)?.[1];
}

function timezoneOffsetMs(date, timeZone) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hourCycle: 'h23'
  }).formatToParts(date);
  const values = Object.fromEntries(parts.filter((part) => part.type !== 'literal').map((part) => [part.type, part.value]));
  const representedAsUtc = Date.UTC(
    Number(values.year), Number(values.month) - 1, Number(values.day),
    Number(values.hour), Number(values.minute), Number(values.second)
  );
  return representedAsUtc - date.getTime();
}

function parseFactoryLocalTimestamp(value, timeZone) {
  const match = String(value || '').trim().match(
    /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?$/
  );
  if (!match) return null;
  const [, year, month, day, hour, minute, second, milliseconds = '0'] = match;
  const localAsUtc = Date.UTC(
    Number(year), Number(month) - 1, Number(day),
    Number(hour), Number(minute), Number(second), Number(milliseconds.padEnd(3, '0'))
  );
  let candidate = localAsUtc;
  for (let index = 0; index < 2; index += 1) {
    candidate = localAsUtc - timezoneOffsetMs(new Date(candidate), timeZone);
  }
  return Number.isFinite(candidate) ? candidate : null;
}

export function parseActivityTimestamp(value, { factoryTimeZone = FACTORY_TIME_ZONE } = {}) {
  const resolved = rawValue(value);
  if (resolved instanceof Date) return Number.isFinite(resolved.getTime()) ? resolved.getTime() : null;
  if (typeof resolved === 'number') return Number.isFinite(resolved) ? resolved : null;
  if (typeof resolved !== 'string' || !resolved.trim()) return null;
  const normalized = resolved.trim();
  if (/^\d{4}-\d{2}-\d{2}[T ][\d:.]+(?:Z|[+-]\d{2}:?\d{2})$/i.test(normalized)) {
    const parsed = Date.parse(normalized.replace(' ', 'T'));
    return Number.isNaN(parsed) ? null : parsed;
  }
  return parseFactoryLocalTimestamp(normalized, factoryTimeZone);
}

function firstTimestamp(candidates, options) {
  for (const candidate of candidates) {
    const parsed = parseActivityTimestamp(candidate, options);
    if (parsed !== null) return parsed;
  }
  return null;
}

function attributeReceivedAt(attribute, options, entity = null) {
  return firstTimestamp([
    attribute?.metadata?.timestamp?.value,
    attribute?.metadata?.timestamp,
    attribute?.metadata?.TimeInstant?.value,
    attribute?.metadata?.TimeInstant,
    attribute?.metadata?.observedAt?.value,
    attribute?.metadata?.observedAt,
    attribute?.observedAt,
    entity?.TimeInstant?.value,
    entity?.TimeInstant
  ], options);
}

export function extractIAmAliveContact(entity = {}, options = {}) {
  const attribute = findAttribute(entity, 'iamalive');
  if (attribute === undefined) {
    return { lastContactMs: null, lastContactIso: '', source: '', machineValueIso: '', reason: 'missing-iamalive' };
  }
  const machineTimestamp = parseActivityTimestamp(rawValue(attribute), options);
  if (machineTimestamp === null) {
    return { lastContactMs: null, lastContactIso: '', source: '', machineValueIso: '', reason: 'invalid-iamalive' };
  }
  const receivedAt = attributeReceivedAt(attribute, options, entity);
  const lastContactMs = receivedAt ?? machineTimestamp;
  return {
    lastContactMs,
    lastContactIso: new Date(lastContactMs).toISOString(),
    source: receivedAt === null ? 'machine-iamalive' : 'orion-received-at',
    machineValueIso: new Date(machineTimestamp).toISOString(),
    reason: ''
  };
}

export function analyzeDevice(device = {}, { now = Date.now(), factoryTimeZone = FACTORY_TIME_ZONE } = {}) {
  const entityId = String(device.id || '').trim();
  if (!entityId) return null;
  const contact = extractIAmAliveContact(device, { factoryTimeZone });
  const machineStatus = extractMachineStatusFromEntity(device);
  const statusAttribute = findAttribute(device, 'machine_status');
  const lastOperationalUpdateMs = attributeReceivedAt(statusAttribute, { factoryTimeZone }, device);
  const deviceId = String(rawValue(device.device_id ?? device.deviceId ?? device.DeviceID) || '').trim();
  return {
    entityId,
    deviceId,
    ...contact,
    machineStatus,
    machineStatusCode: machineStatus.code,
    machineStatusName: machineStatus.name,
    lastOperationalUpdateMs,
    lastOperationalUpdateIso: lastOperationalUpdateMs === null ? '' : new Date(lastOperationalUpdateMs).toISOString(),
    connectivity: resolveConnectivity({
      lastContactMs: contact.lastContactMs,
      now,
      reason: contact.reason
    }),
    capturedAt: now
  };
}

function notifyActivityUpdated(now = Date.now(), detail = {}) {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent('device-activity-updated', {
    detail: {
      timestamp: now,
      monitor: getDeviceActivityMonitorState(),
      fullTelemetry: false,
      ...detail
    }
  }));
}

export function updateActivityFromDevices(
  devices = [],
  {
    now = Date.now(),
    factoryTimeZone = FACTORY_TIME_ZONE,
    replace = true,
    notify = true,
    notification = {}
  } = {}
) {
  const byEntity = new Map();
  if (replace) activityStore.clear();
  (Array.isArray(devices) ? devices : []).forEach((device) => {
    const fingerprint = analyzeDevice(device, { now, factoryTimeZone });
    if (!fingerprint) return;
    byEntity.set(fingerprint.entityId, fingerprint);
    activityStore.set(fingerprint.entityId, fingerprint);
    if (fingerprint.deviceId && fingerprint.deviceId !== fingerprint.entityId) {
      activityStore.set(fingerprint.deviceId, fingerprint);
    }
  });
  lastFetchMs = now;
  consecutiveFailures = 0;
  lastMonitorError = '';
  if (notify) notifyActivityUpdated(now, notification);
  return byEntity;
}

export function getDeviceActivity(id, { now = Date.now() } = {}) {
  if (!id) return null;
  const record = activityStore.get(id);
  if (!record) return null;
  const monitoringAvailable = consecutiveFailures < MONITOR_FAILURE_LIMIT;
  const connectivity = resolveConnectivity({
    lastContactMs: record.lastContactMs,
    now,
    monitoringAvailable,
    reason: monitoringAvailable ? record.reason : 'monitoring-unavailable'
  });
  return {
    ...record,
    connectivity,
    ageMs: connectivity.ageMs,
    offline: connectivity.state === 'offline',
    status: connectivity.label,
    monitoringDelayed: consecutiveFailures > 0 && monitoringAvailable
  };
}

export function getDeviceStatus(id, options) {
  return getDeviceActivity(id, options)?.connectivity?.label || null;
}

export function getLastActivityFetchTime() {
  return lastFetchMs;
}

export function getLatestDeviceEntitySnapshot() {
  return {
    entities: latestFullSnapshot.entities.slice(),
    fetchedAt: latestFullSnapshot.fetchedAt,
    rttMs: latestFullSnapshot.rttMs
  };
}

export function getDeviceActivityMonitorState() {
  return {
    available: consecutiveFailures < MONITOR_FAILURE_LIMIT,
    delayed: consecutiveFailures > 0 && consecutiveFailures < MONITOR_FAILURE_LIMIT,
    consecutiveFailures,
    lastFetchMs,
    error: lastMonitorError
  };
}

export function recordDeviceActivityFailure(error, now = Date.now()) {
  consecutiveFailures += 1;
  lastMonitorError = error?.message || String(error || 'Unable to reach Orion.');
  notifyActivityUpdated(now);
  return getDeviceActivityMonitorState();
}

export function clearDeviceActivity() {
  activityStore.clear();
  lastFetchMs = 0;
  consecutiveFailures = 0;
  lastMonitorError = '';
  latestFullSnapshot = { entities: [], fetchedAt: 0, rttMs: null };
  notifyActivityUpdated();
}

export function buildDeviceActivityQuery({
  entityType = ENTITY_TYPE,
  includeTelemetry = false
} = {}) {
  const query = new URLSearchParams({ type: entityType });
  if (includeTelemetry) {
    query.set('options', 'keyValues');
  } else {
    query.set('attrs', 'iamalive,machine_status,TimeInstant');
  }
  return `/v2/entities?${query}`;
}

export async function refreshDeviceActivity({
  entityType = ENTITY_TYPE,
  now = Date.now(),
  includeTelemetry = telemetryMode,
  signal
} = {}) {
  if (!sessionToken) {
    clearDeviceActivity();
    return new Map();
  }
  const startedAt = globalThis.performance?.now?.() ?? Date.now();
  const response = await apiFetch(buildDeviceActivityQuery({ entityType, includeTelemetry }), { signal });
  if (!response.ok) throw new Error(`Failed to refresh device activity (HTTP ${response.status})`);
  const devices = await response.json();
  const normalizedDevices = Array.isArray(devices) ? devices : [];
  const rttMs = Math.round((globalThis.performance?.now?.() ?? Date.now()) - startedAt);
  if (includeTelemetry) {
    latestFullSnapshot = {
      entities: normalizedDevices,
      fetchedAt: now,
      rttMs
    };
  }
  return updateActivityFromDevices(normalizedDevices, {
    now,
    notify: true,
    notification: {
      fullTelemetry: includeTelemetry,
      entityCount: normalizedDevices.length,
      rttMs
    }
  });
}

export async function pollDeviceActivity(options = {}) {
  const includeTelemetry = options.includeTelemetry ?? telemetryMode;
  if (!sessionToken) return null;
  if (pollInFlight) {
    if (includeTelemetry && !activePollIncludesTelemetry) {
      queuedFullTelemetryPoll = true;
    }
    return pollPromise;
  }
  pollInFlight = true;
  activePollIncludesTelemetry = includeTelemetry;
  const controller = typeof AbortController === 'function' ? new AbortController() : null;
  pollAbortController = controller;
  const currentPoll = (async () => {
    try {
      return await refreshDeviceActivity({
        ...options,
        includeTelemetry,
        signal: controller?.signal
      });
    } catch (error) {
      if (error?.name !== 'AbortError') recordDeviceActivityFailure(error);
      return null;
    } finally {
      if (pollPromise !== currentPoll) return;
      const shouldRunFullTelemetryPoll = queuedFullTelemetryPoll;
      queuedFullTelemetryPoll = false;
      pollInFlight = false;
      pollPromise = null;
      pollAbortController = null;
      activePollIncludesTelemetry = false;
      if (shouldRunFullTelemetryPoll && telemetryMode && sessionToken) {
        void pollDeviceActivity({ includeTelemetry: true });
      }
    }
  })();
  pollPromise = currentPoll;
  return pollPromise;
}

export function setDeviceActivityTelemetryMode(includeTelemetry, { refresh = true } = {}) {
  telemetryMode = Boolean(includeTelemetry);
  if (!refresh) return Promise.resolve(null);
  return requestDeviceActivityRefresh({ includeTelemetry: telemetryMode });
}

export function requestDeviceActivityRefresh({ includeTelemetry = telemetryMode } = {}) {
  return pollDeviceActivity({ includeTelemetry });
}

export function startDeviceActivityMonitor({
  intervalMs = ACTIVITY_POLL_INTERVAL_MS,
  pollImmediately = true
} = {}) {
  stopDeviceActivityMonitor({ clear: false });
  if (pollImmediately) void pollDeviceActivity();
  pollTimer = setInterval(() => {
    if (typeof document !== 'undefined' && document.hidden) return;
    void pollDeviceActivity();
  }, intervalMs);
  if (typeof document !== 'undefined') {
    visibilityHandler = () => {
      if (!document.hidden) void pollDeviceActivity();
    };
    document.addEventListener('visibilitychange', visibilityHandler);
  }
}

export function stopDeviceActivityMonitor({ clear = true } = {}) {
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = null;
  pollAbortController?.abort();
  pollAbortController = null;
  pollInFlight = false;
  pollPromise = null;
  activePollIncludesTelemetry = false;
  queuedFullTelemetryPoll = false;
  if (visibilityHandler && typeof document !== 'undefined') {
    document.removeEventListener('visibilitychange', visibilityHandler);
  }
  visibilityHandler = null;
  if (clear) {
    telemetryMode = false;
    clearDeviceActivity();
  }
}
