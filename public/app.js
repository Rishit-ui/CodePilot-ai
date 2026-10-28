// CodePilot AI — Client-Side Application Controller
const state = {
  projects: [],
  activeProject: null,
  activeRevision: null,
  activeFile: null
};

// Utilities
const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => document.querySelectorAll(selector);

async function api(url, options = {}) {
  const res = await fetch(url, options);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error?.message || `Request failed with HTTP ${res.status}`);
  }
  return data;
}

function showFeedback(selector, message, isError = false) {
  const el = $(selector);
  if (!el) return;
  el.textContent = message;
  el.classList.toggle('error', isError);
  if (!isError && message) {
    setTimeout(() => { if (el.textContent === message) el.textContent = ''; }, 6000);
  }
}

function escapeHtml(str) {
  return (str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// Service Status Check
async function checkHealth() {
  const pill = $('#service-pill');
  try {
    const health = await api('/api/health');
    pill.textContent = `Online · v${health.version}`;
    pill.className = 'pill pill-online';
  } catch {
    pill.textContent = 'Service Offline';
    pill.className = 'pill pill-idle';
  }
}

// Project Management
async function loadProjects() {
  try {
    const data = await api('/api/projects');
    state.projects = data.projects;
    renderProjectChips();
    if (!state.activeProject && data.projects.length > 0) {
      selectProject(data.projects[0].id);
    }
  } catch (err) {
    showFeedback('#project-feedback', err.message, true);
  }
}

function renderProjectChips() {
  const container = $('#projects-container');
  container.innerHTML = '';
  if (!state.projects.length) {
    container.innerHTML = '<span class="muted" style="font-size:0.85rem;">No projects yet. Create one above to begin.</span>';
    return;
  }

  state.projects.forEach((p) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `chip-btn ${state.activeProject === p.id ? 'active' : ''}`;
    btn.innerHTML = `<span>${escapeHtml(p.name)}</span> <small class="badge badge-accent">${p.latest_status || 'New'}</small>`;
    btn.addEventListener('click', () => selectProject(p.id));
    container.appendChild(btn);
  });
}

async function selectProject(projectId) {
  state.activeProject = projectId;
  renderProjectChips();

  try {
    const data = await api(`/api/projects/${encodeURIComponent(projectId)}`);
    $('#workspace-container').classList.remove('hidden');
    $('#active-project-name').textContent = data.project.name;

    const reportBtn = $('#btn-export-report');
    if (data.revision) {
      state.activeRevision = data.revision.id;
      $('#active-revision-info').textContent = `Revision ${data.revision.id.slice(-8)} · ${data.revision.status} · ${new Date(data.revision.created_at).toLocaleString()}`;
      reportBtn.classList.remove('hidden');
      reportBtn.href = `/api/projects/${encodeURIComponent(projectId)}/architecture-report.md`;
    } else {
      state.activeRevision = null;
      $('#active-revision-info').textContent = 'No revision imported yet.';
      reportBtn.classList.add('hidden');
    }

    renderStats(data.counts);
    await refreshActiveTab();
  } catch (err) {
    showFeedback('#project-feedback', err.message, true);
  }
}

function renderStats(counts = {}) {
  const container = $('#stats-overview');
  container.innerHTML = `
    <div class="stat-card">
      <span class="stat-value">${counts.files || 0}</span>
      <span class="stat-label">Source Files</span>
    </div>
    <div class="stat-card">
      <span class="stat-value">${counts.symbols || 0}</span>
      <span class="stat-label">Indexed Symbols</span>
    </div>
    <div class="stat-card">
      <span class="stat-value">${counts.edges || 0}</span>
      <span class="stat-label">Dependency Edges</span>
    </div>
    <div class="stat-card">
      <span class="stat-value">${counts.findings || 0}</span>
      <span class="stat-label">Diagnostic Findings</span>
    </div>
  `;
}

// Ingestion Tab Switching
window.switchImportTab = function(type) {
  $('#tab-btn-zip').classList.toggle('active', type === 'zip');
  $('#tab-btn-url').classList.toggle('active', type === 'url');
  $('#zip-import-form').classList.toggle('hidden', type !== 'zip');
  $('#url-import-form').classList.toggle('hidden', type !== 'url');
};

// Tab Switching
function initTabs() {
  $$('.nav-tab').forEach((tab) => {
    tab.addEventListener('click', async () => {
      $$('.nav-tab').forEach((t) => t.classList.remove('active'));
      $$('.tab-panel').forEach((p) => p.classList.add('hidden'));

      tab.classList.add('active');
      const targetId = tab.dataset.tab;
      $(`#${targetId}`).classList.remove('hidden');
      await refreshActiveTab();
    });
  });
}

async function refreshActiveTab() {
  if (!state.activeProject) return;
  const activeTab = $('.nav-tab.active')?.dataset.tab;

  switch (activeTab) {
    case 'tab-arch':
      await loadArchitectureGraph();
      break;
    case 'tab-code':
      await loadFileList();
      break;
    case 'tab-findings':
      await loadFindings();
      break;
    case 'tab-planner':
      await loadPlans();
      break;
    case 'tab-patches':
      await loadPatches();
      break;
    case 'tab-docker':
      await loadDockerAssistant();
      break;
    case 'tab-deploy':
      await loadDeploymentReadiness();
      break;
    case 'tab-audit':
      await loadAuditLog();
      break;
  }
}

// Architecture Graph
async function loadArchitectureGraph() {
  const svg = $('#architecture-graph');
  if (!state.activeRevision) {
    svg.innerHTML = '<text x="50%" y="50%" fill="#94a3b8" text-anchor="middle">Import a revision to generate the dependency graph.</text>';
    return;
  }

  try {
    const data = await api(`/api/projects/${encodeURIComponent(state.activeProject)}/graph`);
    svg.innerHTML = '';

    const nodes = data.nodes.slice(0, 36);
    const cols = Math.min(6, Math.max(3, Math.ceil(Math.sqrt(nodes.length))));
    const cellWidth = 800 / cols;
    const cellHeight = 360 / Math.ceil(nodes.length / cols);

    const positions = new Map();
    nodes.forEach((n, idx) => {
      const col = idx % cols;
      const row = Math.floor(idx / cols);
      positions.set(n.id, {
        x: 40 + col * cellWidth + cellWidth / 2,
        y: 40 + row * cellHeight + 15
      });
    });

    // Render edges
    data.edges.forEach((edge) => {
      const p1 = positions.get(edge.source);
      const p2 = positions.get(edge.target);
      if (!p1 || !p2) return;

      const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      line.setAttribute('x1', p1.x);
      line.setAttribute('y1', p1.y);
      line.setAttribute('x2', p2.x);
      line.setAttribute('y2', p2.y);
      line.setAttribute('class', 'graph-edge');
      svg.appendChild(line);
    });

    // Render nodes
    nodes.forEach((n) => {
      const pos = positions.get(n.id);
      if (!pos) return;

      const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
      const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
      rect.setAttribute('x', pos.x - 55);
      rect.setAttribute('y', pos.y - 14);
      rect.setAttribute('width', 110);
      rect.setAttribute('height', 28);
      rect.setAttribute('rx', 6);
      rect.setAttribute('class', 'graph-node');

      const label = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      label.setAttribute('x', pos.x);
      label.setAttribute('y', pos.y + 4);
      label.setAttribute('text-anchor', 'middle');
      label.setAttribute('class', 'graph-label');
      const shortName = n.label.length > 15 ? `…${n.label.slice(-13)}` : n.label;
      label.textContent = shortName;

      g.appendChild(rect);
      g.appendChild(label);
      g.addEventListener('click', () => {
        // Switch to code tab and select file
        $('[data-tab="tab-code"]').click();
        viewFile(n.id);
      });
      svg.appendChild(g);
    });
  } catch (err) {
    svg.innerHTML = `<text x="50%" y="50%" fill="#f43f5e" text-anchor="middle">Error loading graph: ${escapeHtml(err.message)}</text>`;
  }
}

// Code Explorer
async function loadFileList() {
  const container = $('#file-list-container');
  if (!state.activeRevision) {
    container.innerHTML = '<span class="muted">No revision files.</span>';
    return;
  }

  const query = ($('#file-search-input').value || '').trim();
  try {
    const data = await api(`/api/projects/${encodeURIComponent(state.activeProject)}/files?q=${encodeURIComponent(query)}`);
    container.innerHTML = '';

    if (!data.files.length) {
      container.innerHTML = '<span class="muted">No matching files found.</span>';
      return;
    }

    data.files.forEach((f) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = `file-entry-btn ${state.activeFile === f.path ? 'active' : ''}`;
      btn.disabled = Boolean(f.excludedReason);
      btn.innerHTML = `<span>${escapeHtml(f.path)}</span> <small class="muted">${f.language || 'Plain'}</small>`;
      btn.addEventListener('click', () => viewFile(f.path));
      container.appendChild(btn);
    });

    if (!state.activeFile && data.files.length > 0 && !data.files[0].excludedReason) {
      viewFile(data.files[0].path);
    }
  } catch (err) {
    container.innerHTML = `<span class="muted">${escapeHtml(err.message)}</span>`;
  }
}

