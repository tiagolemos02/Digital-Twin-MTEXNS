import {
  serviceGroupForm,
  serviceGroupApiKey,
  serviceGroupCbroker,
  serviceGroupResource,
  serviceGroupEntityType,
  serviceGroupName,
  serviceGroupDescription,
  serviceGroupMsg,
  serviceGroupsTableBody,
  serviceGroupCount,
  machineForm,
  machineDeviceId,
  machineName,
  machineAssetId,
  machineDescription,
  machineServiceGroup,
  machineStatus,
  attributeModeToggle,
  attributeModeKnob,
  attributeManualContainer,
  attributeAutomaticContainer,
  machineAttributesManual,
  attributeObjectId,
  attributeName,
  attributeType,
  attributeAddBtn,
  attributeAutoList,
  staticAttributesModeToggle,
  staticAttributesModeKnob,
  staticAttributesManualContainer,
  machineStaticAttributesManual,
  staticAttributesAutomaticContainer,
  staticAttributeName,
  staticAttributeType,
  staticAttributeValue,
  staticAttributeAddBtn,
  staticAttributeAutoList,
  machineMsg,
  machinesTableBody,
  machineCount,
  machinePayloadSummary,
  machinePayloadPreview,
  machinePayloadRefresh,
  deviceIdPickerWrapper,
  deviceIdPickerToggle,
  deviceIdPickerPanel,
  deviceIdPickerList,
  deviceIdPickerChevron
} from './dom-elements.js';
import {
  IOT_AGENT_CBROKER,
  IOT_AGENT_RESOURCE,
  IOT_AGENT_TRANSPORT,
  IOT_AGENT_PROTOCOL,
  FIWARE_SERVICE,
  FIWARE_SERVICEPATH,
  ENTITY_TYPE,
  sessionToken
} from './config.js';
import { apiFetch, buildFiwareHeaders } from './api-client.js';
import {
  refreshDeviceActivity,
  getDeviceActivity,
  getLastActivityFetchTime
} from './device-activity.js';
import {
  DEFAULT_MACHINE_STATUS,
  getMachineStatusByCode,
  renderMachineStatusBadge,
  renderMachineStatusOptions
} from './machine-status.js';
import { formatResponseError, formatThrownError } from './error-messages.js';
import {
  findAssetIdConflict,
  resolveAssetIdentity,
  validateAssetId
} from './machine-identity.js';
import {
  renderConnectivityBadge,
  resolveConnectivity
} from './connectivity-status.js';
import { validateIAmAliveMapping } from './machine-telemetry.js';

let serviceGroups = [];
let machines = [];
let orionFallbackMachines = [];
let allIotDevices = [];
const registeredMachineSubscribers = new Set();
let loadingServiceGroups = false;
let loadingMachines = false;
const ACTIVITY_REFRESH_MIN_INTERVAL_MS = 30 * 1000;
const MACHINE_STATUS_REFRESH_INTERVAL_MS = 60 * 1000;
let machineStatusIntervalId = null;
let telemetryAttributeEntries = [];
let staticAttributeEntries = [];
let telemetryInputMode = 'manual';
let staticAttributesInputModeState = 'manual';
let editTelemetryAttributeEntries = [];
let editStaticAttributeEntries = [];
let editTelemetryInputMode = 'manual';
let editStaticInputMode = 'manual';
let devicePickerRefreshToken = 0;

const LOCAL_REGISTERED_KEY = 'dt_portal_registered_devices';
const LOCAL_REGISTERED_METADATA_KEY = 'dt_portal_registered_machine_metadata';
const PORTAL_TELEMETRY_ATTRS_STATIC_NAME = 'portalTelemetryAttributes';
const PORTAL_TELEMETRY_ATTRS_ENCODING_PREFIX = 'b64url:';

function getLocalRegisteredIds() {
  try {
    const raw = localStorage.getItem(LOCAL_REGISTERED_KEY);
    return new Set(raw ? JSON.parse(raw) : []);
  } catch {
    return new Set();
  }
}

function addLocalRegisteredId(deviceId) {
  if (!deviceId) return;
  const ids = getLocalRegisteredIds();
  ids.add(deviceId);
  localStorage.setItem(LOCAL_REGISTERED_KEY, JSON.stringify([...ids]));
}

function removeLocalRegisteredId(deviceId) {
  if (!deviceId) return;
  const ids = getLocalRegisteredIds();
  ids.delete(deviceId);
  localStorage.setItem(LOCAL_REGISTERED_KEY, JSON.stringify([...ids]));
}

