import assert from 'node:assert/strict';
import test from 'node:test';
import {
  findAssetIdConflict,
  getAssetPlateLabel,
  getMachineDisplayLabel,
  getMachineIdentityPaletteEntry,
  resolveAssetIdentity,
  validateAssetId
} from './machine-identity.js';

test('validates and trims the agreed Asset ID format', () => {
  assert.deepEqual(validateAssetId('  HP-2000  '), { valid: true, value: 'HP-2000', error: '' });
  assert.equal(validateAssetId('CNC_04').valid, true);
  assert.equal(validateAssetId('A').valid, false);
  assert.equal(validateAssetId('HP 2000').valid, false);
  assert.equal(validateAssetId('PRESS#04').valid, false);
  assert.equal(validateAssetId('A'.repeat(21)).valid, false);
});

test('resolves compatible Asset ID sources without confirming legacy model', () => {
  assert.deepEqual(resolveAssetIdentity({ canonical: 'PRESS-01', legacyModel: 'OLD', deviceId: 'dev-1' }), {
    assetId: 'PRESS-01', assetIdSource: 'assetId', assetIdMissing: false, assetPlateLabel: 'PRESS-01'
  });
  assert.deepEqual(resolveAssetIdentity({ legacyModel: 'HP-2000', deviceId: 'dev-1' }), {
    assetId: 'HP-2000', assetIdSource: 'model', assetIdMissing: true, assetPlateLabel: 'dev-1'
  });
  assert.equal(resolveAssetIdentity({ deviceId: 'dev-1' }).assetPlateLabel, 'dev-1');
});

test('detects visible Asset ID duplicates case-insensitively', () => {
  const machines = [
    { deviceId: 'one', assetId: 'PRESS-01', assetIdMissing: false },
    { deviceId: 'legacy', assetId: 'PRESS-02', assetIdMissing: true }
  ];
  assert.equal(findAssetIdConflict(machines, 'press-01')?.deviceId, 'one');
  assert.equal(findAssetIdConflict(machines, 'press-02'), null);
  assert.equal(findAssetIdConflict(machines, 'PRESS-01', 'one'), null);
});

test('builds technical picker labels and map plate fallbacks', () => {
  assert.equal(getMachineDisplayLabel({
    assetId: 'CNC-04', assetIdMissing: false, friendlyName: 'Cutter', deviceId: 'device-1'
  }), 'CNC-04 — Cutter (device-1)');
  assert.equal(getMachineDisplayLabel({
    assetId: 'Legacy', assetIdMissing: true, deviceId: 'device-1'
  }), 'Asset ID missing — device-1');
  assert.equal(getAssetPlateLabel({ assetIdMissing: true, model: 'Legacy', deviceId: 'device-1' }), 'device-1');
});

test('assigns identity color from Asset ID with Device ID fallback', () => {
  assert.deepEqual(
    getMachineIdentityPaletteEntry({ assetId: 'PRESS-01', assetIdMissing: false, deviceId: 'device-1' }),
    getMachineIdentityPaletteEntry({ assetId: 'PRESS-01', assetIdMissing: false, deviceId: 'device-2' })
  );
  assert.deepEqual(
    getMachineIdentityPaletteEntry({ assetId: 'Legacy', assetIdMissing: true, deviceId: 'device-1' }),
    getMachineIdentityPaletteEntry('device-1')
  );
});
