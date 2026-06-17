import { store } from '../store.js';
import { api, refreshData } from '../api.js';

function getOutageIncidents(logs) {
    const incidents = [];
    let currentIncident = null;
    
    // Scan chronological order (oldest first)
    const chronoLogs = [...logs].reverse();
    
    for (let i = 0; i < chronoLogs.length; i++) {
        const log = chronoLogs[i];
        if (!log.is_up) {
            if (!currentIncident) {
                currentIncident = {
                    start: new Date(log.timestamp),
                    end: new Date(log.timestamp),
                    statusCodes: new Set([log.status_code || 'Timeout']),
                    count: 1
                };
            } else {
                currentIncident.end = new Date(log.timestamp);
                currentIncident.statusCodes.add(log.status_code || 'Timeout');
                currentIncident.count++;
            }
        } else {
            if (currentIncident) {
                incidents.push(currentIncident);
                currentIncident = null;
            }
        }
    }
    if (currentIncident) {
        incidents.push(currentIncident);
    }
    
    // Sort so most recent outage is first
    return incidents.reverse();
}

export function renderUptime(container) {
    const monitors = store.monitors || [];
    window.expandedUptimeMonitors = window.expandedUptimeMonitors || [];
    
    container.innerHTML = `
        <div class="view-content-inner">
            <div class="header-section" style="display: flex; justify-content: space-between; align-items: flex-end;">
                <div>
                    <h1>Uptime Monitoring</h1>
                    <p>Track availability, latency history, and performance of critical endpoints in real-time.</p>
                </div>
                <button class="btn btn-primary" onclick="openAddMonitorModal()">+ Add Monitor</button>
            </div>

            ${monitors.length === 0 ? `
                <div style="text-align: center; padding: 100px 0; background: var(--bg-sub); border-radius: 16px; border: 2px dashed var(--border); margin-top: 24px;">
                    <span style="font-size: 48px; display: block; margin-bottom: 20px;">📡</span>
                    <h2 style="color: var(--text-primary); font-weight: 800; font-size: 18px;">No monitors found</h2>
                    <p style="color: var(--text-secondary); margin-top: 8px; font-size: 13px;">Add your first HTTP(S) endpoint to start monitoring.</p>
                </div>
            ` : `
                <div class="card" style="padding: 0; overflow: hidden; border-radius: 16px;">
                    <table class="issue-table" style="width: 100%; border-collapse: separate; border-spacing: 0;">
                        <thead>
                            <tr>
                                <th style="width: 40px; padding: 16px 24px;">
                                    <input type="checkbox" id="uptime-header-checkbox" onchange="window.toggleAllUptimeCheckbox(this)" style="cursor: pointer; width: 16px; height: 16px;">
                                </th>
                                <th style="width: 320px;">Name</th>
                                <th style="width: 280px;">Last Issue</th>
                                <th style="width: 100px;">Assignee</th>
                                <th style="width: 80px;">Alerts</th>
                                <th style="padding-right: 24px;">Uptime History (Last 24h)</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${monitors.map(m => {
                                const isUp = m.status === 'up';
                                const isDown = m.status === 'down';
                                const isPending = !m.status || m.status === 'unknown';
                                const isExpanded = window.expandedUptimeMonitors.includes(m.id);
                                
                                return `
                                    <tr id="row-${m.id}" onclick="toggleMonitorExpand('${m.id}')" style="cursor: pointer; transition: background 0.2s;" onmouseover="this.style.background='rgba(255,255,255,0.02)'" onmouseout="this.style.background=''">
                                        <td style="padding: 16px 24px; vertical-align: middle;" onclick="event.stopPropagation();">
                                            <input type="checkbox" data-id="${m.id}" onchange="window.updateUptimeSelection()" style="cursor: pointer; width: 16px; height: 16px;">
                                        </td>
                                        <td style="vertical-align: middle;">
                                            <div style="font-weight: 800; font-size: 14px; color: var(--text-primary);">${m.name}</div>
                                            <div style="display: flex; align-items: center; gap: 8px; color: var(--text-secondary); font-size: 11px; margin-top: 4px; font-weight: 600;">
                                                <span style="display: inline-flex; align-items: center; justify-content: center; width: 14px; height: 14px; border-radius: 3px; background: ${isUp ? 'rgba(0,184,148,0.1)' : (isDown ? 'rgba(230,57,70,0.1)' : 'rgba(255,255,255,0.05)')}; color: ${isUp ? '#00b894' : (isDown ? '#e63946' : 'var(--text-secondary)')}; font-size: 9px;">■</span>
                                                <span>http</span>
                                                <span style="opacity: 0.5;">|</span>
                                                <span style="font-family: 'Roboto Mono', monospace; font-size: 10px;">${m.url}</span>
                                                <span style="opacity: 0.5;">|</span>
                                                <span>Every ${m.interval_secs / 60 || 1} min</span>
                                            </div>
                                        </td>
                                        <td style="vertical-align: middle;">
                                            <div style="display: flex; align-items: center; gap: 8px;">
                                                <span style="font-size: 13px;">${isUp ? '🟢' : (isDown ? '🚨' : '🟡')}</span>
                                                <span style="font-weight: 800; font-size: 12px; color: ${isUp ? 'var(--text-primary)' : (isDown ? 'var(--error)' : 'var(--text-secondary)')};">
                                                    ${isUp ? 'Operational status' : (isDown ? 'Downtime detected for ' + m.url : 'Initializing monitor...')}
                                                </span>
                                            </div>
                                            <div style="font-size: 11px; color: var(--text-secondary); margin-top: 4px; font-weight: 600; padding-left: 21px;">
                                                ${isUp ? 'All checks successful' : (isDown ? 'Last seen just now' : 'Waiting for first ping cycle')}
                                            </div>
                                        </td>
                                        <td style="vertical-align: middle; font-weight: 700; color: var(--text-secondary); font-size: 12px;">—</td>
                                        <td style="vertical-align: middle; font-weight: 700; color: var(--text-secondary); font-size: 12px;">—</td>
                                        <td style="vertical-align: middle; padding-right: 24px;">
                                            <div style="display: flex; flex-direction: column; gap: 6px; align-items: flex-end; width: 100%;">
                                                <div style="display: flex; justify-content: space-between; width: 100%; max-width: 320px; font-size: 9px; color: var(--text-secondary); font-weight: 800; letter-spacing: 0.05em; text-transform: uppercase;">
                                                    <span>24h ago</span>
                                                    <span>12h ago</span>
                                                    <span style="color: var(--accent); font-weight: 900;" id="chevron-${m.id}">${isExpanded ? '«' : '»'}</span>
                                                </div>
                                                <div style="display: flex; gap: 2px; width: 100%; max-width: 320px; height: 28px; background: rgba(0, 0, 0, 0.15); padding: 3px; border-radius: 6px; border: 1px solid var(--border); box-sizing: border-box; align-items: center;">
                                                    ${Array.from({ length: 42 }).map((_, idx) => {
                                                        let color = 'var(--success)';
                                                        let opacity = 0.7 + (idx % 5) * 0.06;
                                                        let pattern = '';
                                                        let titleText = 'Operational';
                                                        
                                                        if (isDown) {
                                                            const segmentUp = (idx < 8 || idx > 26);
                                                            color = segmentUp ? 'var(--success)' : 'var(--error)';
                                                            opacity = segmentUp ? opacity : 0.9;
                                                            pattern = segmentUp ? '' : 'background-image: repeating-linear-gradient(45deg, transparent, transparent 2px, rgba(255,255,255,0.15) 2px, rgba(255,255,255,0.15) 4px);';
                                                            titleText = segmentUp ? 'Operational' : 'Downtime Detected';
                                                        } else if (isPending) {
                                                            color = 'rgba(255,255,255,0.1)';
                                                            opacity = 0.3;
                                                            titleText = 'Pending Initial Ping';
                                                        }
                                                        
                                                        return `<div style="flex: 1; height: 100%; background-color: ${color}; border-radius: 1.5px; opacity: ${opacity}; ${pattern}" title="${titleText}"></div>`;
                                                    }).join('')}
                                                </div>
                                                <div style="display: flex; justify-content: space-between; width: 100%; max-width: 320px; font-size: 10px; color: var(--text-secondary); font-weight: 800; margin-top: 2px;">
                                                    <span style="cursor: pointer; color: var(--error);" onclick="event.stopPropagation(); deleteMonitor('${m.id}')">Delete Monitor</span>
                                                    <span>AVG: ${isPending ? '—' : '42ms'}</span>
                                                </div>
                                            </div>
                                        </td>
                                    </tr>
                                `;
                            }).join('')}
                        </tbody>
                    </table>
                </div>
            `}
        </div>

        <!-- Floating Glassmorphic Bulk Action Bar -->
        <div id="uptime-bulk-bar" style="position: fixed; bottom: 24px; left: 50%; transform: translateX(-50%) translateY(100px); background: rgba(18, 18, 22, 0.95); border: 1px solid var(--border); box-shadow: 0 10px 30px rgba(0,0,0,0.5); padding: 12px 24px; border-radius: 99px; display: flex; align-items: center; gap: 16px; z-index: 1000; transition: all 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275); opacity: 0; pointer-events: none;">
            <span style="font-size: 13px; font-weight: 700; color: var(--text-primary);"><span id="uptime-bulk-count" style="color: var(--accent); font-weight: 800;">0</span> monitors selected</span>
            <div style="width: 1px; height: 16px; background: var(--border);"></div>
            <button class="btn btn-sm" onclick="window.bulkDeleteMonitors()" style="background: var(--error); border-radius: 20px; font-weight: 800; padding: 6px 16px; color: white; border: none; cursor: pointer;">Delete Selected</button>
            <button class="btn btn-sm" onclick="window.clearUptimeSelection()" style="background: transparent; border: none; font-weight: 700; color: var(--text-secondary); cursor: pointer;">Cancel</button>
        </div>
    `;

    // Immediately trigger lazy-load for already expanded monitors on redraw
    monitors.forEach(m => {
        if (window.expandedUptimeMonitors.includes(m.id)) {
            // Force redraw the detail panel
            window.expandedUptimeMonitors = window.expandedUptimeMonitors.filter(x => x !== m.id);
            window.toggleMonitorExpand(m.id);
        }
    });
}

