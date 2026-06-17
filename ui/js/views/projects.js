import { store } from '../store.js';
import { api, refreshData, deleteProject, createProject } from '../api.js';

export function renderProjects(container) {
    container.innerHTML = `
        <div style="padding: 24px;">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 24px;">
                <h1>Project Registry</h1>
                <button class="btn btn-primary" id="btn-create-project">Create Project</button>
            </div>
            <div class="dashboard-grid">
                ${(store.projects || []).map(p => `
                    <div class="card" style="${p.id === store.currentProjectId ? 'border-color: var(--accent);' : ''}">
                        <div style="display: flex; justify-content: space-between; align-items: flex-start;">
                            <div>
                                <div style="font-weight: 800; font-size: 16px;">${p.name}</div>
                                <div style="font-size: 11px; color: var(--text-secondary); margin-top: 4px;">ID: ${p.id}</div>
                            </div>
                            <div style="display: flex; gap: 8px;">
                                <button class="btn btn-sm ${p.id === store.currentProjectId ? 'btn-primary' : ''}" data-action="select" data-id="${p.id}">
                                    ${p.id === store.currentProjectId ? 'Active' : 'Select'}
                                </button>
                                <button class="btn btn-sm" data-action="settings" data-id="${p.id}">Settings</button>
                                <button class="btn btn-sm btn-danger" data-action="delete" data-id="${p.id}">Delete</button>
                            </div>
                        </div>
                        <div style="margin-top: 16px; padding: 12px; background: var(--bg-sub); border-radius: 6px; border: 1px solid var(--border);">
                            <div style="font-size: 10px; text-transform: uppercase; color: var(--text-secondary); margin-bottom: 6px; font-weight: 800; display: flex; justify-content: space-between;">
                                 <span>Client DSN (Public)</span>
                                 <span style="cursor: pointer; color: var(--accent);" onclick="copyDsn(this, '${p.api_key}', '${p.id}')">Copy</span>
                            </div>
                            <code style="font-size: 11px; font-family: 'Roboto Mono', monospace; word-break: break-all; color: var(--text-primary);">${window.location.protocol}//${p.api_key}@${window.location.host}/${p.id}</code>
                        </div>
                        <div style="margin-top: 12px; display: flex; flex-direction: column; gap: 8px; font-size: 12px; font-weight: 600;">
                            <div style="display: flex; justify-content: space-between;">
                                <span>Retention:</span>
                                <b style="color: var(--text-primary);">${p.retention_days || 14} days</b>
                            </div>
                            <div style="display: flex; justify-content: space-between;">
                                <span>RAM Cache Limit:</span>
                                <b style="color: var(--accent);">${p.cache_size_mb || 256} MB</b>
                            </div>
                            <div style="display: flex; justify-content: space-between;">
                                <span>GitHub Repository:</span>
                                <b style="color: var(--text-secondary);">${p.github_repo || 'Not Linked'}</b>
                            </div>
                        </div>
                    </div>
                `).join('')}
            </div>
        </div>
    `;

    container.querySelector('#btn-create-project').onclick = showCreateProjectModal;

    container.querySelectorAll('[data-action="select"]').forEach(btn => {
        btn.onclick = () => {
            const id = btn.getAttribute('data-id');
            window.switchProject(id);
            window.navigate('issues');
        };
    });

    container.querySelectorAll('[data-action="settings"]').forEach(btn => {
        btn.onclick = () => {
            const id = btn.getAttribute('data-id');
            const project = store.projects.find(p => p.id === id);
            showEditProjectModal(project);
        };
    });

    container.querySelectorAll('[data-action="delete"]').forEach(btn => {
        btn.onclick = async () => {
            const id = btn.getAttribute('data-id');
            if (confirm(`Delete project ${id}? This action is permanent.`)) {
                await deleteProject(id);
                await refreshData();
            }
        };
    });
}

