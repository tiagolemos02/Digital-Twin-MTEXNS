export function checkDeviceDiscoveryAccess({
  fetchImpl = globalThis.fetch,
  baseUrl,
  accessToken,
  headers = {}
} = {}) {
  if (typeof fetchImpl !== "function") {
    throw new TypeError("A fetch implementation is required.");
  }

  const permissionHeaders = {
    ...headers,
    Authorization: `Bearer ${accessToken}`,
    "X-Auth-Token": accessToken
  };
  const permissionUrl = new URL("/iot/devices", baseUrl).toString();

  return fetchImpl(permissionUrl, { method: "GET", headers: permissionHeaders });
}
