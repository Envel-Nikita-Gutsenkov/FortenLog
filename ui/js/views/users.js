import { api, refreshData } from '../api.js';

export async function renderUsers(container) {
    container.innerHTML = `
        <div class="view-content-inner">
            <div class="header-section" style="display: flex; justify-content: space-between; align-items: flex-end;">
                <div>
                    <h1>User Registry</h1>
                    <p>Manage access levels and platform permissions for your team.</p>
                </div>
                <button class="btn btn-primary" onclick="inviteUser()">+ Add User</button>
            </div>
            <div id="users-list-container" style="display: flex; flex-direction: column; gap: 12px;">
                <div class="spinner"></div>
            </div>
        </div>`;

    const list = container.querySelector('#users-list-container');
    const { data: users } = await api('/api/users');
    list.innerHTML = (users || []).map(u => `
        <div class="user-row-card" style="display: flex; align-items: center; padding: 20px 32px; gap: 24px; margin-bottom: 0;">
            <div class="user-info" style="display: flex; align-items: center; gap: 16px; flex: 1; min-width: 200px;">
                <div class="user-avatar">${u.username.substring(0, 2).toUpperCase()}</div>
                <div>
                    <div class="font-bold text-accent" style="font-size: 16px;">${u.username}</div>
                    <div class="text-secondary" style="font-size: 12px;">Created on ${new Date(u.created_at || Date.now()).toLocaleDateString()}</div>
                </div>
            </div>
            <div style="width: 150px; flex-shrink: 0;">
                <div class="text-secondary" style="font-size: 10px; font-weight: 800; margin-bottom: 6px; letter-spacing: 0.1em;">ROLE <span class="tooltip" data-tooltip="Privilege level: Admin has full control, Member has read-only access.">?</span></div>
                <select class="btn btn-sm" onchange="updateUserRole('${u.username}', this.value)" style="height: 32px; padding: 0 8px; width: 120px;">
                    <option value="user" ${u.role === 'user' ? 'selected' : ''}>MEMBER</option>
                    <option value="admin" ${u.role === 'admin' ? 'selected' : ''}>ADMIN</option>
                </select>
            </div>
            <div style="width: 100px; flex-shrink: 0;">
                <div class="text-secondary" style="font-size: 10px; font-weight: 800; margin-bottom: 6px; letter-spacing: 0.1em;">STATUS</div>
                <div style="color: var(--success); font-weight: 800; font-size: 12px; display: flex; align-items: center; gap: 6px;">
                    <span style="width: 8px; height: 8px; border-radius: 50%; background: var(--success); display: inline-block;"></span>
                    ACTIVE
                </div>
            </div>
            <div style="width: 290px; flex-shrink: 0; display: flex; gap: 8px; justify-content: flex-end;">
                ${u.role === 'user' ? `<button class="btn btn-sm" style="padding: 8px 16px; min-width: 85px;" onclick="manageUserProjects('${u.username}', '${u.allowed_projects || ''}')">Projects</button>` : `<div style="width: 85px;"></div>`}
                <button class="btn btn-sm" style="padding: 8px 16px;" onclick="resetUserPassword('${u.username}')">Reset Pwd</button>
                <button class="btn btn-sm btn-danger" style="padding: 8px 16px;" onclick="deleteUser('${u.username}')">Revoke</button>
            </div>
        </div>`).join('') || '<div class="no-data">No users found.</div>';
}

