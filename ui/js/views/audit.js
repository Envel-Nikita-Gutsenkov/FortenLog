import { api } from '../api.js';

export async function renderAudit(container) {
    container.innerHTML = `
        <div class="view-content-inner">
            <!-- Header Section -->
            <div class="header-section" style="margin-bottom: 32px;">
                <h1>Security Audit Log</h1>
                <p>Complete history of administrative actions, authentication attempts, and security-sensitive configurations.</p>
            </div>

            <!-- Advanced Corporate Filter Toolbar -->
            <div class="card" style="padding: 20px; border-radius: 12px; margin-bottom: 24px; background: var(--card-bg); border: 1px solid var(--border); box-shadow: var(--shadow-sm);">
                <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 16px;">
                    <div style="display: flex; align-items: center; gap: 12px; flex-wrap: wrap; flex: 1;">
                        <!-- Live Search Input -->
                        <input type="text" id="audit-search" class="search-input" placeholder="Search by details or IP address..." style="width: 250px; height: 38px; padding-left: 12px; font-size: 13px; border-radius: 6px; border: 1px solid var(--border); background: var(--bg-sub); color: var(--text-primary);">

                        <!-- Action Type Dropdown -->
                        <select id="audit-action-filter" class="search-input" style="width: 190px; height: 38px; font-size: 13px; border-radius: 6px; border: 1px solid var(--border); background: var(--bg-sub); color: var(--text-primary); cursor: pointer;">
                            <option value="all">All Action Types</option>
                            <option value="LOGIN_">Authentication Attempts</option>
                            <option value="PROJECT_">Project Changes</option>
                            <option value="USER_">User Management</option>
                            <option value="SETTINGS_">Server Configurations</option>
                            <option value="BACKUP_">Backup & Restore</option>
                            <option value="DATA_">Data Operations</option>
                        </select>

                        <!-- Dynamic Username Dropdown -->
                        <select id="audit-user-filter" class="search-input" style="width: 160px; height: 38px; font-size: 13px; border-radius: 6px; border: 1px solid var(--border); background: var(--bg-sub); color: var(--text-primary); cursor: pointer;">
                            <option value="all">All Users</option>
                        </select>

                        <!-- Time Recency Dropdown -->
                        <select id="audit-time-filter" class="search-input" style="width: 160px; height: 38px; font-size: 13px; border-radius: 6px; border: 1px solid var(--border); background: var(--bg-sub); color: var(--text-primary); cursor: pointer;">
                            <option value="all">All Time</option>
                            <option value="24h">Last 24 Hours</option>
                            <option value="7d">Last 7 Days</option>
                            <option value="30d">Last 30 Days</option>
                        </select>
                    </div>

                    <!-- Clean Corporate Action Buttons -->
                    <div style="display: flex; align-items: center; gap: 12px;">
                        <button id="btn-export-audit" class="btn btn-primary" style="height: 38px; font-weight: 700; border-radius: 6px; padding: 0 16px; font-size: 13px; display: flex; align-items: center; justify-content: center;">
                            Export CSV
                        </button>
                        <button id="btn-refresh-audit" class="btn" style="height: 38px; border-radius: 6px; padding: 0 16px; font-size: 13px; background: var(--bg-sub); border: 1px solid var(--border); color: var(--text-primary); font-weight: 600;">
                            Refresh
                        </button>
                        <button id="btn-clear-audit" class="btn btn-danger" style="height: 38px; font-weight: 700; border-radius: 6px; padding: 0 16px; font-size: 13px; display: flex; align-items: center; justify-content: center;">
                            Purge Logs
                        </button>
                    </div>
                </div>
            </div>

            <!-- Corporate Table Structure -->
            <div class="card" style="padding: 0; overflow: hidden; border-radius: 12px; border: 1px solid var(--border); box-shadow: var(--shadow-sm); background: var(--card-bg);">
                <table class="issue-table" style="width: 100%; border-collapse: separate; border-spacing: 0;">
                    <thead>
                        <tr style="background: var(--bg-sub);">
                            <th id="th-timestamp" style="width: 220px; padding: 14px 24px; cursor: pointer; user-select: none; border-bottom: 2px solid var(--border); color: var(--text-secondary); font-size: 11px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.5px;">
                                Timestamp <span id="sort-arrow" style="font-family: monospace; margin-left: 4px; font-size: 12px;">&darr;</span>
                            </th>
                            <th style="width: 180px; padding: 14px 20px; border-bottom: 2px solid var(--border); color: var(--text-secondary); font-size: 11px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.5px;">User</th>
                            <th style="width: 200px; padding: 14px 20px; border-bottom: 2px solid var(--border); color: var(--text-secondary); font-size: 11px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.5px;">Action Type</th>
                            <th style="padding: 14px 24px; border-bottom: 2px solid var(--border); color: var(--text-secondary); font-size: 11px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.5px;">Details</th>
                        </tr>
                    </thead>
                    <tbody id="audit-tbody">
                        <tr>
                            <td colspan="4" style="text-align:center; padding: 80px;">
                                <div class="spinner" style="margin: 0 auto;"></div>
                            </td>
                        </tr>
                    </tbody>
                </table>
            </div>
        </div>
    `;

    const tbody = container.querySelector('#audit-tbody');
    const searchInput = container.querySelector('#audit-search');
    const actionFilter = container.querySelector('#audit-action-filter');
    const userFilter = container.querySelector('#audit-user-filter');
    const timeFilter = container.querySelector('#audit-time-filter');
    const exportBtn = container.querySelector('#btn-export-audit');
    const refreshBtn = container.querySelector('#btn-refresh-audit');
    const thTimestamp = container.querySelector('#th-timestamp');
    const sortArrow = container.querySelector('#sort-arrow');

    let rawLogs = [];
    let isDescending = true;

    // Load and compile logs
    async function loadLogs() {
        tbody.innerHTML = `<tr><td colspan="4" style="text-align:center; padding: 80px;"><div class="spinner" style="margin: 0 auto;"></div></td></tr>`;
        try {
            const { data: logs } = await api('/api/settings/audit');
            rawLogs = logs || [];
            
            // Dynamically populate the Username filter with unique users present in logs
            populateUserDropdown();
            
            applyFilters();
        } catch (err) {
            console.error("Failed to load audit logs:", err);
            tbody.innerHTML = `<tr><td colspan="4" class="no-data" style="color: var(--error);">Failed to load security audit log. Please try again.</td></tr>`;
        }
    }

    // Populate dynamic user list
    function populateUserDropdown() {
        const uniqueUsers = [...new Set(rawLogs.map(l => l.username))].filter(Boolean).sort();
        
        // Save current selection to restore if valid
        const currentSelection = userFilter.value;
        
        userFilter.innerHTML = `<option value="all">All Users</option>` + 
            uniqueUsers.map(u => `<option value="${escapeHtml(u)}">${escapeHtml(u)}</option>`).join('');
            
        if (uniqueUsers.includes(currentSelection)) {
            userFilter.value = currentSelection;
        }
    }

    // Filter and Sort Table
    function applyFilters() {
        const query = searchInput.value.toLowerCase().trim();
        const actionPrefix = actionFilter.value;
        const selectedUser = userFilter.value;
        const selectedTimeFrame = timeFilter.value;

        const now = Date.now();

        let filtered = rawLogs.filter(l => {
            // 1. Text Search query
            const matchesQuery = 
                (l.username || '').toLowerCase().includes(query) || 
                (l.action || '').toLowerCase().includes(query) || 
                (l.details || '').toLowerCase().includes(query);

            // 2. Action Type Prefix
            const matchesAction = actionPrefix === 'all' || (l.action || '').startsWith(actionPrefix);

            // 3. User filter
            const matchesUser = selectedUser === 'all' || l.username === selectedUser;

            // 4. Time Recency filter
            let matchesTime = true;
            if (selectedTimeFrame !== 'all') {
                const logTime = new Date(l.timestamp).getTime();
                const diffMs = now - logTime;
                if (selectedTimeFrame === '24h') {
                    matchesTime = diffMs <= 24 * 60 * 60 * 1000;
                } else if (selectedTimeFrame === '7d') {
                    matchesTime = diffMs <= 7 * 24 * 60 * 60 * 1000;
                } else if (selectedTimeFrame === '30d') {
                    matchesTime = diffMs <= 30 * 24 * 60 * 60 * 1000;
                }
            }

            return matchesQuery && matchesAction && matchesUser && matchesTime;
        });

        // Apply Timestamp Sort
        filtered.sort((a, b) => {
            const timeA = new Date(a.timestamp).getTime();
            const timeB = new Date(b.timestamp).getTime();
            return isDescending ? timeB - timeA : timeA - timeB;
        });

        renderRows(filtered);
    }

    // Render Rows Into Dom
    function renderRows(logs) {
        if (logs.length === 0) {
            tbody.innerHTML = `<tr><td colspan="4" class="no-data" style="padding: 80px; text-align: center; color: var(--text-secondary);">No matching security audit logs found.</td></tr>`;
            return;
        }

        tbody.innerHTML = logs.map(l => {
            const action = l.action || 'UNKNOWN';
            
            // Clean corporate color-coded variables (no excessive glows or badges)
            let badgeStyle = '';
            if (action.includes('DELETE') || action.includes('FAILURE') || action.includes('PURGE') || action.includes('REVOKE')) {
                // Red/Danger Alert
                badgeStyle = 'background: rgba(230, 57, 70, 0.08); color: #e63946; border: 1px solid rgba(230, 57, 70, 0.2);';
            } else if (action.includes('CREATE') || action.includes('SUCCESS') || action.includes('ENABLE') || action.includes('RESTORE')) {
                // Green/Success
                badgeStyle = 'background: rgba(0, 184, 148, 0.08); color: #00b894; border: 1px solid rgba(0, 184, 148, 0.2);';
            } else if (action.includes('UPDATE') || action.includes('RESET') || action.includes('CHANGE')) {
                // Yellow/Orange modifications
                badgeStyle = 'background: rgba(241, 196, 15, 0.08); color: #d6a100; border: 1px solid rgba(241, 196, 15, 0.2);';
            } else {
                // Standard blue/purple badge
                badgeStyle = 'background: rgba(93, 81, 232, 0.08); color: var(--accent); border: 1px solid rgba(93, 81, 232, 0.2);';
            }

            return `
                <tr class="issue-row">
                    <td class="text-secondary" style="font-size: 12px; padding: 14px 24px; font-family: 'Roboto Mono', monospace;">
                        ${new Date(l.timestamp).toLocaleString()}
                    </td>
                    <td style="padding: 14px 20px;">
                        <span style="font-size: 13px; font-weight: 700; color: var(--text-primary);">${escapeHtml(l.username)}</span>
                    </td>
                    <td style="padding: 14px 20px;">
                        <span class="badge" style="padding: 4px 8px; border-radius: 4px; font-family: 'Roboto Mono', monospace; font-size: 11px; font-weight: 700; ${badgeStyle}">
                            ${escapeHtml(action)}
                        </span>
                    </td>
                    <td class="text-secondary" style="font-size: 13px; padding: 14px 24px; word-break: break-all; max-width: 600px; line-height: 1.5;">
                        ${escapeHtml(l.details)}
                    </td>
                </tr>
            `;
        }).join('');
    }

    // Toggle Sort Arrow and State
    thTimestamp.onclick = () => {
        isDescending = !isDescending;
        sortArrow.innerHTML = isDescending ? '&darr;' : '&uarr;';
        applyFilters();
    };

    // Client-side CSV Compilation & Download
    exportBtn.onclick = () => {
        const query = searchInput.value.toLowerCase().trim();
        const actionPrefix = actionFilter.value;
        const selectedUser = userFilter.value;
        const selectedTimeFrame = timeFilter.value;
        const now = Date.now();

        const filtered = rawLogs.filter(l => {
            const matchesQuery = 
                (l.username || '').toLowerCase().includes(query) || 
                (l.action || '').toLowerCase().includes(query) || 
                (l.details || '').toLowerCase().includes(query);
            const matchesAction = actionPrefix === 'all' || (l.action || '').startsWith(actionPrefix);
            const matchesUser = selectedUser === 'all' || l.username === selectedUser;
            
            let matchesTime = true;
            if (selectedTimeFrame !== 'all') {
                const logTime = new Date(l.timestamp).getTime();
                const diffMs = now - logTime;
                if (selectedTimeFrame === '24h') {
                    matchesTime = diffMs <= 24 * 60 * 60 * 1000;
                } else if (selectedTimeFrame === '7d') {
                    matchesTime = diffMs <= 7 * 24 * 60 * 60 * 1000;
                } else if (selectedTimeFrame === '30d') {
                    matchesTime = diffMs <= 30 * 24 * 60 * 60 * 1000;
                }
            }

            return matchesQuery && matchesAction && matchesUser && matchesTime;
        });

        if (filtered.length === 0) {
            alert("No audit logs to export.");
            return;
        }

        let csvContent = "data:text/csv;charset=utf-8,";
        csvContent += "Timestamp,User,Action Type,Details\n";

        filtered.forEach(l => {
            const row = [
                new Date(l.timestamp).toLocaleString().replace(/,/g, ""),
                l.username,
                l.action,
                `"${l.details.replace(/"/g, '""')}"`
            ];
            csvContent += row.join(",") + "\n";
        });

        const encodedUri = encodeURI(csvContent);
        const link = document.createElement("a");
        link.setAttribute("href", encodedUri);
        link.setAttribute("download", `security_audit_log_${new Date().toISOString().slice(0,10)}.csv`);
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    };

    // Input listeners for filter triggers
    searchInput.oninput = applyFilters;
    actionFilter.onchange = applyFilters;
    userFilter.onchange = applyFilters;
    timeFilter.onchange = applyFilters;
    refreshBtn.onclick = loadLogs;
    
    const clearBtn = container.querySelector('#btn-clear-audit');
    if (clearBtn) {
        clearBtn.onclick = () => {
            window.dispatchEvent(new CustomEvent('open-modal', {
                detail: {
                    title: 'Purge Security Audit Log',
                    html: `
                        <div style="padding: 8px 0;">
                            <div style="display: flex; gap: 16px; margin-bottom: 20px; align-items: flex-start; background: rgba(255, 76, 76, 0.1); border: 1px solid var(--danger); padding: 16px; border-radius: 12px;">
                                <span style="font-size: 24px;">⚠️</span>
                                <div style="font-size: 13px; line-height: 1.5; color: var(--text-main);">
                                    <strong>WARNING:</strong> This action will permanently and irreversibly purge security audit log history older than the selected interval.
                                </div>
                            </div>
                            
                            <div style="margin-bottom: 20px;">
                                <label class="text-secondary font-bold" style="font-size: 11px; display: block; margin-bottom: 8px; letter-spacing: 0.05em;">PURGE THRESHOLD</label>
                                <select id="confirm-purge-audit-days" class="search-input" style="width: 100%; height: 38px; font-size: 13px; border-radius: 6px; border: 1px solid var(--border); background: var(--bg-sub); color: var(--text-primary); cursor: pointer;">
                                    <option value="14">Older than 14 days</option>
                                    <option value="30" selected>Older than 30 days</option>
                                    <option value="90">Older than 90 days</option>
                                    <option value="180">Older than 180 days</option>
                                    <option value="365">Older than 365 days</option>
                                </select>
                            </div>
                            
                            <div style="margin-bottom: 24px;">
                                <label class="text-secondary font-bold" style="font-size: 11px; display: block; margin-bottom: 8px; letter-spacing: 0.05em;">ADMINISTRATIVE PASSWORD</label>
                                <input type="password" id="confirm-purge-audit-password" class="search-input" style="width: 100%; box-sizing: border-box;" placeholder="Enter administrative password to confirm">
                            </div>
                            
                            <div style="display: flex; gap: 12px;">
                                <button class="btn btn-danger" id="btn-modal-confirm-purge-audit" style="flex: 1; height: 44px; font-weight: 700;">Purge Old Logs</button>
                                <button class="btn" onclick="closeModal()" style="flex: 1; height: 44px;">Cancel</button>
                            </div>
                        </div>
                    `,
                    onRender: (content) => {
                        const passwordInput = content.querySelector('#confirm-purge-audit-password');
                        const confirmBtn = content.querySelector('#btn-modal-confirm-purge-audit');
                        const daysSelect = content.querySelector('#confirm-purge-audit-days');
                        
                        setTimeout(() => passwordInput.focus(), 50);
                        
                        const handlePurge = async () => {
                            const password = passwordInput.value;
                            const retention_days = parseInt(daysSelect.value) || 30;
                            if (!password) {
                                alert('Password is required.');
                                return;
                            }
                            
                            confirmBtn.disabled = true;
                            confirmBtn.textContent = 'Purging...';
                            
                            try {
                                const res = await api('/api/settings/audit/clear', {
                                    method: 'POST',
                                    body: JSON.stringify({ password, retention_days })
                                });
                                
                                if (res && res.status === 200) {
                                    alert('Security audit logs purged successfully.');
                                    window.closeModal();
                                    await loadLogs();
                                } else {
                                    alert('Access denied: Invalid administrative password.');
                                    confirmBtn.disabled = false;
                                    confirmBtn.textContent = 'Purge Old Logs';
                                    passwordInput.focus();
                                }
                            } catch (e) {
                                alert('Security verification failed. Please try again.');
                                confirmBtn.disabled = false;
                                confirmBtn.textContent = 'Purge Old Logs';
                            }
                        };
                        
                        confirmBtn.onclick = handlePurge;
                        passwordInput.onkeydown = (e) => {
                            if (e.key === 'Enter') handlePurge();
                        };
                    }
                }
            }));
        };
    }

    // Escape HTML Helper
    function escapeHtml(str) {
        if (!str) return '';
        return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
    }

    // Call first load
    await loadLogs();
}
