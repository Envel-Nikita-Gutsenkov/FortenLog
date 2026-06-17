import { api } from '../api.js';
import { bufferToBase64, base64ToBuffer } from '../utils.js';
import { store } from '../store.js';

export async function renderSettings(container) {
    let settings = {
        alert_channel_email: "true",
        alert_channel_slack: "false",
        alert_channel_webhook: "false",
        smtp_server: "smtp.fortenlog.io",
        smtp_port: "587",
        smtp_recipient: "admin@fortenlog.io",
        slack_webhook_url: "",
        webhook_endpoint_url: ""
    };
    try {
        const { data } = await api('/api/system/settings');
        if (data) {
            settings = { ...settings, ...data };
        }
    } catch (e) {
        console.error("Failed to load settings", e);
    }

    container.innerHTML = `
        <div class="view-content-inner" style="max-width: 1400px; padding: 32px; display: flex; flex-direction: column; gap: 32px;">
            <div class="header-section" style="border-bottom: 1px solid var(--border); padding-bottom: 24px;">
                <h1 style="margin: 0; font-size: 26px; font-weight: 800;">Server Settings</h1>
                <p style="color: var(--text-secondary); margin: 6px 0 0 0; font-size: 13px;">Manage global telemetry rules, stability target thresholds, and system-wide alerting notification channels.</p>
            </div>
            
            <div style="display: flex; flex-direction: column; gap: 24px;">
                <!-- Global Analytics Settings -->
                <div class="card" style="padding: 24px; border-radius: 16px;">
                    <div style="font-size: 16px; font-weight: 800; color: var(--accent); margin-bottom: 16px; letter-spacing: 0.5px;">GLOBAL ANALYTICS CONFIGURATION</div>
                    <div style="display: grid; grid-template-columns: 1fr 2fr; gap: 40px; align-items: center; flex-wrap: wrap;">
                        <div>
                            <label class="text-secondary font-bold" style="font-size: 12px; display: block; margin-bottom: 8px;">MINIMUM STABILITY TARGET (%)</label>
                            <div style="display: flex; align-items: center; gap: 12px;">
                                <input type="number" id="stability-target" class="code-block" style="width: 100px; height: 44px; padding: 0 16px; font-weight: 800; color: var(--text); background: var(--bg-sub); border: 1px solid var(--border);" 
                                       value="${localStorage.getItem('fortenlog_stability_target') || '98.0'}" step="0.1" min="0" max="100">
                                <span style="font-weight: 800; color: var(--text-secondary);">%</span>
                            </div>
                        </div>
                        <p class="text-secondary" style="font-size: 13px; line-height: 1.5; margin: 0;">Releases with crash-free rates below this value will be flagged as <b style="color:var(--error)">CRITICAL</b> in the Analytics dashboard. Recommended: 99.5%.</p>
                    </div>
                    <button class="btn btn-primary" onclick="saveAnalyticsSettings()" style="margin-top: 24px; height: 44px; padding: 0 24px; font-weight: 700; font-size: 13px;">Apply Thresholds</button>
                </div>

                <!-- Notifications -->
                <div class="card" style="padding: 24px; border-radius: 16px;">
                    <div style="font-size: 16px; font-weight: 800; color: var(--accent); margin-bottom: 16px; letter-spacing: 0.5px;">GLOBAL ALERTING CHANNELS</div>
                    <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 24px;">
                        <div class="stat-card" style="background: var(--bg-sub); border: 1px solid var(--border); padding: 24px; border-radius: 12px; position: relative;">
                            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;">
                                <div style="display: flex; align-items: center; gap: 10px;">
                                    <svg style="width: 18px; height: 18px; color: var(--accent);"><use href="#icon-refresh"></use></svg>
                                    <span class="font-bold">Email (SMTP)</span>
                                </div>
                                <label class="switch">
                                    <input type="checkbox" ${settings.alert_channel_email === "true" ? "checked" : ""} onchange="toggleChannel('email', this.checked)">
                                    <span class="slider round"></span>
                                </label>
                            </div>
                            <p class="text-secondary" style="font-size: 12px; margin-bottom: 16px;">Critical anomaly reports sent to configured master address.</p>
                            <button class="btn btn-sm" onclick="configureChannel('email')">Configure SMTP</button>
                        </div>
                        <div class="stat-card" style="background: var(--bg-sub); border: 1px solid var(--border); padding: 24px; border-radius: 12px;">
                            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;">
                                <div style="display: flex; align-items: center; gap: 10px;">
                                    <svg style="width: 18px; height: 18px; color: #36C5F0;"><use href="#icon-activity"></use></svg>
                                    <span class="font-bold">Slack</span>
                                </div>
                                <label class="switch">
                                    <input type="checkbox" ${settings.alert_channel_slack === "true" ? "checked" : ""} onchange="toggleChannel('slack', this.checked)">
                                    <span class="slider round"></span>
                                </label>
                            </div>
                            <p class="text-secondary" style="font-size: 12px; margin-bottom: 16px;">Post alerts to team channels via Incoming Webhooks.</p>
                            <button class="btn btn-sm" onclick="configureChannel('slack')">Connect Workspace</button>
                        </div>
                        <div class="stat-card" style="background: var(--bg-sub); border: 1px solid var(--border); padding: 24px; border-radius: 12px;">
                            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;">
                                <div style="display: flex; align-items: center; gap: 10px;">
                                    <svg style="width: 18px; height: 18px; color: #f39c12;"><use href="#icon-layout"></use></svg>
                                    <span class="font-bold">Webhook</span>
                                </div>
                                <label class="switch">
                                    <input type="checkbox" ${settings.alert_channel_webhook === "true" ? "checked" : ""} onchange="toggleChannel('webhook', this.checked)">
                                    <span class="slider round"></span>
                                </label>
                            </div>
                            <p class="text-secondary" style="font-size: 12px; margin-bottom: 16px;">Send raw event payloads to custom HTTP endpoints.</p>
                            <button class="btn btn-sm" onclick="configureChannel('webhook')">Setup Endpoint</button>
                        </div>
                    </div>
                </div>

                <!-- Software Version & Build Metadata -->
                <div class="card" style="padding: 24px; border-radius: 16px; display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 20px; background: linear-gradient(135deg, rgba(93, 81, 232, 0.05) 0%, rgba(0, 184, 148, 0.05) 100%); border: 1px solid var(--border);">
                    <div style="display: flex; align-items: center; gap: 16px;">
                        <div style="width: 48px; height: 48px; border-radius: 12px; background: var(--accent-light); color: var(--accent); display: flex; align-items: center; justify-content: center; font-size: 20px;">
                            💿
                        </div>
                        <div>
                            <div style="font-size: 14px; font-weight: 800; color: var(--text-primary);">FortenLog Telemetry Engine</div>
                            <div style="font-size: 11px; color: var(--text-secondary); margin-top: 2px;">Production-grade microservices stability core.</div>
                        </div>
                    </div>
                    
                    <div style="display: flex; gap: 32px; flex-wrap: wrap; font-size: 13px;">
                        <div>
                            <span style="color: var(--text-secondary); display: block; font-size: 10px; font-weight: 800; letter-spacing: 0.5px; text-transform: uppercase;">Software Version</span>
                            <span style="font-family: 'Roboto Mono', monospace; font-weight: 800; color: var(--accent);">${settings._software_version || '0.1.0'}</span>
                        </div>
                        <div>
                            <span style="color: var(--text-secondary); display: block; font-size: 10px; font-weight: 800; letter-spacing: 0.5px; text-transform: uppercase;">Commit Signature</span>
                            <span style="font-family: 'Roboto Mono', monospace; font-weight: 800; color: var(--text-primary); background: var(--bg-sub); padding: 2px 6px; border-radius: 4px; border: 1px solid var(--border);">${settings._build_commit || '81532e1d'}</span>
                        </div>
                        <div>
                            <span style="color: var(--text-secondary); display: block; font-size: 10px; font-weight: 800; letter-spacing: 0.5px; text-transform: uppercase;">Compilation/Update Date</span>
                            <span style="font-family: 'Roboto Mono', monospace; font-weight: 800; color: var(--text-primary);">${settings._build_date || '2026-05-18 13:44:15'}</span>
                        </div>
                    </div>
                </div>
            </div>
        </div>`;
}

