import {
  formatConnectivityAge,
  getConnectivityDefinition
} from './connectivity-status.js';
import {
  getMachineStatusByCode,
  getMachineStatusLabel
} from './machine-status.js';

const PULSING_OPERATIONAL_CODES = new Set([1, 14]);

export const CONNECTIVITY_RING_OPACITY = Object.freeze({
  online: 0.92,
  stale: 0.68,
  offline: 0.38,
  unknown: 0.52
});

export function resolveDigitalTwinVisualState(machine = {}, { reducedMotion = false } = {}) {
  const sourceConnectivity = machine.connectivity || {};
  const connectivity = getConnectivityDefinition(sourceConnectivity.state);
  const connectivityLabel = String(sourceConnectivity.label || connectivity.label);
  const ageText = Number.isFinite(sourceConnectivity.ageMs)
    ? formatConnectivityAge(sourceConnectivity.ageMs)
    : '';
  const operational = getMachineStatusByCode(machine.machineStatus?.code);
  const online = connectivity.state === 'online';

  return {
    connectivity: {
      state: connectivity.state,
      label: connectivityLabel,
      text: ageText ? `${connectivityLabel} · ${ageText}` : connectivityLabel,
      ageText,
      rgb: [...connectivity.rgb]
    },
    operational: {
      code: operational.code,
      name: operational.name,
      label: getMachineStatusLabel(operational),
      prefix: online ? 'Operational' : 'Last operational',
      rgb: [...operational.rgb]
    },
    ringOpacity: CONNECTIVITY_RING_OPACITY[connectivity.state] ?? CONNECTIVITY_RING_OPACITY.unknown,
    shouldPulse: online && !reducedMotion && PULSING_OPERATIONAL_CODES.has(operational.code)
  };
}
