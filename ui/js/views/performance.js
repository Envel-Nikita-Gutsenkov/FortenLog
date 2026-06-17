import { api } from '../api.js';

let updateInterval = null;

export async function renderPerformance(container) {
    if (!container) return;

    // Clean up any old intervals
    if (updateInterval) {
        clearInterval(updateInterval);
        updateInterval = null;
    }

    container.innerHTML = `
        <div class="perf-view-wrapper" style="padding: 32px; display: flex; flex-direction: column; gap: 32px; max-width: 1400px; margin: 0 auto;">
            <!-- Header section -->
            <div style="display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 1px solid var(--border); padding-bottom: 24px;">
                <div>
                    <h1 style="margin: 0; font-size: 26px; font-weight: 800; tracking: -0.5px;">System Diagnostics & Metrics</h1>
                    <p style="color: var(--text-secondary); margin: 6px 0 0 0; font-size: 13px;">Real-time infrastructure health, memory profiles, processing latency, queue capacity, and system exception telemetry.</p>
                </div>
                <div style="display: flex; align-items: center; gap: 16px;">
                    <div style="display: flex; align-items: center; gap: 8px; background: var(--bg-sub); border: 1px solid var(--border); padding: 8px 16px; border-radius: 12px;">
                        <span id="log-status-dot" style="width: 8px; height: 8px; border-radius: 50%; background: #00b894; display: inline-block; box-shadow: 0 0 8px #00b894;"></span>
                        <span style="font-size: 11px; font-weight: 800; color: var(--text-secondary); letter-spacing: 0.5px;">DIAGNOSTIC PIPELINE STATUS</span>
                    </div>
                </div>
            </div>

            <!-- Ingestion and System Metrics Grid -->
            <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); gap: 24px;">
                <!-- Telemetry Ingestion Stats -->
                <div class="card" style="padding: 24px; display: flex; flex-direction: column; gap: 20px; border-radius: 16px;">
                    <div style="display: flex; justify-content: space-between; align-items: center;">
                        <span style="font-size: 11px; font-weight: 800; color: var(--accent); letter-spacing: 1px;">INGESTION TELEMETRY</span>
                    </div>
                    <div style="display: flex; flex-direction: column; gap: 12px;">
                        <div style="display: flex; justify-content: space-between; align-items: center;">
                            <span style="font-size: 12px; color: var(--text-secondary);">Total Requests Received</span>
                            <span id="stat-received" style="font-size: 15px; font-weight: 800; font-family: 'Roboto Mono', monospace;">--</span>
                        </div>
                        <div style="display: flex; justify-content: space-between; align-items: center;">
                            <span style="font-size: 12px; color: var(--text-secondary);">Successfully Processed</span>
                            <span id="stat-processed" style="font-size: 15px; font-weight: 800; color: #00b894; font-family: 'Roboto Mono', monospace;">--</span>
                        </div>
                        <div style="display: flex; justify-content: space-between; align-items: center;">
                            <span style="font-size: 12px; color: var(--text-secondary);">IP Rate-Limited Drops</span>
                            <span id="stat-rate-limited" style="font-size: 15px; font-weight: 800; color: #fdcb6e; font-family: 'Roboto Mono', monospace;">--</span>
                        </div>
                        <div style="display: flex; justify-content: space-between; align-items: center;">
                            <span style="font-size: 12px; color: var(--text-secondary);">Validation/System Drops</span>
                            <span id="stat-dropped" style="font-size: 15px; font-weight: 800; color: #ff4c4c; font-family: 'Roboto Mono', monospace;">--</span>
                        </div>
                        <div style="display: flex; justify-content: space-between; align-items: center; border-top: 1px solid var(--border); padding-top: 12px;">
                            <span style="font-size: 12px; color: var(--text-secondary); font-weight: 700;">Avg Ingestion Latency</span>
                            <span id="stat-latency" style="font-size: 15px; font-weight: 800; color: var(--accent); font-family: 'Roboto Mono', monospace;">--</span>
                        </div>
                    </div>
                </div>

                <!-- Channel Queue Backpressure Stats -->
                <div class="card" style="padding: 24px; display: flex; flex-direction: column; gap: 20px; border-radius: 16px;">
                    <div style="display: flex; justify-content: space-between; align-items: center;">
                        <span style="font-size: 11px; font-weight: 800; color: var(--accent); letter-spacing: 1px;">BUFFER QUEUE CAPACITY</span>
                    </div>
                    <div style="display: flex; flex-direction: column; gap: 16px;">
                        <div>
                            <div style="display: flex; justify-content: space-between; font-size: 12px; margin-bottom: 8px;">
                                <span style="color: var(--text-secondary);">Ingestion Task Queue Buffer</span>
                                <span id="queue-ingest-percent" style="font-weight: 800; font-family: 'Roboto Mono', monospace;">--</span>
                            </div>
                            <div style="height: 6px; background: rgba(255,255,255,0.04); border-radius: 3px; overflow: hidden;">
                                <div id="queue-ingest-bar" style="height: 100%; width: 0%; background: linear-gradient(90deg, var(--accent) 0%, #00b894 100%); transition: width 0.3s ease;"></div>
                            </div>
                            <div id="queue-ingest-slots" style="font-size: 10px; color: var(--text-secondary); margin-top: 6px; text-align: right; font-family: 'Roboto Mono', monospace;">--</div>
                        </div>

                        <div>
                            <div style="display: flex; justify-content: space-between; font-size: 12px; margin-bottom: 8px;">
                                <span style="color: var(--text-secondary);">Session Sync Queue Buffer</span>
                                <span id="queue-session-percent" style="font-weight: 800; font-family: 'Roboto Mono', monospace;">--</span>
                            </div>
                            <div style="height: 6px; background: rgba(255,255,255,0.04); border-radius: 3px; overflow: hidden;">
                                <div id="queue-session-bar" style="height: 100%; width: 0%; background: linear-gradient(90deg, var(--accent) 0%, #00b894 100%); transition: width 0.3s ease;"></div>
                            </div>
                            <div id="queue-session-slots" style="font-size: 10px; color: var(--text-secondary); margin-top: 6px; text-align: right; font-family: 'Roboto Mono', monospace;">--</div>
                        </div>
                    </div>
                </div>

                <!-- Database Flush Health & Settings Toggle -->
                <div class="card" style="padding: 24px; display: flex; flex-direction: column; gap: 20px; border-radius: 16px;">
                    <div style="display: flex; justify-content: space-between; align-items: center;">
                        <span style="font-size: 11px; font-weight: 800; color: var(--accent); letter-spacing: 1px;">DATABASE FLUSH HEALTH</span>
                    </div>
                    <div style="display: flex; flex-direction: column; gap: 12px;">
                        <div style="display: flex; justify-content: space-between; align-items: center;">
                            <span style="font-size: 12px; color: var(--text-secondary);">Successful Transaction Flushes</span>
                            <span id="stat-flush-success" style="font-size: 15px; font-weight: 800; color: #00b894; font-family: 'Roboto Mono', monospace;">--</span>
                        </div>
                        <div style="display: flex; justify-content: space-between; align-items: center;">
                            <span style="font-size: 12px; color: var(--text-secondary);">Lock Contentions/Failed Flushes</span>
                            <span id="stat-flush-failed" style="font-size: 15px; font-weight: 800; color: #ff4c4c; font-family: 'Roboto Mono', monospace;">--</span>
                        </div>
                        
                        <div style="border-top: 1px solid var(--border); padding-top: 12px; margin-top: 4px; display: flex; align-items: center; justify-content: space-between;">
                            <div>
                                <div style="font-size: 12px; font-weight: 700; color: var(--text-primary);">Internal Exception Logging</div>
                                <div style="font-size: 10px; color: var(--text-secondary); margin-top: 2px;">Record SQLite locks/errors to system db</div>
                            </div>
                            <label class="switch">
                                <input type="checkbox" id="toggle-internal-logging">
                                <span class="slider round"></span>
                            </label>
                        </div>
                    </div>
                </div>
            </div>

            <!-- CPU and Memory Footprint Section -->
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 24px; flex-wrap: wrap;">
                <!-- CPU Resource Panel -->
                <div class="card" style="padding: 24px; display: flex; flex-direction: column; gap: 16px; border-radius: 16px;">
                    <div style="display: flex; justify-content: space-between; align-items: center;">
                        <span style="font-size: 11px; font-weight: 800; color: var(--accent); letter-spacing: 1px;">CPU UTILIZATION</span>
                    </div>
                    <div style="display: flex; align-items: center; justify-content: space-around; padding: 12px 0;">
                        <div style="text-align: center; flex: 1;">
                            <div style="font-size: 10px; font-weight: 800; color: var(--text-secondary); margin-bottom: 6px; letter-spacing: 0.5px;">PROCESS ENGINE</div>
                            <div id="stat-cpu-proc" style="font-size: 24px; font-weight: 900; color: var(--accent); font-family: 'Roboto Mono', monospace; white-space: nowrap;">--%</div>
                        </div>
                        <div style="width: 1px; height: 50px; background: var(--border); margin: 0 10px;"></div>
                        <div style="text-align: center; flex: 1;">
                            <div style="font-size: 10px; font-weight: 800; color: var(--text-secondary); margin-bottom: 6px; letter-spacing: 0.5px;">TOTAL SYSTEM CPU</div>
                            <div id="stat-cpu-sys" style="font-size: 24px; font-weight: 900; color: var(--text-primary); font-family: 'Roboto Mono', monospace; white-space: nowrap;">--%</div>
                        </div>
                    </div>
                </div>

                <!-- Memory Resource Panel -->
                <div class="card" style="padding: 24px; display: flex; flex-direction: column; gap: 16px; border-radius: 16px;">
                    <div style="display: flex; justify-content: space-between; align-items: center;">
                        <span style="font-size: 11px; font-weight: 800; color: var(--accent); letter-spacing: 1px;">MEMORY PROFILE</span>
                    </div>
                    <div style="display: flex; align-items: center; justify-content: space-around; padding: 12px 0;">
                        <div style="text-align: center; flex: 1;">
                            <div style="font-size: 10px; font-weight: 800; color: var(--text-secondary); margin-bottom: 6px; letter-spacing: 0.5px;">FORTENLOG WORKING SET</div>
                            <div id="stat-mem-proc" style="font-size: 24px; font-weight: 900; color: var(--accent); font-family: 'Roboto Mono', monospace; white-space: nowrap;">-- MB</div>
                        </div>
                        <div style="width: 1px; height: 50px; background: var(--border); margin: 0 10px;"></div>
                        <div style="text-align: center; flex: 1;">
                            <div style="font-size: 10px; font-weight: 800; color: var(--text-secondary); margin-bottom: 6px; letter-spacing: 0.5px;">TOTAL SYSTEM MEMORY</div>
                            <div id="stat-mem-sys" style="font-size: 24px; font-weight: 900; color: var(--text-primary); font-family: 'Roboto Mono', monospace; white-space: nowrap;">--%</div>
                            <div id="stat-mem-sys-details" style="font-size: 11px; color: var(--text-secondary); font-family: 'Roboto Mono', monospace; margin-top: 4px;">-- GB / -- GB</div>
                        </div>
                    </div>
                </div>
            </div>

            <!-- Project Resource Footprint -->
            <div class="card" style="padding: 24px; border-radius: 16px; display: flex; flex-direction: column; gap: 20px;">
                <div style="display: flex; justify-content: space-between; align-items: center;">
                    <div>
                        <h3 style="margin: 0; font-size: 16px; font-weight: 800;">Per-Project Resource Footprint</h3>
                        <p style="color: var(--text-secondary); margin: 4px 0 0 0; font-size: 12px;">Active database connections and in-memory cache usage for loaded projects.</p>
                    </div>
                </div>
                <div style="max-height: 250px; overflow-y: auto; border: 1px solid var(--border); border-radius: 12px; background: var(--bg-sub);">
                    <table class="issue-table" style="width: 100%; border-collapse: separate; border-spacing: 0; font-size: 13px;">
                        <thead style="position: sticky; top: 0; z-index: 10; background: var(--bg-main);">
                            <tr>
                                <th style="padding: 12px 16px; text-align: left;">Project ID</th>
                                <th style="padding: 12px 16px; text-align: right; width: 140px;">Active Connections</th>
                                <th style="padding: 12px 16px; text-align: right; width: 140px;">Idle Connections</th>
                                <th style="padding: 12px 16px; text-align: right; width: 200px;">Cache RAM Usage</th>
                            </tr>
                        </thead>
                        <tbody id="project-perf-body">
                            <tr>
                                <td colspan="4" style="text-align: center; padding: 20px; color: var(--text-secondary);">Waiting for telemetry...</td>
                            </tr>
                        </tbody>
                    </table>
                </div>
            </div>

            <!-- Diagnostics Exceptions Table Section -->
            <div class="card" style="padding: 24px; border-radius: 16px; display: flex; flex-direction: column; gap: 20px;">
                <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 16px;">
                    <div>
                        <h3 style="margin: 0; font-size: 16px; font-weight: 800;">Logged Internal System Errors</h3>
                        <p style="color: var(--text-secondary); margin: 4px 0 0 0; font-size: 12px;">Active monitoring of background database write locks, pool timeouts, and file lock retries.</p>
                    </div>
                    <div style="display: flex; align-items: center; gap: 12px;">
                        <input type="text" id="error-search" class="search-input" placeholder="Search component or error message..." style="width: 250px; height: 36px; font-size: 12px;">
                        <button id="btn-purge-errors" class="btn" style="border-color: #ff4c4c; color: #ff4c4c; height: 36px; padding: 0 16px; display: flex; align-items: center; gap: 8px;">
                            Purge System Logs
                        </button>
                    </div>
                </div>

                <div style="max-height: 400px; overflow-y: auto; border: 1px solid var(--border); border-radius: 12px; background: var(--bg-sub);">
                    <table class="issue-table" style="width: 100%; border-collapse: separate; border-spacing: 0; font-size: 13px;">
                        <thead style="position: sticky; top: 0; z-index: 10; background: var(--bg-main);">
                            <tr>
                                <th style="padding: 12px 16px; width: 60px; text-align: center;">ID</th>
                                <th style="padding: 12px 16px; width: 180px;">Timestamp</th>
                                <th style="padding: 12px 16px; width: 140px;">Component</th>
                                <th style="padding: 12px 16px;">Error Reason</th>
                                <th style="padding: 12px 16px; width: 150px;">Associated Context</th>
                            </tr>
                        </thead>
                        <tbody id="error-logs-body">
                            <tr>
                                <td colspan="5" style="text-align: center; padding: 40px; color: var(--text-secondary);">
                                    Connecting to diagnostics server telemetry pipeline...
                                </td>
                            </tr>
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    `;

    // Load initial settings toggle state
    await loadToggleState();

    // Hook settings toggle event listener
    document.getElementById('toggle-internal-logging').onchange = async (e) => {
        try {
            await api('/api/system/settings', {
                method: 'POST',
                body: JSON.stringify({
                    enable_internal_error_logging: e.target.checked ? "true" : "false"
                })
            });
            alert("Settings updated: Internal diagnostics logging is " + (e.target.checked ? "ENABLED" : "DISABLED") + ".");
            // Sync status dot color
            updateStatusDot(e.target.checked);
        } catch (err) {
            console.error(err);
            alert("Failed to update internal logging configuration.");
        }
    };

    // Purge internal errors log table
    document.getElementById('btn-purge-errors').onclick = async () => {
        if (confirm("Are you sure you want to permanently purge all logged internal system errors? This action is irreversible.")) {
            try {
                const code = await api('/api/system/errors/clear', { method: 'POST' });
                alert("Success: All diagnostic system error logs have been purged.");
                await updateData();
            } catch (err) {
                console.error(err);
                alert("Failed to purge diagnostic logs.");
            }
        }
    };

    // Filter table dynamically on search input change
    let allErrors = [];
    document.getElementById('error-search').oninput = (e) => {
        renderTableRows(allErrors, e.target.value);
    };

    // Pull periodic real-time data
    async function updateData() {
        if (!document.getElementById('stat-received')) {
            if (updateInterval) {
                clearInterval(updateInterval);
                updateInterval = null;
            }
            return;
        }

        try {
            const res = await api('/api/system/performance');
            console.log('[Performance API Debug] Raw response:', res);

            if (!res || !res.data) {
                console.warn('[Performance API Debug] Missing data or failed request:', res);
                return;
            }

            const m = res.data.metrics;
            allErrors = res.data.errors || [];

            // Ingestion Counters
            document.getElementById('stat-received').innerText = Number(m.total_received).toLocaleString();
            document.getElementById('stat-processed').innerText = Number(m.total_processed).toLocaleString();
            document.getElementById('stat-rate-limited').innerText = Number(m.total_rate_limited).toLocaleString();
            document.getElementById('stat-dropped').innerText = Number(m.total_dropped).toLocaleString();

            // Avg latency formatting (micros to millis if large)
            const latMicros = Number(m.last_latency_micros);
            if (latMicros >= 1000) {
                document.getElementById('stat-latency').innerText = (latMicros / 1000).toFixed(2) + ' ms';
            } else {
                document.getElementById('stat-latency').innerText = latMicros + ' μs';
            }

            // Ingestion queue capacity metrics (Tokio MPSC Sender has 50,000 max size)
            const maxIngest = 50000;
            const remainingIngest = Number(m.ingest_channel_remaining);
            const activeIngest = Math.max(0, maxIngest - remainingIngest);
            const ingestRatio = Math.min(100, Math.max(0, (activeIngest / maxIngest) * 100));

            document.getElementById('queue-ingest-percent').innerText = ingestRatio.toFixed(1) + '%';
            document.getElementById('queue-ingest-bar').style.width = ingestRatio.toFixed(1) + '%';
            document.getElementById('queue-ingest-slots').innerText = activeIngest.toLocaleString() + ' / ' + maxIngest.toLocaleString() + ' in buffer';

            // Change queue bar color on backpressure load
            if (ingestRatio > 80) {
                document.getElementById('queue-ingest-bar').style.background = '#ff4c4c';
            } else if (ingestRatio > 50) {
                document.getElementById('queue-ingest-bar').style.background = '#fdcb6e';
            } else {
                document.getElementById('queue-ingest-bar').style.background = 'linear-gradient(90deg, var(--accent) 0%, #00b894 100%)';
            }

            // Session Sync Queue capacity metrics (10,000 max capacity)
            const maxSession = 10000;
            const remainingSession = Number(m.session_channel_remaining);
            const activeSession = Math.max(0, maxSession - remainingSession);
            const sessionRatio = Math.min(100, Math.max(0, (activeSession / maxSession) * 100));

            document.getElementById('queue-session-percent').innerText = sessionRatio.toFixed(1) + '%';
            document.getElementById('queue-session-bar').style.width = sessionRatio.toFixed(1) + '%';
            document.getElementById('queue-session-slots').innerText = activeSession.toLocaleString() + ' / ' + maxSession.toLocaleString() + ' in buffer';

            if (sessionRatio > 80) {
                document.getElementById('queue-session-bar').style.background = '#ff4c4c';
            } else if (sessionRatio > 50) {
                document.getElementById('queue-session-bar').style.background = '#fdcb6e';
            } else {
                document.getElementById('queue-session-bar').style.background = 'linear-gradient(90deg, var(--accent) 0%, #00b894 100%)';
            }

            // Flush health stats
            document.getElementById('stat-flush-success').innerText = Number(m.db_flushes_success).toLocaleString();
            document.getElementById('stat-flush-failed').innerText = Number(m.db_flushes_failed).toLocaleString();

            // CPU resources from backend Sysinfo
            const procCpu = Number(m.process_cpu_percent);
            const sysCpu = Number(m.system_cpu_percent);
            document.getElementById('stat-cpu-proc').innerText = procCpu.toFixed(1) + '%';
            document.getElementById('stat-cpu-sys').innerText = sysCpu.toFixed(1) + '%';

            // Memory profiles from backend Sysinfo
            const procMemBytes = Number(m.process_mem_bytes);
            const sysTotalMem = Number(m.system_total_mem_bytes);
            const sysUsedMem = Number(m.system_used_mem_bytes);
            const sysMemRatio = sysTotalMem > 0 ? (sysUsedMem / sysTotalMem) * 100 : 0;

            document.getElementById('stat-mem-proc').innerText = (procMemBytes / (1024 * 1024)).toFixed(1) + ' MB';
            document.getElementById('stat-mem-sys').innerText = sysMemRatio.toFixed(1) + '%';
            document.getElementById('stat-mem-sys-details').innerText = (sysUsedMem / (1024 * 1024 * 1024)).toFixed(1) + ' GB / ' + (sysTotalMem / (1024 * 1024 * 1024)).toFixed(1) + ' GB';

            // Render Project Performance Table
            const projPerf = res.data.projects_performance || [];
            const perfBody = document.getElementById('project-perf-body');
            if (perfBody) {
                if (projPerf.length === 0) {
                    perfBody.innerHTML = '<tr><td colspan="4" style="text-align: center; padding: 20px; color: var(--text-secondary);">No active projects loaded in memory.</td></tr>';
                } else {
                    perfBody.innerHTML = projPerf.map(p => {
                        const activeConns = p.connections - p.idle_connections;
                        return `
                        <tr class="issue-row">
                            <td style="padding: 12px 16px; font-weight: 600; font-size: 12px;">${escapeHtml(p.project_id)}</td>
                            <td style="padding: 12px 16px; text-align: right; font-family: 'Roboto Mono', monospace; font-size: 12px; color: ${activeConns > 0 ? '#00b894' : 'var(--text-secondary)'};">${activeConns}</td>
                            <td style="padding: 12px 16px; text-align: right; font-family: 'Roboto Mono', monospace; font-size: 12px; color: var(--text-secondary);">${p.idle_connections}</td>
                            <td style="padding: 12px 16px; text-align: right; font-family: 'Roboto Mono', monospace; font-size: 12px;">
                                <div style="display: flex; align-items: center; justify-content: flex-end; gap: 8px;">
                                    <div style="flex: 1; height: 4px; background: rgba(255,255,255,0.05); border-radius: 2px; overflow: hidden; max-width: 60px;">
                                        <div style="height: 100%; width: ${Math.min(100, (p.cache_used_bytes / (p.cache_limit_mb * 1024 * 1024)) * 100)}%; background: var(--accent);"></div>
                                    </div>
                                    <span style="color: var(--accent); font-weight: 800;">${(p.cache_used_bytes / (1024*1024)).toFixed(2)} MB</span>
                                    <span style="color: var(--text-secondary); opacity: 0.7;">/ ${p.cache_limit_mb} MB</span>
                                </div>
                            </td>
                        </tr>
                        `;
                    }).join('');
                }
            }

            // Render table
            const searchVal = document.getElementById('error-search').value;
            renderTableRows(allErrors, searchVal);

        } catch (err) {
            console.error("Error pulling system metrics:", err);
        }
    }

    function renderTableRows(errorsList, searchFilter = '') {
        const body = document.getElementById('error-logs-body');
        if (!body) return;

        const filter = searchFilter.toLowerCase();
        const filtered = errorsList.filter(e => {
            return e.component.toLowerCase().includes(filter) ||
                   e.error_message.toLowerCase().includes(filter) ||
                   (e.context && e.context.toLowerCase().includes(filter));
        });

        if (filtered.length === 0) {
            body.innerHTML = `
                <tr>
                    <td colspan="5" style="text-align: center; padding: 40px; color: var(--text-secondary);">
                        No system exception error logs found matching the filter.
                    </td>
                </tr>
            `;
            return;
        }

        body.innerHTML = filtered.map(e => {
            const timeStr = new Date(e.timestamp).toLocaleString();
            return `
                <tr class="issue-row">
                    <td style="padding: 12px 16px; text-align: center; font-family: 'Roboto Mono', monospace; font-size: 11px; color: var(--text-secondary);">${e.id}</td>
                    <td style="padding: 12px 16px; font-weight: 600; font-size: 12px;">${timeStr}</td>
                    <td style="padding: 12px 16px;">
                        <span class="badge" style="background: rgba(108, 92, 231, 0.15); color: var(--accent); border: 1px solid rgba(108, 92, 231, 0.3); padding: 4px 8px; border-radius: 6px; font-family: 'Roboto Mono', monospace; font-size: 11px;">
                            ${escapeHtml(e.component)}
                        </span>
                    </td>
                    <td style="padding: 12px 16px; font-family: 'Roboto Mono', monospace; font-size: 12px; color: #ff4c4c; word-break: break-all;">
                        ${escapeHtml(e.error_message)}
                    </td>
                    <td style="padding: 12px 16px; font-family: 'Roboto Mono', monospace; font-size: 11px; color: var(--text-secondary);">
                        ${e.context ? escapeHtml(e.context) : '<span style="opacity: 0.3;">none</span>'}
                    </td>
                </tr>
            `;
        }).join('');
    }

    function escapeHtml(str) {
        if (!str) return '';
        return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
    }

    async function loadToggleState() {
        try {
            const { data: settings } = await api('/api/system/settings');
            const isEnabled = settings ? settings.enable_internal_error_logging === "true" : false;
            document.getElementById('toggle-internal-logging').checked = isEnabled;
            updateStatusDot(isEnabled);
        } catch (err) {
            console.error("Failed to load setting toggle status:", err);
        }
    }

    function updateStatusDot(active) {
        const dot = document.getElementById('log-status-dot');
        if (!dot) return;
        if (active) {
            dot.style.background = '#00b894';
            dot.style.boxShadow = '0 0 8px #00b894';
        } else {
            dot.style.background = '#ff4c4c';
            dot.style.boxShadow = '0 0 8px #ff4c4c';
        }
    }

    // Call first update synchronously
    await updateData();

    // Start interval
    updateInterval = setInterval(updateData, 2000);
}