function getLocalRegisteredMachineMetadata() {
  try {
    const raw = localStorage.getItem(LOCAL_REGISTERED_METADATA_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function setLocalRegisteredMachineMetadata(nextMachines = []) {
  try {
    const payload = nextMachines
      .filter((machine) => machine?.entityName)
      .map((machine) => ({
        deviceId: machine.deviceId || '',
        entityName: machine.entityName || '',
        entityType: machine.entityType || ENTITY_TYPE,
        friendlyName: machine.friendlyName || '',
        model: machine.model || '',
        assetId: machine.assetId || '',
        assetIdSource: machine.assetIdSource || '',
        assetIdMissing: Boolean(machine.assetIdMissing),
        assetPlateLabel: machine.assetPlateLabel || '',
        notes: machine.notes || '',
        attributes: normalizeTelemetryMetadata(machine.attributes)
      }));
    localStorage.setItem(LOCAL_REGISTERED_METADATA_KEY, JSON.stringify(payload));
  } catch {
    // Local metadata is only a viewer fallback; ignore storage failures.
  }
}

function removeLocalRegisteredMachineMetadata(deviceId) {
  if (!deviceId) return;
  const next = getLocalRegisteredMachineMetadata()
    .filter((machine) => machine.deviceId !== deviceId);
  localStorage.setItem(LOCAL_REGISTERED_METADATA_KEY, JSON.stringify(next));
}

function getPortalRegisteredDeviceIds(devices = allIotDevices) {
  return new Set(
    devices
      .filter((device) => device?.isPortalRegistered && device.deviceId)
      .map((device) => device.deviceId)
  );
}

function getVisibleMachines() {
  return machines.length ? machines : orionFallbackMachines;
}

function buildRegisteredMachinesSnapshot() {
  return getVisibleMachines().map((machine) => ({
    ...machine,
    attributes: Array.isArray(machine.attributes)
      ? machine.attributes.map((attr) => ({ ...attr }))
      : [],
    staticAttributes: Array.isArray(machine.staticAttributes)
      ? machine.staticAttributes.map((attr) => ({ ...attr }))
      : [],
    machineStatus: machine.machineStatus ? { ...machine.machineStatus } : { ...DEFAULT_MACHINE_STATUS },
    connectivity: machine.connectivity
      ? { ...machine.connectivity }
      : resolveConnectivity({ reason: 'missing-iamalive' })
  }));
}

function notifyRegisteredMachines() {
  const snapshot = buildRegisteredMachinesSnapshot();
  registeredMachineSubscribers.forEach((listener) => {
    try {
      listener(snapshot);
    } catch (error) {
      console.error('Registered machine subscriber failed:', error);
    }
  });
}

const SYSTEM_STATIC_ATTR_NAMES = new Set([
  'friendlyName', 'assetId', 'asset_id', 'assetID', 'model', 'notes', 'operationalStatus',
  'machineStatusPlaceholderCode', 'machineStatusPlaceholderName',
  'serviceGroupKey', 'serviceGroupResource', 'serviceGroupApikey',
  'serviceGroupFiware', 'serviceGroupSubservice',
  PORTAL_TELEMETRY_ATTRS_STATIC_NAME
]);
const MANUAL_GRADIENT = ['#1E3A8A', '#4C51BF'];
const AUTOMATIC_GRADIENT = ['#10B981', '#34D399'];

const FIWARE_CONTEXT_BROKER_URLS = Array.from(
  new Set(
    [
      'http://orion:1026',
      'http://orion-v2:1026',
      'http://orion-ld:1026',
      'https://orion.lab.fiware.org:1026',
      'https://orion-ld.lab.fiware.org:1026',
      IOT_AGENT_CBROKER
    ]
      .filter(Boolean)
      .map((url) => url.trim())
  )
);

const NORMALIZED_ALLOWED_CBROKER_URLS = new Set(
  FIWARE_CONTEXT_BROKER_URLS.map((url) => normalizeCbrokerUrl(url))
);

const ALLOWED_CBROKER_DISPLAY = FIWARE_CONTEXT_BROKER_URLS.join(', ');

const IOT_CONTEXTS = {
  loadServices: {
    system: 'IoT Agent',
    action: 'load service groups',
    endpoint: 'GET /bff/fiware/iot/services',
    recovery: 'Required permission: IoT services read. Ask an admin to grant it for this FIWARE service.'
  },
  loadDevices: {
    system: 'IoT Agent',
    action: 'load machine inventory',
    endpoint: 'GET /bff/fiware/iot/devices',
    recovery: 'Required permission: IoT devices read. Ask an admin to grant it for this FIWARE service.'
  },
  createService: {
    system: 'IoT Agent',
    action: 'register the service group',
    endpoint: 'POST /bff/fiware/iot/services',
    recovery: 'Check the Context Broker URL, resource path, entity type, and IoT services write permission.'
  },
  deleteService: {
    system: 'IoT Agent',
    action: 'delete the service group',
    endpoint: 'DELETE /bff/fiware/iot/services',
    recovery: 'Confirm the service group still exists and that your role can delete IoT services.'
  },
  registerMachine: {
    system: 'IoT Agent',
    action: 'register the machine',
    endpoint: 'POST or PUT /bff/fiware/iot/devices',
    recovery: 'Check the payload preview, selected service group, and IoT devices write permission.'
  },
  updateMachine: {
    system: 'IoT Agent',
    action: 'update the machine',
    endpoint: 'PUT /bff/fiware/iot/devices/{deviceId}',
    recovery: 'Check the edit payload, selected service group, and IoT devices write permission.'
  },
  deleteMachine: {
    system: 'IoT Agent',
    action: 'delete the machine',
    endpoint: 'DELETE /bff/fiware/iot/devices/{deviceId}',
    recovery: 'Confirm the device still exists and that your role can delete IoT devices.'
  }
};

function getBrokerLabel(value) {
  if (!value) return '-';
  try {
    const parsed = new URL(value);
    return parsed.hostname || '-';
  } catch (_err) {
    const raw = String(value).replace(/^https?:\/\//i, '');
    const segment = raw.split(/[/:]/)[0];
    return segment || '-';
  }
}

/**
 * Initialise inventory module: load current state and wire form handlers.
 */
export function initInventory() {
  serviceGroupForm?.addEventListener('submit', handleServiceGroupSubmit);
  machineForm?.addEventListener('submit', handleMachineSubmit);
  serviceGroupName?.addEventListener('blur', populateApikeyFromName);
  serviceGroupsTableBody?.addEventListener('click', handleServiceGroupTableClick);
  machinesTableBody?.addEventListener('click', handleMachinesTableClick);
  if (typeof window !== 'undefined') {
    window.addEventListener('device-activity-updated', handleDeviceActivityUpdated);
  }
  setupToggleControl({
    toggleElement: attributeModeToggle,
    getMode: () => telemetryInputMode,
    setMode: (mode) => {
      updateAttributeInputMode(mode);
      hideMessage(machineMsg);
      updateMachinePayloadPreview();
    },
    preview: previewTelemetryProgress
  });
  setupToggleControl({
    toggleElement: staticAttributesModeToggle,
    getMode: () => staticAttributesInputModeState,
    setMode: (mode) => {
      updateStaticAttributeInputMode(mode);
      hideMessage(machineMsg);
      updateMachinePayloadPreview();
    },
    preview: previewStaticProgress
  });
  attributeAddBtn?.addEventListener('click', handleAddTelemetryAttribute);
  staticAttributeAddBtn?.addEventListener('click', handleAddStaticAttribute);
  attributeAutoList?.addEventListener('click', handleTelemetryAttributeListClick);
  staticAttributeAutoList?.addEventListener('click', handleStaticAttributeListClick);
  setupMachineStatusControls();
  setupMachinePayloadPreview();
  initAssetIdDialogs();

  machineServiceGroup?.addEventListener('change', handleServiceGroupPickerChange);
  deviceIdPickerToggle?.addEventListener('click', () => {
    const open = deviceIdPickerToggle.getAttribute('aria-expanded') === 'true';
    deviceIdPickerToggle.setAttribute('aria-expanded', String(!open));
    deviceIdPickerPanel?.classList.toggle('hidden', open);
    deviceIdPickerChevron?.classList.toggle('rotate-90', !open);
  });
  deviceIdPickerList?.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-action="pick-device-id"]');
    if (btn && machineDeviceId) {
      machineDeviceId.value = btn.getAttribute('data-device-id') || '';
      updateMachinePayloadPreview();
    }
  });

  applyServiceDefaults();
  initializeAttributeInputs();
  startMachineStatusTicker();
  initEditModals();
  updateMachinePayloadPreview();
  void loadInventory();
}

/**
 * Public helper to reload inventory data on demand.
 */
export function refreshInventory() {
  return loadInventory();
}

/**
 * Load service groups and devices from the IoT Agent.
 */
async function loadInventory() {
  if (!sessionToken) {
    renderLoginRequiredState();
    return;
  }

  await fetchServiceGroups();
  renderServiceGroups();
  refreshServiceGroupOptions();

  await fetchMachines();
  renderMachines();
  // Refresh picker in case a service group was already selected when machines loaded.
  await handleServiceGroupPickerChange({ refreshDevices: false });
  updateMachinePayloadPreview();
}

function startMachineStatusTicker() {
  if (machineStatusIntervalId || typeof setInterval !== 'function') return;
  if (!machinesTableBody) return;

  machineStatusIntervalId = setInterval(() => {
    if (!machines.length || loadingMachines) return;
    renderMachines();
  }, MACHINE_STATUS_REFRESH_INTERVAL_MS);
}

/**
 * Render placeholder tables when authentication is missing.
 */
function renderLoginRequiredState() {
  serviceGroups = [];
  machines = [];
  notifyRegisteredMachines();
  updateCounts();

  if (serviceGroupsTableBody) {
    serviceGroupsTableBody.innerHTML =
      "<tr><td colspan='6' class='px-5 py-4 text-center text-sm text-gray-500'>Sign in to view service groups.</td></tr>";
  }

  if (machinesTableBody) {
    machinesTableBody.innerHTML =
      "<tr><td colspan='5' class='px-5 py-4 text-center text-sm text-gray-500'>Sign in to view IoT devices.</td></tr>";
  }

  hideMessage(serviceGroupMsg);
  hideMessage(machineMsg);
}

function clampProgress(value, min = 0, max = 1) {
  if (Number.isNaN(value)) return min;
  return Math.min(max, Math.max(min, value));
}

function hexToRgb(color) {
  const cleaned = color.replace('#', '');
  const bigint = Number.parseInt(cleaned, 16);
  return [(bigint >> 16) & 255, (bigint >> 8) & 255, bigint & 255];
}

function mixColors(colorA, colorB, t) {
  const [r1, g1, b1] = hexToRgb(colorA);
  const [r2, g2, b2] = hexToRgb(colorB);
  const mix = (c1, c2) => Math.round(c1 + (c2 - c1) * t);
  return `rgb(${mix(r1, r2)}, ${mix(g1, g2)}, ${mix(b1, b2)})`;
}

function applyToggleVisual({ toggle, progress, knob }) {
  if (!toggle) return;
  const clamped = clampProgress(progress);
  const progressValue = clamped.toFixed(3);
  const startColor = mixColors(MANUAL_GRADIENT[0], AUTOMATIC_GRADIENT[0], clamped);
  const endColor = mixColors(MANUAL_GRADIENT[1], AUTOMATIC_GRADIENT[1], clamped);
  toggle.style.background = `linear-gradient(to right, ${startColor}, ${endColor})`;
  toggle.style.setProperty('--toggle-progress', progressValue);

  if (knob) {
    const trackWidth = toggle.clientWidth || 0;
    const knobWidth = knob.offsetWidth || 0;
    const knobStyles =
      typeof window !== 'undefined' && window.getComputedStyle ? window.getComputedStyle(knob) : null;
    const leftOffset = knobStyles ? Number.parseFloat(knobStyles.left) || 0 : 0;
    const maxShift = Math.max(0, trackWidth - knobWidth - leftOffset * 2);
    knob.style.transform = `translateX(${(maxShift * clamped).toFixed(2)}px)`;
  }
}

function previewTelemetryProgress(progress) {
  applyToggleVisual({
    toggle: attributeModeToggle,
    progress,
    knob: attributeModeKnob
  });
}

function previewStaticProgress(progress) {
  applyToggleVisual({
    toggle: staticAttributesModeToggle,
    progress,
    knob: staticAttributesModeKnob
  });
}

function setupToggleControl({ toggleElement, getMode, setMode, preview }) {
  if (!toggleElement) return;
  let dragging = false;
  let pointerId = null;
  let suppressClick = false;
  let startProgress = 0;
  let hasMoved = false;

  const computeProgress = (event) => {
    const rect = toggleElement.getBoundingClientRect();
    if (!rect.width) return getMode() === 'automatic' ? 1 : 0;
    const ratio = (event.clientX - rect.left) / rect.width;
    return clampProgress(ratio);
  };

  toggleElement.addEventListener('pointerdown', (event) => {
    event.preventDefault();
    dragging = true;
    pointerId = event.pointerId;
    toggleElement.setPointerCapture(pointerId);
    suppressClick = true;
    startProgress = computeProgress(event);
    hasMoved = false;
    preview(startProgress);
  });

  toggleElement.addEventListener('pointermove', (event) => {
    if (!dragging) return;
    const current = computeProgress(event);
    if (!hasMoved && Math.abs(current - startProgress) > 0.05) {
      hasMoved = true;
    }
    preview(current);
  });

  const finishDrag = (event, cancelled = false) => {
    if (!dragging) return;
    const progress = cancelled ? (getMode() === 'automatic' ? 1 : 0) : computeProgress(event);
    if (pointerId !== null) {
      toggleElement.releasePointerCapture(pointerId);
    }
    dragging = false;
    pointerId = null;

    if (cancelled) {
      preview(getMode() === 'automatic' ? 1 : 0);
      suppressClick = false;
    } else {
      if (!hasMoved) {
        const nextMode = getMode() === 'manual' ? 'automatic' : 'manual';
        setMode(nextMode);
      } else {
        setMode(progress >= 0.5 ? 'automatic' : 'manual');
      }
      suppressClick = true;
      setTimeout(() => {
        suppressClick = false;
      }, 150);
    }
  };

  toggleElement.addEventListener('pointerup', (event) => finishDrag(event, false));
  toggleElement.addEventListener('pointercancel', (event) => finishDrag(event, true));

  toggleElement.addEventListener('click', (event) => {
    if (suppressClick) {
      event.preventDefault();
      suppressClick = false;
      return;
    }
    const nextMode = getMode() === 'manual' ? 'automatic' : 'manual';
    setMode(nextMode);
  });

  toggleElement.addEventListener('keydown', (event) => {
    if (event.key !== ' ' && event.key !== 'Enter') return;
    event.preventDefault();
    const nextMode = getMode() === 'manual' ? 'automatic' : 'manual';
    setMode(nextMode);
  });
}

function initializeAttributeInputs() {
  resetAttributeInputs();
  attributeModeToggle?.setAttribute('aria-checked', 'false');
  staticAttributesModeToggle?.setAttribute('aria-checked', 'false');
}

function setupMachineStatusControls() {
  populateMachineStatusSelect(machineStatus);
  updateMachineStatusPreview('machineStatusPreview', machineStatus?.value);
  machineStatus?.addEventListener('change', () => {
    updateMachineStatusPreview('machineStatusPreview', machineStatus.value);
  });

  const editStatus = document.getElementById('editMachineStatus');
  populateMachineStatusSelect(editStatus);
  updateMachineStatusPreview('editMachineStatusPreview', editStatus?.value);
  editStatus?.addEventListener('change', () => {
    updateMachineStatusPreview('editMachineStatusPreview', editStatus.value);
  });
}

function populateMachineStatusSelect(select, selectedCode = DEFAULT_MACHINE_STATUS.code) {
  if (!select) return;
  select.innerHTML = renderMachineStatusOptions(selectedCode);
  select.value = String(getMachineStatusByCode(selectedCode).code);
}

function updateMachineStatusPreview(previewId, code) {
  const preview = document.getElementById(previewId);
  if (!preview) return;
  preview.innerHTML = renderMachineStatusBadge(getMachineStatusByCode(code));
}

function getSelectedMachineStatusPlaceholder(select) {
  return getMachineStatusByCode(select?.value || DEFAULT_MACHINE_STATUS.code);
}

function resetAttributeInputs() {
  telemetryAttributeEntries = [];
  staticAttributeEntries = [];
  if (machineAttributesManual) {
    machineAttributesManual.value = '';
  }
  if (machineStaticAttributesManual) {
    machineStaticAttributesManual.value = '';
  }
  clearTelemetryAttributeFields();
  clearStaticAttributeFields();
  updateAttributeInputMode('manual');
  updateStaticAttributeInputMode('manual');
  renderTelemetryAttributeList();
  renderStaticAttributeList();
}

function updateAttributeInputMode(mode = 'manual') {
  telemetryInputMode = mode === 'automatic' ? 'automatic' : 'manual';
  attributeManualContainer?.classList.toggle('hidden', telemetryInputMode === 'automatic');
  attributeAutomaticContainer?.classList.toggle('hidden', telemetryInputMode !== 'automatic');
  const isAutomatic = telemetryInputMode === 'automatic';

  if (attributeModeToggle) {
    attributeModeToggle.dataset.mode = telemetryInputMode;
    attributeModeToggle.setAttribute('aria-checked', isAutomatic ? 'true' : 'false');
  }
  applyToggleVisual({
    toggle: attributeModeToggle,
    progress: isAutomatic ? 1 : 0,
    knob: attributeModeKnob
  });
}

function updateStaticAttributeInputMode(mode = 'manual') {
  staticAttributesInputModeState = mode === 'automatic' ? 'automatic' : 'manual';
  const isAutomatic = staticAttributesInputModeState === 'automatic';

  staticAttributesManualContainer?.classList.toggle('hidden', isAutomatic);
  staticAttributesAutomaticContainer?.classList.toggle('hidden', !isAutomatic);

  if (staticAttributesModeToggle) {
    staticAttributesModeToggle.dataset.mode = staticAttributesInputModeState;
    staticAttributesModeToggle.setAttribute('aria-checked', isAutomatic ? 'true' : 'false');
  }
  applyToggleVisual({
    toggle: staticAttributesModeToggle,
    progress: isAutomatic ? 1 : 0,
    knob: staticAttributesModeKnob
  });
}

function toggleTelemetryMode() {
  const nextMode = telemetryInputMode === 'manual' ? 'automatic' : 'manual';
  updateAttributeInputMode(nextMode);
}

function toggleStaticAttributeMode() {
  const nextMode = staticAttributesInputModeState === 'manual' ? 'automatic' : 'manual';
  updateStaticAttributeInputMode(nextMode);
}

function clearTelemetryAttributeFields() {
  if (attributeObjectId) attributeObjectId.value = '';
  if (attributeName) attributeName.value = '';
  if (attributeType) attributeType.value = '';
}

function clearStaticAttributeFields() {
  if (staticAttributeName) staticAttributeName.value = '';
  if (staticAttributeType) staticAttributeType.value = '';
  if (staticAttributeValue) staticAttributeValue.value = '';
}

function handleAddTelemetryAttribute(event) {
  event.preventDefault();
  hideMessage(machineMsg);
  if (telemetryInputMode !== 'automatic') {
    showMessage(machineMsg, 'Toggle to Automatic builder to add telemetry attributes.');
    return;
  }

  const objectId = attributeObjectId?.value.trim() || '';
  const name = attributeName?.value.trim() || '';
  const type = attributeType?.value.trim() || '';

  if (!objectId || !name || !type) {
    showMessage(machineMsg, 'Provide object ID, name, and type for the telemetry attribute.');
    return;
  }

  telemetryAttributeEntries.push({ object_id: objectId, name, type });
  renderTelemetryAttributeList();
  clearTelemetryAttributeFields();
  updateMachinePayloadPreview();
}

function handleTelemetryAttributeListClick(event) {
  const target = event.target;
  if (!(target instanceof Element)) return;
  const button = target.closest('[data-action="remove-telemetry-attribute"]');
  if (!button) return;
  event.preventDefault();
  const index = Number.parseInt(button.getAttribute('data-index') || '', 10);
  if (Number.isNaN(index)) return;

  telemetryAttributeEntries.splice(index, 1);
  renderTelemetryAttributeList();
  updateMachinePayloadPreview();
}

function renderTelemetryAttributeList() {
  if (!attributeAutoList) return;
  if (!telemetryAttributeEntries.length) {
    attributeAutoList.innerHTML =
      '<li class="px-3 py-2 text-xs text-gray-500">No attributes added yet.</li>';
    return;
  }

  attributeAutoList.innerHTML = telemetryAttributeEntries
    .map((attr, index) => {
      const label = [
        `<span class="font-semibold text-gray-800">${escapeHtml(attr.name)}</span>`,
        `<span class="ml-2 text-xs text-gray-500">${escapeHtml(attr.object_id)}</span>`,
        `<span class="ml-2 text-xs text-indigo-600">${escapeHtml(attr.type)}</span>`
      ].join('');
      return `
        <li class="px-3 py-2 flex items-center justify-between">
          <span class="text-sm text-gray-700">${label}</span>
          <button
            type="button"
            class="text-xs text-red-600 hover:underline"
            data-action="remove-telemetry-attribute"
            data-index="${index}"
          >
            Remove
          </button>
        </li>`;
    })
    .join('');
}

function handleAddStaticAttribute(event) {
  event.preventDefault();
  hideMessage(machineMsg);
  if (staticAttributesInputModeState !== 'automatic') {
    showMessage(machineMsg, 'Toggle to Automatic builder to add static attributes.');
    return;
  }

  const name = staticAttributeName?.value.trim() || '';
  const type = staticAttributeType?.value.trim() || '';
  const value = staticAttributeValue?.value.trim() || '';

  if (!name || !type || !value) {
    showMessage(machineMsg, 'Provide name, type, and value for the static attribute.');
    return;
  }
  if (SYSTEM_STATIC_ATTR_NAMES.has(name)) {
    showMessage(machineMsg, `${name} is managed by the portal and cannot be added as a custom attribute.`);
    return;
  }

  staticAttributeEntries.push({ name, type, value });
  renderStaticAttributeList();
  clearStaticAttributeFields();
  updateMachinePayloadPreview();
}

function handleStaticAttributeListClick(event) {
  const target = event.target;
  if (!(target instanceof Element)) return;
  const button = target.closest('[data-action="remove-static-attribute"]');
  if (!button) return;
  event.preventDefault();
  const index = Number.parseInt(button.getAttribute('data-index') || '', 10);
  if (Number.isNaN(index)) return;

  staticAttributeEntries.splice(index, 1);
  renderStaticAttributeList();
  updateMachinePayloadPreview();
}

function renderStaticAttributeList() {
  if (!staticAttributeAutoList) return;
  if (!staticAttributeEntries.length) {
    staticAttributeAutoList.innerHTML =
      '<li class="px-3 py-2 text-xs text-gray-500">No static attributes added yet.</li>';
    return;
  }

  staticAttributeAutoList.innerHTML = staticAttributeEntries
    .map((attr, index) => {
      const label = [
        `<span class="font-semibold text-gray-800">${escapeHtml(attr.name)}</span>`,
        `<span class="ml-2 text-xs text-indigo-600">${escapeHtml(attr.type)}</span>`,
        `<span class="ml-2 text-xs text-gray-500">${escapeHtml(attr.value)}</span>`
      ].join('');
      return `
        <li class="px-3 py-2 flex items-center justify-between">
          <span class="text-sm text-gray-700">${label}</span>
          <button
            type="button"
            class="text-xs text-red-600 hover:underline"
            data-action="remove-static-attribute"
            data-index="${index}"
          >
            Remove
          </button>
        </li>`;
    })
    .join('');
}

async function syncMachineActivityData() {
  if (!machines.length) return;
  const now = Date.now();
  if (now - getLastActivityFetchTime() < ACTIVITY_REFRESH_MIN_INTERVAL_MS) return;

  try {
    await refreshDeviceActivity({ now });
  } catch (error) {
    console.warn('Unable to refresh device activity:', error);
  }
}

/**
 * Fetch registered service groups.
 */
async function fetchServiceGroups() {
  if (!serviceGroupsTableBody) return;
  loadingServiceGroups = true;
  setServiceGroupLoading();

  try {
    const resp = await apiFetch('/iot/services', { method: 'GET', headers: buildHeaders() });

    if (!resp.ok) {
      throw new Error(await extractError(resp, IOT_CONTEXTS.loadServices));
    }

    const payload = await resp.json().catch(() => ({}));
    const entries = Array.isArray(payload.services) ? payload.services : [];
    serviceGroups = entries.map(normalizeServiceGroup);
    hideMessage(serviceGroupMsg);
  } catch (error) {
    console.error('Error loading service groups:', error);
    serviceGroups = [];
    renderServiceGroupError(error);
    showMessage(serviceGroupMsg, formatThrownError(error, IOT_CONTEXTS.loadServices));
  } finally {
    loadingServiceGroups = false;
  }
}

/**
 * Fetch registered IoT devices.
 */
async function fetchMachines() {
  loadingMachines = true;
  if (machinesTableBody) {
    setMachinesLoading();
  }

  try {
    const resp = await apiFetch('/iot/devices', { method: 'GET', headers: buildHeaders() });

    if (!resp.ok) {
      throw new Error(await extractError(resp, IOT_CONTEXTS.loadDevices));
    }

    const payload = await resp.json().catch(() => ({}));
    const entries = Array.isArray(payload.devices) ? payload.devices : [];
    const normalizedDevices = entries.map(normalizeDevice);
    allIotDevices = mergeDuplicateDevices(normalizedDevices);
    // Only devices that carry portal metadata are Machines In Use. Auto-provisioned
    // IoT Agent devices remain available for onboarding.
    const machineMap = new Map();
    for (const d of allIotDevices) {
      if (!d.isPortalRegistered) continue;
      const existing = machineMap.get(d.deviceId);
      if (!existing || isPreferredMachineEntry(d, existing)) {
        machineMap.set(d.deviceId, d);
      }
    }
    machines = Array.from(machineMap.values());
    setLocalRegisteredMachineMetadata(machines);
    await syncMachineActivityData();
    updateMachineStatusesFromStore();
    hideMessage(machineMsg);
  } catch (error) {
    console.error('IoT device listing request failed:', error);
    machines = [];
    if (machinesTableBody) {
      renderMachinesError(error);
    }
    showMessage(machineMsg, formatThrownError(error, IOT_CONTEXTS.loadDevices));
  } finally {
    loadingMachines = false;
    notifyRegisteredMachines();
  }
}

/**
 * Handle service group submission by calling the IoT Agent.
 */
async function handleServiceGroupSubmit(event) {
  event.preventDefault();
  hideMessage(serviceGroupMsg);

  const apikey = serviceGroupApiKey?.value.trim() || '';
  const cbroker = serviceGroupCbroker?.value.trim() || '';
  const resource = serviceGroupResource?.value.trim() || '';
  const entityType = serviceGroupEntityType?.value.trim() || '';
  const displayName = serviceGroupName?.value.trim() || '';
  const notes = serviceGroupDescription?.value.trim() || '';

  if (!cbroker) {
    showMessage(serviceGroupMsg, 'Context Broker URL is required.');
    return;
  }

  const normalizedCbroker = normalizeCbrokerUrl(cbroker);
  if (!normalizedCbroker || !NORMALIZED_ALLOWED_CBROKER_URLS.has(normalizedCbroker)) {
    showMessage(
      serviceGroupMsg,
      `Context Broker URL must match a supported FIWARE endpoint (${ALLOWED_CBROKER_DISPLAY}).`
    );
    return;
  }

  if (!resource) {
    showMessage(serviceGroupMsg, 'Resource path is required.');
    return;
  }

  const normalizedResource = normalizeResourcePath(resource);
  if (
    serviceGroups.some(
      (group) => normalizeResourcePath(group.resource) === normalizedResource
    )
  ) {
    showMessage(
      serviceGroupMsg,
      `Resource path "${normalizedResource}" is already registered. Choose a unique path.`
    );
    return;
  }

  if (!entityType) {
    showMessage(serviceGroupMsg, 'Entity type is required.');
    return;
  }

  const metadata = displayName || notes ? { name: displayName, notes } : null;
  const serviceKey = createServiceKey({
    apikey,
    resource,
    cbroker,
    fiwareService: FIWARE_SERVICE,
    subservice: FIWARE_SERVICEPATH || '/',
    entityType
  });
  const payload = {
    services: [
      {
        apikey,
        cbroker,
        entity_type: entityType,
        resource,
        ...(metadata ? { description: JSON.stringify(metadata) } : {})
      }
    ]
  };

  const submitBtn = serviceGroupForm?.querySelector('button[type="submit"]');
  const originalText = submitBtn?.textContent;
  if (submitBtn) {
    submitBtn.textContent = 'Registering...';
    submitBtn.disabled = true;
  }

  try {
    const resp = await apiFetch('/iot/services', {
      method: 'POST',
      headers: buildHeaders({ includeJson: true }),
      body: JSON.stringify(payload)
    });

    if (!resp.ok) {
      throw new Error(await extractError(resp, IOT_CONTEXTS.createService));
    }

    serviceGroupForm?.reset();
    applyServiceDefaults();
    const feedbackLabel = displayName || apikey || resource || 'Service group';
    showMessage(serviceGroupMsg, `${feedbackLabel} registered successfully.`, false);

    await fetchServiceGroups();
    renderServiceGroups();
    refreshServiceGroupOptions(serviceKey);
  } catch (error) {
    console.error('IoT service group creation request failed:', error);
    showMessage(serviceGroupMsg, formatThrownError(error, IOT_CONTEXTS.createService));
  } finally {
    if (submitBtn) {
      submitBtn.textContent = originalText || 'Save Service Group';
      submitBtn.disabled = false;
    }
  }
}

/**
 * Handle service group table actions (delete).
 */
function handleServiceGroupTableClick(event) {
  const target = event.target;
  if (!(target instanceof Element)) return;

  const deleteBtn = target.closest('[data-action="delete-service"]');
  if (!deleteBtn) return;

  const button = deleteBtn instanceof HTMLButtonElement ? deleteBtn : null;
  if (!button) return;

  const serviceKey = button.getAttribute('data-service-key');
  if (!serviceKey) return;

  const group = serviceGroups.find((svc) => svc.key === serviceKey);
  if (!group) return;

  const label = getServiceLabel(group);
  if (typeof window !== 'undefined' && !window.confirm(`Delete service group "${label}"? This cannot be undone.`)) {
    return;
  }

  void handleDeleteServiceGroup(button, group);
}

/**
 * Delete a service group via the IoT Agent API.
 */
async function handleDeleteServiceGroup(button, group) {
  const originalText = button.textContent;
  button.disabled = true;
  button.textContent = 'Deleting...';

  try {
    const params = new URLSearchParams();
    const resourceValue = group.resource || '';
    const apikeyValue = group.apikey ?? '';

    if (!resourceValue) {
      throw new Error('Missing service group resource identifier.');
    }

    params.set('resource', resourceValue);
    params.set('apikey', apikeyValue || '');

    const url = `/iot/services?${params.toString()}`;
    const headers = buildHeaders();

    const resp = await apiFetch(url, { method: 'DELETE', headers });

    if (!resp.ok) {
      throw new Error(await extractError(resp, IOT_CONTEXTS.deleteService));
    }

    showMessage(serviceGroupMsg, `${getServiceLabel(group)} deleted successfully.`, false);

    await fetchServiceGroups();
    renderServiceGroups();
    refreshServiceGroupOptions();

    await fetchMachines();
    renderMachines();
    handleServiceGroupPickerChange({ refreshDevices: false });
  } catch (error) {
    console.error('IoT service group deletion request failed:', error);
    showMessage(serviceGroupMsg, formatThrownError(error, IOT_CONTEXTS.deleteService));
  } finally {
    button.disabled = false;
    button.textContent = originalText || 'Delete';
  }
}

function handleMachinesTableClick(event) {
  const target = event.target;
  if (!(target instanceof Element)) return;

  const viewAttrsBtn = target.closest('[data-action="view-attributes"]');
  if (viewAttrsBtn instanceof HTMLButtonElement) {
    const deviceId = viewAttrsBtn.getAttribute('data-device-id');
    if (!deviceId) return;
    const machine = machines.find((m) => m.deviceId === deviceId);
    if (!machine) return;
    openMachineAttributesModal(machine);
    return;
  }

  const editBtn = target.closest('[data-action="edit-machine"]');
  if (editBtn instanceof HTMLButtonElement) {
    const deviceId = editBtn.getAttribute('data-device-id');
    if (!deviceId) return;
    const machine = machines.find((m) => m.deviceId === deviceId);
    if (!machine) return;
    populateEditMachineModal(machine);
    openModal('editMachineModal');
    return;
  }

  const deleteBtn = target.closest('[data-action="delete-machine"]');
  if (!deleteBtn) return;

  const button = deleteBtn instanceof HTMLButtonElement ? deleteBtn : null;
  if (!button) return;

  const deviceId = button.getAttribute('data-device-id');
  if (!deviceId) return;

  const machine = machines.find((entry) => entry.deviceId === deviceId);
  if (!machine) return;

  if (
    typeof window !== 'undefined' &&
    !window.confirm(`Delete machine "${deviceId}"? This cannot be undone.`)
  ) {
    return;
  }

  void handleDeleteMachine(button, machine);
}

async function handleDeleteMachine(button, machine) {
  const originalText = button.textContent;
  button.disabled = true;
  button.textContent = 'Deleting...';

  try {
    const url = `/iot/devices/${encodeURIComponent(machine.deviceId)}`;
    const headers = buildHeaders();

    const resp = await apiFetch(url, { method: 'DELETE', headers });

    if (!resp.ok) {
      throw new Error(await extractError(resp, IOT_CONTEXTS.deleteMachine));
    }

    removeLocalRegisteredId(machine.deviceId);
    removeLocalRegisteredMachineMetadata(machine.deviceId);
    try {
      const cleanupResponse = await fetch(
        `/bff/portal/digital-twin-layout/machines/${encodeURIComponent(machine.deviceId)}`,
        {
          method: 'DELETE',
          credentials: 'include',
          headers: buildHeaders()
        }
      );
      if (!cleanupResponse.ok) {
        console.warn('Machine deleted, but saved digital-twin layouts could not be cleaned up.');
      }
    } catch (cleanupError) {
      console.warn('Machine deleted, but saved digital-twin layout cleanup failed:', cleanupError);
    }
    showMessage(machineMsg, `Machine ${machine.deviceId} deleted successfully.`, false);

    await fetchMachines();
    renderMachines();
    handleServiceGroupPickerChange({ refreshDevices: false });
  } catch (error) {
    console.error('IoT device deletion request failed:', error);
    showMessage(machineMsg, formatThrownError(error, IOT_CONTEXTS.deleteMachine));
  } finally {
    button.disabled = false;
    button.textContent = originalText || 'Delete';
  }
}

function handleDeviceActivityUpdated() {
  if (loadingMachines || !machinesTableBody) return;
  if (!machines.length) return;
  renderMachines();
  notifyRegisteredMachines();
}

function setupMachinePayloadPreview() {
  machinePayloadRefresh?.addEventListener('click', updateMachinePayloadPreview);
  machineForm?.addEventListener('input', updateMachinePayloadPreview);
  machineForm?.addEventListener('change', updateMachinePayloadPreview);
}

function setMachinePayloadPreview(summary, preview) {
  if (machinePayloadSummary) {
    machinePayloadSummary.textContent = summary;
  }
  if (machinePayloadPreview) {
    machinePayloadPreview.textContent = preview;
  }
}

function updateMachinePayloadPreview() {
  if (!machinePayloadSummary || !machinePayloadPreview) return;

  const draft = buildMachineRegistrationDraft({ showErrors: false, validateDuplicate: false });
  if (!draft.ready) {
    setMachinePayloadPreview(
      draft.message,
      'Payload preview will appear after the required steps are complete.'
    );
    return;
  }

  const method = draft.existsInAgent ? 'PUT' : 'POST';
  const path = draft.existsInAgent
    ? `/iot/devices/${encodeURIComponent(draft.deviceId)}`
    : '/iot/devices';
  const body = draft.existsInAgent ? draft.putPayload : draft.payload;
  const summary = [
    `${method} ${path}`,
    `${draft.attributes.length} telemetry attribute${draft.attributes.length === 1 ? '' : 's'}`,
    `${draft.staticAttributes.length} static attribute${draft.staticAttributes.length === 1 ? '' : 's'}`,
    `entity ${draft.entityName}`
  ].join(' · ');

  setMachinePayloadPreview(summary, JSON.stringify({ request: { method, path }, body }, null, 2));
}

function buildMachineRegistrationDraft({ showErrors = true, validateDuplicate = true } = {}) {
  if (!serviceGroups.length) {
    const message = 'Register a service group before adding machines.';
    if (showErrors) showMessage(machineMsg, message);
    return { ready: false, message };
  }

  const deviceId = machineDeviceId?.value.trim() || '';
  const friendlyName = machineName?.value.trim() || '';
  const assetValidation = validateAssetId(machineAssetId?.value);
  const description = machineDescription?.value.trim() || '';
  const selectedServiceKey = machineServiceGroup?.value || '';
  const statusPlaceholder = getSelectedMachineStatusPlaceholder(machineStatus);

  if (!selectedServiceKey) {
    const message = 'Select the service group responsible for this machine.';
    if (showErrors) showMessage(machineMsg, message);
    return { ready: false, message };
  }

  const targetService = serviceGroups.find((svc) => svc.key === selectedServiceKey);
  if (!targetService) {
    const message = 'Selected service group is no longer available. Reload and try again.';
    if (showErrors) showMessage(machineMsg, message);
    return { ready: false, message };
  }

  if (!deviceId) {
    const message = 'Enter the Device ID to preview the IoT Agent registration payload.';
    if (showErrors) showMessage(machineMsg, 'Device ID is required.');
    return { ready: false, message };
  }

  if (!assetValidation.valid) {
    machineAssetId?.setCustomValidity(assetValidation.error);
    if (showErrors) showMessage(machineMsg, assetValidation.error);
    return { ready: false, message: assetValidation.error };
  }
  machineAssetId?.setCustomValidity('');

  const assetConflict = validateDuplicate
    ? findAssetIdConflict(getVisibleMachines(), assetValidation.value)
    : null;
  if (assetConflict) {
    const message = `Asset ID ${assetValidation.value} is already assigned to ${assetConflict.deviceId}.`;
    machineAssetId?.setCustomValidity(message);
    if (showErrors) showMessage(machineMsg, message);
    return { ready: false, message };
  }

  if (validateDuplicate && getPortalRegisteredDeviceIds().has(deviceId)) {
    const message = 'This device is already registered — it appears in Machines in Use.';
    if (showErrors) showMessage(machineMsg, message);
    return { ready: false, message };
  }

  const entityType = targetService?.entityType || 'Thing';
  const entityName = buildEntityName(deviceId, entityType);
  const attributes = collectTelemetryAttributes({ showErrors });
  if (attributes === null) {
    return {
      ready: false,
      message: 'Fix the telemetry attributes JSON before reviewing the payload.'
    };
  }
  const iamaliveMapping = validateIAmAliveMapping(attributes);
  if (!iamaliveMapping.valid) {
    if (showErrors) showMessage(machineMsg, iamaliveMapping.error);
    return { ready: false, message: iamaliveMapping.error };
  }

  const defaultStaticAttributes = buildDefaultStaticAttributes({
    friendlyName,
    assetId: assetValidation.value,
    description,
    statusPlaceholder,
    serviceKey: targetService.key,
    serviceApikey: targetService.apikey,
    serviceResource: targetService.resource,
    serviceFiware: targetService.fiwareService,
    serviceSubservice: targetService.subservice,
    telemetryAttributes: attributes
  });
  const customStaticAttributes = collectStaticAttributesInput({ showErrors });
  if (customStaticAttributes === null) {
    return {
      ready: false,
      message: 'Fix the static attributes JSON before reviewing the payload.'
    };
  }
  const reservedAttribute = customStaticAttributes.find((attr) => SYSTEM_STATIC_ATTR_NAMES.has(attr?.name));
  if (reservedAttribute) {
    const message = `${reservedAttribute.name} is managed by the portal and cannot be supplied as a custom attribute.`;
    if (showErrors) showMessage(machineMsg, message);
    return { ready: false, message };
  }
  const staticAttributes = [...defaultStaticAttributes, ...customStaticAttributes];

  const payload = {
    devices: [
      {
        device_id: deviceId,
        entity_name: entityName,
        entity_type: entityType,
        transport: IOT_AGENT_TRANSPORT,
        protocol: IOT_AGENT_PROTOCOL,
        service: {
          apikey: targetService.apikey || '',
          resource: targetService.resource || IOT_AGENT_RESOURCE
        },
        attributes,
        commands: [],
        static_attributes: staticAttributes
      }
    ]
  };

  const putPayload = {
    entity_name: entityName,
    entity_type: entityType,
    transport: IOT_AGENT_TRANSPORT,
    protocol: IOT_AGENT_PROTOCOL,
    attributes,
    commands: [],
    static_attributes: staticAttributes
  };

  return {
    ready: true,
    deviceId,
    statusPlaceholder,
    entityName,
    attributes,
    staticAttributes,
    payload,
    putPayload,
    existsInAgent: allIotDevices.some((d) => d.deviceId === deviceId)
  };
}

/**
 * Handle machine submission by calling the IoT Agent.
 */
async function handleMachineSubmit(event) {
  event.preventDefault();
  hideMessage(machineMsg);

  const draft = buildMachineRegistrationDraft({ showErrors: true, validateDuplicate: true });
  if (!draft.ready) return;

  const submitBtn = machineForm?.querySelector('button[type="submit"]');
  const originalText = submitBtn?.textContent;
  if (submitBtn) {
    submitBtn.textContent = 'Registering...';
    submitBtn.disabled = true;
  }

  try {
    let resp;
    if (draft.existsInAgent) {
      // Device already provisioned in IoT Agent (e.g. auto-provisioned via MQTT).
      // Use PUT to attach portal metadata without re-creating it.
      resp = await apiFetch(`/iot/devices/${encodeURIComponent(draft.deviceId)}`, {
        method: 'PUT',
        headers: buildHeaders({ includeJson: true }),
        body: JSON.stringify(draft.putPayload)
      });
    } else {
      resp = await apiFetch('/iot/devices', {
        method: 'POST',
        headers: buildHeaders({ includeJson: true }),
        body: JSON.stringify(draft.payload)
      });
    }

    if (!resp.ok) {
      throw new Error(await extractError(resp, IOT_CONTEXTS.registerMachine));
    }

    addLocalRegisteredId(draft.deviceId);
    const lastSelection = machineServiceGroup?.value;
    machineForm?.reset();
    if (machineServiceGroup && lastSelection) {
      machineServiceGroup.value = lastSelection;
    }
    resetAttributeInputs();
    if (machineStatus) {
      machineStatus.value = String(draft.statusPlaceholder.code);
      updateMachineStatusPreview('machineStatusPreview', machineStatus.value);
    }
    updateMachinePayloadPreview();
    showMessage(machineMsg, `Machine ${draft.deviceId} registered successfully.`, false);

    await fetchMachines();
    renderMachines();
    handleServiceGroupPickerChange({ refreshDevices: false }); // refresh picker to remove the just-registered device
  } catch (error) {
    console.error('IoT machine registration request failed:', error);
    showMessage(machineMsg, formatThrownError(error, IOT_CONTEXTS.registerMachine));
  } finally {
    if (submitBtn) {
      submitBtn.textContent = originalText || 'Register Machine';
      submitBtn.disabled = false;
    }
  }
}

/**
 * Render the service groups table.
 */
function renderServiceGroups() {
  if (!serviceGroupsTableBody) return;
  if (loadingServiceGroups) return;

  if (!serviceGroups.length) {
    serviceGroupsTableBody.innerHTML =
      "<tr><td colspan='6' class='px-5 py-4 text-center text-gray-500'>No service groups registered.</td></tr>";
  } else {
    const rows = serviceGroups
      .slice()
      .sort((a, b) => getServiceLabel(a).localeCompare(getServiceLabel(b)))
      .map(
        (group) => `
        <tr>
          <td class="px-5 py-3 text-sm font-semibold text-gray-800">${escapeHtml(
            group.apikey ? group.apikey : 'N/A'
          )}</td>
          <td class="px-5 py-3 text-sm text-gray-700">
            ${
              group.displayName
                ? `<div class="font-semibold text-gray-800">${escapeHtml(group.displayName)}</div>`
                : `<div class="text-sm text-gray-400 italic">Not set</div>`
            }
            ${
              group.notes
                ? `<div class="text-xs text-gray-500 mt-1">${escapeHtml(group.notes)}</div>`
                : ''
            }
          </td>
          <td class="px-5 py-3 text-sm text-gray-700">
            <div>${escapeHtml(group.resource || IOT_AGENT_RESOURCE)}</div>
            <div class="text-xs text-gray-500">Service: ${escapeHtml(group.fiwareService)}</div>
          </td>
          <td class="px-5 py-3 text-sm text-gray-700">
            <div>${escapeHtml(group.entityType)}</div>
          </td>
          <td class="px-5 py-3 text-sm text-gray-700">
            ${renderServiceGroupBroker(group, { includeUrl: false })}
            ${
              group.subservice && group.subservice !== '/'
                ? `<div class="text-xs text-gray-500 mt-1">Path: ${escapeHtml(group.subservice)}</div>`
                : ''
            }
          </td>
          <td class="px-5 py-3 text-sm text-right">
            <button
              type="button"
              class="inline-flex items-center rounded-md border border-red-300 px-3 py-1 text-xs font-semibold text-red-600 hover:bg-red-50 focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-2"
              data-action="delete-service"
              data-service-key="${escapeHtml(group.key)}"
            >
              <i class="fas fa-trash-alt mr-1"></i>Delete
            </button>
          </td>
        </tr>`
      )
      .join('');
    serviceGroupsTableBody.innerHTML = rows;
  }

  updateCounts();
}

/**
 * Render the machines table.
 */
function updateMachineStatusesFromStore() {
  const visibleMachines = getVisibleMachines();
  if (!visibleMachines.length) return;
  const now = Date.now();

  visibleMachines.forEach((machine) => {
    const activity =
      getDeviceActivity(machine.entityName, { now }) ||
      getDeviceActivity(machine.deviceId, { now });

    if (activity) {
      machine.lastSeen = activity.lastContactIso || '';
      machine.lastSeenAttribute = activity.source || '';
      machine.activityAgeMs = activity.connectivity?.ageMs ?? null;
      machine.connectivity = activity.connectivity || resolveConnectivity({ reason: activity.reason });
      machine.machineStatus = activity.machineStatus || DEFAULT_MACHINE_STATUS;
      machine.lastOperationalUpdateIso = activity.lastOperationalUpdateIso || '';
      machine.monitoringDelayed = Boolean(activity.monitoringDelayed);
    } else {
      machine.lastSeen = '';
      machine.lastSeenAttribute = '';
      machine.activityAgeMs = null;
      machine.connectivity = resolveConnectivity({ reason: 'missing-iamalive' });
      machine.machineStatus = DEFAULT_MACHINE_STATUS;
      machine.lastOperationalUpdateIso = '';
      machine.monitoringDelayed = false;
    }
  });
}

function renderMachines() {
  if (!machinesTableBody) return;
  if (loadingMachines) return;
  updateMachineStatusesFromStore();

  if (!machines.length) {
    machinesTableBody.innerHTML =
      "<tr><td colspan='7' class='px-5 py-4 text-center text-gray-500'>No machines registered.</td></tr>";
  } else {
    const rows = machines
      .slice()
      .sort((a, b) => a.deviceId.localeCompare(b.deviceId))
      .map((machine) => {
        const service = findServiceGroupForMachine(machine);
        const serviceLabel = service ? getServiceLabel(service) : getMachineServiceFallback(machine);
        const details = [];

        const deviceMetaParts = [];
        if (machine.model) deviceMetaParts.push(machine.model);
        if (machine.assetId && !machine.assetIdMissing && machine.assetId !== machine.model) {
          deviceMetaParts.push(machine.assetId);
        }
        const deviceMeta = deviceMetaParts.join(' / ');

        if (machine.model) {
          details.push(`<div>Model: ${escapeHtml(machine.model)}</div>`);
        }

        if (machine.notes) {
          details.push(`<div class="text-xs text-gray-500 mt-1">${escapeHtml(machine.notes)}</div>`);
        }

        const proto = [machine.transport, machine.protocol].filter(Boolean).join(' / ');
        if (proto) {
          details.push(`<div class="text-xs text-gray-500 mt-2">${escapeHtml(proto)}</div>`);
        }

        if (machine.lastSeen) {
          const lastSeenTime = formatLastSeen(machine.lastSeen);
          details.push(
            `<div class="text-xs text-gray-500 mt-2">Last contact: ${escapeHtml(
              lastSeenTime
            )}</div>`
          );
        } else {
          details.push(
            '<div class="text-xs text-gray-500 mt-2">No valid <code>iamalive</code> received.</div>'
          );
        }

        if (machine.lastOperationalUpdateIso) {
          details.push(
            `<div class="text-xs text-gray-500 mt-1">Operational state reported: ${escapeHtml(
              formatLastSeen(machine.lastOperationalUpdateIso)
            )}</div>`
          );
        }

        const telemetryCount = Array.isArray(machine.attributes) ? machine.attributes.length : 0;
        const customStaticCount = Array.isArray(machine.staticAttributes)
          ? machine.staticAttributes.filter((a) => !SYSTEM_STATIC_ATTR_NAMES.has(a.name)).length
          : 0;
        const attributeCount = telemetryCount + customStaticCount;

        details.push(
          `<button type="button" class="text-xs text-blue-600 hover:underline mt-1 text-left" data-action="view-attributes" data-device-id="${escapeHtml(machine.deviceId)}">Attributes: ${attributeCount}</button>`
        );

        const serviceDetails = [];
        if (service && asNonEmptyString(service.resource)) {
          serviceDetails.push(
            `<div class="text-xs text-gray-500">${escapeHtml(normalizeResourcePath(service.resource))}</div>`
          );
        } else {
          const machineResource = asNonEmptyString(machine.resource);
          if (machineResource) {
            serviceDetails.push(
              `<div class="text-xs text-gray-500">${escapeHtml(normalizeResourcePath(machineResource))}</div>`
            );
          }
        }

        return `
        <tr>
          <td class="px-5 py-3 text-sm font-medium text-gray-900">
            <div>${escapeHtml(machine.deviceId)}</div>
            ${
              deviceMeta
                ? `<div class="text-xs text-gray-500">${escapeHtml(deviceMeta)}</div>`
                : ''
            }
            ${
              machine.assetIdMissing
                ? '<span class="machine-asset-missing"><i class="fas fa-triangle-exclamation" aria-hidden="true"></i>Asset ID missing</span>'
                : ''
            }
          </td>
          <td class="px-5 py-3 text-sm text-gray-700">
            <div class="font-semibold text-gray-800">${escapeHtml(machine.friendlyName || machine.entityName)}</div>
            ${
              machine.entityName
                ? `<div class="text-xs text-gray-500">${escapeHtml(machine.entityName)}</div>`
                : ''
            }
          </td>
          <td class="px-5 py-3 text-sm text-gray-700">
            <div>${escapeHtml(serviceLabel)}</div>
            ${serviceDetails.join('')}
          </td>
          <td class="px-5 py-3 text-sm">${renderConnectivityBadge(machine.connectivity)}</td>
          <td class="px-5 py-3 text-sm">${renderMachineStatusBadge(machine.machineStatus || DEFAULT_MACHINE_STATUS)}</td>
          <td class="px-5 py-3 text-sm text-gray-700">${details.join('')}</td>
          <td class="px-5 py-3 text-sm text-right whitespace-nowrap">
            <button
              type="button"
              class="inline-flex items-center rounded-md border border-blue-300 px-3 py-1 text-xs font-semibold text-blue-600 hover:bg-blue-50 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 mr-2"
              data-action="edit-machine"
              data-device-id="${escapeHtml(machine.deviceId)}"
            >
              <i class="fas fa-edit mr-1"></i>Edit
            </button>
            <button
              type="button"
              class="inline-flex items-center rounded-md border border-red-300 px-3 py-1 text-xs font-semibold text-red-600 hover:bg-red-50 focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-2"
              data-action="delete-machine"
              data-device-id="${escapeHtml(machine.deviceId)}"
            >
              <i class="fas fa-trash-alt mr-1"></i>Delete
            </button>
          </td>
        </tr>`;
      })
      .join('');
    machinesTableBody.innerHTML = rows;
  }

  updateCounts();
}

/**
 * Return a Set of entity names for all portal-registered machines.
 * Used by orion-logs.js to filter Orion entities.
 */
export function getRegisteredMachineEntityIds() {
  return new Set(getVisibleMachines().map((m) => m.entityName).filter(Boolean));
}

/**
 * Return a copy of the portal-registered machines for read-only UI modules.
 */
export function getRegisteredMachines() {
  return buildRegisteredMachinesSnapshot();
}

/**
 * Subscribe to read-only registered-machine snapshots.
 * Returns an unsubscribe function for shorter-lived callers.
 */
export function subscribeRegisteredMachines(listener) {
  if (typeof listener !== 'function') return () => {};
  registeredMachineSubscribers.add(listener);
  listener(buildRegisteredMachinesSnapshot());
  return () => registeredMachineSubscribers.delete(listener);
}

/**
 * Return a Set of Orion attribute names allowed for this entity.
 * Includes registered telemetry attr names + object_id last segments + user-defined static attr names.
 * Returns null if the entity is not in the registered machines list.
 */
export function getRegisteredMachineAttributeNames(entityId) {
  const machine = getVisibleMachines().find((m) => m.entityName === entityId);
  if (!machine) return null;
  const allowed = new Set();
  for (const attr of (machine.attributes || [])) {
    if (attr.name) allowed.add(attr.name);
    if (attr.object_id) {
      const last = attr.object_id.split('/').pop();
      if (last) allowed.add(last);
    }
  }
  for (const attr of (machine.staticAttributes || [])) {
    if (attr.name && !SYSTEM_STATIC_ATTR_NAMES.has(attr.name)) allowed.add(attr.name);
  }
  return allowed;
}

/**
 * Return a display label for an Orion entity: "Friendly Name (deviceId)" or just "deviceId".
 */
export function getMachineLabel(entityId) {
  const machine = getVisibleMachines().find((m) => m.entityName === entityId);
  if (!machine) return entityId;
  const name = machine.friendlyName || '';
  const deviceId = machine.deviceId || '';
  if (name && deviceId) return `${name} (${deviceId})`;
  return name || deviceId || entityId;
}

/**
 * Seed read-only machine metadata from Orion entities.
 * Viewer users can read Orion during working hours but cannot read IoT Agent
 * inventory, so logs/history need this fallback metadata to avoid filtering all
 * visible Orion data away.
 */
export function syncRegisteredMachinesFromOrionEntities(entities = []) {
  if (!Array.isArray(entities)) return;

  const next = entities
    .map(normalizeOrionEntityAsMachine)
    .filter(Boolean);

  orionFallbackMachines = next.length ? mergeDuplicateDevices(next) : [];
  if (!machines.length) notifyRegisteredMachines();
}

/**
 * When the service group select changes, populate the collapsible device
 * picker with unregistered IoT Agent devices that belong to that group.
 */
async function handleServiceGroupPickerChange(options = {}) {
  if (!deviceIdPickerWrapper || !deviceIdPickerList) return;
  const shouldRefreshDevices = options?.refreshDevices !== false;

  const selectedKey = machineServiceGroup?.value || '';
  if (!selectedKey) {
    deviceIdPickerWrapper.classList.add('hidden');
    updateMachinePayloadPreview();
    return;
  }

  const targetGroup = serviceGroups.find((g) => g.key === selectedKey);
  if (!targetGroup) {
    deviceIdPickerWrapper.classList.add('hidden');
    updateMachinePayloadPreview();
    return;
  }

  const refreshToken = ++devicePickerRefreshToken;
  if (shouldRefreshDevices) {
    deviceIdPickerList.innerHTML =
      '<li class="px-3 py-2 text-xs text-gray-500">Loading devices...</li>';
    deviceIdPickerWrapper.classList.remove('hidden');

    await fetchMachines();
    renderMachines();

    if (refreshToken !== devicePickerRefreshToken) return;
    if ((machineServiceGroup?.value || '') !== selectedKey) return;
  }

  // Include IoT Agent devices whose apikey+resource match this group.
  // If a device's resource is unknown (empty), include it anyway — it may
  // belong to this group but the IoT Agent didn't return enough info to confirm.
  const registeredDeviceIds = getPortalRegisteredDeviceIds();
  const candidatesById = new Map();
  for (const d of allIotDevices) {
    if (!d.deviceId || registeredDeviceIds.has(d.deviceId)) continue;
    if (targetGroup.apikey && d.apikey && d.apikey !== targetGroup.apikey) continue;
    if (d.resource) {
      const resourceMatch =
        normalizeResourcePath(d.resource) === normalizeResourcePath(targetGroup.resource);
      if (!resourceMatch) continue;
    }
    const existing = candidatesById.get(d.deviceId);
    if (!existing || isPreferredMachineEntry(d, existing)) {
      candidatesById.set(d.deviceId, d);
    }
  }

  const candidates = Array.from(candidatesById.values())
    .sort((a, b) => a.deviceId.localeCompare(b.deviceId));

  if (!candidates.length) {
    deviceIdPickerWrapper.classList.add('hidden');
    updateMachinePayloadPreview();
    return;
  }

  deviceIdPickerList.innerHTML = candidates
    .map((d) => `
      <li>
        <button
          type="button"
          class="w-full text-left px-3 py-1.5 text-sm text-gray-700 hover:bg-indigo-50 hover:text-indigo-700 rounded"
          data-action="pick-device-id"
          data-device-id="${escapeHtml(d.deviceId)}"
        >${escapeHtml(d.deviceId)}</button>
      </li>`)
    .join('');

  deviceIdPickerWrapper.classList.remove('hidden');
  updateMachinePayloadPreview();
}

/**
 * Populate machine service group select options.
 */
function refreshServiceGroupOptions(selectedKey = '') {
  if (!machineServiceGroup) return;

  if (!serviceGroups.length) {
    machineServiceGroup.innerHTML = '<option value="">Add a service group first</option>';
    machineServiceGroup.disabled = true;
    updateMachinePayloadPreview();
    return;
  }

  const options = [
    '<option value="">Select a service group</option>',
    ...serviceGroups
      .slice()
      .sort((a, b) => getServiceLabel(a).localeCompare(getServiceLabel(b)))
      .map(
        (group) =>
          `<option value="${escapeHtml(group.key)}" ${
            group.key === selectedKey ? 'selected' : ''
          }>${escapeHtml(getServiceLabel(group))}</option>`
      )
  ];

  machineServiceGroup.innerHTML = options.join('');
  machineServiceGroup.disabled = false;
  updateMachinePayloadPreview();
}

/**
 * Update counters for current entities.
 */
function updateCounts() {
  if (serviceGroupCount) {
    serviceGroupCount.textContent = serviceGroups.length
      ? `${serviceGroups.length} registered`
      : '0 recorded';
  }
  if (machineCount) {
    machineCount.textContent = machines.length ? `${machines.length} registered` : '0 recorded';
  }
}

/**
 * Apply default IoT Agent values when inputs are empty.
 */
function applyServiceDefaults() {
  if (serviceGroupCbroker && !serviceGroupCbroker.value) {
    serviceGroupCbroker.value = IOT_AGENT_CBROKER;
  }
  if (serviceGroupResource && !serviceGroupResource.value) {
    serviceGroupResource.value = IOT_AGENT_RESOURCE;
  }
  if (serviceGroupEntityType && !serviceGroupEntityType.value) {
    serviceGroupEntityType.value = 'Machine';
  }
}

/**
 * Auto-fill the API key from the display name when empty.
 */
function populateApikeyFromName() {
  if (!serviceGroupApiKey || !serviceGroupName) return;
  if (serviceGroupApiKey.value.trim()) return;
  const suggestion = serviceGroupName.value.trim();
  if (!suggestion) return;
  serviceGroupApiKey.value = suggestion
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
}

function collectTelemetryAttributes({ showErrors = true } = {}) {
  if (telemetryInputMode === 'automatic') {
    return telemetryAttributeEntries.map((entry) => ({ ...entry }));
  }

  const raw = machineAttributesManual?.value.trim();
  if (!raw) return [];

  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      throw new Error('Attributes JSON must be an array.');
    }
    return parsed;
  } catch (error) {
    if (showErrors) {
      showMessage(machineMsg, `Attributes JSON error: ${error.message}`);
    }
    return null;
  }
}