window.saveAnalyticsSettings = async () => {
    const target = parseFloat(document.getElementById('stability-target').value) || 98.0;
    localStorage.setItem('fortenlog_stability_target', target);
    alert(`Stability target updated to ${target}%. Analytics views will reflect this change.`);
};


export async function renderSecurityProfile(container) {
    if (!container) return;

    const changeRequired = localStorage.getItem('password_change_required') === 'true'
        || (store.currentUser && store.currentUser.password_change_required);

    container.innerHTML = `
        <div class="view-content-inner" style="max-width: 1400px; padding: 32px; display: flex; flex-direction: column; gap: 32px;">
            ${changeRequired ? `
            <div style="background: rgba(248, 81, 73, 0.1); border: 1px solid rgba(248, 81, 73, 0.3); border-radius: 12px; padding: 20px; display: flex; align-items: center; gap: 16px; margin-bottom: 8px;">
                <div style="font-size: 24px;">⚠️</div>
                <div style="text-align: left;">
                    <h4 style="margin: 0; color: #f85149; font-size: 15px; font-weight: 800;">Password Change Required</h4>
                    <p style="margin: 4px 0 0 0; color: var(--text-secondary); font-size: 13px;">You are currently logged in using the default credentials. Please set a secure password according to the security guidelines below to restore full access to all panels.</p>
                </div>
            </div>
            ` : ''}

            <div class="header-section" style="border-bottom: 1px solid var(--border); padding-bottom: 24px;">
                <h1 style="margin: 0; font-size: 26px; font-weight: 800;">Personal Security Profile</h1>
                <p style="color: var(--text-secondary); margin: 6px 0 0 0; font-size: 13px;">Manage your administrative security credentials, multi-factor authentication (2FA), and hardware security passkeys.</p>
            </div>
            
            <div style="display: flex; flex-direction: column; gap: 24px;">
                <!-- Password Management -->
                <div class="card" style="padding: 24px; border-radius: 16px;">
                    <div style="font-size: 16px; font-weight: 800; color: var(--accent); margin-bottom: 16px; letter-spacing: 0.5px;">SECURITY CREDENTIALS</div>
                    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 32px; flex-wrap: wrap;">
                        <div>
                            <label class="text-secondary font-bold" style="font-size: 12px; display: block; margin-bottom: 8px;">CURRENT ADMINISTRATIVE PASSWORD</label>
                            <input type="password" id="curr-pwd" class="code-block" style="width: 100%; height: 44px; padding: 0 16px; font-size: 14px;" placeholder="••••••••">
                        </div>
                        <div>
                            <label class="text-secondary font-bold" style="font-size: 12px; display: block; margin-bottom: 8px;">NEW ADMINISTRATIVE PASSWORD</label>
                            <input type="password" id="new-pwd" class="code-block" style="width: 100%; height: 44px; padding: 0 16px; font-size: 14px;" placeholder="Min 12 characters">
                        </div>
                    </div>
                    <button class="btn btn-primary" onclick="updateMasterPassword()" style="margin-top: 24px; padding: 0 32px; font-size: 13px; font-weight: 700; height: 44px;">Save Security Changes</button>
                </div>

                <!-- Multi-Factor Authentication -->
                <div class="card" style="padding: 24px; border-radius: 16px;">
                    <div style="font-size: 16px; font-weight: 800; color: var(--accent); margin-bottom: 16px; letter-spacing: 0.5px;">MULTI-FACTOR AUTHENTICATION</div>
                    <div style="display: flex; justify-content: space-between; align-items: center; gap: 40px; flex-wrap: wrap;">
                        <div style="flex: 1; min-width: 300px;">
                            <p class="text-secondary" style="margin-bottom: 24px; font-size: 13px; line-height: 1.5; margin-top: 0;">Add an extra layer of security to your administrator identity by using a TOTP authenticator app or registering a hardware security key.</p>
                            <div style="display: flex; gap: 12px; flex-wrap: wrap;">
                                <button class="btn" onclick="setup2FA()" style="height: 44px; padding: 0 20px; font-weight: 600;">Configure TOTP Authenticator</button>
                                <button class="btn" onclick="registerPasskey()" style="height: 44px; padding: 0 20px; font-weight: 600; border-color: var(--accent); color: var(--accent);">Register Hardware Key (WebAuthn)</button>
                            </div>
                        </div>
                        <div id="2fa-status" style="padding: 24px; background: rgba(0, 184, 148, 0.05); border: 1px solid rgba(0, 184, 148, 0.2); border-radius: 16px; min-width: 280px; flex-shrink: 0;">
                            <div style="display: flex; align-items: center; gap: 12px; margin-bottom: 16px;">
                                <div style="width: 40px; height: 40px; border-radius: 50%; background: #00b894; display: flex; align-items: center; justify-content: center; box-shadow: 0 0 20px rgba(0, 184, 148, 0.4);">
                                    <svg style="width: 20px; height: 20px; color: white;"><use href="#icon-compass"></use></svg>
                                </div>
                                <div>
                                    <div style="font-size: 14px; font-weight: 800; color: #00b894;">ACTIVE_PROTECTION</div>
                                    <div style="font-size: 10px; color: var(--text-secondary); letter-spacing: 1px;">SYSTEM_INTEGRITY: OPTIMAL</div>
                                </div>
                            </div>
                            <div style="display: flex; flex-direction: column; gap: 8px;">
                                <div style="display: flex; justify-content: space-between; font-size: 11px;">
                                    <span class="text-secondary">Rate Limiting</span>
                                    <span style="color: #00b894; font-weight: 800;">ENFORCED</span>
                                </div>
                                <div style="display: flex; justify-content: space-between; font-size: 11px;">
                                    <span class="text-secondary">Session Binding</span>
                                    <span style="color: #00b894; font-weight: 800;">ACTIVE</span>
                                </div>
                                <div style="display: flex; justify-content: space-between; font-size: 11px;">
                                    <span class="text-secondary">CSRF Protection</span>
                                    <span style="color: #00b894; font-weight: 800;">ENABLED</span>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    `;
}

