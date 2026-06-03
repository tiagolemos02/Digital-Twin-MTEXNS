/* ======================== CONFIGURATION ======================== */
/**
 * Configuration file for Digital Twin Security Portal
 * Contains all API endpoints, service parameters, and global constants
 */

// API base URLs are now BFF-relative so browser never handles OAuth tokens directly.
export const FIWARE_API_BASE = "/bff/fiware";
export const KEYROCK_BFF_BASE = "/bff/keyrock";
export const ORION_BASE = `${FIWARE_API_BASE}/v2`;

// IoT Agent configuration (HTTP bindings)
export const IOT_AGENT_BASE = `${FIWARE_API_BASE}/iot`;
export const IOT_AGENT_CBROKER = "http://orion-v2:1026";
export const IOT_AGENT_RESOURCE = "/iot/json";
export const IOT_AGENT_TRANSPORT = "MQTT";
export const IOT_AGENT_PROTOCOL = "IoTA-JSON";

const runtimeConfig = typeof window !== "undefined" ? (window.__DT_RUNTIME_CONFIG__ || {}) : {};
export const KEYROCK_CLIENT_ID = runtimeConfig.KEYROCK_CLIENT_ID || "";

// FIWARE Service Configuration
export const FIWARE_SERVICE = "openiot";
export const FIWARE_SERVICEPATH = "/";

// Entity Configuration
export const ENTITY_TYPE = "Machine";

// Application State (kept in memory only)
export let sessionToken = "";
export let currentUserEmail = "";
export let keystoneToken = "";

export function setSessionToken(token) {
    sessionToken = token ? String(token) : "";
}

export function setCurrentUserEmail(email) {
    currentUserEmail = email ? String(email) : "";
}

export function setKeystoneToken(token) {
    keystoneToken = token ? String(token) : "";
}

export function clearSession() {
    sessionToken = "";
    currentUserEmail = "";
    keystoneToken = "";
}

export function restoreSessionFromStorage() {
    return {
        sessionToken,
        currentUserEmail,
        keystoneToken
    };
}
