import assert from "node:assert/strict";
import test from "node:test";
import { checkDeviceDiscoveryAccess } from "./discovery-access.js";

test("checks discovery access against the same IoT device resource used by the portal", async () => {
  let capturedUrl = "";
  let capturedOptions = null;
  const expectedResponse = { ok: true, status: 200 };
  const fetchImpl = async (url, options) => {
    capturedUrl = url;
    capturedOptions = options;
    return expectedResponse;
  };

  const response = await checkDeviceDiscoveryAccess({
    fetchImpl,
    baseUrl: "http://pep-proxy:1027",
    accessToken: "access-token",
    headers: {
      Accept: "application/json",
      "fiware-service": "openiot",
      "fiware-servicepath": "/"
    }
  });

  assert.equal(response, expectedResponse);
  assert.equal(capturedUrl, "http://pep-proxy:1027/iot/devices");
  assert.equal(capturedOptions.method, "GET");
  assert.equal(capturedOptions.headers.Authorization, "Bearer access-token");
  assert.equal(capturedOptions.headers["X-Auth-Token"], "access-token");
  assert.equal(capturedOptions.headers["fiware-service"], "openiot");
  assert.equal(capturedOptions.headers["fiware-servicepath"], "/");
});
