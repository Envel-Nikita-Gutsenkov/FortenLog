import { store } from '../store.js';
import { api } from '../api.js';
import { escapeHtml } from '../utils.js';

let exploreEventsCache = [];

export async function renderExplore(container) {
    if (!store.filters.exploreLimit) {
        store.filters.exploreLimit = 15;
    }
    if (!store.filters.explorePage) {
        store.filters.explorePage = 1;
    }

    const limit = store.filters.exploreLimit;

    container.innerHTML = `
        <div style="padding: 24px 32px;">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 30px;">
                <div>
                    <h1 style="margin: 0; font-size: 32px; letter-spacing: -1px; font-weight: 800;">Event Explorer</h1>
                    <p style="color: var(--text-secondary); margin-top: 4px;">Search, filter, and page through raw telemetry logs in real-time.</p>
                </div>
                <div style="display: flex; gap: 10px; align-items: center;">
                    <button class="btn btn-danger" id="bulk-delete-btn" style="display: none; align-items: center; gap: 6px; font-weight: 700;" onclick="bulkDeleteSelectedEvents()">Delete Selected</button>
                    <button class="btn" id="explore-refresh">Refresh Data</button>
                    <button class="btn btn-primary" onclick="exportExplorerDataFromExplorer()">Export Results (CSV)</button>
                </div>
            </div>

            <div class="card" style="margin-bottom: 24px; padding: 20px; background: var(--bg-sub); border-color: var(--accent-light); border-radius: 12px;">
                <div style="display: grid; grid-template-columns: 2fr 1fr 1fr 120px; gap: 15px; align-items: flex-end;">
                    <div>
                        <label style="font-size: 10px; font-weight: 800; color: var(--accent); margin-bottom: 6px; display: block; letter-spacing: 0.05em;">SEARCH QUERY</label>
                        <input type="text" id="explore-search" class="search-input" style="width: 100%; height: 38px;" placeholder="Search title, message, or event ID...">
                    </div>
                    <div>
                        <label style="font-size: 10px; font-weight: 800; color: var(--accent); margin-bottom: 6px; display: block; letter-spacing: 0.05em;">EVENT TYPE</label>
                        <select id="explore-type" class="search-input" style="width: 100%; height: 38px;">
                            <option value="">All Types</option>
                            <option value="sentry">Sentry Error</option>
                            <option value="custom">Custom Event</option>
                            <option value="transaction">Transaction</option>
                        </select>
                    </div>
                    <div>
                        <label style="font-size: 10px; font-weight: 800; color: var(--accent); margin-bottom: 6px; display: block; letter-spacing: 0.05em;">OS / PLATFORM</label>
                        <select id="explore-os" class="search-input" style="width: 100%; height: 38px;">
                            <option value="">All Platforms</option>
                            <option value="Windows">Windows</option>
                            <option value="macOS">macOS</option>
                            <option value="Linux">Linux</option>
                            <option value="iOS">iOS</option>
                            <option value="Android">Android</option>
                        </select>
                    </div>
                    <div>
                        <button class="btn btn-primary" id="run-explore-query" style="width: 100%; height: 38px; font-weight: 700;">Query</button>
                    </div>
                </div>
            </div>

            <div class="card" style="padding: 0; overflow: hidden; border-radius: 12px;">
                <table class="issue-table">
                    <thead>
                        <tr>
                            <th style="width: 40px; padding: 12px 16px; text-align: center;"><input type="checkbox" id="master-select" onclick="toggleSelectAllEvents(this)"></th>
                            <th style="width: 160px; padding: 12px 16px;">TIME</th>
                            <th style="padding: 12px 16px;">EVENT / TITLE</th>
                            <th style="width: 120px; padding: 12px 16px;">PROJECT</th>
                            <th style="width: 100px; padding: 12px 16px;">TYPE</th>
                            <th style="width: 140px; padding: 12px 16px;">PLATFORM</th>
                            <th style="width: 140px; padding: 12px 16px;">REGION / IP</th>
                        </tr>
                    </thead>
                    <tbody id="explore-tbody">
                        <tr><td colspan="7" style="text-align: center; padding: 60px; color: var(--text-secondary);">Executing queries...</td></tr>
                    </tbody>
                </table>
            </div>

            <!-- PAGINATION BLOCK -->
            <div style="margin-top: 20px; display: flex; justify-content: space-between; align-items: center; background: var(--bg-sub); padding: 12px 20px; border-radius: 8px; border: 1px solid var(--border);">
                <div style="display: flex; align-items: center; gap: 15px;">
                    <div id="explore-pagination-info" style="font-size: 13px; color: var(--text-secondary); font-weight: 600;">
                        Showing 0-0 of 0 events
                    </div>
                    <div style="display: flex; align-items: center; gap: 6px;">
                        <span style="font-size: 12px; color: var(--text-secondary); font-weight: 600;">Per Page:</span>
                        <select id="explore-limit-select" class="search-input" style="height: 28px; padding: 2px 8px; font-size: 12px; width: 65px; border-radius: 6px;">
                            <option value="15" ${limit === 15 ? 'selected' : ''}>15</option>
                            <option value="25" ${limit === 25 ? 'selected' : ''}>25</option>
                            <option value="50" ${limit === 50 ? 'selected' : ''}>50</option>
                            <option value="100" ${limit === 100 ? 'selected' : ''}>100</option>
                        </select>
                    </div>
                </div>
                <div id="explore-pagination-buttons" style="display: flex; gap: 6px; align-items: center;">
                    <!-- Prev, Page numbers, Next -->
                </div>
            </div>
        </div>
    `;

    const tbody = container.querySelector('#explore-tbody');
    const searchInput = container.querySelector('#explore-search');
    const typeSelect = container.querySelector('#explore-type');
    const osSelect = container.querySelector('#explore-os');
    const runBtn = container.querySelector('#run-explore-query');
    const refreshBtn = container.querySelector('#explore-refresh');
    const pagInfo = container.querySelector('#explore-pagination-info');
    const pagButtons = container.querySelector('#explore-pagination-buttons');

    // Restore bookmarks/filters
    if (window.pendingExplorerFilters) {
        if (searchInput) searchInput.value = window.pendingExplorerFilters.search || '';
        if (typeSelect) typeSelect.value = window.pendingExplorerFilters.event_type || '';
        if (osSelect) osSelect.value = window.pendingExplorerFilters.os || '';
        window.pendingExplorerFilters = null;
    }

    async function load() {
        tbody.innerHTML = '<tr><td colspan="7" style="text-align: center; padding: 60px;">Fetching events...</td></tr>';
        
        const master = document.getElementById('master-select');
        if (master) master.checked = false;
        window.updateBulkDeleteButtonState();

        const currentPage = store.filters.explorePage;
        const currentLimit = store.filters.exploreLimit;
        const search = searchInput.value;
        const event_type = typeSelect.value;
        const os = osSelect.value;
        const project_id = store.currentProjectId === 'all' ? '' : store.currentProjectId;
        const offset = (currentPage - 1) * currentLimit;

        const params = new URLSearchParams({
            search,
            event_type,
            os,
            project_id,
            limit: currentLimit.toString(),
            offset: offset.toString()
        });

        try {
            const { data } = await api(`/api/explorer/query?${params.toString()}`);
            const events = data?.events || [];
            const total = data?.total || 0;

            exploreEventsCache = events;

            if (events.length === 0) {
                tbody.innerHTML = '<tr><td colspan="7" style="text-align: center; padding: 60px; color: var(--text-secondary);">No events match your criteria.</td></tr>';
                pagInfo.innerText = `Showing 0-0 of 0 events`;
                pagButtons.innerHTML = '';
                return;
            }

            tbody.innerHTML = events.map(e => {
                const tsFormatted = e.timestamp 
                    ? e.timestamp.replace('T', ' ').split('.')[0] 
                    : 'Unknown Time';
                
                return `
                    <tr class="issue-row" onclick="openEventDetailsModal('${e.id}')">
                        <td style="padding: 12px 16px; text-align: center;" onclick="event.stopPropagation();">
                            <input type="checkbox" class="event-checkbox" data-id="${e.id}" data-project-id="${e.project_id}" onclick="updateBulkDeleteButtonState()">
                        </td>
                        <td style="font-size: 11px; color: var(--text-secondary); font-family: 'Roboto Mono', monospace; padding: 12px 16px;">
                            ${tsFormatted}
                        </td>
                        <td style="padding: 12px 16px;">
                            <div style="font-weight: 800; font-size: 13px; margin-bottom: 4px;">${escapeHtml(e.title || 'Untitled Event')}</div>
                            <div style="font-size: 10px; color: var(--accent); opacity: 0.7; font-family: 'Roboto Mono', monospace;">${escapeHtml(e.id)}</div>
                        </td>
                        <td style="padding: 12px 16px;">
                            <span class="tag-badge" style="background: var(--bg-sub); color: var(--text-secondary);">${escapeHtml(e.project_id)}</span>
                        </td>
                        <td style="padding: 12px 16px;">
                            <span class="tag-badge" style="background: ${e.event_type === 'sentry' ? 'rgba(214,48,49,0.1)' : 'rgba(0,184,148,0.1)'}; color: ${e.event_type === 'sentry' ? '#d63031' : '#00b894'}; font-weight: 800; font-size: 10px;">
                                ${escapeHtml(e.event_type.toUpperCase())}
                            </span>
                        </td>
                        <td style="padding: 12px 16px;">
                            <div style="font-weight: 700; font-size: 12px;">${escapeHtml(e.os || 'Unknown OS')}</div>
                            <div style="font-size: 10px; color: var(--text-secondary);">${escapeHtml(e.browser || 'Unknown Browser')}</div>
                        </td>
                        <td style="padding: 12px 16px;">
                            <div style="display: flex; flex-direction: column; gap: 2px;">
                                <span style="font-weight: 700; font-size: 12px; color: var(--accent);">${escapeHtml(e.region || 'Unknown Region')}</span>
                                <span style="font-size: 10px; color: var(--text-secondary); opacity: 0.5;">${escapeHtml(e.ip_address || '---')}</span>
                            </div>
                        </td>
                    </tr>
                `;
            }).join('');

            // Update pagination info
            const start = offset + 1;
            const end = Math.min(offset + currentLimit, total);
            pagInfo.innerText = `Showing ${start}-${end} of ${total} events`;

            // Update pagination buttons
            const totalPages = Math.ceil(total / currentLimit);
            let btnHtml = '';

            // Previous Button
            btnHtml += `<button class="btn btn-sm" ${currentPage === 1 ? 'disabled' : ''} onclick="changeExplorePage(${currentPage - 1})" style="padding: 0 10px; height: 28px; line-height: 26px;">&laquo; Prev</button>`;

            // Page numbers
            const maxVisible = 5;
            let startPage = Math.max(1, currentPage - 2);
            let endPage = Math.min(totalPages, startPage + maxVisible - 1);
            if (endPage - startPage < maxVisible - 1) {
                startPage = Math.max(1, endPage - maxVisible + 1);
            }

            if (startPage > 1) {
                btnHtml += `<button class="btn btn-sm" onclick="changeExplorePage(1)" style="padding: 0 8px; height: 28px; line-height: 26px;">1</button>`;
                if (startPage > 2) btnHtml += `<span style="color: var(--text-secondary); padding: 0 4px;">...</span>`;
            }

            for (let p = startPage; p <= endPage; p++) {
                btnHtml += `<button class="btn btn-sm" onclick="changeExplorePage(${p})" style="padding: 0 8px; height: 28px; line-height: 26px; ${currentPage === p ? 'background: var(--accent); color: white; border-color: var(--accent);' : ''}">${p}</button>`;
            }

            if (endPage < totalPages) {
                if (endPage < totalPages - 1) btnHtml += `<span style="color: var(--text-secondary); padding: 0 4px;">...</span>`;
                btnHtml += `<button class="btn btn-sm" onclick="changeExplorePage(${totalPages})" style="padding: 0 8px; height: 28px; line-height: 26px;">${totalPages}</button>`;
            }

            // Next Button
            btnHtml += `<button class="btn btn-sm" ${currentPage === totalPages ? 'disabled' : ''} onclick="changeExplorePage(${currentPage + 1})" style="padding: 0 10px; height: 28px; line-height: 26px;">Next &raquo;</button>`;

            pagButtons.innerHTML = btnHtml;

        } catch (err) {
            tbody.innerHTML = `<tr><td colspan="7" style="text-align: center; padding: 60px; color: var(--error);">Query failed: ${err.message}</td></tr>`;
            pagInfo.innerText = `Showing 0-0 of 0 events`;
            pagButtons.innerHTML = '';
        }
    }

    // Attach search behaviors
    runBtn.onclick = () => { store.filters.explorePage = 1; load(); };
    refreshBtn.onclick = () => load();
    searchInput.onkeydown = (e) => { if (e.key === 'Enter') { store.filters.explorePage = 1; load(); } };
    typeSelect.onchange = () => { store.filters.explorePage = 1; load(); };
    osSelect.onchange = () => { store.filters.explorePage = 1; load(); };

    container.querySelector('#explore-limit-select')?.addEventListener('change', (e) => {
        store.filters.exploreLimit = parseInt(e.target.value, 10);
        store.filters.explorePage = 1;
        load();
    });

    // Register page change global callback
    window.changeExplorePage = (page) => {
        store.filters.explorePage = page;
        load();
    };

    // Auto-run on load
    load();
}

