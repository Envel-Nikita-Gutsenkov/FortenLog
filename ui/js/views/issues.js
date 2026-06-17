import { store } from '../store.js';
import { formatRelativeTime, escapeHtml } from '../utils.js';

export function renderIssueList(container) {
    let issues = [...(store.stats.issues || [])];
    
    if (store.currentProjectId !== 'all') {
        issues = issues.filter(i => i.project_id === store.currentProjectId);
    }
    
    // Ensure limit and page are initialized
    const limit = store.filters.issuesLimit || 15;
    if (!store.filters.issuesPage) {
        store.filters.issuesPage = 1;
    }
    
    // Filtering
    const search = store.filters.search.toLowerCase();
    const statusFilter = store.filters.status || 'all';

    let filtered = issues.filter(i => {
        const matchesSearch = i.title.toLowerCase().includes(search) || (i.culprit || '').toLowerCase().includes(search);
        const matchesStatus = statusFilter === 'all' || 
                             (statusFilter === 'resolved' && i.status === 'resolved') ||
                             (statusFilter === 'unhandled' && i.status !== 'resolved' && !i.is_suppressed) ||
                             (statusFilter === 'suppressed' && i.is_suppressed);
        return matchesSearch && matchesStatus;
    });

    // Sorting
    const { sortKey, sortDir } = store.filters;
    filtered.sort((a, b) => {
        let valA = a[sortKey];
        let valB = b[sortKey];
        
        if (typeof valA === 'string') {
            valA = valA.toLowerCase();
            valB = (valB || '').toLowerCase();
        }
        
        if (valA < valB) return sortDir === 'asc' ? -1 : 1;
        if (valA > valB) return sortDir === 'asc' ? 1 : -1;
        return 0;
    });

    const total = filtered.length;
    const totalPages = Math.ceil(total / limit) || 1;
    if (store.filters.issuesPage > totalPages) {
        store.filters.issuesPage = totalPages;
    }
    const currentPage = store.filters.issuesPage;
    const offset = (currentPage - 1) * limit;
    const paginatedList = filtered.slice(offset, offset + limit);

    container.innerHTML = `
        <div class="filter-bar" style="padding: 16px 32px; display: flex; gap: 20px; align-items: center; border-bottom: 1px solid var(--border); background: var(--bg-primary);">
            <div style="font-weight: 800; font-size: 14px; color: var(--text-primary); min-width: 80px;">${total} Issues</div>
            <input type="text" class="search-input" placeholder="Search by title or culprit..." value="${store.filters.search}" id="issue-search" style="flex: 1; max-width: 400px; height: 38px;">
            
            <div class="tabs-sentry" style="display: flex; background: var(--bg-sub); padding: 4px; border-radius: 8px;">
                <button class="tab-btn ${statusFilter === 'all' ? 'active' : ''}" data-status="all">All</button>
                <button class="tab-btn ${statusFilter === 'unhandled' ? 'active' : ''}" data-status="unhandled">Unhandled</button>
                <button class="tab-btn ${statusFilter === 'resolved' ? 'active' : ''}" data-status="resolved">Resolved</button>
                <button class="tab-btn ${statusFilter === 'suppressed' ? 'active' : ''}" data-status="suppressed">Suppressed</button>
            </div>
        </div>
        <div class="issue-list-container" style="padding: 0 16px;">
            <table class="issue-table">
                <thead>
                    <tr>
                        <th class="sortable" data-key="title">ISSUE ${renderSortIcon('title')}</th>
                        <th class="sortable" data-key="count" style="width: 100px; text-align: center;">EVENTS ${renderSortIcon('count')}</th>
                        <th class="sortable" data-key="users_affected" style="width: 100px; text-align: center;">USERS ${renderSortIcon('users_affected')}</th>
                        <th class="sortable" data-key="last_seen" style="width: 150px;">LAST SEEN ${renderSortIcon('last_seen')}</th>
                    </tr>
                </thead>
                <tbody>
                    ${paginatedList.map(i => {
                        const project = store.projects.find(p => p.id === i.project_id);
                        return `
                            <tr class="issue-row ${i.status === 'resolved' ? 'resolved' : ''} ${i.is_suppressed ? 'suppressed' : ''}" data-id="${escapeHtml(i.id)}">
                                <td>
                                    <div class="issue-main">
                                        <div class="issue-title" style="display: flex; gap: 8px; align-items: center;">
                                            ${escapeHtml(i.title)}
                                            ${i.is_suppressed ? '<span style="font-size: 10px; padding: 2px 6px; border-radius: 4px; background: rgba(243, 156, 18, 0.1); color: #f39c12; font-weight: 800;">SUPPRESSED</span>' : ''}
                                        </div>
                                        <div class="issue-culprit">${escapeHtml(i.culprit || 'unknown source')}</div>
                                        <div style="display: flex; gap: 8px; align-items: center; margin-top: 8px;">
                                            <span class="tag-badge" style="background: ${i.status === 'resolved' ? 'rgba(46, 204, 113, 0.1)' : 'rgba(214,48,49,0.1)'}; color: ${i.status === 'resolved' ? '#2ecc71' : '#d63031'};">${i.status || 'unhandled'}</span>
                                            ${i.resolved_in_version ? `<span class="tag-badge" style="background: rgba(52, 152, 219, 0.1); color: #3498db;">${i.resolved_in_version}</span>` : ''}
                                            ${store.currentProjectId === 'all' ? `
                                                <span class="tag-badge" style="background: var(--bg-sub); color: var(--text-secondary); border: 1px solid var(--border);">
                                                     ${project ? project.id : i.project_id}
                                                </span>
                                            ` : ''}
                                        </div>
                                    </div>
                                </td>
                                <td style="text-align: center;"><div style="font-weight: 800; font-size: 14px;">${i.count}</div></td>
                                <td style="text-align: center;">
                                    <div style="font-weight: 800; font-size: 14px; color: var(--accent); cursor: pointer; text-decoration: underline;" 
                                         onclick="event.stopPropagation(); showAffectedUsers(this.closest('.issue-row').getAttribute('data-id'))">
                                        ${i.users_affected || 1}
                                    </div>
                                </td>
                                <td style="color: var(--text-secondary); font-size: 11px; font-weight: 600;">${formatRelativeTime(i.last_seen)}</td>
                            </tr>
                        `;
                    }).join('')}
                </tbody>
            </table>
            ${total === 0 ? '<div class="no-data" style="padding: 100px;">NO_ISSUES_FOUND</div>' : ''}
            
            <!-- PAGINATION BLOCK -->
            <div style="margin-top: 20px; margin-bottom: 20px; display: flex; justify-content: space-between; align-items: center; background: var(--bg-sub); padding: 12px 20px; border-radius: 8px; border: 1px solid var(--border);">
                <div style="display: flex; align-items: center; gap: 15px;">
                    <div id="issue-pagination-info" style="font-size: 13px; color: var(--text-secondary); font-weight: 600;">
                        Showing ${total === 0 ? '0-0' : `${offset + 1}-${Math.min(offset + limit, total)}`} of ${total} issues
                    </div>
                    <div style="display: flex; align-items: center; gap: 6px;">
                        <span style="font-size: 12px; color: var(--text-secondary); font-weight: 600;">Per Page:</span>
                        <select id="issue-limit-select" class="search-input" style="height: 28px; padding: 2px 8px; font-size: 12px; width: 65px; border-radius: 6px;">
                            <option value="15" ${limit === 15 ? 'selected' : ''}>15</option>
                            <option value="25" ${limit === 25 ? 'selected' : ''}>25</option>
                            <option value="50" ${limit === 50 ? 'selected' : ''}>50</option>
                            <option value="100" ${limit === 100 ? 'selected' : ''}>100</option>
                        </select>
                    </div>
                </div>
                <div id="issue-pagination-buttons" style="display: flex; gap: 6px; align-items: center;">
                    <!-- Prev, Page numbers, Next -->
                </div>
            </div>
        </div>
    `;

    // Render pagination buttons
    const pagButtons = container.querySelector('#issue-pagination-buttons');
    if (pagButtons && total > 0) {
        let btnHtml = '';
        btnHtml += `<button class="btn btn-sm" ${currentPage === 1 ? 'disabled' : ''} onclick="changeIssuesPage(${currentPage - 1})" style="padding: 0 10px; height: 28px; line-height: 26px;">&laquo; Prev</button>`;

        const maxVisible = 5;
        let startPage = Math.max(1, currentPage - 2);
        let endPage = Math.min(totalPages, startPage + maxVisible - 1);
        if (endPage - startPage < maxVisible - 1) {
            startPage = Math.max(1, endPage - maxVisible + 1);
        }

        if (startPage > 1) {
            btnHtml += `<button class="btn btn-sm" onclick="changeIssuesPage(1)" style="padding: 0 8px; height: 28px; line-height: 26px;">1</button>`;
            if (startPage > 2) btnHtml += `<span style="color: var(--text-secondary); padding: 0 4px;">...</span>`;
        }

        for (let p = startPage; p <= endPage; p++) {
            btnHtml += `<button class="btn btn-sm" onclick="changeIssuesPage(${p})" style="padding: 0 8px; height: 28px; line-height: 26px; ${currentPage === p ? 'background: var(--accent); color: white; border-color: var(--accent);' : ''}">${p}</button>`;
        }

        if (endPage < totalPages) {
            if (endPage < totalPages - 1) btnHtml += `<span style="color: var(--text-secondary); padding: 0 4px;">...</span>`;
            btnHtml += `<button class="btn btn-sm" onclick="changeIssuesPage(${totalPages})" style="padding: 0 8px; height: 28px; line-height: 26px;">${totalPages}</button>`;
        }

        btnHtml += `<button class="btn btn-sm" ${currentPage === totalPages ? 'disabled' : ''} onclick="changeIssuesPage(${currentPage + 1})" style="padding: 0 10px; height: 28px; line-height: 26px;">Next &raquo;</button>`;
        pagButtons.innerHTML = btnHtml;
    }

    // Events
    container.querySelector('#issue-limit-select')?.addEventListener('change', (e) => {
        store.filters.issuesLimit = parseInt(e.target.value, 10);
        store.filters.issuesPage = 1;
        renderIssueList(container);
    });

    container.querySelector('#issue-search')?.addEventListener('input', (e) => {
        store.filters.search = e.target.value;
        store.filters.issuesPage = 1;
        renderIssueList(container);
    });

    container.querySelectorAll('.tab-btn').forEach(btn => {
        btn.onclick = () => {
            store.filters.status = btn.getAttribute('data-status');
            store.filters.issuesPage = 1;
            renderIssueList(container);
        };
    });

    container.querySelectorAll('.sortable').forEach(th => {
        th.addEventListener('click', () => {
            const key = th.getAttribute('data-key');
            if (store.filters.sortKey === key) {
                store.filters.sortDir = store.filters.sortDir === 'asc' ? 'desc' : 'asc';
            } else {
                store.filters.sortKey = key;
                store.filters.sortDir = 'desc';
            }
            store.filters.issuesPage = 1;
            renderIssueList(container);
        });
    });

    container.querySelectorAll('.issue-row').forEach(row => {
        row.addEventListener('click', (e) => {
            if (e.target.tagName === 'BUTTON' || e.target.closest('button')) return;
            const id = row.getAttribute('data-id');
            window.dispatchEvent(new CustomEvent('navigate', { detail: { path: 'issue_detail', issueId: id } }));
        });
    });
}

// Global page change handler
window.changeIssuesPage = (page) => {
    store.filters.issuesPage = page;
    const container = document.getElementById('view-content');
    if (container) {
        renderIssueList(container);
    }
};

function renderSortIcon(key) {
    if (store.filters.sortKey !== key) return '<span style="opacity: 0.2">↕</span>';
    return store.filters.sortDir === 'asc' ? '↑' : '↓';
}