function collectStaticAttributesInput({ showErrors = true } = {}) {
  if (staticAttributesInputModeState === 'automatic') {
    return staticAttributeEntries.map((entry) => ({ ...entry }));
  }

  const raw = machineStaticAttributesManual?.value.trim();
  if (!raw) return [];

  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      throw new Error('Static attributes JSON must be an array.');
    }
    return parsed;
  } catch (error) {
    if (showErrors) {
      showMessage(machineMsg, `Static attributes JSON error: ${error.message}`);
    }
    return null;
  }
}

function normalizeTelemetryMetadata(attributes = []) {
  return (Array.isArray(attributes) ? attributes : [])
    .map((attr) => ({
      name: asNonEmptyString(attr?.name),
      object_id: asNonEmptyString(attr?.object_id || attr?.objectId),
      type: asNonEmptyString(attr?.type) || 'Text'
    }))
    .filter((attr) => attr.name || attr.object_id);
}

function encodeUtf8Base64Url(value) {
  const text = String(value ?? '');
  let binary = '';
  if (typeof TextEncoder !== 'undefined') {
    const bytes = new TextEncoder().encode(text);
    bytes.forEach((byte) => {
      binary += String.fromCharCode(byte);
    });
  } else {
    binary = unescape(encodeURIComponent(text));
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function decodeUtf8Base64Url(value) {
  const normalized = String(value || '').replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
  const binary = atob(padded);
  if (typeof TextDecoder !== 'undefined') {
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  }
  return decodeURIComponent(escape(binary));
}

function encodePortalTelemetryMetadata(attributes = []) {
  const telemetry = normalizeTelemetryMetadata(attributes);
  return `${PORTAL_TELEMETRY_ATTRS_ENCODING_PREFIX}${encodeUtf8Base64Url(JSON.stringify(telemetry))}`;
}

function buildPortalTelemetryStaticAttribute(attributes = []) {
  return {
    name: PORTAL_TELEMETRY_ATTRS_STATIC_NAME,
    type: 'Text',
    value: encodePortalTelemetryMetadata(attributes)
  };
}

/**
 * Create static attributes payload from form fields.
 */
function buildDefaultStaticAttributes({
  friendlyName,
  assetId,
  description,
  statusPlaceholder = DEFAULT_MACHINE_STATUS,
  serviceKey = '',
  serviceApikey = '',
  serviceResource = '',
  serviceFiware = '',
  serviceSubservice = '',
  telemetryAttributes = []
}) {
  const attrs = [];

  if (friendlyName) {
    attrs.push({ name: 'friendlyName', type: 'Text', value: friendlyName });
  }
  if (assetId) {
    attrs.push({ name: 'assetId', type: 'Text', value: assetId });
  }
  if (description) {
    attrs.push({ name: 'notes', type: 'Text', value: description });
  }
  if (statusPlaceholder) {
    attrs.push({ name: 'machineStatusPlaceholderCode', type: 'Integer', value: statusPlaceholder.code });
    attrs.push({ name: 'machineStatusPlaceholderName', type: 'Text', value: statusPlaceholder.name });
  }
  if (serviceKey) {
    attrs.push({ name: 'serviceGroupKey', type: 'Text', value: serviceKey });
  }
  if (serviceResource) {
    attrs.push({ name: 'serviceGroupResource', type: 'Text', value: serviceResource });
  }
  if (serviceApikey) {
    attrs.push({ name: 'serviceGroupApikey', type: 'Text', value: serviceApikey });
  }
  if (serviceFiware) {
    attrs.push({ name: 'serviceGroupFiware', type: 'Text', value: serviceFiware });
  }
  if (serviceSubservice) {
    attrs.push({ name: 'serviceGroupSubservice', type: 'Text', value: serviceSubservice });
  }
  attrs.push(buildPortalTelemetryStaticAttribute(telemetryAttributes));

  return attrs;
}

function getLegacyIdentityStaticAttributes(machine) {
  const legacyNames = new Set(['model', 'asset_id', 'assetID']);
  return (Array.isArray(machine?.staticAttributes) ? machine.staticAttributes : [])
    .filter((attribute) => legacyNames.has(attribute?.name))
    .map((attribute) => ({ ...attribute }));
}

/**
 * Derive a URN for the Orion entity from the device identifier.
 */
function buildEntityName(deviceId, type = 'Thing') {
  const sanitized = deviceId.replace(/[^A-Za-z0-9:-]/g, '-').replace(/:+/g, '-');
  return `urn:ngsi-ld:${type}:${sanitized}`;
}

/**
 * Normalise IoT Agent service response.
 */
function normalizeServiceGroup(entry = {}) {
  const metadata = decodeMetadata(entry.description);
  const apikey = entry.apikey || '';
  const resource = entry.resource || '';
  const cbroker = extractBrokerFromSource(entry) || '';
  const fiwareService = entry.service || FIWARE_SERVICE;
  const subservice = entry.subservice || FIWARE_SERVICEPATH || '/';
  const entityType = entry.entity_type || 'Thing';

  return {
    key: createServiceKey({ apikey, resource, cbroker, fiwareService, subservice, entityType }),
    apikey,
    resource,
    cbroker,
    entityType,
    fiwareService,
    subservice,
    displayName: metadata.name || '',
    notes: metadata.notes || '',
    raw: entry
  };
}

/**
 * Normalise IoT Agent device response.
 */
function firstNonEmpty(...values) {
  for (const value of values) {
    const str = asNonEmptyString(value);
    if (str) return str;
  }
  return '';
}

function normalizeDevice(entry = {}) {
  // The custom IoT Agent may return staticAttributes (camelCase) instead of
  // static_attributes (snake_case). Support both.
  const staticMap = toAttributeMap(entry.static_attributes || entry.staticAttributes);
  // entry.service may be a plain string (fiwareService) rather than an object;
  // only treat it as an object when it actually is one.
  const serviceInfo = (entry.service && typeof entry.service === 'object') ? entry.service : {};
  const storedServiceKey = asNonEmptyString(staticMap.get('serviceGroupKey'));
  const storedResource = asNonEmptyString(staticMap.get('serviceGroupResource'));
  const storedApikey = asNonEmptyString(staticMap.get('serviceGroupApikey'));
  const apikey = firstNonEmpty(
    serviceInfo.apikey,
    serviceInfo.apiKey,
    serviceInfo.api_key,
    entry.apikey,
    entry.apiKey,
    entry.api_key,
    storedApikey
  );
  const resource = firstNonEmpty(
    serviceInfo.resource,
    serviceInfo.resourcePath,
    serviceInfo.resource_path,
    entry.resource,
    entry.resourcePath,
    entry.resource_path,
    storedResource
  );
  const cbroker = firstNonEmpty(
    serviceInfo.cbroker,
    serviceInfo.cbBroker,
    serviceInfo.cBroker,
    entry.cbroker,
    entry.cbBroker,
    entry.cBroker
  );
  const fiwareService = firstNonEmpty(
    serviceInfo.service,
    serviceInfo.fiwareService,
    entry.service,
    entry.fiwareService,
    storedServiceKey ? storedServiceKey.split('|')[3] : '',
    FIWARE_SERVICE
  );
  const subservice = firstNonEmpty(
    serviceInfo.subservice,
    serviceInfo.servicePath,
    entry.subservice,
    entry.servicePath,
    FIWARE_SERVICEPATH,
    '/'
  );
  const entityType =
    firstNonEmpty(serviceInfo.entity_type, serviceInfo.entityType, entry.entity_type, entry.entityType) ||
    ENTITY_TYPE;
  const assetIdentity = resolveAssetIdentity({
    canonical: entry.assetId || staticMap.get('assetId'),
    snakeCase: entry.asset_id || staticMap.get('asset_id'),
    upperCase: entry.assetID || staticMap.get('assetID'),
    legacyModel: staticMap.get('model'),
    deviceId: entry.device_id || entry.id
  });
  const computedServiceKey = createServiceKey({
    apikey,
    resource,
    cbroker,
    fiwareService,
    subservice,
    entityType
  });
  const resolvedServiceKey = storedServiceKey || computedServiceKey;
  // Resolve the raw static attributes list handling both naming conventions.
  const rawStaticAttrs = Array.isArray(entry.static_attributes)
    ? entry.static_attributes
    : Array.isArray(entry.staticAttributes)
      ? entry.staticAttributes
      : [];
  return {
    deviceId: entry.device_id || entry.id || '',
    entityName: entry.entity_name || entry.name || '',
    entityType,
    transport: entry.transport || '',
    protocol: entry.protocol || '',
    attributes: Array.isArray(entry.attributes) ? entry.attributes : (Array.isArray(entry.active) ? entry.active : []),
    staticAttributes: rawStaticAttrs,
    apikey,
    resource,
    cbroker,
    fiwareService,
    subservice,
    serviceKey: resolvedServiceKey,
    isPortalRegistered: !!storedServiceKey,
    friendlyName: staticMap.get('friendlyName') || '',
    model: staticMap.get('model') || '',
    ...assetIdentity,
    notes: staticMap.get('notes') || '',
    statusPlaceholderCode: staticMap.get('machineStatusPlaceholderCode') || '',
    statusPlaceholderName: staticMap.get('machineStatusPlaceholderName') || '',
    status: staticMap.get('operationalStatus') || '',
    raw: entry
  };
}

function readOrionAttributeValue(raw) {
  if (raw && typeof raw === 'object' && Object.prototype.hasOwnProperty.call(raw, 'value')) {
    return raw.value;
  }
  return raw;
}

function readOrionAttributeType(raw) {
  if (raw && typeof raw === 'object' && typeof raw.type === 'string') {
    return raw.type;
  }
  const value = readOrionAttributeValue(raw);
  if (typeof value === 'number') return Number.isInteger(value) ? 'Integer' : 'Number';
  if (typeof value === 'boolean') return 'Boolean';
  if (value && typeof value === 'object') return 'StructuredValue';
  return 'Text';
}

function parsePortalTelemetryMetadata(raw) {
  if (!raw) return [];
  if (Array.isArray(raw)) return normalizeTelemetryMetadata(raw);
  if (typeof raw !== 'string') return [];
  try {
    const encoded = raw.startsWith(PORTAL_TELEMETRY_ATTRS_ENCODING_PREFIX)
      ? decodeUtf8Base64Url(raw.slice(PORTAL_TELEMETRY_ATTRS_ENCODING_PREFIX.length))
      : raw;
    const parsed = JSON.parse(encoded);
    return normalizeTelemetryMetadata(parsed);
  } catch {
    return [];
  }
}

function findLocalRegisteredMachineMetadata(entityName, deviceId) {
  return getLocalRegisteredMachineMetadata().find((machine) =>
    (entityName && machine.entityName === entityName) ||
    (deviceId && machine.deviceId === deviceId)
  ) || null;
}

function deriveDeviceIdFromEntityId(entityId = '', entityType = ENTITY_TYPE) {
  const prefix = `urn:ngsi-ld:${entityType}:`;
  if (entityId.startsWith(prefix)) {
    return entityId.slice(prefix.length);
  }
  const parts = entityId.split(':');
  return parts.length > 1 ? parts[parts.length - 1] : entityId;
}

function normalizeOrionEntityAsMachine(entity = {}) {
  if (!entity || typeof entity !== 'object') return null;
  const entityName = asNonEmptyString(entity.id);
  if (!entityName) return null;

  const entityType = asNonEmptyString(entity.type) || ENTITY_TYPE;
  if (entityType && entityType !== ENTITY_TYPE) return null;

  const staticAttributes = [];

  Object.entries(entity).forEach(([name, raw]) => {
    if (!name || name === 'id' || name === 'type' || name.toLowerCase() === 'timeinstant') return;

    const attr = {
      name,
      type: readOrionAttributeType(raw),
      value: readOrionAttributeValue(raw)
    };

    if (SYSTEM_STATIC_ATTR_NAMES.has(name)) {
      staticAttributes.push(attr);
    }
  });

  const staticMap = toAttributeMap(staticAttributes);
  const deviceId = asNonEmptyString(readOrionAttributeValue(entity.device_id))
    || asNonEmptyString(readOrionAttributeValue(entity.deviceId))
    || deriveDeviceIdFromEntityId(entityName, entityType);
  const localMetadata = findLocalRegisteredMachineMetadata(entityName, deviceId);
  const serviceKey = asNonEmptyString(staticMap.get('serviceGroupKey'));

  if (!serviceKey && !localMetadata) {
    return null;
  }

  const staticTelemetry = parsePortalTelemetryMetadata(
    staticMap.get(PORTAL_TELEMETRY_ATTRS_STATIC_NAME)
  );
  const localTelemetry = normalizeTelemetryMetadata(localMetadata?.attributes);
  const attributes = staticTelemetry.length ? staticTelemetry : localTelemetry;

  const localConfirmedAssetId = localMetadata?.assetIdMissing ? '' : localMetadata?.assetId;
  const localLegacyAssetId = localMetadata?.assetIdMissing ? localMetadata?.assetId : '';
  const assetIdentity = resolveAssetIdentity({
    canonical: staticMap.get('assetId') || localConfirmedAssetId,
    snakeCase: staticMap.get('asset_id'),
    upperCase: staticMap.get('assetID'),
    legacyModel: staticMap.get('model') || localMetadata?.model || localLegacyAssetId,
    deviceId
  });

  return {
    deviceId,
    entityName,
    entityType,
    transport: '',
    protocol: '',
    attributes,
    staticAttributes,
    apikey: asNonEmptyString(staticMap.get('serviceGroupApikey')),
    resource: asNonEmptyString(staticMap.get('serviceGroupResource')),
    cbroker: '',
    fiwareService: asNonEmptyString(staticMap.get('serviceGroupFiware')) || FIWARE_SERVICE,
    subservice: asNonEmptyString(staticMap.get('serviceGroupSubservice')) || FIWARE_SERVICEPATH || '/',
    serviceKey,
    isPortalRegistered: true,
    friendlyName: asNonEmptyString(staticMap.get('friendlyName')) || asNonEmptyString(localMetadata?.friendlyName),
    model: asNonEmptyString(staticMap.get('model')) || asNonEmptyString(localMetadata?.model),
    ...assetIdentity,
    notes: asNonEmptyString(staticMap.get('notes')) || asNonEmptyString(localMetadata?.notes),
    statusPlaceholderCode: asNonEmptyString(staticMap.get('machineStatusPlaceholderCode')),
    statusPlaceholderName: asNonEmptyString(staticMap.get('machineStatusPlaceholderName')),
    status: asNonEmptyString(staticMap.get('operationalStatus')),
    raw: entity
  };
}

function isPreferredMachineEntry(candidate, current) {
  const candidateUrn = candidate.entityName?.startsWith('urn:ngsi-ld:') ?? false;
  const currentUrn   = current.entityName?.startsWith('urn:ngsi-ld:')  ?? false;
  if (candidate.isPortalRegistered && !current.isPortalRegistered) return true;
  if (!candidate.isPortalRegistered && current.isPortalRegistered) return false;
  if (candidateUrn && !currentUrn) return true;
  if (!candidateUrn && currentUrn) return false;
  return (candidate.staticAttributes?.length ?? 0) > (current.staticAttributes?.length ?? 0);
}

function mergeDuplicateDevices(devices = []) {
  const deduped = new Map();
  let fallbackIndex = 0;

  devices.forEach((device) => {
    if (!device || typeof device !== 'object') return;
    const deviceId = asNonEmptyString(device.deviceId);
    const serviceKey = asNonEmptyString(device.serviceKey);
    const dedupeKey =
      deviceId
        ? [deviceId, serviceKey].join('|')
        : asNonEmptyString(device.entityName)
          ? [asNonEmptyString(device.entityName), serviceKey].join('|')
        : `__device_${fallbackIndex++}`;

    if (!deduped.has(dedupeKey)) {
      deduped.set(dedupeKey, {
        ...device,
        attributes: Array.isArray(device.attributes) ? [...device.attributes] : [],
        staticAttributes: Array.isArray(device.staticAttributes)
          ? [...device.staticAttributes]
          : []
      });
      return;
    }

    const existing = deduped.get(dedupeKey);
    existing.attributes = mergeAttributeList(existing.attributes, device.attributes);
    existing.staticAttributes = mergeAttributeList(existing.staticAttributes, device.staticAttributes);
    existing.isPortalRegistered = existing.isPortalRegistered || device.isPortalRegistered;

    if (
      asNonEmptyString(device.entityName) &&
      (
        !asNonEmptyString(existing.entityName) ||
        (!existing.entityName.startsWith('urn:ngsi-ld:') && device.entityName.startsWith('urn:ngsi-ld:'))
      )
    ) {
      existing.entityName = device.entityName;
    }

    existing.apikey = asNonEmptyString(existing.apikey) || asNonEmptyString(device.apikey) || '';

    const nextResource = asNonEmptyString(device.resource);
    const currentResource = asNonEmptyString(existing.resource);
    if (nextResource && (!currentResource || isDefaultResourceValue(currentResource))) {
      existing.resource = nextResource;
    }

    const nextCbroker = asNonEmptyString(device.cbroker);
    if (nextCbroker && !asNonEmptyString(existing.cbroker)) {
      existing.cbroker = nextCbroker;
    }

    const nextFiwareService = asNonEmptyString(device.fiwareService);
    if (
      nextFiwareService &&
      (!asNonEmptyString(existing.fiwareService) || existing.fiwareService === FIWARE_SERVICE)
    ) {
      existing.fiwareService = nextFiwareService;
    }

    const nextSubservice = asNonEmptyString(device.subservice);
    if (nextSubservice && (!asNonEmptyString(existing.subservice) || existing.subservice === '/')) {
      existing.subservice = nextSubservice;
    }

    if (serviceKeyScore(device.serviceKey) > serviceKeyScore(existing.serviceKey)) {
      existing.serviceKey = device.serviceKey;
    }

    if (asNonEmptyString(device.friendlyName) && !asNonEmptyString(existing.friendlyName)) {
      existing.friendlyName = device.friendlyName;
    }
    if (asNonEmptyString(device.model) && !asNonEmptyString(existing.model)) {
      existing.model = device.model;
    }
    if (
      asNonEmptyString(device.assetId) &&
      (!asNonEmptyString(existing.assetId) || (existing.assetIdMissing && !device.assetIdMissing))
    ) {
      existing.assetId = device.assetId;
      existing.assetIdSource = device.assetIdSource;
      existing.assetIdMissing = device.assetIdMissing;
      existing.assetPlateLabel = device.assetPlateLabel;
    }
    if (asNonEmptyString(device.notes) && !asNonEmptyString(existing.notes)) {
      existing.notes = device.notes;
    }
    if (asNonEmptyString(device.status) && !asNonEmptyString(existing.status)) {
      existing.status = device.status;
    }
    existing.raw = existing.raw || device.raw;
  });

  return Array.from(deduped.values());
}

function mergeAttributeList(target = [], source = []) {
  const base = Array.isArray(target) ? [...target] : [];
  const seen = new Set(base.map(attributeIdentity));

  (Array.isArray(source) ? source : []).forEach((attr) => {
    const key = attributeIdentity(attr);
    if (!seen.has(key)) {
      base.push(attr);
      seen.add(key);
    }
  });

  return base;
}

function attributeIdentity(attr = {}) {
  const objectId = asNonEmptyString(attr.object_id || attr.objectId);
  const name = asNonEmptyString(attr.name);
  if (objectId || name) {
    return `${objectId}::${name}`;
  }
  const type = asNonEmptyString(attr.type);
  const value = attr.value != null ? JSON.stringify(attr.value) : '';
  return `anon::${type}::${value}`;
}

function isDefaultResourceValue(value) {
  const normalized = asNonEmptyString(value);
  if (!normalized) return true;
  return normalizeResourcePath(normalized) === '/';
}

function serviceKeyScore(value) {
  const normalized = asNonEmptyString(value);
  if (!normalized) return 0;
  const parts = normalized.split('|');
  let score = 0;
  if (asNonEmptyString(parts[0])) score += 4;
  if (asNonEmptyString(parts[1])) score += 4;
  if (asNonEmptyString(parts[2])) score += 1;
  if (asNonEmptyString(parts[3])) score += 1;
  if (asNonEmptyString(parts[4])) score += 1;
  if (asNonEmptyString(parts[5])) score += 1;
  return score;
}

/**
 * Build headers for IoT Agent requests.
 */
function buildHeaders({ includeJson = false } = {}) {
  return buildFiwareHeaders({
    ...(includeJson ? { 'Content-Type': 'application/json' } : {})
  });
}

/**
 * Decode JSON metadata persisted in a service description.
 */
function decodeMetadata(value) {
  if (!value) return { name: '', notes: '' };
  if (typeof value !== 'string') return { name: '', notes: '' };

  try {
    const parsed = JSON.parse(value);
    if (parsed && typeof parsed === 'object') {
      return {
        name: typeof parsed.name === 'string' ? parsed.name : '',
        notes: typeof parsed.notes === 'string' ? parsed.notes : ''
      };
    }
  } catch (_err) {
    return { name: '', notes: value };
  }

  return { name: '', notes: '' };
}

/**
 * Build a deterministic key representing a service group combination.
 */
function createServiceKey({
  apikey = '',
  resource = '',
  cbroker = '',
  fiwareService = FIWARE_SERVICE,
  subservice = FIWARE_SERVICEPATH || '/',
  entityType = ENTITY_TYPE
} = {}) {
  return [apikey, resource, cbroker, fiwareService, subservice || '/', entityType]
    .map((part) => (part == null ? '' : String(part)))
    .join('|');
}

/**
 * Convert static attributes array into a map for quick lookups.
 */
function toAttributeMap(list) {
  const map = new Map();
  if (!Array.isArray(list)) return map;
  list.forEach((attr) => {
    if (!attr || typeof attr !== 'object') return;
    const key = attr.name || attr.object_id;
    if (!key) return;
    map.set(key, attr.value ?? attr.object_id ?? '');
  });
  return map;
}

/**
 * Return a clean label for a service group.
 */
function getServiceLabel(group) {
  if (!group || typeof group !== 'object') return 'Service';
  const displayName = asNonEmptyString(group.displayName);
  if (displayName) return displayName;
  const resource = asNonEmptyString(group.resource);
  if (resource) return resource;
  const apikey = asNonEmptyString(group.apikey);
  if (apikey) return apikey;
  return 'Service';
}

function findServiceGroupForMachine(machine = {}) {
  if (!serviceGroups.length) return null;
  const candidates = collectMachineServiceCandidates(machine);
  for (const candidate of candidates) {
    const match = serviceGroups.find((group) => serviceGroupMatchesCandidate(group, candidate));
    if (match) return match;
  }
  return null;
}

function collectMachineServiceCandidates(machine = {}) {
  const seen = new Map();

  const registerCandidate = (candidate = {}) => {
    const apikey = asNonEmptyString(candidate.apikey ?? candidate.apiKey ?? candidate.api_key);
    const resource = cleanResourceCandidate(candidate.resource ?? candidate.resource_path ?? candidate.resourcePath);
    const fiwareService = asNonEmptyString(candidate.fiwareService ?? candidate.service);
    const subservice = cleanSubserviceCandidate(candidate.subservice ?? candidate.servicePath);
    const entityType = asNonEmptyString(candidate.entityType ?? candidate.entity_type ?? candidate.type);

    if (!apikey && !resource && !fiwareService && subservice === undefined && !entityType) {
      return;
    }

    const key = [apikey || '', resource || '', fiwareService || '', subservice ?? '', entityType || ''].join('|');
    if (!seen.has(key)) {
      seen.set(key, { apikey, resource, fiwareService, subservice, entityType });
    }
  };

  registerCandidate(machine);

  if (machine.raw && typeof machine.raw === 'object') {
    registerCandidate(machine.raw);
    if (machine.raw.service && typeof machine.raw.service === 'object') {
      registerCandidate(machine.raw.service);
    }
  }

  if (typeof machine.serviceKey === 'string' && machine.serviceKey) {
    const keyCandidate = candidateFromServiceKey(machine.serviceKey);
    if (keyCandidate) registerCandidate(keyCandidate);
  }

  const staticMap = Array.isArray(machine.staticAttributes)
    ? toAttributeMap(machine.staticAttributes)
    : new Map();
  if (staticMap.size) {
    registerCandidate({
      apikey: staticMap.get('serviceGroupApikey'),
      resource: staticMap.get('serviceGroupResource'),
      subservice: staticMap.get('serviceGroupSubservice'),
      fiwareService: staticMap.get('serviceGroupFiware'),
      entityType: staticMap.get('serviceGroupEntityType')
    });
    const staticKey = asNonEmptyString(staticMap.get('serviceGroupKey'));
    if (staticKey) {
      const parsed = candidateFromServiceKey(staticKey);
      if (parsed) registerCandidate(parsed);
    }
  }

  const candidates = Array.from(seen.values()).sort(
    (a, b) => scoreServiceCandidate(b) - scoreServiceCandidate(a)
  );
  return candidates;
}

function candidateFromServiceKey(serviceKey) {
  if (!serviceKey) return null;
  const parts = String(serviceKey).split('|');
  if (!parts.length) return null;
  return {
    apikey: parts[0],
    resource: parts[1],
    fiwareService: parts[3],
    subservice: parts[4],
    entityType: parts[5]
  };
}

function scoreServiceCandidate(candidate = {}) {
  let score = 0;
  if (asNonEmptyString(candidate.apikey)) score += 4;
  if (asNonEmptyString(candidate.resource)) score += 4;
  if (asNonEmptyString(candidate.fiwareService)) score += 1;
  if (candidate.subservice !== undefined && candidate.subservice !== null) score += 1;
  if (asNonEmptyString(candidate.entityType)) score += 1;
  return score;
}

function serviceGroupMatchesCandidate(group, candidate) {
  if (!group || !candidate) return false;
  if (candidate.apikey && asNonEmptyString(group.apikey) !== candidate.apikey) return false;
  if (candidate.resource) {
    const groupResource = cleanResourceCandidate(group.resource);
    if (groupResource !== candidate.resource) return false;
  }
  if (candidate.fiwareService && asNonEmptyString(group.fiwareService) !== candidate.fiwareService) {
    return false;
  }
  if (candidate.subservice !== undefined) {
    const groupSubservice = cleanSubserviceCandidate(group.subservice);
    if (groupSubservice !== candidate.subservice) return false;
  }
  if (candidate.entityType && asNonEmptyString(group.entityType) !== candidate.entityType) {
    return false;
  }
  return true;
}

function cleanResourceCandidate(value) {
  const str = asNonEmptyString(value);
  if (!str) return undefined;
  return normalizeResourcePath(str);
}

function cleanSubserviceCandidate(value) {
  const str = asNonEmptyString(value);
  if (str == null) return undefined;
  if (!str) return undefined;
  return normalizeResourcePath(str) || '/';
}

function getMachineServiceFallback(machine = {}) {
  const candidates = collectMachineServiceCandidates(machine);
  if (candidates.length) {
    const best = candidates[0];
    if (best.resource) return best.resource;
    if (best.apikey) return best.apikey;
    if (best.fiwareService) return `${best.fiwareService}${best.subservice ? ` ${best.subservice}` : ''}`;
  }
  return 'N/A';
}

/**
 * Render loading state for service groups.
 */
function setServiceGroupLoading() {
  if (!serviceGroupsTableBody) return;
  serviceGroupsTableBody.innerHTML =
    "<tr><td colspan='6' class='px-5 py-4 text-center'><i class='fas fa-spinner loading-spinner text-indigo-600'></i></td></tr>";
}

/**
 * Render error state for service groups.
 */
function renderServiceGroupError(err) {
  if (!serviceGroupsTableBody) return;
  const message = escapeHtml(err.message || 'Unknown error');
  serviceGroupsTableBody.innerHTML = `<tr><td colspan='6' class='px-5 py-4 text-center text-sm text-red-500'>${message}</td></tr>`;
}

/**
 * Render loading state for machines.
 */
function setMachinesLoading() {
  if (!machinesTableBody) return;
  machinesTableBody.innerHTML =
    "<tr><td colspan='7' class='px-5 py-4 text-center'><i class='fas fa-spinner loading-spinner text-indigo-600'></i></td></tr>";
}

/**
 * Render error state for machines.
 */
function renderMachinesError(err) {
  if (!machinesTableBody) return;
  const message = escapeHtml(err.message || 'Unknown error');
  machinesTableBody.innerHTML = `<tr><td colspan='7' class='px-5 py-4 text-center text-sm text-red-500'>${message}</td></tr>`;
}

/**
 * Build an error string from an IoT Agent response.
 */
async function extractError(resp, context) {
  return formatResponseError(resp, context || {
    system: 'IoT Agent',
    action: 'complete the request',
    endpoint: 'IoT Agent API'
  });
}

/**
 * Normalise Context Broker URLs for comparison.
 */
function normalizeCbrokerUrl(value) {
  if (!value) return '';
  try {
    const url = new URL(value);
    const pathname = url.pathname.replace(/\/+$/, '');
    return `${url.protocol}//${url.host}${pathname}`.toLowerCase();
  } catch (_err) {
    return String(value).trim().replace(/\/+$/, '').toLowerCase();
  }
}

/**
 * Normalise resource paths while keeping case sensitivity.
 */
function normalizeResourcePath(value) {
  if (!value) return '/';
  const trimmed = String(value).trim();
  const withoutTrailing = trimmed.replace(/\/+$/, '');
  return withoutTrailing || '/';
}

function renderServiceGroupBroker(group, { includeUrl = true } = {}) {
  const brokerUrl = resolveServiceGroupBroker(group);
  if (!brokerUrl) {
    return '<div class="text-xs text-gray-500 italic">Not configured</div>';
  }

  const label = escapeHtml(getBrokerLabel(brokerUrl));

  if (!includeUrl) {
    return `<div class="font-semibold text-gray-800">${label}</div>`;
  }

  return `
    <div class="font-semibold text-gray-800">${label}</div>
    <div class="text-xs text-gray-500">${escapeHtml(brokerUrl)}</div>
  `.trim();
}

function resolveServiceGroupBroker(group) {
  if (!group || typeof group !== 'object') return '';

  const direct = asNonEmptyString(group.cbroker);
  if (direct) return direct;

  const fallback = extractBrokerFromSource(group.raw);
  if (fallback) return fallback;

  return asNonEmptyString(IOT_AGENT_CBROKER);
}

function extractBrokerFromSource(source) {
  if (!source) return '';

  const candidates = [
    source.cbroker,
    source.cBroker,
    source.cbBroker,
    source.url,
    source.endpoint
  ];

  for (const candidate of candidates) {
    const value = normalizeBrokerCandidate(candidate);
    if (value) return value;
  }

  return '';
}

function normalizeBrokerCandidate(candidate) {
  if (!candidate) return '';

  if (typeof candidate === 'string') {
    return asNonEmptyString(candidate);
  }

  if (typeof candidate === 'object') {
    if (typeof candidate.url === 'string') {
      const normalized = asNonEmptyString(candidate.url);
      if (normalized) return normalized;
    }
    if (typeof candidate.host === 'string') {
      const protocol = asNonEmptyString(candidate.protocol) || 'http';
      const host = candidate.host.trim();
      if (!host) return '';
      const port = candidate.port ? `:${candidate.port}` : '';
      return `${protocol}://${host}${port}`;
    }
  }

  return '';
}

function asNonEmptyString(value) {
  if (typeof value !== 'string') return '';
  const trimmed = value.trim();
  return trimmed || '';
}

/**
 * Escape HTML entities for safe rendering.
 */
function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Display success/error helper.
 */
function showMessage(node, text, isError = true) {
  if (!node) return;
  node.textContent = text;
  node.classList.remove('hidden', 'text-red-600', 'text-green-600');
  node.classList.add(isError ? 'text-red-600' : 'text-green-600');
}

/**
 * Hide helper message.
 */
function hideMessage(node) {
  if (!node) return;
  node.textContent = '';
  node.classList.add('hidden');
}

function formatLastSeen(isoString) {
  if (!isoString) return '';
  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) return isoString;
  return date.toLocaleString();
}

// ─── Modal helpers ────────────────────────────────────────────────────────────

function openModal(id) {
  const el = document.getElementById(id);
  if (!el) return;
  el.classList.remove('hidden');
  el.classList.add('flex');
}

let assetIdHelpReturnFocus = null;

function closeAssetIdHelp() {
  const modal = document.getElementById('assetIdHelpModal');
  if (!modal || modal.classList.contains('hidden')) return;
  modal.classList.add('hidden');
  modal.classList.remove('flex');
  assetIdHelpReturnFocus?.focus?.();
  assetIdHelpReturnFocus = null;
}

function openAssetIdHelp(trigger) {
  const modal = document.getElementById('assetIdHelpModal');
  if (!modal) return;
  assetIdHelpReturnFocus = trigger || document.activeElement;
  modal.classList.remove('hidden');
  modal.classList.add('flex');
  modal.querySelector('.asset-id-help-dialog')?.focus();
}

function initAssetIdDialogs() {
  ['machineAssetId', 'editMachineAssetId'].forEach((id) => {
    const input = document.getElementById(id);
    if (!input || input.dataset.validityBound === 'true') return;
    input.addEventListener('input', () => input.setCustomValidity(''));
    input.dataset.validityBound = 'true';
  });
  ['assetIdHelpBtn', 'editAssetIdHelpBtn'].forEach((id) => {
    const button = document.getElementById(id);
    if (!button || button.dataset.bound === 'true') return;
    button.addEventListener('click', () => openAssetIdHelp(button));
    button.dataset.bound = 'true';
  });
  const close = document.getElementById('assetIdHelpClose');
  if (close && close.dataset.bound !== 'true') {
    close.addEventListener('click', closeAssetIdHelp);
    close.dataset.bound = 'true';
  }
  const modal = document.getElementById('assetIdHelpModal');
  if (modal && modal.dataset.bound !== 'true') {
    modal.addEventListener('click', (event) => {
      if (event.target === modal) closeAssetIdHelp();
    });
    modal.dataset.bound = 'true';
  }
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') closeAssetIdHelp();
  });
}

