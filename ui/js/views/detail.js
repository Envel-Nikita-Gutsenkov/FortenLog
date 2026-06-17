import { api } from '../api.js';
import { store } from '../store.js';
import { maskSensitive, escapeHtml } from '../utils.js';

export async function renderIssueDetail(container) {
    const issueId = store.currentIssueId;
    if (!issueId) {
        window.navigate('issues');
        return;
    }

    container.innerHTML = `
        <div style="padding: 100px; text-align: center; color: var(--text-secondary); display: flex; flex-direction: column; justify-content: center; align-items: center; gap: 20px;">
            <div style="width: 40px; height: 40px; border: 3px solid rgba(255,255,255,0.05); border-left-color: var(--accent); border-radius: 50%; animation: spin 1s linear infinite;"></div>
            <p style="font-weight: 800; font-family: 'Roboto Mono', monospace; font-size: 11px; letter-spacing: 2.5px;">FETCHING_ISSUE_METADATA...</p>
        </div>
    `;

    let issue = null;
    const initialProjectId = store.currentIssueProjectId || store.currentProjectId || 'all';

    try {
        let res = await api(`/api/projects/${initialProjectId}/issues/${encodeURIComponent(issueId)}`);
        if (res && res.data && !res.data.error) {
            issue = res.data;
        } else {
            for (const p of store.projects) {
                if (p.id === initialProjectId) continue;
                let fallbackRes = await api(`/api/projects/${p.id}/issues/${encodeURIComponent(issueId)}`);
                if (fallbackRes && fallbackRes.data && !fallbackRes.data.error) {
                    issue = fallbackRes.data;
                    break;
                }
            }
        }
    } catch(err) {
        console.error('Failed to fetch issue metadata:', err);
    }

    if (!issue) {
        console.warn('Issue metadata not found. Generating fallback issue view so it can be managed.');
        issue = {
            id: issueId,
            project_id: initialProjectId === 'all' ? (store.projects[0]?.id || 'default') : initialProjectId,
            title: 'Unknown Issue (Metadata Missing)',
            status: 'unhandled',
            count: 0,
            users_affected: 0,
            is_suppressed: false,
            culprit: 'Unknown/Test Event'
        };
    }

    container.innerHTML = `
        <div class="detail-container">
            <div class="detail-header-sentry" style="display: flex; flex-direction: column; gap: 20px; padding: 24px 32px;">
                <!-- Top Row: Title, Badges, and Stats -->
                <div style="display: flex; justify-content: space-between; align-items: flex-start; width: 100%; gap: 40px;">
                    <div style="flex: 1; min-width: 0;">
                        <div class="detail-type">${issue.title.split(':')[0] || 'Error'}</div>
                        <div class="detail-msg" style="word-break: break-word;">${issue.title.split(':').slice(1).join(':') || issue.title}</div>
                        <div style="margin-top: 12px; display: flex; gap: 8px; align-items: center; flex-wrap: wrap;">
                            <span class="tag-badge ${issue.status === 'resolved' ? 'resolved' : 'unhandled'}" 
                                  style="background: ${issue.status === 'resolved' ? 'rgba(46, 204, 113, 0.1)' : 'rgba(214, 48, 49, 0.1)'}; 
                                         color: ${issue.status === 'resolved' ? '#2ecc71' : '#d63031'};">
                                ${issue.status.toUpperCase()}
                            </span>
                            ${issue.is_suppressed ? '<span class="tag-badge" style="background: rgba(243, 156, 18, 0.1); color: #f39c12;">SUPPRESSED</span>' : ''}
                            ${issue.resolved_in_version ? `<span class="tag-badge" style="background: rgba(52, 152, 219, 0.1); color: #3498db;">Fixed in ${issue.resolved_in_version}</span>` : ''}
                            <div style="margin-left: 12px; font-size: 13px; color: var(--text-secondary); font-weight: 600; font-family: 'Roboto Mono', monospace; word-break: break-all;">
                                ${issue.culprit}
                            </div>
                        </div>
                    </div>
                    <div style="display: flex; gap: 30px; text-align: right; flex-shrink: 0;">
                        <div>
                            <div class="stat-label" style="font-size: 10px; font-weight: 800; color: var(--text-secondary); letter-spacing: 1.5px; margin-bottom: 4px;">EVENTS</div>
                            <div class="stat-value" style="font-size: 24px; font-weight: 900; color: var(--text-primary);">${issue.count}</div>
                        </div>
                        <div>
                            <div class="stat-label" style="font-size: 10px; font-weight: 800; color: var(--text-secondary); letter-spacing: 1.5px; margin-bottom: 4px;">USERS</div>
                            <div class="stat-value" style="font-size: 24px; font-weight: 900; color: var(--accent); cursor: pointer;" onclick="showAffectedUsers(store.currentIssueId)">${issue.users_affected}</div>
                        </div>
                    </div>
                </div>

                <!-- Bottom Row: Action Toolbar -->
                <div style="display: flex; justify-content: space-between; align-items: center; width: 100%; border-top: 1px solid rgba(255,255,255,0.05); padding-top: 16px; flex-wrap: wrap; gap: 12px;">
                    <!-- Resolve tool -->
                    <div style="display: flex; gap: 8px; align-items: center;">
                        <input type="text" id="fix-version" placeholder="Fixed in version..." 
                               value="${issue.resolved_in_version || ''}"
                               style="height: 36px; padding: 0 12px; border: 1px solid var(--border); border-radius: 6px; font-size: 13px; background: var(--bg-sub); color: var(--text-primary); width: 160px; outline: none; transition: border-color 0.2s;"
                               onfocus="this.style.borderColor='var(--accent)'"
                               onblur="this.style.borderColor='var(--border)'">
                        <button class="btn btn-primary" onclick="resolveIssueWithVersion()" style="height: 36px; padding: 0 16px; border-radius: 6px; font-weight: 700; display: flex; align-items: center; gap: 6px;">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M20 6L9 17l-5-5"/></svg>
                            Resolve
                        </button>
                    </div>

                    <!-- Other actions -->
                    <div style="display: flex; gap: 8px; align-items: center; flex-wrap: wrap;">
                        <button class="btn" onclick="suppressIssue(${!issue.is_suppressed})" style="height: 36px; padding: 0 16px; border-radius: 6px; font-weight: 700; color: ${issue.is_suppressed ? 'var(--text-primary)' : '#f39c12'}; display: flex; align-items: center; gap: 6px;">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M4.93 4.93l14.14 14.14"/></svg>
                            ${issue.is_suppressed ? 'Unsuppress' : 'Suppress'}
                        </button>
                        <button class="btn btn-danger" onclick="deleteIssuePermanently()" style="height: 36px; padding: 0 16px; border-radius: 6px; font-weight: 700; display: flex; align-items: center; gap: 6px;">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M10 11v6M14 11v6"/></svg>
                            Delete
                        </button>
                        <button class="btn" onclick="copyIssueToClipboard()" style="height: 36px; padding: 0 16px; border-radius: 6px; font-weight: 700; display: flex; align-items: center; gap: 6px;">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
                            Copy
                        </button>
                        <div style="display: flex; align-items: center; gap: 4px; background: var(--bg-sub); border: 1px solid var(--border); border-radius: 6px; padding: 2px;">
                            <select id="export-format" style="height: 30px; border: none; background: transparent; color: var(--text-primary); font-size: 13px; font-weight: 700; padding: 0 8px; cursor: pointer; outline: none;">
                                <option value="json">JSON</option>
                                <option value="csv">CSV</option>
                            </select>
                            <button class="btn" onclick="exportIssue()" style="height: 30px; padding: 0 12px; border: none; border-radius: 4px; background: var(--bg-primary); font-weight: 800; font-size: 12px; display: flex; align-items: center; gap: 4px;">
                                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"/></svg>
                                Export
                            </button>
                        </div>
                        <button class="btn" onclick="navigate('issues')" style="height: 36px; padding: 0 16px; border-radius: 6px; font-weight: 700; display: flex; align-items: center; gap: 6px;">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 12H5M12 19l-7-7 7-7"/></svg>
                            Back
                        </button>
                    </div>
                </div>
            </div>

            <div class="detail-nav">
                <span class="nav-link active" data-tab="highlights">Highlights</span>
                <span class="nav-link" data-tab="stacktrace">Stack Trace</span>
                <span class="nav-link" data-tab="breadcrumbs">Breadcrumbs</span>
                <span class="nav-link" data-tab="tags">Tags</span>
                <span class="nav-link" data-tab="context">Context</span>
            </div>

            <div id="event-detail-content" style="padding: 30px;">
                <div style="padding: 100px; text-align: center; color: var(--text-secondary);">
                    <div class="spinner"></div>
                    <p style="margin-top: 20px; font-weight: 800;">FETCHING_EVENT_PAYLOAD...</p>
                </div>
            </div>
        </div>
    `;

    // Tab switching logic
    const navLinks = container.querySelectorAll('.nav-link');
    navLinks.forEach(link => {
        link.onclick = () => {
            navLinks.forEach(l => l.classList.remove('active'));
            link.classList.add('active');
            const tab = link.getAttribute('data-tab');
            renderTab(container.querySelector('#event-detail-content'), tab, currentEventData, issue.project_id);
        };
    });

    let currentEventData = null;
    window.activeIssueProjectId = issue.project_id;

    // Fetch real event data
    try {
        const { data: events } = await api(`/api/projects/${issue.project_id}/issues/${encodeURIComponent(issue.id)}/events`);
        if (events && events.length > 0) {
            const { data: eventData } = await api(`/api/projects/${issue.project_id}/issues/${encodeURIComponent(issue.id)}/events/${events[0].id}`);
            currentEventData = eventData;
            if (currentEventData) {
                renderTab(container.querySelector('#event-detail-content'), 'highlights', currentEventData, issue.project_id);
            }
        } else {
            container.querySelector('#event-detail-content').innerHTML = '<div class="no-data">NO_EVENTS_FOUND</div>';
        }
    } catch (e) {
        container.querySelector('#event-detail-content').innerHTML = '<div class="no-data">FAILED_TO_LOAD_DATA</div>';
    }
}

