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

function showAuthErrorFromUrl() {
    if (typeof window === 'undefined') return;
    const url = new URL(window.location.href);
    const error = url.searchParams.get('auth_error');
    if (!error) return;
    loginMsg.textContent = `Authentication failed: ${error}`;
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
    if (access.roles) {
        try {
            await refreshRolesPermissionsData();
        } catch (err) {
            console.error('Failed to load roles & permissions data:', err);
        }
    }
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
        digitalTwin: canUseInventory,
        inventory: canUseInventory
    };
}

function resolveInitialTab(access) {
    const order = ['users', 'orion', 'inventory', 'digitalTwin', 'roles', 'audit', 'settings'];
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
        setSessionToken('');
        setCurrentUserEmail('');
        setKeystoneToken('');
        return false;
    }

    const email = state?.user?.email || state?.user?.username || '';
    setSessionToken('__bff_session__');
    setCurrentUserEmail(email);
    setKeystoneToken('__bff_admin_proxy__');
    await applyAuthenticatedUI(email);
    return true;
}

/**
 * Handle Enter key press for login form
 * @param {Event} e - Keyboard event
 */
export function handleLoginKeyPress(e) {
    if (e.key === 'Enter') {
        handleLogin();
    }
}