async function viewFile(filePath) {
  state.activeFile = filePath;
  $$('.file-entry-btn').forEach((b) => b.classList.toggle('active', b.querySelector('span')?.textContent === filePath));

  $('#selected-file-label').textContent = filePath;
  const preview = $('#code-preview');
  preview.textContent = 'Loading source content…';

  try {
    const data = await api(`/api/projects/${encodeURIComponent(state.activeProject)}/file?path=${encodeURIComponent(filePath)}`);
    $('#redaction-badge').classList.toggle('hidden', !data.file.content?.includes('[REDACTED'));
    preview.textContent = data.file.content || '[Binary or empty file]';
  } catch (err) {
    $('#redaction-badge').classList.add('hidden');
    preview.textContent = `Unable to load file: ${err.message}`;
  }
}

// AI Assistant
async function handleAiSubmit(e) {
  e.preventDefault();
  const input = $('#ai-question-input');
  const question = input.value.trim();
  if (!question || !state.activeProject) return;

  const box = $('#ai-response-area');
  box.innerHTML = '<p class="muted">Searching current revision index and retrieving grounded evidence…</p>';

  try {
    const res = await api(`/api/projects/${encodeURIComponent(state.activeProject)}/ask`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question })
    });

    box.innerHTML = `<div>${escapeHtml(res.answer).replace(/\n/g, '<br>')}</div>`;

    if (res.citations && res.citations.length > 0) {
      const citeHeader = document.createElement('h4');
      citeHeader.className = 'subheading';
      citeHeader.style.marginTop = '1rem';
      citeHeader.textContent = 'Grounded Citations';
      box.appendChild(citeHeader);

      res.citations.forEach((c) => {
        const citeEl = document.createElement('div');
        citeEl.className = 'citation-box';
        citeEl.innerHTML = `<strong>${escapeHtml(c.path)}:${c.line}</strong><br><code>${escapeHtml(c.excerpt)}</code>`;
        box.appendChild(citeEl);
      });
    }
  } catch (err) {
    box.innerHTML = `<p class="badge-danger" style="padding:0.5rem;border-radius:4px;">${escapeHtml(err.message)}</p>`;
  }
}

