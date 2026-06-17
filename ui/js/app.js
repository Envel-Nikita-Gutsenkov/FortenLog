import { store, updateStore } from './store.js';
import { refreshData, api } from './api.js';
import { auth } from './auth.js';
import { bufferToBase64, base64ToBuffer, escapeHtml } from './utils.js';

window.store = store;

// --- Global Navigation ---
window.navigate = (path, params = {}) => {
    console.log('[Navigate]', path, params);
    window.dispatchEvent(new CustomEvent('navigate', { detail: { path, ...params } }));
};

window.addEventListener('navigate', (e) => {
    const { path, issueId, projectId } = e.detail;
    store.currentPath = path;
    if (issueId) store.currentIssueId = issueId;
    store.currentIssueProjectId = projectId || null;

    // Clear active saved view highlight if manual navigation changed route path
    if (window.activeSavedViewId) {
        let saved = [];
        try { saved = JSON.parse(localStorage.getItem('fortenlog_saved_views') || '[]'); } catch (err) { }
        const currentSaved = saved.find(v => v.id === window.activeSavedViewId);
        if (currentSaved && currentSaved.path !== path) {
            window.activeSavedViewId = null;
        }
    }

    render();
    renderSavedViews();
});

window.addEventListener('switch-project', async (e) => {
    store.currentProjectId = e.detail;
    renderProjectDropdown();
    await refreshData();
});

function renderProjectDropdown() {
    const trigger = document.getElementById('project-trigger');
    const options = document.getElementById('project-options');
    const nameLabel = document.getElementById('selected-project-name');

    if (!trigger || !options) return;

    const current = store.projects.find(p => p.id === store.currentProjectId);
    nameLabel.innerText = current ? current.name : 'All Projects';

    const allOptions = [];
    if (store.currentUser && store.currentUser.is_admin) {
        allOptions.push({ id: 'all', name: 'All Projects' });
    }
    allOptions.push(...store.projects);

    options.innerHTML = allOptions.map(p => `
        <div class="select-option ${p.id === store.currentProjectId ? 'active' : ''}" onclick="switchProject('${p.id}')">
            ${p.name}
        </div>
    `).join('');

    trigger.onclick = (e) => {
        e.stopPropagation();
        options.classList.toggle('open');
    };
}

document.addEventListener('click', () => {
    const options = document.getElementById('project-options');
    if (options) options.classList.remove('open');
});

// --- Modal System ---
window.addEventListener('open-modal', (e) => {
    const { title, html, onRender, wide } = e.detail;
    const overlay = document.getElementById('modal-overlay');
    const content = document.getElementById('modal-content');

    if (wide) content.classList.add('wide');
    else content.classList.remove('wide');

    content.innerHTML = `
        <div class="modal-header">
            <h3 style="margin: 0; font-size: 18px; font-weight: 800;">${title}</h3>
            <button class="btn btn-sm" onclick="closeModal()" style="border: none; background: transparent; font-size: 20px; color: var(--text-secondary);">&times;</button>
        </div>
        <div class="modal-body" style="${wide ? 'padding: 0;' : ''}">
            ${html}
        </div>
    `;

    overlay.style.display = 'flex';
    if (onRender) onRender(content);
});

window.addEventListener('close-modal', () => {
    document.getElementById('modal-overlay').style.display = 'none';
});

