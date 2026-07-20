/* ======================== UI HELPERS ======================== */
/**
 * UI Helper functions for interface management
 * Tab switching, dropdown handling, and general UI interactions
 */

import {
    userDropdown, usersTab, rolesTab, auditTab, settingsTab, orionTab, historicalTab, digitalTwinTab, inventoryTab, 
    usersSection, rolesSection, auditSection, settingsSection, orionSection, historicalSection, digitalTwinSection, inventorySection
} from './dom-elements.js';
import { clearSession } from './config.js';
import { stopDeviceActivityMonitor } from './device-activity.js';

const TAB_MAP = {
    users: { button: usersTab, section: usersSection },
    roles: { button: rolesTab, section: rolesSection },
    audit: { button: auditTab, section: auditSection },
    settings: { button: settingsTab, section: settingsSection },
    orion: { button: orionTab, section: orionSection },
    historical: { button: historicalTab, section: historicalSection },
    digitalTwin: { button: digitalTwinTab, section: digitalTwinSection },
    inventory: { button: inventoryTab, section: inventorySection }
};

const tabAccess = {
    users: true,
    roles: true,
    audit: true,
    settings: true,
    orion: true,
    historical: true,
    digitalTwin: true,
    inventory: true
};

const TAB_ACCESS_DETAILS = {
    users: {
        label: "User Management",
        capability: "Keyrock admin API",
        endpoint: "GET /bff/keyrock/v1/users",
        recovery: "Sign in with an administrator role that can read Keyrock users."
    },
    roles: {
        label: "Roles & Permissions",
        capability: "Keyrock roles and permissions",
        endpoint: "GET /bff/keyrock/v1/applications/{clientId}/roles",
        recovery: "Sign in with an administrator role that can manage application roles."
    },
    audit: {
        label: "Audit Logs",
        capability: "Keyrock admin API",
        endpoint: "GET /bff/keyrock/v1/users",
        recovery: "Sign in with an administrator role before viewing audit data."
    },
    settings: {
        label: "Security Settings",
        capability: "Keyrock admin API",
        endpoint: "GET /bff/keyrock/v1/users",
        recovery: "Sign in with an administrator role before changing security settings."
    },
    orion: {
        label: "Current State",
        capability: "Orion machine read",
        endpoint: "GET /bff/fiware/v2/entities?type=Machine",
        recovery: "Ask an admin to grant Orion Machine read permission for this FIWARE service."
    },
    historical: {
        label: "Historical Data",
        capability: "Orion machine read",
        endpoint: "GET /bff/fiware/v2/entities?type=Machine",
        recovery: "Ask an admin to grant Orion Machine read permission before loading historical telemetry."
    },
    digitalTwin: {
        label: "3D Digital Twin",
        capability: "IoT Agent inventory read",
        endpoint: "GET /bff/fiware/iot/services and /iot/devices",
        recovery: "Ask an admin to grant IoT Agent service and device read permissions."
    },
    inventory: {
        label: "Machines & Services",
        capability: "IoT Agent inventory read",
        endpoint: "GET /bff/fiware/iot/services and /iot/devices",
        recovery: "Ask an admin to grant IoT Agent service and device read permissions."
    }
};

const ACCESS_DENIED_PLACEHOLDER_ATTR = "data-access-denied-placeholder";

