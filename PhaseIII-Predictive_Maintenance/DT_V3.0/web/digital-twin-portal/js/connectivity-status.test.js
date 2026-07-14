import assert from 'node:assert/strict';
import test from 'node:test';
import {
  CONNECTIVITY_OFFLINE_AFTER_MS,
  CONNECTIVITY_ONLINE_THROUGH_MS,
  formatConnectivityAge,
  resolveConnectivity
} from './connectivity-status.js';

test('classifies the agreed two and ten minute boundaries', () => {
  const now = Date.parse('2026-07-06T12:00:00Z');
  assert.equal(resolveConnectivity({ now, lastContactMs: now }).state, 'online');
  assert.equal(resolveConnectivity({ now, lastContactMs: now - CONNECTIVITY_ONLINE_THROUGH_MS }).state, 'online');
  assert.equal(resolveConnectivity({ now, lastContactMs: now - CONNECTIVITY_ONLINE_THROUGH_MS - 1 }).state, 'stale');
  assert.equal(resolveConnectivity({ now, lastContactMs: now - CONNECTIVITY_OFFLINE_AFTER_MS }).state, 'stale');
  assert.equal(resolveConnectivity({ now, lastContactMs: now - CONNECTIVITY_OFFLINE_AFTER_MS - 1 }).state, 'offline');
});

test('uses Unknown for missing contact or unavailable monitoring', () => {
  const missing = resolveConnectivity({ lastContactMs: null });
  assert.equal(missing.state, 'unknown');
  assert.equal(missing.label, 'Unknown');
  const unavailable = resolveConnectivity({
    lastContactMs: Date.now(),
    monitoringAvailable: false,
    reason: 'monitoring-unavailable'
  });
  assert.equal(unavailable.state, 'unknown');
  assert.equal(unavailable.label, 'Monitoring unavailable');
  assert.equal(unavailable.reason, 'monitoring-unavailable');
});

test('formats age without implying false precision', () => {
  assert.equal(formatConnectivityAge(42_000), 'less than a minute ago');
  assert.equal(formatConnectivityAge(2 * 60_000), '2 minutes ago');
  assert.equal(formatConnectivityAge(60 * 60_000), '1 hour ago');
});
