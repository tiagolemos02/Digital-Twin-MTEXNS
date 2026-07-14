export const CANONICAL_ATTRIBUTE_TYPES = Object.freeze([
  'Number',
  'Text',
  'Boolean',
  'StructuredValue',
  'DateTime'
]);

const TYPE_ALIASES = Object.freeze({
  number: 'Number',
  integer: 'Number',
  float: 'Number',
  text: 'Text',
  string: 'Text',
  boolean: 'Boolean',
  structuredvalue: 'StructuredValue',
  datetime: 'DateTime'
});

const ISO_DATETIME_WITH_TIMEZONE =
  /^(\d{4})-(\d{2})-(\d{2})T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,9})?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/i;

export function normalizeAttributeType(type, { preserveUnknown = true } = {}) {
  const original = String(type ?? '').trim();
  if (!original) return '';
  return TYPE_ALIASES[original.toLowerCase()] || (preserveUnknown ? original : '');
}

export function normalizeAutomaticAttribute(attribute = {}) {
  return {
    ...attribute,
    type: normalizeAttributeType(attribute.type)
  };
}

export function parseStaticAttributeValue(type, rawValue) {
  const normalizedType = normalizeAttributeType(type, { preserveUnknown: false });
  if (!normalizedType) {
    return { valid: false, type: '', value: rawValue, error: 'Select a supported attribute type.' };
  }

  if (normalizedType === 'Text') {
    return { valid: true, type: normalizedType, value: String(rawValue ?? ''), error: '' };
  }

  if (normalizedType === 'Number') {
    const candidate = typeof rawValue === 'string' ? rawValue.trim() : rawValue;
    const value = typeof candidate === 'number' ? candidate : Number(candidate);
    if (candidate === '' || !Number.isFinite(value)) {
      return { valid: false, type: normalizedType, value: rawValue, error: 'Number values must be finite numbers.' };
    }
    return { valid: true, type: normalizedType, value, error: '' };
  }

  if (normalizedType === 'Boolean') {
    if (typeof rawValue === 'boolean') {
      return { valid: true, type: normalizedType, value: rawValue, error: '' };
    }
    const candidate = String(rawValue ?? '').trim().toLowerCase();
    if (candidate !== 'true' && candidate !== 'false') {
      return { valid: false, type: normalizedType, value: rawValue, error: 'Boolean values must be true or false.' };
    }
    return { valid: true, type: normalizedType, value: candidate === 'true', error: '' };
  }

  if (normalizedType === 'StructuredValue') {
    let value = rawValue;
    if (typeof value === 'string') {
      try {
        value = JSON.parse(value);
      } catch {
        return { valid: false, type: normalizedType, value: rawValue, error: 'StructuredValue must contain valid JSON.' };
      }
    }
    if (!value || typeof value !== 'object') {
      return { valid: false, type: normalizedType, value: rawValue, error: 'StructuredValue must be a JSON object or array.' };
    }
    return { valid: true, type: normalizedType, value, error: '' };
  }

  const invalidDateTime = () => ({
    valid: false,
    type: normalizedType,
    value: rawValue,
    error: 'DateTime values must use ISO 8601 with Z or an explicit timezone offset.'
  });
  if (rawValue instanceof Date && Number.isNaN(rawValue.getTime())) {
    return invalidDateTime();
  }
  const candidate = rawValue instanceof Date ? rawValue.toISOString() : String(rawValue ?? '').trim();
  const match = candidate.match(ISO_DATETIME_WITH_TIMEZONE);
  if (!match || Number.isNaN(Date.parse(candidate))) {
    return invalidDateTime();
  }
  const calendarDate = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  if (
    calendarDate.getUTCFullYear() !== Number(match[1]) ||
    calendarDate.getUTCMonth() !== Number(match[2]) - 1 ||
    calendarDate.getUTCDate() !== Number(match[3])
  ) {
    return invalidDateTime();
  }
  return { valid: true, type: normalizedType, value: candidate, error: '' };
}

export function inferCanonicalAttributeType(value) {
  if (typeof value === 'number') return 'Number';
  if (typeof value === 'boolean') return 'Boolean';
  if (value && typeof value === 'object') return 'StructuredValue';
  return 'Text';
}

export function formatAttributeValue(value) {
  if (value && typeof value === 'object') {
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }
  return String(value ?? '');
}
