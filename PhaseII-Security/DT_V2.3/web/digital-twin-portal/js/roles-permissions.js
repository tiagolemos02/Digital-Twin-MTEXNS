import { KEYROCK_BFF_BASE, KEYROCK_CLIENT_ID, sessionToken } from "./config.js";
import { listUsers } from "./users.js";
import {
  refreshRolesPermissions, rolesPermissionsMessage, createRoleForm, roleName, btnCreateRole, roleCreateMsg,
  createPermissionForm, permissionName, permissionDescription, permissionAction, permissionResource,
  permissionIsRegex, permissionAuthHeader, permissionUseAuthHeader, permissionXml, permissionAssignRole,
  permissionEditId, permissionFormTitle, btnCreatePermission, btnCancelPermissionEdit, permissionCreateMsg,
  btnDeletePermissionGlobal, permissionEditorModal, permissionEditorClose,
  rolesTableBody, rolePermissionsPanel, rolePermissionsTitle, closeRolePermissions, rolePermissionAssignSelect,
  btnAssignPermissionToRole, btnListAllPermissions,
  rolePermissionsTableBody, rolePermissionsDetailMsg, allPermissionsModal, allPermissionsClose,
  allPermissionsTableBody, allPermissionsMsg, roleAssignmentsTableBody,
  roleAssignmentsMsg, permissionXmlHelpBtn, xacmlHelpModal, xacmlHelpClose
} from "./dom-elements.js";

let initialized = false;
let roles = [];
let permissions = [];
let users = [];
let roleAssignments = new Map();
let selectedRoleId = "";
let selectedRolePermissions = [];
let permissionEditorSource = "";

const esc = (v) => String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
const roleById = (id) => roles.find((r) => r.id === id) || null;
const permById = (id) => permissions.find((p) => p.id === id) || null;
const headers = (extra = {}) => ({ Accept: "application/json", ...extra });
function msg(el, text, type = "error") { if (!el) return; el.textContent = text || ""; el.classList.remove("text-red-600", "text-green-600"); el.classList.add(type === "success" ? "text-green-600" : "text-red-600"); }
const clr = (el) => msg(el, "");

async function keyrockFetch(path, { method = "GET", headers: extraHeaders = {}, body } = {}) {
  const init = {
    method,
    headers: headers(extraHeaders),
    credentials: "include"
  };
  if (body !== undefined) {
    init.body = body;
  }
  return fetch(`${KEYROCK_BFF_BASE}${path}`, init);
}

async function respErr(resp, fallback) {
  const text = await resp.text().catch(() => "");
  if (text) {
    try {
      const j = JSON.parse(text);
      return `${fallback}: ${j?.error?.message || j?.message || text}`;
    } catch (_e) {
      return `${fallback}: ${text}`;
    }
  }
  return `${fallback} (HTTP ${resp.status})`;
}

async function getList(path, key) {
  const resp = await keyrockFetch(path, { method: "GET" });
  if (resp.status === 404) return [];
  if (!resp.ok) throw new Error(await respErr(resp, "Keyrock request failed"));
  const txt = await resp.text().catch(() => "");
  if (!txt) return [];
  try {
    const j = JSON.parse(txt);
    return Array.isArray(j[key]) ? j[key] : [];
  } catch (_e) {
    return [];
  }
}

async function apiCreateRole(name) {
  const resp = await keyrockFetch(`/v1/applications/${KEYROCK_CLIENT_ID}/roles`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ role: { name } })
  });
  if (!resp.ok) throw new Error(await respErr(resp, "Unable to create role"));
}

async function apiDeleteRole(roleId) {
  const resp = await keyrockFetch(`/v1/applications/${KEYROCK_CLIENT_ID}/roles/${roleId}`, {
    method: "DELETE",
    headers: { "Content-Type": "application/json" }
  });
  if (!resp.ok) throw new Error(await respErr(resp, "Unable to delete role"));
}

async function apiCreatePermission(permission) {
  const resp = await keyrockFetch(`/v1/applications/${KEYROCK_CLIENT_ID}/permissions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ permission })
  });
  if (!resp.ok) throw new Error(await respErr(resp, "Unable to create permission"));
  const j = await resp.json().catch(() => ({}));
  return j.permission || null;
}

async function apiUpdatePermission(permissionId, permission) {
  const resp = await keyrockFetch(`/v1/applications/${KEYROCK_CLIENT_ID}/permissions/${permissionId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ permission })
  });
  if (!resp.ok) throw new Error(await respErr(resp, "Unable to update permission"));
}

async function apiDeletePermission(permissionId) {
  const resp = await keyrockFetch(`/v1/applications/${KEYROCK_CLIENT_ID}/permissions/${permissionId}`, {
    method: "DELETE",
    headers: { "Content-Type": "application/json" }
  });
  if (!resp.ok) throw new Error(await respErr(resp, "Unable to delete permission"));
}

