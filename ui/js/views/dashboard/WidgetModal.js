export async function configureWidgetModal({ widgetData, editingIndex, projectsList, selectProject, widgets, renderAllWidgets }) {
    const isEditing = widgetData !== null;
    const defaultWidget = {
        title: 'Custom Telemetry Report',
        projectId: selectProject.value || (projectsList[0] ? projectsList[0].id : ''),
        table: 'events',
        metric: 'count',
        dimension: 'os',
        formula: '', // New field for Math Formula
        filters: [],
        chartType: 'bar',
        widthSpan: '2',
        heightSpan: 'medium',
        colorPalette: 'neon_grape',
        showLegend: true,
        showGridlines: true,
        xAxisLabel: '',
        yAxisLabel: ''
    };

    const w = isEditing ? { ...defaultWidget, ...widgetData } : defaultWidget;

    const modalContent = document.getElementById('modal-content');
    modalContent.classList.add('wide');
    modalContent.innerHTML = `
        <div class="modal-header" style="padding: 20px 24px; border-bottom: 1px solid var(--border); display: flex; justify-content: space-between; align-items: center; background: var(--bg-sub);">
            <h3 style="margin: 0; font-size: 16px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.5px;">
                ${isEditing ? 'Edit Widget Configuration' : 'Create Custom Analytical Widget'}
            </h3>
            <button class="btn btn-sm" id="btn-close-widget-modal-x" style="border: none; background: transparent; font-size: 20px; color: var(--text-secondary); cursor: pointer;">&times;</button>
        </div>
        <div class="modal-body" style="padding: 24px;">
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 24px; max-height: 52vh; overflow-y: auto; padding-right: 8px;">
                
                <div style="display: flex; flex-direction: column; gap: 15px;">
                    <h3>1. Query & Data Mapping</h3>
                    <div>
                        <label class="input-label">WIDGET TITLE</label>
                        <input type="text" id="m-title" class="search-input" value="${w.title}" style="width: 100%;">
                    </div>
                    <div>
                        <label class="input-label">PROJECT TARGET</label>
                        <select id="m-project" class="search-input" style="width: 100%;">
                            ${projectsList.map(p => `<option value="${p.id}" ${p.id === w.projectId ? 'selected' : ''}>${p.name}</option>`).join('')}
                        </select>
                    </div>
                    <div>
                        <label class="input-label">DATABASE TABLE SOURCE</label>
                        <select id="m-table" class="search-input" style="width: 100%;">
                            <option value="events" ${w.table === 'events' ? 'selected' : ''}>Events Table (All Telemetry Logs)</option>
                            <option value="sessions" ${w.table === 'sessions' ? 'selected' : ''}>Sessions Table (App Heartbeats & Uptime)</option>
                        </select>
                    </div>
                    <div>
                        <label class="input-label">AGGREGATION METRIC</label>
                        <select id="m-metric" class="search-input" style="width: 100%;">
                            <option value="count" ${w.metric === 'count' ? 'selected' : ''}>Total Event Count (COUNT)</option>
                            <option value="unique_users" ${w.metric === 'unique_users' ? 'selected' : ''}>Unique Users Affected (COUNT DISTINCT HWID)</option>
                            <option value="errors" ${w.metric === 'errors' ? 'selected' : ''}>Total Failures / Crashes</option>
                        </select>
                    </div>
                    <div>
                        <label class="input-label">FORMULA (OPTIONAL, 'A' or 'x' represents count)</label>
                        <input type="text" id="m-formula" class="search-input" value="${w.formula || ''}" placeholder="e.g. A * 5" style="width: 100%;">
                    </div>
                    <div>
                        <label class="input-label">GROUP BY DIMENSION</label>
                        <select id="m-dimension" class="search-input" style="width: 100%;">
                            <option value="os" ${w.dimension === 'os' ? 'selected' : ''}>Operating System (os)</option>
                            <option value="browser" ${w.dimension === 'browser' ? 'selected' : ''}>Browser / Client Engine (browser)</option>
                            <option value="region" ${w.dimension === 'region' ? 'selected' : ''}>Geographical Region (region)</option>
                            <option value="release_version" ${w.dimension === 'release_version' ? 'selected' : ''}>Release Version (release_version)</option>
                            <option value="environment" ${w.dimension === 'environment' ? 'selected' : ''}>Environment Scope (environment)</option>
                            <option value="event_type" ${w.dimension === 'event_type' ? 'selected' : ''}>Telemetry Event Type (event_type)</option>
                            <option value="title" ${w.dimension === 'title' ? 'selected' : ''}>Issue / Failure Title (title)</option>
                            <option value="custom" ${w.dimension.startsWith('custom:') ? 'selected' : ''}>Custom Payload Property...</option>
                        </select>
                    </div>
                    <div id="m-custom-dimension-container" style="display: ${w.dimension.startsWith('custom:') ? 'block' : 'none'}; margin-top: 12px;">
                        <label class="input-label">CUSTOM PROPERTY KEY</label>
                        <input type="text" id="m-custom-dimension" class="search-input" value="${w.dimension.startsWith('custom:') ? w.dimension.substring(7) : ''}" placeholder="e.g. selected_server_name" style="width: 100%;">
                    </div>
                </div>

                <div style="display: flex; flex-direction: column; gap: 15px;">
                    <h3>2. Styling & Visualization</h3>
                    <div>
                        <label class="input-label">CHART DISPLAY TYPE</label>
                        <select id="m-chart-type" class="search-input" style="width: 100%;">
                            <option value="bar" ${w.chartType === 'bar' ? 'selected' : ''}>Bar Chart</option>
                            <option value="line" ${w.chartType === 'line' ? 'selected' : ''}>Line Chart</option>
                            <option value="pie" ${w.chartType === 'pie' ? 'selected' : ''}>Pie Chart</option>
                            <option value="doughnut" ${w.chartType === 'doughnut' ? 'selected' : ''}>Doughnut Chart</option>
                            <option value="polarArea" ${w.chartType === 'polarArea' ? 'selected' : ''}>Polar Area Chart</option>
                            <option value="radar" ${w.chartType === 'radar' ? 'selected' : ''}>Radar Graph</option>
                            <option value="kpi" ${w.chartType === 'kpi' ? 'selected' : ''}>Premium KPI Counter (Big Number)</option>
                        </select>
                    </div>
                    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px;">
                        <div>
                            <label class="input-label">GRID WIDTH SPAN</label>
                            <select id="m-width" class="search-input" style="width: 100%;">
                                <option value="1" ${w.widthSpan === '1' ? 'selected' : ''}>25% Width</option>
                                <option value="2" ${w.widthSpan === '2' ? 'selected' : ''}>50% Width</option>
                                <option value="3" ${w.widthSpan === '3' ? 'selected' : ''}>75% Width</option>
                                <option value="4" ${w.widthSpan === '4' ? 'selected' : ''}>100% Width</option>
                            </select>
                        </div>
                        <div>
                            <label class="input-label">GRID HEIGHT SPAN</label>
                            <select id="m-height" class="search-input" style="width: 100%;">
                                <option value="small" ${w.heightSpan === 'small' ? 'selected' : ''}>Small (240px)</option>
                                <option value="medium" ${w.heightSpan === 'medium' ? 'selected' : ''}>Medium (360px)</option>
                                <option value="large" ${w.heightSpan === 'large' ? 'selected' : ''}>Large (480px)</option>
                            </select>
                        </div>
                    </div>
                    <div>
                        <label class="input-label">COLOR PALETTE PRESET</label>
                        <select id="m-palette" class="search-input" style="width: 100%;">
                            <option value="neon_grape" ${w.colorPalette === 'neon_grape' ? 'selected' : ''}>Retro Neon Grape (Purple/Violet)</option>
                            <option value="cyberpunk" ${w.colorPalette === 'cyberpunk' ? 'selected' : ''}>Cyberpunk High Contrast (Pink/Aqua/Yellow)</option>
                            <option value="toxic_mint" ${w.colorPalette === 'toxic_mint' ? 'selected' : ''}>Toxic Emerald Mint (Teal/Green)</option>
                            <option value="ocean_breeze" ${w.colorPalette === 'ocean_breeze' ? 'selected' : ''}>Ocean Breeze Premium (Blues/Corals)</option>
                        </select>
                    </div>
                    <div style="display: flex; gap: 20px;">
                        <label style="display: flex; align-items: center; gap: 8px; cursor: pointer; color: var(--text);">
                            <input type="checkbox" id="m-legend" ${w.showLegend ? 'checked' : ''}> Show Legend
                        </label>
                        <label style="display: flex; align-items: center; gap: 8px; cursor: pointer; color: var(--text);">
                            <input type="checkbox" id="m-grid" ${w.showGridlines ? 'checked' : ''}> Show Gridlines
                        </label>
                    </div>
                    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px;">
                        <div>
                            <label class="input-label">X-AXIS LABEL (OPTIONAL)</label>
                            <input type="text" id="m-xlabel" class="search-input" value="${w.xAxisLabel || ''}" placeholder="e.g. Platform" style="width: 100%;">
                        </div>
                        <div>
                            <label class="input-label">Y-AXIS LABEL (OPTIONAL)</label>
                            <input type="text" id="m-ylabel" class="search-input" value="${w.yAxisLabel || ''}" placeholder="e.g. Hits" style="width: 100%;">
                        </div>
                    </div>
                </div>

                <div style="grid-column: span 2; border-top: 1px solid var(--border); padding-top: 15px;">
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px;">
                        <h3>3. Dynamic Filters (Whitelisted)</h3>
                        <button class="btn btn-sm" id="btn-add-filter" type="button">+ Add Filter</button>
                    </div>
                    <div id="filter-list" style="display: flex; flex-direction: column; gap: 10px;">
                        <!-- Filters inserted here -->
                    </div>
                </div>

            </div>
            
            <div style="display: flex; justify-content: flex-end; gap: 12px; margin-top: 20px; padding-top: 15px; border-top: 1px solid var(--border);">
                <button class="btn" id="btn-cancel-widget-modal">Cancel</button>
                <button class="btn btn-primary" id="btn-save-widget-config" style="padding: 0 24px; height: 38px;">
                    ${isEditing ? 'Update Widget' : 'Generate Widget'}
                </button>
            </div>
        </div>
    `;

    const filterContainer = document.getElementById('filter-list');
    
    const renderFilters = () => {
        filterContainer.innerHTML = '';
        w.filters.forEach((f, idx) => {
            const isCustom = f.column.startsWith('custom:');
            const customKey = isCustom ? f.column.substring(7) : '';
            const row = document.createElement('div');
            row.style.display = 'flex';
            row.style.gap = '12px';
            row.style.alignItems = 'center';
            row.innerHTML = `
                <div style="flex: 1; display: flex; flex-direction: column; gap: 4px;">
                    <select class="search-input filter-col" style="width: 100%;">
                        <option value="title" ${f.column === 'title' ? 'selected' : ''}>Event Title / Name (title)</option>
                        <option value="environment" ${f.column === 'environment' ? 'selected' : ''}>Environment (environment)</option>
                        <option value="os" ${f.column === 'os' ? 'selected' : ''}>OS (os)</option>
                        <option value="browser" ${f.column === 'browser' ? 'selected' : ''}>Browser (browser)</option>
                        <option value="region" ${f.column === 'region' ? 'selected' : ''}>Region (region)</option>
                        <option value="release_version" ${f.column === 'release_version' ? 'selected' : ''}>Release Version (release_version)</option>
                        <option value="event_type" ${f.column === 'event_type' ? 'selected' : ''}>Event Type (event_type)</option>
                        <option value="hwid" ${f.column === 'hwid' ? 'selected' : ''}>Hardware ID / User (hwid)</option>
                        <option value="is_error" ${f.column === 'is_error' ? 'selected' : ''}>Is Error (is_error)</option>
                        <option value="custom" ${isCustom ? 'selected' : ''}>Custom Payload Property...</option>
                    </select>
                    <input type="text" class="search-input filter-custom-key" placeholder="custom_property_name" value="${customKey}" style="display: ${isCustom ? 'block' : 'none'}; width: 100%; margin-top: 4px; height: 30px; font-size: 11px;">
                </div>
                <select class="search-input filter-op" style="width: 100px;">
                    <option value="eq" ${f.op === 'eq' ? 'selected' : ''}>Equals (=)</option>
                    <option value="neq" ${f.op === 'neq' ? 'selected' : ''}>Not Equals (!=)</option>
                </select>
                <input type="text" class="search-input filter-val" style="flex: 1;" value="${f.value}" placeholder="Value">
                <button class="btn btn-sm btn-danger remove-flt" type="button">Remove</button>
            `;
            filterContainer.appendChild(row);

            const selectCol = row.querySelector('.filter-col');
            const customKeyInput = row.querySelector('.filter-custom-key');
            selectCol.onchange = () => {
                if (selectCol.value === 'custom') {
                    customKeyInput.style.display = 'block';
                } else {
                    customKeyInput.style.display = 'none';
                    customKeyInput.value = '';
                }
            };

            row.querySelector('.remove-flt').onclick = () => {
                w.filters.splice(idx, 1);
                renderFilters();
            };
        });
    };

    const closeWidgetModal = () => {
        document.getElementById('modal-overlay').style.display = 'none';
        document.getElementById('modal-content').classList.remove('wide');
    };

    document.getElementById('btn-close-widget-modal-x').onclick = closeWidgetModal;
    document.getElementById('btn-cancel-widget-modal').onclick = closeWidgetModal;

    document.getElementById('btn-add-filter').onclick = () => {
        w.filters.push({ column: 'environment', op: 'eq', value: '' });
        renderFilters();
    };

    renderFilters();

    const dimSelect = document.getElementById('m-dimension');
    const customDimContainer = document.getElementById('m-custom-dimension-container');
    dimSelect.onchange = () => {
        if (dimSelect.value === 'custom') {
            customDimContainer.style.display = 'block';
        } else {
            customDimContainer.style.display = 'none';
        }
    };

    document.getElementById('modal-overlay').style.display = 'flex';

    document.getElementById('btn-save-widget-config').onclick = async () => {
        // Collect filters
        const filterRows = Array.from(filterContainer.children);
        const collectedFilters = [];
        filterRows.forEach(row => {
            const selectCol = row.querySelector('.filter-col');
            if (!selectCol) return;
            let column = selectCol.value;
            if (column === 'custom') {
                const customKeyInput = row.querySelector('.filter-custom-key');
                const key = customKeyInput ? customKeyInput.value.trim() : '';
                if (key) {
                    column = `custom:${key}`;
                } else {
                    return; // skip empty custom filter key
                }
            }
            const op = row.querySelector('.filter-op').value;
            const value = row.querySelector('.filter-val').value;
            if (value.trim() !== '') {
                collectedFilters.push({ column, op, value: value.trim() });
            }
        });

        let dimension = document.getElementById('m-dimension').value;
        if (dimension === 'custom') {
            const customKey = document.getElementById('m-custom-dimension').value.trim();
            if (customKey) {
                dimension = `custom:${customKey}`;
            } else {
                alert('Please enter a custom dimension key.');
                return;
            }
        }

        const newConfig = {
            title: document.getElementById('m-title').value || 'Untitled Widget',
            projectId: document.getElementById('m-project').value,
            table: document.getElementById('m-table').value,
            metric: document.getElementById('m-metric').value,
            dimension: dimension,
            formula: document.getElementById('m-formula').value.trim(),
            filters: collectedFilters,
            chartType: document.getElementById('m-chart-type').value,
            widthSpan: document.getElementById('m-width').value,
            heightSpan: document.getElementById('m-height').value,
            colorPalette: document.getElementById('m-palette').value,
            showLegend: document.getElementById('m-legend').checked,
            showGridlines: document.getElementById('m-grid').checked,
            xAxisLabel: document.getElementById('m-xlabel').value,
            yAxisLabel: document.getElementById('m-ylabel').value
        };

        if (isEditing) {
            widgets[editingIndex] = newConfig;
        } else {
            widgets.push(newConfig);
        }

        closeWidgetModal();
        await renderAllWidgets();
    };
}