// --- Premium Global Toast System ---
(function () {
    // Inject Toast CSS
    const style = document.createElement('style');
    style.innerHTML = `
        .toast-container {
            position: fixed;
            top: 24px;
            right: 24px;
            z-index: 99999;
            display: flex;
            flex-direction: column;
            gap: 12px;
            pointer-events: none;
        }
        .toast {
            pointer-events: auto;
            min-width: 300px;
            max-width: 450px;
            background: rgba(30, 30, 42, 0.95);
            border: 1px solid rgba(255, 255, 255, 0.08);
            border-left: 4px solid var(--accent);
            backdrop-filter: blur(16px);
            border-radius: 10px;
            padding: 14px 18px;
            color: #ffffff;
            box-shadow: 0 12px 30px rgba(0, 0, 0, 0.5);
            display: flex;
            align-items: center;
            gap: 12px;
            transform: translateX(120%);
            transition: transform 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.275), opacity 0.3s ease;
            opacity: 0;
        }
        .toast.show {
            transform: translateX(0);
            opacity: 1;
        }
        .toast.hide {
            transform: translateY(-20px);
            opacity: 0;
        }
        .toast-icon {
            font-size: 18px;
            flex-shrink: 0;
        }
        .toast-message {
            font-size: 13px;
            font-weight: 600;
            line-height: 1.4;
        }
        .toast.success {
            border-left-color: #00b894;
        }
        .toast.error {
            border-left-color: #ff4c4c;
        }
        .toast.warning {
            border-left-color: #fdcb6e;
        }
    `;
    document.head.appendChild(style);

    // Create Toast Container
    const container = document.createElement('div');
    container.className = 'toast-container';
    document.body.appendChild(container);

    // Override window.alert
    window.alert = function (message) {
        const toast = document.createElement('div');

        // Determine type based on keywords
        let type = 'info';
        let icon = 'ℹ️';
        const msgLower = message.toLowerCase();

        if (msgLower.includes('success') || msgLower.includes('complete') || msgLower.includes('purge') || msgLower.includes('optim') || msgLower.includes('save') || msgLower.includes('update') || msgLower.includes('activated') || msgLower.includes('registered')) {
            type = 'success';
            icon = '✅';
        } else if (msgLower.includes('fail') || msgLower.includes('denied') || msgLower.includes('error') || msgLower.includes('incorrect') || msgLower.includes('require')) {
            type = 'error';
            icon = '❌';
        } else if (msgLower.includes('warning') || msgLower.includes('caution')) {
            type = 'warning';
            icon = '⚠️';
        }

        toast.className = `toast ${type}`;
        toast.innerHTML = `
            <span class="toast-icon">${icon}</span>
            <span class="toast-message">${message}</span>
        `;

        container.appendChild(toast);

        // Trigger show animation
        setTimeout(() => toast.classList.add('show'), 50);

        // Remove toast after 4 seconds
        setTimeout(() => {
            toast.classList.add('hide');
            toast.addEventListener('transitionend', () => {
                toast.remove();
            });
        }, 4000);
    };
})();

function syncSidebars() {
    const path = store.currentPath || 'issues';

    const changeRequired = localStorage.getItem('password_change_required') === 'true'
        || (store.currentUser && store.currentUser.password_change_required);

    if (changeRequired) {
        // Hide all secondary sidebar sections
        document.querySelectorAll('.sidebar-secondary .sub-nav-section').forEach(el => {
            el.style.display = 'none';
        });
        // Hide primary navigation except settings & logout
        document.querySelectorAll('.nav-icon').forEach(el => {
            if (el.id !== 'nav-settings' && !el.getAttribute('onclick').includes('logout')) {
                el.style.display = 'none';
            } else {
                el.style.display = '';
            }
        });
        return;
    }

    // Hide administrative links from sidebar if the user is not an admin
    const isAdmin = store.currentUser && store.currentUser.is_admin;
    const adminElements = [
        '#nav-users',
        '#nav-settings',
        '#subnav-users',
        '#subnav-settings',
        '#subnav-storage',
        '#subnav-audit',
        '#subnav-performance'
    ];
    adminElements.forEach(selector => {
        const el = document.querySelector(selector);
        if (el) {
            el.style.display = isAdmin ? '' : 'none';
        }
    });

    // Path mapping for sidebars
    const primaryMap = {
        'issues': 'issues',
        'issue_detail': 'issues',
        'analytics': 'analytics',
        'explore': 'analytics',
        'explorer': 'explorer',
        'dashboard_builder': 'analytics',
        'uptime': 'uptime',
        'users': 'users',
        'settings': 'settings',
        'security_profile': 'settings',
        'projects': 'settings',
        'storage': 'settings',
        'audit': 'settings',
        'docs': 'settings',
        'performance': 'settings',
        'api_keys': 'settings',
    };

    const primaryPath = primaryMap[path] || path;

    // Sync Primary Sidebar
    document.querySelectorAll('.nav-icon').forEach(el => {
        el.classList.remove('active');
        if (el.id === `nav-${primaryPath}`) el.classList.add('active');
    });

    // Sync Secondary Sidebar
    document.querySelectorAll('.sub-nav-item').forEach(el => {
        el.classList.remove('active');
        const normalizedPath = path.replace(/_/g, '-');
        if (el.id === `subnav-${path}` || el.id === `subnav-${normalizedPath}`) el.classList.add('active');
    });
}

