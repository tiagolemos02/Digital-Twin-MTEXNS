/* ======================== ORION LOGS ======================== */
/**
 * Orion Logs module - Orion API calls, logs fetching, and data processing
 * Handles device data retrieval, filtering, and rendering
 */

import { ENTITY_TYPE, sessionToken } from './config.js';
import { apiFetch } from './api-client.js';
import {
    logsTableBody, logsMessage, deviceFilter, attributeFilter
} from './dom-elements.js';
import { updateActivityFromDevices, getDeviceActivity } from './device-activity.js';
import { getRegisteredMachineEntityIds, getRegisteredMachineAttributeNames, getMachineLabel } from './inventory.js';

// In-memory storage for logs filtering
let logsGrouped = [];

function escapeHtml(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

/**
 * Attempt to decode an ASCII-hex encoded value to a readable string.
 * The MQTT simulator encodes datetime values as hex (e.g. "323032362d30342d3031" → "2026-04-01").
 * Returns the decoded string if it parses as a valid date, otherwise null.
 */
function tryDecodeHexValue(val) {
  if (typeof val !== 'string' || val.length < 4 || val.length % 2 !== 0) return null;
  if (!/^[0-9a-fA-F]+$/.test(val)) return null;
  try {
    const decoded = val.match(/.{2}/g).map(h => String.fromCharCode(parseInt(h, 16))).join('');
    if (!isNaN(Date.parse(decoded))) return decoded;
  } catch { /* ignore */ }
  return null;
}
const expandedDeviceIds = new Set(); // track by device.id
let firstLoad = true;

// helper to create safe DOM ids/classes from a device id
function safeId(s) {
    return String(s).replace(/[^A-Za-z0-9_-]/g, '_');
}

/**
 * Fetch and display logs from Orion Context Broker
 * Retrieves entity data and processes it for display
 */
export async function listLogs() {
    logsMessage.textContent = "";
    if (firstLoad) {
        logsTableBody.innerHTML =
            "<tr><td colspan='5' class='px-6 py-4 text-center'><i class='fas fa-spinner loading-spinner text-indigo-600'></i></td></tr>";
    }

    if (!sessionToken) {
        logsTableBody.innerHTML =
            "<tr><td colspan='5' class='px-6 py-4 text-center text-sm text-gray-500'>Sign in to view Orion device activity.</td></tr>";
        logsMessage.textContent = "Authentication required.";
        logsMessage.className = "mt-3 text-sm text-gray-500";
        firstLoad = true;
        return;
    }

    try {
        const t0 = performance.now();
        const resp = await apiFetch(
            `/v2/entities?type=${encodeURIComponent(ENTITY_TYPE)}&options=keyValues`
        );

        const rtt = Math.round(performance.now() - t0); // Network RTT in ms

        if (!resp.ok) {
            let detail = "";
            try {
                const txt = await resp.text();
                try { detail = JSON.parse(txt).description || txt; }
                catch { detail = txt; }
            } catch {}
            
            logsMessage.textContent = `Orion/PEP error (HTTP ${resp.status})${detail ? `: ${detail}` : ""}`;
            logsMessage.className = "mt-3 text-sm text-red-600";
            logsTableBody.innerHTML =
                "<tr><td colspan='5' class='px-6 py-4 text-center text-sm text-red-500'>Error loading logs</td></tr>";
            return;
        }

        const rawDevices = await resp.json();

        // Only show entities that were explicitly registered via the portal.
        const registeredIds = getRegisteredMachineEntityIds();

        if (!registeredIds.size) {
            logsTableBody.innerHTML =
                "<tr><td colspan='5' class='px-6 py-4 text-center text-sm text-gray-500'>No registered machines. Add machines via the Inventory tab to see data here.</td></tr>";
            firstLoad = true;
            return;
        }

        const devices = Array.isArray(rawDevices)
            ? rawDevices.filter((d) => registeredIds.has(d.id))
            : [];

        if (!devices.length) {
            logsTableBody.innerHTML =
                "<tr><td colspan='5' class='px-6 py-4 text-center text-sm text-gray-500'>No Orion data found for registered machines.</td></tr>";
            return;
        }

        const now = Date.now();
        updateActivityFromDevices(devices, { now });

        // Process and group the data
        logsGrouped = processDeviceData(devices, now);

        // Populate device filter dropdown
        populateDeviceFilter(logsGrouped);

        // If filters are active, keep them applied; otherwise render all
        const hasActiveFilter =
            (deviceFilter.value && deviceFilter.value.length) ||
            (attributeFilter.value && attributeFilter.value.trim().length);
        if (hasActiveFilter) {
            applyLogsFilter();
        } else {
            renderLogs(logsGrouped);
        }

        // Show network performance info
        logsMessage.textContent = `Network RTT: ${rtt} ms`;
        logsMessage.className = "mt-3 text-sm text-gray-600";
        firstLoad = false;

    } catch (e) {
        console.error("Error fetching logs:", e);
        logsMessage.textContent = "Network error.";
        logsMessage.className = "mt-3 text-sm text-red-600";
        logsTableBody.innerHTML =
            "<tr><td colspan='5' class='px-6 py-4 text-center text-sm text-red-500'>Network error</td></tr>";
    }
}

/**
 * Process raw device data into grouped format for display
 * @param {Array} devices - Raw device data from Orion
 * @returns {Array} Processed device data with attributes
 */
 function processDeviceData(devices, now = Date.now()) {
     const processed = [];

     devices.forEach((dev) => {
         const deviceEntry = { id: dev.id, attributes: [] };
         const allowedNames = getRegisteredMachineAttributeNames(dev.id);

         Object.entries(dev).forEach(([attr, val]) => {
             // Skip metadata fields
             if (["id", "type"].includes(attr)) return;
             if (attr.toLowerCase() === "timeinstant") return;

             // Only show attributes that were registered via the portal
             if (allowedNames && !allowedNames.has(attr)) return;

            // Extract timestamp information
            const attrTime = dev.TimeInstant ??
                (val.metadata && val.metadata.timestamp ? val.metadata.timestamp.value : null);

            const tsIso = attrTime ? new Date(attrTime).toISOString() : "-";
            const latency = attrTime ? Math.round(now - Date.parse(attrTime)) : "-";
            const rawValue = val.value !== undefined ? val.value : val;
            const decoded = tryDecodeHexValue(String(rawValue));
            const value = decoded !== null ? decoded : rawValue;

            deviceEntry.attributes.push({
                name: attr,
                value,
                time: tsIso,
                latency
             });
         });

         const activity = getDeviceActivity(deviceEntry.id, { now });
         if (activity) {
             deviceEntry.offline = activity.offline;
             deviceEntry.status = activity.status;
             deviceEntry.lastUpdateIso = activity.lastUpdateIso || "-";
             deviceEntry.lastUpdateMs = activity.lastUpdateMs ?? null;
         } else {
             deviceEntry.offline = !deviceEntry.attributes.length;
             deviceEntry.status = deviceEntry.offline ? "Offline" : "Unknown";
             deviceEntry.lastUpdateIso = "-";
             deviceEntry.lastUpdateMs = null;
         }

         if (deviceEntry.attributes.length) {
             processed.push(deviceEntry);
         }
     });

    return processed;
}

/**
 * Populate the device filter dropdown with available devices
 * @param {Array} devices - Processed device data
 */
function populateDeviceFilter(devices) {
    const prev = deviceFilter.value; // preserve current selection
    deviceFilter.innerHTML = '<option value="">All devices</option>' +
        devices.map((d) => `<option value="${d.id}">${d.id}</option>`).join("");

    // Remove duplicate options
    const seen = new Set();
    [...deviceFilter.options].forEach((option) => {
        if (seen.has(option.value)) {
            option.remove();
        } else {
            seen.add(option.value);
        }
    });

    // restore selection if it still exists
    if ([...deviceFilter.options].some(o => o.value === prev)) {
        deviceFilter.value = prev;
    }
}

/**
 * Render logs data in the table with expandable device rows
 * @param {Array} data - Processed device data to render
 */
export function renderLogs(data) {
    logsTableBody.innerHTML = "";

    if (!data.length) {
        logsTableBody.innerHTML =
            "<tr><td colspan='5' class='px-6 py-4 text-center text-sm text-gray-500'>No data</td></tr>";
        return;
    }

    data.forEach((device) => {
        // Create device header row
        const deviceRow = createDeviceRow(device);
        logsTableBody.appendChild(deviceRow);

        // Create attribute rows (initially hidden)
        device.attributes.forEach((attr) => {
            const attrRow = createAttributeRow(attr, device.id);
            // Show if previously expanded
            if (expandedDeviceIds.has(device.id)) {
                attrRow.classList.remove("hidden");
            }
            logsTableBody.appendChild(attrRow);
        });

        // Rotate arrow if expanded
        if (expandedDeviceIds.has(device.id)) {
            setTimeout(() => {
                const arrow = document.getElementById(`arrow-${safeId(device.id)}`);
                arrow?.classList.add("rotate-90");
            }, 0);
        }
    });
}

/**
 * Create a device header row
 * @param {Object} device - Device data
 * @param {number} idx - Device index
 * @returns {HTMLElement} Device row element
 */
function createDeviceRow(device) {
    const devRow = document.createElement("tr");
    devRow.classList.add("device-row", "bg-indigo-50");
    devRow.style.cursor = "pointer"; 
    const statusBadge = renderDeviceStatusBadge(device.status);
    devRow.innerHTML = `
        <td colspan="5" class="px-6 py-4 font-medium text-sm">
            <i id="arrow-${safeId(device.id)}" class="fas fa-chevron-right arrow-icon mr-2"></i>${statusBadge}<span>${escapeHtml(getMachineLabel(device.id))}</span>
        </td>`;

    // Add click handler for expand/collapse
    devRow.onclick = () => toggleDeviceAttributes(device.id);

    return devRow;
}

/**
 * Create an attribute row
 * @param {Object} attr - Attribute data
 * @param {number} idx - Device index
 * @returns {HTMLElement} Attribute row element
 */
function createAttributeRow(attr, deviceId) {
    const attrRow = document.createElement("tr");
    attrRow.classList.add(`attr-${safeId(deviceId)}`, "hidden");
    attrRow.innerHTML = `
        <td class='px-6 py-4 text-sm'></td>
        <td class='px-6 py-4 text-sm'>${attr.name}</td>
        <td class='px-6 py-4 text-sm'>${attr.value}</td>
        <td class='px-6 py-4 text-sm'>${attr.time}</td>
        <td class='px-6 py-4 text-sm'>${attr.latency}</td>`;

    return attrRow;
}

function renderDeviceStatusBadge(status) {
    const label = typeof status === "string" ? status.trim().toLowerCase() : "";
    if (label === "offline") {
        return `<span class="inline-flex items-center mr-2 px-2 py-0.5 rounded-full bg-red-100 text-red-700 text-xs font-semibold uppercase tracking-wide">Offline</span>`;
    }
    if (label === "online") {
        return `<span class="inline-flex items-center mr-2 px-2 py-0.5 rounded-full bg-green-100 text-green-700 text-xs font-semibold uppercase tracking-wide">Online</span>`;
    }
    return "";
}

/**
 * Toggle visibility of device attributes
 * @param {number} idx - Device index
 */
function toggleDeviceAttributes(deviceId) {
    const isExpanded = expandedDeviceIds.has(deviceId);
    const cls = `.attr-${safeId(deviceId)}`;
    const rows = document.querySelectorAll(cls);
    const arrow = document.getElementById(`arrow-${safeId(deviceId)}`);

    if (isExpanded) {
        rows.forEach(row => row.classList.add("hidden"));
        arrow?.classList.remove("rotate-90");
        expandedDeviceIds.delete(deviceId);
    } else {
        rows.forEach(row => row.classList.remove("hidden"));
        arrow?.classList.add("rotate-90");
        expandedDeviceIds.add(deviceId);
    }
}

/**
 * Apply filters to the logs display
 */
export function applyLogsFilter() {
    const deviceValue = deviceFilter.value;
    const attributeValue = attributeFilter.value.trim().toLowerCase();

    const filtered = logsGrouped
        .filter((device) => (!deviceValue || device.id === deviceValue))
        .map((device) => ({
            ...device,
            attributes: device.attributes.filter((attr) => 
                attr.name.toLowerCase().includes(attributeValue)
            ),
        }))
        .filter((device) => device.attributes.length);

    renderLogs(filtered);
}

/**
 * Clear all filters and show all logs
 */
export function clearLogsFilter() {
    deviceFilter.value = "";
    attributeFilter.value = "";
    renderLogs(logsGrouped);
}

/**
 * Refresh the logs data
 */
export function refreshLogsList() {
    listLogs();
}
