import { subscribeRegisteredMachines } from './inventory.js';
import { renderMachineStatusBadge } from './machine-status.js';
import {
  cloneLayout,
  moveMachine,
  reconcileLayout,
  rotateMachine
} from './digital-twin-layout.js';
import {
  getMachineDisplayLabel,
  getMachineLabelDetails
} from './machine-identity.js';

const LAYOUT_ENDPOINT = '/bff/portal/digital-twin-layout';
const MODEL_URL = 'models/base_basic_pbr.glb';

function queryElements() {
  const byId = (id) => document.getElementById(id);
  return {
    section: byId('digitalTwinSection'),
    tool: byId('digitalTwinTool'),
    workspace: byId('twinWorkspace'),
    host: byId('twinCanvasHost'),
    count: byId('twinMachineCount'),
    picker: byId('twinMachinePicker'),
    edit: byId('twinEditLayout'),
    save: byId('twinSaveLayout'),
    cancel: byId('twinCancelLayout'),
    reset: byId('twinResetView'),
    rotationControl: byId('twinRotationControl'),
    rotation: byId('twinRotationInput'),
    message: byId('twinMessage'),
    loading: byId('twinLoadingState'),
    loadingPercent: byId('twinLoadingPercent'),
    progress: byId('twinLoadProgress'),
    empty: byId('twinEmptyState'),
    error: byId('twinErrorState'),
    errorText: byId('twinErrorText'),
    retry: byId('twinRetry'),
    provision: byId('twinProvisionMachine'),
    live: byId('twinLiveRegion'),
    inspector: byId('twinInspector'),
    inspectorTitle: byId('twinInspectorTitle'),
    inspectorAssetId: byId('twinInspectorAssetId'),
    inspectorAssetWarning: byId('twinInspectorAssetWarning'),
    inspectorName: byId('twinInspectorName'),
    inspectorDeviceId: byId('twinInspectorDeviceId'),
    inspectorEntityId: byId('twinInspectorEntityId'),
    inspectorStatus: byId('twinInspectorStatus'),
    closeInspector: byId('twinCloseInspector'),
    viewer: byId('machineViewer'),
    viewerLoader: byId('twinLoader')
  };
}

function responseError(response, fallback) {
  return response.json()
    .then((payload) => payload?.error || fallback)
    .catch(() => fallback);
}

async function fetchPersonalLayout() {
  const response = await fetch(LAYOUT_ENDPOINT, {
    method: 'GET',
    credentials: 'include',
    headers: { Accept: 'application/json' }
  });
  if (!response.ok) throw new Error(await responseError(response, 'Unable to load your factory layout.'));
  return response.json();
}