function renderTab(container, tab, data, projectId) {
    if (!data) return;

    switch(tab) {
        case 'highlights':
            container.innerHTML = `
                <div style="display: flex; flex-direction: column; gap: 30px;">
                    <div class="card">
                        <div class="card-header">Highlights</div>
                        <div class="context-grid-sentry" style="grid-template-columns: 1fr 1fr;">
                            <div class="context-row"><span class="context-key">Handled</span><span class="context-val">${data.exception?.values?.[0]?.mechanism?.handled !== false ? 'Yes' : 'No'}</span></div>
                            <div class="context-row"><span class="context-key">Level</span><span class="context-val">${data.level || 'error'}</span></div>
                            <div class="context-row"><span class="context-key">Release</span><span class="context-val">${data.release || 'unknown'}</span></div>
                            <div class="context-row"><span class="context-key">Environment</span><span class="context-val">${data.environment || 'production'}</span></div>
                            <div class="context-row" style="grid-column: span 2;"><span class="context-key">URL</span><span class="context-val">${data.request?.url || 'app:///main.js'}</span></div>
                        </div>
                    </div>
                    <div class="card">
                        <div class="card-header">Equipment & System Info</div>
                        <div class="context-grid-sentry" style="grid-template-columns: repeat(3, 1fr); gap: 20px;">
                            <div style="padding: 15px; background: var(--bg-sub); border-radius: 8px;">
                                <div style="font-size: 11px; font-weight: 800; color: var(--text-secondary); margin-bottom: 5px;">CPU</div>
                                <div style="font-weight: 700; font-size: 13px;">${data.contexts?.device?.cpu_description || 'Unknown Processor'}</div>
                            </div>
                            <div style="padding: 15px; background: var(--bg-sub); border-radius: 8px;">
                                <div style="font-size: 11px; font-weight: 800; color: var(--text-secondary); margin-bottom: 5px;">GPU / GRAPHICS</div>
                                <div style="font-weight: 700; font-size: 13px;">${data.contexts?.gpu?.name || 'Integrated Graphics'}</div>
                            </div>
                            <div style="padding: 15px; background: var(--bg-sub); border-radius: 8px;">
                                <div style="font-size: 11px; font-weight: 800; color: var(--text-secondary); margin-bottom: 5px;">RAM / SCREEN</div>
                                <div style="font-weight: 700; font-size: 13px;">${data.contexts?.device?.memory_size ? (data.contexts.device.memory_size / (1024**3)).toFixed(1) + ' GB' : '16 GB'} / ${data.contexts?.device?.screen_resolution || '1920x1080'}</div>
                            </div>
                        </div>
                    </div>
                    ${renderStackTrace(data, projectId)}
                </div>
            `;
            break;
        case 'stacktrace':
            container.innerHTML = renderStackTrace(data, projectId);
            break;
        case 'breadcrumbs':
            container.innerHTML = `
                <div class="card">
                    <div class="card-header">Breadcrumbs</div>
                    <div class="breadcrumb-list">
                        ${(Array.isArray(data.breadcrumbs?.values) ? data.breadcrumbs.values : []).map(b => `
                            <div class="breadcrumb-item">
                                <div class="breadcrumb-time">${b.timestamp ? new Date(b.timestamp * 1000).toLocaleTimeString() : '...'}</div>
                                <div class="breadcrumb-type" style="background: ${b.level === 'error' ? 'rgba(214,48,49,0.1)' : 'var(--bg-sub)'}; color: ${b.level === 'error' ? '#d63031' : 'var(--text-secondary)'};">
                                    ${b.category || 'info'}
                                </div>
                                <div class="breadcrumb-msg">${escapeHtml(b.message)}</div>
                            </div>
                        `).join('')}
                        ${(!Array.isArray(data.breadcrumbs?.values) || data.breadcrumbs.values.length === 0) ? '<div style="padding:40px; text-align:center; color:var(--text-secondary);">No breadcrumbs available.</div>' : ''}
                    </div>
                </div>
            `;
            break;
        case 'tags':
            const tags = data.tags || {};
            container.innerHTML = `
                <div class="context-grid-sentry">
                    ${Object.entries(tags).map(([key, val]) => `
                        <div class="context-card">
                            <div class="context-header">${key.toUpperCase()}</div>
                            <div class="context-row">
                                <span class="context-key">Value</span>
                                <span class="context-val">${maskSensitive(key, val)}</span>
                            </div>
                        </div>
                    `).join('')}
                    ${Object.keys(tags).length === 0 ? '<div class="no-data">NO_TAGS_FOUND</div>' : ''}
                </div>
            `;
            break;
        case 'context':
            container.innerHTML = `
                <div class="context-grid-sentry">
                    ${Object.entries(data.contexts || {}).map(([key, val]) => `
                        <div class="context-card">
                            <div class="context-header">${formatContextKey(key)}</div>
                            ${Object.entries(val || {}).map(([k, v]) => `
                                <div class="context-row">
                                    <span class="context-key">${formatContextKey(k)}</span>
                                    <span class="context-val">${formatContextValue(k, v)}</span>
                                </div>
                            `).join('')}
                        </div>
                    `).join('')}
                </div>
            `;
            break;
    }
}