// --- Main Render Function ---
async function render() {
    const container = document.getElementById('view-content');
    if (!container) return;

    const path = store.currentPath || 'issues';

    const changeRequired = localStorage.getItem('password_change_required') === 'true'
        || (store.currentUser && store.currentUser.password_change_required);

    if (changeRequired) {
        if (path !== 'security_profile') {
            console.warn('[Security Shield] Password change required. Redirecting to security profile.');
            store.currentPath = 'security_profile';
            render();
            return;
        }
    }

    // Route protection: redirect non-admin from admin views
    const adminPaths = ['users', 'settings', 'storage', 'audit', 'performance', 'api_keys'];
    if (adminPaths.includes(path) && (!store.currentUser || !store.currentUser.is_admin)) {
        console.warn(`[Navigation Shield] Redirecting unauthorized user from ${path}`);
        store.currentPath = 'issues';
        render();
        return;
    }

    if (path === 'issue_detail') {
        container.style.padding = '0';
    } else {
        container.style.padding = '';
    }

    console.log('[Render]', path);
    syncSidebars();

    // Dynamically show/hide the header export button based on the active tab
    const exportBtn = document.getElementById('header-export-btn');
    if (exportBtn) {
        if (path === 'issues') {
            exportBtn.style.display = 'flex';
            exportBtn.title = store.currentProjectId === 'all'
                ? "Export All Projects Issues (CSV)"
                : `Export Project Issues (CSV)`;
        } else {
            exportBtn.style.display = 'none';
        }
    }

    // Update issue count badge in sidebar
    const badge = document.getElementById('issue-count-badge');
    if (badge) {
        let issues = store.stats.issues || [];
        if (store.currentProjectId !== 'all') {
            issues = issues.filter(i => i.project_id === store.currentProjectId);
        }
        const unresolvedCount = issues.filter(i => i.status !== 'resolved').length;
        badge.innerText = unresolvedCount;
        if (unresolvedCount > 0) {
            badge.style.display = 'inline-block';
        } else {
            badge.style.display = 'none';
        }
    }

    const currentProject = store.projects.find(p => p.id === store.currentProjectId);
    const projectName = currentProject ? currentProject.name : 'All Projects';

    const breadcrumb = document.getElementById('breadcrumb-text');
    if (breadcrumb) {
        const breadcrumbMap = {
            'issues': ['Analytics', 'Issues'],
            'issue_detail': ['Analytics', 'Issues', store.currentIssueId ? `Issue #${store.currentIssueId}` : 'Detail'],
            'analytics': ['Analytics', 'Overview Dashboard'],
            'explore': ['Analytics', 'Event Explorer'],
            'dashboard_builder': ['Analytics', 'Custom Dashboards'],
            'projects': ['Management', 'Project Registry'],
            'storage': ['Management', 'Storage & Backups'],
            'users': ['Management', 'User Registry'],
            'uptime': ['Infrastructure', 'Uptime Monitors'],
            'audit': ['Infrastructure', 'Global Audit Log'],
            'docs': ['Infrastructure', 'Documentation'],
            'settings': ['Infrastructure', 'Server Settings'],
            'security_profile': ['Infrastructure', 'Server Settings', 'Security Profile'],
            'performance': ['Infrastructure', 'System Diagnostics'],
            'api_keys': ['Infrastructure', 'API Keys'],
        };

        const segments = breadcrumbMap[path] || [path.charAt(0).toUpperCase() + path.slice(1)];
        const breadcrumbHtml = [
            `<span style="color: var(--text-secondary); font-weight: 500;">${projectName}</span>`,
            ...segments.map(seg => `<span style="font-weight: 800; color: var(--text-primary);">${seg}</span>`)
        ].join(' <span style="color: var(--text-secondary); margin: 0 8px; font-weight: 300; font-size: 11px;">»</span> ');

        breadcrumb.innerHTML = breadcrumbHtml;
    }

    try {
        switch (path) {
            case 'issues': {
                const { renderIssueList } = await import('./views/issues.js');
                renderIssueList(container);
                break;
            }
            case 'issue_detail': {
                const { renderIssueDetail } = await import('./views/detail.js');
                renderIssueDetail(container);
                break;
            }
            case 'uptime': {
                const { renderUptime } = await import('./views/uptime.js');
                renderUptime(container);
                break;
            }
            case 'projects': {
                const { renderProjects } = await import('./views/projects.js');
                renderProjects(container);
                break;
            }
            case 'analytics': {
                const { renderAnalytics } = await import('./views/analytics.js');
                renderAnalytics(container);
                break;
            }
            case 'explore': {
                const { renderExplore } = await import('./views/explore.js');
                renderExplore(container);
                break;
            }
            case 'docs': {
                const { renderDocs } = await import('./views/docs.js');
                renderDocs(container);
                break;
            }
            case 'users': {
                const { renderUsers } = await import('./views/users.js');
                renderUsers(container);
                break;
            }
            case 'audit': {
                const { renderAudit } = await import('./views/audit.js');
                renderAudit(container);
                break;
            }
            case 'settings': {
                const { renderSettings } = await import('./views/settings.js');
                renderSettings(container);
                break;
            }
            case 'security_profile': {
                const { renderSecurityProfile } = await import('./views/settings.js');
                renderSecurityProfile(container);
                break;
            }
            case 'storage': {
                const { renderStorage } = await import('./views/storage.js');
                renderStorage(container);
                break;
            }
            case 'performance': {
                const { renderPerformance } = await import('./views/performance.js');
                renderPerformance(container);
                break;
            }
            case 'dashboard_builder': {
                const { renderDashboardBuilder } = await import('./views/dashboard_builder.js');
                renderDashboardBuilder(container);
                break;
            }
            case 'api_keys': {
                const { renderApiKeysView } = await import('./views/api_keys.js');
                await renderApiKeysView(container);
                break;
            }
            default: container.innerHTML = `<div style="padding: 40px;"><h1>${path.toUpperCase()}</h1><p>View not found.</p></div>`;
        }
    } catch (err) {
        console.error('[Render Error]', err);
        container.innerHTML = `<div style="padding: 40px; color: var(--error);"><h1>RENDER_FAILED</h1><p>${err.message}</p></div>`;
    }
}