window.toggleSelectAllEvents = (master) => {
    const checkboxes = document.querySelectorAll('.event-checkbox');
    checkboxes.forEach(cb => cb.checked = master.checked);
    window.updateBulkDeleteButtonState();
};

window.updateBulkDeleteButtonState = () => {
    const checkboxes = document.querySelectorAll('.event-checkbox:checked');
    const btn = document.getElementById('bulk-delete-btn');
    if (!btn) return;
    if (checkboxes.length > 0) {
        btn.style.display = 'inline-flex';
        btn.innerText = `Delete Selected (${checkboxes.length})`;
    } else {
        btn.style.display = 'none';
    }
};

window.bulkDeleteSelectedEvents = async () => {
    const checkboxes = Array.from(document.querySelectorAll('.event-checkbox:checked'));
    if (checkboxes.length === 0) return;
    
    if (confirm(`Are you sure you want to permanently delete the ${checkboxes.length} selected telemetry events?`)) {
        const projectBatches = {};
        checkboxes.forEach(cb => {
            const pId = cb.getAttribute('data-project-id');
            const eId = cb.getAttribute('data-id');
            if (!projectBatches[pId]) projectBatches[pId] = [];
            projectBatches[pId].push(eId);
        });

        let successCount = 0;
        let failCount = 0;

        for (const [projectId, eventIds] of Object.entries(projectBatches)) {
            const promises = eventIds.map(eId => 
                api(`/api/projects/${projectId}/events/${eId}`, { method: 'DELETE' })
            );
            const results = await Promise.all(promises);
            results.forEach(res => {
                if (res === 200 || res.status === 200 || (res && !res.error)) successCount++;
                else failCount++;
            });
        }

        alert(`Bulk delete complete. Successfully deleted: ${successCount} events.${failCount > 0 ? ` Failed: ${failCount} events.` : ''}`);
        
        const master = document.getElementById('master-select');
        if (master) master.checked = false;
        const btn = document.getElementById('bulk-delete-btn');
        if (btn) btn.style.display = 'none';
        
        const refreshBtn = document.getElementById('explore-refresh');
        if (refreshBtn) refreshBtn.click();
    }
};

