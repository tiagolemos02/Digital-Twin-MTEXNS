import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import { CSS2DObject, CSS2DRenderer } from 'three/addons/renderers/CSS2DRenderer.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { getLayoutBounds } from './digital-twin-layout.js';
import { createFactoryEnvironment } from './digital-twin-environment.js';
import {
  getAssetPlateLabel,
  getMachineIdentityPaletteEntry,
  getMachineLabelDetails
} from './machine-identity.js';

const CELL_SIZE = 4.8;
const MODEL_FOOTPRINT = 2.75;
const MODEL_HEIGHT = 3.1;
const FLOOR_MINIMUM_RADIUS = 3;
const POINTER_THRESHOLD = 7;
const TOUCH_POINTER_THRESHOLD = 13;
const TOUCH_DRAG_DELAY_MS = 120;
const CRITICAL_STATUS_CODES = new Set([1, 14]);

function statusColor(status = {}) {
  const rgb = Array.isArray(status.rgb) ? status.rgb : [158, 158, 158];
  return new THREE.Color(rgb[0] / 255, rgb[1] / 255, rgb[2] / 255);
}

function createFallbackModel() {
  const group = new THREE.Group();
  const body = new THREE.Mesh(
    new THREE.BoxGeometry(2.4, 2.15, 2.4),
    new THREE.MeshStandardMaterial({ color: 0x747579, roughness: 0.72, metalness: 0.18 })
  );
  body.position.y = 1.075;
  body.castShadow = true;
  body.receiveShadow = true;
  group.add(body);

  const cap = new THREE.Mesh(
    new THREE.BoxGeometry(1.65, 0.35, 1.65),
    new THREE.MeshStandardMaterial({ color: 0x302c2d, roughness: 0.62, metalness: 0.22 })
  );
  cap.position.y = 2.325;
  cap.castShadow = true;
  group.add(cap);
  return group;
}

function normalizeModel(scene) {
  const model = scene.clone(true);
  model.updateMatrixWorld(true);
  const initialBox = new THREE.Box3().setFromObject(model);
  const size = initialBox.getSize(new THREE.Vector3());
  const horizontalScale = MODEL_FOOTPRINT / Math.max(size.x, size.z, 0.001);
  const verticalScale = MODEL_HEIGHT / Math.max(size.y, 0.001);
  const scale = Math.min(horizontalScale, verticalScale);
  model.scale.setScalar(scale);
  model.updateMatrixWorld(true);

  const normalizedBox = new THREE.Box3().setFromObject(model);
  const center = normalizedBox.getCenter(new THREE.Vector3());
  model.position.x -= center.x;
  model.position.z -= center.z;
  model.position.y -= normalizedBox.min.y;
  model.updateMatrixWorld(true);

  model.traverse((child) => {
    if (!child.isMesh) return;
    child.castShadow = true;
    child.receiveShadow = true;
  });
  return model;
}

function createSelectionCorners() {
  const half = CELL_SIZE * 0.39;
  const arm = CELL_SIZE * 0.16;
  const points = [
    [-half, -half], [-half + arm, -half], [-half, -half], [-half, -half + arm],
    [half, -half], [half - arm, -half], [half, -half], [half, -half + arm],
    [-half, half], [-half + arm, half], [-half, half], [-half, half - arm],
    [half, half], [half - arm, half], [half, half], [half, half - arm]
  ];
  const geometry = new THREE.BufferGeometry().setFromPoints(
    points.map(([x, z]) => new THREE.Vector3(x, 0.065, z))
  );
  const corners = new THREE.LineSegments(
    geometry,
    new THREE.LineBasicMaterial({ color: 0x221e1f, depthTest: false })
  );
  corners.renderOrder = 10;
  corners.visible = false;
  return corners;
}

function findDeviceId(object) {
  let current = object;
  while (current) {
    if (current.userData?.deviceId) return current.userData.deviceId;
    current = current.parent;
  }
  return '';
}