function confirmAssetIdChange(previousAssetId, nextAssetId) {
  const modal = document.getElementById('assetIdChangeModal');
  const confirm = document.getElementById('assetIdChangeConfirm');
  const cancel = document.getElementById('assetIdChangeCancel');
  if (!modal || !confirm || !cancel) return Promise.resolve(false);

  document.getElementById('assetIdChangePrevious').textContent = previousAssetId;
  document.getElementById('assetIdChangeNext').textContent = nextAssetId;
  modal.classList.remove('hidden');
  modal.classList.add('flex');
  cancel.focus();

  return new Promise((resolve) => {
    const finish = (accepted) => {
      modal.classList.add('hidden');
      modal.classList.remove('flex');
      confirm.removeEventListener('click', accept);
      cancel.removeEventListener('click', reject);
      modal.removeEventListener('click', outside);
      document.removeEventListener('keydown', keydown);
      resolve(accepted);
    };
    const accept = () => finish(true);
    const reject = () => finish(false);
    const outside = (event) => { if (event.target === modal) reject(); };
    const keydown = (event) => { if (event.key === 'Escape') reject(); };
    confirm.addEventListener('click', accept);
    cancel.addEventListener('click', reject);
    modal.addEventListener('click', outside);
    document.addEventListener('keydown', keydown);
  });
}

