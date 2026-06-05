const STATUS_DEFINITIONS = [
  { name: 'Unknown', code: 999, rgb: [158, 158, 158], text: '#3f3f46' },
  { name: 'Uninitialized', code: 7, rgb: [189, 189, 189], text: '#3f3f46' },
  { name: 'Standby', code: 12, rgb: [245, 245, 245], text: '#3f3f46' },
  { name: 'Spinning', code: 303, rgb: [56, 142, 60], text: '#166534' },
  { name: 'Shutdown', code: 13, rgb: [117, 117, 117], text: '#3f3f46' },
  { name: 'Sequence interrupted', code: 8, rgb: [255, 193, 7], text: '#92400e' },
  { name: 'Reserved', code: 300, rgb: [189, 189, 189], text: '#3f3f46' },
  { name: 'Ready to spin', code: 302, rgb: [46, 125, 50], text: '#166534' },
  { name: 'Ready to print', code: 202, rgb: [46, 125, 50], text: '#166534' },
  { name: 'Printing error', code: 206, rgb: [211, 47, 47], text: '#991b1b' },
  { name: 'Printing', code: 203, rgb: [56, 142, 60], text: '#166534' },
  { name: 'Preparing to spin', code: 301, rgb: [255, 160, 0], text: '#9a3412' },
  { name: 'Preparing to print', code: 201, rgb: [255, 160, 0], text: '#9a3412' },
  { name: 'Paused', code: 9, rgb: [255, 193, 7], text: '#92400e' },
  { name: 'Manual', code: 3, rgb: [25, 118, 210], text: '#1d4ed8' },
  { name: 'Maintenance', code: 11, rgb: [25, 118, 210], text: '#1d4ed8' },
  { name: 'Invalid', code: 0, rgb: [211, 47, 47], text: '#991b1b' },
  { name: 'Initializing error', code: 15, rgb: [211, 47, 47], text: '#991b1b' },
  { name: 'Initializing', code: 6, rgb: [66, 165, 245], text: '#0369a1' },
  { name: 'Idle', code: 2, rgb: [129, 199, 132], text: '#166534' },
  { name: 'Emergency', code: 1, rgb: [198, 40, 40], text: '#991b1b' },
  { name: 'Diagnostic', code: 5, rgb: [30, 136, 229], text: '#1d4ed8' },
  { name: 'Critical error', code: 14, rgb: [183, 28, 28], text: '#7f1d1d' },
  { name: 'Cleaning error', code: 205, rgb: [211, 47, 47], text: '#991b1b' },
  { name: 'Cleaning', code: 200, rgb: [102, 187, 106], text: '#166534' }
];

const STATUS_BY_CODE = new Map(STATUS_DEFINITIONS.map((status) => [status.code, status]));
const UNKNOWN_STATUS = STATUS_BY_CODE.get(999);

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function normalizeAttributeName(name) {
  return String(name || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function extractRawValue(value) {
  if (value && typeof value === 'object') {
    if ('value' in value) return extractRawValue(value.value);
  }
  return value;
}

export function getMachineStatusOptions() {
  return STATUS_DEFINITIONS.map((status) => ({ ...status }));
}

export function isMachineStatusAttributeName(name) {
  return normalizeAttributeName(name) === 'machinestatus';
}

export function getMachineStatusByCode(code) {
  const parsed = Number.parseInt(String(code ?? '').trim(), 10);
  return STATUS_BY_CODE.get(parsed) || UNKNOWN_STATUS;
}

export function getMachineStatusLabel(status = UNKNOWN_STATUS) {
  return `${status.name} (${status.code})`;
}

export function resolveMachineStatusFromValue(value) {
  const raw = extractRawValue(value);
  return getMachineStatusByCode(raw);
}

export function extractMachineStatusFromEntity(entity = {}) {
  for (const [attr, value] of Object.entries(entity || {})) {
    if (!isMachineStatusAttributeName(attr)) continue;
    return resolveMachineStatusFromValue(value);
  }
  return UNKNOWN_STATUS;
}

export function renderMachineStatusBadge(status = UNKNOWN_STATUS, extraClasses = '') {
  const resolved = getMachineStatusByCode(status?.code);
  const [r, g, b] = resolved.rgb;
  const classes = [
    'inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium',
    extraClasses
  ].filter(Boolean).join(' ');
  const badgeStyle = [
    `color: ${resolved.text}`,
    `background-color: rgba(${r}, ${g}, ${b}, 0.14)`,
    `border: 1px solid rgba(${r}, ${g}, ${b}, 0.45)`
  ].join('; ');
  const dotStyle = [
    `background-color: rgb(${r}, ${g}, ${b})`,
    `border-color: rgba(0, 0, 0, ${resolved.code === 12 ? '0.35' : '0.12'})`
  ].join('; ');
  return `<span class="${classes}" style="${badgeStyle}">
    <span class="inline-block w-2 h-2 rounded-full border mr-1.5" style="${dotStyle}"></span>
    ${escapeHtml(getMachineStatusLabel(resolved))}
  </span>`;
}

export function renderMachineStatusOptions(selectedCode = UNKNOWN_STATUS.code) {
  const selected = getMachineStatusByCode(selectedCode).code;
  return STATUS_DEFINITIONS
    .map((status) => {
      const isSelected = status.code === selected ? ' selected' : '';
      return `<option value="${status.code}"${isSelected}>${escapeHtml(getMachineStatusLabel(status))}</option>`;
    })
    .join('');
}

export const DEFAULT_MACHINE_STATUS = UNKNOWN_STATUS;