// Findings & Diagnostics
async function loadFindings() {
  const container = $('#findings-list-container');
  if (!state.activeRevision) {
    container.innerHTML = '<p class="muted">No revision imported.</p>';
    return;
  }

  const filter = $('#findings-filter-select').value;
  try {
    const data = await api(`/api/projects/${encodeURIComponent(state.activeProject)}/findings`);
    container.innerHTML = '';

    const list = filter === 'all' ? data.findings : data.findings.filter((f) => f.severity === filter);
    if (!list.length) {
      container.innerHTML = '<p class="muted">No findings matching the selected filter.</p>';
      return;
    }

    list.forEach((f) => {
      const card = document.createElement('div');
      card.className = 'finding-card';

      let sevClass = 'badge-accent';
      if (f.severity === 'critical' || f.severity === 'high') sevClass = 'badge-danger';
      else if (f.severity === 'medium') sevClass = 'badge-warning';

      card.innerHTML = `
        <div class="finding-main">
          <div>
            <span class="badge ${sevClass}">${f.severity}</span>
            <span class="badge" style="background:#1e293b;margin-left:0.3rem;">${f.category}</span>
            ${f.status === 'suppressed' ? '<span class="badge badge-warning">Suppressed</span>' : ''}
            <strong style="margin-left:0.5rem;font-size:0.9rem;">${escapeHtml(f.message)}</strong>
          </div>
          <div class="finding-meta">
            ${f.filePath ? `${escapeHtml(f.filePath)}${f.line ? `:${f.line}` : ''}` : 'Repository-level'}
            ${f.evidence ? ` · Evidence: <code>${escapeHtml(f.evidence)}</code>` : ''}
            ${f.suppression_reason ? `<br><span class="muted">Suppression justification: ${escapeHtml(f.suppression_reason)}</span>` : ''}
          </div>
        </div>
      `;

      if (f.status !== 'suppressed') {
        const suppressBtn = document.createElement('button');
        suppressBtn.type = 'button';
        suppressBtn.className = 'btn btn-secondary';
        suppressBtn.style.padding = '0.3rem 0.6rem';
        suppressBtn.style.fontSize = '0.75rem';
        suppressBtn.textContent = 'Suppress';
        suppressBtn.addEventListener('click', async () => {
          const reason = prompt('Provide required audit justification for suppressing this finding:');
          if (!reason || !reason.trim()) return;
          try {
            await api(`/api/projects/${encodeURIComponent(state.activeProject)}/findings/${encodeURIComponent(f.id)}/suppress`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ reason: reason.trim() })
            });
            await loadFindings();
          } catch (err) {
            alert(err.message);
          }
        });
        card.appendChild(suppressBtn);
      }

      container.appendChild(card);
    });
  } catch (err) {
    container.innerHTML = `<p class="muted">${escapeHtml(err.message)}</p>`;
  }
}

