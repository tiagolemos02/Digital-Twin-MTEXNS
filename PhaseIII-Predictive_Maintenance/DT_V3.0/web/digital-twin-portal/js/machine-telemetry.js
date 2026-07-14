export const IAMALIVE_ATTRIBUTE_NAME = 'iamalive';

function normalized(value) {
  return String(value || '').trim().toLowerCase();
}

export function validateIAmAliveMapping(attributes = []) {
  const mapping = (Array.isArray(attributes) ? attributes : []).find((attribute) => (
    normalized(attribute?.name) === IAMALIVE_ATTRIBUTE_NAME &&
    normalized(attribute?.object_id || attribute?.objectId) === IAMALIVE_ATTRIBUTE_NAME
  ));
  if (mapping) return { valid: true, mapping, error: '' };
  return {
    valid: false,
    mapping: null,
    error: 'New machines require an iamalive telemetry attribute with both Object ID and Name set to iamalive.'
  };
}