function closeModal(id) {
  const el = document.getElementById(id);
  if (!el) return;
  el.classList.add('hidden');
  el.classList.remove('flex');
}

// ─── Attributes view modal ────────────────────────────────────────────────────

/**
 * Render color-coded JSON into a <pre> element using innerHTML.
 * Telemetry and custom static entries → indigo; system static entries → amber.
 */
function renderAttrJson(jsonEl, telemetryAttrs, customStaticAttrs, systemStaticAttrs, showSystem) {
  function entryHtml(attr, colorClass) {
    const lines = JSON.stringify(attr, null, 2).split('\n');
    // indent continuation lines by 4 spaces (array member indentation)
    const formatted = lines.map((l, i) => (i === 0 ? l : '    ' + l)).join('\n');
    return `<span class="${colorClass}">${escapeHtml(formatted)}</span>`;
  }

  const telEntries = telemetryAttrs.map((a) => entryHtml(a, 'text-indigo-600'));
  const customEntries = customStaticAttrs.map((a) => entryHtml(a, 'text-indigo-600'));
  const sysEntries = showSystem
    ? systemStaticAttrs.map((a) => entryHtml(a, 'text-amber-600'))
    : [];
  const staticEntries = [...customEntries, ...sysEntries];

  const telSection = telEntries.length
    ? `[\n    ${telEntries.join(',\n    ')}\n  ]`
    : '[]';
  const staticSection = staticEntries.length
    ? `[\n    ${staticEntries.join(',\n    ')}\n  ]`
    : '[]';

  jsonEl.innerHTML =
    `{\n  "attributes": ${telSection},\n  "static_attributes": ${staticSection}\n}`;
}