async function apiAssignPermission(roleId, permissionId) {
  const resp = await keyrockFetch(`/v1/applications/${KEYROCK_CLIENT_ID}/roles/${roleId}/permissions/${permissionId}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" }
  });
  if (!(resp.ok || resp.status === 409)) throw new Error(await respErr(resp, "Unable to assign permission"));
}

async function apiUnassignPermission(roleId, permissionId) {
  const resp = await keyrockFetch(`/v1/applications/${KEYROCK_CLIENT_ID}/roles/${roleId}/permissions/${permissionId}`, {
    method: "DELETE",
    headers: { "Content-Type": "application/json" }
  });
  if (!(resp.ok || resp.status === 404)) throw new Error(await respErr(resp, "Unable to remove permission from role"));
}

async function apiAssignRole(userId, roleId) {
  const resp = await keyrockFetch(`/v1/applications/${KEYROCK_CLIENT_ID}/users/${userId}/roles/${roleId}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" }
  });
  if (!(resp.ok || resp.status === 409)) throw new Error(await respErr(resp, "Unable to assign role"));
}

async function apiRemoveRole(userId, roleId) {
  const resp = await keyrockFetch(`/v1/applications/${KEYROCK_CLIENT_ID}/users/${userId}/roles/${roleId}`, {
    method: "DELETE",
    headers: { "Content-Type": "application/json" }
  });
  if (!(resp.ok || resp.status === 404)) throw new Error(await respErr(resp, "Unable to remove role"));
}

async function apiDeleteUser(userId) {
  const resp = await keyrockFetch(`/v1/users/${userId}`, {
    method: "DELETE",
    headers: { "Content-Type": "application/json" }
  });
  if (!resp.ok) throw new Error(await respErr(resp, "Unable to delete user"));
}

function resetPermissionForm() {
  if (createPermissionForm) createPermissionForm.reset();
  if (permissionEditId) permissionEditId.value = "";
  if (permissionFormTitle) permissionFormTitle.textContent = "Create Permission";
  if (btnCreatePermission) btnCreatePermission.textContent = "Save Permission";
  if (btnDeletePermissionGlobal) btnDeletePermissionGlobal.classList.add("hidden");
}

function fillPermissionForm(permission) {
  if (!permission) return;
  if (permissionEditId) permissionEditId.value = permission.id || "";
  if (permissionFormTitle) permissionFormTitle.textContent = "Edit Permission";
  if (btnCreatePermission) btnCreatePermission.textContent = "Update Permission";
  if (btnDeletePermissionGlobal) btnDeletePermissionGlobal.classList.remove("hidden");
  if (permissionName) permissionName.value = permission.name || "";
  if (permissionDescription) permissionDescription.value = permission.description || "";
  if (permission.xml) {
    if (permissionXml) permissionXml.value = permission.xml;
    if (permissionAction) permissionAction.value = "";
    if (permissionResource) permissionResource.value = "";
    if (permissionIsRegex) permissionIsRegex.checked = false;
    if (permissionUseAuthHeader) permissionUseAuthHeader.checked = false;
    if (permissionAuthHeader) permissionAuthHeader.value = "";
  } else {
    if (permissionXml) permissionXml.value = "";
    if (permissionAction) permissionAction.value = permission.action || "";
    if (permissionResource) permissionResource.value = permission.resource || "";
    if (permissionIsRegex) permissionIsRegex.checked = Boolean(permission.is_regex);
    if (permissionUseAuthHeader) permissionUseAuthHeader.checked = Boolean(permission.use_authorization_service_header);
    if (permissionAuthHeader) permissionAuthHeader.value = permission.authorization_service_header || "";
  }
  if (permissionAssignRole && selectedRoleId) permissionAssignRole.value = selectedRoleId;
}

function openPermissionModal() {
  if (!permissionEditorModal) return;
  permissionEditorModal.classList.remove("hidden");
  permissionEditorModal.classList.add("flex");
}

function closePermissionModal() {
  if (!permissionEditorModal) return;
  permissionEditorModal.classList.add("hidden");
  permissionEditorModal.classList.remove("flex");
}

function openAllPermissionsModal() {
  if (!allPermissionsModal) return;
  allPermissionsModal.classList.remove("hidden");
  allPermissionsModal.classList.add("flex");
}

function closeAllPermissionsModal() {
  if (!allPermissionsModal) return;
  allPermissionsModal.classList.add("hidden");
  allPermissionsModal.classList.remove("flex");
}

function restoreAllPermissionsModalIfNeeded(successMessage = "") {
  if (permissionEditorSource !== "allPermissions") {
    permissionEditorSource = "";
    return;
  }
  renderAllPermissionsModal();
  if (successMessage) msg(allPermissionsMsg, successMessage, "success");
  openAllPermissionsModal();
  permissionEditorSource = "";
}