function getGithubUrl(githubRepo, filename, lineno) {
    if (!githubRepo || !filename) return null;
    
    // Clean up typical prefix schemas like app:///, webpack:///, file:///, etc.
    let cleanPath = filename
        .replace(/^(app|webpack|file):\/\/\/?/, '')
        // Clean up Windows absolute paths like C:\Users\...\project\src\main.js
        .replace(/^[a-zA-Z]:\\/, '')
        .replace(/\\/g, '/'); // Normalize slashes to forward slashes
        
    return `https://github.com/${githubRepo}/blob/main/${cleanPath}#L${lineno || 1}`;
}

function renderStackTrace(data, projectId) {
    window.currentEventDataForStackTrace = data;
    const exc = data.exception?.values?.[0] || {};
    const frames = exc.stacktrace?.frames || [];
    
    if (frames.length === 0) return '<div class="card"><div class="card-header">Stack Trace</div><div style="padding:40px; text-align:center; color:var(--text-secondary);">No stack trace available.</div></div>';

    const project = store.projects.find(p => p.id === projectId);
    const githubRepo = project ? project.github_repo : null;

    if (!window.stackTraceOrder) {
        window.stackTraceOrder = 'newest';
    }
    const order = window.stackTraceOrder;

    let orderedFrames = [...frames];
    if (order === 'newest') {
        orderedFrames.reverse();
    }

    const crashFrameIndex = order === 'newest' ? 0 : orderedFrames.length - 1;

    const exceptionBox = exc.type ? `
        <div class="exception-header-box">
            <h4>${escapeHtml(exc.type)}</h4>
            <p>${escapeHtml(exc.value || 'No details provided')}</p>
        </div>
    ` : '';

    return `
        <div style="display: flex; flex-direction: column; gap: 24px;">
            ${exceptionBox}
            <div class="card" style="padding: 24px;">
                <div class="stacktrace-header-row">
                    <div class="stacktrace-title">Stack Trace</div>
                    <div class="stacktrace-controls">
                        <span style="font-size: 11px; font-weight: 800; color: var(--text-secondary); text-transform: uppercase;">Sort Order:</span>
                        <div class="stacktrace-toggle">
                            <button class="toggle-btn ${order === 'newest' ? 'active' : ''}" onclick="window.setStackTraceOrder('newest')">Newest First</button>
                            <button class="toggle-btn ${order === 'oldest' ? 'active' : ''}" onclick="window.setStackTraceOrder('oldest')">Oldest First</button>
                        </div>
                    </div>
                </div>
                <div class="stacktrace-container">
                    ${orderedFrames.map((f, idx) => {
                        const isCrash = idx === crashFrameIndex;
                        const cleanFilename = f.filename || 'unknown';
                        const githubUrl = githubRepo ? getGithubUrl(githubRepo, cleanFilename, f.lineno) : null;
                        
                        const fileDisplayHtml = githubUrl 
                            ? `<a href="${githubUrl}" target="_blank" style="color: var(--accent); text-decoration: underline; font-weight: 700; display: inline-flex; align-items: center; gap: 4px;" title="Open in GitHub">
                                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="flex-shrink:0;"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6M15 3h6v6M10 14L21 3"/></svg>
                                ${escapeHtml(cleanFilename)}:${f.lineno || '0'}
                               </a>`
                            : `<span>${escapeHtml(cleanFilename)}:${f.lineno || '0'}</span>`;

                        return `
                            <div class="stacktrace-frame ${isCrash ? 'is-crash' : ''}">
                                <div class="frame-header">
                                    <div style="display: flex; align-items: center; gap: 12px; flex-wrap: wrap;">
                                        <span class="frame-func">${escapeHtml(f.function || 'anonymous')}</span>
                                        <div class="frame-badges">
                                            ${f.in_app ? '<span class="in-app-badge">in-app</span>' : ''}
                                            ${isCrash ? '<span class="crash-badge">crash</span>' : ''}
                                        </div>
                                    </div>
                                    <span class="frame-file">${fileDisplayHtml}</span>
                                </div>
                                ${f.context_line ? `
                                    <div class="code-snippet">
                                        ${(f.pre_context || []).map((l, i) => `<div class="code-line"><span class="line-num">${f.lineno - (f.pre_context.length - i)}</span>${escapeHtml(l)}</div>`).join('')}
                                        <div class="code-line active"><span class="line-num">${f.lineno}</span>${escapeHtml(f.context_line)}</div>
                                        ${(f.post_context || []).map((l, i) => `<div class="code-line"><span class="line-num">${f.lineno + i + 1}</span>${escapeHtml(l)}</div>`).join('')}
                                    </div>
                                ` : ''}
                            </div>
                        `;
                    }).join('')}
                </div>
            </div>
        </div>
    `;
}

