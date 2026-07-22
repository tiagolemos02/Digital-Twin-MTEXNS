export const IAMALIVE_ATTRIBUTE_NAME = 'iamalive';
export const GENERATED_LIMIT_SUFFIXES = ['minimum', 'maximum'];

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

function readOrionValue(raw) {
  if (raw && typeof raw === 'object' && Object.prototype.hasOwnProperty.call(raw, 'value')) {
    return raw.value;
  }
  return raw;
}

function telemetryAttributeNames(attribute = {}) {
  const names = [];
  const registeredName = String(attribute.name || '').trim();
  const objectId = String(attribute.object_id || attribute.objectId || '').trim();
  const objectIdLastSegment = objectId ? objectId.split('/').pop().trim() : '';
  if (registeredName) names.push(registeredName);
  if (objectIdLastSegment && !names.includes(objectIdLastSegment)) names.push(objectIdLastSegment);
  return names;
}

export function getGeneratedTelemetryAttributes(machine = {}) {
  const rawEntity = machine?.orionRaw || machine?.raw;
  if (!rawEntity || typeof rawEntity !== 'object' || Array.isArray(rawEntity)) return [];

  const generated = [];
  const seen = new Set();
  const registeredNames = new Set(
    (machine?.attributes || []).flatMap((attribute) => telemetryAttributeNames(attribute))
  );

  for (const attribute of machine?.attributes || []) {
    for (const sourceAttribute of telemetryAttributeNames(attribute)) {
      for (const suffix of GENERATED_LIMIT_SUFFIXES) {
        const name = `${sourceAttribute}_${suffix}`;
        if (
          seen.has(name) ||
          registeredNames.has(name) ||
          !Object.prototype.hasOwnProperty.call(rawEntity, name)
        ) continue;

        const rawAttribute = rawEntity[name];
        const rawType = rawAttribute && typeof rawAttribute === 'object'
          ? String(rawAttribute.type || '').trim()
          : '';
        generated.push({
          name,
          type: rawType || 'Number',
          value: readOrionValue(rawAttribute),
          sourceAttribute,
          generated: true,
          readOnly: true
        });
        seen.add(name);
      }
    }
  }

  return generated.sort((left, right) => left.name.localeCompare(right.name));
}
