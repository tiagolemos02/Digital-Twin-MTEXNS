import { buildFiwareHeaders } from './api-client.js';

function normalizeDeviceId(entry = {}) {
  const value = entry.deviceId ?? entry.device_id ?? entry.id;
  if (value == null) return '';
  return String(value).trim();
}

export async function loadDiscoveredDevices({ fetchImpl = globalThis.fetch } = {}) {
  if (typeof fetchImpl !== 'function') {
    throw new TypeError('A fetch implementation is required.');
  }

  const response = await fetchImpl('/bff/portal/discovered-devices', {
    method: 'GET',
    headers: buildFiwareHeaders(),
    credentials: 'include'
  });
  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(payload.error || `Discovery request failed with status ${response.status}.`);
  }

  const entries = Array.isArray(payload.devices) ? payload.devices : [];
  const unique = new Map();
  entries.forEach((entry) => {
    const deviceId = normalizeDeviceId(entry);
    if (deviceId) unique.set(deviceId, { ...entry, deviceId });
  });

  return Array.from(unique.values());
}