function openMachineAttributesModal(machine) {
  const title = document.getElementById('machineAttributesModalTitle');
  if (title) {
    title.textContent = `Attributes — ${machine.friendlyName || machine.deviceId}`;
  }

  const telemetryAttrs = Array.isArray(machine.attributes) ? machine.attributes : [];
  const customStaticAttrs = Array.isArray(machine.staticAttributes)
    ? machine.staticAttributes.filter((a) => !SYSTEM_STATIC_ATTR_NAMES.has(a.name))
    : [];
  const systemStaticAttrs = Array.isArray(machine.staticAttributes)
    ? machine.staticAttributes.filter((a) => SYSTEM_STATIC_ATTR_NAMES.has(a.name))
    : [];
  const allStaticAttrs = Array.isArray(machine.staticAttributes) ? machine.staticAttributes : [];

  const visual = document.getElementById('machineAttributesVisual');
  if (visual) {
    const telemetryRows = telemetryAttrs.length
      ? telemetryAttrs
          .map(
            (a) => `
          <tr class="border-b border-gray-100">
            <td class="py-1.5 pr-3 text-xs font-mono text-gray-500">${escapeHtml(a.object_id || '')}</td>
            <td class="py-1.5 pr-3 text-xs font-semibold text-indigo-700">${escapeHtml(a.name || '')}</td>
            <td class="py-1.5 text-xs text-indigo-500">${escapeHtml(a.type || '')}</td>
          </tr>`
          )
          .join('')
      : `<tr><td colspan="3" class="py-2 text-xs text-gray-400 italic">None</td></tr>`;

    const customStaticRows = customStaticAttrs.length
      ? customStaticAttrs
          .map(
            (a) => `
          <tr class="border-b border-gray-100">
            <td class="py-1.5 pr-3 text-xs font-semibold text-indigo-700">${escapeHtml(a.name || '')}</td>
            <td class="py-1.5 pr-3 text-xs text-indigo-500">${escapeHtml(a.type || '')}</td>
            <td class="py-1.5 text-xs text-gray-600">${escapeHtml(String(a.value ?? ''))}</td>
          </tr>`
          )
          .join('')
      : `<tr><td colspan="3" class="py-2 text-xs text-gray-400 italic">None</td></tr>`;

    const systemStaticRows = systemStaticAttrs
      .map(
        (a) => `
        <tr class="border-b border-gray-100 system-attr hidden">
          <td class="py-1.5 pr-3 text-xs font-semibold text-amber-700">${escapeHtml(a.name || '')}</td>
          <td class="py-1.5 pr-3 text-xs text-amber-500">${escapeHtml(a.type || '')}</td>
          <td class="py-1.5 text-xs text-gray-500">${escapeHtml(String(a.value ?? ''))}</td>
        </tr>`
      )
      .join('');

    const hasSystemAttrs = systemStaticAttrs.length > 0;

    visual.innerHTML = `
      <div class="flex items-center justify-between mb-3">
        <div class="flex items-center gap-5 text-xs text-gray-500">
          <span class="flex items-center gap-1.5">
            <span class="inline-block w-2.5 h-2.5 rounded-full bg-indigo-500 shrink-0"></span>User-defined
          </span>
          ${hasSystemAttrs ? `
          <span class="flex items-center gap-1.5">
            <span class="inline-block w-2.5 h-2.5 rounded-full bg-amber-400 shrink-0"></span>System-generated
          </span>` : ''}
        </div>
        ${hasSystemAttrs ? `
        <button type="button" id="toggleSystemAttrsBtn"
          class="flex items-center gap-1.5 text-xs text-gray-500 hover:text-gray-700 focus:outline-none"
          title="Show/hide system-generated attributes">
          <i class="fas fa-eye-slash text-sm"></i>
          <span>Show system</span>
        </button>` : ''}
      </div>
      <h3 class="text-sm font-semibold text-gray-700 mb-2">Telemetry Attributes</h3>
      <table class="w-full mb-6 text-left">
        <thead>
          <tr class="text-xs text-gray-500 border-b border-gray-200">
            <th class="pb-1 pr-3 font-medium">Object ID</th>
            <th class="pb-1 pr-3 font-medium">Name</th>
            <th class="pb-1 font-medium">Type</th>
          </tr>
        </thead>
        <tbody>${telemetryRows}</tbody>
      </table>
      <h3 class="text-sm font-semibold text-gray-700 mb-2">Static Attributes</h3>
      <table class="w-full text-left">
        <thead>
          <tr class="text-xs text-gray-500 border-b border-gray-200">
            <th class="pb-1 pr-3 font-medium">Name</th>
            <th class="pb-1 pr-3 font-medium">Type</th>
            <th class="pb-1 font-medium">Value</th>
          </tr>
        </thead>
        <tbody>${customStaticRows}${systemStaticRows}</tbody>
      </table>`;

    if (hasSystemAttrs) {
      const toggleBtn = visual.querySelector('#toggleSystemAttrsBtn');
      toggleBtn?.addEventListener('click', () => {
        const systemRows = visual.querySelectorAll('tr.system-attr');
        const icon = toggleBtn.querySelector('i');
        const label = toggleBtn.querySelector('span');
        const isHidden = systemRows.length > 0 && systemRows[0].classList.contains('hidden');
        systemRows.forEach((row) => row.classList.toggle('hidden', !isHidden));
        icon?.classList.toggle('fa-eye-slash', !isHidden);
        icon?.classList.toggle('fa-eye', isHidden);
        if (label) label.textContent = isHidden ? 'Hide system' : 'Show system';

        const jsonEl = document.getElementById('machineAttributesJson');
        if (jsonEl) {
          renderAttrJson(jsonEl, telemetryAttrs, customStaticAttrs, systemStaticAttrs, isHidden);
        }
      });
    }
  }

  const jsonEl = document.getElementById('machineAttributesJson');
  if (jsonEl) {
    renderAttrJson(jsonEl, telemetryAttrs, customStaticAttrs, systemStaticAttrs, false);
  }

  openModal('machineAttributesModal');
}