// Implementation Planner
async function loadPlans() {
  const container = $('#plans-container');
  if (!state.activeProject) return;

  try {
    const data = await api(`/api/projects/${encodeURIComponent(state.activeProject)}/plans`);
    container.innerHTML = '';

    if (!data.plans.length) {
      container.innerHTML = '<p class="muted">No implementation plans generated yet. Describe a requirement above.</p>';
      return;
    }

    data.plans.forEach((p) => {
      const card = document.createElement('div');
      card.className = 'plan-card';
      card.innerHTML = `
        <div class="panel-header-split">
          <div>
            <h4 class="subheading">${escapeHtml(p.title)}</h4>
            <span class="badge badge-accent">Complexity: ${p.complexity}</span>
            <span class="badge" style="background:#1e293b;margin-left:0.3rem;">Status: ${p.status}</span>
          </div>
          <small class="muted">${new Date(p.created_at).toLocaleDateString()}</small>
        </div>
        <p style="font-size:0.875rem;margin-bottom:0.75rem;">${escapeHtml(p.requirement)}</p>
        <div id="plan-tasks-${p.id}" class="task-list">Loading tasks…</div>
      `;
      container.appendChild(card);
      loadPlanTasks(p.id);
    });
  } catch (err) {
    container.innerHTML = `<p class="muted">${escapeHtml(err.message)}</p>`;
  }
}

async function loadPlanTasks(planId) {
  const container = $(`#plan-tasks-${planId}`);
  if (!container) return;

  try {
    const plan = await api(`/api/projects/${encodeURIComponent(state.activeProject)}/plans`);
    const fullPlan = plan.plans.find((p) => p.id === planId);
    // Fetch full tasks from list
    const data = await api(`/api/projects/${encodeURIComponent(state.activeProject)}/plans`);
    // Tasks can be updated directly
  } catch {}
}

async function handlePlannerSubmit(e) {
  e.preventDefault();
  const input = $('#planner-req-input');
  const requirement = input.value.trim();
  if (!requirement || !state.activeProject) return;

  try {
    await api(`/api/projects/${encodeURIComponent(state.activeProject)}/plans`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ requirement })
    });
    input.value = '';
    await loadPlans();
  } catch (err) {
    alert(err.message);
  }
}

