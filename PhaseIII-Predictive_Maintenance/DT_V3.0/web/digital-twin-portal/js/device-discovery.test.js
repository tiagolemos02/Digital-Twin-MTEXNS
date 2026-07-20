import assert from 'node:assert/strict';
import test from 'node:test';
import { loadDiscoveredDevices } from './device-discovery.js';

test('loads discovered IDs with FIWARE tenant headers and session credentials', async () => {
  let capturedUrl = '';
  let capturedOptions = null;
  const fetchImpl = async (url, options) => {
    capturedUrl = url;
    capturedOptions = options;
    return {
      ok: true,
      status: 200,
      json: async () => ({
        devices: [
          { deviceId: 'machine-02', lastSeen: '2026-07-20T09:17:36.394Z' },
          { device_id: 'machine-01' },
          { id: 'machine-02', firstSeen: '2026-07-20T09:11:19.546Z' },
          { deviceId: '   ' }
        ]
      })
    };
  };

  const devices = await loadDiscoveredDevices({ fetchImpl });

  assert.equal(capturedUrl, '/bff/portal/discovered-devices');
  assert.equal(capturedOptions.method, 'GET');
  assert.equal(capturedOptions.credentials, 'include');
  assert.equal(capturedOptions.headers['Fiware-Service'], 'openiot');
  assert.equal(capturedOptions.headers['Fiware-ServicePath'], '/');
  assert.deepEqual(devices, [
    { id: 'machine-02', firstSeen: '2026-07-20T09:11:19.546Z', deviceId: 'machine-02' },
    { device_id: 'machine-01', deviceId: 'machine-01' }
  ]);
});

test('surfaces discovery endpoint errors', async () => {
  const fetchImpl = async () => ({
    ok: false,
    status: 403,
    json: async () => ({ error: 'Access denied' })
  });

  await assert.rejects(loadDiscoveredDevices({ fetchImpl }), /Access denied/);
});
