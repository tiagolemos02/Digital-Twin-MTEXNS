const MAX_SEARCH_RADIUS = 10_000;
export const LAYOUT_VERSION = 2;
export const FACTORY_MINIMUM = Object.freeze({ minX: -3, maxX: 3, minZ: -3, maxZ: 3 });
const FACTORY_EXPANSION_STEP = 2;

export function normalizeRotation(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 0;
  return Math.round((((parsed % 360) + 360) % 360) * 1000) / 1000;
}

export function normalizePlacement(placement = {}) {
  const x = Number(placement.x);
  const z = Number(placement.z);
  return {
    x: Number.isInteger(x) ? x : 0,
    z: Number.isInteger(z) ? z : 0,
    rotation: normalizeRotation(placement.rotation)
  };
}

function normalizedBound(value, fallback) {
  const parsed = Number(value);
  return Number.isInteger(parsed) ? parsed : fallback;
}

export function expandFactoryToFit(factory = {}, placements = {}) {
  const next = {
    minX: Math.min(normalizedBound(factory.minX, FACTORY_MINIMUM.minX), FACTORY_MINIMUM.minX),
    maxX: Math.max(normalizedBound(factory.maxX, FACTORY_MINIMUM.maxX), FACTORY_MINIMUM.maxX),
    minZ: Math.min(normalizedBound(factory.minZ, FACTORY_MINIMUM.minZ), FACTORY_MINIMUM.minZ),
    maxZ: Math.max(normalizedBound(factory.maxZ, FACTORY_MINIMUM.maxZ), FACTORY_MINIMUM.maxZ)
  };

  Object.values(placements || {}).forEach((placement) => {
    const normalized = normalizePlacement(placement);
    while (normalized.x < next.minX) next.minX -= FACTORY_EXPANSION_STEP;
    while (normalized.x > next.maxX) next.maxX += FACTORY_EXPANSION_STEP;
    while (normalized.z < next.minZ) next.minZ -= FACTORY_EXPANSION_STEP;
    while (normalized.z > next.maxZ) next.maxZ += FACTORY_EXPANSION_STEP;
  });
  return next;
}

export function cloneLayout(layout = {}) {
  const machines = {};
  Object.entries(layout.machines || {}).forEach(([deviceId, placement]) => {
    machines[deviceId] = normalizePlacement(placement);
  });
  return {
    version: LAYOUT_VERSION,
    revision: Number.isInteger(layout.revision) ? layout.revision : 0,
    updatedAt: layout.updatedAt || null,
    factory: expandFactoryToFit(layout.factory, machines),
    machines
  };
}

function cellKey(x, z) {
  return `${x}:${z}`;
}

function occupiedCells(placements, ignoredDeviceId = '') {
  const occupied = new Set();
  Object.entries(placements || {}).forEach(([deviceId, placement]) => {
    if (deviceId === ignoredDeviceId) return;
    occupied.add(cellKey(placement.x, placement.z));
  });
  return occupied;
}

export function isCellOccupied(placements, x, z, ignoredDeviceId = '') {
  return occupiedCells(placements, ignoredDeviceId).has(cellKey(x, z));
}

export function findFirstFreePlacement(placements = {}) {
  const occupied = occupiedCells(placements);

  for (let radius = 0; radius <= MAX_SEARCH_RADIUS; radius += 1) {
    for (let z = -radius; z <= radius; z += 1) {
      for (let x = -radius; x <= radius; x += 1) {
        if (Math.max(Math.abs(x), Math.abs(z)) !== radius) continue;
        if (!occupied.has(cellKey(x, z))) {
          return { x: x === 0 ? 0 : x, z: z === 0 ? 0 : z, rotation: 0 };
        }
      }
    }
  }

  throw new Error('Unable to find a free grid cell.');
}

export function reconcileLayout(layout, machines = []) {
  const current = cloneLayout(layout);
  const activeIds = [...new Set(
    machines.map((machine) => String(machine?.deviceId || '').trim()).filter(Boolean)
  )].sort((a, b) => a.localeCompare(b));
  const activeSet = new Set(activeIds);
  const nextMachines = {};
  const usedCells = new Set();
  const removed = [];
  const added = [];

  Object.entries(current.machines).forEach(([deviceId, rawPlacement]) => {
    if (!activeSet.has(deviceId)) {
      removed.push(deviceId);
      return;
    }
    const placement = normalizePlacement(rawPlacement);
    const key = cellKey(placement.x, placement.z);
    if (usedCells.has(key)) return;
    usedCells.add(key);
    nextMachines[deviceId] = placement;
  });

  activeIds.forEach((deviceId) => {
    if (nextMachines[deviceId]) return;
    const placement = findFirstFreePlacement(nextMachines);
    nextMachines[deviceId] = placement;
    added.push(deviceId);
  });

  const changed = removed.length > 0 || added.length > 0 ||
    Object.keys(current.machines).length !== Object.keys(nextMachines).length;

  return {
    layout: { ...current, factory: expandFactoryToFit(current.factory, nextMachines), machines: nextMachines },
    changed,
    added,
    removed
  };
}

export function moveMachine(layout, deviceId, x, z) {
  const next = cloneLayout(layout);
  const targetX = Number(x);
  const targetZ = Number(z);
  if (!Number.isInteger(targetX) || !Number.isInteger(targetZ)) {
    return { layout: next, moved: false, reason: 'invalid' };
  }
  if (!next.machines[deviceId]) {
    return { layout: next, moved: false, reason: 'missing' };
  }
  if (isCellOccupied(next.machines, targetX, targetZ, deviceId)) {
    return { layout: next, moved: false, reason: 'occupied' };
  }
  next.machines[deviceId] = { ...next.machines[deviceId], x: targetX, z: targetZ };
  next.factory = expandFactoryToFit(next.factory, next.machines);
  return { layout: next, moved: true, reason: null };
}

export function rotateMachine(layout, deviceId, rotation) {
  const next = cloneLayout(layout);
  if (!next.machines[deviceId]) return { layout: next, rotated: false };
  next.machines[deviceId] = {
    ...next.machines[deviceId],
    rotation: normalizeRotation(rotation)
  };
  return { layout: next, rotated: true };
}

export function getLayoutBounds(layout, minimumRadius = 3) {
  const fallback = {
    minX: -Math.max(minimumRadius, 3),
    maxX: Math.max(minimumRadius, 3),
    minZ: -Math.max(minimumRadius, 3),
    maxZ: Math.max(minimumRadius, 3)
  };
  return expandFactoryToFit(layout?.factory || fallback, layout?.machines);
}