// ─── Edit modal initialisation ────────────────────────────────────────────────

function initEditModals() {
  // Attributes view modal wiring
  document.getElementById('machineAttributesModalClose')
    ?.addEventListener('click', () => closeModal('machineAttributesModal'));
  const attrsModal = document.getElementById('machineAttributesModal');
  attrsModal?.addEventListener('click', (e) => {
    if (e.target === attrsModal) closeModal('machineAttributesModal');
  });

  // Machine modal wiring
  document.getElementById('editMachineForm')
    ?.addEventListener('submit', handleEditMachineSubmit);
  document.getElementById('editMachineClose')
    ?.addEventListener('click', () => closeModal('editMachineModal'));
  document.getElementById('editMachineCancelBtn')
    ?.addEventListener('click', () => closeModal('editMachineModal'));
  const machineModal = document.getElementById('editMachineModal');
  machineModal?.addEventListener('click', (e) => {
    if (e.target === machineModal) closeModal('editMachineModal');
  });

  // Telemetry toggle for edit modal
  const editAttrToggle = document.getElementById('editAttributeModeToggle');
  const editAttrKnob = editAttrToggle?.querySelector('.mode-knob') || null;
  setupToggleControl({
    toggleElement: editAttrToggle,
    getMode: () => editTelemetryInputMode,
    setMode: (mode) => {
      editTelemetryInputMode = mode === 'automatic' ? 'automatic' : 'manual';
      const isAuto = editTelemetryInputMode === 'automatic';
      document.getElementById('editAttributeManualContainer')?.classList.toggle('hidden', isAuto);
      document.getElementById('editAttributeAutomaticContainer')?.classList.toggle('hidden', !isAuto);
      if (editAttrToggle) {
        editAttrToggle.dataset.mode = editTelemetryInputMode;
        editAttrToggle.setAttribute('aria-checked', isAuto ? 'true' : 'false');
      }
      applyToggleVisual({ toggle: editAttrToggle, progress: isAuto ? 1 : 0, knob: editAttrKnob });
      hideMessage(document.getElementById('editMachineMsg'));
    },
    preview: (progress) => applyToggleVisual({ toggle: editAttrToggle, progress, knob: editAttrKnob })
  });

  // Static attributes toggle for edit modal
  const editStaticToggle = document.getElementById('editStaticAttributesModeToggle');
  const editStaticKnob = editStaticToggle?.querySelector('.mode-knob') || null;
  setupToggleControl({
    toggleElement: editStaticToggle,
    getMode: () => editStaticInputMode,
    setMode: (mode) => {
      editStaticInputMode = mode === 'automatic' ? 'automatic' : 'manual';
      const isAuto = editStaticInputMode === 'automatic';
      document.getElementById('editStaticAttributesManualContainer')?.classList.toggle('hidden', isAuto);
      document.getElementById('editStaticAttributesAutomaticContainer')?.classList.toggle('hidden', !isAuto);
      if (editStaticToggle) {
        editStaticToggle.dataset.mode = editStaticInputMode;
        editStaticToggle.setAttribute('aria-checked', isAuto ? 'true' : 'false');
      }
      applyToggleVisual({ toggle: editStaticToggle, progress: isAuto ? 1 : 0, knob: editStaticKnob });
      hideMessage(document.getElementById('editMachineMsg'));
    },
    preview: (progress) => applyToggleVisual({ toggle: editStaticToggle, progress, knob: editStaticKnob })
  });

  document.getElementById('editAttributeAddBtn')
    ?.addEventListener('click', handleEditAddTelemetryAttribute);
  document.getElementById('editStaticAttributeAddBtn')
    ?.addEventListener('click', handleEditAddStaticAttribute);
  document.getElementById('editAttributeAutoList')
    ?.addEventListener('click', handleEditTelemetryAttributeListClick);
  document.getElementById('editStaticAttributeAutoList')
    ?.addEventListener('click', handleEditStaticAttributeListClick);
}

