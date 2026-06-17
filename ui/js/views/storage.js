import { api, refreshData } from '../api.js';
import { store } from '../store.js';

export async function renderStorage(container) {
    const [{ data: storage }, { data: backups }] = await Promise.all([
        api('/api/settings/storage'),
        api('/api/system/backups')
    ]);

    if (!storage) {
        container.innerHTML = '<div class="no-data">Failed to load storage stats. Check API connectivity.</div>';
        return;
    }

    const backupsList = backups || [];
    const totalMb = (storage.total_size_bytes / (1024 * 1024)).toFixed(2);
    const freeGb = (storage.free_space_bytes / (1024 * 1024 * 1024)).toFixed(2);

    const formatSize = (bytes) => {
        if (bytes < 1024) return bytes + ' B';
        if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
        return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
    };

    container.innerHTML = `
        <div class="view-content-inner">
            <div class="header-section">
                <h1>Storage & Infrastructure</h1>
                <p>Real-time disk monitoring, active database registries, and hot database backup management.</p>
            </div>

            <div class="dashboard-grid" style="margin-bottom: 48px;">
                <div class="stat-card" style="grid-column: span 3;">
                    <div class="label">Total Disk Usage <span class="tooltip" data-tooltip="Sum of all project databases and system log metadata.">?</span></div>
                    <div class="value">${totalMb} <span style="font-size: 14px; opacity: 0.5;">MB</span></div>
                </div>
                <div class="stat-card" style="grid-column: span 3;">
                    <div class="label">System Free Space <span class="tooltip" data-tooltip="Available space on the drive where FortenLog is installed.">?</span></div>
                    <div class="value">${freeGb} <span style="font-size: 14px; opacity: 0.5;">GB</span></div>
                </div>
                <div class="stat-card" style="grid-column: span 3;">
                    <div class="label">Total Events</div>
                    <div class="value">${storage.projects.reduce((acc, p) => acc + (p.event_count || 0), 0).toLocaleString()}</div>
                </div>
                <div class="stat-card" style="grid-column: span 3;">
                    <div class="label">Last Optimization</div>
                    <div class="value" style="font-size: 16px; margin-top: 10px; font-weight: 800; color: var(--accent);">${storage.last_vacuum}</div>
                </div>
            </div>

            <div class="card" style="margin-bottom: 32px; padding: 24px; border-radius: 16px;">
                <div class="card-header" style="margin-bottom: 24px;">
                    <span>Lifecycle & Retention Policies</span>
                    <div style="display: flex; gap: 8px;">
                        <button class="btn btn-sm" onclick="seedTelemetryData()" style="background: var(--accent); color: white;">Seed Test Data</button>
                        <button class="btn btn-sm btn-primary" onclick="runInfrastructureCompression()">Generalize Logs (Compress Now)</button>
                    </div>
                </div>
                <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 32px;">
                    <div>
                        <label class="text-secondary font-bold" style="font-size: 11px; display: block; margin-bottom: 8px;">AUTO-PURGE THRESHOLD</label>
                        <div style="display: flex; align-items: center; gap: 10px;">
                            <input type="checkbox" id="auto-purge-enabled" style="width: 20px; height: 20px;" 
                                    ${(store.systemSettings?.auto_purge_enabled === 'true') ? 'checked' : ''}>
                            <span style="font-size: 13px; font-weight: 700;">Enable auto-purge at 90% usage</span>
                        </div>
                    </div>
                    <div>
                        <label class="text-secondary font-bold" style="font-size: 11px; display: block; margin-bottom: 8px;">MAX STORAGE FOOTPRINT (MB)</label>
                        <input type="number" id="max-storage-mb" class="search-input" style="width: 100%;" 
                               value="${store.systemSettings?.max_storage_mb || 0}" placeholder="0 = Unlimited">
                    </div>
                    <div>
                        <label class="text-secondary font-bold" style="font-size: 11px; display: block; margin-bottom: 8px;">COMPRESSION AGE (DAYS) <span class="tooltip" data-tooltip="Logs older than this will be generalized (details deleted, counts kept).">?</span></label>
                        <input type="number" id="compression-age-days" class="search-input" style="width: 100%;" 
                               value="${store.systemSettings?.compression_age_days || 30}" placeholder="30 days default">
                    </div>
                </div>
                <div style="margin-top: 24px; display: flex; justify-content: flex-end;">
                    <button class="btn btn-primary" onclick="saveStorageSettings()">Save Retention Policies</button>
                </div>
            </div>

            <div class="card" style="margin-bottom: 32px; padding: 24px; border-radius: 16px;">
                <div class="card-header" style="margin-bottom: 24px; border-bottom: 1px solid var(--border); padding-bottom: 16px;">
                    <div style="display: flex; align-items: center; gap: 12px;">
                        <svg style="width: 20px; height: 20px; color: var(--accent);"><use href="#icon-package"></use></svg>
                        <span>Project Database Registry</span>
                    </div>
                    <button class="btn btn-sm" onclick="vacuumAll()">Optimize Infrastructure</button>
                </div>
                <div class="project-db-grid" style="display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 16px;">
                    ${storage.projects.map(p => `
                        <div class="context-card" style="padding: 16px;">
                            <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 12px;">
                                <div>
                                    <div class="font-bold text-accent" style="font-size: 16px;">${p.name || p.id}</div>
                                    <div class="text-secondary" style="font-size: 11px; margin-top: 2px;">ID: <code>${p.id}</code> • Healthy</div>
                                </div>
                                <span class="tag-badge success" style="background: rgba(0, 184, 148, 0.1); color: #00b894;">ONLINE</span>
                            </div>
                            <div style="display: flex; gap: 24px; margin-bottom: 20px; background: var(--bg-sub); padding: 12px; border-radius: 8px;">
                                <div style="flex: 1;">
                                    <div class="text-secondary" style="font-size: 10px; font-weight: 800; margin-bottom: 4px;">EVENTS</div>
                                    <div style="font-size: 16px; font-weight: 800;">${(p.event_count || 0).toLocaleString()}</div>
                                </div>
                                <div style="flex: 1; border-left: 1px solid var(--border); padding-left: 16px;">
                                    <div class="text-secondary" style="font-size: 10px; font-weight: 800; margin-bottom: 4px;">DISK SIZE</div>
                                    <div style="font-size: 16px; font-weight: 800;">${(p.size_bytes / 1024 / 1024).toFixed(2)} <span style="font-size: 11px; opacity: 0.5;">MB</span></div>
                                </div>
                            </div>
                            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px;">
                                <button class="btn btn-sm" onclick="createBackup('${p.id}')">Backup</button>
                                <button class="btn btn-sm" onclick="optimizeProject('${p.id}')">Optimize</button>
                                <button class="btn btn-sm btn-danger" style="grid-column: span 2;" onclick="clearProjectData('${p.id}')">Purge All Data</button>
                            </div>
                        </div>
                    `).join('')}
                    ${storage.projects.length === 0 ? '<div class="no-data" style="grid-column: span 12;">No projects found in database registry.</div>' : ''}
                </div>
            </div>

            <!-- BACKUP SNAPSHOT MANAGER -->
            <div class="card" style="margin-bottom: 32px; padding: 24px; border-radius: 16px;">
                <div class="card-header" style="margin-bottom: 24px; border-bottom: 1px solid var(--border); padding-bottom: 16px; display: flex; justify-content: space-between; align-items: center;">
                    <div style="display: flex; align-items: center; gap: 12px;">
                        <span style="font-size: 20px;">🛡️</span>
                        <span>Backup Snapshot Manager</span>
                    </div>
                    <button class="btn btn-sm btn-primary" onclick="createFullSystemBackup()">Create Full System Backup</button>
                </div>
                
                <div class="table-container" style="border: 1px solid var(--border); border-radius: 8px; overflow: hidden; background: var(--bg-sub);">
                    <table style="width: 100%; border-collapse: collapse; font-size: 13px; text-align: left;">
                        <thead>
                            <tr style="background: rgba(255,255,255,0.02); border-bottom: 1px solid var(--border);">
                                <th style="padding: 12px 16px; font-weight: 800; color: var(--text-secondary); width: 100px;">TYPE</th>
                                <th style="padding: 12px 16px; font-weight: 800; color: var(--text-secondary); width: 120px;">SOURCE</th>
                                <th style="padding: 12px 16px; font-weight: 800; color: var(--text-secondary);">SNAPSHOT FILENAME</th>
                                <th style="padding: 12px 16px; font-weight: 800; color: var(--text-secondary); width: 100px;">FILE SIZE</th>
                                <th style="padding: 12px 16px; font-weight: 800; color: var(--text-secondary); width: 180px;">CREATED AT</th>
                                <th style="padding: 12px 16px; font-weight: 800; color: var(--text-secondary); text-align: right; width: 180px;">ACTIONS</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${backupsList.map(b => `
                                <tr style="border-bottom: 1px solid var(--border);">
                                    <td style="padding: 12px 16px; vertical-align: middle;">
                                        <span class="tag-badge" style="padding: 2px 8px; border-radius: 4px; font-size: 10px; font-weight: 800; background: ${b.type === 'system' ? 'rgba(110, 99, 243, 0.15)' : 'rgba(0, 206, 201, 0.15)'}; color: ${b.type === 'system' ? 'var(--accent)' : '#00cec9'};">
                                            ${b.type.toUpperCase()}
                                        </span>
                                    </td>
                                    <td style="padding: 12px 16px; vertical-align: middle; font-weight: 800;">
                                        ${b.id}
                                    </td>
                                    <td style="padding: 12px 16px; vertical-align: middle; font-family: monospace; color: var(--text-secondary);">
                                        ${b.filename}
                                    </td>
                                    <td style="padding: 12px 16px; vertical-align: middle;">
                                        ${formatSize(b.size_bytes)}
                                    </td>
                                    <td style="padding: 12px 16px; vertical-align: middle; color: var(--text-secondary);">
                                        ${b.created_at}
                                    </td>
                                    <td style="padding: 12px 16px; vertical-align: middle; text-align: right;">
                                        <div style="display: flex; gap: 8px; justify-content: flex-end;">
                                            <button class="btn btn-sm" onclick="restoreBackupSnapshot('${b.filename}')" style="background: rgba(46, 204, 113, 0.15); color: #2ecc71; border: 1px solid rgba(46, 204, 113, 0.3); font-weight: 700; height: 28px; line-height: 26px; padding: 0 10px;">Restore</button>
                                            <button class="btn btn-sm btn-danger" onclick="deleteBackupSnapshot('${b.filename}')" style="height: 28px; line-height: 26px; padding: 0 10px;">Delete</button>
                                        </div>
                                    </td>
                                </tr>
                            `).join('')}
                            ${backupsList.length === 0 ? `
                                <tr>
                                    <td colspan="6" style="padding: 32px; text-align: center; color: var(--text-secondary);">
                                        No backup snapshots created yet. Click "Create Full System Backup" above or "Backup" on any project database database.
                                    </td>
                                </tr>
                            ` : ''}
                        </tbody>
                    </table>
                </div>
            </div>

            <!-- AUTOMATED BACKUP SCHEDULER SETTINGS -->
            <div class="card" style="margin-bottom: 32px; padding: 24px; border-radius: 16px; background: var(--bg-sub); border: 1px solid var(--accent-light);">
                <div class="card-header" style="margin-bottom: 24px;">
                    <div style="display: flex; align-items: center; gap: 12px;">
                        <span style="font-size: 20px;">⚙️</span>
                        <span>Automated Backup Scheduler Settings</span>
                    </div>
                </div>
                <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 32px; align-items: flex-end;">
                    <div>
                        <label class="text-secondary font-bold" style="font-size: 11px; display: block; margin-bottom: 8px;">AUTOMATED BACKUPS</label>
                        <div style="display: flex; align-items: center; gap: 10px;">
                            <input type="checkbox" id="auto-backup-enabled" style="width: 20px; height: 20px;" 
                                    ${(store.systemSettings?.auto_backup_enabled === 'true') ? 'checked' : ''}>
                            <span style="font-size: 13px; font-weight: 700;">Enable background auto-backups</span>
                        </div>
                    </div>
                    <div>
                        <label class="text-secondary font-bold" style="font-size: 11px; display: block; margin-bottom: 8px;">BACKUP SCHEDULE</label>
                        <select id="backup-schedule" class="search-input" style="width: 100%; height: 38px;">
                            <option value="hourly" ${(store.systemSettings?.backup_schedule === 'hourly') ? 'selected' : ''}>Hourly Snapshots</option>
                            <option value="twice_daily" ${(store.systemSettings?.backup_schedule === 'twice_daily') ? 'selected' : ''}>Twice Daily (every 12 hours)</option>
                            <option value="daily" ${(store.systemSettings?.backup_schedule === 'daily' || !store.systemSettings?.backup_schedule) ? 'selected' : ''}>Daily (at 03:00 UTC)</option>
                            <option value="three_times_weekly" ${(store.systemSettings?.backup_schedule === 'three_times_weekly') ? 'selected' : ''}>Three times a week (Mon, Wed, Fri)</option>
                            <option value="weekly" ${(store.systemSettings?.backup_schedule === 'weekly') ? 'selected' : ''}>Weekly (on Sundays)</option>
                        </select>
                    </div>
                    <div>
                        <label class="text-secondary font-bold" style="font-size: 11px; display: block; margin-bottom: 8px;">SNAPSHOT RETENTION LIMIT <span class="tooltip" data-tooltip="The maximum number of recent backups to keep for the system and each project database (default is 2).">?</span></label>
                        <input type="number" id="backup-retention-limit" class="search-input" style="width: 100%; height: 38px;" 
                               value="${store.systemSettings?.backup_retention_limit || 2}" min="1" placeholder="2">
                    </div>
                </div>
                <div style="margin-top: 24px; display: flex; justify-content: flex-end;">
                    <button class="btn btn-primary" onclick="saveAutoBackupSettings()">Save Backup Configuration</button>
                </div>
            </div>
        </div>`;
}