function renderAllPermissionsModal() {
  if (!allPermissionsTableBody) return;
  if (!permissions.length) {
    allPermissionsTableBody.innerHTML =
      "<tr><td colspan='4' class='px-4 py-3 text-center text-sm text-gray-500'>No permissions found.</td></tr>";
    return;
  }

  allPermissionsTableBody.innerHTML = permissions.map((p) => {
    const hasXml = Boolean(p.xml);
    const action = hasXml ? "XACML" : (p.action || "-");
    const resource = hasXml
      ? "<span class='text-xs text-indigo-700 font-medium'>Advanced XACML rule configured</span>"
      : `<code class='text-xs text-gray-700'>${esc(p.resource || "-")}</code>`;

    return `<tr>
      <td class='px-4 py-3 text-sm'>
        <div class='font-medium text-gray-800'>${esc(p.name)}</div>
        <div class='text-xs text-gray-500'>${esc(p.description || "")}</div>
      </td>
      <td class='px-4 py-3 text-sm whitespace-nowrap'>${esc(action)}</td>
      <td class='px-4 py-3 text-sm'>${resource}</td>
      <td class='px-4 py-3 text-right text-sm whitespace-nowrap'>
        <button type='button' class='edit-all-permission-btn text-indigo-600 hover:text-indigo-800 font-medium mr-3' data-permission-id='${esc(p.id)}'>Edit</button>
        <button type='button' class='delete-all-permission-btn bg-red-600 hover:bg-red-700 text-white text-xs px-3 py-1 rounded-md' data-permission-id='${esc(p.id)}' data-permission-name='${esc(p.name || p.id)}'>Delete</button>
      </td>
    </tr>`;
  }).join("");
}

function buildPermissionPayload() {
  const name = permissionName?.value.trim() || "";
  const description = permissionDescription?.value.trim() || "";
  const action = permissionAction?.value.trim() || "";
  const resource = permissionResource?.value.trim() || "";
  const xml = permissionXml?.value.trim() || "";
  const useHeader = Boolean(permissionUseAuthHeader?.checked);
  const header = permissionAuthHeader?.value.trim() || "";
  const isRegex = Boolean(permissionIsRegex?.checked);
  if (!name) throw new Error("Permission name is required.");
  if (xml) {
    if (action || resource || useHeader || header) {
      throw new Error("When using XACML, leave action/resource/header fields empty.");
    }
    return { name, ...(description && { description }), xml, is_regex: false, use_authorization_service_header: false, authorization_service_header: null };
  }
  if (!action || !resource) throw new Error("Set HTTP action and resource rule, or provide XACML.");
  if (useHeader && !header) throw new Error("Authorization service header is required when enabled.");
  if (!useHeader && header) throw new Error("Enable 'Use authorization service header' to send this header.");
  return {
    name,
    ...(description && { description }),
    action,
    resource,
    is_regex: isRegex,
    use_authorization_service_header: useHeader,
    authorization_service_header: useHeader ? header : null
  };
}

function renderRoleOptions() {
  if (!permissionAssignRole) return;
  permissionAssignRole.innerHTML = "<option value=''>Do not assign now</option>";
  roles.forEach((r) => {
    const o = document.createElement("option");
    o.value = r.id;
    o.textContent = r.name || r.id;
    permissionAssignRole.appendChild(o);
  });
}

function renderRolesTable() {
  if (!rolesTableBody) return;
  if (!roles.length) {
    rolesTableBody.innerHTML = "<tr><td colspan='2' class='px-4 py-3 text-center text-sm text-gray-500'>No roles found.</td></tr>";
    return;
  }
  rolesTableBody.innerHTML = roles.map((r) => {
    const selected = r.id === selectedRoleId;
    return `<tr class='${selected ? "bg-indigo-50" : ""}'>
      <td class='px-4 py-3 text-sm'>
        <button type='button' class='role-select-btn w-full text-left' data-role-id='${esc(r.id)}'>
          <span class='block text-xs text-gray-500'>ID: ${esc(r.id)}</span>
          <span class='block text-sm font-semibold text-gray-800'>${esc(r.name || r.id)}</span>
        </button>
      </td>
      <td class='px-4 py-3 text-right text-sm'>
        <button type='button' class='delete-role-btn bg-red-600 hover:bg-red-700 text-white text-xs px-3 py-1 rounded-md' data-role-id='${esc(r.id)}' data-role-name='${esc(r.name || r.id)}'>Delete role</button>
      </td>
    </tr>`;
  }).join("");
}

