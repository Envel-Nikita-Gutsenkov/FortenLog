const SCOPES_META = [
  { id: 'issues:read',  label: 'Issues',  desc: 'List and read issues' },
  { id: 'events:read',  label: 'Events',  desc: 'Read raw events & event details' },
  { id: 'stats:read',   label: 'Stats',   desc: 'Project aggregate statistics' },
  { id: 'uptime:read',  label: 'Uptime',  desc: 'Uptime monitors & logs' },
];

export async function renderApiKeysView(container) {
  container.innerHTML = `
    <div class="view-header">
      <div>
        <h1 class="view-title">API Keys</h1>
        <p class="view-subtitle">Programmatic read-only access via Bearer token authentication</p>
      </div>
      <button class="btn btn-primary" id="btn-create-key">
        <svg width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
        New API Key
      </button>
    </div>

    <div class="api-keys-info-banner">
      <svg width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
      <div>
        Keys use <code>Authorization: Bearer flpat_...</code> — scoped read-only access to <code>/v1/</code> endpoints.
        Raw keys are shown <strong>once</strong> at creation time and cannot be retrieved again.
      </div>
    </div>

    <div class="api-keys-table-wrap" id="api-keys-list">
      <div class="loading-spinner-wrap"><div class="spinner"></div></div>
    </div>

    <div id="modal-create-key" class="modal-overlay" style="display:none">
      <div class="modal-box modal-lg">
        <div class="modal-header">
          <h2>Create API Key</h2>
          <button class="modal-close" id="btn-close-create">&times;</button>
        </div>
        <div class="modal-body">
          <div class="form-group">
            <label class="form-label">Key Name <span class="required">*</span></label>
            <input type="text" id="key-name" class="form-input" placeholder="e.g. CI Monitor, Dashboard Bot" maxlength="128">
          </div>

          <div class="form-group">
            <label class="form-label">Projects <span class="required">*</span></label>
            <div class="api-keys-project-list" id="project-checkboxes">
              <div class="loading-spinner-wrap"><div class="spinner spinner-sm"></div></div>
            </div>
          </div>

          <div class="form-group">
            <label class="form-label">Scopes <span class="required">*</span></label>
            <div class="scope-grid">
              ${SCOPES_META.map(s => `
                <label class="scope-card" for="scope-${s.id}">
                  <input type="checkbox" id="scope-${s.id}" value="${s.id}" class="scope-checkbox">
                  <div class="scope-card-content">
                    <span class="scope-name">${s.label}</span>
                    <span class="scope-desc">${s.desc}</span>
                  </div>
                </label>
              `).join('')}
            </div>
          </div>

          <div class="form-group">
            <label class="form-label">Expires in</label>
            <select id="key-expiry" class="form-select">
              <option value="">Never</option>
              <option value="30">30 days</option>
              <option value="90">90 days</option>
              <option value="180">180 days</option>
              <option value="365">1 year</option>
            </select>
          </div>

          <div class="form-group">
            <label class="form-label">IP Allowlist <span class="form-hint">(optional — one IP or CIDR per line)</span></label>
            <textarea id="key-ips" class="form-input form-textarea" rows="3"
              placeholder="192.168.1.10&#10;10.0.0.0/8"></textarea>
          </div>

          <div id="create-key-error" class="form-error" style="display:none"></div>
        </div>
        <div class="modal-footer">
          <button class="btn btn-ghost" id="btn-cancel-create">Cancel</button>
          <button class="btn btn-primary" id="btn-submit-create">Create Key</button>
        </div>
      </div>
    </div>

    <div id="modal-show-key" class="modal-overlay" style="display:none">
      <div class="modal-box">
        <div class="modal-header">
          <h2>🔑 Your New API Key</h2>
        </div>
        <div class="modal-body">
          <div class="key-reveal-banner">
            <svg width="20" height="20" fill="none" stroke="#f0a03a" stroke-width="2" viewBox="0 0 24 24"><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
            <p>This key will <strong>never be shown again</strong>. Copy and store it securely now.</p>
          </div>
          <div class="key-display-wrap">
            <code id="key-display-value" class="key-display-code"></code>
            <button class="btn-copy-key" id="btn-copy-key" title="Copy to clipboard">
              <svg width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>
            </button>
          </div>
        </div>
        <div class="modal-footer" style="justify-content:flex-end">
          <button class="btn btn-primary" id="btn-close-reveal">I've saved my key</button>
        </div>
      </div>
    </div>

    <div id="modal-confirm-revoke" class="modal-overlay" style="display:none">
      <div class="modal-box modal-sm">
        <div class="modal-header">
          <h2>Revoke API Key</h2>
        </div>
        <div class="modal-body">
          <p>Revoke <strong id="revoke-key-name"></strong>? This is irreversible — any integrations using this key will immediately lose access.</p>
        </div>
        <div class="modal-footer">
          <button class="btn btn-ghost" id="btn-cancel-revoke">Cancel</button>
          <button class="btn btn-danger" id="btn-confirm-revoke">Revoke Key</button>
        </div>
      </div>
    </div>
  `;

  await loadKeys(container);
  setupEvents(container);
}

