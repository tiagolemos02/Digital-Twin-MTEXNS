import * as THREE from 'three';

const FACTORY_COLORS = Object.freeze({
  floor: 0xe6e7e9,
  floorInset: 0xf3f3f4,
  seam: 0xbfc2c8,
  structure: 0x5b6066,
  structureDark: 0x34373b,
  cabinet: 0x747b80,
  safety: 0xc7a331,
  pallet: 0x8a6248,
  pipe: 0x2f6f6d,
  brand: 0xe30517
});

function box(width, height, depth, material, x, y, z) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), material);
  mesh.position.set(x, y, z);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

function addInstances(group, geometry, material, transforms) {
  if (!transforms.length) return null;
  const instances = new THREE.InstancedMesh(geometry, material, transforms.length);
  const helper = new THREE.Object3D();
  transforms.forEach((transform, index) => {
    helper.position.set(transform.x, transform.y, transform.z);
    helper.rotation.set(transform.rx || 0, transform.ry || 0, transform.rz || 0);
    helper.scale.set(transform.sx || 1, transform.sy || 1, transform.sz || 1);
    helper.updateMatrix();
    instances.setMatrixAt(index, helper.matrix);
  });
  instances.castShadow = true;
  instances.receiveShadow = true;
  group.add(instances);
  return instances;
}

function disposeGroup(group) {
  const geometries = new Set();
  group.traverse((child) => {
    if (child.geometry) geometries.add(child.geometry);
  });
  geometries.forEach((geometry) => geometry.dispose());
  group.clear();
}