function renderUsersRoleTable() {
  if (!roleAssignmentsTableBody) return;
  if (!users.length) {
    roleAssignmentsTableBody.innerHTML = "<tr><td colspan='4' class='px-4 py-3 text-center text-sm text-gray-500'>No users found.</td></tr>";
    return;
  }
  const roleMap = new Map(roles.map((r) => [r.id, r.name || r.id]));
  const roleOpts = roles.map((r) => `<option value='${esc(r.id)}'>${esc(r.name || r.id)}</option>`).join("");
  roleAssignmentsTableBody.innerHTML = users.map((u) => {
    const assigned = (roleAssignments.get(u.id) || []).map((rid) => ({ id: rid, name: roleMap.get(rid) || rid }));
    const badges = assigned.length
      ? assigned.map((r) => `<span class='inline-flex items-center bg-indigo-50 text-indigo-700 text-xs px-2 py-1 rounded-full mr-1 mb-1'>${esc(r.name)}<button type='button' class='remove-role-btn ml-1 text-indigo-700 hover:text-indigo-900' data-user-id='${esc(u.id)}' data-role-id='${esc(r.id)}'>&times;</button></span>`).join("")
      : "<span class='text-xs text-gray-500'>No roles assigned</span>";
    return `<tr>
      <td class='px-4 py-3 text-sm'><div class='font-medium text-gray-800'>${esc(u.username || u.id)}</div><div class='text-xs text-gray-500'>${esc(u.email || "")}</div></td>
      <td class='px-4 py-3 text-sm'>${badges}</td>
      <td class='px-4 py-3 text-sm'><div class='flex items-center gap-2'><select class='assign-role-select px-2 py-1 border border-gray-300 rounded-md text-sm' data-user-id='${esc(u.id)}'><option value=''>Select role</option>${roleOpts}</select><button type='button' class='assign-role-btn bg-indigo-600 hover:bg-indigo-700 text-white text-xs px-3 py-1 rounded-md' data-user-id='${esc(u.id)}'>Assign</button></div></td>
      <td class='px-4 py-3 text-sm text-right'><button type='button' class='delete-user-btn bg-red-600 hover:bg-red-700 text-white text-xs px-3 py-1 rounded-md' data-user-id='${esc(u.id)}' data-username='${esc(u.username || u.id)}'>Delete user</button></td>
    </tr>`;
  }).join("");
}

function renderRolePermissionAssignSelect() {
  if (!rolePermissionAssignSelect) return;
  rolePermissionAssignSelect.innerHTML = "<option value=''>Select permission</option>";
  if (!selectedRoleId) return;
  const assigned = new Set(selectedRolePermissions.map((p) => p.id));
  const available = permissions.filter((p) => !assigned.has(p.id));
  if (!available.length) {
    rolePermissionAssignSelect.innerHTML = "<option value=''>No available permissions</option>";
    return;
  }
  available.forEach((p) => {
    const o = document.createElement("option");
    o.value = p.id;
    o.textContent = p.name || p.id;
    rolePermissionAssignSelect.appendChild(o);
  });
}

function renderRolePermissionsPanel() {
  if (!rolePermissionsPanel || !rolePermissionsTableBody || !rolePermissionsTitle) return;
  const createBtnHtml = `
    <button
      type='button'
      class='create-permission-inline-btn inline-flex items-center rounded-md border border-indigo-300 px-3 py-1 text-xs font-semibold text-indigo-600 hover:bg-indigo-50 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2'
    >
      <i class='fas fa-plus mr-1'></i>Create new permission
    </button>`;

  if (!selectedRoleId) {
    rolePermissionsPanel.classList.remove("hidden");
    rolePermissionsTitle.textContent = "Select a role";
    rolePermissionsTableBody.innerHTML = "<tr><td colspan='4' class='px-4 py-3 text-center text-sm text-gray-500'>No role selected.</td></tr>";
    return;
  }
  rolePermissionsPanel.classList.remove("hidden");
  rolePermissionsTitle.textContent = `Permissions assigned to ${roleById(selectedRoleId)?.name || selectedRoleId}`;
  if (!selectedRolePermissions.length) {
    rolePermissionsTableBody.innerHTML = `
      <tr>
        <td colspan='4' class='px-4 py-3 text-center text-sm text-gray-500'>
          <div>No permissions assigned to this role.</div>
          <div class='mt-3'>${createBtnHtml}</div>
        </td>
      </tr>`;
    return;
  }
  const permissionRowsHtml = selectedRolePermissions.map((p) => {
    const hasXml = Boolean(p.xml);
    const act = hasXml ? "XACML" : p.action || "-";
    const res = hasXml ? "<span class='text-xs text-indigo-700 font-medium'>Advanced XACML rule configured</span>" : `<code class='text-xs text-gray-700'>${esc(p.resource || "-")}</code>`;
    return `<tr>
      <td class='px-4 py-3 text-sm'><div class='font-medium text-gray-800'>${esc(p.name)}</div><div class='text-xs text-gray-500'>${esc(p.description || "")}</div></td>
      <td class='px-4 py-3 text-sm whitespace-nowrap'>${esc(act)}</td>
      <td class='px-4 py-3 text-sm'>${res}</td>
      <td class='px-4 py-3 text-right text-sm whitespace-nowrap'><button type='button' class='edit-permission-btn text-indigo-600 hover:text-indigo-800 font-medium mr-3' data-permission-id='${esc(p.id)}'>Edit</button><button type='button' class='delete-permission-btn bg-red-600 hover:bg-red-700 text-white text-xs px-3 py-1 rounded-md' data-permission-id='${esc(p.id)}' data-permission-name='${esc(p.name || p.id)}'>Delete</button></td>
    </tr>`;
  }).join("");

  rolePermissionsTableBody.innerHTML = `
    ${permissionRowsHtml}
    <tr>
      <td colspan='4' class='px-4 py-3 text-center'>${createBtnHtml}</td>
    </tr>`;
}