// Global variables/selectors for Selection management
window.toggleAllUptimeCheckbox = (headerCb) => {
    const table = document.querySelector('.issue-table');
    if (!table) return;
    const checkboxes = table.querySelectorAll('tbody input[type="checkbox"]');
    checkboxes.forEach(cb => {
        cb.checked = headerCb.checked;
    });
    window.updateUptimeSelection();
};

window.updateUptimeSelection = () => {
    const table = document.querySelector('.issue-table');
    if (!table) return;
    
    const checkboxes = table.querySelectorAll('tbody input[type="checkbox"]');
    const checked = Array.from(checkboxes).filter(cb => cb.checked);
    const bulkBar = document.getElementById('uptime-bulk-bar');
    const bulkCount = document.getElementById('uptime-bulk-count');
    
    if (!bulkBar || !bulkCount) return;

    if (checked.length > 0) {
        bulkCount.innerText = checked.length;
        bulkBar.style.opacity = '1';
        bulkBar.style.pointerEvents = 'auto';
        bulkBar.style.transform = 'translateX(-50%) translateY(0)';
    } else {
        bulkBar.style.opacity = '0';
        bulkBar.style.pointerEvents = 'none';
        bulkBar.style.transform = 'translateX(-50%) translateY(100px)';
    }
    
    // update header checkbox state
    const headerCb = table.querySelector('thead input[type="checkbox"]');
    if (headerCb) {
        headerCb.checked = checked.length === checkboxes.length && checkboxes.length > 0;
    }
};

