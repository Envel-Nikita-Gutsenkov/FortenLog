import { store } from '../store.js';
import { DonutChart, BarChart, WorldMap } from '../components.js';

export function renderAnalytics(container) {
    const stats = store.stats || {};
    
    container.innerHTML = `
        <div>
            <div style="display: flex; justify-content: space-between; align-items: flex-end; margin-bottom: 40px; border-bottom: 1px solid var(--border); padding-bottom: 20px;">
                <div>
                    <h1 style="font-size: 32px; font-weight: 800; letter-spacing: -1px; margin-bottom: 8px;">Analytics & Insights</h1>
                    <p style="color: var(--text-secondary); font-size: 14px;">Real-time telemetry for <b style="color: var(--accent); font-weight: 800;">${store.projects.find(p => p.id === store.currentProjectId)?.name || 'All Projects'}</b></p>
                </div>
                <div style="display: flex; gap: 12px; margin-bottom: 5px;">
                    <span class="tag-badge" style="padding: 6px 14px; background: rgba(0, 184, 148, 0.1); color: #00b894;">● SYSTEM_ONLINE</span>
                    <span class="tag-badge" style="padding: 6px 14px;">V2.4.0_CORE</span>
                </div>
            </div>
            
            <div class="dashboard-grid">
                <div class="card" style="grid-column: span 6;">
                    <div class="card-header">OS Distribution (Events)</div>
                    ${BarChart(stats.os_distribution, { height: 200 })}
                </div>

                <div class="card" style="grid-column: span 6;">
                    <div class="card-header">Browser Distribution</div>
                    <div style="display: flex; flex-direction: column; gap: 16px; margin-top: 10px; padding: 20px;">
                        ${renderProgressBars(stats.browser_distribution)}
                    </div>
                </div>

                <div class="card" style="grid-column: span 8;">
                    <div class="card-header">Regional Market (By IP)</div>
                    <div style="padding: 20px; height: 480px; width: 100%;">
                        ${WorldMap(stats.region_distribution || [])}
                    </div>
                </div>

                <div class="card" style="grid-column: span 4;">
                    <div class="card-header">Version Health & Releases</div>
                    <div style="overflow-x: auto; padding-bottom: 8px; margin: 0 -16px; padding-left: 16px; padding-right: 16px;">
                        ${(() => {
                            const showProject = store.currentProjectId === 'all';
                            return `
                            <table class="issue-table compact-table" style="width: 100%; min-width: ${showProject ? '620px' : '520px'}; table-layout: fixed;">
                                <thead>
                                    <tr>
                                        <th style="width: ${showProject ? '18%' : '25%'};">Version</th>
                                        ${showProject ? '<th style="width: 22%;">Project</th>' : ''}
                                        <th style="width: 13%;">Users</th>
                                        <th style="width: 17%;">Stability</th>
                                        <th style="width: ${showProject ? '18%' : '27%'};">Adoption</th>
                                        <th style="width: 12%;">Status</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    ${(() => {
                                        const releases = stats.releases || [];
                                        const totalSessions = releases.reduce((a, b) => a + (b.total_sessions || 0), 0) || 1;
                                        const stabilityTarget = parseFloat(localStorage.getItem('fortenlog_stability_target')) || 98.0;

                                        return releases.map(r => {
                                            const adoption = Math.round(((r.total_sessions || 0) / totalSessions) * 100);
                                            const stability = r.stability || 100;
                                            const isHealthy = stability >= stabilityTarget;
                                            
                                            return `
                                                <tr>
                                                    <td style="white-space: nowrap; text-overflow: ellipsis; overflow: hidden;"><code style="font-size: 11px; background: var(--bg-sub); padding: 4px 8px; border-radius: 4px; border: 1px solid var(--border); color: var(--accent); font-weight: 800;" title="${r.version}">${r.version}</code></td>
                                                    ${showProject ? `<td style="white-space: nowrap; text-overflow: ellipsis; overflow: hidden; font-size: 11.5px; font-weight: 700; color: var(--text-secondary);" title="${r.project_name}">${r.project_name}</td>` : ''}
                                                    <td style="font-weight: 800; color: var(--text-primary); white-space: nowrap;">${r.unique_users || 0}</td>
                                                    <td style="font-weight: 800; color: ${isHealthy ? '#00b894' : '#d63031'}; white-space: nowrap;">${stability.toFixed(2)}%</td>
                                                    <td style="white-space: nowrap;">
                                                        <div style="display: flex; align-items: center; gap: 8px;">
                                                            <div style="flex: 1; min-width: 35px; height: 6px; background: var(--bg-sub); border-radius: 3px; overflow: hidden;">
                                                                <div style="width: ${adoption}%; height: 100%; background: var(--accent);"></div>
                                                            </div>
                                                            <span style="font-size: 11px; font-weight: 800; width: 30px;">${adoption}%</span>
                                                        </div>
                                                    </td>
                                                    <td style="white-space: nowrap;">
                                                        <span class="tag-badge" style="color: ${isHealthy ? '#00b894' : '#d63031'}; background: ${isHealthy ? 'rgba(0, 184, 148, 0.1)' : 'rgba(214, 48, 49, 0.1)'}; padding: 3px 8px;">
                                                            ${isHealthy ? 'HEALTHY' : 'CRITICAL'}
                                                        </span>
                                                    </td>
                                                </tr>
                                            `;
                                        }).join('');
                                    })()}
                                    ${(!stats.releases || stats.releases.length === 0) ? `<tr><td colspan="${showProject ? '6' : '5'}" style="text-align:center; padding: 40px; color: var(--text-secondary);">No release telemetry found. Ensure your SDK sends release information.</td></tr>` : ''}
                                </tbody>
                            </table>
                            `;
                        })()}
                    </div>
                </div>

                <div class="card" style="grid-column: span 12;">
                    <div class="card-header">
                        <span>Project Telemetry Metrics</span>
                    </div>
                    <div style="display: grid; grid-template-columns: repeat(4, 1fr); gap: 24px; margin-top: 10px;">
                        ${(stats.custom_events || []).map(e => `
                            <div class="stat-card" style="padding: 24px; background: var(--bg-sub);">
                                <div class="label">${e.name}</div>
                                <div class="value">${e.count.toLocaleString()}</div>
                                <div style="font-size: 11px; color: var(--success); font-weight: 700; margin-top: 4px;">ACTIVE</div>
                            </div>
                        `).join('')}
                        ${(!stats.custom_events || stats.custom_events.length === 0) ? `
                            <div style="grid-column: span 4; padding: 60px; text-align: center; background: var(--bg-sub); border-radius: 16px; border: 2px dashed var(--border);">
                                <div class="text-secondary" style="font-weight: 700;">No custom telemetry events recorded for this project yet.</div>
                            </div>
                        ` : ''}
                    </div>
                </div>
            </div>
            <div style="height: 100px;"></div> <!-- Spacer for scrolling -->
        </div>
    `;
}