async function loadSelectedRolePermissions() {
  if (!selectedRoleId) {
    selectedRolePermissions = [];
    renderRolePermissionsPanel();
    renderRolePermissionAssignSelect();
    return;
  }
  if (rolePermissionsTableBody) {
    rolePermissionsTableBody.innerHTML = "<tr><td colspan='4' class='px-4 py-3 text-center'><i class='fas fa-spinner loading-spinner text-indigo-600'></i></td></tr>";
  }
  try {
    selectedRolePermissions = await getList(`/v1/applications/${KEYROCK_CLIENT_ID}/roles/${selectedRoleId}/permissions`, "role_permission_assignments");
    renderRolePermissionsPanel();
    renderRolePermissionAssignSelect();
  } catch (e) {
    selectedRolePermissions = [];
    renderRolePermissionsPanel();
    renderRolePermissionAssignSelect();
    msg(rolePermissionsDetailMsg, e.message || "Unable to load permissions for this role.");
  }
}

async function toggleRole(roleId) {
  clr(rolePermissionsDetailMsg);
  if (selectedRoleId === roleId) {
    selectedRoleId = "";
    selectedRolePermissions = [];
    renderRolesTable();
    renderRolePermissionsPanel();
    renderRolePermissionAssignSelect();
    return;
  }
  selectedRoleId = roleId;
  renderRolesTable();
  renderRolePermissionsPanel();
  await loadSelectedRolePermissions();
}

export async function handleCreateRole() {
  clr(roleCreateMsg);
  clr(rolesPermissionsMessage);
  const name = roleName?.value.trim() || "";
  if (!name) {
    msg(roleCreateMsg, "Role name is required.");
    return;
  }
  try {
    await apiCreateRole(name);
    if (createRoleForm) createRoleForm.reset();
    msg(roleCreateMsg, "Role created successfully.", "success");
    await refreshRolesPermissionsData();
  } catch (e) {
    msg(roleCreateMsg, e.message || "Failed to create role.");
  }
}

export async function handleCreatePermission() {
  clr(permissionCreateMsg);
  clr(rolesPermissionsMessage);
  clr(rolePermissionsDetailMsg);
  const returnToAllPermissions = permissionEditorSource === "allPermissions";
  let payload;
  try {
    payload = buildPermissionPayload();
  } catch (e) {
    msg(permissionCreateMsg, e.message || "Invalid permission form values.");
    return;
  }
  const editId = permissionEditId?.value || "";
  const assignRoleId = permissionAssignRole?.value || "";
  try {
    if (editId) {
      await apiUpdatePermission(editId, payload);
      msg(permissionCreateMsg, "Permission updated successfully.", "success");
    } else {
      const created = await apiCreatePermission(payload);
      if (assignRoleId && created?.id) await apiAssignPermission(assignRoleId, created.id);
      if (assignRoleId) selectedRoleId = assignRoleId;
      msg(permissionCreateMsg, "Permission created successfully.", "success");
    }
    resetPermissionForm();
    closePermissionModal();
    await refreshRolesPermissionsData();
    if (returnToAllPermissions) {
      restoreAllPermissionsModalIfNeeded(editId ? "Permission updated successfully." : "Permission created successfully.");
    } else {
      permissionEditorSource = "";
    }
  } catch (e) {
    msg(permissionCreateMsg, e.message || "Failed to save permission.");
  }
}

function bindRolesTable() {
  if (!rolesTableBody || rolesTableBody.dataset.bound === "true") return;
  rolesTableBody.addEventListener("click", async (event) => {
    const toggle = event.target.closest(".role-select-btn");
    if (toggle) {
      const roleId = toggle.dataset.roleId || "";
      if (roleId) await toggleRole(roleId);
      return;
    }
    const del = event.target.closest(".delete-role-btn");
    if (del) {
      const roleId = del.dataset.roleId || "";
      const roleLabel = del.dataset.roleName || roleId;
      if (!roleId) return;
      if (!window.confirm(`Delete role "${roleLabel}"?`)) return;
      try {
        await apiDeleteRole(roleId);
        if (selectedRoleId === roleId) {
          selectedRoleId = "";
          selectedRolePermissions = [];
        }
        msg(rolesPermissionsMessage, "Role deleted successfully.", "success");
        await refreshRolesPermissionsData();
      } catch (e) {
        msg(rolesPermissionsMessage, e.message || "Failed to delete role.");
      }
    }
  });
  rolesTableBody.dataset.bound = "true";
}