window.manageUserProjects = async (username, allowedProjectsStr) => {
    const { data: projects } = await api('/api/settings/projects');
    const allowedList = allowedProjectsStr ? allowedProjectsStr.split(',').map(s => s.trim()) : [];
    
    const checkboxesHtml = (projects || []).map(p => {
        const isChecked = allowedList.includes(p.id) ? 'checked' : '';
        return `
            <div style="display: flex; align-items: center; gap: 10px; margin-bottom: 12px; padding: 10px; background: var(--bg-sub); border: 1px solid var(--border); border-radius: 8px;">
                <input type="checkbox" id="proj-check-${p.id}" data-id="${p.id}" ${isChecked} style="width: 18px; height: 18px; cursor: pointer;">
                <label for="proj-check-${p.id}" style="font-size: 14px; font-weight: 700; cursor: pointer; flex: 1; text-align: left;">
                    ${p.name} <span class="text-secondary" style="font-size: 12px; font-weight: 400;">(${p.id})</span>
                </label>
            </div>
        `;
    }).join('') || '<div class="text-secondary">No projects registered. Create projects in the Project Registry first.</div>';
    
    window.dispatchEvent(new CustomEvent('open-modal', {
        detail: {
            title: `Manage Project Access: ${username}`,
            html: `
                <div style="display: flex; flex-direction: column; gap: 16px;">
                    <p class="text-secondary" style="font-size: 13px; text-align: left;">Select the specific projects that <b>${username}</b> is authorized to access and view telemetry for.</p>
                    <div style="max-height: 250px; overflow-y: auto; padding-right: 4px;">
                        ${checkboxesHtml}
                    </div>
                    <div style="display: flex; gap: 12px; margin-top: 24px;">
                        <button class="btn btn-primary" id="btn-save-user-projects" style="flex: 1; height: 44px;">Save Access</button>
                        <button class="btn" onclick="closeModal()" style="flex: 1; height: 44px;">Cancel</button>
                    </div>
                </div>
            `,
            onRender: (content) => {
                content.querySelector('#btn-save-user-projects').onclick = async () => {
                    const selected = [];
                    content.querySelectorAll('input[type="checkbox"]:checked').forEach(cb => {
                        selected.push(cb.getAttribute('data-id'));
                    });
                    
                    const allowed_projects = selected.join(',');
                    
                    const { status } = await api(`/api/users/${username}/projects`, {
                        method: 'PUT',
                        body: JSON.stringify({ allowed_projects })
                    });
                    
                    if (status === 200) {
                        alert('Project access permissions updated successfully.');
                        window.closeModal();
                        await refreshData();
                        renderUsers(document.getElementById('view-content'));
                    } else {
                        alert('Failed to update project access.');
                    }
                };
            }
        }
    }));
};

window.inviteUser = () => {
    window.dispatchEvent(new CustomEvent('open-modal', {
        detail: {
            title: 'Create New User Account',
            html: `
                <div style="display: flex; flex-direction: column; gap: 16px;">
                    <p class="text-secondary" style="font-size: 13px;">Create a new administrative or member identity for your team. Initial passwords should be changed by the user upon first login.</p>
                    <div>
                        <label class="text-secondary font-bold" style="font-size: 11px; display: block; margin-bottom: 6px;">USERNAME</label>
                        <input type="text" id="add-username" class="search-input" style="width: 100%;" placeholder="e.g. n.batman">
                    </div>
                    <div>
                        <label class="text-secondary font-bold" style="font-size: 11px; display: block; margin-bottom: 6px;">INITIAL PASSWORD</label>
                        <input type="password" id="add-password" class="search-input" style="width: 100%;" placeholder="Minimum 12 chars recommended">
                    </div>
                    <div style="display: flex; align-items: center; gap: 10px; margin-top: 8px;">
                        <input type="checkbox" id="add-is-admin" style="width: 18px; height: 18px; cursor: pointer;">
                        <label for="add-is-admin" style="font-size: 14px; font-weight: 700; cursor: pointer;">Grant Administrative Privileges</label>
                    </div>
                    <div style="display: flex; gap: 12px; margin-top: 24px;">
                        <button class="btn btn-primary" id="btn-create-user" style="flex: 1; height: 44px;">Create Identity</button>
                        <button class="btn" onclick="closeModal()" style="flex: 1; height: 44px;">Cancel</button>
                    </div>
                </div>
            `,
            onRender: (content) => {
                content.querySelector('#btn-create-user').onclick = async () => {
                    const username = content.querySelector('#add-username').value;
                    const password = content.querySelector('#add-password').value;
                    const is_admin = content.querySelector('#add-is-admin').checked;
                    if (!username || !password) return alert('Username and password are required.');
                    
                    const res = await api('/api/users', {
                        method: 'POST',
                        body: JSON.stringify({ username, password, is_admin, role: is_admin ? 'admin' : 'user' })
                    });
                    
                    if (res.status === 201) {
                        alert('User created successfully.');
                        window.closeModal();
                        await refreshData();
                        renderUsers(document.getElementById('view-content'));
                    } else {
                        alert(`Failed to create user: ${res.error || 'User might already exist or password policy not met.'}`);
                    }
                };
            }
        }
    }));
};

window.deleteUser = async (username) => {
    if (confirm(`Revoke access for ${username}?`)) {
        await api(`/api/users/${username}`, { method: 'DELETE' });
        await refreshData();
        renderUsers(document.getElementById('view-content'));
    }
};

window.resetUserPassword = async (username) => {
    const newPwd = prompt(`Enter new password for ${username}:`);
    if (newPwd) {
        const res = await api(`/api/users/${username}/reset-password`, { method: 'POST', body: JSON.stringify({ new_password: newPwd }) });
        if (res.status === 200) {
            alert('Password reset successful.');
        } else {
            alert(`Failed to reset password: ${res.error || 'Unknown error.'}`);
        }
    }
};

window.updateUserRole = async (username, role) => {
    await api(`/api/users/${username}/role`, { method: 'PUT', body: JSON.stringify({ role }) });
    alert(`Role updated to ${role}.`);
};
