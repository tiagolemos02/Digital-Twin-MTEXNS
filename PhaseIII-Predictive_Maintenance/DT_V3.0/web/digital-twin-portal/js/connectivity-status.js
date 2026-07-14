export const CONNECTIVITY_ONLINE_THROUGH_MS = 2 * 60 * 1000;
export const CONNECTIVITY_OFFLINE_AFTER_MS = 10 * 60 * 1000;

export const CONNECTIVITY_DEFINITIONS = Object.freeze({
  online: Object.freeze({ state: 'online', label: 'Online', rgb: [4, 120, 87], text: '#065f46' }),
  stale: Object.freeze({ state: 'stale', label: 'Stale / Communication delayed', rgb: [180, 83, 9], text: '#92400e' }),
  offline: Object.freeze({ state: 'offline', label: 'Offline', rgb: [82, 82, 91], text: '#3f3f46' }),
  unknown: Object.freeze({ state: 'unknown', label: 'Unknown', rgb: [156, 163, 175], text: '#4b5563' })
});

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function getConnectivityDefinition(state) {
  return CONNECTIVITY_DEFINITIONS[state] || CONNECTIVITY_DEFINITIONS.unknown;
}

export function resolveConnectivity({
  lastContactMs = null,
  now = Date.now(),
  monitoringAvailable = true,
  reason = ''
} = {}) {
  if (!monitoringAvailable) {
    return {
      ...CONNECTIVITY_DEFINITIONS.unknown,
      label: 'Monitoring unavailable',
      ageMs: null,
      lastContactMs,
      reason: reason || 'monitoring-unavailable'
    };
  }

  if (!Number.isFinite(lastContactMs)) {
    return {
      ...CONNECTIVITY_DEFINITIONS.unknown,
      ageMs: null,
      lastContactMs: null,
      reason: reason || 'missing-iamalive'
    };
  }

  const ageMs = Math.max(0, Number(now) - lastContactMs);
  const definition = ageMs <= CONNECTIVITY_ONLINE_THROUGH_MS
    ? CONNECTIVITY_DEFINITIONS.online
    : ageMs <= CONNECTIVITY_OFFLINE_AFTER_MS
      ? CONNECTIVITY_DEFINITIONS.stale
      : CONNECTIVITY_DEFINITIONS.offline;

  return { ...definition, ageMs, lastContactMs, reason: '' };
}

export function formatConnectivityAge(ageMs) {
  if (!Number.isFinite(ageMs) || ageMs < 0) return 'Never';
  const minutes = Math.floor(ageMs / 60_000);
  if (minutes < 1) return 'less than a minute ago';
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? '' : 's'} ago`;
}

export function renderConnectivityBadge(connectivity = {}, extraClasses = '') {
  const definition = getConnectivityDefinition(connectivity.state);
  const label = String(connectivity.label || definition.label);
  const [r, g, b] = definition.rgb;
  const classes = ['connectivity-badge', `is-${definition.state}`, extraClasses].filter(Boolean).join(' ');
  const title = connectivity.ageMs == null
    ? label
    : `${label} · ${formatConnectivityAge(connectivity.ageMs)}`;
  return `<span class="${escapeHtml(classes)}" title="${escapeHtml(title)}">
    <span class="connectivity-badge-dot" style="--connectivity-rgb: ${r}, ${g}, ${b}"></span>
    ${escapeHtml(label)}
  </span>`;
}