window.clearUptimeSelection = () => {
    const table = document.querySelector('.issue-table');
    if (!table) return;
    const checkboxes = table.querySelectorAll('input[type="checkbox"]');
    checkboxes.forEach(cb => cb.checked = false);
    window.updateUptimeSelection();
};

window.bulkDeleteMonitors = async () => {
    const table = document.querySelector('.issue-table');
    if (!table) return;
    const checkboxes = table.querySelectorAll('tbody input[type="checkbox"]');
    const checkedIds = Array.from(checkboxes).filter(cb => cb.checked).map(cb => cb.getAttribute('data-id'));
    
    if (checkedIds.length === 0) return;
    
    if (confirm(`Are you sure you want to permanently delete these ${checkedIds.length} monitors?`)) {
        // Hide bar immediately
        const bulkBar = document.getElementById('uptime-bulk-bar');
        if (bulkBar) {
            bulkBar.style.opacity = '0';
            bulkBar.style.pointerEvents = 'none';
            bulkBar.style.transform = 'translateX(-50%) translateY(100px)';
        }
        
        await Promise.all(checkedIds.map(id => api(`/api/uptime/${id}`, { method: 'DELETE' })));
        await refreshData();
    }
};

window.toggleMonitorExpand = async (id) => {
    const isExpanded = window.expandedUptimeMonitors.includes(id);
    const row = document.getElementById(`row-${id}`);
    if (!row) return;

    if (isExpanded) {
        window.expandedUptimeMonitors = window.expandedUptimeMonitors.filter(x => x !== id);
        const detailRow = document.getElementById(`detail-${id}`);
        if (detailRow) detailRow.remove();
        const chevron = document.getElementById(`chevron-${id}`);
        if (chevron) chevron.innerText = '»';
    } else {
        window.expandedUptimeMonitors.push(id);
        const chevron = document.getElementById(`chevron-${id}`);
        if (chevron) chevron.innerText = '«';

        const detailRow = document.createElement('tr');
        detailRow.id = `detail-${id}`;
        detailRow.innerHTML = `
            <td colspan="6" style="padding: 24px 32px; background: rgba(0, 0, 0, 0.15); border-bottom: 1px solid var(--border);">
                <div id="logs-container-${id}" style="display: flex; flex-direction: column; gap: 20px;">
                    <div style="display: flex; align-items: center; gap: 10px; padding: 20px 0;">
                        <div class="spinner" style="width: 18px; height: 18px; border-width: 2px;"></div>
                        <span class="text-secondary" style="font-size: 11px; font-weight: 800; letter-spacing: 0.1em;">FETCHING HISTORICAL TELEMETRY LOGS...</span>
                    </div>
                </div>
            </td>
        `;
        row.parentNode.insertBefore(detailRow, row.nextSibling);

        const { data: logs } = await api(`/api/uptime/${id}/logs`);
        const container = document.getElementById(`logs-container-${id}`);
        if (!container) return;

        if (!logs || logs.length === 0) {
            container.innerHTML = `
                <div style="display: flex; align-items: center; gap: 16px; padding: 12px 20px; background: var(--bg-sub); border-radius: 8px; border: 1px solid var(--border);">
                    <span style="font-size: 16px;">📡</span>
                    <div>
                        <div style="font-weight: 800; font-size: 12px; color: var(--text-primary);">Pending telemetry history...</div>
                        <div style="font-size: 11px; color: var(--text-secondary); margin-top: 2px; font-weight: 600;">The background runner has not pinged this service yet. It will automatically populate statistics after the first check cycle (60 seconds).</div>
                    </div>
                </div>
            `;
            return;
        }

        window.uptimeLogsCache = window.uptimeLogsCache || {};
        window.uptimeLogsCache[id] = logs;

        const total = logs.length;
        const upCount = logs.filter(l => l.is_up).length;
        const avgLat = Math.round(logs.reduce((acc, l) => acc + l.latency_ms, 0) / total);
        const maxLat = Math.max(...logs.map(l => l.latency_ms));
        container.innerHTML = `
            <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 16px;">
                <div class="card" style="background: var(--bg-sub); padding: 16px; display: flex; flex-direction: column; gap: 6px; border: 1px solid var(--border); border-radius: 12px;">
                    <div class="text-secondary" style="font-size: 10px; font-weight: 800; letter-spacing: 0.1em; text-transform: uppercase;">UPTIME SLA</div>
                    <div id="stat-sla-${id}" style="font-size: 24px; font-weight: 900; color: var(--text-primary);">-</div>
                    <div id="stat-sla-desc-${id}" style="font-size: 11px; color: var(--text-secondary); font-weight: 600;">Calculating...</div>
                </div>
                <div class="card" style="background: var(--bg-sub); padding: 16px; display: flex; flex-direction: column; gap: 6px; border: 1px solid var(--border); border-radius: 12px;">
                    <div class="text-secondary" style="font-size: 10px; font-weight: 800; letter-spacing: 0.1em; text-transform: uppercase;">AVG RESPONSE TIME</div>
                    <div id="stat-avg-${id}" style="font-size: 24px; font-weight: 900; color: var(--text-primary);">-</div>
                    <div id="stat-peak-${id}" style="font-size: 11px; color: var(--text-secondary); font-weight: 600;">Peak latency: -</div>
                </div>
                <div class="card" style="background: var(--bg-sub); padding: 16px; display: flex; flex-direction: column; gap: 6px; border: 1px solid var(--border); border-radius: 12px;">
                    <div class="text-secondary" style="font-size: 10px; font-weight: 800; letter-spacing: 0.1em; text-transform: uppercase;">TOTAL PINGS RECORDED</div>
                    <div id="stat-pings-${id}" style="font-size: 24px; font-weight: 900; color: var(--accent);">-</div>
                    <div id="stat-latest-${id}" style="font-size: 11px; color: var(--text-secondary); font-weight: 600;">Latest: -</div>
                </div>
            </div>

            <div style="display: grid; grid-template-columns: 2fr 1fr; gap: 20px; margin-top: 8px;">
                <div class="card" style="background: var(--bg-sub); padding: 20px; border: 1px solid var(--border); border-radius: 12px; min-width: 0;">
                    <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 12px; margin-bottom: 20px;">
                        <div class="text-secondary" style="font-size: 11px; font-weight: 800; letter-spacing: 0.05em; text-transform: uppercase;">Latency History</div>
                        <div style="display: flex; gap: 12px; align-items: center; flex-wrap: wrap;">
                            <div class="type-filter-group-${id}" style="display: flex; gap: 4px; background: rgba(0,0,0,0.2); padding: 2px; border-radius: 6px; border: 1px solid var(--border);">
                                <button class="btn btn-xs active" onclick="window.changeUptimeTypeFilter('${id}', 'all', this)" style="padding: 2px 8px; font-size: 10px; border-radius: 4px; border: none; cursor: pointer; transition: all 0.2s; background: var(--accent); color: white;">All Checks</button>
                                <button class="btn btn-xs" onclick="window.changeUptimeTypeFilter('${id}', 'errors', this)" style="padding: 2px 8px; font-size: 10px; border-radius: 4px; border: none; cursor: pointer; transition: all 0.2s; background: transparent; color: var(--text-secondary);">Errors Only</button>
                                <button class="btn btn-xs" onclick="window.changeUptimeTypeFilter('${id}', 'slow', this)" style="padding: 2px 8px; font-size: 10px; border-radius: 4px; border: none; cursor: pointer; transition: all 0.2s; background: transparent; color: var(--text-secondary);">Slow (>300ms)</button>
                            </div>
                            <div class="filter-group-${id}" style="display: flex; gap: 4px; background: rgba(0,0,0,0.2); padding: 2px; border-radius: 6px; border: 1px solid var(--border);">
                                <button class="btn btn-xs active" onclick="window.changeUptimeChartRange('${id}', '24h', this)" style="padding: 2px 8px; font-size: 10px; border-radius: 4px; border: none; cursor: pointer; transition: all 0.2s; background: var(--accent); color: white;">24 Hours</button>
                                <button class="btn btn-xs" onclick="window.changeUptimeChartRange('${id}', '7d', this)" style="padding: 2px 8px; font-size: 10px; border-radius: 4px; border: none; cursor: pointer; transition: all 0.2s; background: transparent; color: var(--text-secondary);">7 Days</button>
                                <button class="btn btn-xs" onclick="window.changeUptimeChartRange('${id}', '30d', this)" style="padding: 2px 8px; font-size: 10px; border-radius: 4px; border: none; cursor: pointer; transition: all 0.2s; background: transparent; color: var(--text-secondary);">30 Days</button>
                                <button class="btn btn-xs" onclick="window.changeUptimeChartRange('${id}', 'all', this)" style="padding: 2px 8px; font-size: 10px; border-radius: 4px; border: none; cursor: pointer; transition: all 0.2s; background: transparent; color: var(--text-secondary);">All Data</button>
                            </div>
                        </div>
                    </div>
                    
                    <div style="font-size: 11px; color: var(--text-secondary); margin-bottom: 12px; height: 16px; font-weight: 700;">
                        Telemetry Inspector: <span id="hover-stat-${id}" style="color: var(--accent); font-weight: 600;">Move cursor over any bar below...</span>
                    </div>
                    
                    <div id="chart-container-${id}" style="width: 100%; min-width: 0; overflow: hidden;">
                        <!-- Rendered Chart -->
                    </div>
                </div>

                <div class="card" style="background: var(--bg-sub); padding: 20px; border: 1px solid var(--border); border-radius: 12px; display: flex; flex-direction: column; gap: 16px;">
                    <div>
                        <div class="text-secondary" style="font-size: 11px; font-weight: 800; margin-bottom: 12px; letter-spacing: 0.05em; text-transform: uppercase;">Outages & Incidents</div>
                        <div id="incidents-container-${id}" style="display: flex; flex-direction: column; gap: 8px;">
                            <!-- Rendered Dynamically -->
                        </div>
                    </div>
                    
                    <div style="border-top: 1px solid var(--border); padding-top: 16px;">
                        <div class="text-secondary" style="font-size: 11px; font-weight: 800; margin-bottom: 12px; letter-spacing: 0.05em; text-transform: uppercase;">Recent Pings</div>
                        <div id="pings-container-${id}" style="display: flex; flex-direction: column; gap: 8px; overflow-y: auto; max-height: 156px;">
                            <!-- Rendered Dynamically -->
                        </div>
                    </div>
                </div>
            </div>
        `;

        // Render chart with default 24h range
        window.renderUptimeChart(id, '24h');
    }
};