export function createFactoryEnvironment(scene, { cellSize }) {
  const group = new THREE.Group();
  group.name = 'factory-environment';
  scene.add(group);

  const materials = {
    floor: new THREE.MeshStandardMaterial({ color: FACTORY_COLORS.floor, roughness: 0.95, metalness: 0 }),
    floorInset: new THREE.MeshStandardMaterial({ color: FACTORY_COLORS.floorInset, roughness: 0.92 }),
    seam: new THREE.LineBasicMaterial({ color: FACTORY_COLORS.seam, transparent: true, opacity: 0.14 }),
    structure: new THREE.MeshStandardMaterial({ color: FACTORY_COLORS.structure, roughness: 0.68, metalness: 0.18 }),
    structureDark: new THREE.MeshStandardMaterial({ color: FACTORY_COLORS.structureDark, roughness: 0.64, metalness: 0.22 }),
    cabinet: new THREE.MeshStandardMaterial({ color: FACTORY_COLORS.cabinet, roughness: 0.62, metalness: 0.25 }),
    safety: new THREE.MeshBasicMaterial({ color: FACTORY_COLORS.safety, transparent: true, opacity: 0.5, depthWrite: false }),
    pallet: new THREE.MeshStandardMaterial({ color: FACTORY_COLORS.pallet, roughness: 0.84 }),
    pipe: new THREE.MeshStandardMaterial({ color: FACTORY_COLORS.pipe, roughness: 0.55, metalness: 0.28 }),
    brand: new THREE.MeshBasicMaterial({ color: FACTORY_COLORS.brand })
  };

  let gridLines = null;
  let boundsKey = '';
  let editing = false;

  function rebuild(bounds) {
    disposeGroup(group);
    const minX = bounds.minX * cellSize;
    const maxX = bounds.maxX * cellSize;
    const minZ = bounds.minZ * cellSize;
    const maxZ = bounds.maxZ * cellSize;
    const usableWidth = (bounds.maxX - bounds.minX + 1) * cellSize;
    const usableDepth = (bounds.maxZ - bounds.minZ + 1) * cellSize;
    const floorWidth = usableWidth + cellSize * 2;
    const floorDepth = usableDepth + cellSize * 2;
    const centerX = (minX + maxX) / 2;
    const centerZ = (minZ + maxZ) / 2;
    const west = centerX - floorWidth / 2;
    const east = centerX + floorWidth / 2;
    const north = centerZ - floorDepth / 2;
    const south = centerZ + floorDepth / 2;

    const slab = new THREE.Mesh(new THREE.BoxGeometry(floorWidth, 0.22, floorDepth), materials.floor);
    slab.position.set(centerX, -0.14, centerZ);
    slab.receiveShadow = true;
    group.add(slab);

    const inset = new THREE.Mesh(new THREE.PlaneGeometry(usableWidth, usableDepth), materials.floorInset);
    inset.rotation.x = -Math.PI / 2;
    inset.position.set(centerX, 0.002, centerZ);
    inset.receiveShadow = true;
    group.add(inset);

    const gridPoints = [];
    for (let x = bounds.minX; x <= bounds.maxX + 1; x += 1) {
      const worldX = (x - 0.5) * cellSize;
      gridPoints.push(new THREE.Vector3(worldX, 0.012, (bounds.minZ - 0.5) * cellSize));
      gridPoints.push(new THREE.Vector3(worldX, 0.012, (bounds.maxZ + 0.5) * cellSize));
    }
    for (let z = bounds.minZ; z <= bounds.maxZ + 1; z += 1) {
      const worldZ = (z - 0.5) * cellSize;
      gridPoints.push(new THREE.Vector3((bounds.minX - 0.5) * cellSize, 0.012, worldZ));
      gridPoints.push(new THREE.Vector3((bounds.maxX + 0.5) * cellSize, 0.012, worldZ));
    }
    gridLines = new THREE.LineSegments(
      new THREE.BufferGeometry().setFromPoints(gridPoints),
      materials.seam
    );
    gridLines.visible = editing;
    group.add(gridLines);

    const aisleThickness = 0.11;
    const aisleWidth = cellSize * 0.12;
    const aisleOffsetX = usableWidth / 2 + cellSize * 0.25;
    const aisleOffsetZ = usableDepth / 2 + cellSize * 0.25;
    group.add(
      box(usableWidth + cellSize * 0.5, aisleThickness, aisleWidth, materials.safety, centerX, 0.035, centerZ - aisleOffsetZ),
      box(usableWidth + cellSize * 0.5, aisleThickness, aisleWidth, materials.safety, centerX, 0.035, centerZ + aisleOffsetZ),
      box(aisleWidth, aisleThickness, usableDepth, materials.safety, centerX - aisleOffsetX, 0.035, centerZ),
      box(aisleWidth, aisleThickness, usableDepth, materials.safety, centerX + aisleOffsetX, 0.035, centerZ)
    );

    const wallHeight = 1.25;
    group.add(
      box(floorWidth, wallHeight, 0.22, materials.structure, centerX, wallHeight / 2, north + 0.12),
      box(0.22, wallHeight, floorDepth * 0.62, materials.structure, west + 0.12, wallHeight / 2, north + floorDepth * 0.31)
    );

    const posts = [];
    const postStep = cellSize * 1.5;
    for (let z = north + 0.4; z <= south - 0.4; z += postStep) {
      posts.push({ x: east - 0.16, y: 0.85, z });
    }
    for (let x = west + 0.45; x <= east - 0.45; x += Math.max(postStep, floorWidth / 5)) {
      posts.push({ x, y: 1.25, z: north + 0.34, sy: 1.45 });
    }
    addInstances(group, new THREE.BoxGeometry(0.18, 1.7, 0.18), materials.structureDark, posts);

    const fenceRails = [];
    for (let z = north + postStep / 2; z < south - postStep / 2; z += postStep) {
      fenceRails.push({ x: east - 0.16, y: 0.75, z, sz: postStep / 0.18 });
      fenceRails.push({ x: east - 0.16, y: 1.35, z, sz: postStep / 0.18 });
    }
    addInstances(group, new THREE.BoxGeometry(0.1, 0.1, 0.18), materials.structure, fenceRails);

    const cabinets = [-1, 0, 1].map((offset) => ({
      x: centerX + offset * 1.7,
      y: 0.8,
      z: north + cellSize * 0.48
    }));
    addInstances(group, new THREE.BoxGeometry(1.15, 1.6, 0.62), materials.cabinet, cabinets);

    const palletTransforms = [];
    [-1, 1].forEach((row) => {
      [-0.55, 0.55].forEach((offset) => {
        palletTransforms.push({ x: west + cellSize * 0.48, y: 0.16, z: centerZ + row * cellSize + offset });
      });
    });
    addInstances(group, new THREE.BoxGeometry(1.4, 0.25, 1.05), materials.pallet, palletTransforms);
    addInstances(
      group,
      new THREE.BoxGeometry(0.72, 0.72, 0.72),
      materials.structure,
      palletTransforms.map((item, index) => ({ ...item, y: 0.64, ry: index % 2 ? 0.18 : -0.12 }))
    );

    const pipeGeometry = new THREE.CylinderGeometry(0.11, 0.11, Math.max(2, usableWidth * 0.72), 12);
    const pipe = new THREE.Mesh(pipeGeometry, materials.pipe);
    pipe.rotation.z = Math.PI / 2;
    pipe.position.set(centerX, 1.55, north + 0.28);
    pipe.castShadow = true;
    group.add(pipe);

    const gateWidth = Math.min(cellSize * 1.6, usableWidth * 0.35);
    group.add(
      box((floorWidth - gateWidth) / 2, 0.56, 0.24, materials.structureDark, west + (floorWidth - gateWidth) / 4, 0.28, south - 0.12),
      box((floorWidth - gateWidth) / 2, 0.56, 0.24, materials.structureDark, east - (floorWidth - gateWidth) / 4, 0.28, south - 0.12)
    );

    const barriers = [-1, 1].map((side) => ({
      x: centerX + side * (gateWidth / 2 + 0.45),
      y: 0.34,
      z: south - cellSize * 0.42,
      ry: Math.PI / 2
    }));
    addInstances(group, new THREE.BoxGeometry(0.22, 0.68, 1.5), materials.safety, barriers);

    const sign = box(1.65, 0.62, 0.08, materials.brand, centerX, 2.05, north + 0.18);
    group.add(sign);
  }

  return {
    update(bounds) {
      const nextKey = [bounds.minX, bounds.maxX, bounds.minZ, bounds.maxZ].join(':');
      if (nextKey === boundsKey) return;
      boundsKey = nextKey;
      rebuild(bounds);
    },
    setEditing(nextEditing) {
      editing = Boolean(nextEditing);
      if (gridLines) gridLines.visible = editing;
    },
    destroy() {
      scene.remove(group);
      disposeGroup(group);
      Object.values(materials).forEach((material) => material.dispose());
    }
  };
}