function bindRolePermissionsPanel() {
  if (rolePermissionsTableBody && rolePermissionsTableBody.dataset.bound !== "true") {
    rolePermissionsTableBody.addEventListener("click", async (event) => {
      const createInline = event.target.closest(".create-permission-inline-btn");
      if (createInline) {
        permissionEditorSource = "";
        resetPermissionForm();
        if (permissionAssignRole) permissionAssignRole.value = selectedRoleId;
        clr(permissionCreateMsg);
        openPermissionModal();
        return;
      }
      const edit = event.target.closest(".edit-permission-btn");
      if (edit) {
        const pid = edit.dataset.permissionId || "";
        const p = selectedRolePermissions.find((x) => x.id === pid) || permById(pid);
        if (!p) {
          msg(rolePermissionsDetailMsg, "Permission details not found.");
          return;
        }
        permissionEditorSource = "";
        clr(permissionCreateMsg);
        fillPermissionForm(p);
        openPermissionModal();
        return;
      }
      const del = event.target.closest(".delete-permission-btn");
      if (del) {
        const pid = del.dataset.permissionId || "";
        const label = del.dataset.permissionName || pid;
        if (!pid) return;
        if (!window.confirm(`Remove permission "${label}" from this role?`)) return;
        try {
          await apiUnassignPermission(selectedRoleId, pid);
          msg(rolePermissionsDetailMsg, "Permission removed from role.", "success");
          await refreshRolesPermissionsData();
        } catch (e) {
          msg(rolePermissionsDetailMsg, e.message || "Failed to remove permission from role.");
        }
      }
    });
    rolePermissionsTableBody.dataset.bound = "true";
  }

  if (btnAssignPermissionToRole && btnAssignPermissionToRole.dataset.bound !== "true") {
    btnAssignPermissionToRole.addEventListener("click", async () => {
      clr(rolePermissionsDetailMsg);
      if (!selectedRoleId) {
        msg(rolePermissionsDetailMsg, "Select a role first.");
        return;
      }
      const pid = rolePermissionAssignSelect?.value || "";
      if (!pid) {
        msg(rolePermissionsDetailMsg, "Select a permission to assign.");
        return;
      }
      try {
        await apiAssignPermission(selectedRoleId, pid);
        msg(rolePermissionsDetailMsg, "Permission assigned successfully.", "success");
        await refreshRolesPermissionsData();
      } catch (e) {
        msg(rolePermissionsDetailMsg, e.message || "Failed to assign permission.");
      }
    });
    btnAssignPermissionToRole.dataset.bound = "true";
  }

  if (closeRolePermissions && closeRolePermissions.dataset.bound !== "true") {
    closeRolePermissions.addEventListener("click", () => {
      selectedRoleId = "";
      selectedRolePermissions = [];
      clr(rolePermissionsDetailMsg);
      renderRolesTable();
      renderRolePermissionsPanel();
      renderRolePermissionAssignSelect();
    });
    closeRolePermissions.dataset.bound = "true";
  }
}

function bindRoleAssignments() {
  if (!roleAssignmentsTableBody || roleAssignmentsTableBody.dataset.bound === "true") return;
  roleAssignmentsTableBody.addEventListener("click", async (event) => {
    const assign = event.target.closest(".assign-role-btn");
    if (assign) {
      const userId = assign.dataset.userId || "";
      const sel = roleAssignmentsTableBody.querySelector(`.assign-role-select[data-user-id="${userId}"]`);
      const roleId = sel?.value || "";
      clr(roleAssignmentsMsg);
      if (!roleId) {
        msg(roleAssignmentsMsg, "Select a role before assigning.");
        return;
      }
      try {
        await apiAssignRole(userId, roleId);
        msg(roleAssignmentsMsg, "Role assigned successfully.", "success");
        await refreshRolesPermissionsData();
      } catch (e) {
        msg(roleAssignmentsMsg, e.message || "Failed to assign role.");
      }
      return;
    }

    const remove = event.target.closest(".remove-role-btn");
    if (remove) {
      const userId = remove.dataset.userId || "";
      const roleId = remove.dataset.roleId || "";
      clr(roleAssignmentsMsg);
      try {
        await apiRemoveRole(userId, roleId);
        msg(roleAssignmentsMsg, "Role removed successfully.", "success");
        await refreshRolesPermissionsData();
      } catch (e) {
        msg(roleAssignmentsMsg, e.message || "Failed to remove role.");
      }
      return;
    }

    const delUser = event.target.closest(".delete-user-btn");
    if (delUser) {
      const userId = delUser.dataset.userId || "";
      const label = delUser.dataset.username || userId;
      clr(roleAssignmentsMsg);
      if (!window.confirm(`Delete user "${label}"? This cannot be undone.`)) return;
      try {
        await apiDeleteUser(userId);
        msg(roleAssignmentsMsg, "User deleted successfully.", "success");
        await Promise.all([refreshRolesPermissionsData(), listUsers()]);
      } catch (e) {
        msg(roleAssignmentsMsg, e.message || "Failed to delete user.");
      }
    }
  });
  roleAssignmentsTableBody.dataset.bound = "true";
}

