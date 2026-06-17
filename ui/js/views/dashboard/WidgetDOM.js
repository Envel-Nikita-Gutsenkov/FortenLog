import { api } from '../../api.js';

export async function buildWidgetDOM({ w, idx, grid, callbacks }) {
    const { editWidget, editJsonWidget, deleteWidget, swapWidgets, saveState, renderAllWidgets } = callbacks;
    const widgetId = 'widget-' + Math.random().toString(36).substr(2, 9);
    const card = document.createElement('div');
    card.className = 'card widget-card';
    card.draggable = true;
    card.dataset.index = idx;
    
    // CSS Grid dynamic columns & dynamic height configuration
    card.style.gridColumn = `span ${w.widthSpan || 2}`;
    const cardHeight = w.heightSpan === 'small' ? '280px' : w.heightSpan === 'large' ? '500px' : '390px';
    card.style.height = cardHeight;
    card.style.display = 'flex';
    card.style.flexDirection = 'column';
    card.style.overflow = 'hidden';
    card.style.position = 'relative';

    const formulaTooltip = w.formula ? `Formula: ${w.formula}` : 'No custom formula';

    card.innerHTML = `
        <div class="card-header widget-header" style="cursor: grab; display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid var(--border); padding: 10px 16px;">
            <div style="display: flex; align-items: center; gap: 8px;">
                <span style="font-weight: bold; font-size: 14px; text-transform: uppercase; letter-spacing: 0.5px;">${w.title}</span>
                <div class="info-tooltip" title="${formulaTooltip} | Metric: ${w.metric}" style="cursor: help; color: var(--accent); font-size: 12px; border: 1px solid var(--accent); border-radius: 50%; width: 18px; height: 18px; display: flex; align-items: center; justify-content: center; font-weight: bold;">?</div>
            </div>
            <div style="display: flex; gap: 6px; align-items: center;">
                <button class="btn btn-sm" style="padding: 2px 8px; font-size: 11px;" id="${widgetId}-json">{ } JSON</button>
                <button class="btn btn-sm" style="padding: 2px 8px; font-size: 11px;" id="${widgetId}-edit">⚙ Edit</button>
                <button class="btn btn-sm btn-danger" style="padding: 2px 8px; font-size: 11px;" id="${widgetId}-del">❌</button>
            </div>
        </div>
        <div style="flex: 1; padding: 15px; position: relative; display: flex; align-items: center; justify-content: center; min-height: 0;">
            ${w.chartType === 'kpi' 
                ? `<div id="${widgetId}-kpi-container" style="text-align: center;">
                     <span style="font-size: 56px; font-weight: 900; line-height: 1; font-family: monospace; letter-spacing: -2px; color: var(--primary);" id="${widgetId}-kpi-value">...</span>
                     <p style="margin-top: 10px; font-size: 12px; color: var(--text-secondary); text-transform: uppercase;">Total Aggregated</p>
                   </div>`
                : `<canvas id="${widgetId}"></canvas>`
            }
        </div>
        <div class="resize-handle" id="${widgetId}-resize" style="position: absolute; bottom: 0; right: 0; width: 16px; height: 16px; cursor: nwse-resize; background: linear-gradient(135deg, transparent 50%, var(--text-secondary) 50%); border-bottom-right-radius: 12px; opacity: 0.5;"></div>
    `;

    grid.appendChild(card);

    // Drag and drop events
    card.ondragstart = (e) => {
        e.dataTransfer.setData('text/plain', idx);
        card.style.opacity = '0.5';
    };
    card.ondragend = () => {
        card.style.opacity = '1';
    };
    card.ondragover = (e) => {
        e.preventDefault();
        card.style.border = '2px dashed var(--accent)';
    };
    card.ondragleave = () => {
        card.style.border = '1px solid var(--border)';
    };
    card.ondrop = async (e) => {
        e.preventDefault();
        card.style.border = '1px solid var(--border)';
        const fromIdx = parseInt(e.dataTransfer.getData('text/plain'));
        if (!isNaN(fromIdx) && fromIdx !== idx) {
            await swapWidgets(fromIdx, idx);
        }
    };

    // Resizing logic
    const resizer = document.getElementById(`${widgetId}-resize`);
    resizer.onmousedown = (e) => {
        e.preventDefault();
        e.stopPropagation();
        const startX = e.clientX;
        const startY = e.clientY;
        const startWidthSpan = parseInt(w.widthSpan || 2);
        const startHeight = card.offsetHeight;
        
        const onMouseMove = (moveEvent) => {
            const dx = moveEvent.clientX - startX;
            const dy = moveEvent.clientY - startY;
            
            let newSpan = startWidthSpan + Math.round(dx / 200);
            newSpan = Math.max(1, Math.min(4, newSpan));
            card.style.gridColumn = `span ${newSpan}`;
            
            let newHeightSpan = w.heightSpan;
            if (startHeight + dy < 320) newHeightSpan = 'small';
            else if (startHeight + dy > 450) newHeightSpan = 'large';
            else newHeightSpan = 'medium';
            
            card.style.height = newHeightSpan === 'small' ? '280px' : newHeightSpan === 'large' ? '500px' : '390px';
            
            w.widthSpan = newSpan.toString();
            w.heightSpan = newHeightSpan;
        };
        
        const onMouseUp = async () => {
            document.removeEventListener('mousemove', onMouseMove);
            document.removeEventListener('mouseup', onMouseUp);
            saveState();
            await renderAllWidgets(); 
        };
        
        document.addEventListener('mousemove', onMouseMove);
        document.addEventListener('mouseup', onMouseUp);
    };

    document.getElementById(`${widgetId}-json`).onclick = () => editJsonWidget(idx);
    document.getElementById(`${widgetId}-edit`).onclick = () => editWidget(idx);
    document.getElementById(`${widgetId}-del`).onclick = () => deleteWidget(idx);

    try {
        const { data: queryResponse } = await api('/api/dashboard/query', {
            method: 'POST',
            body: JSON.stringify({
                project_id: w.projectId,
                table: w.table,
                metric: w.metric,
                dimension: w.dimension,
                filters: w.filters
            })
        });

        let rawData = queryResponse || [];
        
        // Custom Formula Engine (User requested Formula: A*5 feature)
        if (w.formula && w.formula.trim() !== '') {
            try {
                let formulaStr = w.formula.replace(/A/g, 'x');
                const compute = new Function('x', `return ${formulaStr};`);
                rawData = rawData.map(item => ({
                    ...item,
                    count: compute(item.count)
                }));
            } catch(e) {
                console.error("Formula error", e);
            }
        }
        
        if (w.chartType === 'kpi') {
            const total = rawData.reduce((acc, curr) => acc + curr.count, 0);
            const kpiVal = document.getElementById(`${widgetId}-kpi-value`);
            if (kpiVal) {
                kpiVal.innerText = Number(total).toLocaleString();
            }
            return;
        }

        const labels = rawData.map(item => item.name);
        const dataCounts = rawData.map(item => item.count);

        let paletteBgs = [];
        let paletteBorders = [];

        if (w.colorPalette === 'cyberpunk') {
            paletteBgs = ['rgba(255, 234, 167, 0.85)', 'rgba(253, 121, 168, 0.85)', 'rgba(0, 206, 201, 0.85)', 'rgba(225, 112, 85, 0.85)', 'rgba(116, 185, 255, 0.85)'];
            paletteBorders = ['#ffeaa7', '#fd79a8', '#00cec9', '#e17055', '#74b9ff'];
        } else if (w.colorPalette === 'toxic_mint') {
            paletteBgs = ['rgba(0, 184, 148, 0.85)', 'rgba(85, 239, 196, 0.85)', 'rgba(0, 206, 201, 0.85)', 'rgba(129, 236, 236, 0.85)', 'rgba(250, 177, 160, 0.85)'];
            paletteBorders = ['#00b894', '#55efc4', '#00cec9', '#81ecec', '#fab1a0'];
        } else if (w.colorPalette === 'ocean_breeze') {
            paletteBgs = ['rgba(9, 132, 227, 0.85)', 'rgba(116, 185, 255, 0.85)', 'rgba(0, 184, 148, 0.85)', 'rgba(162, 155, 254, 0.85)', 'rgba(253, 121, 168, 0.85)'];
            paletteBorders = ['#0984e3', '#74b9ff', '#00b894', '#a29bfe', '#fd79a8'];
        } else {
            paletteBgs = ['rgba(108, 92, 231, 0.85)', 'rgba(162, 155, 254, 0.85)', 'rgba(253, 121, 168, 0.85)', 'rgba(253, 203, 110, 0.85)', 'rgba(9, 132, 227, 0.85)'];
            paletteBorders = ['#6c5ce7', '#a29bfe', '#fd79a8', '#fdcb6e', '#0984e3'];
        }

        const backgroundColors = dataCounts.map((_, i) => paletteBgs[i % paletteBgs.length]);
        const borderColors = dataCounts.map((_, i) => paletteBorders[i % paletteBorders.length]);

        const canvas = document.getElementById(widgetId);
        if (!canvas) return;

        const chartConfig = {
            type: w.chartType,
            data: {
                labels: labels.length > 0 ? labels : ['No Data'],
                datasets: [{
                    label: w.title,
                    data: dataCounts.length > 0 ? dataCounts : [0],
                    backgroundColor: w.chartType === 'line' ? backgroundColors[0] : backgroundColors,
                    borderColor: w.chartType === 'line' ? borderColors[0] : borderColors,
                    borderWidth: 2,
                    tension: w.chartType === 'line' ? 0.35 : 0,
                    fill: w.chartType === 'line'
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: {
                        display: w.showLegend,
                        position: 'bottom',
                        labels: { color: '#b2bec3', font: { size: 10, family: 'monospace' } }
                    }
                },
                scales: w.chartType === 'line' || w.chartType === 'bar' ? {
                    y: {
                        grid: { color: w.showGridlines ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0)' },
                        ticks: { color: '#636e72', font: { family: 'monospace', size: 9 } },
                        title: { display: !!w.yAxisLabel, text: w.yAxisLabel || '', color: '#b2bec3', font: { size: 10 } }
                    },
                    x: {
                        grid: { display: false },
                        ticks: { color: '#636e72', font: { family: 'monospace', size: 9 } },
                        title: { display: !!w.xAxisLabel, text: w.xAxisLabel || '', color: '#b2bec3', font: { size: 10 } }
                    }
                } : {}
            }
        };

        window.activeDashboardCharts[widgetId] = new Chart(canvas, chartConfig);

    } catch (err) {
        console.error('Failed to render dynamic widget data', err);
        const ctx = document.getElementById(widgetId);
        if (ctx) {
            const parent = ctx.parentElement;
            parent.innerHTML = `
                <div style="text-align: center; color: var(--error); padding: 20px;">
                    <p style="font-weight: bold; margin-bottom: 6px;">Data Ingestion Error</p>
                    <p style="font-size: 11px; opacity: 0.85;">${err.message || 'Unable to connect to dynamic compiler'}</p>
                </div>
            `;
        }
    }
}