async function loadKeys(container) {
  const listEl = container.querySelector('#api-keys-list');
  try {
    const res = await fetch('/api/system/api-keys', {
      headers: { 'X-FortenLog-Request': 'true' },
      credentials: 'include',
    });
    if (!res.ok) throw new Error(res.status);
    const keys = await res.json();
    renderTable(listEl, keys);
  } catch {
    listEl.innerHTML = '<div class="empty-state"><p>Failed to load API keys.</p></div>';
  }
}

function renderTable(el, keys) {
  if (!keys || keys.length === 0) {
    el.innerHTML = `
      <div class="empty-state">
        <svg width="48" height="48" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24" opacity=".4"><path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 11-7.778 7.778 5.5 5.5 0 017.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4"/></svg>
        <p>No API keys yet. Create one to get started.</p>
      </div>`;
    return;
  }

  el.innerHTML = `
    <table class="data-table">
      <thead>
        <tr>
          <th>Name</th>
          <th>Key Prefix</th>
          <th>Projects</th>
          <th>Scopes</th>
          <th>Expires</th>
          <th>Last Used</th>
          <th>Status</th>
          <th></th>
        </tr>
      </thead>
      <tbody>
        ${keys.map(k => `
          <tr data-key-id="${k.id}" data-key-name="${escHtml(k.name)}">
            <td class="font-medium">${escHtml(k.name)}</td>
            <td><code class="key-prefix-code">${escHtml(k.key_prefix)}...</code></td>
            <td>${renderProjectIds(k.project_ids)}</td>
            <td>${renderScopes(k.scopes)}</td>
            <td class="text-muted">${k.expires_at ? formatDate(k.expires_at) : '—'}</td>
            <td class="text-muted">${k.last_used_at ? formatDate(k.last_used_at) : 'Never'}</td>
            <td>${renderStatus(k.status)}</td>
            <td class="table-actions">
              ${k.status !== 'revoked' ? `<button class="btn-icon btn-danger-icon btn-revoke-key" title="Revoke">
                <svg width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>
              </button>` : ''}
            </td>
          </tr>
        `).join('')}
      </tbody>
    </table>`;
}

function renderProjectIds(ids) {
  if (!ids || ids.length === 0) return '<span class="text-muted">—</span>';
  if (ids.includes('*')) return '<span class="badge badge-all">All Projects</span>';
  return ids.map(id => `<span class="badge badge-project">${escHtml(id)}</span>`).join(' ');
}

function renderScopes(scopes) {
  if (!scopes || scopes.length === 0) return '<span class="text-muted">—</span>';
  return scopes.map(s => `<span class="badge badge-scope">${escHtml(s)}</span>`).join(' ');
}

function renderStatus(status) {
  const map = {
    active:  '<span class="status-badge status-active">Active</span>',
    revoked: '<span class="status-badge status-revoked">Revoked</span>',
    expired: '<span class="status-badge status-expired">Expired</span>',
  };
  return map[status] || status;
}

function formatDate(iso) {
  try {
    return new Date(iso).toLocaleDateString('en-GB', { year: 'numeric', month: 'short', day: 'numeric' });
  } catch { return iso; }
}