// Patches & Diffs
async function loadPatches() {
  const container = $('#patches-container');
  if (!state.activeProject) return;

  try {
    const data = await api(`/api/projects/${encodeURIComponent(state.activeProject)}/patches`);
    container.innerHTML = '';

    if (!data.patches.length) {
      container.innerHTML = '<p class="muted">No patches recorded yet for this project.</p>';
      return;
    }

    data.patches.forEach((p) => {
      const card = document.createElement('div');
      card.className = 'patch-card';
      card.innerHTML = `
        <div class="panel-header-split">
          <div>
            <h4 class="subheading">${escapeHtml(p.title)}</h4>
            <span class="badge ${p.status === 'applied' ? 'badge-success' : p.status === 'rolled_back' ? 'badge-warning' : 'badge-accent'}">${p.status}</span>
            <small class="muted" style="margin-left:0.5rem;">Target: ${escapeHtml(p.target_file)}</small>
          </div>
          <small class="muted">${new Date(p.created_at).toLocaleString()}</small>
        </div>
        <pre>${escapeHtml(p.diff)}</pre>
        <div class="patch-actions">
          ${p.status === 'draft' ? `<button type="button" class="btn btn-accent btn-apply-patch" data-id="${p.id}">Apply Patch</button>` : ''}
          ${p.status === 'applied' ? `<button type="button" class="btn btn-secondary btn-rollback-patch" data-id="${p.id}">Rollback</button>` : ''}
        </div>
      `;
      container.appendChild(card);
    });

    $$('.btn-apply-patch').forEach((b) => b.addEventListener('click', async () => {
      try {
        await api(`/api/projects/${encodeURIComponent(state.activeProject)}/patches/${encodeURIComponent(b.dataset.id)}/apply`, { method: 'POST' });
        await loadPatches();
      } catch (err) { alert(err.message); }
    }));

    $$('.btn-rollback-patch').forEach((b) => b.addEventListener('click', async () => {
      try {
        await api(`/api/projects/${encodeURIComponent(state.activeProject)}/patches/${encodeURIComponent(b.dataset.id)}/rollback`, { method: 'POST' });
        await loadPatches();
      } catch (err) { alert(err.message); }
    }));
  } catch (err) {
    container.innerHTML = `<p class="muted">${escapeHtml(err.message)}</p>`;
  }
}

// Docker Assistant
async function loadDockerAssistant() {
  if (!state.activeProject) return;

  try {
    const data = await api(`/api/projects/${encodeURIComponent(state.activeProject)}/docker`);
    $('#docker-stack-badge').textContent = `Stack: ${data.stack.type.toUpperCase()}${data.stack.isNext ? ' (Next.js)' : ''}`;
    $('#dockerfile-preview').textContent = data.dockerfile;
    $('#compose-preview').textContent = data.dockerCompose;
  } catch (err) {
    $('#dockerfile-preview').textContent = `Error: ${err.message}`;
  }
}

// Deployment & Live Verification
async function loadDeploymentReadiness() {
  const container = $('#readiness-checklist');
  if (!state.activeProject || !state.activeRevision) {
    container.innerHTML = '<p class="muted">Import a revision to assess deployment readiness.</p>';
    return;
  }

  try {
    const readiness = await api(`/api/projects/${encodeURIComponent(state.activeProject)}/deployment-readiness`);
    container.innerHTML = '';

    readiness.checks.forEach((c) => {
      const row = document.createElement('div');
      row.className = 'readiness-row';
      const statusBadge = c.status === 'passed' ? 'badge-success' : c.status === 'blocked' ? 'badge-danger' : 'badge-warning';
      row.innerHTML = `
        <div>
          <strong>${escapeHtml(c.name)}</strong>
          <p class="muted" style="margin-top:0.2rem;font-size:0.8rem;">${escapeHtml(c.detail)}</p>
        </div>
        <span class="badge ${statusBadge}">${c.status}</span>
      `;
      container.appendChild(row);
    });

    await loadDeploymentsHistory();
  } catch (err) {
    container.innerHTML = `<p class="muted">${escapeHtml(err.message)}</p>`;
  }
}

async function loadDeploymentsHistory() {
  const container = $('#deployments-history');
  try {
    const data = await api(`/api/projects/${encodeURIComponent(state.activeProject)}/deployments`);
    container.innerHTML = '';

    if (!data.deployments.length) {
      container.innerHTML = '<p class="muted">No deployments triggered yet.</p>';
      return;
    }

    data.deployments.forEach((d) => {
      const card = document.createElement('div');
      card.className = 'deploy-card';
      const isVerified = d.status === 'verified';
      card.innerHTML = `
        <div class="panel-header-split">
          <div>
            <span class="badge ${isVerified ? 'badge-success' : 'badge-warning'}">${d.status}</span>
            <span class="badge" style="background:#1e293b;margin-left:0.3rem;">Provider: ${d.provider}</span>
            ${d.public_url ? `<a href="${d.public_url}" target="_blank" rel="noopener" style="margin-left:0.5rem;color:var(--accent-cyan);font-size:0.85rem;">${escapeHtml(d.public_url)}</a>` : ''}
          </div>
          <small class="muted">${new Date(d.created_at).toLocaleString()}</small>
        </div>
        <pre style="max-height:160px;margin-top:0.5rem;">${escapeHtml(d.logs || 'No log output')}</pre>
      `;
      container.appendChild(card);
    });
  } catch (err) {
    container.innerHTML = `<p class="muted">${escapeHtml(err.message)}</p>`;
  }
}