window.exportExplorerDataFromExplorer = () => {
    const search = document.getElementById('explore-search')?.value || '';
    const event_type = document.getElementById('explore-type')?.value || '';
    const os = document.getElementById('explore-os')?.value || '';
    const project_id = store.currentProjectId === 'all' ? '' : store.currentProjectId;
    const params = new URLSearchParams({ search, event_type, os, project_id, format: 'csv' });
    window.location.href = `/api/explorer/export?${params.toString()}`;
};

window.closeEventModalAndNavigateToIssue = (issueId, projectId) => {
    window.dispatchEvent(new CustomEvent('close-modal'));
    window.navigate('issue_detail', { issueId, projectId });
};

window.copyEventRawPayload = async (btn) => {
    const code = document.getElementById('raw-payload-code').innerText;
    try {
        await navigator.clipboard.writeText(code);
        const oldText = btn.innerText;
        btn.innerText = 'Copied!';
        btn.style.color = '#2ecc71';
        setTimeout(() => {
            btn.innerText = oldText;
            btn.style.color = '';
        }, 2000);
    } catch (err) {
        alert('Failed to copy JSON.');
    }
};

window.openEventDetailsModal = async (eventId) => {
    const e = exploreEventsCache.find(x => x.id === eventId);
    if (!e) return;
    
    // 1. Dispatch modal immediately with a beautiful shimmer loading placeholder
    window.dispatchEvent(new CustomEvent('open-modal', {
        detail: {
            title: `Event Log Inspector: ${e.title || 'Untitled Event'}`,
            wide: true,
            html: `
                <style>
                @keyframes modal-spin {
                    0% { transform: rotate(0deg); }
                    100% { transform: rotate(360deg); }
                }
                </style>
                <div style="display: flex; flex-direction: column; gap: 20px;" id="event-modal-content">
                    <div style="text-align: center; padding: 60px; color: var(--text-secondary);">
                        <div style="margin: 0 auto 16px auto; border: 3px solid rgba(255,255,255,0.1); border-radius: 50%; border-top: 3px solid var(--accent); width: 36px; height: 36px; animation: modal-spin 1s linear infinite;"></div>
                        <p style="font-weight: 700; font-size: 14px; color: var(--text-primary);">Decompressing WAL Telemetry...</p>
                        <p style="font-size: 12px; color: var(--text-secondary); margin-top: 4px;">Fetching raw zstd-compressed payload from DB</p>
                    </div>
                </div>
            `
        }
    }));

    // 2. Fetch the fully decompressed raw payload asynchronously
    try {
        const { data: fullEvent } = await api(`/api/projects/${e.project_id}/issues/none/events/${e.id}`);
        const modalContainer = document.getElementById('event-modal-content');
        if (!modalContainer) return; // Modal was closed before loading completed

        // Merge fullEvent data with the cached event metadata
        const mergedEvent = { ...e, ...fullEvent };

        // Construct elegant, premium layout
        modalContainer.innerHTML = `
            <!-- Meta Cards -->
            <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 16px;">
                <div class="card" style="background: var(--bg-sub); padding: 16px; border-radius: 8px; border: 1px solid var(--border);">
                    <div style="font-size: 10px; font-weight: 800; color: var(--text-secondary); text-transform: uppercase;">Event Type</div>
                    <div style="font-size: 18px; font-weight: 900; color: var(--accent); margin-top: 4px;">${mergedEvent.event_type.toUpperCase()}</div>
                </div>
                <div class="card" style="background: var(--bg-sub); padding: 16px; border-radius: 8px; border: 1px solid var(--border);">
                    <div style="font-size: 10px; font-weight: 800; color: var(--text-secondary); text-transform: uppercase;">Project Target</div>
                    <div style="font-size: 18px; font-weight: 900; color: var(--text-primary); margin-top: 4px;">${mergedEvent.project_id}</div>
                </div>
                <div class="card" style="background: var(--bg-sub); padding: 16px; border-radius: 8px; border: 1px solid var(--border);">
                    <div style="font-size: 10px; font-weight: 800; color: var(--text-secondary); text-transform: uppercase;">Origin IP & Region</div>
                    <div style="font-size: 14px; font-weight: 800; color: var(--text-primary); margin-top: 6px;">${mergedEvent.ip_address || '---'} (${mergedEvent.region || 'Unknown'})</div>
                </div>
            </div>

            <!-- Details Table -->
            <div class="card" style="padding: 20px; border-radius: 8px; border: 1px solid var(--border);">
                <h3 style="margin-top: 0; font-size: 14px; font-weight: 800; text-transform: uppercase; color: var(--text-primary); border-bottom: 1px solid var(--border); padding-bottom: 10px;">Context Attributes</h3>
                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px 24px; font-size: 13px; font-weight: 600;">
                    <div style="display: flex; justify-content: space-between;">
                        <span style="color: var(--text-secondary);">Event ID:</span>
                        <span style="font-family: monospace; color: var(--text-primary);">${mergedEvent.id}</span>
                    </div>
                    <div style="display: flex; justify-content: space-between;">
                        <span style="color: var(--text-secondary);">Timestamp:</span>
                        <span style="color: var(--text-primary);">${new Date(mergedEvent.timestamp).toLocaleString()}</span>
                    </div>
                    <div style="display: flex; justify-content: space-between;">
                        <span style="color: var(--text-secondary);">Operating System:</span>
                        <span style="color: var(--text-primary);">${mergedEvent.os || 'Unknown OS'}</span>
                    </div>
                    <div style="display: flex; justify-content: space-between;">
                        <span style="color: var(--text-secondary);">Browser / Client:</span>
                        <span style="color: var(--text-primary);">${mergedEvent.browser || 'Unknown Client'}</span>
                    </div>
                    <div style="display: flex; justify-content: space-between; grid-column: span 2;">
                        <span style="color: var(--text-secondary); margin-right: 15px;">Associated Issue ID:</span>
                        ${mergedEvent.issue_id ? `<span style="color: var(--accent); cursor: pointer; text-decoration: underline; font-weight: bold;" data-issue-id="${escapeHtml(mergedEvent.issue_id)}" data-project-id="${escapeHtml(mergedEvent.project_id)}" onclick="window.closeEventModalAndNavigateToIssue(this.getAttribute('data-issue-id'), this.getAttribute('data-project-id'))">${escapeHtml(mergedEvent.issue_id)}</span>` : '<span style="color: var(--text-secondary);">None</span>'}
                    </div>
                </div>
            </div>

            <!-- Payload JSON -->
            <div class="card" style="padding: 20px; border-radius: 8px; border: 1px solid var(--border); background: #0c0c0e;">
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px;">
                    <h3 style="margin: 0; font-size: 14px; font-weight: 800; text-transform: uppercase; color: var(--accent);">Raw Payload Data (Decompressed)</h3>
                    <button class="btn btn-xs" onclick="copyEventRawPayload(this)" style="padding: 2px 8px; font-size: 11px;">Copy JSON</button>
                </div>
                <pre id="raw-payload-code" style="margin: 0; font-family: 'Roboto Mono', monospace; font-size: 11px; color: #a29bfe; overflow-x: auto; white-space: pre-wrap; word-break: break-all; max-height: 280px; background: rgba(0,0,0,0.3); padding: 12px; border-radius: 6px; border: 1px solid rgba(255,255,255,0.05);">${escapeHtml(JSON.stringify(mergedEvent, null, 4))}</pre>
            </div>
        `;
    } catch (err) {
        const modalContainer = document.getElementById('event-modal-content');
        if (modalContainer) {
            modalContainer.innerHTML = `
                <div class="alert alert-danger" style="margin: 0;">
                    <h4 style="margin: 0 0 8px 0; font-weight: 800;">Decompression Error</h4>
                    <p style="margin: 0; font-size: 13px;">Failed to retrieve and decompress telemetry event payload from database. Error details: ${err.message || err}</p>
                </div>
            `;
        }
    }
};
