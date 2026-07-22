import assert from 'node:assert/strict';
import test from 'node:test';
import {
  CONNECTIVITY_RING_OPACITY,
  resolveDigitalTwinVisualState
} from './digital-twin-visual-state.js';

function machineWith(connectivityState, statusCode, overrides = {}) {
  return {
    connectivity: {
      state: connectivityState,
      ageMs: 18_000,
      ...overrides.connectivity
    },
    machineStatus: { code: statusCode },
    ...overrides.machine
  };
}

test('keeps connectivity and operational visual channels separate', () => {
  const visual = resolveDigitalTwinVisualState(machineWith('online', 203));

  assert.deepEqual(visual.connectivity.rgb, [4, 120, 87]);
  assert.equal(visual.connectivity.text, 'Online · less than a minute ago');
  assert.deepEqual(visual.operational.rgb, [56, 142, 60]);
  assert.equal(visual.operational.label, 'Printing (203)');
  assert.equal(visual.operational.prefix, 'Operational');
  assert.equal(visual.ringOpacity, 0.92);
  assert.equal(visual.shouldPulse, false);
});

test('labels retained operational state as last operational outside online connectivity', () => {
  const visual = resolveDigitalTwinVisualState(machineWith('offline', 203, {
    connectivity: { ageMs: 14 * 60_000 }
  }));

  assert.equal(visual.connectivity.text, 'Offline · 14 minutes ago');
  assert.equal(visual.operational.prefix, 'Last operational');
  assert.equal(visual.operational.label, 'Printing (203)');
  assert.deepEqual(visual.operational.rgb, [56, 142, 60]);
  assert.equal(visual.ringOpacity, 0.38);
});

test('uses the approved ring attenuation for every connectivity state', () => {
  Object.entries(CONNECTIVITY_RING_OPACITY).forEach(([state, opacity]) => {
    assert.equal(resolveDigitalTwinVisualState(machineWith(state, 2)).ringOpacity, opacity);
  });
});

test('pulses only online Emergency and Critical error states when motion is allowed', () => {
  assert.equal(resolveDigitalTwinVisualState(machineWith('online', 1)).shouldPulse, true);
  assert.equal(resolveDigitalTwinVisualState(machineWith('online', 14)).shouldPulse, true);
  assert.equal(resolveDigitalTwinVisualState(machineWith('online', 206)).shouldPulse, false);
  assert.equal(resolveDigitalTwinVisualState(machineWith('stale', 1)).shouldPulse, false);
  assert.equal(resolveDigitalTwinVisualState(machineWith('online', 1), { reducedMotion: true }).shouldPulse, false);
});

test('preserves monitoring-unavailable copy and resolves unknown operational codes', () => {
  const visual = resolveDigitalTwinVisualState(machineWith('unknown', 12345, {
    connectivity: { label: 'Monitoring unavailable', ageMs: null }
  }));

  assert.equal(visual.connectivity.label, 'Monitoring unavailable');
  assert.equal(visual.connectivity.text, 'Monitoring unavailable');
  assert.equal(visual.operational.label, 'Unknown (999)');
  assert.deepEqual(visual.operational.rgb, [158, 158, 158]);
  assert.equal(visual.operational.prefix, 'Last operational');
  assert.equal(visual.ringOpacity, 0.52);
});