function renderBars(data) {
    if (!data || data.length === 0) return '<div style="flex:1; text-align:center; color:var(--text-secondary);">No data</div>';
    const max = Math.max(...data.map(x => x.count)) || 1;
    return data.map(d => {
        const h = (d.count / max) * 180;
        return `
            <div style="flex: 1; display: flex; flex-direction: column; align-items: center; gap: 10px;">
                <div style="font-size: 11px; font-weight: 800;">${d.count}</div>
                <div style="width: 100%; height: ${h}px; background: linear-gradient(0deg, var(--accent), #a29bfe); border-radius: 4px 4px 0 0; transition: height 0.5s ease; box-shadow: 0 4px 12px rgba(108, 92, 231, 0.2);"></div>
                <div style="font-size: 10px; color: var(--text-secondary); text-align: center; font-weight: 700; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; width: 100%;" title="${d.name}">${d.name}</div>
            </div>
        `;
    }).join('');
}

function renderProgressBars(data) {
    if (!data || data.length === 0) return '<div style="color:var(--text-secondary);">No data</div>';
    const total = data.reduce((a, b) => a + b.count, 0) || 1;
    return data.map(d => {
        const p = Math.round((d.count / total) * 100);
        return `
            <div>
                <div style="display: flex; justify-content: space-between; font-size: 12px; margin-bottom: 6px; font-weight: 600;">
                    <span>${d.name}</span>
                    <span>${p}%</span>
                </div>
                <div style="width: 100%; height: 8px; background: var(--bg-sub); border-radius: 4px; overflow: hidden; border: 1px solid var(--border);">
                    <div style="width: ${p}%; height: 100%; background: var(--accent); transition: width 0.5s ease;"></div>
                </div>
            </div>
        `;
    }).join('');
}