window.saveStorageSettings = async () => {
    const settings = {
        auto_purge_enabled: document.getElementById('auto-purge-enabled').checked ? 'true' : 'false',
        max_storage_mb: document.getElementById('max-storage-mb').value,
        compression_age_days: document.getElementById('compression-age-days').value,
    };
    await api('/api/system/settings', { method: 'POST', body: JSON.stringify(settings) });
    alert('Storage policies updated and enforced.');
    await refreshData();
};

window.saveAutoBackupSettings = async () => {
    const settings = {
        auto_backup_enabled: document.getElementById('auto-backup-enabled').checked ? 'true' : 'false',
        backup_schedule: document.getElementById('backup-schedule').value,
        backup_retention_limit: document.getElementById('backup-retention-limit').value,
    };
    await api('/api/system/settings', { method: 'POST', body: JSON.stringify(settings) });
    alert('Automated backup policies successfully saved.');
    await refreshData();
    renderStorage(document.getElementById('view-content'));
};

window.runInfrastructureCompression = async () => {
    if (confirm('Initiate global data compression? This will delete detailed logs older than the configured threshold while keeping statistics.')) {
        await api('/api/system/maintenance/compress', { method: 'POST' });
        alert('Compression cycle completed. Infrastructure optimized.');
        await refreshData();
        renderStorage(document.getElementById('view-content'));
    }
};