function bindPermissionEditor() {
  if (permissionEditorClose && permissionEditorClose.dataset.bound !== "true") {
    permissionEditorClose.addEventListener("click", () => {
      permissionEditorSource = "";
      clr(permissionCreateMsg);
      resetPermissionForm();
      closePermissionModal();
    });
    permissionEditorClose.dataset.bound = "true";
  }

  if (permissionEditorModal && permissionEditorModal.dataset.bound !== "true") {
    permissionEditorModal.addEventListener("click", (event) => {
      if (event.target === permissionEditorModal) {
        permissionEditorSource = "";
        clr(permissionCreateMsg);
        resetPermissionForm();
        closePermissionModal();
      }
    });
    permissionEditorModal.dataset.bound = "true";
  }

  if (btnCancelPermissionEdit && btnCancelPermissionEdit.dataset.bound !== "true") {
    btnCancelPermissionEdit.addEventListener("click", () => {
      permissionEditorSource = "";
      clr(permissionCreateMsg);
      resetPermissionForm();
      closePermissionModal();
    });
    btnCancelPermissionEdit.dataset.bound = "true";
  }

  if (btnDeletePermissionGlobal && btnDeletePermissionGlobal.dataset.bound !== "true") {
    btnDeletePermissionGlobal.addEventListener("click", async () => {
      const returnToAllPermissions = permissionEditorSource === "allPermissions";
      const pid = permissionEditId?.value || "";
      if (!pid) return;
      const p = permById(pid) || selectedRolePermissions.find((x) => x.id === pid);
      const label = p?.name || pid;
      if (!window.confirm(`Delete permission "${label}" globally?`)) return;
      try {
        await apiDeletePermission(pid);
        msg(permissionCreateMsg, "Permission deleted.", "success");
        resetPermissionForm();
        closePermissionModal();
        await refreshRolesPermissionsData();
        if (returnToAllPermissions) {
          restoreAllPermissionsModalIfNeeded("Permission deleted successfully.");
        } else {
          permissionEditorSource = "";
        }
      } catch (e) {
        msg(permissionCreateMsg, e.message || "Failed to delete permission.");
      }
    });
    btnDeletePermissionGlobal.dataset.bound = "true";
  }
}

function bindAllPermissionsModal() {
  if (btnListAllPermissions && btnListAllPermissions.dataset.bound !== "true") {
    btnListAllPermissions.addEventListener("click", () => {
      clr(allPermissionsMsg);
      renderAllPermissionsModal();
      openAllPermissionsModal();
    });
    btnListAllPermissions.dataset.bound = "true";
  }

  if (allPermissionsClose && allPermissionsClose.dataset.bound !== "true") {
    allPermissionsClose.addEventListener("click", closeAllPermissionsModal);
    allPermissionsClose.dataset.bound = "true";
  }

  if (allPermissionsModal && allPermissionsModal.dataset.bound !== "true") {
    allPermissionsModal.addEventListener("click", (event) => {
      if (event.target === allPermissionsModal) {
        closeAllPermissionsModal();
      }
    });
    allPermissionsModal.dataset.bound = "true";
  }

  if (allPermissionsTableBody && allPermissionsTableBody.dataset.bound !== "true") {
    allPermissionsTableBody.addEventListener("click", async (event) => {
      const editBtn = event.target.closest(".edit-all-permission-btn");
      if (editBtn) {
        const pid = editBtn.dataset.permissionId || "";
        const permission = permById(pid);
        if (!permission) {
          msg(allPermissionsMsg, "Permission details not found.");
          return;
        }
        permissionEditorSource = "allPermissions";
        clr(permissionCreateMsg);
        fillPermissionForm(permission);
        closeAllPermissionsModal();
        openPermissionModal();
        return;
      }

      const deleteBtn = event.target.closest(".delete-all-permission-btn");
      if (deleteBtn) {
        const pid = deleteBtn.dataset.permissionId || "";
        const label = deleteBtn.dataset.permissionName || pid;
        if (!pid) return;
        if (!window.confirm(`Delete permission "${label}" globally?`)) return;

        try {
          await apiDeletePermission(pid);
          msg(allPermissionsMsg, "Permission deleted successfully.", "success");
          if ((permissionEditId?.value || "") === pid) {
            resetPermissionForm();
            closePermissionModal();
          }
          await refreshRolesPermissionsData();
          renderAllPermissionsModal();
        } catch (e) {
          msg(allPermissionsMsg, e.message || "Failed to delete permission.");
        }
      }
    });
    allPermissionsTableBody.dataset.bound = "true";
  }
}

