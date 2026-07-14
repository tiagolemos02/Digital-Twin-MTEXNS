import assert from 'node:assert/strict';
import test from 'node:test';
import {
  formatAttributeValue,
  inferCanonicalAttributeType,
  normalizeAttributeType,
  normalizeAutomaticAttribute,
  parseStaticAttributeValue
} from './attribute-types.js';

test('normalizes supported legacy aliases while preserving custom manual types', () => {
  assert.equal(normalizeAttributeType('integer'), 'Number');
  assert.equal(normalizeAttributeType('Float'), 'Number');
  assert.equal(normalizeAttributeType('string'), 'Text');
  assert.equal(normalizeAttributeType('boolean'), 'Boolean');
  assert.equal(normalizeAttributeType('datetime'), 'DateTime');
  assert.equal(normalizeAttributeType('structuredvalue'), 'StructuredValue');
  assert.equal(normalizeAttributeType('geo:point'), 'geo:point');
  assert.equal(normalizeAttributeType('geo:point', { preserveUnknown: false }), '');
  assert.deepEqual(
    normalizeAutomaticAttribute({ name: 'speed', type: 'float' }),
    { name: 'speed', type: 'Number' }
  );
});

test('converts automatic static values to their selected NGSI types', () => {
  assert.deepEqual(parseStaticAttributeValue('Number', '52.9'), {
    valid: true, type: 'Number', value: 52.9, error: ''
  });
  assert.deepEqual(parseStaticAttributeValue('Boolean', 'false'), {
    valid: true, type: 'Boolean', value: false, error: ''
  });
  assert.deepEqual(parseStaticAttributeValue('StructuredValue', '{"maximum":250,"value":10}'), {
    valid: true,
    type: 'StructuredValue',
    value: { maximum: 250, value: 10 },
    error: ''
  });
  assert.deepEqual(parseStaticAttributeValue('Text', '0010'), {
    valid: true, type: 'Text', value: '0010', error: ''
  });
});

test('rejects invalid typed static values and ambiguous datetimes', () => {
  assert.equal(parseStaticAttributeValue('Number', 'not-a-number').valid, false);
  assert.equal(parseStaticAttributeValue('Boolean', 'yes').valid, false);
  assert.equal(parseStaticAttributeValue('StructuredValue', '10').valid, false);
  assert.equal(parseStaticAttributeValue('StructuredValue', '{broken').valid, false);
  assert.equal(parseStaticAttributeValue('DateTime', '2026-07-14 16:42:08').valid, false);
  assert.equal(parseStaticAttributeValue('DateTime', '2026-07-14T16:42:08').valid, false);
  assert.equal(parseStaticAttributeValue('DateTime', '2026-02-30T16:42:08Z').valid, false);
  assert.equal(parseStaticAttributeValue('DateTime', new Date('invalid')).valid, false);
  assert.deepEqual(parseStaticAttributeValue('DateTime', '2026-07-14T16:42:08+01:00'), {
    valid: true,
    type: 'DateTime',
    value: '2026-07-14T16:42:08+01:00',
    error: ''
  });
});

test('infers canonical Orion types and formats structured values for the UI', () => {
  assert.equal(inferCanonicalAttributeType(2), 'Number');
  assert.equal(inferCanonicalAttributeType(2.5), 'Number');
  assert.equal(inferCanonicalAttributeType(true), 'Boolean');
  assert.equal(inferCanonicalAttributeType({ maximum: 250, value: 10 }), 'StructuredValue');
  assert.equal(inferCanonicalAttributeType('2026-07-14 16:42:08'), 'Text');
  assert.equal(formatAttributeValue({ maximum: 250, value: 10 }), '{"maximum":250,"value":10}');
});