window.vacuumAll = async () => {
    if (confirm('Initiate global infrastructure optimization? This will VACUUM all project databases.')) {
        try {
            await api('/api/system/vacuum', { method: 'POST' });
            alert('Global optimization successfully completed. All databases have been VACUUMed.');
            await refreshData();
            renderStorage(document.getElementById('view-content'));
        } catch (e) {
            alert('Failed to optimize global infrastructure: ' + e.message);
        }
    }
};

window.optimizeProject = async (id) => {
    await api(`/api/settings/storage/${id}/vacuum`, { method: 'POST' });
    alert(`Project ${id} optimized successfully.`);
    await refreshData();
    renderStorage(document.getElementById('view-content'));
};

window.createBackup = async (id) => {
    await api(`/api/settings/storage/${id}/backup`, { method: 'POST' });
    alert(`Encrypted hot backup snapshot for project "${id}" successfully created.`);
    await refreshData();
    renderStorage(document.getElementById('view-content'));
};

window.createFullSystemBackup = async () => {
    await api('/api/system/backup', { method: 'POST' });
    alert('Full system configuration backup snapshot successfully created.');
    await refreshData();
    renderStorage(document.getElementById('view-content'));
};

window.deleteBackupSnapshot = async (filename) => {
    if (confirm(`Permanently delete the backup snapshot "${filename}"? This action is irreversible.`)) {
        const { status } = await api(`/api/system/backups/${filename}`, { method: 'DELETE' });
        if (status === 200) {
            alert('Backup snapshot deleted successfully.');
            await refreshData();
            renderStorage(document.getElementById('view-content'));
        } else {
            alert('Failed to delete backup snapshot.');
        }
    }
};

