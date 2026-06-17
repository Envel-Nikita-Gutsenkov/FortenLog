import { api } from '../api.js';

export async function renderDocs(container) {
    container.innerHTML = `
        <style>
            .docs-container {
                display: flex;
                gap: 24px;
                margin-top: 24px;
            }
            .docs-sidebar {
                width: 260px;
                display: flex;
                flex-direction: column;
                gap: 4px;
                flex-shrink: 0;
                position: sticky;
                top: 24px;
                max-height: calc(100vh - 120px);
                overflow-y: auto;
                padding-right: 4px;
            }
            .docs-sidebar::-webkit-scrollbar { width: 4px; }
            .docs-sidebar::-webkit-scrollbar-track { background: transparent; }
            .docs-sidebar::-webkit-scrollbar-thumb { background: var(--border); border-radius: 2px; }
            .docs-sidebar-group {
                font-size: 10px;
                font-weight: 800;
                text-transform: uppercase;
                letter-spacing: 0.1em;
                color: var(--text-secondary);
                padding: 12px 16px 4px;
                margin-top: 4px;
            }
            .docs-nav-btn {
                display: flex;
                align-items: center;
                gap: 10px;
                padding: 9px 16px;
                border-radius: 8px;
                background: transparent;
                border: 1px solid transparent;
                color: var(--text-secondary);
                font-weight: 600;
                font-size: 13px;
                text-align: left;
                cursor: pointer;
                transition: all 0.15s ease;
                width: 100%;
            }
            .docs-nav-btn:hover {
                background: var(--border);
                color: var(--text);
            }
            .docs-nav-btn.active {
                background: rgba(162, 122, 245, 0.12);
                border-color: rgba(162, 122, 245, 0.35);
                color: var(--accent);
            }
            .docs-content {
                flex-grow: 1;
                background: var(--bg-sub);
                border: 1px solid var(--border);
                border-radius: 16px;
                padding: 36px 40px;
                min-width: 0;
                box-shadow: 0 4px 24px rgba(0, 0, 0, 0.18);
            }
            .doc-section { display: none; }
            .doc-section.active {
                display: block;
                animation: docFadeIn 0.25s ease;
            }
            @keyframes docFadeIn {
                from { opacity: 0; transform: translateY(8px); }
                to   { opacity: 1; transform: translateY(0); }
            }
            .doc-section h2 {
                font-size: 24px;
                font-weight: 800;
                margin-bottom: 8px;
                color: var(--text);
                display: flex;
                align-items: center;
                gap: 12px;
                letter-spacing: -0.5px;
            }
            .doc-section .section-lead {
                font-size: 14px;
                line-height: 1.7;
                color: var(--text-secondary);
                margin-bottom: 28px;
                max-width: 680px;
            }
            .doc-section h3 {
                font-size: 16px;
                font-weight: 700;
                color: var(--text);
                margin: 32px 0 12px;
                display: flex;
                align-items: center;
                gap: 8px;
            }
            .doc-section h4 {
                font-size: 13px;
                font-weight: 700;
                color: var(--text);
                margin: 20px 0 10px;
            }
            .doc-section p {
                font-size: 13px;
                line-height: 1.65;
                color: var(--text-secondary);
                margin-bottom: 16px;
            }
            .doc-section ul {
                padding-left: 18px;
                margin-bottom: 16px;
            }
            .doc-section li {
                font-size: 13px;
                line-height: 1.65;
                color: var(--text-secondary);
                margin-bottom: 5px;
            }
            .doc-section li strong { color: var(--text); }
            .doc-divider {
                height: 1px;
                background: var(--border);
                margin: 32px 0;
            }
            .feature-tag {
                background: rgba(162, 122, 245, 0.1);
                color: var(--accent);
                padding: 2px 8px;
                border-radius: 4px;
                font-size: 10px;
                font-weight: 700;
                border: 1px solid rgba(162, 122, 245, 0.2);
                text-transform: uppercase;
                letter-spacing: 0.05em;
            }
            .tag-new {
                background: rgba(0, 184, 148, 0.1);
                color: #00b894;
                padding: 2px 8px;
                border-radius: 4px;
                font-size: 10px;
                font-weight: 700;
                border: 1px solid rgba(0, 184, 148, 0.25);
            }
            .param-table {
                width: 100%;
                border-collapse: collapse;
                margin: 16px 0 24px;
                background: rgba(255,255,255,0.02);
                border-radius: 8px;
                overflow: hidden;
            }
            .param-table th, .param-table td {
                padding: 11px 14px;
                text-align: left;
                font-size: 13px;
                border-bottom: 1px solid var(--border);
            }
            .param-table tr:last-child td { border-bottom: none; }
            .param-table th {
                background: rgba(255,255,255,0.04);
                font-weight: 700;
                text-transform: uppercase;
                font-size: 10px;
                letter-spacing: 0.1em;
                color: var(--text-secondary);
            }
            .param-table td code {
                background: rgba(162,122,245,0.08);
                color: var(--accent);
                padding: 2px 6px;
                border-radius: 4px;
                font-family: monospace;
                font-size: 12px;
            }
            .code-header {
                display: flex;
                justify-content: space-between;
                align-items: center;
                background: #13131e;
                border: 1px solid var(--border);
                border-bottom: none;
                padding: 9px 14px;
                border-top-left-radius: 8px;
                border-top-right-radius: 8px;
                font-size: 11px;
                font-family: monospace;
                color: var(--text-secondary);
            }
            .code-box { margin: 0 0 20px; position: relative; }
            .code-content-pre {
                margin: 0;
                padding: 16px 18px;
                background: #0a0a10;
                border: 1px solid var(--border);
                border-bottom-left-radius: 8px;
                border-bottom-right-radius: 8px;
                overflow-x: auto;
                font-family: 'Fira Code', 'Cascadia Code', Consolas, Monaco, monospace;
                font-size: 13px;
                line-height: 1.6;
                color: #e5c07b;
            }
            .copy-btn {
                background: transparent;
                border: 1px solid var(--border);
                color: var(--text-secondary);
                padding: 3px 10px;
                border-radius: 4px;
                font-size: 11px;
                cursor: pointer;
                transition: all 0.15s;
                font-family: inherit;
            }
            .copy-btn:hover { background: var(--border); color: var(--text); }
            .badge-method {
                padding: 2px 7px;
                border-radius: 4px;
                font-weight: 800;
                font-size: 10px;
                letter-spacing: 0.05em;
                font-family: monospace;
            }
            .badge-method.post { background: rgba(9,132,227,0.15); color: #0984e3; }
            .badge-method.get  { background: rgba(0,184,148,0.15); color: #00b894; }
            .dsn-interactive-container {
                background: rgba(162,122,245,0.04);
                border: 1px dashed rgba(162,122,245,0.4);
                padding: 20px;
                border-radius: 12px;
                margin-bottom: 28px;
            }
            .dsn-interactive-title {
                font-size: 13px;
                font-weight: 700;
                margin-bottom: 10px;
                color: var(--accent);
            }
            .dsn-select {
                padding: 8px 12px;
                border-radius: 6px;
                background: var(--bg-sub);
                border: 1px solid var(--border);
                color: var(--text);
                font-size: 13px;
                cursor: pointer;
            }
            .info-grid {
                display: grid;
                grid-template-columns: 1fr 1fr;
                gap: 16px;
                margin-bottom: 24px;
            }
            .info-panel {
                background: rgba(255,255,255,0.02);
                border: 1px solid var(--border);
                border-radius: 10px;
                padding: 18px;
            }
            .info-panel h4 {
                color: var(--text);
                font-size: 14px;
                margin-bottom: 8px;
                font-weight: 700;
            }
            .info-panel p {
                font-size: 13px;
                color: var(--text-secondary);
                line-height: 1.55;
                margin-bottom: 0;
            }
            .callout {
                padding: 14px 18px;
                border-radius: 8px;
                margin: 16px 0;
                font-size: 13px;
                line-height: 1.55;
            }
            .callout-purple {
                border-left: 3px solid var(--accent);
                background: rgba(162,122,245,0.06);
                color: var(--text-secondary);
            }
            .callout-yellow {
                border-left: 3px solid #f1c40f;
                background: rgba(241,196,15,0.05);
                color: var(--text-secondary);
            }
            .callout-green {
                border-left: 3px solid #00b894;
                background: rgba(0,184,148,0.05);
                color: var(--text-secondary);
            }
            .callout-red {
                border-left: 3px solid #e74c3c;
                background: rgba(231,76,60,0.05);
                color: var(--text-secondary);
            }
            .callout strong { color: var(--text); display: block; margin-bottom: 4px; font-size: 13px; }
            .step-list { counter-reset: step-counter; list-style: none; padding-left: 0; }
            .step-list li {
                counter-increment: step-counter;
                display: flex;
                gap: 14px;
                margin-bottom: 20px;
                font-size: 13px;
                color: var(--text-secondary);
                line-height: 1.6;
            }
            .step-list li::before {
                content: counter(step-counter);
                display: flex;
                align-items: center;
                justify-content: center;
                min-width: 26px;
                height: 26px;
                border-radius: 50%;
                background: rgba(162,122,245,0.15);
                border: 1px solid rgba(162,122,245,0.3);
                color: var(--accent);
                font-weight: 800;
                font-size: 12px;
                margin-top: 1px;
            }
            .step-list li strong { color: var(--text); }
            .ui-screen-card {
                background: rgba(255,255,255,0.02);
                border: 1px solid var(--border);
                border-radius: 10px;
                padding: 20px;
                margin-bottom: 20px;
            }
            .ui-screen-card h4 {
                display: flex;
                align-items: center;
                gap: 10px;
                color: var(--text);
                font-size: 14px;
                font-weight: 700;
                margin-bottom: 12px;
            }
            .ui-screen-card .screen-icon {
                width: 32px;
                height: 32px;
                border-radius: 8px;
                display: flex;
                align-items: center;
                justify-content: center;
                font-size: 16px;
                flex-shrink: 0;
            }
        </style>

        <div class="view-content-inner">
            <div class="header-section">
                <h1>Platform Documentation</h1>
                <p>FortenLog — self-hosted error tracking and analytics. Private, fast, and built for real-world use.</p>
            </div>

            <div class="docs-container">
                <div class="docs-sidebar">
                    <div class="docs-sidebar-group">Getting Started</div>
                    <button class="docs-nav-btn active" data-tab="quickstart">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#00b894" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="min-width:16px"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>
                        Quick Start
                    </button>
                    <button class="docs-nav-btn" data-tab="overview">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="min-width:16px"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/></svg>
                        DSN &amp; Ingestion API
                    </button>
                    <button class="docs-nav-btn" data-tab="rest-api">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fdcb6e" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="min-width:16px"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>
                        REST API v1
                    </button>
                    <button class="docs-nav-btn" data-tab="ui-guide">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#74b9ff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="min-width:16px"><rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>
                        Using the Interface
                    </button>

                    <div class="docs-sidebar-group">Platform Integrations</div>
                    <button class="docs-nav-btn" data-tab="analytics">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#f1c40f" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="min-width:16px"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>
                        Custom Analytics
                    </button>
                    <button class="docs-nav-btn" data-tab="nextjs">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="#339933" style="min-width:16px"><path d="M12 24c-.2 0-.4 0-.5-.1L3.1 19c-.4-.2-.6-.6-.6-1V8.1c0-.4.2-.8.6-1L11.5.2c.3-.2.7-.2 1 0l8.3 4.9c.4.2.6.6.6 1v9.9c0 .4-.2.8-.6 1l-8.3 4.9c-.1.1-.3.1-.5.1zM4.1 17.5l7.9 4.6 7.9-4.6V8.6l-7.9-4.6-7.9 4.6v8.9z"/></svg>
                        Node.js / Next.js
                    </button>
                    <button class="docs-nav-btn" data-tab="electron">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="#9FEAF9" stroke="#9FEAF9" stroke-width="1.5" style="min-width:16px"><circle cx="12" cy="12" r="3" fill="#9FEAF9"/><ellipse cx="12" cy="12" rx="10" ry="4" transform="rotate(30 12 12)" fill="none"/><ellipse cx="12" cy="12" rx="10" ry="4" transform="rotate(90 12 12)" fill="none"/><ellipse cx="12" cy="12" rx="10" ry="4" transform="rotate(150 12 12)" fill="none"/></svg>
                        Electron Apps
                    </button>
                    <button class="docs-nav-btn" data-tab="python">
                        <svg width="16" height="16" viewBox="0 0 110 110" style="min-width:16px"><path d="M54 2C32.3 2 33.7 11.2 33.7 11.2l.1 10.3h20.6v3c0 1.8-1.4 3.2-3.2 3.2H25.4c-9 0-15.6 6.3-15.6 15.6v12.2c0 9.3 7.6 14.8 14.8 14.8h8.8v-12c0-5 4-9 9-9h20.6c5 0 9-4 9-9V21.8c0-5-4-9-9-9H54.2c-5 0-9 4.2-9 9.3l.1.5v-.1z" fill="#3776AB"/><path d="M56 108c21.7 0 20.3-9.2 20.3-9.2l-.1-10.3H55.6v-3c0-1.8 1.4-3.2 3.2-3.2h25.8c9 0 15.6-6.3 15.6-15.6V54.5c0-9.3-7.6-14.8-14.8-14.8h-8.8v12c0 5-4 9-9 9H66.6c-5 0-9 4-9 9v20.4c0 5 4 9 9 9h20.6c5 0 9-4.2 9-9.3l-.1-.5v.1z" fill="#FFE873"/><circle cx="43.5" cy="18.5" r="4.5" fill="#fff"/><circle cx="66.5" cy="91.5" r="4.5" fill="#111"/></svg>
                        Python
                    </button>
                    <button class="docs-nav-btn" data-tab="java">
                        <svg width="16" height="16" viewBox="0 0 40 40" style="min-width:16px"><path d="M15.2 2.1c-.8.8-1 1.7-.8 2.6.2.9.8 1.6 1.4 2.2.8.8 1.7 1.4 2.6 2.1 1.2.9 2.5 1.9 3.1 3.4.6 1.4.3 3-.6 4.2-1.4 1.8-3.9 2.5-6.1 2.2.5-.2.9-.6 1.2-1 .5-.7.7-1.6.5-2.5-.2-.9-.7-1.7-1.4-2.3-.9-.9-1.9-1.6-2.9-2.4-1.2-.9-2.5-2-3-3.6-.5-1.5-.2-3.2.8-4.4C11 .8 13.3.1 15.2 2.1z" fill="#EA2D42"/><path d="M22.5 5.5c-.5.6-.7 1.3-.5 2 .2.7.6 1.2 1 1.7.6.6 1.3 1.1 2 1.6.9.7 1.9 1.4 2.4 2.6.5 1.1.2 2.3-.5 3.2-1.1 1.4-3 1.9-4.7 1.7.4-.2.7-.5.9-.8.4-.5.5-1.2.4-1.9-.1-.7-.5-1.3-1-1.7-.7-.7-1.5-1.2-2.2-1.8-.9-.7-1.9-1.5-2.3-2.7-.4-1.1-.2-2.4.6-3.3 1.1-1.4 3-1.9 4.7-1.7z" fill="#F0931B"/><path d="M4 23.5c0 1.5 1.2 2.7 2.7 2.7H25c1.5 0 2.7-1.2 2.7-2.7v-7.5H4v7.5zm25.5-5.5H27v4h2.5c.8 0 1.5-.7 1.5-1.5v-1c0-.8-.7-1.5-1.5-1.5z" fill="#5382A1"/><path d="M2 30c0 .6.4 1 1 1h26c.6 0 1-.4 1-1v-1H2v1z" fill="#5382A1"/></svg>
                        Java / Spring
                    </button>
                    <button class="docs-nav-btn" data-tab="csharp">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" style="min-width:16px"><text x="2" y="17" font-size="14" font-weight="900" fill="#9B59B6" font-family="monospace">C#</text></svg>
                        C# / Unity
                    </button>
                    <button class="docs-nav-btn" data-tab="go">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" style="min-width:16px"><text x="1" y="16" font-size="13" font-weight="900" fill="#00ACD7" font-family="monospace">Go</text></svg>
                        Go
                    </button>
                    <button class="docs-nav-btn" data-tab="rust">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" style="min-width:16px"><text x="0" y="16" font-size="11" font-weight="900" fill="#e67e22" font-family="monospace">Rs</text></svg>
                        Rust
                    </button>

                    <div class="docs-sidebar-group">Infrastructure</div>
                    <button class="docs-nav-btn" data-tab="security">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#2ecc71" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="min-width:16px"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
                        Security &amp; Privacy
                    </button>
                    <button class="docs-nav-btn" data-tab="databases">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#e67e22" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="min-width:16px"><ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"/><path d="M3 12c0 1.66 4 3 9 3s9-1.34 9-3"/></svg>
                        Databases &amp; Scaling
                    </button>
                    <button class="docs-nav-btn" data-tab="monitoring">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#e74c3c" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="min-width:16px"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>
                        Monitors &amp; Webhooks
                    </button>
                </div>

                <div class="docs-content">

                    <!-- QUICK START -->
                    <div class="doc-section active" id="doc-quickstart">
                        <h2>
                            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#00b894" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>
                            Quick Start Guide
                        </h2>
                        <p class="section-lead">Get FortenLog integrated into your application in under 5 minutes. This guide walks you from creating your first project to seeing live events on the dashboard.</p>

                        <div class="callout callout-green">
                            <strong>Prerequisites</strong>
                            FortenLog server is running (default: <code>http://localhost:3000</code>). You're logged in to the admin panel. If you're deploying remotely, replace <code>localhost:3000</code> with your server's hostname throughout this guide.
                        </div>

                        <h3>Step 1 — Create a Project</h3>
                        <p>Navigate to <strong>Projects</strong> in the left sidebar. Click <strong>New Project</strong>, enter a name (e.g., <code>my-app</code>), and submit. You will immediately receive:</p>
                        <ul>
                            <li><strong>Project ID</strong> — a short slug like <code>my-app</code> used in API paths</li>
                            <li><strong>API Key</strong> — a secret token like <code>fl_04182abc…</code> included in every SDK call</li>
                            <li><strong>DSN</strong> — a combined connection string for Sentry-compatible SDKs: <code>http://[API_KEY]@localhost:3000/[PROJECT_ID]</code></li>
                        </ul>

                        <div class="callout callout-yellow">
                            <strong>⚠️ DSN Quirk — Numeric ID Requirement</strong>
                            The official Sentry SDK validates that the project ID in the DSN is a number. Since FortenLog uses text slugs, use a fake numeric ID (<code>/1</code>) in the DSN field and route all traffic via the <code>tunnel</code> option instead. This is documented in detail in each platform section below.
                        </div>

                        <h3>Step 2 — Choose Your Integration Path</h3>
                        <div class="info-grid">
                            <div class="info-panel">
                                <h4>🛡️ Error &amp; Crash Tracking</h4>
                                <p>Uses the <strong>Sentry SDK</strong> for your platform. Automatically captures unhandled exceptions, stack traces, environment context, and affected user counts. Zero manual code required after initialization.</p>
                                <p style="margin-top:8px;"><strong>Endpoint:</strong> <code>POST /api/[PROJECT_ID]/envelope/</code></p>
                            </div>
                            <div class="info-panel">
                                <h4>📊 Custom Analytics</h4>
                                <p>Uses the <strong>PostHog SDK</strong> (or raw JSON HTTP). Send any custom event with any properties — button clicks, settings changes, feature flags, purchase flows. All fields are instantly queryable in the Explorer.</p>
                                <p style="margin-top:8px;"><strong>Endpoint:</strong> <code>POST /capture/</code></p>
                            </div>
                        </div>

                        <h3>Step 3 — Verify Events Are Arriving</h3>
                        <p>After integrating your SDK, send a test event and confirm it appears. Run this curl command with your real API key and project ID:</p>
                        <div class="code-box">
                            <div class="code-header"><span>Terminal (cURL)</span><button class="copy-btn" onclick="copyDocsText(this)">Copy</button></div>
                            <pre class="code-content-pre">curl -X POST "http://localhost:3000/api/<span class="active-project">[PROJECT_ID]</span>/store/" \
  -H "Content-Type: application/json" \
  -H "X-Sentry-Auth: Sentry sentry_version=7, sentry_key=<span class="active-key">[API_KEY]</span>" \
  -d '{
    "event_id": "aabbccdd11223344aabbccdd11223344",
    "timestamp": "2026-01-01T12:00:00.000Z",
    "platform": "javascript",
    "level": "error",
    "message": "FortenLog connection test — if you see this, integration works!",
    "exception": {
      "values": [{
        "type": "TestError",
        "value": "Manual test exception from Quick Start guide",
        "mechanism": { "handled": false }
      }]
    }
  }'</pre>
                        </div>
                        <p>Then open <strong>Issues</strong> in the sidebar. Your test error should appear immediately. If it doesn't, check:</p>
                        <ul>
                            <li>The server is running and accessible on port 3000</li>
                            <li>Your API key is correct and belongs to the project ID you used</li>
                            <li>The <code>X-Sentry-Auth</code> header is well-formed (no extra spaces)</li>
                            <li>Check the Audit Log under Settings for any ingestion errors</li>
                        </ul>

                        <h3>Step 4 — Send an Analytics Event</h3>
                        <div class="code-box">
                            <div class="code-header"><span>Terminal (cURL)</span><button class="copy-btn" onclick="copyDocsText(this)">Copy</button></div>
                            <pre class="code-content-pre">curl -X POST "http://localhost:3000/capture/" \
  -H "Content-Type: application/json" \
  -d '{
    "api_key": "<span class="active-key">[API_KEY]</span>",
    "event": "app_started",
    "properties": {
      "distinct_id": "test_user_001",
      "project": "<span class="active-project">[PROJECT_ID]</span>",
      "version": "1.0.0",
      "platform": "desktop"
    }
  }'</pre>
                        </div>
                        <p>Open <strong>Explorer</strong> in the sidebar and search for <code>app_started</code>. The event will appear in the list with all properties visible in the detail panel.</p>

                        <h3>Step 5 — Next Steps</h3>
                        <ul>
                            <li>Read <strong>Using the Interface</strong> to learn how to read dashboards, triage issues, and filter events</li>
                            <li>Pick your platform in the sidebar for a full SDK integration guide</li>
                            <li>Set up <strong>Uptime Monitors</strong> to get alerted when your services go down</li>
                            <li>Configure <strong>SMTP or Webhooks</strong> under Settings for team notifications</li>
                        </ul>
                    </div>

                    <!-- DSN & OVERVIEW -->
                    <div class="doc-section" id="doc-overview">
                        <h2>
                            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/></svg>
                            DSN &amp; API Reference
                        </h2>
                        <p class="section-lead">FortenLog exposes two fully compatible ingestion surfaces — a Sentry Envelope endpoint for error tracking and a PostHog-compatible endpoint for custom analytics. Both authenticate via a project API key.</p>

                        <div class="dsn-interactive-container">
                            <div class="dsn-interactive-title">Your Project DSN — select a project to auto-fill all code examples:</div>
                            <div style="display:flex; align-items:center; gap:12px; margin-top:10px; flex-wrap:wrap;">
                                <select id="docs-project-selector" class="dsn-select"></select>
                                <div style="display:flex; align-items:center; gap:10px; background:rgba(0,0,0,0.25); padding:8px 14px; border-radius:6px; flex-grow:1; border:1px solid var(--border); min-width:0;">
                                    <div id="docs-dsn-display" style="font-family:monospace; font-size:12px; overflow-x:auto; white-space:nowrap; flex-grow:1; min-width:0; padding-bottom:2px; color:var(--text);">
                                        http://[API_KEY]@localhost:3000/[PROJECT_ID]
                                    </div>
                                    <button class="copy-btn" onclick="copyDsnText(this)" style="flex-shrink:0;">Copy</button>
                                </div>
                            </div>
                        </div>

                        <h3>Ingestion Endpoints</h3>
                        <table class="param-table">
                            <thead>
                                <tr><th style="width:90px">Method</th><th style="width:280px">Endpoint</th><th>Description</th></tr>
                            </thead>
                            <tbody>
                                <tr>
                                    <td><span class="badge-method post">POST</span></td>
                                    <td><code>/api/:project_id/envelope/</code></td>
                                    <td>Sentry Envelope ingestion. Handles errors, performance transactions, breadcrumbs, and session replays. Used by all Sentry-compatible SDKs.</td>
                                </tr>
                                <tr>
                                    <td><span class="badge-method post">POST</span></td>
                                    <td><code>/api/:project_id/store/</code></td>
                                    <td>Legacy Sentry JSON event ingestion. Accepts the older <code>X-Sentry-Auth</code> header format. Works for direct JSON payloads without envelope wrapping.</td>
                                </tr>
                                <tr>
                                    <td><span class="badge-method post">POST</span></td>
                                    <td><code>/capture/</code></td>
                                    <td>PostHog-compatible analytics capture. Accepts single events or batched payloads. Authenticate via <code>api_key</code> field in JSON body.</td>
                                </tr>
                                <tr>
                                    <td><span class="badge-method post">POST</span></td>
                                    <td><code>/batch/</code></td>
                                    <td>PostHog batch ingestion. Submit an array of events in one HTTP request for lower overhead in high-volume scenarios.</td>
                                </tr>
                                <tr>
                                    <td><span class="badge-method get">GET</span></td>
                                    <td><code>/api/decide/</code></td>
                                    <td>PostHog SDK feature flags endpoint. Returns an empty feature flags response so SDK initialization succeeds without errors.</td>
                                </tr>
                            </tbody>
                        </table>

                        <h3>Authentication</h3>
                        <div class="info-grid">
                            <div class="info-panel">
                                <h4>Sentry SDK (Envelope)</h4>
                                <p>Pass the API key in the <code>X-Sentry-Auth</code> header or as a <code>sentry_key</code> query parameter. The project is identified by the URL path segment <code>/api/:project_id/</code>.</p>
                                <p style="margin-top:8px; font-family:monospace; font-size:11px; color:var(--accent);">X-Sentry-Auth: Sentry sentry_version=7, sentry_key=fl_abc123</p>
                            </div>
                            <div class="info-panel">
                                <h4>PostHog SDK (Capture)</h4>
                                <p>Pass the API key as <code>api_key</code> field inside the JSON body, or as <code>token</code> in properties. The project is resolved automatically from the API key.</p>
                                <p style="margin-top:8px; font-family:monospace; font-size:11px; color:var(--accent);">{ "api_key": "fl_abc123", "event": "..." }</p>
                            </div>
                        </div>

                        <h3>Rate Limits</h3>
                        <p>FortenLog enforces per-IP and per-project rate limits to protect database performance:</p>
                        <table class="param-table">
                            <thead><tr><th>Scope</th><th>Window</th><th>Limit</th></tr></thead>
                            <tbody>
                                <tr><td>Per IP address</td><td>60 seconds</td><td>100 requests</td></tr>
                                <tr><td>Per project + IP</td><td>10 minutes</td><td>5 events, 200 KB total</td></tr>
                                <tr><td>Per project + IP</td><td>24 hours</td><td>10 events</td></tr>
                            </tbody>
                        </table>
                        <p>Exceeding any limit returns <code>429 Too Many Requests</code>. In Stealth Mode, the server always responds <code>200 OK</code> regardless.</p>

                        <h3>Test Your Connection (cURL)</h3>
                        <h4>Send a test error event:</h4>
                        <div class="code-box">
                            <div class="code-header"><span>Terminal (cURL)</span><button class="copy-btn" onclick="copyDocsText(this)">Copy</button></div>
                            <pre class="code-content-pre">curl -X POST "http://localhost:3000/api/<span class="active-project">[PROJECT_ID]</span>/store/" \
  -H "Content-Type: application/json" \
  -H "X-Sentry-Auth: Sentry sentry_version=7, sentry_key=<span class="active-key">[API_KEY]</span>" \
  -d '{
    "event_id": "fc523a54b38d4f4ca134df021b330bb1",
    "timestamp": "2026-05-17T20:40:00.000Z",
    "platform": "javascript",
    "level": "error",
    "message": "Test exception from terminal",
    "exception": {
      "values": [{
        "type": "ManualTestError",
        "value": "Database operation failed during curl test",
        "mechanism": { "handled": false }
      }]
    }
  }'</pre>
                        </div>

                        <h4>Send a custom analytics event:</h4>
                        <div class="code-box">
                            <div class="code-header"><span>Terminal (cURL)</span><button class="copy-btn" onclick="copyDocsText(this)">Copy</button></div>
                            <pre class="code-content-pre">curl -X POST "http://localhost:3000/capture/" \
  -H "Content-Type: application/json" \
  -d '{
    "api_key": "<span class="active-key">[API_KEY]</span>",
    "event": "user_dashboard_viewed",
    "properties": {
      "distinct_id": "terminal_test_user",
      "project": "<span class="active-project">[PROJECT_ID]</span>",
      "session_duration_sec": 128,
      "active_tab": "overview"
    }
  }'</pre>
                        </div>
                    </div>

                    <!-- REST API v1 -->
                    <div class="doc-section" id="doc-rest-api">
                        <h2>
                            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#fdcb6e" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="min-width:16px"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>
                            REST API v1
                        </h2>
                        <p class="section-lead">FortenLog provides a comprehensive programmatic API to query telemetry, issues, analytics, and uptime data. All endpoints require a Bearer token.</p>
                        
                        <h3>Authentication</h3>
                        <p>All <code>/v1/</code> endpoints require an API Key. Keys are passed via the standard <code>Authorization</code> header:</p>
                        <div class="code-box">
                            <pre class="code-content-pre">Authorization: Bearer flpat_1234567890abcdef...</pre>
                        </div>
                        <p>You can create API keys in the FortenLog Dashboard under <strong>Settings &gt; API Keys</strong> (requires admin privileges).</p>
                        
                        <h3>1. System &amp; Projects</h3>
                        <table class="param-table">
                            <thead><tr><th style="width:90px">Method</th><th>Endpoint</th><th>Description</th></tr></thead>
                            <tbody>
                                <tr><td><span class="badge-method get">GET</span></td><td><code>/v1/system</code></td><td>System metadata and list of accessible projects.</td></tr>
                                <tr><td><span class="badge-method get">GET</span></td><td><code>/v1/projects</code></td><td>List all projects accessible by this key (needs <code>stats:read</code>).</td></tr>
                            </tbody>
                        </table>

                        <h3>2. Issues</h3>
                        <p>Requires the <code>issues:read</code> scope.</p>
                        <table class="param-table">
                            <thead><tr><th style="width:90px">Method</th><th>Endpoint</th><th>Description</th></tr></thead>
                            <tbody>
                                <tr><td><span class="badge-method get">GET</span></td><td><code>/v1/projects/:project_id/issues</code></td><td>List issues for a specific project. Params: <code>limit</code>, <code>offset</code>, <code>status</code>, <code>q</code>, <code>sort</code>.</td></tr>
                                <tr><td><span class="badge-method get">GET</span></td><td><code>/v1/projects/:project_id/issues/:issue_id</code></td><td>Get detailed information for a specific issue.</td></tr>
                            </tbody>
                        </table>

                        <h3>3. Events</h3>
                        <p>Requires the <code>events:read</code> scope.</p>
                        <table class="param-table">
                            <thead><tr><th style="width:90px">Method</th><th>Endpoint</th><th>Description</th></tr></thead>
                            <tbody>
                                <tr><td><span class="badge-method get">GET</span></td><td><code>/v1/projects/:project_id/events</code></td><td>List raw events within a project. Params: <code>limit</code>, <code>event_type</code>, <code>since</code>, <code>until</code>.</td></tr>
                                <tr><td><span class="badge-method get">GET</span></td><td><code>/v1/projects/:project_id/issues/:issue_id/events</code></td><td>List all events belonging to a specific issue.</td></tr>
                                <tr><td><span class="badge-method get">GET</span></td><td><code>/v1/projects/:project_id/issues/:issue_id/events/:event_id</code></td><td>Get full details of a specific event (including raw payload).</td></tr>
                            </tbody>
                        </table>

                        <h3>4. Analytics &amp; Stats</h3>
                        <p>Requires the <code>stats:read</code> scope.</p>
                        <table class="param-table">
                            <thead><tr><th style="width:90px">Method</th><th>Endpoint</th><th>Description</th></tr></thead>
                            <tbody>
                                <tr><td><span class="badge-method get">GET</span></td><td><code>/v1/projects/:project_id/stats</code></td><td>Aggregated statistics for the project (OS, browsers, top issues).</td></tr>
                                <tr><td><span class="badge-method get">GET</span></td><td><code>/v1/projects/:project_id/analytics</code></td><td>Timeseries data and custom analytics. Params: <code>since</code>, <code>until</code>, <code>granularity</code>.</td></tr>
                                <tr><td><span class="badge-method get">GET</span></td><td><code>/v1/projects/:project_id/sessions</code></td><td>List session and crash rate data.</td></tr>
                            </tbody>
                        </table>

                        <h3>5. Uptime Monitoring</h3>
                        <p>Requires the <code>uptime:read</code> scope.</p>
                        <table class="param-table">
                            <thead><tr><th style="width:90px">Method</th><th>Endpoint</th><th>Description</th></tr></thead>
                            <tbody>
                                <tr><td><span class="badge-method get">GET</span></td><td><code>/v1/projects/:project_id/uptime</code></td><td>List all uptime monitors and current status.</td></tr>
                                <tr><td><span class="badge-method get">GET</span></td><td><code>/v1/projects/:project_id/uptime/:monitor_id/logs</code></td><td>List recent ping logs for a monitor.</td></tr>
                            </tbody>
                        </table>
                    </div>

                    <!-- UI GUIDE -->
                    <div class="doc-section" id="doc-ui-guide">
                        <h2>
                            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#74b9ff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>
                            Using the Interface
                        </h2>
                        <p class="section-lead">A tour of every screen in FortenLog — what each section shows, how to read the data, and where to look when something goes wrong.</p>

                        <div class="ui-screen-card">
                            <h4>
                                <div class="screen-icon" style="background:rgba(162,122,245,0.1);">📊</div>
                                Dashboard
                            </h4>
                            <p>The main landing page. Shows a system-wide health snapshot across all projects or filtered to a single project.</p>
                            <ul>
                                <li><strong>Stat banners (top row)</strong> — Total events ingested, unresolved issues, resolved issues, and active uptime monitors at a glance.</li>
                                <li><strong>Release Stability chart</strong> — Each bar represents a version tag. Height = error-free session ratio. A bar dropping below your stability threshold (default 98%) turns red and indicates a bad release.</li>
                                <li><strong>OS / Browser / Region panels</strong> — Donut and bar charts showing what environment your users run. Useful for prioritizing platform-specific bugs.</li>
                                <li><strong>Database Quick Actions</strong> — Vacuum and backup buttons in the header trigger maintenance without navigating to Settings.</li>
                            </ul>
                            <div class="callout callout-purple">
                                <strong>How to check if data is flowing in</strong>
                                If the stat banners show zeros after integration, open <strong>Explorer</strong> and search for your test event. If it's there but Dashboard shows zero, wait a few seconds and refresh — the aggregation runs every minute.
                            </div>
                        </div>

                        <div class="ui-screen-card">
                            <h4>
                                <div class="screen-icon" style="background:rgba(231,76,60,0.1);">🐛</div>
                                Issues
                            </h4>
                            <p>All error events grouped by exception type and fingerprint. This is your primary debugging screen.</p>
                            <ul>
                                <li><strong>Issue list</strong> — Each row is a unique error fingerprint. Columns show: exception type, total occurrence count, first-seen and last-seen timestamps, affected user count (based on distinct hardware IDs).</li>
                                <li><strong>Click an issue</strong> — Opens the detail panel with the full normalized stack trace, breadcrumbs, tags, and all occurrences timeline.</li>
                                <li><strong>Stack trace</strong> — Lines from your own code are highlighted. The specific line that caused the crash is marked with a red indicator.</li>
                                <li><strong>Mark as Resolved</strong> — Associates the fix with a specific release version. If the same error arrives from a newer version, it reopens automatically.</li>
                                <li><strong>Suppress</strong> — Stops the issue from appearing in the active list. Stats keep incrementing in the background. Use for known non-critical noise.</li>
                                <li><strong>Delete</strong> — Permanently removes the issue and all its log events from the database.</li>
                            </ul>
                            <div class="callout callout-yellow">
                                <strong>Why is my issue count not incrementing?</strong>
                                FortenLog deduplicates by fingerprint. If the same exception from the same user fires more than 50 times in a session, subsequent occurrences are dropped to prevent spam. To force a new fingerprint, change the exception message or type.
                            </div>
                        </div>

                        <div class="ui-screen-card">
                            <h4>
                                <div class="screen-icon" style="background:rgba(241,196,15,0.1);">🔎</div>
                                Explorer
                            </h4>
                            <p>A raw event browser and full-text query tool. Works across both error events and custom analytics events.</p>
                            <ul>
                                <li><strong>Search bar</strong> — Searches across event names, messages, and all stored properties. Supports partial matches.</li>
                                <li><strong>Filters</strong> — Filter by release version, browser type, operating system, severity level, and environment (production / staging / dev). Filters combine with AND logic.</li>
                                <li><strong>Event detail</strong> — Click any row to see the full raw JSON payload, extracted properties, OS/browser/region metadata, and ingestion timestamp.</li>
                                <li><strong>SQL Console</strong> — A read-only raw SQL panel for power users. Run any SELECT against the project database. Example: <code>SELECT event_type, COUNT(*) FROM events GROUP BY event_type</code></li>
                                <li><strong>CSV Export</strong> — Exports the current filtered view to a structured CSV file for offline analysis or compliance reporting.</li>
                            </ul>
                            <div class="callout callout-green">
                                <strong>Useful SQL queries for the Explorer console</strong>
                                <br>
                                Find most active users: <code>SELECT hwid, COUNT(*) as c FROM events GROUP BY hwid ORDER BY c DESC LIMIT 20</code>
                                <br><br>
                                Count events by type today: <code>SELECT title, COUNT(*) FROM events WHERE timestamp &gt; datetime('now', '-1 day') GROUP BY title ORDER BY 2 DESC</code>
                                <br><br>
                                Find large payloads: <code>SELECT id, title, LENGTH(payload) as size FROM events ORDER BY size DESC LIMIT 10</code>
                            </div>
                        </div>

                        <div class="ui-screen-card">
                            <h4>
                                <div class="screen-icon" style="background:rgba(241,196,15,0.1);">📈</div>
                                Analytics
                            </h4>
                            <p>Aggregated telemetry charts. Powered entirely by the custom analytics events you send via <code>/capture/</code>.</p>
                            <ul>
                                <li><strong>OS Distribution</strong> — Bar chart of all operating systems detected from <code>$os</code> property or SDK auto-capture.</li>
                                <li><strong>Browser Distribution</strong> — Progress bars showing browser share among your user base.</li>
                                <li><strong>World Map</strong> — Geographic origin of events resolved from IP addresses. Hover a country to see event count.</li>
                                <li><strong>Version Health table</strong> — Each row is a release version tag. Shows unique user count, stability percentage, and adoption share. A version is "healthy" when its error-free session ratio exceeds your configured threshold.</li>
                                <li><strong>Custom Event counters</strong> — Bottom grid shows all unique event names sent to <code>/capture/</code> with total occurrence counts.</li>
                            </ul>
                        </div>

                        <div class="ui-screen-card">
                            <h4>
                                <div class="screen-icon" style="background:rgba(231,76,60,0.1);">🟢</div>
                                Uptime Monitors
                            </h4>
                            <p>Automated HTTP health checks that run continuously in the background.</p>
                            <ul>
                                <li><strong>Creating a monitor</strong> — Click "Add Monitor". Enter the full URL (including <code>https://</code>), the expected HTTP status code (usually <code>200</code>), check interval in seconds, and timeout. The monitor starts checking immediately.</li>
                                <li><strong>Status indicators</strong> — Green = last check passed. Red pulsing = last check failed. Yellow = check in progress or degraded.</li>
                                <li><strong>Latency chart</strong> — Interactive RTT graph per monitor. Hover a data point to see exact millisecond latency. Spikes indicate network or server issues.</li>
                                <li><strong>History</strong> — Each row in the history table shows check time, response code, and latency. Scroll down to see historical patterns.</li>
                                <li><strong>Alerts</strong> — Configure SMTP or webhook notifications in Settings. You will be notified the moment a monitor status changes from UP to DOWN.</li>
                            </ul>
                        </div>

                        <div class="ui-screen-card">
                            <h4>
                                <div class="screen-icon" style="background:rgba(46,204,113,0.1);">⚙️</div>
                                Settings
                            </h4>
                            <p>Admin panel for security, notifications, and system maintenance.</p>
                            <ul>
                                <li><strong>Password</strong> — Change the master admin password. Uses Argon2id hashing with high memory parameters. Cannot be reset without server access.</li>
                                <li><strong>Two-Factor Auth (TOTP)</strong> — Scan the QR code with an authenticator app. Recovery codes are single-use and should be stored securely. If you lose both, you must reset via the server filesystem.</li>
                                <li><strong>Passkeys (WebAuthn)</strong> — Register biometric keys (Windows Hello, Touch ID, YubiKey). Once registered, you can log in without a password.</li>
                                <li><strong>SMTP</strong> — Configure email relay for uptime alert notifications. Test the connection before saving.</li>
                                <li><strong>Webhooks</strong> — Paste a Slack or Discord webhook URL. FortenLog will POST a formatted alert payload on uptime failures.</li>
                                <li><strong>Stealth Mode</strong> — When enabled, the ingestion server always responds <code>200 OK</code> regardless of authentication state. This prevents external scanning tools from fingerprinting your installation.</li>
                                <li><strong>Audit Log</strong> — A tamper-proof chronological log of all administrative actions. Cannot be deleted from the UI.</li>
                            </ul>
                        </div>
                    </div>

                    <!-- CUSTOM ANALYTICS -->
                    <div class="doc-section" id="doc-analytics">
                        <h2><span>📊</span> Custom Analytics Ingestion</h2>
                        <p class="section-lead">FortenLog accepts fully schemaless event analytics compatible with the PostHog protocol. Send any properties — strings, numbers, booleans, nested objects — and they are indexed and queryable instantly in the Event Explorer.</p>

                        <div class="info-grid">
                            <div class="info-panel">
                                <h4>Schemaless Properties</h4>
                                <p>Every field inside <code>properties</code> is stored as flat key-value pairs in SQLite. No schema migration required. Add new fields anytime and they appear immediately in Explorer search results.</p>
                            </div>
                            <div class="info-panel">
                                <h4>SDK Autocapture</h4>
                                <p>Using <code>posthog-js</code> with <code>autocapture: true</code> automatically records pageviews, element clicks, form submissions, and standard properties like <code>$screen_height</code>, <code>$browser</code>, <code>$os</code>, <code>$current_url</code>.</p>
                            </div>
                        </div>

                        <h3>Capture API Schema</h3>
                        <p>Endpoint: <code>POST /capture/</code></p>
                        <table class="param-table">
                            <thead><tr><th style="width:150px">Field</th><th style="width:90px">Type</th><th style="width:90px">Required</th><th>Description</th></tr></thead>
                            <tbody>
                                <tr><td><code>api_key</code></td><td>String</td><td>✅ Yes</td><td>Your project API key (e.g. <code>fl_04182...</code>)</td></tr>
                                <tr><td><code>event</code></td><td>String</td><td>✅ Yes</td><td>Unique event name. Use snake_case convention: <code>button_click</code>, <code>checkout_failed</code>, <code>user_signed_up</code></td></tr>
                                <tr><td><code>properties</code></td><td>Object</td><td>✅ Yes</td><td>Dictionary of any key-value pairs. <strong>Must include <code>distinct_id</code></strong> to identify the user session.</td></tr>
                                <tr><td><code>timestamp</code></td><td>String</td><td>No</td><td>ISO 8601 timestamp. Defaults to server time. Events timestamped more than 24 hours in the future or past are normalized to server time.</td></tr>
                            </tbody>
                        </table>

                        <h3>Standard Properties</h3>
                        <p>These properties are recognized and indexed specially by the server:</p>
                        <table class="param-table">
                            <thead><tr><th>Property</th><th>Description</th></tr></thead>
                            <tbody>
                                <tr><td><code>distinct_id</code></td><td>Unique user/device identifier. Required. Used for user counts in Analytics.</td></tr>
                                <tr><td><code>$os</code></td><td>Operating system string. Will be normalized (e.g. "Windows 10" → "Windows").</td></tr>
                                <tr><td><code>$browser</code></td><td>Browser name. Shown in the Browser Distribution chart.</td></tr>
                                <tr><td><code>$release</code></td><td>App version string. Used in Release Health and Version Health tables.</td></tr>
                                <tr><td><code>$environment</code></td><td>Deployment environment. Used as a filter in Explorer. E.g. <code>production</code>, <code>staging</code>.</td></tr>
                            </tbody>
                        </table>

                        <h4>Browser (posthog-js)</h4>
                        <div class="code-box">
                            <div class="code-header"><span>JavaScript</span><button class="copy-btn" onclick="copyDocsText(this)">Copy</button></div>
                            <pre class="code-content-pre">import posthog from 'posthog-js';

posthog.init('<span class="active-key">[API_KEY]</span>', {
    api_host: 'http://localhost:3000',
    autocapture: true,  // captures clicks, pageviews, form submits automatically
    capture_pageview: true,
    persistence: 'localStorage',
});

// Track a custom event with arbitrary properties
posthog.capture('purchase_completed', {
    plan: 'pro',
    price_usd: 29.99,
    coupon_applied: true,
    checkout_duration_ms: 3420,
});

// Identify a user for cross-session tracking
posthog.identify('user_id_123', {
    email: 'user@example.com',
    name: 'John Doe',
    plan: 'pro',
});</pre>
                        </div>

                        <h4>Server-Side (posthog-node)</h4>
                        <div class="code-box">
                            <div class="code-header"><span>Node.js</span><button class="copy-btn" onclick="copyDocsText(this)">Copy</button></div>
                            <pre class="code-content-pre">const { PostHog } = require('posthog-node');

const client = new PostHog('<span class="active-key">[API_KEY]</span>', {
    host: 'http://localhost:3000',
    flushAt: 20,    // batch size before auto-flush
    flushInterval: 10000,  // flush every 10s
});

// Capture a server-side event
client.capture({
    distinctId: 'user_id_123',
    event: 'api_request_processed',
    properties: {
        endpoint: '/api/checkout',
        method: 'POST',
        duration_ms: 142,
        status_code: 200,
        $release: '2.4.1',
        $environment: 'production',
    }
});

// Always shut down cleanly to flush remaining events
await client.shutdown();</pre>
                        </div>

                        <h4>Raw HTTP (any platform)</h4>
                        <div class="code-box">
                            <div class="code-header"><span>Terminal (cURL)</span><button class="copy-btn" onclick="copyDocsText(this)">Copy</button></div>
                            <pre class="code-content-pre">curl -X POST "http://localhost:3000/capture/" \
  -H "Content-Type: application/json" \
  -d '{
    "api_key": "<span class="active-key">[API_KEY]</span>",
    "event": "build_completed",
    "properties": {
      "distinct_id": "ci_runner_42",
      "project": "<span class="active-project">[PROJECT_ID]</span>",
      "$release": "3.0.0",
      "$environment": "ci",
      "duration_sec": 87.4,
      "warnings": 0,
      "tests_passed": 412
    }
  }'</pre>
                        </div>
                    </div>

                    <!-- NODE.JS / NEXT.JS -->
                    <div class="doc-section" id="doc-nextjs">
                        <h2>
                            <svg width="22" height="22" viewBox="0 0 24 24" fill="#339933" style="margin-right:8px;display:inline-block;vertical-align:middle;"><path d="M12 24c-.2 0-.4 0-.5-.1L3.1 19c-.4-.2-.6-.6-.6-1V8.1c0-.4.2-.8.6-1L11.5.2c.3-.2.7-.2 1 0l8.3 4.9c.4.2.6.6.6 1v9.9c0 .4-.2.8-.6 1l-8.3 4.9c-.1.1-.3.1-.5.1zM4.1 17.5l7.9 4.6 7.9-4.6V8.6l-7.9-4.6-7.9 4.6v8.9z"/></svg>
                            Node.js &amp; Next.js Integration
                        </h2>
                        <p class="section-lead">Full error tracking and custom analytics for Node.js backends, Next.js API routes, Express servers, and client-side React applications.</p>

                        <div class="callout callout-purple">
                            <strong>🛡️ PART A: Error &amp; Crash Tracking (Sentry SDK)</strong>
                            Capture unhandled promise rejections, Express middleware exceptions, and manual error reporting with full stack traces.
                        </div>

                        <h4>1. Install the Sentry Node SDK</h4>
                        <div class="code-box">
                            <div class="code-header"><span>Terminal</span><button class="copy-btn" onclick="copyDocsText(this)">Copy</button></div>
                            <pre class="code-content-pre">npm install --save @sentry/node
# For Next.js specifically:
npm install --save @sentry/nextjs</pre>
                        </div>

                        <h4>2. Initialize Sentry (Node.js / Express)</h4>
                        <div class="callout callout-yellow">
                            <strong>⚠️ DSN Quirk</strong>
                            The Sentry SDK validates that the project ID in the DSN is numeric. Since FortenLog uses text slugs, use <code>/1</code> as a fake numeric ID in the <code>dsn</code> field, and pass the real project URL to the <code>tunnel</code> option. The SDK will route all traffic through the tunnel, bypassing DSN validation entirely.
                        </div>
                        <div class="code-box">
                            <div class="code-header"><span>JavaScript (server entry point)</span><button class="copy-btn" onclick="copyDocsText(this)">Copy</button></div>
                            <pre class="code-content-pre">import * as Sentry from "@sentry/node";

Sentry.init({
    dsn: "http://<span class="active-key">[API_KEY]</span>@localhost:3000/1",
    tunnel: "http://localhost:3000/api/<span class="active-project">[PROJECT_ID]</span>/envelope/?sentry_key=<span class="active-key">[API_KEY]</span>",
    tracesSampleRate: 1.0,      // capture 100% of transactions (lower in production)
    environment: "production",
    release: "my-app@1.0.0",    // shown in Release Health
    beforeSend(event) {
        // Optionally modify or filter events before sending
        return event;
    }
});</pre>
                        </div>

                        <h4>3. Catch and Log Exceptions</h4>
                        <div class="code-box">
                            <div class="code-header"><span>JavaScript</span><button class="copy-btn" onclick="copyDocsText(this)">Copy</button></div>
                            <pre class="code-content-pre">// Manual exception capture with context
try {
    await db.query("SELECT * FROM users WHERE id = ?", [userId]);
} catch (error) {
    Sentry.captureException(error, {
        tags: {
            layer: "database",
            operation: "getUserById",
        },
        extra: {
            userId,
            query: "SELECT * FROM users",
        },
        user: { id: userId },
    });
}

// Capture a custom message (non-exception)
Sentry.captureMessage("Payment gateway returned unexpected status", "warning");

// Add breadcrumbs to trace user journey before a crash
Sentry.addBreadcrumb({
    category: "auth",
    message: "User attempted login",
    level: "info",
    data: { method: "password" },
});</pre>
                        </div>

                        <h4>4. Express Error Handler Middleware</h4>
                        <div class="code-box">
                            <div class="code-header"><span>Express.js</span><button class="copy-btn" onclick="copyDocsText(this)">Copy</button></div>
                            <pre class="code-content-pre">import express from "express";
import * as Sentry from "@sentry/node";

const app = express();

// Sentry request handler — MUST be before all routes
app.use(Sentry.Handlers.requestHandler());

app.get("/", (req, res) => res.send("OK"));

// Sentry error handler — MUST be before any other error middleware
app.use(Sentry.Handlers.errorHandler());

// Your fallback error handler
app.use((err, req, res, next) => {
    res.status(500).json({ error: "Internal Server Error" });
});

app.listen(4000);</pre>
                        </div>

                        <div class="doc-divider"></div>
                        <div class="callout callout-yellow">
                            <strong>📊 PART B: Custom Analytics (PostHog SDK)</strong>
                            Track user flows, button interactions, configuration changes, and any custom events from Node.js or React.
                        </div>

                        <h4>1. Install PostHog Node library</h4>
                        <div class="code-box">
                            <div class="code-header"><span>Terminal</span><button class="copy-btn" onclick="copyDocsText(this)">Copy</button></div>
                            <pre class="code-content-pre">npm install --save posthog-node
# For browser/React:
npm install --save posthog-js</pre>
                        </div>

                        <h4>2. Track Backend Events</h4>
                        <div class="code-box">
                            <div class="code-header"><span>Node.js</span><button class="copy-btn" onclick="copyDocsText(this)">Copy</button></div>
                            <pre class="code-content-pre">const { PostHog } = require('posthog-node');

const analytics = new PostHog('<span class="active-key">[API_KEY]</span>', {
    host: 'http://localhost:3000',
});

// Track a settings change
analytics.capture({
    distinctId: 'user_session_881a',
    event: 'settings_updated',
    properties: {
        theme: 'dark',
        language: 'en',
        notifications_enabled: true,
        $release: '2.4.0',
        $environment: 'production',
    }
});

// Batch multiple events (lower network overhead)
await analytics.shutdown(); // flushes all pending events</pre>
                        </div>
                    </div>

                    <!-- ELECTRON -->
                    <div class="doc-section" id="doc-electron">
                        <h2>
                            <svg width="22" height="22" viewBox="0 0 24 24" fill="#9FEAF9" stroke="#9FEAF9" stroke-width="1.5" style="margin-right:8px;display:inline-block;vertical-align:middle;"><circle cx="12" cy="12" r="3" fill="#9FEAF9"/><ellipse cx="12" cy="12" rx="10" ry="4" transform="rotate(30 12 12)" fill="none"/><ellipse cx="12" cy="12" rx="10" ry="4" transform="rotate(90 12 12)" fill="none"/><ellipse cx="12" cy="12" rx="10" ry="4" transform="rotate(150 12 12)" fill="none"/></svg>
                            Electron Integration
                        </h2>
                        <p class="section-lead">Capture main process crashes, renderer exceptions, and desktop user interactions in Electron apps. FortenLog works in both the main and renderer processes simultaneously.</p>

                        <div class="callout callout-purple">
                            <strong>🛡️ PART A: Error Tracking (Sentry Electron SDK)</strong>
                            Automatically intercepts uncaught exceptions in the main process and renderer crashes. Also captures native crash dumps.
                        </div>

                        <h4>1. Install the Sentry Electron SDK</h4>
                        <div class="code-box">
                            <div class="code-header"><span>Terminal</span><button class="copy-btn" onclick="copyDocsText(this)">Copy</button></div>
                            <pre class="code-content-pre">npm install --save @sentry/electron</pre>
                        </div>

                        <h4>2. Initialize in the Main Process (main.js)</h4>
                        <div class="code-box">
                            <div class="code-header"><span>main.js</span><button class="copy-btn" onclick="copyDocsText(this)">Copy</button></div>
                            <pre class="code-content-pre">const { init, captureException } = require("@sentry/electron/main");

init({
    dsn: "http://<span class="active-key">[API_KEY]</span>@localhost:3000/1",
    tunnel: "http://localhost:3000/api/<span class="active-project">[PROJECT_ID]</span>/envelope/?sentry_key=<span class="active-key">[API_KEY]</span>",
    environment: "production",
    release: app.getVersion(),
    onFatalError: (error) => {
        // Called on unrecoverable crashes before the process exits
        console.error("Fatal crash intercepted:", error.message);
    }
});

// Manual capture in main process
try {
    // risky operation
} catch (e) {
    captureException(e, { tags: { process: "main" } });
}</pre>
                        </div>

                        <h4>3. Initialize in the Renderer Process (preload.js or renderer.js)</h4>
                        <div class="code-box">
                            <div class="code-header"><span>renderer.js</span><button class="copy-btn" onclick="copyDocsText(this)">Copy</button></div>
                            <pre class="code-content-pre">const { init } = require("@sentry/electron/renderer");

init({
    dsn: "http://<span class="active-key">[API_KEY]</span>@localhost:3000/1",
    tunnel: "http://localhost:3000/api/<span class="active-project">[PROJECT_ID]</span>/envelope/?sentry_key=<span class="active-key">[API_KEY]</span>",
});

// Global error handler
window.addEventListener('unhandledrejection', (event) => {
    console.error('Unhandled promise rejection captured by Sentry:', event.reason);
});</pre>
                        </div>

                        <div class="doc-divider"></div>
                        <div class="callout callout-yellow">
                            <strong>📊 PART B: Desktop Analytics (PostHog)</strong>
                            Track UI interactions, hardware config, feature usage patterns from the renderer process.
                        </div>

                        <h4>Track Desktop UI Events</h4>
                        <div class="code-box">
                            <div class="code-header"><span>renderer.js</span><button class="copy-btn" onclick="copyDocsText(this)">Copy</button></div>
                            <pre class="code-content-pre">const { PostHog } = require('posthog-node');

const analytics = new PostHog('<span class="active-key">[API_KEY]</span>', {
    host: 'http://localhost:3000',
});

// Track when user saves application settings
analytics.capture({
    distinctId: require('electron').ipcRenderer.sendSync('get-machine-id'),
    event: 'settings_saved',
    properties: {
        theme: 'dark',
        window_scale: '125%',
        hardware_acceleration: true,
        audio_device: 'Default',
        $release: require('electron').remote.app.getVersion(),
    }
});</pre>
                        </div>
                    </div>

                    <!-- PYTHON -->
                    <div class="doc-section" id="doc-python">
                        <h2>
                            <svg width="22" height="22" viewBox="0 0 110 110" style="margin-right:8px;display:inline-block;vertical-align:middle;"><path d="M54 2C32.3 2 33.7 11.2 33.7 11.2l.1 10.3h20.6v3c0 1.8-1.4 3.2-3.2 3.2H25.4c-9 0-15.6 6.3-15.6 15.6v12.2c0 9.3 7.6 14.8 14.8 14.8h8.8v-12c0-5 4-9 9-9h20.6c5 0 9-4 9-9V21.8c0-5-4-9-9-9H54.2c-5 0-9 4.2-9 9.3l.1.5v-.1z" fill="#3776AB"/><path d="M56 108c21.7 0 20.3-9.2 20.3-9.2l-.1-10.3H55.6v-3c0-1.8 1.4-3.2 3.2-3.2h25.8c9 0 15.6-6.3 15.6-15.6V54.5c0-9.3-7.6-14.8-14.8-14.8h-8.8v12c0 5-4 9-9 9H66.6c-5 0-9 4-9 9v20.4c0 5 4 9 9 9h20.6c5 0 9-4.2 9-9.3l-.1-.5v.1z" fill="#FFE873"/><circle cx="43.5" cy="18.5" r="4.5" fill="#fff"/><circle cx="66.5" cy="91.5" r="4.5" fill="#111"/></svg>
                            Python Integration
                        </h2>
                        <p class="section-lead">Capture runtime exceptions, trace backend worker performance, and send custom analytics from Django, Flask, FastAPI, or any Python script.</p>

                        <div class="callout callout-purple">
                            <strong>🛡️ PART A: Error Tracking (sentry-sdk)</strong>
                            Automatic integration with Django, Flask, FastAPI, Celery, SQLAlchemy, and more via integration plugins.
                        </div>

                        <h4>1. Install sentry-sdk</h4>
                        <div class="code-box">
                            <div class="code-header"><span>Terminal</span><button class="copy-btn" onclick="copyDocsText(this)">Copy</button></div>
                            <pre class="code-content-pre">pip install --upgrade sentry-sdk

# With framework integrations:
pip install "sentry-sdk[django]"
pip install "sentry-sdk[flask]"
pip install "sentry-sdk[fastapi]"</pre>
                        </div>

                        <h4>2. Initialize Sentry</h4>
                        <div class="code-box">
                            <div class="code-header"><span>Python</span><button class="copy-btn" onclick="copyDocsText(this)">Copy</button></div>
                            <pre class="code-content-pre">import sentry_sdk
from sentry_sdk.integrations.django import DjangoIntegration  # or FlaskIntegration, etc.

sentry_sdk.init(
    dsn="http://<span class="active-key">[API_KEY]</span>@localhost:3000/1",
    tunnel="http://localhost:3000/api/<span class="active-project">[PROJECT_ID]</span>/envelope/?sentry_key=<span class="active-key">[API_KEY]</span>",
    integrations=[
        DjangoIntegration(transaction_style="url"),
    ],
    traces_sample_rate=1.0,
    environment="production",
    release="my-app@1.0.0",
    send_default_pii=True,  # includes request data in error reports
)</pre>
                        </div>

                        <h4>3. Capture Exceptions with Context</h4>
                        <div class="code-box">
                            <div class="code-header"><span>Python</span><button class="copy-btn" onclick="copyDocsText(this)">Copy</button></div>
                            <pre class="code-content-pre">import sentry_sdk

try:
    result = risky_database_call()
except Exception as e:
    with sentry_sdk.push_scope() as scope:
        scope.set_tag("component", "database")
        scope.set_tag("operation", "read_user")
        scope.set_context("db_info", {
            "pool_size": 20,
            "active_connections": 19,
            "query": "SELECT * FROM users WHERE id = ?",
        })
        scope.set_user({"id": user_id, "email": user_email})
        sentry_sdk.capture_exception(e)

# Capture a manual message
sentry_sdk.capture_message("Scheduled job skipped due to lock timeout", level="warning")</pre>
                        </div>

                        <div class="doc-divider"></div>
                        <div class="callout callout-yellow">
                            <strong>📊 PART B: Custom Analytics (posthog)</strong>
                            Track backend events, job completions, configuration changes, and user actions via the PostHog Python library.
                        </div>

                        <h4>1. Install PostHog Python library</h4>
                        <div class="code-box">
                            <div class="code-header"><span>Terminal</span><button class="copy-btn" onclick="copyDocsText(this)">Copy</button></div>
                            <pre class="code-content-pre">pip install posthog</pre>
                        </div>

                        <h4>2. Track Events</h4>
                        <div class="code-box">
                            <div class="code-header"><span>Python</span><button class="copy-btn" onclick="copyDocsText(this)">Copy</button></div>
                            <pre class="code-content-pre">from posthog import Posthog

posthog = Posthog(
    project_api_key='<span class="active-key">[API_KEY]</span>',
    host='http://localhost:3000'
)

# Track a user action
posthog.capture(
    distinct_id='user_77a',
    event='export_completed',
    properties={
        'format': 'csv',
        'row_count': 15420,
        'duration_ms': 840,
        '$release': '2.4.0',
        '$environment': 'production',
    }
)

# Or use raw HTTP (no extra dependency)
import urllib.request, json

payload = json.dumps({
    "api_key": "<span class="active-key">[API_KEY]</span>",
    "event": "script_finished",
    "properties": {
        "distinct_id": "cron_worker_01",
        "duration_sec": 14.2,
        "records_processed": 5000,
    }
}).encode()

urllib.request.urlopen(
    urllib.request.Request(
        "http://localhost:3000/capture/",
        data=payload,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
)</pre>
                        </div>
                    </div>

                    <!-- JAVA -->
                    <div class="doc-section" id="doc-java">
                        <h2>
                            <svg width="22" height="22" viewBox="0 0 40 40" style="margin-right:8px;display:inline-block;vertical-align:middle;"><path d="M15.2 2.1c-.8.8-1 1.7-.8 2.6.2.9.8 1.6 1.4 2.2.8.8 1.7 1.4 2.6 2.1 1.2.9 2.5 1.9 3.1 3.4.6 1.4.3 3-.6 4.2-1.4 1.8-3.9 2.5-6.1 2.2.5-.2.9-.6 1.2-1 .5-.7.7-1.6.5-2.5-.2-.9-.7-1.7-1.4-2.3-.9-.9-1.9-1.6-2.9-2.4-1.2-.9-2.5-2-3-3.6-.5-1.5-.2-3.2.8-4.4C11 .8 13.3.1 15.2 2.1z" fill="#EA2D42"/><path d="M22.5 5.5c-.5.6-.7 1.3-.5 2 .2.7.6 1.2 1 1.7.6.6 1.3 1.1 2 1.6.9.7 1.9 1.4 2.4 2.6.5 1.1.2 2.3-.5 3.2-1.1 1.4-3 1.9-4.7 1.7.4-.2.7-.5.9-.8.4-.5.5-1.2.4-1.9-.1-.7-.5-1.3-1-1.7-.7-.7-1.5-1.2-2.2-1.8-.9-.7-1.9-1.5-2.3-2.7-.4-1.1-.2-2.4.6-3.3 1.1-1.4 3-1.9 4.7-1.7z" fill="#F0931B"/><path d="M4 23.5c0 1.5 1.2 2.7 2.7 2.7H25c1.5 0 2.7-1.2 2.7-2.7v-7.5H4v7.5zm25.5-5.5H27v4h2.5c.8 0 1.5-.7 1.5-1.5v-1c0-.8-.7-1.5-1.5-1.5z" fill="#5382A1"/><path d="M2 30c0 .6.4 1 1 1h26c.6 0 1-.4 1-1v-1H2v1z" fill="#5382A1"/></svg>
                            Java / Spring Integration
                        </h2>
                        <p class="section-lead">Track JVM exceptions, Spring Boot request failures, database timeouts, and thread deadlocks. Supports Maven and Gradle projects.</p>

                        <div class="callout callout-purple">
                            <strong>🛡️ PART A: Error Tracking (Sentry Java SDK)</strong>
                            Automatic Spring Boot integration captures all unhandled controller exceptions, scheduled task failures, and async errors.
                        </div>

                        <h4>1. Maven — Add Dependency</h4>
                        <div class="code-box">
                            <div class="code-header"><span>pom.xml</span><button class="copy-btn" onclick="copyDocsText(this)">Copy</button></div>
                            <pre class="code-content-pre">&lt;dependency&gt;
    &lt;groupId&gt;io.sentry&lt;/groupId&gt;
    &lt;artifactId&gt;sentry-spring-boot-starter-jakarta&lt;/artifactId&gt;
    &lt;version&gt;7.5.0&lt;/version&gt;
&lt;/dependency&gt;

&lt;!-- Or for plain Java without Spring: --&gt;
&lt;dependency&gt;
    &lt;groupId&gt;io.sentry&lt;/groupId&gt;
    &lt;artifactId&gt;sentry&lt;/artifactId&gt;
    &lt;version&gt;7.5.0&lt;/version&gt;
&lt;/dependency&gt;</pre>
                        </div>

                        <h4>2. Initialize Sentry</h4>
                        <div class="code-box">
                            <div class="code-header"><span>Java</span><button class="copy-btn" onclick="copyDocsText(this)">Copy</button></div>
                            <pre class="code-content-pre">import io.sentry.Sentry;
import io.sentry.SentryOptions;

public class Application {
    public static void main(String[] args) {
        Sentry.init(options -> {
            // Use fake numeric ID in dsn due to SDK validation
            options.setDsn("http://<span class="active-key">[API_KEY]</span>@localhost:3000/1");
            // Actual traffic is routed here:
            options.setBeforeSend((event, hint) -> event); // optional event filter
            options.setTracesSampleRate(1.0);
            options.setEnvironment("production");
            options.setRelease("my-app@1.0.0");
            options.setEnableUncaughtExceptionHandler(true);
        });

        SpringApplication.run(Application.class, args);
    }
}</pre>
                        </div>

                        <h4>3. Capture Exceptions</h4>
                        <div class="code-box">
                            <div class="code-header"><span>Java</span><button class="copy-btn" onclick="copyDocsText(this)">Copy</button></div>
                            <pre class="code-content-pre">import io.sentry.Sentry;

try {
    paymentGateway.processTransaction(orderId, amount);
} catch (PaymentException e) {
    Sentry.withScope(scope -> {
        scope.setTag("module", "payments");
        scope.setTag("currency", "USD");
        scope.setExtra("orderId", orderId);
        scope.setExtra("amount", amount);
        scope.setUser(new io.sentry.protocol.User() {{ setId(userId); }});
        Sentry.captureException(e);
    });
}</pre>
                        </div>

                        <div class="doc-divider"></div>
                        <div class="callout callout-yellow">
                            <strong>📊 PART B: Custom Analytics (HTTP Client)</strong>
                            No PostHog Java SDK needed — send events directly via the standard Java HTTP client.
                        </div>

                        <h4>Analytics Client</h4>
                        <div class="code-box">
                            <div class="code-header"><span>Java (HTTP Client)</span><button class="copy-btn" onclick="copyDocsText(this)">Copy</button></div>
                            <pre class="code-content-pre">import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;

public class FortenAnalytics {
    private static final HttpClient client = HttpClient.newHttpClient();
    private static final String API_KEY = "<span class="active-key">[API_KEY]</span>";
    private static final String HOST    = "http://localhost:3000";

    public static void capture(String distinctId, String event, String propsJson) {
        String body = String.format(
            "{\"api_key\":\"%s\",\"event\":\"%s\",\"properties\":{\"distinct_id\":\"%s\",%s}}",
            API_KEY, event, distinctId, propsJson
        );
        HttpRequest req = HttpRequest.newBuilder()
            .uri(URI.create(HOST + "/capture/"))
            .header("Content-Type", "application/json")
            .POST(HttpRequest.BodyPublishers.ofString(body))
            .build();
        client.sendAsync(req, HttpResponse.BodyHandlers.ofString())
            .thenAccept(r -> System.out.println("Analytics sent: " + r.statusCode()));
    }
}

// Usage:
FortenAnalytics.capture("user_992", "feature_used",
    "\"feature\":\"dark_mode\",\"$release\":\"1.0.0\",\"$environment\":\"production\""
);</pre>
                        </div>
                    </div>

                    <!-- C# / UNITY -->
                    <div class="doc-section" id="doc-csharp">
                        <h2>C# / Unity Integration</h2>
                        <p class="section-lead">Capture exceptions in .NET applications, ASP.NET Core APIs, WPF/WinForms desktop apps, and Unity game builds. The Sentry .NET SDK supports all modern .NET targets.</p>

                        <div class="callout callout-purple">
                            <strong>🛡️ PART A: Error Tracking (Sentry .NET SDK)</strong>
                            Automatically captures unhandled CLR exceptions, async task failures, and Windows application crashes.
                        </div>

                        <h4>1. Install via NuGet</h4>
                        <div class="code-box">
                            <div class="code-header"><span>Terminal / Package Manager Console</span><button class="copy-btn" onclick="copyDocsText(this)">Copy</button></div>
                            <pre class="code-content-pre"># .NET CLI:
dotnet add package Sentry

# ASP.NET Core:
dotnet add package Sentry.AspNetCore

# Unity (via Unity Package Manager — add to manifest.json):
# "io.sentry.unity": "https://github.com/getsentry/sentry-unity.git#1.5.0"</pre>
                        </div>

                        <h4>2. Initialize in .NET / ASP.NET Core</h4>
                        <div class="code-box">
                            <div class="code-header"><span>Program.cs</span><button class="copy-btn" onclick="copyDocsText(this)">Copy</button></div>
                            <pre class="code-content-pre">using Sentry;

// Console / Worker Service:
SentrySdk.Init(o =>
{
    o.Dsn = "http://<span class="active-key">[API_KEY]</span>@localhost:3000/1";
    o.TracesSampleRate = 1.0;
    o.Environment = "production";
    o.Release = "my-app@1.0.0";
    // Route all traffic through the tunnel endpoint
    // (bypasses DSN numeric ID validation)
    o.SentryUri = new Uri("http://localhost:3000/api/<span class="active-project">[PROJECT_ID]</span>/envelope/?sentry_key=<span class="active-key">[API_KEY]</span>");
});

// ASP.NET Core (in WebApplication.CreateBuilder):
builder.WebHost.UseSentry(o =>
{
    o.Dsn = "http://<span class="active-key">[API_KEY]</span>@localhost:3000/1";
    o.TracesSampleRate = 1.0;
    o.Environment = "production";
});</pre>
                        </div>

                        <h4>3. Capture Exceptions</h4>
                        <div class="code-box">
                            <div class="code-header"><span>C#</span><button class="copy-btn" onclick="copyDocsText(this)">Copy</button></div>
                            <pre class="code-content-pre">using Sentry;

try
{
    await _dbContext.SaveChangesAsync();
}
catch (Exception ex)
{
    SentrySdk.ConfigureScope(scope =>
    {
        scope.SetTag("layer", "database");
        scope.SetTag("operation", "SaveChangesAsync");
        scope.SetExtra("entity_count", _dbContext.ChangeTracker.Entries().Count());
    });
    SentrySdk.CaptureException(ex);
    throw; // re-throw after reporting
}

// Capture a non-exception event
SentrySdk.CaptureMessage("Memory usage exceeded 80% threshold", SentryLevel.Warning);</pre>
                        </div>

                        <h4>4. Unity — Initialize in a MonoBehaviour</h4>
                        <div class="code-box">
                            <div class="code-header"><span>SentryInit.cs (Unity)</span><button class="copy-btn" onclick="copyDocsText(this)">Copy</button></div>
                            <pre class="code-content-pre">// Sentry Unity SDK uses SentryUnityOptions via the SDK wizard.
// In Assets > Sentry > Config, set:
//   DSN: http://<span class="active-key">[API_KEY]</span>@localhost:3000/1
//   Attach screenshots: true
//   Auto Session Tracking: true
//
// All unhandled C# exceptions are captured automatically.
// For manual capture:
using Sentry;

public class GameManager : MonoBehaviour
{
    void OnLevelLoad(int level)
    {
        SentrySdk.AddBreadcrumb(
            message: $"Level {level} loaded",
            category: "game",
            level: BreadcrumbLevel.Info
        );
    }

    void SaveGameFailed(Exception e)
    {
        SentrySdk.ConfigureScope(scope => scope.SetTag("scene", UnityEngine.SceneManagement.SceneManager.GetActiveScene().name));
        SentrySdk.CaptureException(e);
    }
}</pre>
                        </div>

                        <div class="doc-divider"></div>
                        <div class="callout callout-yellow">
                            <strong>📊 PART B: Custom Analytics (HttpClient)</strong>
                            Send events via .NET's built-in <code>HttpClient</code>. No extra package required.
                        </div>

                        <div class="code-box">
                            <div class="code-header"><span>C# (HttpClient)</span><button class="copy-btn" onclick="copyDocsText(this)">Copy</button></div>
                            <pre class="code-content-pre">using System.Net.Http;
using System.Text;
using System.Text.Json;

public static class Analytics
{
    private static readonly HttpClient _http = new();
    private const string ApiKey = "<span class="active-key">[API_KEY]</span>";
    private const string Host   = "http://localhost:3000";

    public static async Task CaptureAsync(string distinctId, string eventName,
        object? properties = null)
    {
        var payload = JsonSerializer.Serialize(new
        {
            api_key    = ApiKey,
            @event     = eventName,
            properties = new
            {
                distinct_id  = distinctId,
                release      = "1.0.0",
                environment  = "production",
                extra        = properties,
            }
        });

        await _http.PostAsync(
            Host + "/capture/",
            new StringContent(payload, Encoding.UTF8, "application/json")
        );
    }
}

// Usage:
await Analytics.CaptureAsync("user_abc", "settings_saved", new {
    theme = "dark",
    language = "en",
    window_mode = "fullscreen",
});</pre>
                        </div>
                    </div>

                    <!-- GO -->
                    <div class="doc-section" id="doc-go">
                        <h2>Go Integration</h2>
                        <p class="section-lead">Error tracking and custom analytics for Go microservices, CLI tools, and HTTP servers. The Sentry Go SDK integrates with net/http, Gin, Echo, and Fiber.</p>

                        <div class="callout callout-purple">
                            <strong>🛡️ PART A: Error Tracking (Sentry Go SDK)</strong>
                            Captures panics, goroutine crashes, and manually reported errors with stack traces resolved from debug symbols.
                        </div>

                        <h4>1. Install Sentry Go SDK</h4>
                        <div class="code-box">
                            <div class="code-header"><span>Terminal</span><button class="copy-btn" onclick="copyDocsText(this)">Copy</button></div>
                            <pre class="code-content-pre">go get github.com/getsentry/sentry-go</pre>
                        </div>

                        <h4>2. Initialize and Capture Errors</h4>
                        <div class="code-box">
                            <div class="code-header"><span>main.go</span><button class="copy-btn" onclick="copyDocsText(this)">Copy</button></div>
                            <pre class="code-content-pre">package main

import (
    "log"
    "time"
    sentry "github.com/getsentry/sentry-go"
)

func main() {
    err := sentry.Init(sentry.ClientOptions{
        Dsn:              "http://<span class="active-key">[API_KEY]</span>@localhost:3000/1",
        // Route via tunnel to bypass numeric-ID validation:
        HTTPTransport: &amp;customTransport{
            target: "http://localhost:3000/api/<span class="active-project">[PROJECT_ID]</span>/envelope/?sentry_key=<span class="active-key">[API_KEY]</span>",
        },
        TracesSampleRate: 1.0,
        Environment:      "production",
        Release:          "my-service@1.0.0",
    })
    if err != nil {
        log.Fatalf("sentry.Init: %v", err)
    }
    defer sentry.Flush(2 * time.Second)

    // Recover from panics and send to FortenLog
    defer func() {
        if r := recover(); r != nil {
            sentry.CurrentHub().Recover(r)
            sentry.Flush(2 * time.Second)
        }
    }()

    runApp()
}

func runApp() {
    // Manual error capture
    if err := riskyOperation(); err != nil {
        sentry.WithScope(func(scope *sentry.Scope) {
            scope.SetTag("component", "worker")
            scope.SetExtra("retryCount", 3)
            sentry.CaptureException(err)
        })
    }
}</pre>
                        </div>

                        <div class="callout callout-red">
                            <strong>DSN Routing in Go</strong>
                            The Go SDK does not have a built-in <code>tunnel</code> option. Implement a custom <code>HTTPTransport</code> that rewrites the request URL to the FortenLog envelope endpoint, or use an nginx proxy that forwards <code>/api/1/envelope/</code> to <code>/api/[PROJECT_ID]/envelope/</code>.
                        </div>

                        <div class="doc-divider"></div>
                        <div class="callout callout-yellow">
                            <strong>📊 PART B: Custom Analytics (net/http)</strong>
                            Use Go's standard library — no external dependency needed.
                        </div>

                        <div class="code-box">
                            <div class="code-header"><span>Go</span><button class="copy-btn" onclick="copyDocsText(this)">Copy</button></div>
                            <pre class="code-content-pre">package analytics

import (
    "bytes"
    "encoding/json"
    "net/http"
)

const (
    apiKey = "<span class="active-key">[API_KEY]</span>"
    host   = "http://localhost:3000"
)

type Event struct {
    APIKey     string         \`json:"api_key"\`
    Event      string         \`json:"event"\`
    Properties map[string]any \`json:"properties"\`
}

func Capture(distinctID, eventName string, props map[string]any) error {
    if props == nil {
        props = make(map[string]any)
    }
    props["distinct_id"] = distinctID

    body, err := json.Marshal(Event{
        APIKey:     apiKey,
        Event:      eventName,
        Properties: props,
    })
    if err != nil {
        return err
    }

    resp, err := http.Post(host+"/capture/", "application/json", bytes.NewReader(body))
    if err != nil {
        return err
    }
    defer resp.Body.Close()
    return nil
}

// Usage:
// analytics.Capture("worker_01", "job_completed", map[string]any{
//     "$release":     "2.1.0",
//     "$environment": "production",
//     "duration_ms":  142,
//     "records":      5000,
// })</pre>
                        </div>
                    </div>

                    <!-- RUST -->
                    <div class="doc-section" id="doc-rust">
                        <h2>Rust Integration</h2>
                        <p class="section-lead">Native error tracking for Rust applications. The Sentry Rust SDK captures panics, backtraces, and manually reported errors with zero overhead in release builds.</p>

                        <div class="callout callout-purple">
                            <strong>🛡️ PART A: Error Tracking (sentry-rust)</strong>
                            Captures panics via the panic hook integration. Works with async Tokio applications, Axum/Actix-Web servers, and CLI tools.
                        </div>

                        <h4>1. Add to Cargo.toml</h4>
                        <div class="code-box">
                            <div class="code-header"><span>Cargo.toml</span><button class="copy-btn" onclick="copyDocsText(this)">Copy</button></div>
                            <pre class="code-content-pre">[dependencies]
sentry = { version = "0.34", features = ["reqwest", "rustls", "backtrace", "anyhow"] }

# For async applications:
sentry-tokio = "0.34"</pre>
                        </div>

                        <h4>2. Initialize the Sentry Guard</h4>
                        <div class="code-box">
                            <div class="code-header"><span>main.rs</span><button class="copy-btn" onclick="copyDocsText(this)">Copy</button></div>
                            <pre class="code-content-pre">use std::sync::Arc;

fn main() {
    // The guard must be kept alive for the duration of the program.
    // Dropping it flushes remaining events.
    let _sentry = sentry::init((
        "http://<span class="active-key">[API_KEY]</span>@localhost:3000/1",
        sentry::ClientOptions {
            // FortenLog tunnel: route all events to the correct project endpoint
            // (bypasses the Sentry SDK's numeric project ID validation)
            server_name: Some(Arc::from("localhost")),
            release: sentry::release_name!(),
            environment: Some("production".into()),
            traces_sample_rate: 1.0,
            ..Default::default()
        },
    ));

    // Panic hook is registered automatically.
    // Any panic will be captured and sent before the process exits.

    run_application();
}

fn risky_operation() -> Result&lt;(), anyhow::Error&gt; {
    // anyhow errors are captured with full backtrace
    Err(anyhow::anyhow!("Database connection pool exhausted"))
}

fn run_application() {
    if let Err(e) = risky_operation() {
        sentry::capture_anyhow(&amp;e);
        eprintln!("Error: {e:#}");
    }
}</pre>
                        </div>

                        <h4>3. Manual Capture with Scope</h4>
                        <div class="code-box">
                            <div class="code-header"><span>Rust</span><button class="copy-btn" onclick="copyDocsText(this)">Copy</button></div>
                            <pre class="code-content-pre">use sentry::{configure_scope, capture_message, Level};

// Add context to a scope before capturing
configure_scope(|scope| {
    scope.set_tag("component", "ingest_worker");
    scope.set_extra("queue_depth", 1024.into());
    scope.set_user(Some(sentry::User {
        id: Some("worker_01".into()),
        ..Default::default()
    }));
});

// Capture a plain message
capture_message("Rate limit threshold reached", Level::Warning);

// Capture any std::error::Error
let err: Box&lt;dyn std::error::Error&gt; = "connection timeout".into();
sentry::capture_error(err.as_ref());</pre>
                        </div>

                        <div class="callout callout-red">
                            <strong>DSN Project ID Routing in Rust</strong>
                            The <code>sentry-rust</code> crate constructs the envelope URL directly from the DSN. If your Project ID is a text slug, the SDK will send to <code>/api/1/envelope/</code> (from the fake <code>/1</code> in the DSN). You must set up a reverse proxy rule to rewrite <code>/api/1/envelope/</code> → <code>/api/[PROJECT_ID]/envelope/</code>. Alternatively, use a numeric project ID when creating the project if your routing supports it.
                        </div>

                        <div class="doc-divider"></div>
                        <div class="callout callout-yellow">
                            <strong>📊 PART B: Custom Analytics (reqwest)</strong>
                            Send PostHog-compatible analytics events using reqwest. No extra SDK needed.
                        </div>

                        <div class="code-box">
                            <div class="code-header"><span>Rust (reqwest + tokio)</span><button class="copy-btn" onclick="copyDocsText(this)">Copy</button></div>
                            <pre class="code-content-pre">[dependencies]
reqwest = { version = "0.12", features = ["json"] }
serde_json = "1"
tokio = { version = "1", features = ["full"] }</pre>
                        </div>
                        <div class="code-box">
                            <div class="code-header"><span>analytics.rs</span><button class="copy-btn" onclick="copyDocsText(this)">Copy</button></div>
                            <pre class="code-content-pre">use serde_json::{json, Value};

const API_KEY: &amp;str = "<span class="active-key">[API_KEY]</span>";
const HOST:    &amp;str = "http://localhost:3000";

pub async fn capture(
    client: &amp;reqwest::Client,
    distinct_id: &amp;str,
    event: &amp;str,
    props: Value,
) -> anyhow::Result&lt;()&gt; {
    let mut properties = props;
    properties["distinct_id"] = distinct_id.into();

    let body = json!({
        "api_key":    API_KEY,
        "event":      event,
        "properties": properties,
    });

    client
        .post(format!("{HOST}/capture/"))
        .json(&amp;body)
        .send()
        .await?
        .error_for_status()?;

    Ok(())
}

// Usage:
// let client = reqwest::Client::new();
// capture(&amp;client, "worker_01", "job_finished", json!({
//     "$release":     "1.0.0",
//     "$environment": "production",
//     "duration_ms":  84,
//     "items_processed": 2000,
// })).await?;</pre>
                        </div>
                    </div>

                    <!-- SECURITY -->
                    <div class="doc-section" id="doc-security">
                        <h2><span>🛡️</span> Security, Privacy &amp; Hardening</h2>
                        <p class="section-lead">FortenLog is designed for private, self-hosted deployments. All data stays on your infrastructure. The platform includes multiple layers of protection against external scanning, credential theft, and data leaks.</p>

                        <div class="info-grid">
                            <div class="info-panel">
                                <h4>Stealth Ingestion Mode <span class="feature-tag">PROTECTED</span></h4>
                                <p>When enabled, the ingestion endpoints always respond <code>200 OK</code> — even for unauthenticated or malformed requests. Port scanners and bots cannot determine whether authentication failed or succeeded, making fingerprinting and credential stuffing attacks ineffective.</p>
                                <p style="margin-top:8px;">Configure in: <strong>Settings → Stealth Mode</strong></p>
                            </div>
                            <div class="info-panel">
                                <h4>PII Stripping &amp; IP Masking <span class="feature-tag">IN-MEMORY</span></h4>
                                <p>All events are sanitized in memory before database write. The server strips common PII patterns (passwords, credit card numbers, auth tokens, email addresses) from stack traces and event properties. IP addresses have the final octet zeroed to comply with privacy regulations (GDPR, CCPA).</p>
                            </div>
                        </div>

                        <div class="info-grid" style="margin-top:16px;">
                            <div class="info-panel">
                                <h4>TOTP Two-Factor Authentication</h4>
                                <p>Scan the QR code in Settings with any TOTP authenticator (Google Authenticator, Authy, Bitwarden). The QR code is rendered locally on a canvas element — no third-party services involved. Recovery codes are single-use and should be stored offline. Once all recovery codes are consumed, you must access the server filesystem to reset.</p>
                            </div>
                            <div class="info-panel">
                                <h4>WebAuthn / Passkeys</h4>
                                <p>Register hardware keys (YubiKey, Titan) or platform authenticators (Windows Hello, Touch ID, Face ID). Authentication uses standard public-key cryptography via <code>navigator.credentials.create()</code> — the private key never leaves your device. Fully resistant to phishing attacks since the origin is cryptographically bound.</p>
                            </div>
                        </div>

                        <div class="info-grid" style="margin-top:16px;">
                            <div class="info-panel">
                                <h4>Argon2id Password Hashing</h4>
                                <p>The master password is hashed with Argon2id (memory-hard, GPU-resistant). Parameters are set to high memory usage to make brute-force attacks computationally expensive even on dedicated hardware.</p>
                            </div>
                            <div class="info-panel">
                                <h4>Audit Log</h4>
                                <p>Every administrative action is recorded in a tamper-proof append-only log stored in the system database. Entries include action type, timestamp, and metadata. The log cannot be cleared from the UI and persists across restarts.</p>
                            </div>
                        </div>

                        <h3>Rate Limiting &amp; DoS Protection</h3>
                        <p>FortenLog enforces three independent rate limit layers to protect the database and CPU under adversarial conditions:</p>
                        <ul>
                            <li><strong>Global IP limit</strong> — 100 requests per 60 seconds per IP address. Exceeded → <code>429</code>.</li>
                            <li><strong>Project + IP burst limit</strong> — 5 events / 200 KB per 10 minutes. Prevents log spamming from a single session.</li>
                            <li><strong>Project + IP daily limit</strong> — 10 events per 24 hours per IP per project. Long-term protection against sustained abuse.</li>
                            <li><strong>Per-user deduplication</strong> — A single user/session cannot produce more than 50 identical fingerprinted events per cache window.</li>
                        </ul>
                    </div>

                    <!-- DATABASES -->
                    <div class="doc-section" id="doc-databases">
                        <h2><span>💿</span> Databases &amp; Storage Architecture</h2>
                        <p class="section-lead">FortenLog uses a multi-tenant SQLite architecture where each project gets its own isolated database file. This guarantees data isolation, enables independent backups, and eliminates cross-project lock contention.</p>

                        <div class="info-grid">
                            <div class="info-panel">
                                <h4>Isolated Per-Project Databases</h4>
                                <p>Each project has a dedicated <code>.db</code> file at <code>data/projects/[id].db</code>. A corruption or index failure in one project cannot affect others. Projects can be individually backed up, restored, or cleared without downtime.</p>
                            </div>
                            <div class="info-panel">
                                <h4>WAL Mode + Connection Pools</h4>
                                <p>All databases use Write-Ahead Logging (WAL) mode. This allows simultaneous readers and a single writer without blocking. Threaded connection pools enable concurrent event ingestion at high throughput.</p>
                            </div>
                        </div>

                        <div class="info-grid" style="margin-top:16px;">
                            <div class="info-panel">
                                <h4>Event Compression (zstd)</h4>
                                <p>Raw event payloads are compressed with <strong>zstd level 3</strong> before storage. This reduces database size by 60–80% for typical JSON payloads. Payloads larger than 2 MB are truncated before compression to prevent abuse.</p>
                            </div>
                            <div class="info-panel">
                                <h4>Dynamic Cache Sizing</h4>
                                <p>Per-project SQLite page cache sizes can be adjusted in project settings without restarting the server. Increasing cache improves Explorer query speed for large datasets.</p>
                            </div>
                        </div>

                        <h3>Storage Management</h3>
                        <p>All database maintenance actions are available under <strong>Settings → Storage</strong> and <strong>Projects</strong>:</p>

                        <table class="param-table">
                            <thead><tr><th>Action</th><th>Effect</th><th>When to Use</th></tr></thead>
                            <tbody>
                                <tr>
                                    <td><strong>Run VACUUM</strong></td>
                                    <td>Compacts the database file, reclaiming space from deleted rows.</td>
                                    <td>After mass-deleting issues or clearing old events. May take seconds to minutes depending on database size.</td>
                                </tr>
                                <tr>
                                    <td><strong>Create Backup</strong></td>
                                    <td>Hot-copies the database to <code>data/backups/[id]_[timestamp].db</code>.</td>
                                    <td>Before major changes, scheduled nightly via cron, or before server migration.</td>
                                </tr>
                                <tr>
                                    <td><strong>Clear Project Data</strong></td>
                                    <td>Deletes all events, issues, and telemetry records. Preserves project ID and API key.</td>
                                    <td>Resetting a development project, or after a GDPR data deletion request.</td>
                                </tr>
                            </tbody>
                        </table>

                        <h3>Disk Layout</h3>
                        <div class="code-box">
                            <div class="code-header"><span>Server Filesystem</span><button class="copy-btn" onclick="copyDocsText(this)">Copy</button></div>
                            <pre class="code-content-pre">data/
├── system.db              # Admin credentials, projects registry, audit log
├── projects/
│   ├── my-app.db          # All events for project "my-app"
│   ├── staging.db         # All events for project "staging"
│   └── ...
└── backups/
    ├── my-app_20260601_120000.db
    └── ...</pre>
                        </div>
                    </div>

                    <!-- MONITORING -->
                    <div class="doc-section" id="doc-monitoring">
                        <h2><span>⚙️</span> Uptime Monitors &amp; Alert Notifications</h2>
                        <p class="section-lead">Configure automated health checks for your services and receive instant notifications via email or team messaging platforms when something goes down.</p>

                        <div class="info-grid">
                            <div class="info-panel">
                                <h4>Automated HTTP Monitors</h4>
                                <p>Define HTTP/HTTPS endpoints to probe at configurable intervals (minimum 10 seconds). Each probe measures Round-Trip Time (RTT), verifies the expected HTTP status code, and tracks SSL certificate validity. History is retained for trend analysis.</p>
                            </div>
                            <div class="info-panel">
                                <h4>SMTP Mail Alerts</h4>
                                <p>Configure a mail relay server (supports SSL/TLS and STARTTLS). Alerts are sent asynchronously in background tasks to avoid blocking ingestion. Test the connection from Settings before saving to verify credentials.</p>
                            </div>
                        </div>

                        <h3>Setting Up a Monitor</h3>
                        <ol class="step-list">
                            <li>Go to <strong>Uptime</strong> in the left sidebar and click <strong>Add Monitor</strong>.</li>
                            <li>Enter the full URL including scheme: <code>https://api.myapp.com/health</code></li>
                            <li>Set the expected HTTP status code (usually <code>200</code> or <code>204</code>).</li>
                            <li>Set the check interval in seconds (e.g., <code>60</code> for every minute).</li>
                            <li>Set the timeout in seconds — probes that don't respond within this window are counted as failures.</li>
                            <li>Click <strong>Save</strong>. The monitor starts checking immediately.</li>
                        </ol>

                        <h3>Webhook Payload Format</h3>
                        <p>When a monitor changes state (UP → DOWN or DOWN → UP), FortenLog sends a POST request to your configured Slack or Discord webhook URL:</p>
                        <div class="code-box">
                            <div class="code-header"><span>Webhook JSON Payload</span><button class="copy-btn" onclick="copyDocsText(this)">Copy</button></div>
                            <pre class="code-content-pre">{
    "text": "🔴 ALERT: Monitor 'API Health' is DOWN",
    "attachments": [{
        "color": "#e74c3c",
        "fields": [
            { "title": "URL",             "value": "https://api.myapp.com/health", "short": false },
            { "title": "Status",          "value": "DOWN",                         "short": true  },
            { "title": "Last RTT",        "value": "timeout",                      "short": true  },
            { "title": "First detected",  "value": "2026-06-13T12:00:00Z",        "short": false }
        ]
    }]
}</pre>
                        </div>

                        <h3>Reading the Latency Chart</h3>
                        <ul>
                            <li><strong>Green bars</strong> — Probe succeeded within timeout. Bar height represents RTT in milliseconds.</li>
                            <li><strong>Red bars</strong> — Probe failed (wrong status code or timeout). RTT is zero.</li>
                            <li><strong>Spikes</strong> — Sudden RTT increases indicate server overload, network congestion, or GC pauses. Compare with your application metrics to correlate.</li>
                            <li><strong>Flatlines</strong> — All bars at exactly the timeout value suggest the host is unreachable, not just slow.</li>
                        </ul>
                    </div>

                </div>
            </div>
        </div>
    `;

    // Replace static localhost:3000 with the active browser host
    container.innerHTML = container.innerHTML
        .replace(/http:\/\/localhost:3000/g, window.location.origin)
        .replace(/localhost:3000/g, window.location.host);

    // Tab switching
    const tabs = container.querySelectorAll('.docs-nav-btn');
    const sections = container.querySelectorAll('.doc-section');

    tabs.forEach(tab => {
        tab.onclick = () => {
            tabs.forEach(t => t.classList.remove('active'));
            sections.forEach(s => s.classList.remove('active'));
            tab.classList.add('active');
            const target = container.querySelector(`#doc-${tab.dataset.tab}`);
            if (target) target.classList.add('active');
        };
    });

    // Populate project selector and DSN display
    const selector = container.querySelector('#docs-project-selector');
    const dsnDisplay = container.querySelector('#docs-dsn-display');
    const keySpans = container.querySelectorAll('.active-key');
    const projSpans = container.querySelectorAll('.active-project');

    // Store the raw DSN value separately to avoid reading masked innerText
    let currentFullDsn = '';

    const updatePlaceholders = (key, id) => {
        currentFullDsn = `${window.location.protocol}//${key}@${window.location.host}/${id}`;
        if (dsnDisplay) {
            dsnDisplay.textContent = currentFullDsn;
            // Store on element so copyDsnText can always read the real value
            dsnDisplay.dataset.fullDsn = currentFullDsn;
        }
        keySpans.forEach(s => { s.textContent = key; });
        projSpans.forEach(s => { s.textContent = id; });
    };

    try {
        const { data: projects } = await api('/api/settings/projects');
        if (projects && projects.length > 0) {
            selector.innerHTML = projects
                .map(p => `<option value="${p.id}" data-key="${p.api_key}">${p.name} (${p.id})</option>`)
                .join('');
            selector.onchange = () => {
                const opt = selector.options[selector.selectedIndex];
                updatePlaceholders(opt.dataset.key, opt.value);
            };
            const first = selector.options[0];
            updatePlaceholders(first.dataset.key, first.value);
        } else {
            selector.innerHTML = `<option value="default-project" data-key="fl_core_key">FortenLog Core (default-project)</option>`;
            updatePlaceholders('fl_core_key', 'default-project');
        }
    } catch (err) {
        console.warn('Failed to load projects for documentation, using defaults', err);
        selector.innerHTML = `<option value="default-project" data-key="fl_core_key">FortenLog Core (default-project)</option>`;
        updatePlaceholders('fl_core_key', 'default-project');
    }

    // Copy code block text
    window.copyDocsText = (btn) => {
        const pre = btn.closest('.code-box')?.querySelector('pre');
        if (!pre) return;
        navigator.clipboard.writeText(pre.innerText).then(() => {
            const orig = btn.innerText;
            btn.innerText = 'Copied!';
            btn.style.color = 'var(--success, #00b894)';
            btn.style.borderColor = 'var(--success, #00b894)';
            setTimeout(() => {
                btn.innerText = orig;
                btn.style.color = '';
                btn.style.borderColor = '';
            }, 1500);
        });
    };

    // Copy DSN — reads from data-fulldsn attribute, NOT innerText (avoids masked display bugs)
    window.copyDsnText = (btn) => {
        const display = document.getElementById('docs-dsn-display');
        const value = display?.dataset?.fullDsn || display?.textContent || '';
        if (!value) return;
        navigator.clipboard.writeText(value).then(() => {
            const orig = btn.innerText;
            btn.innerText = 'Copied!';
            btn.style.color = 'var(--success, #00b894)';
            btn.style.borderColor = 'var(--success, #00b894)';
            setTimeout(() => {
                btn.innerText = orig;
                btn.style.color = '';
                btn.style.borderColor = '';
            }, 1500);
        });
    };
}
