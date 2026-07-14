/* ======================== AUTHENTICATION ======================== */
/**
 * Authentication module - Login handling and session management
 * Uses BFF-managed session cookies and Authorization Code flow.
 */

import {
    KEYROCK_BFF_BASE,
    setSessionToken,
    setCurrentUserEmail,
    setKeystoneToken,
    sessionToken,
    currentUserEmail
} from './config.js';
import {
    loginBtnText,
    loginSpinner,
    btnLogin,
    loginMsg,
    userMenuWrapper,
    loggedInEmail,
    loginSection,
    portalShell,
    connectivityMonitorNotice,
    tabsNav,
    usersSection,
    newUsername,
    newEmail,
    newPassword,
    newDescription,
    newWebsite,
    newEnable,
    btnCreate
} from './dom-elements.js';
import { setElementsEnabled, setTabAccessRules, switchTab } from './ui-helpers.js';
import { apiFetch } from './api-client.js';
import { listUsers } from './users.js';
import { listLogs } from './orion-logs.js';
import { refreshInventory } from './inventory.js';
import { refreshRolesPermissionsData } from './roles-permissions.js';
import { refreshHistoricalData } from './historical-data.js';
import {
    startDeviceActivityMonitor,
    stopDeviceActivityMonitor,
    getDeviceActivityMonitorState
} from './device-activity.js';

let monitorNoticeBound = false;

function updateConnectivityMonitorNotice() {
    if (!connectivityMonitorNotice) return;
    const monitor = getDeviceActivityMonitorState();
    connectivityMonitorNotice.classList.toggle('hidden', monitor.available);
}

export function setupConnectivityMonitorNotice() {
    if (monitorNoticeBound || typeof window === 'undefined') return;
    monitorNoticeBound = true;
    window.addEventListener('device-activity-updated', updateConnectivityMonitorNotice);
    updateConnectivityMonitorNotice();
}

function showAuthErrorFromUrl() {
    if (typeof window === 'undefined') return;
    const url = new URL(window.location.href);
    const error = url.searchParams.get('auth_error');
    if (!error) return;
    loginMsg.textContent = `Keyrock could not complete sign-in. Detail: ${error}. Next: try signing in again; if it repeats, check the Keyrock container and redirect URI configuration.`;
    url.searchParams.delete('auth_error');
    window.history.replaceState({}, document.title, url.pathname + url.search + url.hash);
}

async function fetchSession() {
    const resp = await fetch('/auth/session', {
        method: 'GET',
        credentials: 'include',
        headers: { Accept: 'application/json' }
    });

    if (!resp.ok) {
        return { authenticated: false };
    }

    return resp.json().catch(() => ({ authenticated: false }));
}

/**
 * Start login process by redirecting user to Keyrock.
 */
export async function handleLogin() {
    loginMsg.textContent = '';
    loginBtnText.textContent = 'Redirecting...';
    loginSpinner.classList.remove('hidden');
    btnLogin.disabled = true;
    window.location.assign('/auth/login');
}

/**
 * Set up the UI for authenticated state
 * @param {string} email - User email to display
 */
export async function applyAuthenticatedUI(email) {
    const access = await resolveTabAccessRules();
    const initialTab = resolveInitialTab(access);

    userMenuWrapper.classList.remove('hidden');
    loggedInEmail.textContent = email || currentUserEmail || 'Authenticated user';
    loginSection.classList.add('hidden');
    portalShell.classList.remove('hidden');
    document.body.classList.add('is-authenticated');
    setupConnectivityMonitorNotice();
    tabsNav.classList.remove('hidden');
    usersSection.classList.remove('disabled-section');

    const formElements = [
        newUsername,
        newEmail,
        newPassword,
        newDescription,
        newWebsite,
        newEnable,
        btnCreate
    ];
    setElementsEnabled(formElements, access.users);
    setTabAccessRules(access);

    if (access.users) {
        listUsers();
    }
    if (access.orion) {
        try {
            await listLogs();
        } catch (err) {
            console.error('Failed to load Orion logs:', err);
        }
    }
    if (access.inventory) {
        try {
            await refreshInventory();
        } catch (err) {
            console.error('Failed to load inventory:', err);
        }
    }
    if (access.historical) {
        try {
            refreshHistoricalData();
        } catch (err) {
            console.error('Failed to prepare historical data:', err);
        }
    }
    if (access.roles) {
        try {
            await refreshRolesPermissionsData();
        } catch (err) {
            console.error('Failed to load roles & permissions data:', err);
        }
    }
    startDeviceActivityMonitor();
    switchTab(initialTab);
}

async function canAccessFiware(path, method = 'GET') {
    try {
        const resp = await apiFetch(path, { method });
        return resp.ok;
    } catch (_err) {
        return false;
    }
}

async function canAccessAdminApis() {
    if (!sessionToken) {
        return false;
    }

    try {
        const resp = await fetch(`${KEYROCK_BFF_BASE}/v1/users`, {
            method: 'GET',
            credentials: 'include',
            headers: {
                Accept: 'application/json'
            }
        });
        return resp.ok;
    } catch (_err) {
        return false;
    }
}

async function resolveTabAccessRules() {
    const [canAdmin, canReadOrion, canReadIotServices, canReadIotDevices] = await Promise.all([
        canAccessAdminApis(),
        canAccessFiware('/v2/entities?type=Machine&options=keyValues'),
        canAccessFiware('/iot/services'),
        canAccessFiware('/iot/devices')
    ]);

    const canUseInventory = canReadIotServices && canReadIotDevices;

    return {
        users: canAdmin,
        roles: canAdmin,
        audit: canAdmin,
        settings: canAdmin,
        orion: canReadOrion,
        historical: canReadOrion,
        digitalTwin: canUseInventory,
        inventory: canUseInventory,
        _capabilities: [
            {
                name: "Keyrock admin API",
                endpoint: "GET /bff/keyrock/v1/users",
                allowed: canAdmin
            },
            {
                name: "Orion machine read",
                endpoint: "GET /bff/fiware/v2/entities?type=Machine",
                allowed: canReadOrion
            },
            {
                name: "IoT Agent services read",
                endpoint: "GET /bff/fiware/iot/services",
                allowed: canReadIotServices
            },
            {
                name: "IoT Agent devices read",
                endpoint: "GET /bff/fiware/iot/devices",
                allowed: canReadIotDevices
            }
        ]
    };
}

function resolveInitialTab(access) {
    const order = ['inventory', 'orion', 'historical', 'digitalTwin', 'users', 'roles', 'audit', 'settings'];
    for (const tab of order) {
        if (access[tab]) return tab;
    }
    return 'orion';
}

/**
 * Check if user is currently authenticated
 * @returns {boolean} True if authenticated
 */
export function isAuthenticated() {
    return Boolean(sessionToken);
}

/**
 * Restore authenticated session from BFF cookie session.
 * @returns {Promise<boolean>} True if a session was restored.
 */
export async function resumeStoredSession() {
    showAuthErrorFromUrl();

    const state = await fetchSession();
    if (!state?.authenticated) {
        stopDeviceActivityMonitor();
        setSessionToken('');
        setCurrentUserEmail('');
        setKeystoneToken('');
        portalShell.classList.add('hidden');
        loginSection.classList.remove('hidden');
        document.body.classList.remove('is-authenticated');
        return false;
    }

    const email = state?.user?.email || state?.user?.username || '';
    setSessionToken('__bff_session__');
    setCurrentUserEmail(email);
    setKeystoneToken('__bff_admin_proxy__');
    await applyAuthenticatedUI(email);
    return true;
}