function renderLogin() {
    const container = document.getElementById('view-content');
    const sp = document.querySelector('.sidebar-primary');
    const ss = document.querySelector('.sidebar-secondary');
    const header = document.querySelector('.header');

    if (sp) sp.style.display = 'none';
    if (ss) ss.style.display = 'none';
    if (header) header.style.display = 'none';

    // Ensure the layout grid allows the login card to take full space
    const layout = document.querySelector('.layout');
    if (layout) {
        layout.style.display = 'block';
        layout.style.padding = '0';
        layout.style.visibility = 'visible';
        layout.style.opacity = '1';
    }
    container.innerHTML = `
        <style>
            .login-wrap {
                position: fixed; top: 0; left: 0; width: 100vw; height: 100vh;
                display: flex; align-items: center; justify-content: center;
                background: #09090b; overflow: hidden; color: #fff; z-index: 9999;
                font-family: 'Outfit', 'Inter', sans-serif;
            }
            .login-bg-shape1 {
                position: absolute; width: 600px; height: 600px;
                background: radial-gradient(circle, rgba(93,81,232,0.3) 0%, rgba(93,81,232,0) 70%);
                top: -150px; left: -100px; border-radius: 50%; filter: blur(60px);
                animation: float1 12s ease-in-out infinite; pointer-events: none;
            }
            .login-bg-shape2 {
                position: absolute; width: 500px; height: 500px;
                background: radial-gradient(circle, rgba(0,184,148,0.15) 0%, rgba(0,184,148,0) 70%);
                bottom: -100px; right: -50px; border-radius: 50%; filter: blur(60px);
                animation: float2 15s ease-in-out infinite reverse; pointer-events: none;
            }
            .login-glass-card {
                position: relative; z-index: 10; width: 420px; padding: 50px 40px;
                background: rgba(255, 255, 255, 0.03);
                border: 1px solid rgba(255, 255, 255, 0.06);
                border-radius: 24px;
                box-shadow: 0 30px 60px rgba(0,0,0,0.6), inset 0 1px 0 rgba(255,255,255,0.1);
                backdrop-filter: blur(24px); -webkit-backdrop-filter: blur(24px);
                text-align: center;
                animation: slideUp 0.7s cubic-bezier(0.16, 1, 0.3, 1) forwards;
                opacity: 0; transform: translateY(30px);
            }
            @keyframes slideUp { to { opacity: 1; transform: translateY(0); } }
            @keyframes float1 { 0%, 100% { transform: translate(0, 0); } 50% { transform: translate(40px, 40px); } }
            @keyframes float2 { 0%, 100% { transform: translate(0, 0); } 50% { transform: translate(-30px, -50px); } }
            .login-input {
                width: 100%; padding: 14px 16px; background: rgba(0,0,0,0.2);
                border: 1px solid rgba(255,255,255,0.1); border-radius: 12px; color: #fff;
                font-size: 14px; outline: none; transition: all 0.3s ease;
            }
            .login-input:focus {
                background: rgba(0,0,0,0.4); border-color: #5d51e8;
                box-shadow: 0 0 0 3px rgba(93,81,232,0.3);
            }
            .login-input::placeholder { color: rgba(255,255,255,0.3); }
            .login-btn-primary {
                width: 100%; padding: 14px; background: linear-gradient(135deg, #5d51e8, #7a70ff);
                color: #fff; border: none; border-radius: 12px; font-size: 14px; font-weight: 800;
                cursor: pointer; transition: all 0.3s ease; box-shadow: 0 4px 15px rgba(93,81,232,0.4);
            }
            .login-btn-primary:hover {
                transform: translateY(-2px); box-shadow: 0 8px 25px rgba(93,81,232,0.6);
            }
            .login-btn-outline {
                width: 100%; padding: 14px; background: transparent; color: #e1e1e6;
                border: 1px solid rgba(255,255,255,0.2); border-radius: 12px; font-size: 14px; font-weight: 700;
                cursor: pointer; transition: all 0.3s ease;
            }
            .login-btn-outline:hover {
                background: rgba(255,255,255,0.05); border-color: rgba(255,255,255,0.4);
            }
        </style>
        <div class="login-wrap">
            <div class="login-bg-shape1"></div>
            <div class="login-bg-shape2"></div>
            <div class="login-glass-card">
                <div style="font-size: 38px; font-weight: 900; color: #5d51e8; margin-bottom: 8px; letter-spacing: -1.5px; text-shadow: 0 0 20px rgba(93,81,232,0.4);">Forten<span style="color:#fff">Log</span></div>
                <h2 style="margin-bottom: 32px; font-size: 15px; font-weight: 600; color: rgba(255,255,255,0.5); letter-spacing: 2px; text-transform: uppercase;">Terminal Access</h2>
                
                <div style="display: flex; flex-direction: column; gap: 18px; text-align: left;">
                    <div>
                        <label style="font-size: 11px; font-weight: 800; color: rgba(255,255,255,0.6); margin-bottom: 8px; display: block; letter-spacing: 0.5px;">USERNAME</label>
                        <input type="text" id="login-user" class="login-input" placeholder="admin">
                    </div>
                    <div>
                        <label style="font-size: 11px; font-weight: 800; color: rgba(255,255,255,0.6); margin-bottom: 8px; display: block; letter-spacing: 0.5px;">PASSWORD</label>
                        <input type="password" id="login-pass" class="login-input" placeholder="••••••••">
                    </div>
                    <div style="margin-top: 8px;">
                        <button id="login-btn" class="login-btn-primary" style="margin-bottom: 12px;">Initialize Session</button>
                        <button id="webauthn-btn" class="login-btn-outline">Authenticate via Passkey</button>
                    </div>
                    <div id="login-error" style="color: #ff4757; font-size: 13px; font-weight: 600; text-align: center; display: none; padding: 10px; background: rgba(255, 71, 87, 0.1); border-radius: 8px; border: 1px solid rgba(255, 71, 87, 0.2);">Invalid credentials</div>
                </div>
                <div style="margin-top: 40px; font-size: 11px; font-weight: 600; color: rgba(255,255,255,0.3); letter-spacing: 0.5px;">ENTERPRISE TELEMETRY INFRASTRUCTURE &bull; v0.1.0</div>
            </div>
        </div>
    `;

    document.getElementById('login-btn').onclick = async () => {
        const username = document.getElementById('login-user').value;
        const password = document.getElementById('login-pass').value;
        const res = await auth.login(username, password);
        if (res.success) {
            window.location.reload();
        } else {
            const errorEl = document.getElementById('login-error');
            errorEl.innerText = res.error || 'Invalid credentials';
            errorEl.style.display = 'block';
        }
    };

    document.getElementById('webauthn-btn').onclick = async () => {
        const username = document.getElementById('login-user').value;
        if (!username) {
            alert('Please enter your username first.');
            return;
        }

        try {
            const apiRes = await api('/api/system/webauthn/login/start', {
                method: 'POST',
                body: JSON.stringify({ username })
            });
            const rcr = apiRes.data;

            if (!rcr || !rcr.publicKey) {
                throw new Error(apiRes.error || 'Failed to start WebAuthn login');
            }

            // Convert base64 fields to buffers
            rcr.publicKey.challenge = base64ToBuffer(rcr.publicKey.challenge);
            if (rcr.publicKey.allowCredentials) {
                rcr.publicKey.allowCredentials.forEach(c => c.id = base64ToBuffer(c.id));
            }

            const assertion = await navigator.credentials.get(rcr);

            const response = {
                id: assertion.id,
                rawId: bufferToBase64(assertion.rawId),
                type: assertion.type,
                response: {
                    authenticatorData: bufferToBase64(assertion.response.authenticatorData),
                    clientDataJSON: bufferToBase64(assertion.response.clientDataJSON),
                    signature: bufferToBase64(assertion.response.signature),
                    userHandle: assertion.response.userHandle ? bufferToBase64(assertion.response.userHandle) : null,
                },
            };

            const res = await api('/api/system/webauthn/login/finish', {
                method: 'POST',
                headers: { 'X-Webauthn-Username': username },
                body: JSON.stringify(response)
            });

            if (res && res.data && res.data.success) {
                localStorage.setItem('logged_in', 'true');
                window.location.reload();
            }
        } catch (e) {
            console.error('WebAuthn login failed', e);
            alert('Passkey login failed: ' + e.message);
        }
    };
}