window.setStackTraceOrder = (order) => {
    window.stackTraceOrder = order;
    const contentDiv = document.querySelector('#event-detail-content');
    if (contentDiv && window.currentEventDataForStackTrace) {
        renderTab(contentDiv, 'stacktrace', window.currentEventDataForStackTrace, window.activeIssueProjectId);
    }
};

window.resolveIssueWithVersion = async () => {
    const id = store.currentIssueId;
    const version = document.getElementById('fix-version')?.value;
    if (confirm(`Mark this issue as resolved ${version ? `in version ${version}` : ''}?`)) {
        const issue = (store.stats.issues || []).find(i => i.id === id);
        const projectId = issue ? issue.project_id : (window.activeIssueProjectId || store.currentProjectId || 'all');
        await api(`/api/projects/${projectId}/issues/${encodeURIComponent(id)}`, {
            method: 'PUT',
            body: JSON.stringify({ status: 'resolved', resolved_in_version: version })
        });
        await refreshData();
        window.navigate('issues');
    }
};

window.suppressIssue = async (state) => {
    const id = store.currentIssueId;
    if (confirm(`Are you sure you want to ${state ? 'SUPPRESS' : 'UNSUPPRESS'} this issue? ${state ? 'New event details will no longer be stored.' : ''}`)) {
        const issue = (store.stats.issues || []).find(i => i.id === id);
        const projectId = issue ? issue.project_id : (window.activeIssueProjectId || store.currentProjectId || 'all');
        await api(`/api/projects/${projectId}/issues/${encodeURIComponent(id)}`, {
            method: 'PUT',
            body: JSON.stringify({ is_suppressed: state })
        });
        await refreshData();
        window.navigate('issue_detail', { issueId: id, projectId: projectId });
    }
};

