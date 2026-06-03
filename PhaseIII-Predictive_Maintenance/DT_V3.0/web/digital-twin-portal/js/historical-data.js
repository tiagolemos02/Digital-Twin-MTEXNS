import { ENTITY_TYPE, sessionToken } from './config.js';
import { apiFetch } from './api-client.js';
import {
  historicalDeviceSelect,
  historicalAttributeSelect,
  historicalRangeSelect,
  historicalLoadBtn,
  historicalAutoRefreshToggle,
  historicalAutoRefreshStatus,
  refreshHistorical,
  historicalChartTitle,
  historicalSampleCount,
  historicalChartSvg,
  historicalTableBody,
  historicalMessage
} from './dom-elements.js';
import { getRegisteredMachines, getMachineLabel } from './inventory.js';

let selectedEntityId = '';
const AUTO_REFRESH_MS = 5 * 1000;
let autoRefreshTimer = null;
let isHistoricalLoadRunning = false;

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function setMessage(message = '', isError = false) {
  if (!historicalMessage) return;
  historicalMessage.textContent = message;
  historicalMessage.className = `mt-3 text-sm ${isError ? 'text-red-600' : 'text-gray-600'}`;
}

function setAutoRefreshEnabled(enabled) {
  if (historicalAutoRefreshToggle) {
    historicalAutoRefreshToggle.checked = enabled;
  }
  if (historicalAutoRefreshStatus) {
    historicalAutoRefreshStatus.textContent = enabled ? 'Auto refresh on (5s)' : 'Auto refresh off';
  }
}

function stopAutoRefresh() {
  if (autoRefreshTimer) {
    clearInterval(autoRefreshTimer);
    autoRefreshTimer = null;
  }
  setAutoRefreshEnabled(false);
}

function startAutoRefresh() {
  const entityId = historicalDeviceSelect?.value || '';
  const attr = historicalAttributeSelect?.value || '';
  if (!entityId || !attr) {
    stopAutoRefresh();
    setMessage('Select a machine and telemetry attribute before enabling auto refresh.', true);
    return;
  }

  if (autoRefreshTimer) {
    clearInterval(autoRefreshTimer);
  }
  setAutoRefreshEnabled(true);
  loadHistoricalSeries();
  autoRefreshTimer = setInterval(() => {
    loadHistoricalSeries();
  }, AUTO_REFRESH_MS);
}

function setTablePlaceholder(message) {
  if (!historicalTableBody) return;
  historicalTableBody.innerHTML =
    `<tr><td colspan="2" class="px-6 py-4 text-center text-sm text-gray-500">${escapeHtml(message)}</td></tr>`;
}

function clearChart(message = 'No samples') {
  if (historicalSampleCount) historicalSampleCount.textContent = '0 samples';
  if (!historicalChartSvg) return;
  historicalChartSvg.innerHTML = `
    <rect x="0" y="0" width="640" height="220" fill="#ffffff"></rect>
    <text x="320" y="112" text-anchor="middle" fill="#6b7280" font-size="14">${escapeHtml(message)}</text>
  `;
}

function getTelemetryAttributeOptions(machine) {
  const options = [];
  const seen = new Set();

  for (const attr of machine?.attributes || []) {
    const registeredName = String(attr.name || '').trim();
    const objectIdLastSegment = attr.object_id ? String(attr.object_id).split('/').pop().trim() : '';
    const value = registeredName || objectIdLastSegment;
    if (!value || seen.has(value)) continue;

    const queryAttrs = [objectIdLastSegment, registeredName]
      .map((candidate) => String(candidate || '').trim())
      .filter(Boolean)
      .filter((candidate, index, all) => all.indexOf(candidate) === index);

    seen.add(value);
    options.push({
      value,
      label: registeredName || objectIdLastSegment,
      queryAttrs
    });
  }

  return options.sort((a, b) => a.label.localeCompare(b.label));
}

function populateMachineOptions() {
  if (!historicalDeviceSelect) return [];
  const machines = getRegisteredMachines().filter((machine) => machine.entityName);
  const previous = historicalDeviceSelect.value || selectedEntityId;

  historicalDeviceSelect.innerHTML = [
    '<option value="">Select machine</option>',
    ...machines.map((machine) =>
      `<option value="${escapeHtml(machine.entityName)}">${escapeHtml(getMachineLabel(machine.entityName))}</option>`
    )
  ].join('');

  if (machines.some((machine) => machine.entityName === previous)) {
    historicalDeviceSelect.value = previous;
  }

  selectedEntityId = historicalDeviceSelect.value;
  return machines;
}