// WebAuthn helpers moved to utils.js

// --- Lifecycle ---
async function init() {
    console.log('[FortenLog] Initializing UI...');

    try {
        if (!auth.isAuthenticated()) {
            console.log('[FortenLog] User not authenticated, rendering login...');
            renderLogin();
        } else {
            // Initial data fetch (refreshData dispatches 'store-updated' which calls render())
            await refreshData();
            renderProjectDropdown();
            // Setup global Saved Views bookmarking system
            setupSavedViews();

            // Setup Dashboard Auto-Refresh (Every 15s)
            if (!window.autoRefreshInterval) {
                window.autoRefreshInterval = setInterval(async () => {
                    // Only refresh if user is auth'd and no modal is currently open (to prevent hijacking focus)
                    const modal = document.querySelector('.modal-overlay');
                    const isModalOpen = modal && modal.style.display !== 'none' && modal.style.display !== '';

                    if (auth.isAuthenticated() && !isModalOpen) {
                        const path = store.currentPath || 'issues';
                        const autoRefreshPaths = ['issues', 'analytics', 'uptime', 'performance'];
                        if (autoRefreshPaths.includes(path)) {
                            await refreshData();
                        }
                    }
                }, 15000);
            }
        }
    } catch (e) {
        console.error('[Init Error]', e);
        if (e.status === 401) {
            renderLogin();
        }
    } finally {
        revealUI();
    }
}

