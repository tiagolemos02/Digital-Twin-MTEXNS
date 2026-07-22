import assert from 'node:assert/strict';
import test from 'node:test';
import {
  getGeneratedTelemetryAttributes,
  validateIAmAliveMapping
} from './machine-telemetry.js';

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

test('discovers only generated limits that exist in the Orion entity', () => {
  const machine = {
    attributes: [
      { object_id: 'service_time', name: 'service_time', type: 'StructuredValue' },
      { object_id: 'diagnostics', name: 'diagnostics', type: 'StructuredValue' },
      { object_id: 'temperature', name: 'temperature', type: 'Number' },
      { object_id: 'temperature_maximum', name: 'temperature_maximum', type: 'Number' }
    ],
    raw: {
      service_time: { type: 'Number', value: 42 },
      service_time_minimum: { type: 'Number', value: 0 },
      service_time_maximum: { type: 'Number', value: 90 },
      temperature_maximum: { type: 'Number', value: 30 }
    }
  };

  assert.deepEqual(getGeneratedTelemetryAttributes(machine), [
    {
      name: 'service_time_maximum',
      type: 'Number',
      value: 90,
      sourceAttribute: 'service_time',
      generated: true,
      readOnly: true
    },
    {
      name: 'service_time_minimum',
      type: 'Number',
      value: 0,
      sourceAttribute: 'service_time',
      generated: true,
      readOnly: true
    }
  ]);
});

test('discovers generated limits for a base counter registered as Number', () => {
  const generated = getGeneratedTelemetryAttributes({
    attributes: [{ object_id: 'service_time', name: 'service_time', type: 'Number' }],
    raw: {
      service_time: { type: 'Number', value: 42 },
      service_time_maximum: { type: 'Number', value: 90 }
    }
  });

  assert.equal(generated.length, 1);
  assert.equal(generated[0].name, 'service_time_maximum');
  assert.equal(generated[0].sourceAttribute, 'service_time');
});

test('does not invent generated limits before Orion exposes them', () => {
  assert.deepEqual(getGeneratedTelemetryAttributes({
    attributes: [{ object_id: 'service_time', name: 'service_time', type: 'StructuredValue' }],
    raw: { service_time: { type: 'Number', value: 42 } }
  }), []);
});

test('prefers the separate Orion snapshot over IoT Agent registration data', () => {
  const generated = getGeneratedTelemetryAttributes({
    attributes: [{ object_id: 'service_time', name: 'service_time', type: 'StructuredValue' }],
    raw: { attributes: [{ name: 'service_time', type: 'StructuredValue' }] },
    orionRaw: { service_time_maximum: { type: 'Number', value: 90 } }
  });

  assert.equal(generated.length, 1);
  assert.equal(generated[0].name, 'service_time_maximum');
  assert.equal(generated[0].value, 90);
});
