import { FIWARE_API_BASE, FIWARE_SERVICE, FIWARE_SERVICEPATH } from './config.js';

function joinFiwareUrl(path = '') {
  const base = FIWARE_API_BASE.replace(/\/+$/, '');
  if (!path) return base;
  const suffix = path.startsWith('/') ? path : `/${path}`;
  return `${base}${suffix}`;
}

export function buildFiwareHeaders(extra = {}) {
  return {
    Accept: 'application/json',
    ...(FIWARE_SERVICE && { 'Fiware-Service': FIWARE_SERVICE }),
    ...(FIWARE_SERVICEPATH ? { 'Fiware-ServicePath': FIWARE_SERVICEPATH } : { 'Fiware-ServicePath': '/' }),
    ...extra
  };
}

export function apiFetch(path, { method = 'GET', headers = {}, body } = {}) {
  const url = /^https?:\/\//i.test(path) ? path : joinFiwareUrl(path);
  const requestInit = {
    method,
    headers: buildFiwareHeaders(headers),
    credentials: 'include'
  };

  if (body !== undefined) {
    requestInit.body = body;
  }

  return fetch(url, requestInit);
}