function populateAttributeOptions(machines = getRegisteredMachines()) {
  if (!historicalAttributeSelect) return;
  const machine = machines.find((entry) => entry.entityName === historicalDeviceSelect?.value);
  const previous = historicalAttributeSelect.value;
  const attrs = getTelemetryAttributeOptions(machine);

  historicalAttributeSelect.innerHTML = [
    '<option value="">Select attribute</option>',
    ...attrs.map((attr) =>
      `<option value="${escapeHtml(attr.value)}" data-query-attrs="${escapeHtml(JSON.stringify(attr.queryAttrs))}">${escapeHtml(attr.label)}</option>`
    )
  ].join('');

  if (attrs.some((attr) => attr.value === previous)) {
    historicalAttributeSelect.value = previous;
  }
}

function getSelectedQueryAttributes() {
  const selected = historicalAttributeSelect?.selectedOptions?.[0];
  const fallback = historicalAttributeSelect?.value || '';
  if (!selected) return fallback ? [fallback] : [];

  try {
    const parsed = JSON.parse(selected.dataset.queryAttrs || '[]');
    const attrs = Array.isArray(parsed)
      ? parsed.map((candidate) => String(candidate || '').trim()).filter(Boolean)
      : [];
    return attrs.length ? attrs : (fallback ? [fallback] : []);
  } catch (_err) {
    return fallback ? [fallback] : [];
  }
}

function getRangeDates() {
  const now = new Date();
  const range = historicalRangeSelect?.value || '1h';
  const minutesByRange = {
    '15m': 15,
    '1h': 60,
    '6h': 360,
    '24h': 1440
  };
  const minutes = minutesByRange[range] || 60;
  const from = new Date(now.getTime() - minutes * 60 * 1000);
  return {
    fromDate: from.toISOString(),
    toDate: now.toISOString()
  };
}

function normalizeSeries(payload) {
  if (!payload || typeof payload !== 'object') return [];

  let index = Array.isArray(payload.index) ? payload.index : [];
  let values = Array.isArray(payload.values) ? payload.values : [];

  if (!index.length && Array.isArray(payload.attributes) && payload.attributes[0]) {
    index = Array.isArray(payload.attributes[0].index) ? payload.attributes[0].index : [];
    values = Array.isArray(payload.attributes[0].values) ? payload.attributes[0].values : [];
  }

  if (!index.length && payload.attrs && typeof payload.attrs === 'object') {
    const firstAttr = Object.values(payload.attrs)[0];
    if (firstAttr && typeof firstAttr === 'object') {
      index = Array.isArray(firstAttr.index) ? firstAttr.index : [];
      values = Array.isArray(firstAttr.values) ? firstAttr.values : [];
    }
  }

  return index.map((time, idx) => {
    const raw = values[idx];
    const value = Array.isArray(raw) ? raw[0] : raw;
    return { time, value };
  }).filter((point) => point.time !== undefined && point.value !== null && point.value !== undefined && point.value !== '');
}

function formatValue(value) {
  if (typeof value === 'number') {
    return Number.isInteger(value) ? String(value) : value.toFixed(3).replace(/0+$/, '').replace(/\.$/, '');
  }
  if (value && typeof value === 'object') {
    return JSON.stringify(value);
  }
  return String(value ?? '');
}

function renderTable(series) {
  if (!historicalTableBody) return;
  if (!series.length) {
    setTablePlaceholder('No historical samples found for this selection.');
    return;
  }

  historicalTableBody.innerHTML = series
    .slice()
    .reverse()
    .map((point) => `
      <tr>
        <td class="px-6 py-3 text-sm text-gray-700">${escapeHtml(new Date(point.time).toISOString())}</td>
        <td class="px-6 py-3 text-sm text-gray-900 font-medium">${escapeHtml(formatValue(point.value))}</td>
      </tr>
    `)
    .join('');
}

function renderChart(series) {
  if (historicalSampleCount) {
    historicalSampleCount.textContent = `${series.length} sample${series.length === 1 ? '' : 's'}`;
  }
  if (!historicalChartSvg) return;

  const numeric = series
    .map((point, index) => ({ index, value: Number(point.value) }))
    .filter((point) => Number.isFinite(point.value));

  if (numeric.length < 2) {
    clearChart(series.length ? 'Numeric chart needs at least 2 numeric samples' : 'No samples');
    return;
  }

  const width = 640;
  const height = 220;
  const padX = 42;
  const padY = 28;
  const min = Math.min(...numeric.map((point) => point.value));
  const max = Math.max(...numeric.map((point) => point.value));
  const span = max - min || 1;
  const lastIndex = Math.max(...numeric.map((point) => point.index)) || 1;
  const xFor = (idx) => padX + (idx / lastIndex) * (width - padX * 2);
  const yFor = (value) => height - padY - ((value - min) / span) * (height - padY * 2);
  const points = numeric.map((point) => `${xFor(point.index).toFixed(1)},${yFor(point.value).toFixed(1)}`).join(' ');

  historicalChartSvg.innerHTML = `
    <rect x="0" y="0" width="${width}" height="${height}" fill="#ffffff"></rect>
    <line x1="${padX}" y1="${height - padY}" x2="${width - padX}" y2="${height - padY}" stroke="#e5e7eb"></line>
    <line x1="${padX}" y1="${padY}" x2="${padX}" y2="${height - padY}" stroke="#e5e7eb"></line>
    <text x="8" y="${padY + 4}" fill="#6b7280" font-size="12">${escapeHtml(formatValue(max))}</text>
    <text x="8" y="${height - padY + 4}" fill="#6b7280" font-size="12">${escapeHtml(formatValue(min))}</text>
    <polyline fill="none" stroke="#4f46e5" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" points="${points}"></polyline>
    ${numeric.map((point) => `<circle cx="${xFor(point.index).toFixed(1)}" cy="${yFor(point.value).toFixed(1)}" r="2.5" fill="#4f46e5"></circle>`).join('')}
  `;
}

