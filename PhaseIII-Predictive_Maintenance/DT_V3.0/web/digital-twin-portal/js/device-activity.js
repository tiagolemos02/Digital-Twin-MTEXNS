import { ENTITY_TYPE, sessionToken } from './config.js';
import { apiFetch } from './api-client.js';

export const OFFLINE_THRESHOLD_MS = 5 * 60 * 1000;

const activityStore = new Map();
let lastFetchMs = 0;

function toTimestamp(value) {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return Number.isFinite(value.getTime()) ? value.getTime() : null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? null : parsed;
  }
  if (typeof value === 'object') {
    if ('value' in value) return toTimestamp(value.value);
    if ('observedAt' in value) return toTimestamp(value.observedAt);
    if ('timestamp' in value) return toTimestamp(value.timestamp);
  }
  return null;
}

function bestTimestamp(...candidates) {
  for (const candidate of candidates) {
    const ts = toTimestamp(candidate);
    if (ts !== null) return ts;
  }
  return null;
}

function analyzeDevice(device = {}, now, offlineThresholdMs) {
  const entityId = device.id || '';
  if (!entityId) return null;

  let latestMs = bestTimestamp(device.TimeInstant, device.timeInstant, device.observedAt);
  let latestIso = latestMs !== null ? new Date(latestMs).toISOString() : '';
  let latestSource = latestMs !== null ? 'TimeInstant' : '';

  Object.entries(device).forEach(([attr, val]) => {
    if (attr === 'id' || attr === 'type' || attr.toLowerCase() === 'timeinstant') return;

    const attrTimestamp = bestTimestamp(
      val?.metadata?.timestamp?.value,
      val?.metadata?.timestamp,
      val?.metadata?.TimeInstant?.value,
      val?.metadata?.TimeInstant,
      val?.TimeInstant,
      val?.observedAt,
      val?.value?.observedAt
    );

    if (attrTimestamp !== null && (latestMs === null || attrTimestamp > latestMs)) {
      latestMs = attrTimestamp;
      latestIso = new Date(attrTimestamp).toISOString();
      latestSource = attr;
    }
  });

  const attributeCount = Object.keys(device).reduce((count, key) => {
    if (key === 'id' || key === 'type' || key.toLowerCase() === 'timeinstant') {
      return count;
    }
    return count + 1;
  }, 0);

  return {
    entityId,
    deviceId: device.device_id || device.deviceId || device.DeviceID || '',
    lastUpdateMs: latestMs,
    lastUpdateIso: latestIso,
    lastUpdateAttribute: latestSource,
    attributeCount,
    offlineThresholdMs,
    capturedAt: now
  };
}

export function updateActivityFromDevices(
  devices = [],
  { now = Date.now(), offlineThresholdMs = OFFLINE_THRESHOLD_MS } = {}
) {
  const byEntity = new Map();

  devices.forEach((device) => {
    const fingerprint = analyzeDevice(device, now, offlineThresholdMs);
    if (!fingerprint) return;

    byEntity.set(fingerprint.entityId, fingerprint);
    activityStore.set(fingerprint.entityId, fingerprint);

    if (fingerprint.deviceId && fingerprint.deviceId !== fingerprint.entityId) {
      activityStore.set(fingerprint.deviceId, fingerprint);
    }
  });

  if (typeof window !== 'undefined') {
    window.dispatchEvent(
      new CustomEvent('device-activity-updated', { detail: { timestamp: now } })
    );
  }

  return byEntity;
}

export function getDeviceActivity(
  id,
  { now = Date.now(), offlineThresholdMs = OFFLINE_THRESHOLD_MS } = {}
) {
  if (!id) return null;
  const record = activityStore.get(id);
  if (!record) return null;

  const threshold = offlineThresholdMs ?? record.offlineThresholdMs ?? OFFLINE_THRESHOLD_MS;
  const lastUpdateMs = record.lastUpdateMs ?? null;
  const ageMs = lastUpdateMs === null ? null : Math.max(0, now - lastUpdateMs);
  const offline = lastUpdateMs === null ? true : ageMs >= threshold;

  return {
    ...record,
    offlineThresholdMs: threshold,
    ageMs,
    offline,
    status: offline ? 'Offline' : 'Online'
  };
}

export function getDeviceStatus(id, options) {
  const activity = getDeviceActivity(id, options);
  return activity ? activity.status : null;
}

export function getLastActivityFetchTime() {
  return lastFetchMs;
}

export async function refreshDeviceActivity({
  entityType = ENTITY_TYPE,
  now = Date.now(),
  offlineThresholdMs = OFFLINE_THRESHOLD_MS
} = {}) {
  if (!sessionToken) {
    activityStore.clear();
    lastFetchMs = 0;
    return new Map();
  }

  const resp = await apiFetch(
    `/v2/entities?type=${encodeURIComponent(entityType)}&options=keyValues`
  );

  if (!resp.ok) {
    throw new Error(`Failed to refresh device activity (HTTP ${resp.status})`);
  }

  const devices = await resp.json();

  if (!Array.isArray(devices)) {
    activityStore.clear();
    lastFetchMs = now;
    return new Map();
  }

  const activityMap = updateActivityFromDevices(devices, { now, offlineThresholdMs });
  lastFetchMs = now;
  return activityMap;
}
