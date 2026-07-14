import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  createLayoutStore,
  LayoutConflictError,
  LayoutValidationError,
  normalizeLayout
} from "./layout-store.js";

test("normalizes rotation and preserves integer grid coordinates", () => {
  assert.deepEqual(normalizeLayout({
    machines: { press: { x: -2, z: 4, rotation: 725.1254 } }
  }), {
    version: 2,
    factory: { minX: -3, maxX: 3, minZ: -3, maxZ: 5 },
    machines: { press: { x: -2, z: 4, rotation: 5.125 } }
  });
});

test("migrates layouts without factory bounds and expands in two-cell modules", () => {
  const normalized = normalizeLayout({
    version: 1,
    machines: { press: { x: 6, z: -4, rotation: 0 } }
  });
  assert.equal(normalized.version, 2);
  assert.deepEqual(normalized.factory, { minX: -3, maxX: 7, minZ: -5, maxZ: 3 });
});

test("rejects inverted factory bounds", () => {
  assert.throws(
    () => normalizeLayout({ factory: { minX: 4, maxX: 2, minZ: -3, maxZ: 3 }, machines: {} }),
    LayoutValidationError
  );
});

test("rejects invalid coordinates and occupied cells", () => {
  assert.throws(
    () => normalizeLayout({ machines: { press: { x: 1.5, z: 0, rotation: 0 } } }),
    LayoutValidationError
  );
  assert.throws(
    () => normalizeLayout({
      machines: {
        press: { x: 0, z: 0, rotation: 0 },
        lathe: { x: 0, z: 0, rotation: 90 }
      }
    }),
    /already occupied/
  );
});

test("persists layouts per user and detects stale revisions", async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "dt-layout-store-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const store = createLayoutStore({ filePath: path.join(directory, "layouts.json") });

  const first = await store.replaceForUser("user-a", {
    machines: { press: { x: 0, z: 0, rotation: 45 } }
  }, 0);
  assert.equal(first.revision, 1);
  assert.deepEqual((await store.getForUser("user-a")).machines, first.machines);
  assert.deepEqual((await store.getForUser("user-b")).machines, {});

  await assert.rejects(
    store.replaceForUser("user-a", { machines: {} }, 0),
    LayoutConflictError
  );
});

test("removes a deprovisioned machine from every personal layout", async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "dt-layout-cleanup-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const store = createLayoutStore({ filePath: path.join(directory, "layouts.json") });
  const layout = { machines: { shared: { x: 0, z: 0, rotation: 0 } } };

  await store.replaceForUser("user-a", layout, 0);
  await store.replaceForUser("user-b", layout, 0);
  const result = await store.removeMachineEverywhere("shared");

  assert.equal(result.affectedLayouts, 2);
  assert.deepEqual((await store.getForUser("user-a")).machines, {});
  assert.deepEqual((await store.getForUser("user-b")).machines, {});
});