async function triggerDeployment() {
  const btn = $('#btn-trigger-deploy');
  const provider = $('#deploy-provider-select').value;
  btn.disabled = true;
  btn.textContent = 'Deploying & Verifying…';

  try {
    const res = await api(`/api/projects/${encodeURIComponent(state.activeProject)}/deploy`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider })
    });
    await loadDeploymentsHistory();
  } catch (err) {
    alert(`Deployment failed: ${err.message}`);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Deploy & Verify Live Application';
  }
}

// Audit Log
async function loadAuditLog() {
  const container = $('#audit-events-container');
  try {
    const data = await api('/api/audit');
    container.innerHTML = '';

    if (!data.events.length) {
      container.innerHTML = '<p class="muted">No audit events recorded.</p>';
      return;
    }

    data.events.forEach((e) => {
      const row = document.createElement('div');
      row.className = 'audit-row';
      row.innerHTML = `
        <div>
          <span class="badge badge-accent">${escapeHtml(e.action)}</span>
          <span style="margin-left:0.5rem;">${escapeHtml(e.detail)}</span>
        </div>
        <span class="muted">${new Date(e.created_at).toLocaleTimeString()}</span>
      `;
      container.appendChild(row);
    });
  } catch (err) {
    container.innerHTML = `<p class="muted">${escapeHtml(err.message)}</p>`;
  }
}

// Form Event Listeners
function initForms() {
  // Create Project
  $('#project-create-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const input = $('#new-project-name');
    const name = input.value.trim();
    if (!name) return;

    try {
      const data = await api('/api/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name })
      });
      input.value = '';
      showFeedback('#project-feedback', `Project "${name}" created.`);
      await loadProjects();
      await selectProject(data.project.id);
    } catch (err) {
      showFeedback('#project-feedback', err.message, true);
    }
  });

  // ZIP Ingest
  $('#zip-import-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const file = $('#zip-file-input').files[0];
    if (!state.activeProject || !file) return;

    showFeedback('#import-feedback', 'Ingesting ZIP archive and generating AST indexes…');
    try {
      const res = await api(`/api/projects/${encodeURIComponent(state.activeProject)}/import`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/zip' },
        body: file
      });
      showFeedback('#import-feedback', `Ingestion complete! Processed ${res.summary.files} files, ${res.summary.symbols} symbols, and ${res.summary.edges} dependency edges.`);
      await loadProjects();
      await selectProject(state.activeProject);
    } catch (err) {
      showFeedback('#import-feedback', err.message, true);
    }
  });

  // URL Ingest (SSRF-protected)
  $('#url-import-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const url = $('#remote-url-input').value.trim();
    if (!state.activeProject || !url) return;

    showFeedback('#import-feedback', 'Verifying remote host via SSRF shield & streaming archive…');
    try {
      const res = await api(`/api/projects/${encodeURIComponent(state.activeProject)}/import-url`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url })
      });
      showFeedback('#import-feedback', `Remote import complete! Ingested ${res.summary.files} files.`);
      await loadProjects();
      await selectProject(state.activeProject);
    } catch (err) {
      showFeedback('#import-feedback', err.message, true);
    }
  });

  // Code Explorer Search
  $('#file-search-input').addEventListener('input', () => loadFileList().catch(() => {}));

  // AI Assistant Form
  $('#ai-ask-form').addEventListener('submit', handleAiSubmit);

  // Planner Form
  $('#planner-form').addEventListener('submit', handlePlannerSubmit);

  // Deploy Trigger
  $('#btn-trigger-deploy').addEventListener('click', triggerDeployment);

  // Refresh Button
  $('#btn-refresh').addEventListener('click', () => {
    if (state.activeProject) selectProject(state.activeProject);
  });

  // Findings Filter
  $('#findings-filter-select').addEventListener('change', loadFindings);
}

// Initial Boot
window.addEventListener('DOMContentLoaded', async () => {
  initTabs();
  initForms();
  await checkHealth();
  await loadProjects();
});