window.restoreBackupSnapshot = async (filename) => {
    if (confirm(`CRITICAL WARNING: Are you absolutely sure you want to restore the backup snapshot "${filename}"?\n\nThis will completely roll back active database files and overwrite current data. System database connection pools will be refreshed automatically.`)) {
        const { status } = await api(`/api/system/backups/${filename}/restore`, { method: 'POST' });
        if (status === 200) {
            alert('Database successfully restored! Active connection pools reloaded.');
            await refreshData();
            renderStorage(document.getElementById('view-content'));
        } else {
            alert('Database restoration failed.');
        }
    }
};

window.clearProjectData = (id) => {
    window.dispatchEvent(new CustomEvent('open-modal', {
        detail: {
            title: 'Purge Project Data',
            html: `
                <div style="padding: 8px 0;">
                    <div style="display: flex; gap: 16px; margin-bottom: 20px; align-items: flex-start; background: rgba(255, 76, 76, 0.1); border: 1px solid var(--danger); padding: 16px; border-radius: 12px;">
                        <span style="font-size: 24px;">⚠️</span>
                        <div style="font-size: 13px; line-height: 1.5; color: var(--text-main);">
                            <strong>WARNING:</strong> This action will permanently and irreversibly delete <strong>ALL</strong> event log history and telemetry metadata for project <strong>"${id}"</strong>.
                        </div>
                    </div>
                    
                    <div style="margin-bottom: 24px;">
                        <label class="text-secondary font-bold" style="font-size: 11px; display: block; margin-bottom: 8px; letter-spacing: 0.05em;">ADMINISTRATIVE PASSWORD</label>
                        <input type="password" id="confirm-purge-password" class="search-input" style="width: 100%; box-sizing: border-box;" placeholder="Enter administrative password to confirm">
                    </div>
                    
                    <div style="display: flex; gap: 12px;">
                        <button class="btn btn-danger" id="btn-modal-confirm-purge" style="flex: 1; height: 44px; font-weight: 700;">Purge All Data</button>
                        <button class="btn" onclick="closeModal()" style="flex: 1; height: 44px;">Cancel</button>
                    </div>
                </div>
            `,
            onRender: (content) => {
                const passwordInput = content.querySelector('#confirm-purge-password');
                const confirmBtn = content.querySelector('#btn-modal-confirm-purge');
                
                // Focus the input immediately
                setTimeout(() => passwordInput.focus(), 50);
                
                const handlePurge = async () => {
                    const password = passwordInput.value;
                    if (!password) {
                        alert('Password is required.');
                        return;
                    }
                    
                    confirmBtn.disabled = true;
                    confirmBtn.textContent = 'Purging...';
                    
                    try {
                        const { status } = await api(`/api/issues/clear/${id}`, {
                            method: 'POST',
                            body: JSON.stringify({ password })
                        });
                        
                        if (status === 200) {
                            alert('Project data purged successfully.');
                            window.closeModal();
                            await refreshData();
                            renderStorage(document.getElementById('view-content'));
                        } else {
                            alert('Access denied: Invalid administrative password.');
                            confirmBtn.disabled = false;
                            confirmBtn.textContent = 'Purge All Data';
                            passwordInput.focus();
                        }
                    } catch (e) {
                        alert('Security verification failed. Please try again.');
                        confirmBtn.disabled = false;
                        confirmBtn.textContent = 'Purge All Data';
                    }
                };
                
                confirmBtn.onclick = handlePurge;
                
                passwordInput.onkeydown = (e) => {
                    if (e.key === 'Enter') {
                        handlePurge();
                    }
                };
            }
        }
    }));
};

window.seedTelemetryData = async () => {
    if (confirm('Generate enterprise-grade realistic mock telemetry data? This will create three default projects with hundreds of preloader, TypeError, and analytics events.')) {
        try {
            await api('/api/system/seed', { method: 'POST' });
            alert('Mock data successfully generated! Refreshing dashboard...');
            await refreshData();
            renderStorage(document.getElementById('view-content'));
        } catch (e) {
            alert('Failed to seed data: ' + e.message);
        }
    }
};