window.updateMasterPassword = async () => {
    const current_password = document.getElementById('curr-pwd').value;
    const new_password = document.getElementById('new-pwd').value;
    const res = await api('/api/system/security/password', { method: 'POST', body: JSON.stringify({ current_password, new_password }) });
    if (res.status === 200) {
        alert('Master password updated.');
        localStorage.removeItem('password_change_required');
        window.location.reload();
    } else {
        alert(res.error || 'Failed to update password. Check current password and strength requirements.');
    }
};

window.setup2FA = async () => {
    try {
        const setupData = await api('/api/system/2fa/setup', { method: 'POST' });
        const { secret, uri } = setupData.data || {};

        window.dispatchEvent(new CustomEvent('open-modal', {
            detail: {
                title: 'Configure Multi-Factor Authentication',
                html: `
                    <div style="text-align: center; padding: 20px;">
                        <div id="mfa-qrcode" style="width: 200px; height: 200px; background: white; margin: 0 auto 20px; display: flex; align-items: center; justify-content: center; border-radius: 12px; padding: 10px; box-shadow: 0 4px 12px rgba(0,0,0,0.1);"></div>
                        <div style="margin-bottom: 20px; padding: 10px; background: var(--bg-sub); border: 1px dashed var(--border); border-radius: 8px;">
                            <span style="font-size: 11px; text-transform: uppercase; color: var(--text-secondary); display: block; margin-bottom: 4px; letter-spacing: 0.5px;">Secret Key (Manual Entry)</span>
                            <code style="font-size: 14px; font-weight: 700; color: var(--text-primary); user-select: all; word-break: break-all; letter-spacing: 1px;">${secret}</code>
                        </div>
                        <p style="font-size: 13px; color: var(--text-secondary); margin-bottom: 24px;">Scan this QR code with Google Authenticator or Authy, or manually enter the secret key, then input the 6-digit code below.</p>
                        <input type="text" id="totp-code" maxlength="6" placeholder="000000" style="width: 140px; height: 44px; text-align: center; font-size: 24px; letter-spacing: 4px; font-weight: 800; border: 1px solid var(--border); border-radius: 8px; background: var(--bg-sub); color: var(--text-primary);">
                        <div style="margin-top: 32px; display: flex; gap: 12px; justify-content: center;">
                            <button class="btn btn-primary" id="btn-totp-verify">Verify & Enable</button>
                            <button class="btn" onclick="closeModal()">Cancel</button>
                        </div>
                    </div>
                `,
                onRender: (content) => {
                    const qrContainer = content.querySelector('#mfa-qrcode');
                    if (qrContainer && window.QRCode) {
                        new window.QRCode(qrContainer, {
                            text: uri,
                            width: 180,
                            height: 180,
                            colorDark: "#000000",
                            colorLight: "#ffffff",
                            correctLevel: window.QRCode.CorrectLevel.M
                        });
                    } else if (qrContainer) {
                        qrContainer.innerHTML = `<div style="font-size: 10px; color: black; word-break: break-all; padding: 10px;">${uri}</div>`;
                    }

                    content.querySelector('#btn-totp-verify').onclick = async () => {
                        const token = content.querySelector('#totp-code').value.trim();
                        if (token.length !== 6) {
                            alert('Please enter a valid 6-digit code.');
                            return;
                        }
                        try {
                            const res = await fetch('/api/system/2fa/verify', {
                                method: 'POST',
                                headers: {
                                    'Content-Type': 'application/json',
                                    'X-FortenLog-Request': 'true',
                                    'Authorization': `Bearer ${store.sessionToken}`
                                },
                                body: JSON.stringify({ token, secret })
                            });
                            if (res.status === 200) {
                                window.closeModal();
                                alert('MFA successfully activated on your account!');
                            } else {
                                alert('MFA Verification failed: Invalid token code.');
                            }
                        } catch (err) {
                            alert('Verification failed: ' + err.message);
                        }
                    };
                }
            }
        }));
    } catch (e) {
        alert('Failed to configure 2FA: ' + e.message);
    }
};

