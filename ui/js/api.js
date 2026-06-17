import { store, updateStore } from './store.js';

export async function api(url, options = {}) {
    try {
        const res = await fetch(url, {
            ...options,
            credentials: 'same-origin',
            headers: { 
                'Content-Type': 'application/json',
                'X-FortenLog-Request': 'true',
                ...options.headers 
            },
        });
        if (!res.ok) {
            if (res.status === 401) {
                if (url.includes('/api/system/login')) {
                    const text = await res.text();
                    return { status: res.status, data: text ? JSON.parse(text) : { success: false, error: 'Unauthorized' } };
                }
                localStorage.removeItem('logged_in');
                window.location.reload();
            }
            const text = await res.text();
            return { status: res.status, data: null, error: text || 'Request failed' };
        }
        const text = await res.text();
        return { 
            status: res.status, 
            data: text ? JSON.parse(text) : {} 
        };
    } catch (e) {
        console.warn(`API Failed: ${url}`, e);
        return { status: 0, data: null, error: e.message };
    }
}

export async function refreshData() {
    // 1. Fetch user profile if not cached yet
    if (!store.currentUser) {
        const meRes = await api('/api/system/me');
        if (meRes.data && meRes.data.username) {
            store.currentUser = meRes.data;
            if (meRes.data.password_change_required) {
                localStorage.setItem('password_change_required', 'true');
            } else {
                localStorage.removeItem('password_change_required');
            }
        }
    }

    // 2. Fetch projects first
    const projectsRes = await api('/api/settings/projects');
    const projects = projectsRes.data || [];

    // 3. Determine active projectId based on permissions
    let projectId = store.currentProjectId || 'all';
    if (store.currentUser && !store.currentUser.is_admin) {
        if (projectId === 'all' || !projects.some(p => p.id === projectId)) {
            projectId = projects.length > 0 ? projects[0].id : 'none';
            store.currentProjectId = projectId;
        }
    }

    // 4. Fetch the rest of the data
    const [statsRes, monitorsRes, storageRes, auditRes, settingsRes] = await Promise.all([
        projectId !== 'none' ? api(`/api/dashboard/stats?project_id=${projectId}`) : Promise.resolve({ data: { issues: [] } }),
        projectId !== 'none' ? api(`/api/uptime?project_id=${projectId}`) : Promise.resolve({ data: [] }),
        store.currentUser && store.currentUser.is_admin ? api('/api/settings/storage') : Promise.resolve({ data: null }),
        store.currentUser && store.currentUser.is_admin ? api('/api/settings/audit') : Promise.resolve({ data: [] }),
        store.currentUser && store.currentUser.is_admin ? api('/api/system/settings') : Promise.resolve({ data: {} })
    ]);
    
    updateStore({
        stats: statsRes.data || { issues: [] },
        monitors: monitorsRes.data || [],
        storage: storageRes.data || null,
        projects: projects,
        auditLogs: auditRes.data || [],
        systemSettings: settingsRes.data || {}
    });
}

export async function resolveIssue(id) {
    const issue = (store.stats.issues || []).find(i => i.id === id);
    const projectId = issue ? issue.project_id : (store.currentProjectId || 'all');
    await api(`/api/projects/${projectId}/issues/${encodeURIComponent(encodeURIComponent(id))}/resolve`, { method: 'POST' });
}

export async function deleteProject(id) {
    await api(`/api/settings/projects/${id}`, { method: 'DELETE' });
    await refreshData();
}

export async function createProject(payload) {
    const res = await api('/api/settings/projects', { 
        method: 'POST', 
        body: JSON.stringify(payload) 
    });
    if (res.status === 200) {
        await refreshData();
        return { success: true };
    }
    return { success: false, status: res.status };
}