window.deleteIssuePermanently = async () => {
    const id = store.currentIssueId;
    if (confirm('⚠️ PERMANENT DELETE: This will remove ALL logs and history for this issue. This action cannot be undone. Proceed?')) {
        const issue = (store.stats.issues || []).find(i => i.id === id);
        const projectId = issue ? issue.project_id : (window.activeIssueProjectId || store.currentProjectId || 'all');
        
        // Navigate to issues feed first to prevent re-rendering the deleted detail view during refreshData
        window.navigate('issues');
        
        await api(`/api/projects/${projectId}/issues/${encodeURIComponent(id)}`, { method: 'DELETE' });
        await refreshData();
    }
};

window.copyIssueToClipboard = async () => {
    const content = document.getElementById('event-detail-content').innerText;
    try {
        await navigator.clipboard.writeText(content);
        const btn = document.querySelector('button[onclick="copyIssueToClipboard()"]');
        const oldText = btn.innerText;
        btn.innerText = 'Copied!';
        btn.style.background = '#2ecc71';
        btn.style.color = 'white';
        setTimeout(() => {
            btn.innerText = oldText;
            btn.style.background = '';
            btn.style.color = '';
        }, 2000);
    } catch (err) {
        alert('Failed to copy. Please select text manually.');
    }
};

