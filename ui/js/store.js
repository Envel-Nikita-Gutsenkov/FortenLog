export const store = {
    stats: { 
        issues: [],
        os_distribution: [],
        browser_distribution: [],
        region_distribution: [],
        releases: []
    },
    monitors: [],
    storage: null,
    projects: [],
    auditLogs: [],
    users: [
        { id: '1', name: 'Admin', role: 'owner', email: 'admin@fortenlog.io' }
    ],
    currentUser: null,
    currentProjectId: 'all',
    currentPath: 'issues',
    currentIssueId: null,
    currentTab: 'details',
    filters: { 
        search: '', 
        env: 'all', 
        level: 'all',
        sortKey: 'last_seen',
        sortDir: 'desc'
    }
};

export function updateStore(newData) {
    Object.assign(store, newData);
    window.dispatchEvent(new CustomEvent('store-updated'));
}