window.renderUptimeChart = (id, period) => {
    const logs = window.uptimeLogsCache[id] || [];
    const container = document.getElementById(`chart-container-${id}`);
    if (!container) return;

    if (logs.length === 0) {
        container.innerHTML = '<div class="text-secondary" style="padding: 30px 0; text-align: center;">No latency data.</div>';
        return;
    }

    // Apply category type filter (all, errors, slow)
    window.uptimeActiveFilter = window.uptimeActiveFilter || {};
    const activeFilter = window.uptimeActiveFilter[id] || 'all';
    
    let filteredLogs = [...logs];
    if (activeFilter === 'errors') {
        filteredLogs = filteredLogs.filter(l => !l.is_up);
    } else if (activeFilter === 'slow') {
        filteredLogs = filteredLogs.filter(l => l.latency_ms > 300);
    }

    // Filter by the selected timeframe period
    const now = new Date();
    if (period === '24h') {
        const oneDayAgo = now.getTime() - 24 * 60 * 60 * 1000;
        filteredLogs = filteredLogs.filter(l => new Date(l.timestamp).getTime() >= oneDayAgo);
    } else if (period === '7d') {
        const sevenDaysAgo = now.getTime() - 7 * 24 * 60 * 60 * 1000;
        filteredLogs = filteredLogs.filter(l => new Date(l.timestamp).getTime() >= sevenDaysAgo);
    } else if (period === '30d') {
        const thirtyDaysAgo = now.getTime() - 30 * 24 * 60 * 60 * 1000;
        filteredLogs = filteredLogs.filter(l => new Date(l.timestamp).getTime() >= thirtyDaysAgo);
    }

    // Sort chronologically (oldest to newest) to display left-to-right
    const slicedLogs = [...filteredLogs].reverse();
    const maxLat = Math.max(...logs.map(l => l.latency_ms), 200);

    // Calculate active subset stats dynamically based on the active timeframe
    const activeTotal = slicedLogs.length;

    // Always update these primary cards with dynamic stats of the active timeframe!
    const slaEl = document.getElementById(`stat-sla-${id}`);
    const slaDescEl = document.getElementById(`stat-sla-desc-${id}`);
    const avgEl = document.getElementById(`stat-avg-${id}`);
    const peakEl = document.getElementById(`stat-peak-${id}`);
    const pingsEl = document.getElementById(`stat-pings-${id}`);
    const latestEl = document.getElementById(`stat-latest-${id}`);

    if (activeTotal > 0) {
        const activeUpCount = slicedLogs.filter(l => l.is_up).length;
        const activeAvgLat = Math.round(slicedLogs.reduce((acc, l) => acc + l.latency_ms, 0) / activeTotal);
        const activeMaxLat = Math.max(...slicedLogs.map(l => l.latency_ms), 0);
        const activeUptimePercent = Math.round((activeUpCount / activeTotal) * 100);

        if (slaEl) {
            slaEl.innerText = `${activeUptimePercent}%`;
            slaEl.style.color = activeUptimePercent >= 99 ? 'var(--success)' : (activeUptimePercent >= 90 ? 'var(--accent)' : 'var(--error)');
        }
        if (slaDescEl) {
            let desc = `Based on last ${activeTotal} checks`;
            if (period === '24h') desc = `Last 24 hours (${activeTotal} checks)`;
            else if (period === '7d') desc = `Last 7 days (${activeTotal} checks)`;
            else if (period === '30d') desc = `Last 30 days (${activeTotal} checks)`;
            slaDescEl.innerText = desc;
        }
        if (avgEl) {
            avgEl.innerText = `${activeAvgLat}ms`;
        }
        if (peakEl) {
            peakEl.innerText = `Peak latency: ${activeMaxLat}ms`;
        }
        if (pingsEl) {
            pingsEl.innerText = `${activeTotal}`;
        }
        if (latestEl && slicedLogs.length > 0) {
            const newestTimestamp = slicedLogs[slicedLogs.length - 1].timestamp;
            latestEl.innerText = `Latest: ${new Date(newestTimestamp).toLocaleTimeString()}`;
        }
    } else {
        if (slaEl) { slaEl.innerText = '0%'; slaEl.style.color = 'var(--text-secondary)'; }
        if (slaDescEl) slaDescEl.innerText = 'No pings recorded in timeframe';
        if (avgEl) avgEl.innerText = '-';
        if (peakEl) peakEl.innerText = 'Peak latency: -';
        if (pingsEl) pingsEl.innerText = '0';
        if (latestEl) latestEl.innerText = 'Latest: -';
    }

    // Dynamic Outages & Incidents update!
    const incidentsContainer = document.getElementById(`incidents-container-${id}`);
    if (incidentsContainer) {
        const activeIncidents = getOutageIncidents(filteredLogs);
        incidentsContainer.innerHTML = activeIncidents.length === 0 ? `
            <div style="display: flex; align-items: center; gap: 8px; font-size: 11px; padding: 10px 14px; background: rgba(46, 204, 113, 0.1); color: var(--success); border-radius: 8px; border: 1px solid rgba(46, 204, 113, 0.2); font-weight: 700;">
                <span style="display: inline-block; width: 6px; height: 6px; border-radius: 50%; background: var(--success);"></span>
                <span>No outages detected recently.</span>
            </div>
        ` : activeIncidents.slice(0, 3).map(inc => {
            const startStr = inc.start.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
            const endStr = inc.end.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
            const durationMs = inc.end.getTime() - inc.start.getTime();
            let durationText = "";
            if (durationMs < 60000) {
                durationText = `${Math.round(durationMs / 1000)}s outage`;
            } else {
                durationText = `${Math.round(durationMs / 60000)}m outage`;
            }
            if (durationMs === 0) {
                durationText = "Single ping failure";
            }
            const codes = Array.from(inc.statusCodes).join(', ');
            return `
                <div style="display: flex; flex-direction: column; gap: 4px; padding: 10px 14px; background: rgba(230, 57, 70, 0.08); border: 1px solid rgba(230, 57, 70, 0.2); border-radius: 8px; font-size: 11px;">
                    <div style="display: flex; justify-content: space-between; align-items: center;">
                        <span style="color: var(--error); font-weight: 900; letter-spacing: 0.05em; font-size: 10px; text-transform: uppercase;">OUTAGE INCIDENT</span>
                        <span style="color: var(--text-primary); font-weight: 800; font-family: monospace; background: rgba(230, 57, 70, 0.2); padding: 1px 6px; border-radius: 4px;">${durationText}</span>
                    </div>
                    <div style="color: var(--text-primary); font-weight: 700; margin-top: 2px;">
                        Time: <span style="color: var(--text-secondary);">${startStr} &rarr; ${endStr}</span>
                    </div>
                    <div style="color: var(--text-secondary); font-size: 10px; font-weight: 600; margin-top: 1px;">
                        Errors: <strong style="color: var(--error);">${codes}</strong> (${inc.count} failed checks)
                    </div>
                </div>
            `;
        }).join('');
    }

    // Dynamic Recent Pings update!
    const pingsContainer = document.getElementById(`pings-container-${id}`);
    if (pingsContainer) {
        pingsContainer.innerHTML = filteredLogs.length === 0 ? `
            <div class="text-secondary" style="padding: 20px 0; text-align: center; font-size: 11px; font-weight: 600;">No matching pings in this timeframe.</div>
        ` : filteredLogs.slice(0, 5).map(l => `
            <div style="display: flex; justify-content: space-between; align-items: center; font-size: 11px; padding: 6px 12px; background: rgba(0,0,0,0.1); border-radius: 6px; border: 1px solid var(--border);">
                <div style="display: flex; align-items: center; gap: 8px;">
                    <span style="display: inline-block; width: 6px; height: 6px; border-radius: 50%; background: ${l.is_up ? 'var(--success)' : 'var(--error)'};"></span>
                    <span style="font-weight: 800; font-family: 'Roboto Mono', monospace;">${l.status_code || 'Timeout'}</span>
                </div>
                <div style="color: var(--text-primary); font-weight: 700;">${l.latency_ms}ms</div>
                <div style="color: var(--text-secondary); font-size: 10px; font-weight: 600;">${new Date(l.timestamp).toLocaleTimeString()}</div>
            </div>
        `).join('');
    }

    if (slicedLogs.length === 0) {
        container.innerHTML = '<div class="text-secondary" style="padding: 30px 0; text-align: center; font-weight: 700;">No matching telemetry logs for the selected timeframe.</div>';
        return;
    }

    // Determine scrolling & bar width properties based on telemetry length
    const isScrollable = slicedLogs.length > 20;
    const scrollStyle = isScrollable ? 'overflow-x: auto; overflow-y: hidden; justify-content: flex-start; width: 100%; max-width: 100%;' : 'justify-content: space-between; width: 100%;';
    const barWidthStyle = isScrollable ? 'min-width: 14px; max-width: 24px; flex: 1;' : 'flex: 1;';

    container.innerHTML = `
        <div style="display: flex; gap: 4px; height: 120px; align-items: flex-end; padding-bottom: 8px; border-bottom: 1px solid var(--border); ${scrollStyle}">
            ${slicedLogs.map(l => {
                const height = Math.min(100, (l.latency_ms / maxLat) * 100);
                const barColor = l.is_up ? 'var(--accent)' : 'var(--error)';
                return `
                    <div style="${barWidthStyle} height: ${Math.max(6, height)}%; background: ${barColor}; border-radius: 3px 3px 0 0; opacity: 0.7; transition: all 0.2s; cursor: pointer;" 
                         onmouseover="this.style.opacity=1; window.showUptimeTelemetry('${id}', ${l.latency_ms}, ${l.status_code || 0}, '${l.timestamp}')" 
                         onmouseout="this.style.opacity=0.7; window.clearUptimeTelemetry('${id}')"></div>
                `;
            }).join('')}
        </div>
        <div style="display: flex; justify-content: space-between; font-size: 9px; color: var(--text-secondary); font-weight: 800; margin-top: 8px; letter-spacing: 0.05em; text-transform: uppercase;">
            <span>${new Date(slicedLogs[0].timestamp).toLocaleTimeString()}</span>
            <span>Response Latency (ms) ${isScrollable ? '(Scroll to view all)' : ''}</span>
            <span>${new Date(slicedLogs[slicedLogs.length - 1].timestamp).toLocaleTimeString()}</span>
        </div>
    `;
};