function escHtml(str) {
  return String(str ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function setupEvents(container) {
  let revokeTargetId = null;

  container.querySelector('#btn-create-key').addEventListener('click', async () => {
    await loadProjects(container);
    openModal('modal-create-key');
  });
  container.querySelector('#btn-close-create').addEventListener('click', () => closeModal('modal-create-key'));
  container.querySelector('#btn-cancel-create').addEventListener('click', () => closeModal('modal-create-key'));

  container.querySelector('#btn-submit-create').addEventListener('click', async () => {
    await submitCreateKey(container);
  });

  container.querySelector('#btn-close-reveal').addEventListener('click', async () => {
    closeModal('modal-show-key');
    await loadKeys(container);
  });

  container.querySelector('#btn-copy-key').addEventListener('click', () => {
    const val = container.querySelector('#key-display-value').textContent;
    navigator.clipboard.writeText(val).then(() => {
      const btn = container.querySelector('#btn-copy-key');
      btn.classList.add('copied');
      setTimeout(() => btn.classList.remove('copied'), 2000);
    });
  });

  container.querySelector('#btn-cancel-revoke').addEventListener('click', () => closeModal('modal-confirm-revoke'));
  container.querySelector('#btn-confirm-revoke').addEventListener('click', async () => {
    if (!revokeTargetId) return;
    try {
      await fetch(`/api/system/api-keys/${revokeTargetId}`, {
        method: 'DELETE',
        headers: { 'X-FortenLog-Request': 'true' },
        credentials: 'include',
      });
    } finally {
      closeModal('modal-confirm-revoke');
      await loadKeys(container);
    }
  });

  container.querySelector('#api-keys-list').addEventListener('click', e => {
    const btn = e.target.closest('.btn-revoke-key');
    if (!btn) return;
    const row = btn.closest('tr');
    revokeTargetId = row.dataset.keyId;
    container.querySelector('#revoke-key-name').textContent = row.dataset.keyName;
    openModal('modal-confirm-revoke');
  });
}

async function loadProjects(container) {
  const wrap = container.querySelector('#project-checkboxes');
  wrap.innerHTML = '<div class="loading-spinner-wrap"><div class="spinner spinner-sm"></div></div>';
  try {
    const res = await fetch('/api/settings/projects', {
      headers: { 'X-FortenLog-Request': 'true' },
      credentials: 'include',
    });
    const projects = await res.json();
    wrap.innerHTML = projects.map(p => `
      <label class="project-check-item" for="proj-${escHtml(p.id)}">
        <input type="checkbox" id="proj-${escHtml(p.id)}" value="${escHtml(p.id)}" class="proj-checkbox">
        <span class="proj-check-name">${escHtml(p.name)}</span>
        <span class="proj-check-id text-muted">${escHtml(p.id)}</span>
      </label>
    `).join('') || '<p class="text-muted">No projects found.</p>';
  } catch {
    wrap.innerHTML = '<p class="form-error">Failed to load projects.</p>';
  }
}

async function submitCreateKey(container) {
  const name = container.querySelector('#key-name').value.trim();
  const projectIds = [...container.querySelectorAll('.proj-checkbox:checked')].map(c => c.value);
  const scopes = [...container.querySelectorAll('.scope-checkbox:checked')].map(c => c.value);
  const expiryDays = container.querySelector('#key-expiry').value;
  const ipsRaw = container.querySelector('#key-ips').value.trim();
  const errEl = container.querySelector('#create-key-error');
  errEl.style.display = 'none';

  if (!name) { showError(errEl, 'Name is required.'); return; }
  if (!projectIds.length) { showError(errEl, 'Select at least one project.'); return; }
  if (!scopes.length) { showError(errEl, 'Select at least one scope.'); return; }

  const allowedIps = ipsRaw ? ipsRaw.split('\n').map(s => s.trim()).filter(Boolean) : null;

  const body = {
    name,
    project_ids: projectIds,
    scopes,
    allowed_ips: allowedIps,
    expires_in_days: expiryDays ? parseInt(expiryDays, 10) : null,
  };

  const btn = container.querySelector('#btn-submit-create');
  btn.disabled = true;
  btn.textContent = 'Creating...';

  try {
    const res = await fetch('/api/system/api-keys', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-FortenLog-Request': 'true',
      },
      credentials: 'include',
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const msg = res.status === 422 ? 'Invalid input — check name, scopes, and IPs.' : `Error ${res.status}`;
      showError(errEl, msg);
      return;
    }

    const data = await res.json();
    closeModal('modal-create-key');
    container.querySelector('#key-display-value').textContent = data.key;
    openModal('modal-show-key');
  } catch {
    showError(errEl, 'Network error. Please try again.');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Create Key';
  }
}

function showError(el, msg) {
  el.textContent = msg;
  el.style.display = 'block';
}

function openModal(id) {
  document.getElementById(id).style.display = 'flex';
  document.body.style.overflow = 'hidden';
}

function closeModal(id) {
  document.getElementById(id).style.display = 'none';
  document.body.style.overflow = '';
}
