import assert from 'node:assert/strict';
import test from 'node:test';
import { applyMachineActivity, applyMachineActivityCollection } from './machine-activity.js';

function activity(state, statusCode) {
  return {
    lastContactIso: '2026-07-20T10:00:00.000Z',
    source: 'orion-received-at',
    connectivity: { state, label: state, ageMs: 1_000 },
    machineStatus: { code: statusCode, name: `Status ${statusCode}` },
    lastOperationalUpdateIso: '2026-07-20T10:00:00.000Z',
    monitoringDelayed: false
  };
}

test('uses the exact entity name before the device ID fallback', () => {
  const machine = {
    entityName: 'urn:ngsi-ld:Machine:00-00-0A-B3-47-FA',
    deviceId: '00:00:0A:B3:47:FA'
  };
  const lookups = [];
  const getActivity = (id) => {
    lookups.push(id);
    return id === machine.entityName ? activity('online', 203) : activity('offline', 1);
  };

  applyMachineActivity(machine, getActivity, { now: 1 });

  assert.deepEqual(lookups, [machine.entityName]);
  assert.equal(machine.connectivity.state, 'online');
  assert.equal(machine.machineStatus.code, 203);
});

test('falls back to the device ID without constructing an entity URN', () => {
  const machine = { entityName: '', deviceId: 'printer-02' };
  const lookups = [];
  const getActivity = (id) => {
    lookups.push(id);
    return id === machine.deviceId ? activity('stale', 2) : null;
  };

  applyMachineActivity(machine, getActivity, { now: 1 });

  assert.deepEqual(lookups, ['printer-02']);
  assert.equal(machine.connectivity.state, 'stale');
  assert.equal(machine.machineStatus.code, 2);
});

test('updates the canonical machine objects in place', () => {
  const machines = [{ entityName: 'entity-01', deviceId: 'device-01' }];
  const original = machines[0];

  applyMachineActivityCollection(machines, () => activity('offline', 203), { now: 1 });

  assert.equal(machines[0], original);
  assert.equal(original.connectivity.state, 'offline');
  assert.equal(original.machineStatus.code, 203);
});
