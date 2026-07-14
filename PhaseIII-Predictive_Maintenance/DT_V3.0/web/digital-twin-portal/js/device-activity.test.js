import assert from 'node:assert/strict';
import test from 'node:test';
import {
  analyzeDevice,
  clearDeviceActivity,
  extractIAmAliveContact,
  getDeviceActivity,
  recordDeviceActivityFailure,
  updateActivityFromDevices
} from './device-activity.js';

test('uses the Orion receive timestamp before the machine iamalive value', () => {
  const entity = {
    id: 'urn:ngsi-ld:Machine:press-01',
    type: 'Machine',
    iamalive: {
      type: 'Text',
      value: '2026-07-06 10:54:15',
      metadata: {
        timestamp: { type: 'DateTime', value: '2026-07-06T11:05:00.000Z' }
      }
    }
  };
  const contact = extractIAmAliveContact(entity, { factoryTimeZone: 'Europe/Lisbon' });
  assert.equal(contact.source, 'orion-received-at');
  assert.equal(contact.lastContactIso, '2026-07-06T11:05:00.000Z');
});

test('uses entity TimeInstant when attribute metadata has no receive timestamp', () => {
  const contact = extractIAmAliveContact({
    iamalive: { value: '2026-07-06T10:54:15Z', metadata: {} },
    TimeInstant: { type: 'DateTime', value: '2026-07-06T11:07:00Z' }
  });
  assert.equal(contact.source, 'orion-received-at');
  assert.equal(contact.lastContactIso, '2026-07-06T11:07:00.000Z');
});

test('falls back to a valid machine timestamp and rejects invalid iamalive values', () => {
  const fallback = extractIAmAliveContact({
    iamalive: { value: '2026-07-06T10:54:15Z', metadata: {} }
  });
  assert.equal(fallback.source, 'machine-iamalive');
  assert.equal(fallback.lastContactIso, '2026-07-06T10:54:15.000Z');

  const invalid = extractIAmAliveContact({
    iamalive: {
      value: 'not-a-date',
      metadata: { timestamp: { value: '2026-07-06T11:05:00Z' } }
    }
  });
  assert.equal(invalid.lastContactMs, null);
  assert.equal(invalid.reason, 'invalid-iamalive');
});

test('keeps connectivity separate from the last operational state', () => {
  const now = Date.parse('2026-07-06T11:20:00Z');
  const activity = analyzeDevice({
    id: 'urn:ngsi-ld:Machine:press-01',
    type: 'Machine',
    iamalive: {
      value: '2026-07-06T11:00:00Z',
      metadata: { timestamp: { value: '2026-07-06T11:00:00Z' } }
    },
    machine_status: {
      value: 203,
      metadata: { timestamp: { value: '2026-07-06T10:59:00Z' } }
    }
  }, { now });

  assert.equal(activity.connectivity.state, 'offline');
  assert.equal(activity.machineStatus.code, 203);
  assert.equal(activity.machineStatus.name, 'Printing');
  assert.equal(activity.lastOperationalUpdateIso, '2026-07-06T10:59:00.000Z');
});

test('changes existing connectivity to unavailable after three monitor failures', () => {
  const now = Date.parse('2026-07-06T11:00:30Z');
  updateActivityFromDevices([{
    id: 'urn:ngsi-ld:Machine:press-01',
    iamalive: { value: '2026-07-06T11:00:00Z' }
  }], { now });
  assert.equal(getDeviceActivity('urn:ngsi-ld:Machine:press-01', { now }).connectivity.state, 'online');
  recordDeviceActivityFailure(new Error('Orion unavailable'), now);
  recordDeviceActivityFailure(new Error('Orion unavailable'), now);
  assert.equal(getDeviceActivity('urn:ngsi-ld:Machine:press-01', { now }).connectivity.state, 'online');
  recordDeviceActivityFailure(new Error('Orion unavailable'), now);
  assert.equal(getDeviceActivity('urn:ngsi-ld:Machine:press-01', { now }).connectivity.state, 'unknown');
  assert.equal(getDeviceActivity('urn:ngsi-ld:Machine:press-01', { now }).connectivity.reason, 'monitoring-unavailable');
  clearDeviceActivity();
});