window.registerPasskey = () => {
    window.dispatchEvent(new CustomEvent('open-modal', {
        detail: {
            title: 'Register Hardware Security Key',
            html: `
                <div style="text-align: center; padding: 30px;">
                    <div style="font-size: 48px; margin-bottom: 20px;">🔑</div>
                    <p style="margin-bottom: 30px;">FortenLog supports FIDO2/WebAuthn keys (YubiKey, Windows Hello, FaceID).<br>Click the button below to start registration.</p>
                    <button class="btn btn-primary" style="padding: 12px 40px;" id="btn-start-webauthn">Start Registration</button>
                </div>
            `,
            onRender: (content) => {
                content.querySelector('#btn-start-webauthn').onclick = async () => {
                    try {
                        const apiRes = await api('/api/system/webauthn/register/start', { method: 'POST' });
                        const rcr = apiRes.data;

                        if (!rcr || !rcr.publicKey) {
                            throw new Error(apiRes.error || 'Failed to start WebAuthn registration');
                        }

                        // Convert challenge and user.id from base64 string to ArrayBuffer for WebAuthn API
                        rcr.publicKey.challenge = base64ToBuffer(rcr.publicKey.challenge);
                        rcr.publicKey.user.id = base64ToBuffer(rcr.publicKey.user.id);

                        const credential = await navigator.credentials.create(rcr);

                        const response = {
                            id: credential.id,
                            rawId: bufferToBase64(credential.rawId),
                            type: credential.type,
                            response: {
                                clientDataJSON: bufferToBase64(credential.response.clientDataJSON),
                                attestationObject: bufferToBase64(credential.response.attestationObject),
                            }
                        };

                        await api('/api/system/webauthn/register/finish', {
                            method: 'POST',
                            body: JSON.stringify(response)
                        });

                        window.closeModal();
                        alert('Hardware Security Key registered successfully!');
                    } catch (e) {
                        console.error('Passkey registration failed', e);
                        alert('Passkey registration failed: ' + e.message);
                    }
                };
            }
        }
    }));
};

