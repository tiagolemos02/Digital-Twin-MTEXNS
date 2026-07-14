/* ======================== MAIN APPLICATION ======================== */
/**
 * Main Application module - Initialization and event coordination
 * Handles DOMContentLoaded setup, event listeners, and module coordination
 */

import { initTwinViewer } from './digital-twin.js';
import {
    btnLogin,
    portalSidebar,
    sidebarToggle,
    userInfoBtn,
    userDropdown,
    btnLogout,
    usersTab,
    rolesTab,
    auditTab,
    settingsTab,
    orionTab,
    historicalTab,
    digitalTwinTab,
    inventoryTab,
    refreshUsers,
    refreshLogs,
    btnApplyFilter,
    btnClearFilter,
    btnCreate,
    toggleNewPassword,
    newPassword,
    orionSection,
    historicalSection,
    rolesSection
} from './dom-elements.js';
import { showDropdown, resetApp, switchTab, togglePasswordVisibility } from './ui-helpers.js';
import { handleLogin, resumeStoredSession, setupConnectivityMonitorNotice } from './auth.js';
import { refreshUsersList, handleCreateUser } from './users.js';
import { refreshLogsList, applyLogsFilter, clearLogsFilter } from './orion-logs.js';
import { initInventory } from './inventory.js';
import { initRolesPermissions, refreshRolesPermissionsData } from './roles-permissions.js';
import { initHistoricalData, refreshHistoricalData } from './historical-data.js';

async function initializeApp() {
    setupConnectivityMonitorNotice();
    setupTabNavigation();
    setupSidebarNavigation();
    setupPasswordToggleHandlers();
    setupUserMenuHandlers();
    setupFilterHandlers();
    setupRefreshHandlers();
    initRolesPermissions();
    initHistoricalData();
    setInterval(() => {
        if (!orionSection.classList.contains('hidden')) {
            refreshLogsList();
        }
    }, 1500);
    setupAuthenticationHandlers();
    setupUserManagementHandlers();
    initTwinViewer({
        onProvisionMachine: () => {
            const hasAccess = switchTab('inventory');
            if (!hasAccess) return;
            window.requestAnimationFrame(() => {
                const form = document.getElementById('machineForm');
                const firstField = document.getElementById('machineServiceGroup') || document.getElementById('machineDeviceId');
                form?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                firstField?.focus({ preventScroll: true });
            });
        }
    });
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
    historicalTab.onclick = () => {
        const hasAccess = switchTab('historical');
        if (hasAccess && !historicalSection.classList.contains('hidden')) {
            refreshHistoricalData();
        }
    };
    digitalTwinTab.onclick = () => switchTab('digitalTwin');
    inventoryTab.onclick = () => switchTab('inventory');
}

function setupSidebarNavigation() {
    const setSidebarState = (state) => {
        if (!portalSidebar || !sidebarToggle) return;
        portalSidebar.dataset.sidebarState = state;
        sidebarToggle.setAttribute('aria-expanded', String(state === 'expanded'));
        sidebarToggle.setAttribute('aria-label', state === 'expanded' ? 'Collapse sidebar' : 'Expand sidebar');
        sidebarToggle.querySelector('i')?.classList.toggle('fa-angles-left', state === 'expanded');
        sidebarToggle.querySelector('i')?.classList.toggle('fa-angles-right', state === 'collapsed');
    };

    if (window.matchMedia('(max-width: 920px)').matches) {
        setSidebarState('collapsed');
    }

    sidebarToggle?.addEventListener('click', () => {
        const collapsed = portalSidebar?.dataset.sidebarState === 'collapsed';
        const nextState = collapsed ? 'expanded' : 'collapsed';
        setSidebarState(nextState);
    });

    document.querySelectorAll('[data-sidebar-group-toggle]').forEach((toggle) => {
        toggle.addEventListener('click', () => {
            const group = toggle.getAttribute('data-sidebar-group-toggle');
            const panel = document.querySelector(`[data-sidebar-group-panel="${group}"]`);
            const expanded = toggle.getAttribute('aria-expanded') !== 'false';
            toggle.setAttribute('aria-expanded', String(!expanded));
            panel?.classList.toggle('is-collapsed', expanded);
        });
    });
}

function setupPasswordToggleHandlers() {
    toggleNewPassword?.addEventListener('click', function () {
        togglePasswordVisibility(newPassword, this);
    });
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
}

function setupUserManagementHandlers() {
    btnCreate.onclick = handleCreateUser;
}

export function handleAppError(error, context = 'Application') {
    console.error(`${context} Error:`, error);
}

document.addEventListener('DOMContentLoaded', initializeApp);

export { initializeApp };
