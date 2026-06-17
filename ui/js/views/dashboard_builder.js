import { api } from '../api.js';
import { buildWidgetDOM } from './dashboard/WidgetDOM.js';
import { configureWidgetModal } from './dashboard/WidgetModal.js';

// Global leak-free Chart instances tracking
if (!window.activeDashboardCharts) {
    window.activeDashboardCharts = {};
}

let widgets = [];
let projectsList = [];
let currentDashboardId = null;

export async function renderDashboardBuilder() {
    const container = document.getElementById('view-content');
    container.innerHTML = `
        <div class="view-header">
            <div>
                <h1>Custom Dashboard Builder</h1>
                <p>Build and arrange enterprise-grade telemetry reports with safe whitelisted queries.</p>
            </div>
            <div style="display: flex; gap: 12px; align-items: center;">
                <select id="select-project-dashboard" class="search-input" style="width: 180px; height: 38px;">
                    <option value="">-- Select Project --</option>
                </select>
                <select id="select-dashboard" class="search-input" style="width: 180px; height: 38px;">
                    <option value="">-- Load Dashboard --</option>
                </select>
                <button class="btn" id="btn-save-dashboard" style="height: 38px;">Save Dashboard</button>
                <button class="btn" id="btn-import-json" style="height: 38px;">{ } Import JSON</button>
                <button class="btn btn-primary" id="btn-add-widget" style="height: 38px;">+ Add Widget</button>
            </div>
        </div>

        <div id="dashboard-grid" style="display: grid; grid-template-columns: repeat(4, 1fr); gap: 24px; margin-top: 10px;">
            <!-- Widgets will be injected here -->
        </div>

        <div id="json-import-modal" class="modal-overlay" style="display: none; position: fixed; inset: 0; background: rgba(0,0,0,0.8); z-index: 1000; align-items: center; justify-content: center;">
            <div class="card" style="width: 600px; padding: 24px;">
                <h3 style="margin-bottom: 15px;">Import Widget via JSON</h3>
                <textarea id="json-import-textarea" class="search-input" style="width: 100%; height: 300px; font-family: monospace; padding: 12px;" placeholder="Paste JSON here..."></textarea>
                <div style="display: flex; justify-content: flex-end; gap: 10px; margin-top: 15px;">
                    <button class="btn" id="btn-close-json-import">Cancel</button>
                    <button class="btn btn-primary" id="btn-apply-json-import">Import Widget</button>
                </div>
            </div>
        </div>
    `;

    const grid = document.getElementById('dashboard-grid');
    const selectProject = document.getElementById('select-project-dashboard');
    const selectDashboard = document.getElementById('select-dashboard');

    try {
        const saved = localStorage.getItem('fortenlog_current_widgets');
        if (saved) {
            widgets = JSON.parse(saved);
        }
    } catch (e) {
        console.error('Failed to load saved widgets from localStorage:', e);
    }

    const fetchProjects = async () => {
        try {
            const { data } = await api('/api/settings/projects');
            projectsList = data || [];
            selectProject.innerHTML = '<option value="">-- Select Project --</option>' +
                projectsList.map(p => `<option value="${p.id}">${p.name}</option>`).join('');
            
            selectProject.onchange = async () => {
                widgets = [];
                currentDashboardId = null;
                await loadDashboards();
                await renderAllWidgets();
            };

            if (projectsList.length > 0) {
                selectProject.value = projectsList[0].id;
                await loadDashboards();
                await renderAllWidgets();
            }
        } catch (e) {
            console.error('Failed to load projects', e);
        }
    };

    const loadDashboards = async () => {
        try {
            const projectId = selectProject.value || 'all';
            const { data: list } = await api(`/api/dashboards?project_id=${projectId}`);
            const safeList = list || [];
            selectDashboard.innerHTML = '<option value="">-- Load Dashboard --</option>' + 
                safeList.map(d => `<option value="${d.id}">${d.name}</option>`).join('');
            
            selectDashboard.onchange = async () => {
                const id = selectDashboard.value;
                if (!id) {
                    widgets = [];
                    currentDashboardId = null;
                    await renderAllWidgets();
                    return;
                }
                currentDashboardId = id;
                const dash = safeList.find(d => d.id === id);
                widgets = dash ? (dash.config || []) : [];
                await renderAllWidgets();
            };
        } catch (e) {
            console.error('Failed to load dashboards', e);
        }
    };

    const saveDashboard = async () => {
        const name = prompt('Dashboard Name:', 'My Analytics Dashboard');
        if (!name) return;
        
        try {
            await api('/api/dashboards', {
                method: 'POST',
                body: JSON.stringify({
                    id: currentDashboardId || undefined,
                    name,
                    project_id: selectProject.value || undefined,
                    config: widgets
                })
            });
            alert('Dashboard successfully saved!');
            await loadDashboards();
        } catch (e) {
            alert('Failed to save dashboard: ' + e.message);
        }
    };

    const saveState = () => {
        try {
            localStorage.setItem('fortenlog_current_widgets', JSON.stringify(widgets));
        } catch (e) {
            console.error('Failed to persist widgets to localStorage:', e);
        }
    };

    const renderAllWidgets = async () => {
        saveState();

        // Destroy all existing charts to avoid RAM leaks
        Object.keys(window.activeDashboardCharts).forEach(key => {
            if (window.activeDashboardCharts[key]) {
                window.activeDashboardCharts[key].destroy();
                delete window.activeDashboardCharts[key];
            }
        });

        grid.innerHTML = '';
        if (widgets.length === 0) {
            grid.innerHTML = `
                <div style="grid-column: span 4; text-align: center; padding: 60px; color: var(--text-secondary);" class="card">
                    <p style="font-size: 16px; margin-bottom: 12px;">No active widgets on this dashboard.</p>
                    <button class="btn btn-sm btn-primary" id="btn-create-first-widget">+ Create Your First Widget</button>
                </div>
            `;
            document.getElementById('btn-create-first-widget').onclick = () => addWidget();
            return;
        }

        for (let i = 0; i < widgets.length; i++) {
            await buildWidgetDOM({ w: widgets[i], idx: i, grid, callbacks: { editWidget, editJsonWidget, deleteWidget, swapWidgets, saveState, renderAllWidgets } });
        }
    };

    const swapWidgets = async (indexA, indexB) => {
        if (indexA < 0 || indexA >= widgets.length || indexB < 0 || indexB >= widgets.length) return;
        const temp = widgets[indexA];
        widgets[indexA] = widgets[indexB];
        widgets[indexB] = temp;
        await renderAllWidgets();
    };

    const deleteWidget = async (index) => {
        widgets.splice(index, 1);
        await renderAllWidgets();
    };

    const editWidget = async (index) => {
        await configureWidgetModal({ widgetData: widgets[index], editingIndex: index, projectsList, selectProject, widgets, renderAllWidgets });
    };

    const addWidget = async () => {
        await configureWidgetModal({ widgetData: null, editingIndex: null, projectsList, selectProject, widgets, renderAllWidgets });
    };

    let editingJsonIndex = null;
    const editJsonWidget = (index) => {
        editingJsonIndex = index;
        const w = widgets[index];
        document.getElementById('json-import-textarea').value = JSON.stringify(w, null, 2);
        document.getElementById('json-import-modal').style.display = 'flex';
    };

    selectProject.onchange = async () => {
        await renderAllWidgets();
    };

    document.getElementById('btn-add-widget').onclick = addWidget;
    document.getElementById('btn-save-dashboard').onclick = saveDashboard;

    // JSON Import Logic
    document.getElementById('btn-import-json').onclick = () => {
        editingJsonIndex = null;
        document.getElementById('json-import-textarea').value = '{\n  "title": "New JSON Widget",\n  "table": "events",\n  "metric": "count",\n  "dimension": "os",\n  "chartType": "bar"\n}';
        document.getElementById('json-import-modal').style.display = 'flex';
    };
    document.getElementById('btn-close-json-import').onclick = () => {
        document.getElementById('json-import-modal').style.display = 'none';
    };
    document.getElementById('btn-apply-json-import').onclick = async () => {
        try {
            const val = document.getElementById('json-import-textarea').value;
            const parsed = JSON.parse(val);
            if (!parsed.projectId) {
                parsed.projectId = selectProject.value || (projectsList[0] ? projectsList[0].id : '');
            }
            if (!parsed.filters) parsed.filters = [];
            
            if (editingJsonIndex !== null) {
                widgets[editingJsonIndex] = parsed;
            } else {
                widgets.push(parsed);
            }
            
            document.getElementById('json-import-modal').style.display = 'none';
            await renderAllWidgets();
        } catch (e) {
            alert('Invalid JSON format: ' + e.message);
        }
    };

    await fetchProjects();
    
    if (widgets.length === 0 && projectsList.length > 0) {
        widgets = [
            {
                title: 'Operating System Share',
                projectId: projectsList[0].id,
                table: 'events',
                metric: 'count',
                dimension: 'os',
                formula: '',
                filters: [],
                chartType: 'doughnut',
                widthSpan: '2',
                heightSpan: 'medium',
                colorPalette: 'toxic_mint',
                showLegend: true,
                showGridlines: false
            },
            {
                title: 'Production Event Types',
                projectId: projectsList[0].id,
                table: 'events',
                metric: 'count',
                dimension: 'event_type',
                formula: '',
                filters: [{ column: 'environment', op: 'eq', value: 'production' }],
                chartType: 'bar',
                widthSpan: '2',
                heightSpan: 'medium',
                colorPalette: 'cyberpunk',
                showLegend: false,
                showGridlines: true,
                xAxisLabel: 'Type',
                yAxisLabel: 'Events'
            }
        ];
        await renderAllWidgets();
    }
}