async function putPersonalLayout(layout) {
  const response = await fetch(LAYOUT_ENDPOINT, {
    method: 'PUT',
    credentials: 'include',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({
      baseRevision: layout.revision,
      factory: layout.factory,
      machines: layout.machines
    })
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(payload?.error || 'Unable to save your factory layout.');
    error.status = response.status;
    error.currentLayout = payload?.currentLayout || null;
    throw error;
  }
  return payload;
}

export function initTwinViewer({ onProvisionMachine } = {}) {
  const elements = queryElements();
  if (!elements.section || !elements.host) return null;

  let sceneController = null;
  let scenePromise = null;
  let machines = [];
  let savedLayout = cloneLayout({ machines: {} });
  let draftLayout = cloneLayout(savedLayout);
  let selectedDeviceId = '';
  let editing = false;
  let layoutLoaded = false;
  let layoutAvailable = true;
  let sceneReady = false;
  let active = false;
  let saveInFlight = false;
  let automaticReconcileQueued = false;

  const findMachine = (deviceId) => machines.find((machine) => machine.deviceId === deviceId) || null;

  function announce(message) {
    if (!elements.live) return;
    elements.live.textContent = '';
    window.requestAnimationFrame(() => {
      elements.live.textContent = message;
    });
  }

  function showMessage(message = '', type = '') {
    if (!elements.message) return;
    elements.message.textContent = message;
    elements.message.classList.toggle('hidden', !message);
    elements.message.classList.toggle('is-error', type === 'error');
    elements.message.classList.toggle('is-success', type === 'success');
  }

  function setLoadingProgress(value) {
    const percentage = Math.round(Math.max(0, Math.min(1, value)) * 100);
    if (elements.loadingPercent) elements.loadingPercent.textContent = `${percentage}%`;
    if (elements.progress) elements.progress.style.transform = `scaleX(${percentage / 100})`;
  }

  function updateStateLayers() {
    const hasMachines = machines.length > 0;
    elements.loading?.classList.toggle('hidden', sceneReady);
    elements.empty?.classList.toggle('hidden', !sceneReady || hasMachines);
    if (elements.edit) {
      elements.edit.disabled = !sceneReady || !hasMachines || !layoutAvailable || saveInFlight;
    }
    if (elements.picker) elements.picker.disabled = !hasMachines;
  }

  function updateToolbar() {
    const count = machines.length;
    if (elements.count) elements.count.textContent = `${count} ${count === 1 ? 'machine' : 'machines'}`;
    elements.edit?.classList.toggle('hidden', editing);
    elements.save?.classList.toggle('hidden', !editing);
    elements.cancel?.classList.toggle('hidden', !editing);
    elements.rotationControl?.classList.toggle('hidden', !editing);
    elements.host?.classList.toggle('is-editing', editing);

    if (elements.rotation) {
      const placement = draftLayout.machines[selectedDeviceId];
      elements.rotation.disabled = !editing || !placement;
      elements.rotation.value = placement ? String(placement.rotation) : '0';
    }
    updateStateLayers();
  }

  function updateMachinePicker() {
    if (!elements.picker) return;
    const currentValue = selectedDeviceId;
    elements.picker.replaceChildren(new Option('Select machine', ''));
    machines
      .slice()
      .sort((a, b) => getMachineDisplayLabel(a).localeCompare(getMachineDisplayLabel(b)))
      .forEach((machine) => {
        elements.picker.appendChild(new Option(getMachineDisplayLabel(machine), machine.deviceId));
      });
    elements.picker.value = findMachine(currentValue) ? currentValue : '';
  }

  function closeInspector() {
    selectedDeviceId = '';
    elements.inspector?.classList.add('hidden');
    elements.workspace?.classList.remove('has-inspector');
    if (elements.picker) elements.picker.value = '';
    sceneController?.setSelected('');
    updateToolbar();
  }

  function renderInspector(machine) {
    if (!machine) {
      closeInspector();
      return;
    }
    const label = getMachineDisplayLabel(machine);
    const details = getMachineLabelDetails(machine);
    elements.inspector?.classList.remove('hidden');
    elements.workspace?.classList.add('has-inspector');
    if (elements.inspectorTitle) {
      elements.inspectorTitle.textContent = details.title;
      elements.inspectorTitle.title = label;
    }
    if (elements.inspectorAssetId) elements.inspectorAssetId.textContent = details.assetId;
    elements.inspectorAssetId?.classList.toggle('is-missing', details.missing);
    elements.inspectorAssetWarning?.classList.toggle('hidden', !details.missing);
    if (elements.inspectorName) elements.inspectorName.textContent = machine.friendlyName || '—';
    if (elements.inspectorDeviceId) elements.inspectorDeviceId.textContent = machine.deviceId || '—';
    if (elements.inspectorEntityId) elements.inspectorEntityId.textContent = machine.entityName || '—';
    if (elements.inspectorStatus) {
      elements.inspectorStatus.innerHTML = renderMachineStatusBadge(machine.machineStatus);
    }
  }

  function selectMachine(deviceId, { focus = true } = {}) {
    const machine = findMachine(deviceId);
    if (!machine) {
      closeInspector();
      return;
    }
    selectedDeviceId = deviceId;
    if (elements.picker) elements.picker.value = deviceId;
    sceneController?.setSelected(deviceId);
    renderInspector(machine);
    updateToolbar();
    announce(`${getMachineDisplayLabel(machine)} selected.`);
    if (focus) {
      window.requestAnimationFrame(() => {
        window.requestAnimationFrame(() => sceneController?.focusMachine(deviceId));
      });
    }
  }

  function renderScene() {
    const layout = editing ? draftLayout : savedLayout;
    sceneController?.setMachines(machines, layout);
    sceneController?.setSelected(selectedDeviceId);
    sceneController?.setEditing(editing);
    updateMachinePicker();
    updateToolbar();
    if (selectedDeviceId) renderInspector(findMachine(selectedDeviceId));
  }

  async function persistLayout(candidate, { automatic = false, retry = true } = {}) {
    if (!layoutAvailable) return null;
    if (saveInFlight) {
      if (automatic) automaticReconcileQueued = true;
      return null;
    }
    saveInFlight = true;
    if (elements.save) elements.save.disabled = true;
    updateStateLayers();

    try {
      const persisted = cloneLayout(await putPersonalLayout(candidate));
      savedLayout = persisted;
      if (!editing || automatic) draftLayout = cloneLayout(persisted);
      return persisted;
    } catch (error) {
      if (error.status === 409 && retry) {
        const latest = cloneLayout(error.currentLayout || await fetchPersonalLayout());
        const reconciled = reconcileLayout(latest, machines).layout;
        saveInFlight = false;
        return persistLayout(reconciled, { automatic, retry: false });
      }
      showMessage(
        error.status === 409
          ? 'This layout changed in another session. Cancel and reopen edit mode to load the latest version.'
          : error.message,
        'error'
      );
      announce(error.message);
      return null;
    } finally {
      saveInFlight = false;
      if (elements.save) elements.save.disabled = false;
      updateStateLayers();
      const shouldReconcile = automaticReconcileQueued;
      automaticReconcileQueued = false;
      if (shouldReconcile && !editing) {
        window.queueMicrotask(() => void reconcileCurrentLayout());
      }
    }
  }

  async function reconcileCurrentLayout({ automatic = true } = {}) {
    if (!layoutLoaded) return;
    const base = editing ? draftLayout : savedLayout;
    const result = reconcileLayout(base, machines);

    if (editing) {
      draftLayout = result.layout;
    } else {
      savedLayout = result.layout;
      draftLayout = cloneLayout(result.layout);
    }
    renderScene();

    if (automatic && result.changed && !editing && layoutAvailable) {
      const persisted = await persistLayout(savedLayout, { automatic: true });
      if (persisted) renderScene();
    }
  }

  async function loadLayout() {
    layoutLoaded = false;
    try {
      savedLayout = cloneLayout(await fetchPersonalLayout());
      draftLayout = cloneLayout(savedLayout);
      layoutAvailable = true;
      layoutLoaded = true;
      showMessage('');
      await reconcileCurrentLayout();
    } catch (error) {
      console.error('Unable to load personal digital-twin layout:', error);
      layoutAvailable = false;
      layoutLoaded = true;
      savedLayout = reconcileLayout({ machines: {} }, machines).layout;
      draftLayout = cloneLayout(savedLayout);
      showMessage(`${error.message} The map is available in read-only mode.`, 'error');
      renderScene();
    }
  }

  async function createScene() {
    if (scenePromise) return scenePromise;
    sceneReady = false;
    setLoadingProgress(0);
    elements.error?.classList.add('hidden');
    updateStateLayers();

    scenePromise = import('./digital-twin-scene.js')
      .then(({ createDigitalTwinScene }) => {
        sceneController = createDigitalTwinScene({
          host: elements.host,
          modelUrl: MODEL_URL,
          onSelect: selectMachine,
          onMove: (deviceId, x, z) => {
            if (!editing) return { accepted: false };
            const result = moveMachine(draftLayout, deviceId, x, z);
            if (!result.moved) {
              if (result.reason === 'occupied') announce('That grid cell is already occupied.');
              return { accepted: false };
            }
            draftLayout = result.layout;
            updateToolbar();
            return {
              accepted: true,
              placement: draftLayout.machines[deviceId],
              layout: draftLayout
            };
          },
          onRotate: (deviceId, rotation) => {
            if (!editing) return;
            const result = rotateMachine(draftLayout, deviceId, rotation);
            draftLayout = result.layout;
            if (elements.rotation && deviceId === selectedDeviceId) {
              elements.rotation.value = String(draftLayout.machines[deviceId].rotation);
            }
          },
          onProgress: setLoadingProgress,
          onReady: () => {
            sceneReady = true;
            setLoadingProgress(1);
            updateStateLayers();
            renderScene();
            sceneController?.resetView();
          },
          onModelError: () => {
            showMessage('The detailed machine model could not be loaded. Simplified machine markers are being used.', 'error');
          }
        });
        sceneController.setActive(active);
        renderScene();
        return sceneController;
      })
      .catch((error) => {
        console.error('Unable to initialize the Three.js factory map:', error);
        scenePromise = null;
        sceneController = null;
        sceneReady = false;
        elements.loading?.classList.add('hidden');
        elements.error?.classList.remove('hidden');
        if (elements.errorText) elements.errorText.textContent = 'The 3D engine could not be loaded. Check the network connection and try again.';
        throw error;
      });
    return scenePromise;
  }

  async function activate() {
    active = true;
    try {
      await Promise.all([createScene(), layoutLoaded ? Promise.resolve() : loadLayout()]);
      sceneController?.setActive(true);
      renderScene();
    } catch (_error) {
      // The visible error state contains the recovery action.
    }
  }

  function deactivate() {
    active = false;
    sceneController?.setActive(false);
  }

  function enterEditMode() {
    if (!layoutAvailable || !machines.length) return;
    draftLayout = cloneLayout(savedLayout);
    editing = true;
    showMessage('');
    renderScene();
    announce('Layout editing enabled.');
  }

  function cancelEditMode() {
    draftLayout = cloneLayout(savedLayout);
    editing = false;
    showMessage('');
    renderScene();
    announce('Layout changes cancelled.');
  }

  async function saveEditMode() {
    const persisted = await persistLayout(draftLayout, { automatic: false, retry: false });
    if (!persisted) return;
    editing = false;
    draftLayout = cloneLayout(persisted);
    showMessage('Layout saved to your account.', 'success');
    renderScene();
    announce('Layout saved.');
  }

  function moveSelectedByKeyboard(deltaX, deltaZ) {
    if (!editing || !selectedDeviceId) return;
    const current = draftLayout.machines[selectedDeviceId];
    if (!current) return;
    const result = moveMachine(draftLayout, selectedDeviceId, current.x + deltaX, current.z + deltaZ);
    if (!result.moved) {
      announce('That grid cell is already occupied.');
      return;
    }
    draftLayout = result.layout;
    sceneController?.setLayout(draftLayout);
    announce(`${getMachineDisplayLabel(findMachine(selectedDeviceId))} moved.`);
  }

  elements.picker?.addEventListener('change', () => selectMachine(elements.picker.value));
  elements.edit?.addEventListener('click', enterEditMode);
  elements.cancel?.addEventListener('click', cancelEditMode);
  elements.save?.addEventListener('click', () => void saveEditMode());
  elements.reset?.addEventListener('click', () => sceneController?.resetView());
  elements.closeInspector?.addEventListener('click', closeInspector);
  elements.provision?.addEventListener('click', () => onProvisionMachine?.());
  elements.retry?.addEventListener('click', () => {
    sceneController?.destroy();
    sceneController = null;
    scenePromise = null;
    void activate();
  });
  elements.rotation?.addEventListener('input', () => {
    if (!editing || !selectedDeviceId) return;
    const result = rotateMachine(draftLayout, selectedDeviceId, elements.rotation.value);
    draftLayout = result.layout;
    sceneController?.updatePlacement(selectedDeviceId, draftLayout.machines[selectedDeviceId]);
  });
  elements.host?.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && editing) {
      event.preventDefault();
      cancelEditMode();
      return;
    }
    const moves = {
      ArrowLeft: [-1, 0],
      ArrowRight: [1, 0],
      ArrowUp: [0, -1],
      ArrowDown: [0, 1]
    };
    const move = moves[event.key];
    if (!move || !editing || !selectedDeviceId) return;
    event.preventDefault();
    moveSelectedByKeyboard(move[0], move[1]);
  });

  const unsubscribe = subscribeRegisteredMachines((snapshot) => {
    machines = snapshot;
    if (selectedDeviceId && !findMachine(selectedDeviceId)) closeInspector();
    updateMachinePicker();
    updateToolbar();
    if (layoutLoaded) void reconcileCurrentLayout();
  });

  if (elements.viewer) {
    elements.viewer.addEventListener('load', () => elements.viewerLoader?.classList.add('hidden'));
    const pause = () => { elements.viewer.autoRotate = false; };
    const resume = () => { elements.viewer.autoRotate = true; };
    elements.viewer.addEventListener('mousedown', pause);
    elements.viewer.addEventListener('touchstart', pause, { passive: true });
    elements.viewer.addEventListener('mouseup', resume);
    elements.viewer.addEventListener('touchend', resume, { passive: true });
  }

  const sectionObserver = new MutationObserver(() => {
    if (elements.section.classList.contains('hidden')) deactivate();
    else void activate();
  });
  sectionObserver.observe(elements.section, { attributes: true, attributeFilter: ['class'] });

  updateToolbar();
  updateMachinePicker();
  if (!elements.section.classList.contains('hidden')) void activate();

  return {
    activate,
    destroy() {
      unsubscribe();
      sectionObserver.disconnect();
      sceneController?.destroy();
    }
  };
}
