import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import { CSS2DObject, CSS2DRenderer } from 'three/addons/renderers/CSS2DRenderer.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { getLayoutBounds, getMachineDisplayLabel } from './digital-twin-layout.js';

const CELL_SIZE = 4.8;
const MODEL_FOOTPRINT = 2.75;
const MODEL_HEIGHT = 3.1;
const FLOOR_MINIMUM_RADIUS = 3;

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
  scene.background = new THREE.Color(0xf7f7f7);

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
  controls.maxDistance = 110;
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

  const floorMaterial = new THREE.MeshStandardMaterial({ color: 0xefefef, roughness: 0.94, metalness: 0 });
  let floor = null;
  let grid = null;
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

  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  const machineViews = new Map();
  let modelTemplate = null;
  let modelFailed = false;
  let currentMachines = [];
  let currentLayout = { machines: {} };
  let selectedDeviceId = '';
  let editing = false;
  let active = false;
  let animationFrame = 0;
  let pointerDown = null;
  let dragState = null;
  let destroyed = false;

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

  function renderFrame() {
    animationFrame = 0;
    if (!active) return;
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
    const radius = Math.max(
      FLOOR_MINIMUM_RADIUS,
      Math.abs(bounds.minX),
      Math.abs(bounds.maxX),
      Math.abs(bounds.minZ),
      Math.abs(bounds.maxZ)
    ) + 1;
    const cells = radius * 2;
    const size = cells * CELL_SIZE;

    if (floor) {
      scene.remove(floor);
      floor.geometry.dispose();
    }
    if (grid) {
      scene.remove(grid);
      grid.geometry.dispose();
      grid.material.dispose();
    }

    floor = new THREE.Mesh(new THREE.PlaneGeometry(size, size), floorMaterial);
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -0.025;
    floor.receiveShadow = true;
    scene.add(floor);

    grid = new THREE.GridHelper(size, cells, 0xbfc2c8, 0xd7d8dc);
    grid.position.y = 0.005;
    grid.material.transparent = true;
    grid.material.opacity = 0.88;
    scene.add(grid);
  }

  function createLabel(machine) {
    const element = document.createElement('div');
    element.className = 'twin-machine-label';
    const title = document.createElement('strong');
    title.textContent = getMachineDisplayLabel(machine);
    const status = document.createElement('span');
    status.textContent = machine.machineStatus?.name || 'Unknown';
    element.append(title, status);
    const label = new CSS2DObject(element);
    label.position.set(0, MODEL_HEIGHT + 0.35, 0);
    return { label, element, title, status };
  }

  function createMachineView(machine) {
    const root = new THREE.Group();
    root.userData.deviceId = machine.deviceId;

    const statusRing = new THREE.Mesh(
      new THREE.RingGeometry(1.55, 1.78, 64),
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
      new THREE.RingGeometry(1.78, 1.84, 64),
      new THREE.MeshBasicMaterial({ color: 0x515750, side: THREE.DoubleSide, transparent: true, opacity: 0.65 })
    );
    ringOutline.rotation.x = -Math.PI / 2;
    ringOutline.position.y = 0.034;
    root.add(ringOutline);

    const model = (modelTemplate || createFallbackModel()).clone(true);
    model.userData.deviceId = machine.deviceId;
    model.traverse((child) => {
      if (child.isMesh) child.userData.deviceId = machine.deviceId;
    });
    root.add(model);

    const labelParts = createLabel(machine);
    root.add(labelParts.label);
    scene.add(root);

    return { root, model, statusRing, ringOutline, ...labelParts, machine };
  }

  function disposeMachineView(view) {
    scene.remove(view.root);
    view.element.remove();
    view.statusRing.geometry.dispose();
    view.statusRing.material.dispose();
    view.ringOutline.geometry.dispose();
    view.ringOutline.material.dispose();
  }

  function setPlacement(view, placement) {
    if (!placement) return;
    view.root.position.set(placement.x * CELL_SIZE, 0, placement.z * CELL_SIZE);
    view.root.rotation.y = THREE.MathUtils.degToRad(placement.rotation || 0);
  }

  function updateMachineView(view, machine, placement) {
    view.machine = machine;
    view.title.textContent = getMachineDisplayLabel(machine);
    view.status.textContent = machine.machineStatus?.name || 'Unknown';
    view.statusRing.material.color.copy(statusColor(machine.machineStatus));
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
    pointerDown = { x: event.clientX, y: event.clientY };
    if (transformControls.dragging || transformControls.axis) return;
    const deviceId = pickMachine(event);
    if (!deviceId) return;

    onSelect?.(deviceId);
    if (!editing) return;
    dragState = { deviceId };
    controls.enabled = false;
    renderer.domElement.setPointerCapture?.(event.pointerId);
  }

  function handlePointerMove(event) {
    if (!dragState) return;
    const cell = groundCell(event);
    if (!cell) return;
    const result = onMove?.(dragState.deviceId, cell.x, cell.z) || { accepted: false };
    dropPreview.position.x = cell.x * CELL_SIZE;
    dropPreview.position.z = cell.z * CELL_SIZE;
    dropPreview.material.color.set(result.accepted ? 0x047857 : 0x9f1239);
    dropPreview.visible = true;
    if (result.accepted) {
      const view = machineViews.get(dragState.deviceId);
      if (view) setPlacement(view, result.placement);
      if (selectedDeviceId === dragState.deviceId) {
        selectionCorners.position.x = cell.x * CELL_SIZE;
        selectionCorners.position.z = cell.z * CELL_SIZE;
      }
    }
  }

  function handlePointerUp(event) {
    const wasDragging = Boolean(dragState);
    dragState = null;
    controls.enabled = !transformControls.dragging;
    dropPreview.visible = false;
    renderer.domElement.releasePointerCapture?.(event.pointerId);

    if (!wasDragging && pointerDown) {
      const distance = Math.hypot(event.clientX - pointerDown.x, event.clientY - pointerDown.y);
      if (distance < 5 && !transformControls.axis) onSelect?.(pickMachine(event));
    }
    pointerDown = null;
  }

  renderer.domElement.addEventListener('pointerdown', handlePointerDown);
  renderer.domElement.addEventListener('pointermove', handlePointerMove);
  renderer.domElement.addEventListener('pointerup', handlePointerUp);
  renderer.domElement.addEventListener('pointercancel', handlePointerUp);

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

    setSelected(deviceId) {
      selectedDeviceId = machineViews.has(deviceId) ? deviceId : '';
      updateSelection();
      requestRender();
    },

    setEditing(nextEditing) {
      editing = Boolean(nextEditing);
      dropPreview.visible = false;
      updateSelection();
      requestRender();
    },

    updatePlacement(deviceId, placement) {
      const view = machineViews.get(deviceId);
      if (!view) return;
      setPlacement(view, placement);
      if (selectedDeviceId === deviceId) {
        selectionCorners.position.x = view.root.position.x;
        selectionCorners.position.z = view.root.position.z;
      }
      requestRender();
    },

    resetView() {
      const bounds = getLayoutBounds(currentLayout, FLOOR_MINIMUM_RADIUS);
      const centerX = ((bounds.minX + bounds.maxX) / 2) * CELL_SIZE;
      const centerZ = ((bounds.minZ + bounds.maxZ) / 2) * CELL_SIZE;
      const span = Math.max(bounds.maxX - bounds.minX, bounds.maxZ - bounds.minZ, 6) * CELL_SIZE;
      controls.target.set(centerX, 0, centerZ);
      camera.position.set(centerX + span * 0.55, span * 0.68, centerZ + span * 0.55);
      camera.near = 0.1;
      camera.far = Math.max(1200, span * 10);
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
      if (floor) floor.geometry.dispose();
      floorMaterial.dispose();
      if (grid) {
        grid.geometry.dispose();
        grid.material.dispose();
      }
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
      renderer.domElement.remove();
      labelRenderer.domElement.remove();
    }
  };
}
