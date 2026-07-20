import { resolveConnectivity } from './connectivity-status.js';
import { DEFAULT_MACHINE_STATUS } from './machine-status.js';

function missingActivityState(machine) {
  machine.lastSeen = '';
  machine.lastSeenAttribute = '';
  machine.activityAgeMs = null;
  machine.connectivity = resolveConnectivity({ reason: 'missing-iamalive' });
  machine.machineStatus = DEFAULT_MACHINE_STATUS;
  machine.lastOperationalUpdateIso = '';
  machine.monitoringDelayed = false;
}

export function applyMachineActivity(machine, getActivity, { now = Date.now() } = {}) {
  if (!machine || typeof getActivity !== 'function') return machine;
  const entityName = String(machine.entityName || '').trim();
  const deviceId = String(machine.deviceId || '').trim();
  const activity = (entityName ? getActivity(entityName, { now }) : null)
    || (deviceId ? getActivity(deviceId, { now }) : null);

  if (!activity) {
    missingActivityState(machine);
    return machine;
  }

  machine.lastSeen = activity.lastContactIso || '';
  machine.lastSeenAttribute = activity.source || '';
  machine.activityAgeMs = activity.connectivity?.ageMs ?? null;
  machine.connectivity = activity.connectivity || resolveConnectivity({ reason: activity.reason });
  machine.machineStatus = activity.machineStatus || DEFAULT_MACHINE_STATUS;
  machine.lastOperationalUpdateIso = activity.lastOperationalUpdateIso || '';
  machine.monitoringDelayed = Boolean(activity.monitoringDelayed);
  return machine;
}

export function applyMachineActivityCollection(machines, getActivity, options) {
  (Array.isArray(machines) ? machines : []).forEach((machine) => {
    applyMachineActivity(machine, getActivity, options);
  });
  return machines;
}
