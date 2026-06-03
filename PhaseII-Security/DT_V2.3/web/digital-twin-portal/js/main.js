/* ======================== MAIN APPLICATION ======================== */
/**
 * Main Application module - Initialization and event coordination
 * Handles DOMContentLoaded setup, event listeners, and module coordination
 */

import { initTwinViewer } from './digital-twin.js';
import {
    emailInput,
    passwordInput,
    btnLogin,
    userInfoBtn,
    userDropdown,
    btnLogout,
    usersTab,
    rolesTab,
    auditTab,
    settingsTab,
    orionTab,
    digitalTwinTab,
    inventoryTab,
    refreshUsers,
    refreshLogs,
    btnApplyFilter,
    btnClearFilter,
    btnCreate,
    togglePassword,
    toggleNewPassword,
    newPassword,
    orionSection,
    rolesSection
} from './dom-elements.js';
import { showDropdown, resetApp, switchTab, togglePasswordVisibility } from './ui-helpers.js';
import { handleLogin, handleLoginKeyPress, resumeStoredSession } from './auth.js';
import { refreshUsersList, handleCreateUser } from './users.js';
import { refreshLogsList, applyLogsFilter, clearLogsFilter } from './orion-logs.js';
import { initInventory } from './inventory.js';
import { initRolesPermissions, refreshRolesPermissionsData } from './roles-permissions.js';

async function initializeApp() {
    setupTabNavigation();
    setupPasswordToggleHandlers();
    setupUserMenuHandlers();
    setupFilterHandlers();
    setupRefreshHandlers();
    initRolesPermissions();
    setInterval(() => {
        if (!orionSection.classList.contains('hidden')) {
            refreshLogsList();
        }
    }, 1500);
    setupAuthenticationHandlers();
    setupUserManagementHandlers();
    initTwinViewer();
    initInventory();

    await resumeStoredSession();

    console.log('Digital Twin Security Portal initialized successfully');
}

function setupTabNavigation() {
    usersTab.onclick = () => switchTab('users');
    rolesTab.onclick = async () => {
        const hasAccess = switchTab('roles');
        if (hasAccess && !rolesSection.classList.contains('hidden')) {
            refreshRolesPermissionsData();
        }
    };
    auditTab.onclick = () => switchTab('audit');
    settingsTab.onclick = () => switchTab('settings');
    orionTab.onclick = () => switchTab('orion');
    digitalTwinTab.onclick = () => switchTab('digitalTwin');
    inventoryTab.onclick = () => switchTab('inventory');
}

function setupPasswordToggleHandlers() {
    togglePassword.onclick = function () {
        togglePasswordVisibility(passwordInput, this);
    };

    toggleNewPassword.onclick = function () {
        togglePasswordVisibility(newPassword, this);
    };
}

function setupUserMenuHandlers() {
    userInfoBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        showDropdown(userDropdown.classList.contains('hidden'));
    });

    document.addEventListener('click', () => showDropdown(false));

    btnLogout.addEventListener('click', resetApp);
}

function setupFilterHandlers() {
    btnApplyFilter.onclick = applyLogsFilter;
    btnClearFilter.onclick = clearLogsFilter;
}

function setupRefreshHandlers() {
    refreshUsers.onclick = refreshUsersList;
    refreshLogs.onclick = refreshLogsList;
}

function setupAuthenticationHandlers() {
    btnLogin.onclick = handleLogin;

    emailInput.addEventListener('keypress', handleLoginKeyPress);
    passwordInput.addEventListener('keypress', handleLoginKeyPress);
}

function setupUserManagementHandlers() {
    btnCreate.onclick = handleCreateUser;
}

export function handleAppError(error, context = 'Application') {
    console.error(`${context} Error:`, error);
}

document.addEventListener('DOMContentLoaded', initializeApp);

export { initializeApp };