function escapeHtml(value = "") {
    return String(value)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

/**
 * Show/hide dropdown menu
 * @param {boolean} show - Whether to show the dropdown
 */
export function showDropdown(show = true) {
    userDropdown.classList.toggle("hidden", !show);
    userDropdown.previousElementSibling?.setAttribute("aria-expanded", String(show));
}

/**
 * Reset the entire application (reload page)
 */
export function resetApp() {
    stopDeviceActivityMonitor();
    clearSession();
    window.location.assign("/auth/logout");
}

/**
 * Clear active styles from all tab buttons
 */
export function clearTabButtonStyles() {
    Object.values(TAB_MAP).forEach(({ button: btn }) => {
        btn.classList.remove("tab-active", "text-indigo-600");
        btn.classList.add("text-gray-500", "border-transparent");
        btn.setAttribute("aria-current", "false");
    });
}

/**
 * Hide all content sections
 */
export function hideAllSections() {
    Object.values(TAB_MAP).forEach(({ section }) => {
        section.classList.add("hidden");
    });
}

function canAccessTab(name) {
    return tabAccess[name] !== false;
}

function getTabLabel(name) {
    const label = TAB_ACCESS_DETAILS[name]?.label || TAB_MAP[name]?.button?.textContent || name;
    return label.replace(/\s+/g, " ").trim();
}

function ensureAccessDeniedPlaceholder(name) {
    const section = TAB_MAP[name]?.section;
    if (!section) {
        return null;
    }

    let placeholder = section.querySelector(`[${ACCESS_DENIED_PLACEHOLDER_ATTR}="true"]`);
    if (placeholder) {
        return placeholder;
    }

    placeholder = document.createElement("div");
    placeholder.setAttribute(ACCESS_DENIED_PLACEHOLDER_ATTR, "true");
    placeholder.className = "access-restricted-state";
    placeholder.innerHTML = `
      <div class="access-restricted-icon" aria-hidden="true">
        <i class="fas fa-lock"></i>
      </div>
      <div class="access-restricted-copy">
        <p class="access-restricted-eyebrow">Restricted</p>
        <h2>${escapeHtml(getTabLabel(name))}</h2>
        <p>Your current role does not include access to this module.</p>
        <dl>
          <div>
            <dt>Required capability</dt>
            <dd>${escapeHtml(TAB_ACCESS_DETAILS[name]?.capability || "Module access")}</dd>
          </div>
          <div>
            <dt>Permission check</dt>
            <dd><code>${escapeHtml(TAB_ACCESS_DETAILS[name]?.endpoint || "Role permission")}</code></dd>
          </div>
        </dl>
        <p class="access-restricted-recovery">${escapeHtml(TAB_ACCESS_DETAILS[name]?.recovery || "Ask an administrator to update your role, then sign in again.")}</p>
      </div>
    `;
    section.appendChild(placeholder);
    return placeholder;
}

function setTabDeniedState(name, denied) {
    const section = TAB_MAP[name]?.section;
    if (!section) {
        return;
    }

    const placeholder = ensureAccessDeniedPlaceholder(name);
    section.classList.toggle("tab-denied", denied);
    if (placeholder) {
        placeholder.classList.toggle("hidden", !denied);
    }
}

function applyTabAccessStyles() {
    Object.entries(TAB_MAP).forEach(([name, { button }]) => {
        const blocked = !canAccessTab(name);
        if (!button.dataset.accessLabel) {
            button.dataset.accessLabel = button.getAttribute("aria-label") || getTabLabel(name);
            button.dataset.accessTitle = button.getAttribute("title") || getTabLabel(name);
        }
        button.classList.remove("opacity-50", "text-gray-400");
        button.classList.toggle("is-restricted", blocked);
        let indicator = button.querySelector('[data-restricted-indicator="true"]');
        if (blocked && !indicator) {
            indicator = document.createElement("span");
            indicator.dataset.restrictedIndicator = "true";
            indicator.className = "sidebar-restricted-indicator";
            indicator.innerHTML = '<i class="fas fa-lock" aria-hidden="true"></i><span>Restricted</span>';
            button.appendChild(indicator);
        }
        indicator?.classList.toggle("hidden", !blocked);
        if (blocked) {
            const details = TAB_ACCESS_DETAILS[name];
            button.title = `${details?.label || getTabLabel(name)} is restricted. Required: ${details?.capability || "module access"}.`;
            button.setAttribute("aria-label", `${button.dataset.accessLabel}, Restricted`);
        } else {
            button.title = button.dataset.accessTitle;
            button.setAttribute("aria-label", button.dataset.accessLabel);
        }
    });
}

/**
 * Switch between different tabs in the interface
 * @param {string} name - Tab name to switch to
 */
export function switchTab(name) {
    clearTabButtonStyles();
    hideAllSections();
    const selected = TAB_MAP[name];
    if (!selected) {
        return false;
    }

    const blocked = !canAccessTab(name);

    selected.button.classList.add("tab-active", "text-indigo-600");
    selected.button.setAttribute("aria-current", "page");
    selected.section.classList.remove("hidden");

    setTabDeniedState(name, blocked);
    applyTabAccessStyles();
    if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('portal-tab-changed', {
            detail: { name, hasAccess: !blocked }
        }));
    }
    return !blocked;
}

export function getTabAccessDetails() {
    return TAB_ACCESS_DETAILS;
}

export function setTabAccessRules(access = {}) {
    Object.keys(tabAccess).forEach((key) => {
        if (Object.prototype.hasOwnProperty.call(access, key)) {
            tabAccess[key] = Boolean(access[key]);
        } else {
            tabAccess[key] = true;
        }
    });

    Object.keys(tabAccess).forEach((name) => {
        setTabDeniedState(name, !tabAccess[name]);
    });
    applyTabAccessStyles();
}

/**
 * Toggle password visibility in input fields
 * @param {HTMLElement} passwordField - The password input field
 * @param {HTMLElement} toggleIcon - The toggle icon element
 */
export function togglePasswordVisibility(passwordField, toggleIcon) {
    passwordField.type = passwordField.type === "password" ? "text" : "password";
    toggleIcon.classList.toggle("fa-eye");
    toggleIcon.classList.toggle("fa-eye-slash");
}

/**
 * Enable/disable form inputs
 * @param {HTMLElement[]} elements - Array of form elements to enable/disable
 * @param {boolean} enabled - Whether to enable the elements
 */
export function setElementsEnabled(elements, enabled) {
    elements.forEach((el) => (el.disabled = !enabled));
}
