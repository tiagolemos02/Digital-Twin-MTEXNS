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

export async function listUsers() {
    usersMessage.textContent = '';
    usersTableBody.innerHTML =
        "<tr><td colspan='4' class='px-6 py-4 text-center'><i class='fas fa-spinner loading-spinner text-indigo-600'></i></td></tr>";

    if (!sessionToken) {
        usersMessage.textContent = 'Admin session not available. Please login again.';
        usersTableBody.innerHTML = "<tr><td colspan='4' class='px-6 py-4 text-center text-sm text-gray-500'>Admin session missing</td></tr>";
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
            const body = await resp.text().catch(() => '');
            console.error('BFF /v1/users error:', resp.status, body);
            usersMessage.textContent = `Error listing users (HTTP ${resp.status})`;
            usersTableBody.innerHTML =
                "<tr><td colspan='4' class='px-6 py-4 text-center text-sm text-red-500'>Error loading users</td></tr>";
            return;
        }

        const data = await resp.json();
        renderUsersTable(data.users);
    } catch (e) {
        console.error('Error listing users:', e);
        usersMessage.textContent = 'Network error.';
        usersTableBody.innerHTML =
            "<tr><td colspan='4' class='px-6 py-4 text-center text-sm text-red-500'>Network error</td></tr>";
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
        createMsg.textContent = 'Admin session not available.';
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

        const err = await resp.json().catch(() => ({}));
        createMsg.textContent = 'Error creating user: ' + (err.error?.message || resp.statusText);
    } catch (e) {
        console.error('Error creating user:', e);
        createMsg.textContent = 'Network error.';
    }
}

export function refreshUsersList() {
    listUsers();
}
