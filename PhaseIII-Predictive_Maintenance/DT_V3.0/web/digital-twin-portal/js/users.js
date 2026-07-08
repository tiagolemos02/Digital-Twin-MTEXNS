/* ======================== USER MANAGEMENT ======================== */
/**
 * User Management module - User listing, creation, and management functions
 */

import { KEYROCK_BFF_BASE, sessionToken } from './config.js';
import {
    usersTableBody,
    usersMessage,
    newUsername,
    newEmail,
    newPassword,
    newDescription,
    newWebsite,
    newEnable,
    createMsg,
    createUserForm
} from './dom-elements.js';
import { formatResponseError, formatThrownError } from './error-messages.js';

const USERS_CONTEXT = {
    system: 'Keyrock admin API',
    action: 'load users',
    endpoint: 'GET /bff/keyrock/v1/users',
    recovery: 'Ask an admin to assign Keyrock user-read permission, then sign in again.'
};

const CREATE_USER_CONTEXT = {
    system: 'Keyrock admin API',
    action: 'create the user',
    endpoint: 'POST /bff/keyrock/v1/users',
    recovery: 'Confirm the account fields and administrator role, then try again.'
};

export async function listUsers() {
    usersMessage.textContent = '';
    usersTableBody.innerHTML =
        "<tr><td colspan='4' class='px-6 py-4 text-center'><i class='fas fa-spinner loading-spinner text-indigo-600'></i></td></tr>";

    if (!sessionToken) {
        usersMessage.textContent = 'Keyrock admin API could not load users. Next: sign in with an administrator session.';
        usersTableBody.innerHTML = "<tr><td colspan='4' class='px-6 py-4 text-center text-sm text-gray-500'>Administrator session required.</td></tr>";
        return;
    }

    try {
        const resp = await fetch(`${KEYROCK_BFF_BASE}/v1/users`, {
            method: 'GET',
            credentials: 'include',
            headers: {
                Accept: 'application/json'
            }
        });

        if (!resp.ok) {
            usersMessage.textContent = await formatResponseError(resp, USERS_CONTEXT);
            usersTableBody.innerHTML =
                "<tr><td colspan='4' class='px-6 py-4 text-center text-sm text-red-500'>Could not load users. Check the message above for the required permission.</td></tr>";
            return;
        }

        const data = await resp.json();
        renderUsersTable(data.users);
    } catch (e) {
        console.error('Keyrock users request failed:', e);
        usersMessage.textContent = formatThrownError(e, USERS_CONTEXT);
        usersTableBody.innerHTML =
            "<tr><td colspan='4' class='px-6 py-4 text-center text-sm text-red-500'>Could not reach Keyrock through the BFF.</td></tr>";
    }
}

function renderUsersTable(users) {
    if (!Array.isArray(users) || !users.length) {
        usersTableBody.innerHTML =
            "<tr><td colspan='4' class='px-6 py-4 text-center text-sm text-gray-500'>No users found</td></tr>";
        return;
    }

    usersTableBody.innerHTML = '';
    users.forEach((user) => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td class='px-6 py-4 text-sm whitespace-nowrap'>${user.id}</td>
            <td class='px-6 py-4 text-sm'>${user.username}</td>
            <td class='px-6 py-4 text-sm'>${user.email}</td>
            <td class='px-6 py-4'>${renderUserStatus(user.enabled)}</td>`;
        usersTableBody.appendChild(tr);
    });
}

function renderUserStatus(enabled) {
    return enabled
        ? "<span class='status-badge status-active'>Active</span>"
        : "<span class='status-badge status-inactive'>Inactive</span>";
}

export async function handleCreateUser() {
    createMsg.textContent = '';
    createMsg.className = 'mt-3 text-sm text-red-600';

    if (!sessionToken) {
        createMsg.textContent = 'Keyrock admin API could not create the user. Next: sign in with an administrator session.';
        return;
    }

    const userData = {
        username: newUsername.value.trim(),
        email: newEmail.value.trim(),
        password: newPassword.value.trim(),
        description: newDescription.value.trim(),
        website: newWebsite.value.trim(),
        enabled: newEnable.checked
    };

    if (!userData.username || !userData.email || !userData.password) {
        createMsg.textContent = 'Username, email and password are required.';
        return;
    }

    try {
        const resp = await fetch(`${KEYROCK_BFF_BASE}/v1/users`, {
            method: 'POST',
            credentials: 'include',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ user: userData })
        });

        if (resp.status === 201) {
            createMsg.classList.remove('text-red-600');
            createMsg.classList.add('text-green-600');
            createMsg.textContent = 'User created successfully!';
            createUserForm.reset();
            listUsers();
            return;
        }

        createMsg.textContent = await formatResponseError(resp, CREATE_USER_CONTEXT);
    } catch (e) {
        console.error('Keyrock user creation request failed:', e);
        createMsg.textContent = formatThrownError(e, CREATE_USER_CONTEXT);
    }
}

export function refreshUsersList() {
    listUsers();
}