export function refreshHistoricalData() {
  if (!sessionToken) {
    setTablePlaceholder('Sign in to view historical data.');
    clearChart('Authentication required');
    setMessage('Authentication required.', true);
    return;
  }

  const machines = populateMachineOptions();
  populateAttributeOptions(machines);

  if (!machines.length) {
    setTablePlaceholder('No registered machines. Add machines via the Inventory tab first.');
    clearChart('No registered machines');
    setMessage('');
    return;
  }

  if (!historicalDeviceSelect?.value) {
    setTablePlaceholder('Select a machine and attribute.');
    clearChart('Select a machine');
  }
}

export async function loadHistoricalSeries() {
  if (isHistoricalLoadRunning) return;
  isHistoricalLoadRunning = true;
  refreshHistoricalData();

  const entityId = historicalDeviceSelect?.value || '';
  const attr = historicalAttributeSelect?.value || '';
  if (!entityId || !attr) {
    setMessage('Select a machine and telemetry attribute.', true);
    isHistoricalLoadRunning = false;
    return;
  }

  const machineLabel = getMachineLabel(entityId);
  if (historicalChartTitle) {
    historicalChartTitle.textContent = `${machineLabel} - ${attr}`;
  }

  setMessage('Loading historical data...');
  setTablePlaceholder('Loading...');
  clearChart('Loading...');

  const { fromDate, toDate } = getRangeDates();
  const params = new URLSearchParams({
    type: ENTITY_TYPE,
    fromDate,
    toDate,
    lastN: '500'
  });
  const queryAttrs = getSelectedQueryAttributes();

  try {
    let payload = null;
    let usedAttr = attr;
    let lastError = null;

    for (const queryAttr of queryAttrs) {
      const path = `/quantumleap/v2/entities/${encodeURIComponent(entityId)}/attrs/${encodeURIComponent(queryAttr)}?${params.toString()}`;
      const resp = await apiFetch(path);
      const bodyText = await resp.text().catch(() => '');

      if (resp.ok) {
        payload = bodyText ? JSON.parse(bodyText) : {};
        usedAttr = queryAttr;
        break;
      }

      const isEmptyQuantumLeapResult =
        resp.status === 404 && /No records were found for such query/i.test(bodyText);
      if (isEmptyQuantumLeapResult) {
        continue;
      }

      lastError = new Error(`QuantumLeap error (HTTP ${resp.status})${bodyText ? `: ${bodyText}` : ''}`);
      break;
    }

    if (lastError) {
      throw lastError;
    }

    if (!payload) {
      renderChart([]);
      renderTable([]);
      setMessage('No historical samples found for this selection. Historical data is only available after the QuantumLeap subscription receives new Orion updates.');
      return;
    }

    const series = normalizeSeries(payload);
    renderChart(series);
    renderTable(series);
    setMessage(series.length
      ? `Loaded ${series.length} historical samples${usedAttr !== attr ? ` using stored attribute ${usedAttr}.` : '.'}`
      : 'No historical samples found.');
  } catch (error) {
    console.error('Historical data load failed:', error);
    clearChart('Unable to load history');
    setTablePlaceholder('Unable to load historical data.');
    setMessage(error.message || 'Unable to load historical data.', true);
  } finally {
    isHistoricalLoadRunning = false;
  }
}

export function initHistoricalData() {
  historicalDeviceSelect?.addEventListener('change', () => {
    selectedEntityId = historicalDeviceSelect.value;
    populateAttributeOptions();
    setMessage('');
    stopAutoRefresh();
  });
  historicalAttributeSelect?.addEventListener('change', () => {
    setMessage('');
    stopAutoRefresh();
  });
  historicalRangeSelect?.addEventListener('change', () => {
    setMessage('');
    stopAutoRefresh();
  });
  historicalLoadBtn?.addEventListener('click', loadHistoricalSeries);
  historicalAutoRefreshToggle?.addEventListener('change', () => {
    if (historicalAutoRefreshToggle.checked) {
      startAutoRefresh();
    } else {
      stopAutoRefresh();
    }
  });
  refreshHistorical?.addEventListener('click', loadHistoricalSeries);
  refreshHistoricalData();
}