function disposeObjectResources(object) {
  const geometries = new Set();
  const materials = new Set();
  object?.traverse?.((child) => {
    if (child.geometry) geometries.add(child.geometry);
    const childMaterials = Array.isArray(child.material) ? child.material : [child.material];
    childMaterials.filter(Boolean).forEach((material) => materials.add(material));
  });
  geometries.forEach((geometry) => geometry.dispose());
  materials.forEach((material) => material.dispose());
}

export function createDigitalTwinScene({
  host,
  modelUrl,
  onSelect,
  onMove,
  onRotate,
  onProgress,
  onReady,
  onModelError
}) {
  if (!host) throw new Error('A canvas host is required.');

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0xf1f2f3);

  const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 1200);
  camera.position.set(15, 18, 15);

  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.domElement.setAttribute('aria-hidden', 'true');
  host.prepend(renderer.domElement);

  const labelRenderer = new CSS2DRenderer();
  labelRenderer.domElement.style.position = 'absolute';
  labelRenderer.domElement.style.inset = '0';
  labelRenderer.domElement.style.pointerEvents = 'none';
  labelRenderer.domElement.setAttribute('aria-hidden', 'true');
  host.appendChild(labelRenderer.domElement);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.screenSpacePanning = false;
  controls.minDistance = 7;
  controls.maxDistance = 180;
  controls.maxPolarAngle = Math.PI * 0.47;
  controls.target.set(0, 0, 0);

  scene.add(new THREE.HemisphereLight(0xffffff, 0x7d7d80, 2.35));
  const keyLight = new THREE.DirectionalLight(0xffffff, 2.4);
  keyLight.position.set(-14, 24, 12);
  keyLight.castShadow = true;
  keyLight.shadow.mapSize.set(2048, 2048);
  keyLight.shadow.camera.near = 0.5;
  keyLight.shadow.camera.far = 80;
  scene.add(keyLight);

  const environment = createFactoryEnvironment(scene, { cellSize: CELL_SIZE });
  const interactionPlane = new THREE.Mesh(
    new THREE.PlaneGeometry(100_000, 100_000),
    new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false })
  );
  interactionPlane.rotation.x = -Math.PI / 2;
  interactionPlane.position.y = -0.01;
  scene.add(interactionPlane);

  const selectionCorners = createSelectionCorners();
  scene.add(selectionCorners);

  const dropPreview = new THREE.Mesh(
    new THREE.PlaneGeometry(CELL_SIZE * 0.92, CELL_SIZE * 0.92),
    new THREE.MeshBasicMaterial({ color: 0x047857, transparent: true, opacity: 0.16, depthWrite: false })
  );
  dropPreview.rotation.x = -Math.PI / 2;
  dropPreview.position.y = 0.035;
  dropPreview.visible = false;
  scene.add(dropPreview);

  const transformControls = new TransformControls(camera, renderer.domElement);
  transformControls.setMode('rotate');
  transformControls.setSpace('world');
  transformControls.showX = false;
  transformControls.showY = true;
  transformControls.showZ = false;
  transformControls.setSize(0.78);
  scene.add(transformControls);

  const pedestalGeometry = new THREE.CylinderGeometry(1.48, 1.62, 0.22, 8);
  const pedestalMaterials = new Map();
  const statusRingGeometry = new THREE.RingGeometry(1.62, 1.82, 64);
  const ringOutlineGeometry = new THREE.RingGeometry(1.82, 1.88, 64);
  const ringOutlineMaterial = new THREE.MeshBasicMaterial({
    color: 0x515750,
    side: THREE.DoubleSide,
    transparent: true,
    opacity: 0.58
  });

  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  const machineViews = new Map();
  let modelTemplate = null;
  let modelFailed = false;
  let currentMachines = [];
  let currentLayout = { machines: {} };
  let selectedDeviceId = '';
  let hoveredDeviceId = '';
  let editing = false;
  let active = false;
  let animationFrame = 0;
  let pointerState = null;
  let cameraTween = null;
  let destroyed = false;
  const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)') || { matches: false };

  function resize() {
    const width = host.clientWidth;
    const height = host.clientHeight;
    if (!width || !height) return;
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    renderer.setSize(width, height, false);
    labelRenderer.setSize(width, height);
  }

  const resizeObserver = new ResizeObserver(resize);
  resizeObserver.observe(host);

  function updateCameraTween(timestamp) {
    if (!cameraTween) return;
    const progress = Math.min(1, (timestamp - cameraTween.startedAt) / cameraTween.duration);
    const eased = 1 - Math.pow(1 - progress, 4);
    camera.position.lerpVectors(cameraTween.startPosition, cameraTween.endPosition, eased);
    controls.target.lerpVectors(cameraTween.startTarget, cameraTween.endTarget, eased);
    if (progress >= 1) cameraTween = null;
  }

  function updateCriticalRings(timestamp) {
    machineViews.forEach((view) => {
      if (!view.critical || reducedMotion.matches) {
        view.statusRing.material.opacity = 0.92;
        view.statusRing.scale.setScalar(1);
        return;
      }
      const pulse = (Math.sin(timestamp / 420) + 1) / 2;
      view.statusRing.material.opacity = 0.68 + pulse * 0.27;
      view.statusRing.scale.setScalar(1 + pulse * 0.055);
    });
  }

  function updateLabelVisibility() {
    machineViews.forEach((view, deviceId) => {
      const distance = camera.position.distanceTo(view.root.position);
      view.detailLabel.visible = deviceId === selectedDeviceId || deviceId === hoveredDeviceId || distance < 24;
    });
  }

  function renderFrame(timestamp = performance.now()) {
    animationFrame = 0;
    if (!active) return;
    updateCameraTween(timestamp);
    updateCriticalRings(timestamp);
    updateLabelVisibility();
    controls.update();
    renderer.render(scene, camera);
    labelRenderer.render(scene, camera);
    animationFrame = window.requestAnimationFrame(renderFrame);
  }

  function requestRender() {
    if (!active || animationFrame) return;
    animationFrame = window.requestAnimationFrame(renderFrame);
  }

  function updateFloor() {
    const bounds = getLayoutBounds(currentLayout, FLOOR_MINIMUM_RADIUS);
    environment.update(bounds);
  }

  function createLabel(machine) {
    const plateElement = document.createElement('div');
    plateElement.className = 'twin-machine-plate';
    plateElement.textContent = getAssetPlateLabel(machine);
    const plateLabel = new CSS2DObject(plateElement);
    plateLabel.position.set(0, 0.46, 1.58);

    const element = document.createElement('div');
    element.className = 'twin-machine-label';
    const title = document.createElement('strong');
    const asset = document.createElement('span');
    asset.className = 'twin-machine-label-asset';
    const device = document.createElement('span');
    const status = document.createElement('span');
    status.className = 'twin-machine-label-status';
    element.append(title, asset, device, status);
    const detailLabel = new CSS2DObject(element);
    detailLabel.position.set(0, MODEL_HEIGHT + 2.8, 0);
    detailLabel.visible = false;
    return { plateLabel, plateElement, detailLabel, element, title, asset, device, status };
  }

  function pedestalMaterial(deviceId) {
    const palette = getMachineIdentityPaletteEntry(deviceId);
    if (!pedestalMaterials.has(palette.hex)) {
      pedestalMaterials.set(palette.hex, new THREE.MeshStandardMaterial({
        color: palette.hex,
        roughness: 0.68,
        metalness: 0.16
      }));
    }
    return pedestalMaterials.get(palette.hex);
  }

  function createMachineView(machine) {
    const root = new THREE.Group();
    root.userData.deviceId = machine.deviceId;

    const pedestal = new THREE.Mesh(pedestalGeometry, pedestalMaterial(machine.deviceId));
    pedestal.position.y = 0.11;
    pedestal.castShadow = true;
    pedestal.receiveShadow = true;
    pedestal.userData.deviceId = machine.deviceId;
    root.add(pedestal);

    const statusRing = new THREE.Mesh(
      statusRingGeometry,
      new THREE.MeshBasicMaterial({
        color: statusColor(machine.machineStatus),
        side: THREE.DoubleSide,
        transparent: true,
        opacity: 0.92,
        depthWrite: false
      })
    );
    statusRing.rotation.x = -Math.PI / 2;
    statusRing.position.y = 0.035;
    statusRing.userData.deviceId = machine.deviceId;
    root.add(statusRing);

    const ringOutline = new THREE.Mesh(
      ringOutlineGeometry,
      ringOutlineMaterial
    );
    ringOutline.rotation.x = -Math.PI / 2;
    ringOutline.position.y = 0.034;
    root.add(ringOutline);

    const model = (modelTemplate || createFallbackModel()).clone(true);
    model.position.y += 0.22;
    model.userData.deviceId = machine.deviceId;
    model.traverse((child) => {
      if (child.isMesh) child.userData.deviceId = machine.deviceId;
    });
    root.add(model);

    const labelParts = createLabel(machine);
    root.add(labelParts.plateLabel, labelParts.detailLabel);
    scene.add(root);

    return { root, pedestal, model, statusRing, ringOutline, ...labelParts, machine, critical: false };
  }

  function disposeMachineView(view) {
    scene.remove(view.root);
    view.plateElement.remove();
    view.element.remove();
    view.statusRing.material.dispose();
  }

  function setPlacement(view, placement) {
    if (!placement) return;
    view.root.position.set(placement.x * CELL_SIZE, 0, placement.z * CELL_SIZE);
    view.root.rotation.y = THREE.MathUtils.degToRad(placement.rotation || 0);
  }

  function updateMachineView(view, machine, placement) {
    view.machine = machine;
    const details = getMachineLabelDetails(machine);
    view.plateElement.textContent = getAssetPlateLabel(machine);
    view.title.textContent = details.title;
    view.asset.textContent = details.assetId;
    view.asset.classList.toggle('is-missing', details.missing);
    view.device.textContent = details.deviceId;
    view.status.textContent = details.status;
    const statusRgb = Array.isArray(machine.machineStatus?.rgb) ? machine.machineStatus.rgb : [158, 158, 158];
    view.status.style.setProperty('--machine-status-color', `rgb(${statusRgb.join(', ')})`);
    view.statusRing.material.color.copy(statusColor(machine.machineStatus));
    view.critical = CRITICAL_STATUS_CODES.has(Number(machine.machineStatus?.code));
    setPlacement(view, placement);
  }

  function rebuildMachineViews() {
    const activeIds = new Set(currentMachines.map((machine) => machine.deviceId));
    machineViews.forEach((view, deviceId) => {
      if (activeIds.has(deviceId)) return;
      if (transformControls.object === view.root) transformControls.detach();
      disposeMachineView(view);
      machineViews.delete(deviceId);
    });

    currentMachines.forEach((machine) => {
      const placement = currentLayout.machines?.[machine.deviceId];
      if (!placement) return;
      let view = machineViews.get(machine.deviceId);
      if (!view) {
        view = createMachineView(machine);
        machineViews.set(machine.deviceId, view);
      }
      updateMachineView(view, machine, placement);
    });

    updateFloor();
    updateSelection();
    requestRender();
  }

  function updateSelection() {
    machineViews.forEach((view, deviceId) => {
      view.element.classList.toggle('is-selected', deviceId === selectedDeviceId);
      view.plateElement.classList.toggle('is-selected', deviceId === selectedDeviceId);
    });
    const selectedView = machineViews.get(selectedDeviceId);
    selectionCorners.visible = Boolean(selectedView);

    if (selectedView) {
      selectionCorners.position.x = selectedView.root.position.x;
      selectionCorners.position.z = selectedView.root.position.z;
    }

    if (editing && selectedView) {
      transformControls.attach(selectedView.root);
    } else {
      transformControls.detach();
    }
    updateLabelVisibility();
  }

  function updateHover(deviceId) {
    const nextDeviceId = machineViews.has(deviceId) ? deviceId : '';
    if (hoveredDeviceId === nextDeviceId) return;
    const previous = machineViews.get(hoveredDeviceId);
    const next = machineViews.get(nextDeviceId);
    previous?.element.classList.remove('is-hovered');
    previous?.plateElement.classList.remove('is-hovered');
    next?.element.classList.add('is-hovered');
    next?.plateElement.classList.add('is-hovered');
    hoveredDeviceId = nextDeviceId;
    renderer.domElement.style.cursor = nextDeviceId ? 'pointer' : '';
    updateLabelVisibility();
    requestRender();
  }

  function updatePointer(event) {
    const rect = renderer.domElement.getBoundingClientRect();
    pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(pointer, camera);
  }

  function pickMachine(event) {
    updatePointer(event);
    const roots = [...machineViews.values()].map((view) => view.root);
    const hit = raycaster.intersectObjects(roots, true)[0];
    return hit ? findDeviceId(hit.object) : '';
  }

  function groundCell(event) {
    updatePointer(event);
    const hit = raycaster.intersectObject(interactionPlane, false)[0];
    if (!hit) return null;
    return {
      x: Math.round(hit.point.x / CELL_SIZE),
      z: Math.round(hit.point.z / CELL_SIZE)
    };
  }

  function handlePointerDown(event) {
    if (transformControls.dragging || transformControls.axis) return;
    const deviceId = pickMachine(event);
    pointerState = {
      deviceId,
      pointerId: event.pointerId,
      pointerType: event.pointerType,
      startedAt: performance.now(),
      x: event.clientX,
      y: event.clientY,
      dragging: false,
      lastDropAccepted: false,
      origin: deviceId ? { ...currentLayout.machines?.[deviceId] } : null
    };
    if (deviceId && editing) renderer.domElement.setPointerCapture?.(event.pointerId);
  }

  function handlePointerMove(event) {
    if (!pointerState?.deviceId || !editing) {
      if (event.pointerType !== 'touch') updateHover(pickMachine(event));
      return;
    }
    const threshold = pointerState.pointerType === 'touch' ? TOUCH_POINTER_THRESHOLD : POINTER_THRESHOLD;
    const distance = Math.hypot(event.clientX - pointerState.x, event.clientY - pointerState.y);
    if (!pointerState.dragging) {
      if (distance < threshold) return;
      if (
        pointerState.pointerType === 'touch' &&
        performance.now() - pointerState.startedAt < TOUCH_DRAG_DELAY_MS
      ) return;
      pointerState.dragging = true;
      controls.enabled = false;
      onSelect?.(pointerState.deviceId, { focus: false });
    }
    const cell = groundCell(event);
    if (!cell) {
      pointerState.lastDropAccepted = false;
      return;
    }
    const result = onMove?.(pointerState.deviceId, cell.x, cell.z) || { accepted: false };
    pointerState.lastDropAccepted = Boolean(result.accepted);
    dropPreview.position.x = cell.x * CELL_SIZE;
    dropPreview.position.z = cell.z * CELL_SIZE;
    dropPreview.material.color.set(result.accepted ? 0x047857 : 0x9f1239);
    dropPreview.visible = true;
    if (result.accepted) {
      if (result.layout) {
        currentLayout = result.layout;
        updateFloor();
      }
      const view = machineViews.get(pointerState.deviceId);
      if (view) setPlacement(view, result.placement);
      if (selectedDeviceId === pointerState.deviceId) {
        selectionCorners.position.x = cell.x * CELL_SIZE;
        selectionCorners.position.z = cell.z * CELL_SIZE;
      }
    }
  }

  function handlePointerUp(event) {
    const state = pointerState;
    pointerState = null;
    controls.enabled = !transformControls.dragging;
    dropPreview.visible = false;
    renderer.domElement.releasePointerCapture?.(event.pointerId);

    if (!state) return;
    if (state.dragging) {
      if ((!state.lastDropAccepted || event.type === 'pointercancel') && state.origin) {
        const result = onMove?.(state.deviceId, state.origin.x, state.origin.z);
        if (result?.layout) {
          currentLayout = result.layout;
          updateFloor();
        }
        const view = machineViews.get(state.deviceId);
        if (result?.accepted && view) setPlacement(view, result.placement);
      }
      requestRender();
      return;
    }
    const threshold = state.pointerType === 'touch' ? TOUCH_POINTER_THRESHOLD : POINTER_THRESHOLD;
    const distance = Math.hypot(event.clientX - state.x, event.clientY - state.y);
    if (event.type !== 'pointercancel' && distance < threshold && state.deviceId && !transformControls.axis) {
      onSelect?.(state.deviceId);
    }
  }

  function handlePointerLeave() {
    if (!pointerState) updateHover('');
  }

  renderer.domElement.addEventListener('pointerdown', handlePointerDown);
  renderer.domElement.addEventListener('pointermove', handlePointerMove);
  renderer.domElement.addEventListener('pointerup', handlePointerUp);
  renderer.domElement.addEventListener('pointercancel', handlePointerUp);
  renderer.domElement.addEventListener('pointerleave', handlePointerLeave);

  transformControls.addEventListener('dragging-changed', (event) => {
    controls.enabled = !event.value;
  });
  transformControls.addEventListener('objectChange', () => {
    if (!selectedDeviceId || !transformControls.object) return;
    const degrees = THREE.MathUtils.radToDeg(transformControls.object.rotation.y);
    onRotate?.(selectedDeviceId, degrees);
  });

  new GLTFLoader().load(
    modelUrl,
    (gltf) => {
      if (destroyed) {
        disposeObjectResources(gltf.scene);
        return;
      }
      modelTemplate = normalizeModel(gltf.scene);
      machineViews.forEach(disposeMachineView);
      machineViews.clear();
      rebuildMachineViews();
      onReady?.();
    },
    (event) => {
      if (destroyed) return;
      const ratio = event.total > 0 ? event.loaded / event.total : 0;
      onProgress?.(Math.max(0, Math.min(1, ratio)));
    },
    (error) => {
      if (destroyed) return;
      console.error('Unable to load digital-twin GLB:', error);
      modelFailed = true;
      modelTemplate = createFallbackModel();
      rebuildMachineViews();
      onModelError?.(error);
      onReady?.({ fallback: true });
    }
  );

  updateFloor();
  resize();

  return {
    setActive(nextActive) {
      active = Boolean(nextActive);
      resize();
      if (active) requestRender();
      if (!active && animationFrame) {
        window.cancelAnimationFrame(animationFrame);
        animationFrame = 0;
      }
    },

    setMachines(machines, layout) {
      currentMachines = Array.isArray(machines) ? machines : [];
      currentLayout = layout || { machines: {} };
      if (modelTemplate || modelFailed) rebuildMachineViews();
      else updateFloor();
    },

    setLayout(layout) {
      currentLayout = layout || { machines: {} };
      machineViews.forEach((view, deviceId) => {
        setPlacement(view, currentLayout.machines?.[deviceId]);
      });
      updateFloor();
      updateSelection();
      requestRender();
    },

    setSelected(deviceId) {
      selectedDeviceId = machineViews.has(deviceId) ? deviceId : '';
      updateSelection();
      requestRender();
    },

    setEditing(nextEditing) {
      editing = Boolean(nextEditing);
      dropPreview.visible = false;
      environment.setEditing(editing);
      updateSelection();
      requestRender();
    },

    updatePlacement(deviceId, placement) {
      const view = machineViews.get(deviceId);
      if (!view) return;
      currentLayout = {
        ...currentLayout,
        machines: { ...(currentLayout.machines || {}), [deviceId]: { ...placement } }
      };
      setPlacement(view, placement);
      if (selectedDeviceId === deviceId) {
        selectionCorners.position.x = view.root.position.x;
        selectionCorners.position.z = view.root.position.z;
      }
      requestRender();
    },

    focusMachine(deviceId, { animate = true } = {}) {
      const view = machineViews.get(deviceId);
      if (!view) return;
      const offset = camera.position.clone().sub(controls.target);
      const endTarget = new THREE.Vector3(view.root.position.x, 0.45, view.root.position.z);
      const endPosition = endTarget.clone().add(offset);
      if (!animate || reducedMotion.matches) {
        cameraTween = null;
        camera.position.copy(endPosition);
        controls.target.copy(endTarget);
        controls.update();
      } else {
        cameraTween = {
          startedAt: performance.now(),
          duration: 220,
          startPosition: camera.position.clone(),
          endPosition,
          startTarget: controls.target.clone(),
          endTarget
        };
      }
      requestRender();
    },

    resetView() {
      cameraTween = null;
      const bounds = getLayoutBounds(currentLayout, FLOOR_MINIMUM_RADIUS);
      const centerX = ((bounds.minX + bounds.maxX) / 2) * CELL_SIZE;
      const centerZ = ((bounds.minZ + bounds.maxZ) / 2) * CELL_SIZE;
      const verticalFov = THREE.MathUtils.degToRad(camera.fov);
      const horizontalFov = 2 * Math.atan(Math.tan(verticalFov / 2) * Math.max(camera.aspect, 0.1));
      const viewDirection = new THREE.Vector3(0.64, 0.82, 0.64).normalize();
      const right = new THREE.Vector3().crossVectors(viewDirection, camera.up).normalize();
      const viewUp = new THREE.Vector3().crossVectors(right, viewDirection).normalize();
      const floorMinX = (bounds.minX - 1.5) * CELL_SIZE;
      const floorMaxX = (bounds.maxX + 1.5) * CELL_SIZE;
      const floorMinZ = (bounds.minZ - 1.5) * CELL_SIZE;
      const floorMaxZ = (bounds.maxZ + 1.5) * CELL_SIZE;
      let distance = 0;
      [0, 2.6].forEach((height) => {
        [floorMinX, floorMaxX].forEach((x) => {
          [floorMinZ, floorMaxZ].forEach((z) => {
            const corner = new THREE.Vector3(x - centerX, height, z - centerZ);
            const depthOffset = corner.dot(viewDirection);
            distance = Math.max(
              distance,
              depthOffset + Math.abs(corner.dot(right)) / Math.tan(horizontalFov / 2),
              depthOffset + Math.abs(corner.dot(viewUp)) / Math.tan(verticalFov / 2)
            );
          });
        });
      });
      distance *= 0.9;
      controls.target.set(centerX, 0, centerZ);
      camera.position.copy(controls.target).addScaledVector(viewDirection, distance);
      camera.near = 0.1;
      camera.far = Math.max(1200, distance * 10);
      camera.updateProjectionMatrix();
      controls.update();
      requestRender();
    },

    destroy() {
      destroyed = true;
      active = false;
      if (animationFrame) window.cancelAnimationFrame(animationFrame);
      resizeObserver.disconnect();
      controls.dispose();
      transformControls.dispose();
      machineViews.forEach(disposeMachineView);
      machineViews.clear();
      if (modelTemplate) disposeObjectResources(modelTemplate);
      environment.destroy();
      pedestalGeometry.dispose();
      pedestalMaterials.forEach((material) => material.dispose());
      statusRingGeometry.dispose();
      ringOutlineGeometry.dispose();
      ringOutlineMaterial.dispose();
      interactionPlane.geometry.dispose();
      interactionPlane.material.dispose();
      selectionCorners.geometry.dispose();
      selectionCorners.material.dispose();
      dropPreview.geometry.dispose();
      dropPreview.material.dispose();
      renderer.dispose();
      renderer.domElement.removeEventListener('pointerdown', handlePointerDown);
      renderer.domElement.removeEventListener('pointermove', handlePointerMove);
      renderer.domElement.removeEventListener('pointerup', handlePointerUp);
      renderer.domElement.removeEventListener('pointercancel', handlePointerUp);
      renderer.domElement.removeEventListener('pointerleave', handlePointerLeave);
      renderer.domElement.remove();
      labelRenderer.domElement.remove();
    }
  };
}