window.showUptimeTelemetry = (id, latency, statusCode, timestamp) => {
    const el = document.getElementById(`hover-stat-${id}`);
    if (el) {
        const timeStr = new Date(timestamp).toLocaleTimeString();
        const codeText = statusCode > 0 ? statusCode : 'Timeout';
        const color = statusCode >= 200 && statusCode < 400 ? '#00b894' : '#e63946';
        el.innerHTML = `<strong style="color: var(--text-primary); font-size: 12px;">${latency}ms</strong> &bull; Status: <strong style="color: ${color};">${codeText}</strong> &bull; Time: <strong>${timeStr}</strong>`;
    }
};

window.clearUptimeTelemetry = (id) => {
    const el = document.getElementById(`hover-stat-${id}`);
    if (el) {
        el.innerHTML = '<span style="color: var(--text-secondary);">Move cursor over any bar below...</span>';
    }
};

window.changeUptimeChartRange = (id, limit, btn) => {
    const filterGroup = document.querySelector(`.filter-group-${id}`);
    if (filterGroup) {
        filterGroup.querySelectorAll('button').forEach(b => {
            b.classList.remove('active');
            b.style.background = 'transparent';
            b.style.color = 'var(--text-secondary)';
        });
    }
    btn.classList.add('active');
    btn.style.background = 'var(--accent)';
    btn.style.color = 'white';

    window.renderUptimeChart(id, limit);
};

