import assert from 'node:assert/strict';
import test from 'node:test';
import {
  cloneLayout,
  expandFactoryToFit,
  findFirstFreePlacement,
  getLayoutBounds,
  moveMachine,
  normalizeRotation,
  reconcileLayout,
  rotateMachine
} from './digital-twin-layout.js';

test('places the first machine at the origin and expands deterministically', () => {
  assert.deepEqual(findFirstFreePlacement({}), { x: 0, z: 0, rotation: 0 });
  assert.deepEqual(findFirstFreePlacement({ a: { x: 0, z: 0 } }), { x: -1, z: -1, rotation: 0 });
});

test('reconciles active machines without moving valid placements', () => {
  const result = reconcileLayout({
    revision: 4,
    machines: {
      kept: { x: 3, z: -2, rotation: 15 },
      removed: { x: 0, z: 0, rotation: 0 }
    }
  }, [{ deviceId: 'kept' }, { deviceId: 'new' }]);

  assert.deepEqual(result.layout.machines.kept, { x: 3, z: -2, rotation: 15 });
  assert.equal(result.layout.machines.removed, undefined);
  assert.deepEqual(result.added, ['new']);
  assert.deepEqual(result.removed, ['removed']);
});

test('rejects movement into an occupied cell', () => {
  const layout = { machines: { a: { x: 0, z: 0 }, b: { x: 1, z: 0 } } };
  const result = moveMachine(layout, 'a', 1, 0);
  assert.equal(result.moved, false);
  assert.equal(result.reason, 'occupied');
  assert.deepEqual(result.layout.machines.a, { x: 0, z: 0, rotation: 0 });
});

test('supports free rotation and normalizes the persisted angle', () => {
  assert.equal(normalizeRotation(-15.25), 344.75);
  const result = rotateMachine({ machines: { a: { x: 0, z: 0, rotation: 0 } } }, 'a', 721.5);
  assert.equal(result.layout.machines.a.rotation, 1.5);
});

test('migrates version 1 layouts to stable version 2 factory bounds', () => {
  const migrated = cloneLayout({ version: 1, machines: { press: { x: 4, z: 0, rotation: 0 } } });
  assert.equal(migrated.version, 2);
  assert.deepEqual(migrated.factory, { minX: -3, maxX: 5, minZ: -3, maxZ: 3 });
  assert.deepEqual(getLayoutBounds(migrated), migrated.factory);
});

test('expands the factory in two-cell modules and never shrinks it', () => {
  const expanded = expandFactoryToFit(
    { minX: -7, maxX: 5, minZ: -3, maxZ: 3 },
    { press: { x: 0, z: 6 } }
  );
  assert.deepEqual(expanded, { minX: -7, maxX: 5, minZ: -3, maxZ: 7 });

  const moved = moveMachine({ factory: expanded, machines: { press: { x: 0, z: 6 } } }, 'press', 0, 0);
  assert.deepEqual(moved.layout.factory, expanded);
});