function showCreateProjectModal() {
    window.dispatchEvent(new CustomEvent('open-modal', { detail: {
        title: 'Create New Project',
        html: `
            <div style="display: flex; flex-direction: column; gap: 15px;">
                <input type="text" id="p-name" class="search-input" placeholder="Project Name">
                <input type="text" id="p-id" class="search-input" placeholder="Project ID (slug, auto-generated if empty)">
                <input type="text" id="p-repo" class="search-input" placeholder="GitHub Repository (org/repo, e.g. owner/repo)">
                <div style="display: flex; align-items: center; gap: 10px; justify-content: space-between;">
                    <label style="font-size: 12px; font-weight: 800; color: var(--text-secondary);">RETENTION (DAYS):</label>
                    <input type="number" id="p-retention" class="search-input" value="14" style="width: 80px;" min="1" max="365">
                </div>
                <div style="display: flex; align-items: center; gap: 10px; justify-content: space-between;">
                    <label style="font-size: 12px; font-weight: 800; color: var(--text-secondary);">RAM CACHE LIMIT (MB):</label>
                    <input type="number" id="p-cache" class="search-input" value="256" style="width: 80px;" min="16" max="4096">
                </div>
                <div style="display: flex; gap: 10px; margin-top: 10px;">
                    <button class="btn btn-primary" id="modal-submit">Create Project</button>
                    <button class="btn" id="modal-cancel">Cancel</button>
                </div>
            </div>
        `,
        onRender: (content) => {
            content.querySelector('#modal-cancel').onclick = () => window.dispatchEvent(new CustomEvent('close-modal'));
            content.querySelector('#modal-submit').onclick = async () => {
                const name = content.querySelector('#p-name').value.trim();
                const id = content.querySelector('#p-id').value.trim();
                const repo = content.querySelector('#p-repo').value.trim();
                const retention = parseInt(content.querySelector('#p-retention').value) || 14;
                const cacheSize = parseInt(content.querySelector('#p-cache').value) || 256;
                if (!name) {
                    alert('Error: Project name is required.');
                    return;
                }
                const result = await createProject({ id: id || null, name, github_repo: repo || null, retention_days: retention, cache_size_mb: cacheSize });
                if (result.success) {
                    window.dispatchEvent(new CustomEvent('close-modal'));
                    await refreshData();
                    alert('Success: Project registered successfully.');
                } else {
                    if (result.status === 409) {
                        alert('Error: A project with this ID/slug already exists. Please choose a unique ID.');
                    } else if (result.status === 403) {
                        alert('Error: Forbidden. Administrator privileges required.');
                    } else {
                        alert('Error: Failed to register project. Please verify system diagnostics.');
                    }
                }
            };
        }
    }}));
}

function showEditProjectModal(project) {
    window.dispatchEvent(new CustomEvent('open-modal', { detail: {
        title: `Project Settings: ${project.name}`,
        html: `
            <div style="display: flex; flex-direction: column; gap: 15px;">
                <div>
                    <label class="highlight-label">Display Name</label>
                    <input type="text" id="p-name" class="search-input" value="${project.name}" style="width: 100%">
                </div>
                <div>
                    <label class="highlight-label">GitHub Repository (org/repo)</label>
                    <input type="text" id="p-repo" class="search-input" value="${project.github_repo || ''}" placeholder="e.g. facebook/react" style="width: 100%">
                </div>
                <div style="display: flex; align-items: center; gap: 10px; justify-content: space-between;">
                    <label style="font-size: 12px; font-weight: 800; color: var(--text-secondary);">RETENTION (DAYS):</label>
                    <input type="number" id="p-retention" class="search-input" value="${project.retention_days || 14}" style="width: 80px;" min="1" max="365">
                </div>
                <div style="display: flex; align-items: center; gap: 10px; justify-content: space-between;">
                    <label style="font-size: 12px; font-weight: 800; color: var(--text-secondary);">RAM CACHE LIMIT (MB):</label>
                    <input type="number" id="p-cache" class="search-input" value="${project.cache_size_mb || 256}" style="width: 80px;" min="16" max="4096">
                </div>
                <div style="display: flex; gap: 10px; margin-top: 10px;">
                    <button class="btn btn-primary" id="modal-submit">Save Changes</button>
                    <button class="btn" id="modal-cancel">Cancel</button>
                </div>
            </div>
        `,
        onRender: (content) => {
            content.querySelector('#modal-cancel').onclick = () => window.dispatchEvent(new CustomEvent('close-modal'));
            content.querySelector('#modal-submit').onclick = async () => {
                const name = content.querySelector('#p-name').value;
                const repo = content.querySelector('#p-repo').value;
                const retention = parseInt(content.querySelector('#p-retention').value) || 14;
                const cacheSize = parseInt(content.querySelector('#p-cache').value) || 256;
                
                await api(`/api/settings/projects/${project.id}`, {
                    method: 'PUT',
                    body: JSON.stringify({ name, github_repo: repo, retention_days: retention, cache_size_mb: cacheSize })
                });
                
                window.dispatchEvent(new CustomEvent('close-modal'));
                await refreshData();
            };
        }
    }}));
}

window.copyDsn = async (btn, api_key, id) => {
    try {
        await navigator.clipboard.writeText(`${window.location.protocol}//${api_key}@${window.location.host}/${id}`);
        const oldText = btn.innerText;
        btn.innerText = 'Copied!';
        btn.style.color = '#2ecc71';
        setTimeout(() => {
            btn.innerText = oldText;
            btn.style.color = '';
        }, 2000);
    } catch (err) {
        alert('Failed to copy. Please copy manually.');
    }
};