function bindXacmlModal() {
  if (permissionXmlHelpBtn && permissionXmlHelpBtn.dataset.bound !== "true") {
    permissionXmlHelpBtn.addEventListener("click", () => { xacmlHelpModal?.classList.remove("hidden"); xacmlHelpModal?.classList.add("flex"); });
    permissionXmlHelpBtn.dataset.bound = "true";
  }
  if (xacmlHelpClose && xacmlHelpClose.dataset.bound !== "true") {
    xacmlHelpClose.addEventListener("click", () => { xacmlHelpModal?.classList.add("hidden"); xacmlHelpModal?.classList.remove("flex"); });
    xacmlHelpClose.dataset.bound = "true";
  }
  if (xacmlHelpModal && xacmlHelpModal.dataset.bound !== "true") {
    xacmlHelpModal.addEventListener("click", (e) => {
      if (e.target === xacmlHelpModal) {
        xacmlHelpModal.classList.add("hidden");
        xacmlHelpModal.classList.remove("flex");
      }
    });
    xacmlHelpModal.dataset.bound = "true";
  }
}

export async function refreshRolesPermissionsData() {
  clr(rolesPermissionsMessage);
  clr(roleAssignmentsMsg);
  clr(rolePermissionsDetailMsg);
  if (!sessionToken) {
    msg(rolesPermissionsMessage, "Admin session not available. Re-login with an admin user.");
    return;
  }
  if (rolesTableBody) rolesTableBody.innerHTML = "<tr><td colspan='2' class='px-4 py-3 text-center'><i class='fas fa-spinner loading-spinner text-indigo-600'></i></td></tr>";
  if (roleAssignmentsTableBody) roleAssignmentsTableBody.innerHTML = "<tr><td colspan='4' class='px-4 py-3 text-center'><i class='fas fa-spinner loading-spinner text-indigo-600'></i></td></tr>";
  try {
    const [r, p, u, a] = await Promise.all([
      getList(`/v1/applications/${KEYROCK_CLIENT_ID}/roles`, "roles"),
      getList(`/v1/applications/${KEYROCK_CLIENT_ID}/permissions`, "permissions"),
      getList("/v1/users", "users"),
      getList(`/v1/applications/${KEYROCK_CLIENT_ID}/users`, "role_user_assignments")
    ]);
    roles = r.sort((x, y) => String(x.name || "").localeCompare(String(y.name || "")));
    permissions = p.sort((x, y) => String(x.name || "").localeCompare(String(y.name || "")));
    users = u.sort((x, y) => String(x.username || "").localeCompare(String(y.username || "")));
    roleAssignments = new Map();
    a.forEach((row) => {
      if (!row?.user_id || !row?.role_id) return;
      if (!roleAssignments.has(row.user_id)) roleAssignments.set(row.user_id, []);
      const list = roleAssignments.get(row.user_id);
      if (!list.includes(row.role_id)) list.push(row.role_id);
    });
    if (selectedRoleId && !roleById(selectedRoleId)) {
      selectedRoleId = "";
      selectedRolePermissions = [];
    }
    renderRoleOptions();
    renderRolesTable();
    renderUsersRoleTable();
    renderRolePermissionsPanel();
    renderRolePermissionAssignSelect();
    if (selectedRoleId) await loadSelectedRolePermissions();
    if (allPermissionsModal && !allPermissionsModal.classList.contains("hidden")) {
      renderAllPermissionsModal();
    }
  } catch (e) {
    console.error("Roles & permissions refresh failed:", e);
    msg(rolesPermissionsMessage, e.message || "Failed to load roles/permissions.");
  }
}

export function initRolesPermissions() {
  if (initialized) return;
  initialized = true;
  resetPermissionForm();
  closePermissionModal();
  if (btnCreateRole) btnCreateRole.addEventListener("click", handleCreateRole);
  if (createRoleForm) createRoleForm.addEventListener("submit", (e) => { e.preventDefault(); handleCreateRole(); });
  if (btnCreatePermission) btnCreatePermission.addEventListener("click", handleCreatePermission);
  if (createPermissionForm) createPermissionForm.addEventListener("submit", (e) => { e.preventDefault(); handleCreatePermission(); });
  if (refreshRolesPermissions) refreshRolesPermissions.addEventListener("click", refreshRolesPermissionsData);
  bindRolesTable();
  bindRolePermissionsPanel();
  bindRoleAssignments();
  bindPermissionEditor();
  bindAllPermissionsModal();
  bindXacmlModal();
}