// ─── Populate edit modals ─────────────────────────────────────────────────────

function populateEditMachineModal(machine) {
  const setVal = (id, val) => {
    const el = document.getElementById(id);
    if (el) el.value = val || '';
  };

  setVal('editMachineOriginalDeviceId', machine.deviceId);
  setVal('editMachineDeviceId', machine.deviceId);
  setVal('editMachineName', machine.friendlyName);
  setVal('editMachineAssetId', machine.assetIdMissing ? '' : machine.assetId);
  setVal('editMachineDescription', machine.notes);

  const assetInput = document.getElementById('editMachineAssetId');
  if (assetInput) assetInput.dataset.originalAssetId = machine.assetIdMissing ? '' : machine.assetId;
  const legacyHint = document.getElementById('editMachineLegacyAssetHint');
  if (legacyHint) {
    const legacyValue = machine.assetIdMissing ? (machine.assetId || machine.model || '') : '';
    legacyHint.textContent = legacyValue
      ? `Legacy model value: ${legacyValue}. Enter and confirm a valid Asset ID.`
      : 'This machine does not have an Asset ID yet.';
    legacyHint.classList.toggle('hidden', !machine.assetIdMissing);
  }

  const statusEl = document.getElementById('editMachineStatus');
  if (statusEl) {
    const placeholder = getMachineStatusByCode(machine.statusPlaceholderCode || DEFAULT_MACHINE_STATUS.code);
    populateMachineStatusSelect(statusEl, placeholder.code);
    updateMachineStatusPreview('editMachineStatusPreview', statusEl.value);
  }

  populateEditMachineServiceGroupOptions(machine.serviceKey);

  // Telemetry attributes — start in manual mode with existing JSON
  editTelemetryAttributeEntries = Array.isArray(machine.attributes)
    ? machine.attributes.map((a) => ({ ...a }))
    : [];
  setVal(
    'editMachineAttributesManual',
    editTelemetryAttributeEntries.length
      ? JSON.stringify(editTelemetryAttributeEntries, null, 2)
      : ''
  );

  // Reset telemetry toggle to manual
  editTelemetryInputMode = 'manual';
  document.getElementById('editAttributeManualContainer')?.classList.remove('hidden');
  document.getElementById('editAttributeAutomaticContainer')?.classList.add('hidden');
  const editAttrToggle = document.getElementById('editAttributeModeToggle');
  if (editAttrToggle) {
    editAttrToggle.dataset.mode = 'manual';
    editAttrToggle.setAttribute('aria-checked', 'false');
  }
  applyToggleVisual({
    toggle: editAttrToggle,
    progress: 0,
    knob: editAttrToggle?.querySelector('.mode-knob') || null
  });
  renderEditTelemetryAttributeList();

  // Custom static attributes (filter out system-generated ones)
  const customStatic = Array.isArray(machine.staticAttributes)
    ? machine.staticAttributes.filter((a) => !SYSTEM_STATIC_ATTR_NAMES.has(a.name))
    : [];
  editStaticAttributeEntries = customStatic.map((a) => ({ ...a }));
  setVal(
    'editMachineStaticAttributesManual',
    editStaticAttributeEntries.length
      ? JSON.stringify(editStaticAttributeEntries, null, 2)
      : ''
  );

  // Reset static toggle to manual
  editStaticInputMode = 'manual';
  document.getElementById('editStaticAttributesManualContainer')?.classList.remove('hidden');
  document.getElementById('editStaticAttributesAutomaticContainer')?.classList.add('hidden');
  const editStaticToggle = document.getElementById('editStaticAttributesModeToggle');
  if (editStaticToggle) {
    editStaticToggle.dataset.mode = 'manual';
    editStaticToggle.setAttribute('aria-checked', 'false');
  }
  applyToggleVisual({
    toggle: editStaticToggle,
    progress: 0,
    knob: editStaticToggle?.querySelector('.mode-knob') || null
  });
  renderEditStaticAttributeList();

  // Clear add-row input fields
  ['editAttributeObjectId', 'editAttributeName', 'editAttributeType',
    'editStaticAttributeName', 'editStaticAttributeType', 'editStaticAttributeValue']
    .forEach((id) => setVal(id, ''));

  hideMessage(document.getElementById('editMachineMsg'));
}

function populateEditMachineServiceGroupOptions(currentServiceKey) {
  const select = document.getElementById('editMachineServiceGroup');
  if (!select) return;
  if (!serviceGroups.length) {
    select.innerHTML = '<option value="">No service groups available</option>';
    select.disabled = true;
    return;
  }
  const options = [
    '<option value="">Select a service group</option>',
    ...serviceGroups
      .slice()
      .sort((a, b) => getServiceLabel(a).localeCompare(getServiceLabel(b)))
      .map(
        (group) =>
          `<option value="${escapeHtml(group.key)}"${group.key === currentServiceKey ? ' selected' : ''}>${escapeHtml(getServiceLabel(group))}</option>`
      )
  ];
  select.innerHTML = options.join('');
  select.disabled = false;
}

// ─── Edit telemetry attribute list ────────────────────────────────────────────

function handleEditAddTelemetryAttribute(event) {
  event.preventDefault();
  const msgEl = document.getElementById('editMachineMsg');
  hideMessage(msgEl);
  if (editTelemetryInputMode !== 'automatic') {
    showMessage(msgEl, 'Toggle to Automatic builder to add telemetry attributes.');
    return;
  }
  const objectId = (document.getElementById('editAttributeObjectId')?.value || '').trim();
  const name = (document.getElementById('editAttributeName')?.value || '').trim();
  const type = (document.getElementById('editAttributeType')?.value || '').trim();
  if (!objectId || !name || !type) {
    showMessage(msgEl, 'Provide object ID, name, and type for the telemetry attribute.');
    return;
  }
  editTelemetryAttributeEntries.push({ object_id: objectId, name, type });
  renderEditTelemetryAttributeList();
  const clearId = (id) => { const el = document.getElementById(id); if (el) el.value = ''; };
  clearId('editAttributeObjectId');
  clearId('editAttributeName');
  clearId('editAttributeType');
}

function handleEditTelemetryAttributeListClick(event) {
  const target = event.target;
  if (!(target instanceof Element)) return;
  const button = target.closest('[data-action="remove-edit-telemetry-attribute"]');
  if (!button) return;
  event.preventDefault();
  const index = Number.parseInt(button.getAttribute('data-index') || '', 10);
  if (Number.isNaN(index)) return;
  editTelemetryAttributeEntries.splice(index, 1);
  renderEditTelemetryAttributeList();
}

function renderEditTelemetryAttributeList() {
  const list = document.getElementById('editAttributeAutoList');
  if (!list) return;
  if (!editTelemetryAttributeEntries.length) {
    list.innerHTML = '<li class="px-3 py-2 text-xs text-gray-500">No attributes added yet.</li>';
    return;
  }
  list.innerHTML = editTelemetryAttributeEntries
    .map((attr, index) => {
      const label = [
        `<span class="font-semibold text-gray-800">${escapeHtml(attr.name)}</span>`,
        `<span class="ml-2 text-xs text-gray-500">${escapeHtml(attr.object_id || '')}</span>`,
        `<span class="ml-2 text-xs text-indigo-600">${escapeHtml(attr.type)}</span>`
      ].join('');
      return `<li class="px-3 py-2 flex items-center justify-between">
        <span class="text-sm text-gray-700">${label}</span>
        <button type="button" class="text-xs text-red-600 hover:underline"
          data-action="remove-edit-telemetry-attribute" data-index="${index}">Remove</button>
      </li>`;
    })
    .join('');
}

// ─── Edit static attribute list ───────────────────────────────────────────────

function handleEditAddStaticAttribute(event) {
  event.preventDefault();
  const msgEl = document.getElementById('editMachineMsg');
  hideMessage(msgEl);
  if (editStaticInputMode !== 'automatic') {
    showMessage(msgEl, 'Toggle to Automatic builder to add static attributes.');
    return;
  }
  const name = (document.getElementById('editStaticAttributeName')?.value || '').trim();
  const type = (document.getElementById('editStaticAttributeType')?.value || '').trim();
  const value = (document.getElementById('editStaticAttributeValue')?.value || '').trim();
  if (!name || !type || !value) {
    showMessage(msgEl, 'Provide name, type, and value for the static attribute.');
    return;
  }
  if (SYSTEM_STATIC_ATTR_NAMES.has(name)) {
    showMessage(msgEl, `${name} is managed by the portal and cannot be added as a custom attribute.`);
    return;
  }
  editStaticAttributeEntries.push({ name, type, value });
  renderEditStaticAttributeList();
  const clearId = (id) => { const el = document.getElementById(id); if (el) el.value = ''; };
  clearId('editStaticAttributeName');
  clearId('editStaticAttributeType');
  clearId('editStaticAttributeValue');
}

function handleEditStaticAttributeListClick(event) {
  const target = event.target;
  if (!(target instanceof Element)) return;
  const button = target.closest('[data-action="remove-edit-static-attribute"]');
  if (!button) return;
  event.preventDefault();
  const index = Number.parseInt(button.getAttribute('data-index') || '', 10);
  if (Number.isNaN(index)) return;
  editStaticAttributeEntries.splice(index, 1);
  renderEditStaticAttributeList();
}

function renderEditStaticAttributeList() {
  const list = document.getElementById('editStaticAttributeAutoList');
  if (!list) return;
  if (!editStaticAttributeEntries.length) {
    list.innerHTML = '<li class="px-3 py-2 text-xs text-gray-500">No static attributes added yet.</li>';
    return;
  }
  list.innerHTML = editStaticAttributeEntries
    .map((attr, index) => {
      const label = [
        `<span class="font-semibold text-gray-800">${escapeHtml(attr.name)}</span>`,
        `<span class="ml-2 text-xs text-indigo-600">${escapeHtml(attr.type)}</span>`,
        `<span class="ml-2 text-xs text-gray-500">${escapeHtml(String(attr.value ?? ''))}</span>`
      ].join('');
      return `<li class="px-3 py-2 flex items-center justify-between">
        <span class="text-sm text-gray-700">${label}</span>
        <button type="button" class="text-xs text-red-600 hover:underline"
          data-action="remove-edit-static-attribute" data-index="${index}">Remove</button>
      </li>`;
    })
    .join('');
}

// ─── Collect helpers for edit modal ──────────────────────────────────────────

function collectEditTelemetryAttributes() {
  if (editTelemetryInputMode === 'automatic') {
    return editTelemetryAttributeEntries.map((e) => ({ ...e }));
  }
  const raw = (document.getElementById('editMachineAttributesManual')?.value || '').trim();
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) throw new Error('Attributes JSON must be an array.');
    return parsed;
  } catch (error) {
    showMessage(document.getElementById('editMachineMsg'), `Attributes JSON error: ${error.message}`);
    return null;
  }
}

function collectEditStaticAttributesInput() {
  if (editStaticInputMode === 'automatic') {
    return editStaticAttributeEntries.map((e) => ({ ...e }));
  }
  const raw = (document.getElementById('editMachineStaticAttributesManual')?.value || '').trim();
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) throw new Error('Static attributes JSON must be an array.');
    return parsed;
  } catch (error) {
    showMessage(document.getElementById('editMachineMsg'), `Static attributes JSON error: ${error.message}`);
    return null;
  }
}

// ─── Edit submit handlers ─────────────────────────────────────────────────────

async function handleEditMachineSubmit(event) {
  event.preventDefault();
  const msgEl = document.getElementById('editMachineMsg');
  hideMessage(msgEl);

  const deviceId = document.getElementById('editMachineOriginalDeviceId')?.value || '';
  const friendlyName = (document.getElementById('editMachineName')?.value || '').trim();
  const assetInput = document.getElementById('editMachineAssetId');
  const assetValidation = validateAssetId(assetInput?.value);
  const description = (document.getElementById('editMachineDescription')?.value || '').trim();
  const statusPlaceholder = getSelectedMachineStatusPlaceholder(document.getElementById('editMachineStatus'));
  const selectedServiceKey = document.getElementById('editMachineServiceGroup')?.value || '';

  if (!deviceId) { showMessage(msgEl, 'Device ID is missing.'); return; }
  if (!assetValidation.valid) {
    assetInput?.setCustomValidity(assetValidation.error);
    showMessage(msgEl, assetValidation.error);
    return;
  }
  assetInput?.setCustomValidity('');
  const assetConflict = findAssetIdConflict(getVisibleMachines(), assetValidation.value, deviceId);
  if (assetConflict) {
    const message = `Asset ID ${assetValidation.value} is already assigned to ${assetConflict.deviceId}.`;
    assetInput?.setCustomValidity(message);
    showMessage(msgEl, message);
    return;
  }
  if (!selectedServiceKey) {
    showMessage(msgEl, 'Select the service group responsible for this machine.');
    return;
  }

  const targetService = serviceGroups.find((svc) => svc.key === selectedServiceKey);
  if (!targetService) {
    showMessage(msgEl, 'Selected service group is no longer available. Reload and try again.');
    return;
  }

  const entityType = targetService?.entityType || 'Thing';
  const entityName = buildEntityName(deviceId, entityType);

  const attributes = collectEditTelemetryAttributes();
  if (attributes === null) return;

  const defaultStaticAttributes = buildDefaultStaticAttributes({
    friendlyName,
    assetId: assetValidation.value,
    description,
    statusPlaceholder,
    serviceKey: targetService.key,
    serviceApikey: targetService.apikey,
    serviceResource: targetService.resource,
    serviceFiware: targetService.fiwareService,
    serviceSubservice: targetService.subservice,
    telemetryAttributes: attributes
  });

  const customStaticAttributes = collectEditStaticAttributesInput();
  if (customStaticAttributes === null) return;

  const reservedAttribute = customStaticAttributes.find((attr) => SYSTEM_STATIC_ATTR_NAMES.has(attr?.name));
  if (reservedAttribute) {
    showMessage(msgEl, `${reservedAttribute.name} is managed by the portal and cannot be supplied as a custom attribute.`);
    return;
  }

  const originalMachine = getVisibleMachines().find((machine) => machine.deviceId === deviceId);
  const staticAttributes = [
    ...defaultStaticAttributes,
    ...getLegacyIdentityStaticAttributes(originalMachine),
    ...customStaticAttributes
  ];

  const payload = {
    entity_name: entityName,
    entity_type: entityType,
    transport: IOT_AGENT_TRANSPORT,
    protocol: IOT_AGENT_PROTOCOL,
    attributes,
    commands: [],
    static_attributes: staticAttributes
  };

  const originalAssetId = assetInput?.dataset.originalAssetId || '';
  if (originalAssetId && originalAssetId !== assetValidation.value) {
    const accepted = await confirmAssetIdChange(originalAssetId, assetValidation.value);
    if (!accepted) {
      assetInput?.focus();
      return;
    }
  }

  const submitBtn = document.getElementById('editMachineForm')?.querySelector('button[type="submit"]');
  const originalText = submitBtn?.textContent;
  if (submitBtn) { submitBtn.textContent = 'Saving...'; submitBtn.disabled = true; }

  try {
    const resp = await apiFetch(`/iot/devices/${encodeURIComponent(deviceId)}`, {
      method: 'PUT',
      headers: buildHeaders({ includeJson: true }),
      body: JSON.stringify(payload)
    });
    if (!resp.ok) throw new Error(await extractError(resp, IOT_CONTEXTS.updateMachine));

    closeModal('editMachineModal');
    showMessage(machineMsg, `Machine ${deviceId} updated successfully.`, false);

    await fetchMachines();
    renderMachines();
  } catch (error) {
    console.error('Error updating machine:', error);
    showMessage(msgEl, formatThrownError(error, IOT_CONTEXTS.updateMachine));
  } finally {
    if (submitBtn) { submitBtn.textContent = originalText || 'Save Changes'; submitBtn.disabled = false; }
  }
}