window.resolveIssue = async () => {
    const id = store.currentIssueId;
    if (confirm('Mark this issue as resolved?')) {
        const issue = (store.stats.issues || []).find(i => i.id === id);
        const projectId = issue ? issue.project_id : (window.activeIssueProjectId || store.currentProjectId || 'all');
        await api(`/api/projects/${projectId}/issues/${encodeURIComponent(id)}/resolve`, { method: 'POST' });
        await refreshData();
        window.navigate('issues');
    }
};

window.exportIssue = () => {
    const id = store.currentIssueId;
    const format = document.getElementById('export-format')?.value || 'json';
    const issue = (store.stats.issues || []).find(i => i.id === id);
    const projectId = issue ? issue.project_id : (window.activeIssueProjectId || store.currentProjectId || 'all');
    window.location.href = `/api/projects/${projectId}/issues/${encodeURIComponent(id)}/export?format=${format}`;
};

function formatContextKey(key) {
    if (!key) return '';
    const upperKeys = ['cpu', 'gpu', 'ram', 'os', 'ip', 'id'];
    return key
        .split(/[_\s]+|(?=[A-Z])/)
        .map(word => {
            const low = word.toLowerCase();
            if (upperKeys.includes(low)) return low.toUpperCase();
            return low.charAt(0).toUpperCase() + low.slice(1);
        })
        .join(' ')
        .trim();
}

function formatContextValue(key, val) {
    if (val === null || val === undefined || val === 'null') {
        return `<span style="color: #70a1ff; font-family: 'Roboto Mono', monospace; font-size: 11px; font-weight: 800;">null</span>`;
    }
    
    const lowKey = key.toLowerCase();
    if (lowKey.includes('size') || lowKey.includes('memory') || lowKey.includes('storage') || lowKey.includes('ram')) {
        const num = Number(val);
        if (!isNaN(num) && num > 0) {
            if (num >= 1024 ** 3) {
                return (num / (1024 ** 3)).toFixed(1) + ' GB';
            } else if (num >= 1024 ** 2) {
                return (num / (1024 ** 2)).toFixed(1) + ' MB';
            } else if (num >= 1024) {
                return (num / 1024).toFixed(1) + ' KB';
            }
            return num + ' B';
        }
    }
    
    if (typeof val === 'object') {
        return `<pre style="margin: 0; padding: 10px; background: var(--bg-sub); border: 1px solid var(--border); border-radius: 4px; font-family: monospace; font-size: 11px; white-space: pre-wrap; word-break: break-all; color: var(--text-primary); max-height: 200px; overflow-y: auto;">${escapeHtml(JSON.stringify(val, null, 2))}</pre>`;
    }
    
    return escapeHtml(String(val));
}