function revealUI() {
    const layout = document.querySelector('.layout');
    if (layout && layout.style.visibility !== 'visible') {
        console.log('[FortenLog] Revealing UI layout.');
        layout.style.visibility = 'visible';
        layout.style.opacity = '1';
    }
}

// --- Global Saved Views Bookmarking System ---
function setupSavedViews() {
    const saveBtn = document.getElementById('btn-save-view-global');
    if (!saveBtn) return;

    renderSavedViews();

    saveBtn.onclick = () => {
        const path = store.currentPath;
        if (path === 'login' || path === 'security_profile') return;

        let suggestedName = '';
        const currentProject = store.projects.find(p => p.id === store.currentProjectId);
        const projectName = currentProject ? currentProject.name : 'All Projects';

        if (path === 'issues') {
            const status = store.filters.status || 'all';
            const search = store.filters.search ? ` matching "${store.filters.search}"` : '';
            suggestedName = `[${projectName}] Issues - ${status.toUpperCase()}${search}`;
        } else if (path === 'explorer') {
            const searchEl = document.getElementById('explorer-search');
            const search = searchEl && searchEl.value ? ` matching "${searchEl.value}"` : '';
            const typeEl = document.getElementById('explorer-type');
            const type = typeEl && typeEl.value ? ` (${typeEl.value.toUpperCase()})` : '';
            suggestedName = `[${projectName}] Explorer${type}${search}`;
        } else if (path === 'dashboard_builder') {
            suggestedName = `[${projectName}] Custom Analytics Dashboard`;
        } else if (path === 'uptime') {
            suggestedName = `[${projectName}] Uptime Performance Monitor`;
        } else {
            suggestedName = `[${projectName}] ${path.charAt(0).toUpperCase() + path.slice(1)} View`;
        }

        window.dispatchEvent(new CustomEvent('open-modal', {
            detail: {
                title: 'Save Current View Bookmark',
                wide: false,
                html: `
                    <div style="padding: 24px; display: flex; flex-direction: column; gap: 20px;">
                        <p style="color: var(--text-secondary); margin: 0; font-size: 13px; line-height: 1.5;">
                            Create a persistent shortcut to this exact view, including the active project, tab, and search filters.
                        </p>
                        <div>
                            <label class="input-label" style="margin-bottom: 8px;">BOOKMARK NAME</label>
                            <input type="text" id="m-save-view-name" class="search-input" value="${suggestedName}" style="width: 100%;" placeholder="e.g. Production Errors">
                        </div>
                        <div style="display: flex; justify-content: flex-end; gap: 12px; margin-top: 10px; padding-top: 15px; border-top: 1px solid var(--border);">
                            <button class="btn" onclick="closeModal()">Cancel</button>
                            <button class="btn btn-primary" id="btn-confirm-save-view" style="padding: 0 24px;">Save View Shortcut</button>
                        </div>
                    </div>
                `,
                onRender: (modal) => {
                    modal.querySelector('#btn-confirm-save-view').onclick = () => {
                        const nameInput = modal.querySelector('#m-save-view-name');
                        const viewName = nameInput.value.trim() || suggestedName;

                        const viewState = {
                            id: 'view-' + Date.now(),
                            name: viewName,
                            path: path,
                            projectId: store.currentProjectId,
                            filters: {}
                        };

                        if (path === 'issues') {
                            viewState.filters = {
                                search: store.filters.search,
                                status: store.filters.status,
                                sortKey: store.filters.sortKey,
                                sortDir: store.filters.sortDir
                            };
                        } else if (path === 'explorer') {
                            const searchEl = document.getElementById('explorer-search');
                            const typeEl = document.getElementById('explorer-type');
                            const osEl = document.getElementById('explorer-os');
                            viewState.filters = {
                                search: searchEl ? searchEl.value : '',
                                event_type: typeEl ? typeEl.value : '',
                                os: osEl ? osEl.value : ''
                            };
                        }

                        let saved = [];
                        try {
                            saved = JSON.parse(localStorage.getItem('fortenlog_saved_views') || '[]');
                        } catch (e) { }
                        saved.push(viewState);
                        localStorage.setItem('fortenlog_saved_views', JSON.stringify(saved));

                        window.closeModal();
                        alert(`Successfully bookmarked view: "${viewName}"`);
                        renderSavedViews();
                    };
                }
            }
        }));
    };
}