window.toggleChannel = async (channel, enabled) => {
    try {
        await api('/api/system/settings', {
            method: 'POST',
            body: JSON.stringify({ [`alert_channel_${channel}`]: enabled ? "true" : "false" })
        });
    } catch (e) {
        console.error("Failed to update channel", e);
        alert("Failed to update alert channel: " + e.message);
    }
};

window.configureChannel = async (channel) => {
    let settings = {
        smtp_server: "smtp.fortenlog.io",
        smtp_port: "587",
        smtp_recipient: "admin@fortenlog.io",
        slack_webhook_url: "",
        webhook_endpoint_url: ""
    };
    try {
        const data = await api('/api/system/settings');
        settings = { ...settings, ...data };
    } catch (e) {
        console.error("Failed to fetch settings", e);
    }

    let html = '';
    if (channel === 'email') {
        html = `
            <div style="display: flex; flex-direction: column; gap: 16px;">
                <div><label class="font-bold" style="font-size: 11px;">SMTP SERVER</label><input type="text" id="cfg-smtp-server" class="code-block" style="width:100%" value="${settings.smtp_server}"></div>
                <div><label class="font-bold" style="font-size: 11px;">PORT</label><input type="text" id="cfg-smtp-port" class="code-block" style="width:100%" value="${settings.smtp_port}"></div>
                <div><label class="font-bold" style="font-size: 11px;">RECIPIENT ADDRESS</label><input type="email" id="cfg-smtp-recipient" class="code-block" style="width:100%" value="${settings.smtp_recipient}"></div>
                <button class="btn btn-primary" id="btn-save-smtp">Save SMTP Settings</button>
            </div>
        `;
    } else if (channel === 'slack') {
        html = `
            <div style="display: flex; flex-direction: column; gap: 16px;">
                <div><label class="font-bold" style="font-size: 11px;">SLACK WEBHOOK URL</label><input type="text" id="cfg-slack-url" class="code-block" style="width:100%" value="${settings.slack_webhook_url}" placeholder="https://hooks.slack.com/services/..."></div>
                <button class="btn btn-primary" id="btn-save-slack">Save Configuration</button>
            </div>
        `;
    } else {
        html = `
            <div style="display: flex; flex-direction: column; gap: 16px;">
                <div><label class="font-bold" style="font-size: 11px;">ENDPOINT URL</label><input type="text" id="cfg-webhook-url" class="code-block" style="width:100%" value="${settings.webhook_endpoint_url}" placeholder="https://my-server.com/alerts"></div>
                <button class="btn btn-primary" id="btn-save-webhook">Save Configuration</button>
            </div>
        `;
    }

    window.dispatchEvent(new CustomEvent('open-modal', {
        detail: {
            title: `Configure ${channel.toUpperCase()}`,
            html,
            onRender: (content) => {
                const saveBtn = content.querySelector('button');
                if (saveBtn) {
                    saveBtn.onclick = async () => {
                        let payload = {};
                        if (channel === 'email') {
                            payload = {
                                smtp_server: content.querySelector('#cfg-smtp-server').value,
                                smtp_port: content.querySelector('#cfg-smtp-port').value,
                                smtp_recipient: content.querySelector('#cfg-smtp-recipient').value,
                            };
                        } else if (channel === 'slack') {
                            payload = {
                                slack_webhook_url: content.querySelector('#cfg-slack-url').value,
                            };
                        } else {
                            payload = {
                                webhook_endpoint_url: content.querySelector('#cfg-webhook-url').value,
                            };
                        }

                        try {
                            await api('/api/system/settings', {
                                method: 'POST',
                                body: JSON.stringify(payload)
                            });
                            window.closeModal();
                            alert(`${channel.toUpperCase()} Alerting configuration saved!`);
                        } catch (e) {
                            alert("Failed to save settings: " + e.message);
                        }
                    };
                }
            }
        }
    }));
};
