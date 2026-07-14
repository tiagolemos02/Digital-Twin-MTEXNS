import crypto from "crypto";
import { promises as fs } from "fs";
import path from "path";

const DATABASE_VERSION = 1;
const LAYOUT_VERSION = 2;
const MAX_MACHINES_PER_LAYOUT = 500;
const MAX_GRID_COORDINATE = 10_000;
const FACTORY_MINIMUM = Object.freeze({ minX: -3, maxX: 3, minZ: -3, maxZ: 3 });
const FACTORY_EXPANSION_STEP = 2;

export class LayoutValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = "LayoutValidationError";
  }
}

export class LayoutConflictError extends Error {
  constructor(currentLayout) {
    super("The layout was updated in another session.");
    this.name = "LayoutConflictError";
    this.currentLayout = currentLayout;
  }
}

function normalizeCoordinate(value, field) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || Math.abs(parsed) > MAX_GRID_COORDINATE) {
    throw new LayoutValidationError(`${field} must be an integer between -${MAX_GRID_COORDINATE} and ${MAX_GRID_COORDINATE}.`);
  }
  return parsed;
}

function normalizeRotation(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new LayoutValidationError("rotation must be a finite number.");
  }
  const normalized = ((parsed % 360) + 360) % 360;
  return Math.round(normalized * 1000) / 1000;
}

export function normalizeLayout(candidate = {}) {
  const rawMachines = candidate?.machines;
  if (!rawMachines || typeof rawMachines !== "object" || Array.isArray(rawMachines)) {
    throw new LayoutValidationError("machines must be an object keyed by Device ID.");
  }

  const entries = Object.entries(rawMachines);
  if (entries.length > MAX_MACHINES_PER_LAYOUT) {
    throw new LayoutValidationError(`A layout may contain at most ${MAX_MACHINES_PER_LAYOUT} machines.`);
  }

  const normalizedEntries = [];
  const occupiedCells = new Map();
  for (const [rawDeviceId, placement] of entries) {
    const deviceId = String(rawDeviceId || "").trim();
    if (!deviceId || deviceId.length > 255) {
      throw new LayoutValidationError("Each machine must have a Device ID between 1 and 255 characters.");
    }
    if (!placement || typeof placement !== "object" || Array.isArray(placement)) {
      throw new LayoutValidationError(`Placement for ${deviceId} must be an object.`);
    }
    const x = normalizeCoordinate(placement.x, `${deviceId}.x`);
    const z = normalizeCoordinate(placement.z, `${deviceId}.z`);
    const cell = `${x}:${z}`;
    if (occupiedCells.has(cell)) {
      throw new LayoutValidationError(
        `${deviceId} cannot use the grid cell already occupied by ${occupiedCells.get(cell)}.`
      );
    }
    occupiedCells.set(cell, deviceId);
    normalizedEntries.push([deviceId, {
      x,
      z,
      rotation: normalizeRotation(placement.rotation ?? 0)
    }]);
  }

  const machines = Object.fromEntries(normalizedEntries);
  const rawFactory = candidate?.factory;
  const factory = rawFactory == null
    ? { ...FACTORY_MINIMUM }
    : {
        minX: normalizeCoordinate(rawFactory.minX, "factory.minX"),
        maxX: normalizeCoordinate(rawFactory.maxX, "factory.maxX"),
        minZ: normalizeCoordinate(rawFactory.minZ, "factory.minZ"),
        maxZ: normalizeCoordinate(rawFactory.maxZ, "factory.maxZ")
      };

  if (factory.minX > factory.maxX || factory.minZ > factory.maxZ) {
    throw new LayoutValidationError("factory minimum bounds must not exceed maximum bounds.");
  }
  factory.minX = Math.min(factory.minX, FACTORY_MINIMUM.minX);
  factory.maxX = Math.max(factory.maxX, FACTORY_MINIMUM.maxX);
  factory.minZ = Math.min(factory.minZ, FACTORY_MINIMUM.minZ);
  factory.maxZ = Math.max(factory.maxZ, FACTORY_MINIMUM.maxZ);

  Object.values(machines).forEach((placement) => {
    while (placement.x < factory.minX) factory.minX -= FACTORY_EXPANSION_STEP;
    while (placement.x > factory.maxX) factory.maxX += FACTORY_EXPANSION_STEP;
    while (placement.z < factory.minZ) factory.minZ -= FACTORY_EXPANSION_STEP;
    while (placement.z > factory.maxZ) factory.maxZ += FACTORY_EXPANSION_STEP;
  });

  return { version: LAYOUT_VERSION, factory, machines };
}

function emptyDatabase() {
  return { version: DATABASE_VERSION, users: {} };
}

function emptyLayout() {
  return {
    version: LAYOUT_VERSION,
    revision: 0,
    updatedAt: null,
    factory: { ...FACTORY_MINIMUM },
    machines: {}
  };
}

function userStorageKey(userId) {
  return crypto.createHash("sha256").update(String(userId)).digest("hex");
}

async function readDatabase(filePath) {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    const parsed = JSON.parse(raw);
    if (parsed?.version !== DATABASE_VERSION || !parsed?.users || typeof parsed.users !== "object") {
      throw new Error("Unsupported digital-twin layout store format.");
    }
    return parsed;
  } catch (error) {
    if (error?.code === "ENOENT") return emptyDatabase();
    throw error;
  }
}

async function writeDatabase(filePath, database) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(temporaryPath, `${JSON.stringify(database, null, 2)}\n`, "utf8");
  await fs.rename(temporaryPath, filePath);
}

export function createLayoutStore({ filePath }) {
  if (!filePath) throw new Error("A layout store file path is required.");
  let writeQueue = Promise.resolve();

  const enqueueWrite = (operation) => {
    const pending = writeQueue.then(operation);
    writeQueue = pending.catch(() => undefined);
    return pending;
  };

  return {
    async getForUser(userId) {
      if (!userId) throw new Error("An authenticated user ID is required.");
      const database = await readDatabase(filePath);
      return database.users[userStorageKey(userId)] || emptyLayout();
    },

    replaceForUser(userId, candidate, baseRevision) {
      if (!userId) return Promise.reject(new Error("An authenticated user ID is required."));

      return enqueueWrite(async () => {
        const normalized = normalizeLayout(candidate);
        const database = await readDatabase(filePath);
        const key = userStorageKey(userId);
        const current = database.users[key] || emptyLayout();
        const expectedRevision = Number(baseRevision);

        if (!Number.isInteger(expectedRevision) || expectedRevision !== current.revision) {
          throw new LayoutConflictError(current);
        }

        const next = {
          ...normalized,
          revision: current.revision + 1,
          updatedAt: new Date().toISOString()
        };
        database.users[key] = next;
        await writeDatabase(filePath, database);
        return next;
      });
    },

    removeMachineEverywhere(deviceId) {
      const normalizedDeviceId = String(deviceId || "").trim();
      if (!normalizedDeviceId) return Promise.reject(new LayoutValidationError("Device ID is required."));

      return enqueueWrite(async () => {
        const database = await readDatabase(filePath);
        let affectedLayouts = 0;

        Object.values(database.users).forEach((layout) => {
          if (!layout?.machines || !Object.prototype.hasOwnProperty.call(layout.machines, normalizedDeviceId)) return;
          delete layout.machines[normalizedDeviceId];
          layout.revision = (Number(layout.revision) || 0) + 1;
          layout.updatedAt = new Date().toISOString();
          affectedLayouts += 1;
        });

        if (affectedLayouts > 0) await writeDatabase(filePath, database);
        return { affectedLayouts };
      });
    }
  };
}
