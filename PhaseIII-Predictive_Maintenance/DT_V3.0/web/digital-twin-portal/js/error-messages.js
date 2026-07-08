const DEFAULT_RECOVERY = 'Try again. If this continues, check the access profile and service container logs.';

function cleanDetail(detail = '') {
  return String(detail || '').replace(/\s+/g, ' ').trim();
}

export async function readResponseDetail(resp) {
  const text = await resp.text().catch(() => '');
  if (!text) return '';

  try {
    const data = JSON.parse(text);
    return cleanDetail(
      data?.description ||
      data?.error?.message ||
      data?.error ||
      data?.message ||
      text
    );
  } catch (_err) {
    return cleanDetail(text);
  }
}

export function recoveryForStatus(status, fallback = DEFAULT_RECOVERY) {
  if (status === 400) return 'Check the submitted fields and payload preview, then try again.';
  if (status === 401) return 'Your session is not authenticated. Sign in again through Keyrock.';
  if (status === 403) return 'PEP/AuthzForce denied this request. Ask an admin to assign the required role or permission.';
  if (status === 404) return 'The target resource was not found. Refresh the inventory and confirm the selected service group or machine still exists.';
  if (status === 409) return 'A matching resource already exists. Refresh the page and check the existing records before retrying.';
  if (status === 429) return 'The service is rate limiting requests. Wait a moment, then try again.';
  if (status >= 500) return 'The backend service failed. Check the relevant container logs, then retry.';
  return fallback;
}

export function formatHttpError({ system, action, endpoint, status, detail = '', recovery }) {
  const pieces = [
    `${system} could not ${action} (HTTP ${status}).`,
    endpoint ? `Check: ${endpoint}.` : '',
    cleanDetail(detail) ? `Detail: ${cleanDetail(detail)}.` : '',
    `Next: ${recoveryForStatus(status, recovery)}`
  ];
  return pieces.filter(Boolean).join(' ');
}

export function formatNetworkError({ system, action, endpoint, recovery = DEFAULT_RECOVERY }) {
  const pieces = [
    `${system} could not ${action}.`,
    endpoint ? `Check: ${endpoint}.` : '',
    `Next: The portal could not reach the backend. Verify the stack is running and your session is still valid, then try again.`,
    recovery && recovery !== DEFAULT_RECOVERY ? recovery : ''
  ];
  return pieces.filter(Boolean).join(' ');
}

export async function formatResponseError(resp, context) {
  const detail = await readResponseDetail(resp);
  return formatHttpError({
    ...context,
    status: resp.status,
    detail
  });
}

export function formatThrownError(error, context) {
  const message = error instanceof Error ? error.message : String(error || '');
  if (message && !/Failed to fetch|NetworkError|Load failed/i.test(message)) {
    return message;
  }
  return formatNetworkError(context);
}