function renderSavedViews() {
    const section = document.getElementById('sidebar-saved-views-section');
    const list = document.getElementById('sidebar-saved-views-list');
    if (!section || !list) return;

    let saved = [];
    try {
        saved = JSON.parse(localStorage.getItem('fortenlog_saved_views') || '[]');
    } catch (e) { }

    if (saved.length === 0) {
        section.style.display = 'none';
        return;
    }

    section.style.display = 'block';
    list.innerHTML = saved.map(v => `
        <div class="sub-nav-item" style="display: flex; justify-content: space-between; align-items: center; padding-right: 8px;" id="subnav-saved-${v.id}">
            <span onclick="loadSavedView('${v.id}')" style="flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 12px; cursor: pointer;" title="${v.name}">
                📌 ${v.name}
            </span>
            <span onclick="deleteSavedView(event, '${v.id}')" style="color: var(--text-secondary); opacity: 0.4; cursor: pointer; font-size: 14px; font-weight: 800; padding: 2px 6px;" title="Delete Bookmark">&times;</span>
        </div>
    `).join('');

    // Highlight current active saved view if applicable
    if (window.activeSavedViewId) {
        const activeItem = document.getElementById(`subnav-saved-${window.activeSavedViewId}`);
        if (activeItem) activeItem.classList.add('active');
    }
}

window.loadSavedView = (id) => {
    let saved = [];
    try {
        saved = JSON.parse(localStorage.getItem('fortenlog_saved_views') || '[]');
    } catch (e) { }

    const view = saved.find(v => v.id === id);
    if (!view) return;

    window.activeSavedViewId = id;

    // 1. Switch active project
    if (view.projectId) {
        window.switchProject(view.projectId);
    }

    // 2. Load the view path & restore parameters
    if (view.path === 'issues') {
        store.filters.search = view.filters.search || '';
        store.filters.status = view.filters.status || 'all';
        store.filters.sortKey = view.filters.sortKey || 'last_seen';
        store.filters.sortDir = view.filters.sortDir || 'desc';
    } else if (view.path === 'explorer') {
        window.pendingExplorerFilters = view.filters;
    }

    window.navigate(view.path);
    renderSavedViews();
};

window.deleteSavedView = (e, id) => {
    if (e) {
        e.stopPropagation();
        e.preventDefault();
    }
    let saved = [];
    try {
        saved = JSON.parse(localStorage.getItem('fortenlog_saved_views') || '[]');
    } catch (err) { }

    const view = saved.find(v => v.id === id);
    if (!view) return;

    if (confirm(`Delete the saved view "${view.name}"?`)) {
        saved = saved.filter(v => v.id !== id);
        localStorage.setItem('fortenlog_saved_views', JSON.stringify(saved));
        if (window.activeSavedViewId === id) window.activeSavedViewId = null;
        renderSavedViews();
    }
};

// Initialize on DOMContentLoaded or immediately if already loaded
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}

// Safety fallback for slow resource loads
setTimeout(revealUI, 2000);