window.changeUptimeTypeFilter = (id, filterType, btn) => {
    window.uptimeActiveFilter = window.uptimeActiveFilter || {};
    window.uptimeActiveFilter[id] = filterType;

    const filterGroup = document.querySelector(`.type-filter-group-${id}`);
    if (filterGroup) {
        filterGroup.querySelectorAll('button').forEach(b => {
            b.classList.remove('active');
            b.style.background = 'transparent';
            b.style.color = 'var(--text-secondary)';
        });
    }
    btn.classList.add('active');
    btn.style.background = 'var(--accent)';
    btn.style.color = 'white';

    // Find the currently active range limit/period
    let activePeriod = '24h';
    const rangeGroup = document.querySelector(`.filter-group-${id}`);
    if (rangeGroup) {
        const activeBtn = rangeGroup.querySelector('button.active');
        if (activeBtn) {
            if (activeBtn.innerText.includes('24')) activePeriod = '24h';
            else if (activeBtn.innerText.includes('7')) activePeriod = '7d';
            else if (activeBtn.innerText.includes('30')) activePeriod = '30d';
        }
    }

    window.renderUptimeChart(id, activePeriod);
};

window.openAddMonitorModal = () => {
    const activeProject = store.currentProjectId === 'all' ? (store.projects[0]?.id || '') : store.currentProjectId;
    const projectOptionsHtml = store.projects.map(p => `
        <option value="${p.id}" ${p.id === activeProject ? 'selected' : ''}>${p.name}</option>
    `).join('');

    window.dispatchEvent(new CustomEvent('open-modal', {
        detail: {
            title: 'Add New Uptime Monitor',
            html: `
                <div style="display: flex; flex-direction: column; gap: 16px;">
                    <p class="text-secondary" style="font-size: 13px;">Specify the parameters of your service. Our async Uptime Engine will ping it at the chosen interval and alert alerting channels on any down status change.</p>
                    <div>
                        <label class="text-secondary font-bold" style="font-size: 11px; display: block; margin-bottom: 6px;">MONITOR NAME</label>
                        <input type="text" id="m-name" class="search-input" style="width: 100%" placeholder="e.g. Google Search Service">
                    </div>
                    <div>
                        <label class="text-secondary font-bold" style="font-size: 11px; display: block; margin-bottom: 6px;">ENDPOINT URL (HTTP/HTTPS)</label>
                        <input type="text" id="m-url" class="search-input" style="width: 100%" placeholder="e.g. https://www.google.com">
                    </div>
                    <div>
                        <label class="text-secondary font-bold" style="font-size: 11px; display: block; margin-bottom: 6px;">ASSIGN TO PROJECT</label>
                        <select id="m-project" class="search-input" style="width: 100%; cursor: pointer;">
                            ${projectOptionsHtml}
                        </select>
                    </div>
                    <div>
                        <label class="text-secondary font-bold" style="font-size: 11px; display: block; margin-bottom: 6px;">CHECK INTERVAL</label>
                        <select id="m-interval" class="search-input" style="width: 100%; cursor: pointer;">
                            <option value="60">Every 1 Minute</option>
                            <option value="300">Every 5 Minutes</option>
                            <option value="600" selected>Every 10 Minutes</option>
                            <option value="1800">Every 30 Minutes</option>
                            <option value="3600">Every 1 Hour</option>
                        </select>
                    </div>
                    <div style="display: flex; gap: 12px; margin-top: 24px;">
                        <button class="btn btn-primary" id="m-submit" style="flex: 1; height: 44px;">Create Monitor</button>
                        <button class="btn" id="m-cancel" style="flex: 1; height: 44px;">Cancel</button>
                    </div>
                </div>
            `,
            onRender: (content) => {
                content.querySelector('#m-cancel').onclick = () => window.dispatchEvent(new CustomEvent('close-modal'));
                content.querySelector('#m-submit').onclick = async () => {
                    const name = content.querySelector('#m-name').value;
                    const url = content.querySelector('#m-url').value;
                    const project_id = content.querySelector('#m-project').value;
                    const interval_secs = parseInt(content.querySelector('#m-interval').value);
                    if (name && url && project_id) {
                        const { status } = await api('/api/uptime', { 
                            method: 'POST', 
                            body: JSON.stringify({ name, url, project_id, interval_secs }) 
                        });
                        if (status === 201) {
                            window.dispatchEvent(new CustomEvent('close-modal'));
                            await refreshData();
                        } else {
                            alert('Failed to create monitor. Please check your admin privileges.');
                        }
                    } else {
                        alert('Please fill out all fields.');
                    }
                };
            }
        }
    }));
};

window.deleteMonitor = async (id) => {
    if (confirm('Are you sure you want to permanently delete this uptime monitor?')) {
        const { status } = await api(`/api/uptime/${id}`, { method: 'DELETE' });
        if (status === 200) {
            await refreshData();
        } else {
            alert('Failed to delete monitor. Administrator privileges required.');
        }
    }
};
