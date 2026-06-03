/* ======================== DOM ELEMENTS ======================== */
/**
 * DOM Elements module - Centralized element references
 * All getElementById calls and element caching
 */

// Login Section Elements
export const loginSection = document.getElementById("loginSection");
export const emailInput = document.getElementById("email");
export const passwordInput = document.getElementById("password");
export const btnLogin = document.getElementById("btnLogin");
export const loginBtnText = document.getElementById("loginBtnText");
export const loginSpinner = document.getElementById("loginSpinner");
export const loginMsg = document.getElementById("loginMsg");

// User Menu Elements
export const userMenuWrapper = document.getElementById("userMenuWrapper");
export const userInfoBtn = document.getElementById("userInfo");
export const userDropdown = document.getElementById("userDropdown");
export const btnLogout = document.getElementById("btnLogout");
export const loggedInEmail = document.getElementById("loggedInEmail");

// Tab Navigation Elements
export const tabsNav = document.getElementById("tabsNav");
export const usersTab = document.getElementById("usersTab");
export const rolesTab = document.getElementById("rolesTab");
export const auditTab = document.getElementById("auditTab");
export const settingsTab = document.getElementById("settingsTab");
export const orionTab = document.getElementById("orionTab");
export const digitalTwinTab = document.getElementById("digitalTwinTab");

// Section Elements
export const usersSection = document.getElementById("usersSection");
export const rolesSection = document.getElementById("rolesSection");
export const auditSection = document.getElementById("auditSection");
export const settingsSection = document.getElementById("settingsSection");
export const orionSection = document.getElementById("orionSection");
export const digitalTwinSection  = document.getElementById("digitalTwinSection");

// User Management Elements
export const usersTableBody = document.getElementById("usersTableBody");
export const usersMessage = document.getElementById("usersMessage");
export const refreshUsers = document.getElementById("refreshUsers");

// Roles & Permissions Elements
export const refreshRolesPermissions = document.getElementById("refreshRolesPermissions");
export const rolesPermissionsMessage = document.getElementById("rolesPermissionsMessage");
export const createRoleForm = document.getElementById("createRoleForm");
export const roleName = document.getElementById("roleName");
export const btnCreateRole = document.getElementById("btnCreateRole");
export const roleCreateMsg = document.getElementById("roleCreateMsg");
export const createPermissionForm = document.getElementById("createPermissionForm");
export const permissionName = document.getElementById("permissionName");
export const permissionDescription = document.getElementById("permissionDescription");
export const permissionAction = document.getElementById("permissionAction");
export const permissionResource = document.getElementById("permissionResource");
export const permissionIsRegex = document.getElementById("permissionIsRegex");
export const permissionAuthHeader = document.getElementById("permissionAuthHeader");
export const permissionUseAuthHeader = document.getElementById("permissionUseAuthHeader");
export const permissionXml = document.getElementById("permissionXml");
export const permissionAssignRole = document.getElementById("permissionAssignRole");
export const permissionEditId = document.getElementById("permissionEditId");
export const permissionFormTitle = document.getElementById("permissionFormTitle");
export const btnCreatePermission = document.getElementById("btnCreatePermission");
export const btnCancelPermissionEdit = document.getElementById("btnCancelPermissionEdit");
export const btnDeletePermissionGlobal = document.getElementById("btnDeletePermissionGlobal");
export const permissionCreateMsg = document.getElementById("permissionCreateMsg");
export const permissionEditorModal = document.getElementById("permissionEditorModal");
export const permissionEditorClose = document.getElementById("permissionEditorClose");
export const rolesTableBody = document.getElementById("rolesTableBody");
export const rolePermissionsPanel = document.getElementById("rolePermissionsPanel");
export const rolePermissionsTitle = document.getElementById("rolePermissionsTitle");
export const closeRolePermissions = document.getElementById("closeRolePermissions");
export const rolePermissionAssignSelect = document.getElementById("rolePermissionAssignSelect");
export const btnAssignPermissionToRole = document.getElementById("btnAssignPermissionToRole");
export const btnListAllPermissions = document.getElementById("btnListAllPermissions");
export const rolePermissionsTableBody = document.getElementById("rolePermissionsTableBody");
export const rolePermissionsDetailMsg = document.getElementById("rolePermissionsDetailMsg");
export const allPermissionsModal = document.getElementById("allPermissionsModal");
export const allPermissionsClose = document.getElementById("allPermissionsClose");
export const allPermissionsTableBody = document.getElementById("allPermissionsTableBody");
export const allPermissionsMsg = document.getElementById("allPermissionsMsg");
export const roleAssignmentsTableBody = document.getElementById("roleAssignmentsTableBody");
export const roleAssignmentsMsg = document.getElementById("roleAssignmentsMsg");
export const permissionXmlHelpBtn = document.getElementById("permissionXmlHelpBtn");
export const xacmlHelpModal = document.getElementById("xacmlHelpModal");
export const xacmlHelpClose = document.getElementById("xacmlHelpClose");