// Global helpers for non-module scripts
window.switchProject = (id) => window.dispatchEvent(new CustomEvent('switch-project', { detail: id }));
window.refreshData = refreshData;
window.closeModal = () => window.dispatchEvent(new CustomEvent('close-modal'));
window.navigate = navigate;
window.exportData = () => {
    const projectId = store.currentProjectId || 'all';
    window.location.href = `/api/system/export/csv?project_id=${projectId}`;
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

window.resolveIssue = async (id) => {
    if (confirm('Mark this issue as resolved?')) {
        const issue = (store.stats.issues || []).find(i => i.id === id);
        const projectId = issue ? issue.project_id : (store.currentProjectId || 'all');
        await api(`/api/projects/${projectId}/issues/${encodeURIComponent(encodeURIComponent(id))}/resolve`, { method: 'POST' });
        await refreshData();
        window.navigate('issues');
    }
};

window.showAffectedUsers = async (id) => {
    const issue = (store.stats.issues || []).find(i => i.id === id);
    const projectId = issue ? issue.project_id : (store.currentProjectId || 'all');
    const { data: users } = await api(`/api/projects/${projectId}/issues/${encodeURIComponent(encodeURIComponent(id))}/users`);
    if (!users) return alert('Failed to load affected users.');

    window.dispatchEvent(new CustomEvent('open-modal', {
        detail: {
            title: 'Affected Identities Distribution',
            wide: true,
            html: `
                <div style="padding: 20px; background: var(--bg-sub); font-size: 11px; font-weight: 800; color: var(--text-secondary); border-bottom: 1px solid var(--border);">
                    ANALYTICS // UNIQUE FINGERPRINTS FOR ISSUE <span style="color: var(--accent);">${id}</span>
                </div>
                <div style="max-height: 60vh; overflow-y: auto;">
                    <table class="issue-table" style="width: 100%; border-collapse: separate; border-spacing: 0;">
                        <thead style="position: sticky; top: 0; z-index: 10; background: var(--bg-main);">
                            <tr>
                                <th style="padding: 16px 24px;">Identity / IP Address</th>
                                <th>Location</th>
                                <th>OS / Environment</th>
                                <th>Browser</th>
                                <th>Events (%)</th>
                                <th>Last Activity</th>
                                <th style="text-align: right; padding-right: 24px;">Actions</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${users.map(u => `
                                <tr>
                                    <td style="padding: 16px 24px;">
                                        <div style="font-family: 'Roboto Mono', monospace; font-size: 13px; color: var(--accent); font-weight: 800;">${u.ip || '0.0.0.0'}</div>
                                        <div style="font-size: 10px; color: var(--text-secondary); opacity: 0.7;">FP: ${u.fingerprint?.substring(0, 8) || 'ANON'}...</div>
                                    </td>
                                    <td>
                                        <div style="display: flex; align-items: center; gap: 8px;">
                                            <span style="font-size: 16px;">${u.region === 'RU' ? '🇷🇺' : '🌐'}</span>
                                            <span style="font-weight: 700;">${u.region || 'Global'}</span>
                                        </div>
                                    </td>
                                    <td>
                                        <div style="font-weight: 800; font-size: 13px; color: var(--text-primary); margin-bottom: 2px;">
                                            ${u.os || 'Generic System'}
                                        </div>
                                        <div style="font-size: 10px; color: var(--text-secondary); font-weight: 700; opacity: 0.75; text-transform: uppercase;">
                                            ${u.environment || 'production'}${u.cpu ? ` // ${u.cpu}` : ''}
                                        </div>
                                    </td>
                                    <td style="font-weight: 600; font-size: 12px; color: var(--text-secondary);">${u.browser || 'Unknown'}</td>
                                    <td style="font-size: 13px; font-weight: 800; color: var(--accent);">
                                        ${u.event_count || 1} <span style="font-size: 10px; color: var(--text-secondary); font-weight: 600;">(${u.percentage || 0}%)</span>
                                    </td>
                                    <td style="font-size: 12px; font-weight: 600;">${new Date(u.last_seen).toLocaleString()}</td>
                                    <td style="text-align: right; padding-right: 24px;">
                                        <button class="btn btn-sm btn-primary" data-issue-id="${escapeHtml(id)}" data-project-id="${escapeHtml(projectId)}" onclick="closeModal(); navigate('issue_detail', { issueId: this.getAttribute('data-issue-id'), projectId: this.getAttribute('data-project-id') })">Drill Down</button>
                                    </td>
                                </tr>
                            `).join('')}
                        </tbody>
                    </table>
                </div>
                <div style="padding: 16px 24px; border-top: 1px solid var(--border); display: flex; justify-content: space-between; align-items: center; background: var(--bg-sub);">
                    <div style="font-size: 11px; color: var(--text-secondary); font-weight: 700;">TOTAL SESSIONS: ${users.length}</div>
                    <button class="btn btn-sm" onclick="closeModal()">Close Monitor</button>
                </div>
            `
        }
    }));
};

// Sync UI on store update
window.addEventListener('store-updated', () => {
    console.log('[Store Updated]');
    render();
    renderProjectDropdown();
});
