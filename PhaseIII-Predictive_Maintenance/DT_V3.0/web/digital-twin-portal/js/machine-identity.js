export const ASSET_ID_MIN_LENGTH = 2;
export const ASSET_ID_MAX_LENGTH = 20;
export const ASSET_ID_PATTERN = /^[A-Za-z0-9_-]+$/;

export const MACHINE_IDENTITY_PALETTE = Object.freeze([
  { name: 'Deep teal', hex: '#2f6f6d' },
  { name: 'Muted indigo', hex: '#4c5e8a' },
  { name: 'Plum', hex: '#72546f' },
  { name: 'Burgundy', hex: '#7a4651' },
  { name: 'Steel', hex: '#607481' },
  { name: 'Olive', hex: '#6c7350' },
  { name: 'Copper', hex: '#8a6248' },
  { name: 'Graphite', hex: '#525458' }
]);

function trimmed(value) {
  return String(value ?? '').trim();
}

export function validateAssetId(value) {
  const normalized = trimmed(value);
  if (!normalized) {
    return { valid: false, value: '', error: 'Asset ID is required.' };
  }
  if (normalized.length < ASSET_ID_MIN_LENGTH || normalized.length > ASSET_ID_MAX_LENGTH) {
    return {
      valid: false,
      value: normalized,
      error: `Asset ID must contain between ${ASSET_ID_MIN_LENGTH} and ${ASSET_ID_MAX_LENGTH} characters.`
    };
  }
  if (!ASSET_ID_PATTERN.test(normalized)) {
    return {
      valid: false,
      value: normalized,
      error: 'Asset ID may contain only letters, numbers, hyphens, and underscores.'
    };
  }
  return { valid: true, value: normalized, error: '' };
}

export function assetIdKey(value) {
  return trimmed(value).toLowerCase();
}

export function resolveAssetIdentity({
  canonical = '',
  snakeCase = '',
  upperCase = '',
  legacyModel = '',
  deviceId = ''
} = {}) {
  const candidates = [
    ['assetId', canonical],
    ['asset_id', snakeCase],
    ['assetID', upperCase],
    ['model', legacyModel]
  ];
  const match = candidates.find(([, value]) => trimmed(value));
  const source = match?.[0] || '';
  const assetId = trimmed(match?.[1]);
  const assetIdMissing = !source || source === 'model';
  return {
    assetId,
    assetIdSource: source,
    assetIdMissing,
    assetPlateLabel: assetIdMissing
      ? (trimmed(deviceId) || 'Machine')
      : assetId
  };
}

export function findAssetIdConflict(machines, value, ignoredDeviceId = '') {
  const requestedKey = assetIdKey(value);
  if (!requestedKey) return null;
  return (Array.isArray(machines) ? machines : []).find((machine) => {
    if (trimmed(machine?.deviceId) === trimmed(ignoredDeviceId)) return false;
    if (machine?.assetIdMissing) return false;
    return assetIdKey(machine?.assetId) === requestedKey;
  }) || null;
}

export function getAssetPlateLabel(machine = {}) {
  if (machine.assetIdMissing) {
    return trimmed(machine.deviceId) || 'Machine';
  }
  return trimmed(machine.assetPlateLabel)
    || trimmed(machine.assetId)
    || trimmed(machine.deviceId)
    || 'Machine';
}

export function getMachineDisplayLabel(machine = {}) {
  const deviceId = trimmed(machine.deviceId);
  const name = trimmed(machine.friendlyName);
  const assetId = trimmed(machine.assetId);
  const identity = machine.assetIdMissing || !assetId ? 'Asset ID missing' : assetId;
  if (name && deviceId) return `${identity} — ${name} (${deviceId})`;
  if (name) return `${identity} — ${name}`;
  if (deviceId) return `${identity} — ${deviceId}`;
  return identity;
}

export function getMachineLabelDetails(machine = {}) {
  const assetId = trimmed(machine.assetId);
  const missing = machine.assetIdMissing || !assetId;
  return {
    title: trimmed(machine.friendlyName) || (!missing ? assetId : getAssetPlateLabel(machine)),
    assetId: missing ? 'Asset ID missing' : assetId,
    deviceId: trimmed(machine.deviceId) || '—',
    status: trimmed(machine.machineStatus?.name) || 'Unknown',
    missing
  };
}

export function getMachineIdentityPaletteEntry(machineOrIdentity) {
  const input = machineOrIdentity && typeof machineOrIdentity === 'object'
    ? (
        !machineOrIdentity.assetIdMissing && trimmed(machineOrIdentity.assetId)
          ? trimmed(machineOrIdentity.assetId)
          : trimmed(machineOrIdentity.deviceId)
      )
    : trimmed(machineOrIdentity);
  let hash = 0x811c9dc5;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return MACHINE_IDENTITY_PALETTE[(hash >>> 0) % MACHINE_IDENTITY_PALETTE.length];
}