// Create User Form Elements
export const newUsername = document.getElementById("new_username");
export const newEmail = document.getElementById("new_email");
export const newPassword = document.getElementById("new_password");
export const newDescription = document.getElementById("new_description");
export const newWebsite = document.getElementById("new_website");
export const newEnable = document.getElementById("new_enable");
export const btnCreate = document.getElementById("btnCreate");
export const createMsg = document.getElementById("createMsg");

// Orion Logs Elements
export const logsTableBody = document.getElementById("logsTableBody");
export const logsMessage = document.getElementById("logsMessage");
export const refreshLogs = document.getElementById("refreshLogs");

// Filter Elements
export const deviceFilter = document.getElementById("deviceFilter");
export const attributeFilter = document.getElementById("attributeFilter");
export const btnApplyFilter = document.getElementById("btnApplyFilter");
export const btnClearFilter = document.getElementById("btnClearFilter");

// Password Toggle Elements (accessed by ID in functions)
export const togglePassword = document.getElementById("togglePassword");
export const toggleNewPassword = document.getElementById("toggleNewPassword");

// Create User Form Reference
export const createUserForm = document.getElementById("createUserForm");

// Machine and service gorup elements
export const inventoryTab = document.getElementById("inventoryTab");
export const inventorySection = document.getElementById("inventorySection");
export const serviceGroupForm = document.getElementById("serviceGroupForm");
export const serviceGroupApiKey = document.getElementById("serviceGroupApiKey");
export const serviceGroupCbroker = document.getElementById("serviceGroupCbroker");
export const serviceGroupResource = document.getElementById("serviceGroupResource");
export const serviceGroupEntityType = document.getElementById("serviceGroupEntityType");
export const serviceGroupName = document.getElementById("serviceGroupName");
export const serviceGroupDescription = document.getElementById("serviceGroupDescription");
export const serviceGroupMsg = document.getElementById("serviceGroupMsg");
export const serviceGroupsTableBody = document.getElementById("serviceGroupsTableBody");
export const serviceGroupCount = document.getElementById("serviceGroupCount");
export const machineForm = document.getElementById("machineForm");
export const machineDeviceId = document.getElementById("machineDeviceId");
export const machineName = document.getElementById("machineName");
export const machineModel = document.getElementById("machineModel");
export const machineDescription = document.getElementById("machineDescription");
export const machineServiceGroup = document.getElementById("machineServiceGroup");
export const machineStatus = document.getElementById("machineStatus");
export const attributeModeToggle = document.getElementById("attributeModeToggle");
export const attributeModeKnob = attributeModeToggle?.querySelector(".mode-knob") || null;
export const attributeManualContainer = document.getElementById("attributeManualContainer");
export const attributeAutomaticContainer = document.getElementById("attributeAutomaticContainer");
export const machineAttributesManual = document.getElementById("machineAttributesManual");
export const attributeObjectId = document.getElementById("attributeObjectId");
export const attributeName = document.getElementById("attributeName");
export const attributeType = document.getElementById("attributeType");
export const attributeAddBtn = document.getElementById("attributeAddBtn");
export const attributeAutoList = document.getElementById("attributeAutoList");
export const staticAttributesModeToggle = document.getElementById("staticAttributesModeToggle");
export const staticAttributesModeKnob = staticAttributesModeToggle?.querySelector(".mode-knob") || null;
export const staticAttributesManualContainer = document.getElementById("staticAttributesManualContainer");
export const machineStaticAttributesManual = document.getElementById("machineStaticAttributesManual");
export const staticAttributesAutomaticContainer = document.getElementById("staticAttributesAutomaticContainer");
export const staticAttributeName = document.getElementById("staticAttributeName");
export const staticAttributeType = document.getElementById("staticAttributeType");
export const staticAttributeValue = document.getElementById("staticAttributeValue");
export const staticAttributeAddBtn = document.getElementById("staticAttributeAddBtn");
export const staticAttributeAutoList = document.getElementById("staticAttributeAutoList");
export const machineMsg = document.getElementById("machineMsg");
export const machinesTableBody = document.getElementById("machinesTableBody");
export const machineCount = document.getElementById("machineCount");

// Device picker elements (Add Machine form)
export const deviceIdPickerWrapper = document.getElementById("deviceIdPickerWrapper");
export const deviceIdPickerToggle  = document.getElementById("deviceIdPickerToggle");
export const deviceIdPickerPanel   = document.getElementById("deviceIdPickerPanel");
export const deviceIdPickerList    = document.getElementById("deviceIdPickerList");
export const deviceIdPickerChevron = document.getElementById("deviceIdPickerChevron");
