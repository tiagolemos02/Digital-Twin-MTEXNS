import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const mappingUrl = new URL('../../../MQTTSimulator/simulator-telemetry-mapping.json', import.meta.url);
const boundedMetricPattern = /(_since_last_pm|_since_last_air_filter_pm|_since_replacement)$/;

test('all bounded maintenance counters declare their normalized NGSI value as Number', async () => {
  const mapping = JSON.parse(await readFile(mappingUrl, 'utf8'));
  const bounded = mapping.filter((attribute) => boundedMetricPattern.test(String(attribute?.name || '')));

  assert.equal(bounded.length, 75, 'the canonical mapping should contain the 75 maintenance counters');
  assert.deepEqual(
    bounded.filter((attribute) => attribute.type !== 'Number').map((attribute) => attribute.name),
    []
  );
});
