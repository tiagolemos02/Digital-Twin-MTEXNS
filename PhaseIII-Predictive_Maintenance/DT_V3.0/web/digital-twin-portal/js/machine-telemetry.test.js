import assert from 'node:assert/strict';
import test from 'node:test';
import { validateIAmAliveMapping } from './machine-telemetry.js';

test('requires canonical iamalive name and payload object id', () => {
  assert.equal(validateIAmAliveMapping([]).valid, false);
  assert.equal(validateIAmAliveMapping([
    { object_id: 'iamalive', name: 'iamalive', type: 'Text' }
  ]).valid, true);
  assert.equal(validateIAmAliveMapping([
    { object_id: 'i_am_alive', name: 'iamalive', type: 'Text' }
  ]).valid, false);
  assert.equal(validateIAmAliveMapping([
    { object_id: 'iamalive', name: 'i_am_alive', type: 'Text' }
  ]).valid, false);
});
