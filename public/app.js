// CodePilot AI — Professional Client-Side Application Controller
const state = {
  projects: [],
  activeProject: null,
  activeRevision: null,
  activeFile: null,
  activeConvo: null,
  activeNote: null,
  activeView: 'view-overview',
  activeOperation: null,
  operations: [],
  flow: {
    type: 'architecture',
    data: null,
    selectedNode: null,
    zoom: 1,
    panX: 0,
    panY: 0,
    isPanning: false,
    startX: 0,
    startY: 0
  }
};

// DOM Utilities
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

function openModal(modalId) {
  $(`#${modalId}`)?.classList.remove('hidden');
}

function closeModal(modalId) {
  $(`#${modalId}`)?.classList.add('hidden');
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

// Theme Management
function initTheme() {
  const saved = localStorage.getItem('codepilot_theme') || 'dark';
  document.documentElement.dataset.theme = saved;
  $('#btn-theme-toggle')?.addEventListener('click', () => {
    const current = document.documentElement.dataset.theme || 'dark';
    const next = current === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    localStorage.setItem('codepilot_theme', next);
  });
}

// Navigation & Dedicated Tool Pages
function navigateToView(viewId) {
  state.activeView = viewId;

  // Update sidebar active link
  $$('.sidebar-link').forEach((link) => {
    link.classList.toggle('active', link.dataset.view === viewId);
  });

  // Update page views
  $$('.page-view').forEach((page) => {
    page.classList.toggle('hidden', page.id !== viewId);
    page.classList.toggle('active', page.id === viewId);
  });

  // Update breadcrumb
  const link = $(`.sidebar-link[data-view="${viewId}"]`);
  const label = link?.querySelector('.nav-label')?.textContent || 'Overview';
  $('#bc-page').textContent = label;

  loadActiveView();
}

function loadActiveView() {
  if (!state.activeProject) return;
  switch (state.activeView) {
    case 'view-overview':
      loadRecentOperations();
      break;
    case 'view-operations':
      loadOperations();
      break;
    case 'view-flow':
      loadFlowDiagram();
      break;
    case 'view-code':
      loadFileList();
      break;
    case 'view-analysis':
      loadArchitectureReport();
      break;
    case 'view-ai':
      loadConversations();
      break;
    case 'view-planner':
      loadPlans();
      break;
    case 'view-patches':
      loadPatches();
      break;
    case 'view-findings':
      loadFindings();
      break;
    case 'view-api':
      loadApiStudio();
      break;
    case 'view-db':
      loadDbSchema();
      break;
    case 'view-docker':
      loadDocker();
      break;
    case 'view-deploy':
      loadDeployments();
      break;
    case 'view-tasks':
      loadTasks();
      break;
    case 'view-notes':
      loadNotes();
      break;
    case 'view-audit':
      loadAudit();
      break;
  }
}

// Project Management
async function loadProjects() {
  try {
    const data = await api('/api/projects');
    state.projects = data.projects;
    renderTopProjectSelect();
    if (!state.activeProject && data.projects.length > 0) {
      selectProject(data.projects[0].id);
    } else if (!data.projects.length) {
      $('#no-project-banner').classList.remove('hidden');
      $('#active-project-views').classList.add('hidden');
    }
  } catch (err) {
    showFeedback('#import-feedback', err.message, true);
  }
}

function renderTopProjectSelect() {
  const select = $('#top-project-select');
  if (!select) return;
  select.innerHTML = '<option value="">Select a project…</option>';
  state.projects.forEach((p) => {
    const opt = document.createElement('option');
    opt.value = p.id;
    opt.textContent = `${p.name} (${p.latest_status || 'New'})`;
    if (state.activeProject === p.id) opt.selected = true;
    select.appendChild(opt);
  });
}

async function selectProject(projectId) {
  if (!projectId) {
    state.activeProject = null;
    state.activeRevision = null;
    $('#no-project-banner').classList.remove('hidden');
    $('#active-project-views').classList.add('hidden');
    $('#bc-project').textContent = 'Select Project';
    return;
  }

  state.activeProject = projectId;
  renderTopProjectSelect();

  try {
    const data = await api(`/api/projects/${encodeURIComponent(projectId)}`);
    $('#no-project-banner').classList.add('hidden');
    $('#active-project-views').classList.remove('hidden');
    $('#overview-project-title').textContent = data.project.name;
    $('#bc-project').textContent = data.project.name;

    const reportBtn = $('#btn-export-report-overview');
    if (data.revision) {
      state.activeRevision = data.revision.id;
      $('#overview-revision-meta').textContent = `Revision ${data.revision.id.slice(-8)} · ${data.revision.status} · ${new Date(data.revision.created_at).toLocaleString()}`;
      reportBtn.classList.remove('hidden');
      reportBtn.href = `/api/projects/${encodeURIComponent(projectId)}/architecture-report.md`;
    } else {
      state.activeRevision = null;
      $('#overview-revision-meta').textContent = 'No revision imported yet.';
      reportBtn.classList.add('hidden');
    }

    renderStats(data.counts || {});
    loadActiveView();
  } catch (err) {
    showFeedback('#import-feedback', err.message, true);
  }
}

function renderStats(counts) {
  const container = $('#stats-overview');
  if (!container) return;
  const cards = [
    { label: 'Indexed Files', value: counts.files || 0, badge: 'Source' },
    { label: 'Routes & Endpoints', value: counts.routes || 0, badge: 'HTTP' },
    { label: 'Graph Relationships', value: counts.edges || 0, badge: 'Flow' },
    { label: 'Security Findings', value: counts.findings || 0, badge: counts.findings > 0 ? 'Review' : 'Clean' },
    { label: 'Planned Tasks', value: counts.plans || 0, badge: 'DevOps' }
  ];
  container.innerHTML = cards
    .map(
      (c) => `
      <div class="stat-card">
        <div class="stat-header"><span>${c.label}</span><span class="badge">${c.badge}</span></div>
        <div class="stat-val">${c.value}</div>
      </div>
    `
    )
    .join('');
}

// ==========================================================================
// Operations & Background Jobs Framework
// ==========================================================================
async function loadOperations() {
  if (!state.activeProject) return;
  try {
    const data = await api(`/api/projects/${encodeURIComponent(state.activeProject)}/operations`);
    state.operations = data.operations;
    renderOperationsTable(data.operations);
    updateActiveOpIndicator(data.operations);
  } catch {}
}

async function loadRecentOperations() {
  if (!state.activeProject) return;
  try {
    const data = await api(`/api/projects/${encodeURIComponent(state.activeProject)}/operations`);
    const container = $('#overview-recent-ops');
    if (!container) return;
    if (!data.operations.length) {
      container.innerHTML = '<p class="muted">No operations executed yet. Click "Run Analysis" to start one.</p>';
      return;
    }
    container.innerHTML = data.operations.slice(0, 5).map(op => `
      <div class="op-event-row" style="cursor:pointer;" onclick="viewOperationDetail('${op.id}')">
        <span class="badge badge-accent">${escapeHtml(op.status)}</span>
        <strong>${escapeHtml(op.name)}</strong>
        <span class="muted" style="margin-left:auto;">${new Date(op.created_at).toLocaleTimeString()}</span>
      </div>
    `).join('');
  } catch {}
}

function renderOperationsTable(operations) {
  const container = $('#operations-list');
  if (!container) return;
  if (!operations.length) {
    container.innerHTML = '<p class="muted">No operations recorded for this project yet.</p>';
    return;
  }
  container.innerHTML = `
    <table class="op-table">
      <thead>
        <tr>
          <th>Operation Name</th>
          <th>Type</th>
          <th>Status</th>
          <th>Stage</th>
          <th>Progress</th>
          <th>Created</th>
          <th>Action</th>
        </tr>
      </thead>
      <tbody>
        ${operations.map(op => `
          <tr>
            <td><strong>${escapeHtml(op.name)}</strong></td>
            <td><code>${escapeHtml(op.type)}</code></td>
            <td><span class="badge ${op.status === 'completed' ? 'badge-online' : 'badge-accent'}">${escapeHtml(op.status)}</span></td>
            <td>${escapeHtml(op.stage)}</td>
            <td>${op.progress}%</td>
            <td>${new Date(op.created_at).toLocaleTimeString()}</td>
            <td><button type="button" class="btn btn-secondary btn-sm" onclick="viewOperationDetail('${op.id}')">Inspect</button></td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  `;
}

function updateActiveOpIndicator(operations) {
  const activeOp = operations.find(o => o.status === 'running' || o.status === 'queued');
  const indicator = $('#active-op-indicator');
  const badge = $('#sidebar-op-badge');
  if (activeOp) {
    indicator.classList.remove('hidden');
    $('#active-op-label').textContent = `${activeOp.name} (${activeOp.progress}%)`;
    badge.classList.remove('hidden');
    badge.textContent = '1';
  } else {
    indicator.classList.add('hidden');
    badge.classList.add('hidden');
  }
}

async function startOperation(type, name, config = {}) {
  if (!state.activeProject) return;
  try {
    const res = await api(`/api/projects/${encodeURIComponent(state.activeProject)}/operations`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type, name, config })
    });
    closeModal('modal-launch-operation');
    loadOperations();
    viewOperationDetail(res.operation.id);
  } catch (err) {
    alert(`Failed to launch operation: ${err.message}`);
  }
}

async function viewOperationDetail(opId) {
  try {
    const data = await api(`/api/projects/${encodeURIComponent(state.activeProject)}/operations/${encodeURIComponent(opId)}`);
    const op = data.operation;
    const panel = $('#operation-detail-panel');
    panel.classList.remove('hidden');

    $('#op-detail-title').textContent = op.name;
    $('#op-detail-badge').textContent = op.status;
    $('#op-detail-badge').className = `badge ${op.status === 'completed' ? 'badge-online' : 'badge-accent'}`;
    $('#op-detail-meta').textContent = `Type: ${op.type} · Stage: ${op.stage} · Started: ${new Date(op.created_at).toLocaleString()}`;
    $('#op-detail-progress-fill').style.width = `${op.progress}%`;
    $('#op-detail-summary').textContent = op.summary || (op.status === 'running' ? 'Processing operation stages…' : 'Finished.');

    const eventsList = $('#op-detail-events');
    eventsList.innerHTML = (op.events || []).map(e => `
      <div class="op-event-row">
        <span class="muted">[${new Date(e.created_at).toLocaleTimeString()}]</span>
        <span class="badge">${escapeHtml(e.stage)}</span>
        <span>${escapeHtml(e.message)}</span>
      </div>
    `).join('');

    panel.scrollIntoView({ behavior: 'smooth' });
  } catch (err) {
    alert(`Failed to load operation detail: ${err.message}`);
  }
}

// ==========================================================================
// CodePilot Flow Controller (Signature Feature)
// ==========================================================================
async function loadFlowDiagram(type = state.flow.type) {
  state.flow.type = type;
  const svg = $('#flow-svg-canvas');
  const edgesLayer = $('#flow-edges-layer');
  const nodesLayer = $('#flow-nodes-layer');
  if (!svg || !edgesLayer || !nodesLayer) return;

  if (!state.activeRevision) {
    edgesLayer.innerHTML = '';
    nodesLayer.innerHTML = '<text x="50%" y="50%" fill="#94a3b8" text-anchor="middle" font-size="14">Import a repository revision to generate visual architecture and flow diagrams.</text>';
    return;
  }

  $$('.flow-type-btn').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.flow === type);
  });

  try {
    const data = await api(`/api/projects/${encodeURIComponent(state.activeProject)}/flow?type=${encodeURIComponent(type)}`);
    state.flow.data = data.diagram;
    renderFlowGraph(data.diagram);
  } catch (err) {
    nodesLayer.innerHTML = `<text x="50%" y="50%" fill="#f43f5e" text-anchor="middle">Failed to generate flow: ${escapeHtml(err.message)}</text>`;
  }
}

function renderFlowGraph(diagram) {
  const edgesLayer = $('#flow-edges-layer');
  const nodesLayer = $('#flow-nodes-layer');
  edgesLayer.innerHTML = '';
  nodesLayer.innerHTML = '';

  const nodes = diagram.nodes || [];
  const edges = diagram.edges || [];
  const nodeCoords = new Map();

  nodes.forEach((n) => {
    nodeCoords.set(n.id, { x: n.x, y: n.y, w: n.width, h: n.height });
  });

  edges.forEach((edge) => {
    const s = nodeCoords.get(edge.source);
    const t = nodeCoords.get(edge.target);
    if (!s || !t) return;

    const x1 = s.x + s.w / 2;
    const y1 = s.y + s.h / 2;
    const x2 = t.x + t.w / 2;
    const y2 = t.y + t.h / 2;

    const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    line.setAttribute('x1', x1);
    line.setAttribute('y1', y1);
    line.setAttribute('x2', x2);
    line.setAttribute('y2', y2);
    line.setAttribute('class', 'flow-edge-line');
    line.setAttribute('marker-end', 'url(#arrowhead)');
    edgesLayer.appendChild(line);

    if (edge.label) {
      const midX = (x1 + x2) / 2;
      const midY = (y1 + y2) / 2 - 4;
      const lbl = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      lbl.setAttribute('x', midX);
      lbl.setAttribute('y', midY);
      lbl.setAttribute('class', 'flow-edge-label');
      lbl.textContent = edge.label;
      edgesLayer.appendChild(lbl);
    }
  });

  nodes.forEach((node) => {
    const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    g.setAttribute('class', `flow-node-group ${state.flow.selectedNode === node.id ? 'selected' : ''}`);
    g.setAttribute('transform', `translate(${node.x}, ${node.y})`);

    const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    rect.setAttribute('width', node.width);
    rect.setAttribute('height', node.height);
    rect.setAttribute('rx', 8);
    rect.setAttribute('class', 'node-box');

    const stripe = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    stripe.setAttribute('x', 0);
    stripe.setAttribute('y', 0);
    stripe.setAttribute('width', 5);
    stripe.setAttribute('height', node.height);
    stripe.setAttribute('rx', 3);
    stripe.setAttribute('class', `node-stripe stripe-${node.type || 'default'}`);

    const title = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    title.setAttribute('x', 14);
    title.setAttribute('y', 24);
    title.setAttribute('class', 'node-title');
    title.textContent = node.label.length > 22 ? `${node.label.slice(0, 20)}…` : node.label;

    const sub = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    sub.setAttribute('x', 14);
    sub.setAttribute('y', 44);
    sub.setAttribute('class', 'node-sub');
    sub.textContent = node.subtitle || node.type || '';

    g.appendChild(rect);
    g.appendChild(stripe);
    g.appendChild(title);
    g.appendChild(sub);

    g.addEventListener('click', (e) => {
      e.stopPropagation();
      selectFlowNode(node);
    });

    nodesLayer.appendChild(g);
  });
}

function selectFlowNode(node) {
  state.flow.selectedNode = node.id;
  $$('.flow-node-group').forEach((g) => g.classList.remove('selected'));
  renderFlowGraph(state.flow.data);

  $('#inspector-badge').textContent = node.evidence || 'Static Analysis';
  $('#inspector-title').textContent = node.label;
  $('#inspector-subtitle').textContent = node.subtitle || node.type;
  $('#inspector-file-loc').textContent = node.path ? `${node.path}:${node.line || 1}` : 'Inferred Node';
  $('#inspector-excerpt').textContent = node.excerpt || 'No source excerpt associated with this component.';
  $('#inspector-body').classList.remove('hidden');

  $('#btn-open-in-explorer').onclick = () => {
    if (node.path) {
      navigateToView('view-code');
      viewFile(node.path);
    }
  };
}

function initFlowInteractions() {
  const canvasBox = $('#flow-canvas-box');
  const viewport = $('#flow-viewport');
  if (!canvasBox || !viewport) return;

  function updateTransform() {
    viewport.setAttribute(
      'transform',
      `translate(${state.flow.panX}, ${state.flow.panY}) scale(${state.flow.zoom})`
    );
  }

  canvasBox.addEventListener('mousedown', (e) => {
    if (e.target.tagName === 'rect' || e.target.tagName === 'text') return;
    state.flow.isPanning = true;
    state.flow.startX = e.clientX - state.flow.panX;
    state.flow.startY = e.clientY - state.flow.panY;
  });

  window.addEventListener('mousemove', (e) => {
    if (!state.flow.isPanning) return;
    state.flow.panX = e.clientX - state.flow.startX;
    state.flow.panY = e.clientY - state.flow.startY;
    updateTransform();
  });

  window.addEventListener('mouseup', () => {
    state.flow.isPanning = false;
  });

  canvasBox.addEventListener('wheel', (e) => {
    e.preventDefault();
    const zoomFactor = e.deltaY < 0 ? 1.1 : 0.9;
    state.flow.zoom = Math.max(0.3, Math.min(3.0, state.flow.zoom * zoomFactor));
    updateTransform();
  });

  $('#btn-flow-zoom-in')?.addEventListener('click', () => {
    state.flow.zoom = Math.min(3.0, state.flow.zoom * 1.2);
    updateTransform();
  });

  $('#btn-flow-zoom-out')?.addEventListener('click', () => {
    state.flow.zoom = Math.max(0.3, state.flow.zoom / 1.2);
    updateTransform();
  });

  $('#btn-flow-reset')?.addEventListener('click', () => {
    state.flow.zoom = 1;
    state.flow.panX = 0;
    state.flow.panY = 0;
    updateTransform();
  });

  $$('.flow-type-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      loadFlowDiagram(btn.dataset.flow);
    });
  });

  $('#btn-flow-export-svg')?.addEventListener('click', () => {
    const svgEl = $('#flow-svg-canvas');
    if (!svgEl) return;
    const blob = new Blob([svgEl.outerHTML], { type: 'image/svg+xml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `codepilot-flow-${state.flow.type}.svg`;
    a.click();
    URL.revokeObjectURL(url);
  });

  $('#btn-flow-export-json')?.addEventListener('click', () => {
    if (!state.flow.data) return;
    const blob = new Blob([JSON.stringify(state.flow.data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `codepilot-flow-${state.flow.type}.json`;
    a.click();
    URL.revokeObjectURL(url);
  });

  $('#btn-flow-save')?.addEventListener('click', async () => {
    if (!state.flow.data) return;
    const title = prompt('Enter a title for this saved diagram:', state.flow.data.title || 'Architecture Diagram');
    if (!title) return;
    try {
      await api(`/api/projects/${encodeURIComponent(state.activeProject)}/diagrams`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title,
          diagramType: state.flow.type,
          graphData: JSON.stringify(state.flow.data)
        })
      });
      alert('Diagram saved successfully!');
    } catch (err) {
      alert(`Failed to save diagram: ${err.message}`);
    }
  });

  $('#diagram-ai-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const query = $('#diagram-ai-input').value.trim();
    if (query) askDiagramAI(query);
  });
}

async function askDiagramAI(query) {
  const respEl = $('#diagram-ai-response');
  respEl.textContent = 'Analyzing diagram structure…';
  try {
    const res = await api(`/api/projects/${encodeURIComponent(state.activeProject)}/flow/explain`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ diagram: state.flow.data, query })
    });
    respEl.textContent = res.explanation;
  } catch (err) {
    respEl.textContent = `Explanation failed: ${err.message}`;
  }
}

// ==========================================================================
// Code Explorer
// ==========================================================================
async function loadFileList() {
  const container = $('#file-list-container');
  if (!state.activeRevision) {
    container.innerHTML = '<span class="muted" style="font-size:0.85rem;">Import a revision to view files.</span>';
    return;
  }

  try {
    const q = $('#file-search-input').value.trim();
    const data = await api(`/api/projects/${encodeURIComponent(state.activeProject)}/files?q=${encodeURIComponent(q)}`);
    container.innerHTML = '';

    if (!data.files.length) {
      container.innerHTML = '<span class="muted" style="font-size:0.85rem;">No files matched query.</span>';
      return;
    }

    data.files.forEach((f) => {
      const item = document.createElement('div');
      item.className = `file-item ${state.activeFile === f.path ? 'active' : ''}`;
      item.innerHTML = `<span class="file-path">${escapeHtml(f.path)}</span> <small class="file-lang">${escapeHtml(f.language || '')}</small>`;
      item.addEventListener('click', () => viewFile(f.path));
      container.appendChild(item);
    });
  } catch (err) {
    container.innerHTML = `<span class="muted" style="color:var(--accent-rose);">${escapeHtml(err.message)}</span>`;
  }
}

async function viewFile(filePath) {
  state.activeFile = filePath;
  $('#selected-file-label').textContent = filePath;
  const preview = $('#code-preview');
  preview.textContent = 'Loading file contents…';

  try {
    const data = await api(`/api/projects/${encodeURIComponent(state.activeProject)}/file?path=${encodeURIComponent(filePath)}`);
    preview.textContent = data.file.content || '(Empty or binary file)';
    $('#redaction-badge').classList.toggle('hidden', !data.file.content?.includes('[REDACTED'));
    $$('.file-item').forEach((el) => {
      el.classList.toggle('active', el.querySelector('.file-path')?.textContent === filePath);
    });
  } catch (err) {
    preview.textContent = `Error loading file: ${err.message}`;
  }
}

function initCodeAiActions() {
  const feedback = $('#code-ai-feedback');
  $('#btn-code-explain')?.addEventListener('click', async () => {
    if (!state.activeFile) return alert('Select a file to explain first.');
    feedback.textContent = 'Explaining code…';
    try {
      const res = await api(`/api/projects/${encodeURIComponent(state.activeProject)}/ai/explain`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: $('#code-preview').textContent, filePath: state.activeFile })
      });
      feedback.textContent = res.explanation;
    } catch (err) { feedback.textContent = err.message; }
  });

  $('#btn-code-tests')?.addEventListener('click', async () => {
    if (!state.activeFile) return alert('Select a file first.');
    feedback.textContent = 'Generating unit tests…';
    try {
      const res = await api(`/api/projects/${encodeURIComponent(state.activeProject)}/ai/generate-tests`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: $('#code-preview').textContent, filePath: state.activeFile })
      });
      feedback.textContent = res.testCode || res.tests;
    } catch (err) { feedback.textContent = err.message; }
  });

  $('#btn-code-refactor')?.addEventListener('click', async () => {
    if (!state.activeFile) return alert('Select a file first.');
    const inst = prompt('Enter refactoring instructions:', 'Improve code readability and handle edge cases');
    if (!inst) return;
    feedback.textContent = 'Refactoring code…';
    try {
      const res = await api(`/api/projects/${encodeURIComponent(state.activeProject)}/ai/refactor`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: $('#code-preview').textContent, instruction: inst })
      });
      feedback.textContent = res.refactoredCode || res.result;
    } catch (err) { feedback.textContent = err.message; }
  });
}

// ==========================================================================
// Architecture Report & In-Depth Analysis
// ==========================================================================
async function loadArchitectureReport() {
  const container = $('#analysis-report-container');
  if (!state.activeRevision) {
    container.innerHTML = '<p class="muted">Import a revision first to view architecture analysis.</p>';
    return;
  }
  try {
    const data = await api(`/api/projects/${encodeURIComponent(state.activeProject)}/architecture-report`);
    const r = data.report;
    container.innerHTML = `
      <div style="display:flex; flex-direction:column; gap:1.25rem;">
        <div>
          <h4>System Archetype: <span class="badge badge-accent">${escapeHtml(r.archetype?.type || 'Standard')}</span></h4>
          <p class="muted" style="margin-top:0.25rem;">${escapeHtml(r.archetype?.summary || '')}</p>
        </div>
        <div>
          <h4>Component Boundaries (${r.layers?.length || 0} Layers)</h4>
          <div style="display:flex; gap:0.5rem; flex-wrap:wrap; margin-top:0.4rem;">
            ${(r.layers || []).map(l => `<span class="badge">${escapeHtml(l.name)}</span>`).join('')}
          </div>
        </div>
        <div>
          <h4>Exposed Routes (${r.entryPoints?.routes?.length || 0})</h4>
          <div style="display:flex; flex-direction:column; gap:0.25rem; margin-top:0.4rem;">
            ${(r.entryPoints?.routes || []).slice(0, 15).map(rt => `<div class="op-event-row"><code>${escapeHtml(rt.method)} ${escapeHtml(rt.path)}</code> <span class="muted">${escapeHtml(rt.sourceFile)}:${rt.line}</span></div>`).join('')}
          </div>
        </div>
      </div>
    `;
  } catch (err) {
    container.innerHTML = `<p class="muted" style="color:var(--accent-rose);">${escapeHtml(err.message)}</p>`;
  }
}

// ==========================================================================
// AI Assistant & Multi-Turn Conversations
// ==========================================================================
async function loadConversations() {
  const container = $('#conversations-list-container');
  if (!container || !state.activeProject) return;
  try {
    const data = await api(`/api/projects/${encodeURIComponent(state.activeProject)}/conversations`);
    container.innerHTML = '';
    data.conversations.forEach((c) => {
      const div = document.createElement('div');
      div.className = `palette-item ${state.activeConvo === c.id ? 'active' : ''}`;
      div.innerHTML = `<span>💬 ${escapeHtml(c.title)}</span> <small class="muted">${new Date(c.created_at).toLocaleDateString()}</small>`;
      div.onclick = () => selectConversation(c.id);
      container.appendChild(div);
    });
  } catch {}
}

async function selectConversation(convoId) {
  state.activeConvo = convoId;
  loadConversations();
  const msgBox = $('#ai-chat-messages');
  msgBox.innerHTML = '<p class="muted">Loading messages…</p>';
  try {
    const data = await api(`/api/projects/${encodeURIComponent(state.activeProject)}/conversations/${encodeURIComponent(convoId)}`);
    msgBox.innerHTML = '';
    data.messages.forEach((m) => {
      const b = document.createElement('div');
      b.style.padding = '0.6rem 0.8rem';
      b.style.borderRadius = '6px';
      b.style.background = m.role === 'user' ? 'var(--bg-surface-elevated)' : 'var(--bg-surface)';
      b.style.border = '1px solid var(--border-subtle)';
      b.innerHTML = `<strong>${m.role === 'user' ? 'You' : 'CodePilot AI'}:</strong> <div style="white-space:pre-wrap; margin-top:0.25rem;">${escapeHtml(m.content)}</div>`;
      msgBox.appendChild(b);
    });
    msgBox.scrollTop = msgBox.scrollHeight;
  } catch {}
}

// ==========================================================================
// Tasks & Kanban Workspace
// ==========================================================================
async function loadTasks() {
  if (!state.activeProject) return;
  try {
    const data = await api(`/api/projects/${encodeURIComponent(state.activeProject)}/tasks`);
    const tasks = data.tasks || [];
    ['todo', 'in-progress', 'in-review', 'done'].forEach(col => {
      $(`#tasks-list-${col}`).innerHTML = '';
      $(`#count-${col}`).textContent = '0';
    });

    const statusMap = { todo: 'todo', in_progress: 'in-progress', in_review: 'in-review', done: 'done' };
    const counts = { todo: 0, 'in-progress': 0, 'in-review': 0, done: 0 };

    tasks.forEach(t => {
      const colId = statusMap[t.status] || 'todo';
      counts[colId]++;
      const card = document.createElement('div');
      card.className = 'task-card';
      card.innerHTML = `
        <div class="task-card-title">${escapeHtml(t.title)}</div>
        <div class="task-card-meta">
          <span class="badge">${escapeHtml(t.priority)}</span>
          ${t.target_file ? `<span class="badge badge-idle">${escapeHtml(t.target_file)}</span>` : ''}
        </div>
      `;
      $(`#tasks-list-${colId}`)?.appendChild(card);
    });

    Object.keys(counts).forEach(k => { $(`#count-${k}`).textContent = counts[k]; });
  } catch {}
}

// ==========================================================================
// Notes & Knowledge Base Workspace
// ==========================================================================
async function loadNotes() {
  if (!state.activeProject) return;
  try {
    const data = await api(`/api/projects/${encodeURIComponent(state.activeProject)}/notes`);
    const container = $('#notes-list-container');
    container.innerHTML = '';
    data.notes.forEach(n => {
      const item = document.createElement('div');
      item.className = `notes-item ${state.activeNote === n.id ? 'active' : ''}`;
      item.innerHTML = `
        <strong>${escapeHtml(n.title)}</strong>
        <div style="font-size:0.75rem; color:var(--text-muted); margin-top:0.25rem;">${escapeHtml(n.category)} · ${new Date(n.created_at).toLocaleDateString()}</div>
      `;
      item.onclick = () => selectNote(n);
      container.appendChild(item);
    });
  } catch {}
}

function selectNote(note) {
  state.activeNote = note.id;
  $('#note-title-input').value = note.title;
  $('#note-content-input').value = note.content;
  $('#note-category-select').value = note.category;
  $('#note-tags-input').value = note.tags || '';
  $$('.notes-item').forEach(el => el.classList.remove('active'));
  loadNotes();
}

// ==========================================================================
// API Studio Workspace
// ==========================================================================
function loadApiStudio() {}

function initApiStudio() {
  $('#btn-send-api-req')?.addEventListener('click', async () => {
    const method = $('#api-req-method').value;
    const url = $('#api-req-url').value.trim();
    if (!url) return alert('Enter a request URL.');

    const statusBadge = $('#api-resp-status');
    const bodyBox = $('#api-resp-body');
    statusBadge.textContent = 'Sending…';
    bodyBox.textContent = 'Awaiting HTTP response…';

    try {
      let headers = {};
      const headersVal = $('#api-req-headers').value.trim();
      if (headersVal) {
        try { headers = JSON.parse(headersVal); } catch { alert('Headers must be valid JSON'); return; }
      }
      let bodyData = $('#api-req-body').value.trim() || undefined;

      const res = await api(`/api/projects/${encodeURIComponent(state.activeProject)}/api-requests/execute`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ method, url, headers, body: bodyData })
      });

      const r = res.result;
      statusBadge.textContent = `${r.status} ${r.statusText || ''} (${r.durationMs}ms)`;
      statusBadge.className = `badge ${r.status >= 200 && r.status < 300 ? 'badge-online' : 'badge-accent'}`;
      bodyBox.textContent = typeof r.body === 'object' ? JSON.stringify(r.body, null, 2) : r.body;
    } catch (err) {
      statusBadge.textContent = 'Error';
      statusBadge.className = 'badge badge-accent';
      bodyBox.textContent = err.message;
    }
  });
}

// ==========================================================================
// Database Studio Workspace
// ==========================================================================
async function loadDbSchema() {
  if (!state.activeProject) return;
  try {
    const data = await api(`/api/projects/${encodeURIComponent(state.activeProject)}/db-schema`);
    $('#db-dialect-badge').textContent = data.dialect;
    const list = $('#db-tables-list');
    list.innerHTML = '';
    data.tables.forEach(t => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'btn btn-secondary btn-chip';
      btn.style.textAlign = 'left';
      btn.textContent = `📋 ${t.name}`;
      btn.onclick = () => {
        $('#db-sql-input').value = `SELECT * FROM ${t.name} LIMIT 10;`;
        $('#btn-run-sql').click();
      };
      list.appendChild(btn);
    });
  } catch {}
}

function initDbStudio() {
  $('#btn-run-sql')?.addEventListener('click', async () => {
    const query = $('#db-sql-input').value.trim();
    if (!query) return alert('Enter a SQL statement.');

    const tele = $('#db-query-telemetry');
    const table = $('#db-results-table');
    tele.textContent = 'Running safe query…';

    try {
      const res = await api(`/api/projects/${encodeURIComponent(state.activeProject)}/db-query`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query })
      });

      tele.textContent = `Returned ${res.rowCount} row(s) in ${res.executionTimeMs}ms`;
      table.innerHTML = '';
      if (!res.rows.length) {
        table.innerHTML = '<tr><td class="muted">Query returned 0 rows.</td></tr>';
        return;
      }
      const thead = document.createElement('thead');
      const trH = document.createElement('tr');
      res.columns.forEach(c => {
        const th = document.createElement('th');
        th.textContent = c;
        trH.appendChild(th);
      });
      thead.appendChild(trH);
      table.appendChild(thead);

      const tbody = document.createElement('tbody');
      res.rows.forEach(r => {
        const tr = document.createElement('tr');
        res.columns.forEach(c => {
          const td = document.createElement('td');
          td.textContent = r[c] !== null && r[c] !== undefined ? String(r[c]) : 'NULL';
          tr.appendChild(td);
        });
        tbody.appendChild(tr);
      });
      table.appendChild(tbody);
    } catch (err) {
      tele.textContent = `Error: ${err.message}`;
    }
  });
}

// ==========================================================================
// Findings & Security Workspace
// ==========================================================================
async function loadFindings() {
  if (!state.activeProject) return;
  const container = $('#findings-list-container');
  try {
    const data = await api(`/api/projects/${encodeURIComponent(state.activeProject)}/findings`);
    container.innerHTML = '';
    if (!data.findings.length) {
      container.innerHTML = '<p class="muted">No security findings or diagnostics found in current revision.</p>';
      return;
    }
    data.findings.forEach(f => {
      const div = document.createElement('div');
      div.className = 'panel';
      div.innerHTML = `
        <div style="display:flex; justify-content:space-between; align-items:center;">
          <span class="badge badge-accent">${escapeHtml(f.severity.toUpperCase())}</span>
          <span class="muted" style="font-family:var(--font-mono); font-size:0.8rem;">${escapeHtml(f.filePath || '')}:${f.line || 1}</span>
        </div>
        <p style="margin-top:0.4rem; font-weight:600;">${escapeHtml(f.message)}</p>
        ${f.evidence ? `<pre class="flow-inspector-excerpt" style="margin-top:0.4rem;">${escapeHtml(f.evidence)}</pre>` : ''}
      `;
      container.appendChild(div);
    });
  } catch {}
}

// ==========================================================================
// Implementation Planner Workspace
// ==========================================================================
async function loadPlans() {
  if (!state.activeProject) return;
  const container = $('#plans-container');
  try {
    const data = await api(`/api/projects/${encodeURIComponent(state.activeProject)}/plans`);
    container.innerHTML = '';
    if (!data.plans.length) {
      container.innerHTML = '<p class="muted">No implementation plans generated yet.</p>';
      return;
    }
    data.plans.forEach(p => {
      const div = document.createElement('div');
      div.className = 'panel';
      div.innerHTML = `
        <div style="display:flex; justify-content:space-between; align-items:center;">
          <h4>${escapeHtml(p.title)}</h4>
          <span class="badge">${escapeHtml(p.complexity)}</span>
        </div>
        <p class="muted" style="margin-top:0.25rem;">${escapeHtml(p.requirement)}</p>
      `;
      container.appendChild(div);
    });
  } catch {}
}

// ==========================================================================
// Patch Manager Workspace
// ==========================================================================
async function loadPatches() {
  if (!state.activeProject) return;
  const container = $('#patches-container');
  try {
    const data = await api(`/api/projects/${encodeURIComponent(state.activeProject)}/patches`);
    container.innerHTML = '';
    if (!data.patches.length) {
      container.innerHTML = '<p class="muted">No code patches recorded.</p>';
      return;
    }
    data.patches.forEach(p => {
      const div = document.createElement('div');
      div.className = 'panel';
      div.innerHTML = `
        <div style="display:flex; justify-content:space-between; align-items:center;">
          <h4>${escapeHtml(p.title)}</h4>
          <span class="badge ${p.status === 'applied' ? 'badge-online' : 'badge-idle'}">${escapeHtml(p.status)}</span>
        </div>
        <pre class="flow-inspector-excerpt" style="margin-top:0.5rem;">${escapeHtml(p.diff)}</pre>
      `;
      container.appendChild(div);
    });
  } catch {}
}

// ==========================================================================
// Docker Assistant
// ==========================================================================
async function loadDocker() {
  if (!state.activeProject) return;
  try {
    const data = await api(`/api/projects/${encodeURIComponent(state.activeProject)}/docker`);
    $('#docker-stack-badge').textContent = `Stack: ${data.stack.primary || 'Detected'}`;
    $('#dockerfile-preview').textContent = data.dockerfile;
    $('#compose-preview').textContent = data.dockerCompose;
  } catch {}
}

// ==========================================================================
// Deployment Center
// ==========================================================================
async function loadDeployments() {
  if (!state.activeProject) return;
  try {
    const data = await api(`/api/projects/${encodeURIComponent(state.activeProject)}/deployments`);
    const container = $('#deployments-history');
    if (!data.deployments.length) {
      container.innerHTML = '<p class="muted">No deployments triggered yet.</p>';
      return;
    }
    container.innerHTML = data.deployments.map(d => `
      <div class="op-event-row" style="margin-bottom:0.5rem;">
        <span class="badge ${d.status === 'success' ? 'badge-online' : 'badge-accent'}">${escapeHtml(d.status)}</span>
        <span>${escapeHtml(d.provider)} (${escapeHtml(d.environment)})</span>
        <span class="muted">${new Date(d.created_at).toLocaleString()}</span>
      </div>
    `).join('');
  } catch {}
}

// ==========================================================================
// Audit Trail
// ==========================================================================
async function loadAudit() {
  try {
    const data = await api('/api/audit');
    $('#audit-events-container').innerHTML = data.events.map(e => `
      <div class="audit-row">
        <span>[${new Date(e.created_at).toLocaleTimeString()}] <strong>${escapeHtml(e.action)}</strong></span>
        <span>${escapeHtml(e.detail)}</span>
      </div>
    `).join('');
  } catch {}
}

// ==========================================================================
// Global Command Palette (Ctrl+K)
// ==========================================================================
function initCommandPalette() {
  const modal = $('#command-palette');
  const input = $('#palette-search-input');
  const resultsBox = $('#palette-results-container');
  if (!modal || !input) return;

  function togglePalette() {
    modal.classList.toggle('hidden');
    if (!modal.classList.contains('hidden')) {
      input.value = '';
      resultsBox.innerHTML = '<p class="muted" style="padding:0.75rem;">Type to search files, symbols, tasks, diagrams across current project…</p>';
      input.focus();
    }
  }

  $('#btn-open-palette')?.addEventListener('click', togglePalette);

  window.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      togglePalette();
    }
    if (e.key === 'Escape' && !modal.classList.contains('hidden')) {
      modal.classList.add('hidden');
    }
  });

  input.addEventListener('input', async () => {
    const q = input.value.trim();
    if (!q || !state.activeProject) return;
    try {
      const data = await api(`/api/projects/${encodeURIComponent(state.activeProject)}/search?q=${encodeURIComponent(q)}`);
      resultsBox.innerHTML = '';
      if (!data.results.length) {
        resultsBox.innerHTML = '<p class="muted" style="padding:0.75rem;">No matches found.</p>';
        return;
      }
      data.results.forEach(item => {
        const div = document.createElement('div');
        div.className = 'palette-item';
        div.innerHTML = `
          <span><strong>[${escapeHtml(item.type)}]</strong> ${escapeHtml(item.name)}</span>
          <small class="muted">${escapeHtml(item.file || item.language || '')}</small>
        `;
        div.onclick = () => {
          modal.classList.add('hidden');
          if (item.type === 'file') {
            navigateToView('view-code');
            viewFile(item.name);
          } else if (item.type === 'task') {
            navigateToView('view-tasks');
          } else if (item.type === 'diagram') {
            navigateToView('view-flow');
          }
        };
        resultsBox.appendChild(div);
      });
    } catch {}
  });
}

function switchImportTab(type) {
  $('#tab-btn-zip')?.classList.toggle('active', type === 'zip');
  $('#tab-btn-url')?.classList.toggle('active', type === 'url');
  $('#zip-import-form')?.classList.toggle('hidden', type !== 'zip');
  $('#url-import-form')?.classList.toggle('hidden', type !== 'url');
}

// Event Listeners & Initialization
window.addEventListener('DOMContentLoaded', () => {
  initTheme();
  checkHealth();
  initCommandPalette();
  initFlowInteractions();
  initCodeAiActions();
  initApiStudio();
  initDbStudio();
  loadProjects();

  // Sidebar toggle
  $('#btn-sidebar-toggle')?.addEventListener('click', () => {
    $('#app-sidebar').classList.toggle('collapsed');
  });

  // Sidebar links
  $$('.sidebar-link').forEach((link) => {
    link.addEventListener('click', () => navigateToView(link.dataset.view));
  });

  // Top project select change
  $('#top-project-select')?.addEventListener('change', (e) => {
    selectProject(e.target.value);
  });

  // Modal open buttons
  $('#btn-new-project-modal')?.addEventListener('click', () => openModal('modal-create-project'));
  $('#btn-hero-create')?.addEventListener('click', () => openModal('modal-create-project'));
  $('#btn-launch-operation')?.addEventListener('click', () => openModal('modal-launch-operation'));
  $('#btn-start-analysis-op')?.addEventListener('click', () => {
    startOperation('repository-analysis', 'Full Repository Analysis & AST Parsing');
  });
  $('#btn-trigger-analysis-quick')?.addEventListener('click', () => {
    startOperation('repository-analysis', 'Full Repository Analysis & AST Parsing');
  });

  // Modal Create Project Form
  $('#project-create-modal-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = $('#modal-project-name').value.trim();
    const description = $('#modal-project-desc').value.trim();
    if (!name) return;
    try {
      const data = await api('/api/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, description })
      });
      closeModal('modal-create-project');
      $('#modal-project-name').value = '';
      $('#modal-project-desc').value = '';
      await loadProjects();
      selectProject(data.project.id);
    } catch (err) {
      alert(`Failed to create project: ${err.message}`);
    }
  });

  // Modal Launch Operation Form
  $('#operation-launch-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const type = $('#op-select-type').value;
    const name = $('#op-custom-name').value.trim();
    if (!name) return;
    startOperation(type, name);
  });

  // Project Deletion
  $('#btn-delete-project-overview')?.addEventListener('click', async () => {
    if (!state.activeProject) return;
    if (!confirm('Are you sure you want to delete this active project?')) return;
    try {
      await api(`/api/projects/${encodeURIComponent(state.activeProject)}`, { method: 'DELETE' });
      state.activeProject = null;
      state.activeRevision = null;
      await loadProjects();
      selectProject(state.projects.length ? state.projects[0].id : null);
    } catch (err) {
      alert(`Failed to delete project: ${err.message}`);
    }
  });

  // File Upload Ingestion
  $('#zip-import-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const file = $('#zip-file-input').files[0];
    if (!file || !state.activeProject) return;
    showFeedback('#import-feedback', 'Ingesting and analyzing repository…');

    try {
      const buffer = await file.arrayBuffer();
      await api(`/api/projects/${encodeURIComponent(state.activeProject)}/import`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/zip' },
        body: buffer
      });
      showFeedback('#import-feedback', 'Repository revision successfully ingested and analyzed!');
      selectProject(state.activeProject);
    } catch (err) {
      showFeedback('#import-feedback', err.message, true);
    }
  });

  // URL Remote Ingestion
  $('#url-import-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const url = $('#remote-url-input').value.trim();
    if (!url || !state.activeProject) return;
    showFeedback('#import-feedback', 'Fetching remote archive via SSRF-safe gateway…');

    try {
      await api(`/api/projects/${encodeURIComponent(state.activeProject)}/import-url`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url })
      });
      showFeedback('#import-feedback', 'Remote repository successfully fetched and indexed!');
      selectProject(state.activeProject);
    } catch (err) {
      showFeedback('#import-feedback', err.message, true);
    }
  });

  // Planner Form
  $('#planner-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const reqText = $('#planner-req-input').value.trim();
    if (!reqText || !state.activeProject) return;
    try {
      await api(`/api/projects/${encodeURIComponent(state.activeProject)}/plans`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ requirement: reqText })
      });
      $('#planner-req-input').value = '';
      loadPlans();
    } catch (err) { alert(err.message); }
  });

  // Test Execution
  $('#btn-run-tests')?.addEventListener('click', async () => {
    if (!state.activeProject) return;
    const box = $('#test-output-box');
    box.textContent = 'Executing tests in isolated environment…';
    try {
      const res = await api(`/api/projects/${encodeURIComponent(state.activeProject)}/tests/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ command: 'npm test' })
      });
      box.textContent = `[Status: ${res.result.status.toUpperCase()} (${res.result.durationMs}ms)]\n\n${res.result.output}`;
    } catch (err) {
      box.textContent = `Test run error: ${err.message}`;
    }
  });

  // Task generation
  $('#btn-generate-ai-tasks')?.addEventListener('click', async () => {
    if (!state.activeProject) return;
    try {
      await api(`/api/projects/${encodeURIComponent(state.activeProject)}/tasks/generate`, { method: 'POST' });
      loadTasks();
    } catch (err) { alert(err.message); }
  });

  // Notes actions
  $('#btn-create-note')?.addEventListener('click', () => {
    state.activeNote = null;
    $('#note-title-input').value = '';
    $('#note-content-input').value = '';
    $('#note-category-select').value = 'general';
    $('#note-tags-input').value = '';
    $('#note-title-input').focus();
  });

  $('#btn-save-note')?.addEventListener('click', async () => {
    const title = $('#note-title-input').value.trim();
    const content = $('#note-content-input').value.trim();
    const category = $('#note-category-select').value;
    const tags = $('#note-tags-input').value.trim();
    if (!title || !content) return alert('Note title and content are required.');

    try {
      if (state.activeNote) {
        await api(`/api/projects/${encodeURIComponent(state.activeProject)}/notes/${encodeURIComponent(state.activeNote)}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title, content, category, tags })
        });
      } else {
        const created = await api(`/api/projects/${encodeURIComponent(state.activeProject)}/notes`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title, content, category, tags })
        });
        state.activeNote = created.note.id;
      }
      alert('Note saved!');
      loadNotes();
    } catch (err) { alert(err.message); }
  });

  $('#btn-delete-note')?.addEventListener('click', async () => {
    if (!state.activeNote) return;
    if (!confirm('Delete this note?')) return;
    try {
      await api(`/api/projects/${encodeURIComponent(state.activeProject)}/notes/${encodeURIComponent(state.activeNote)}`, { method: 'DELETE' });
      state.activeNote = null;
      $('#note-title-input').value = '';
      $('#note-content-input').value = '';
      loadNotes();
    } catch (err) { alert(err.message); }
  });

  // AI Chat form
  $('#ai-ask-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const input = $('#ai-question-input');
    const question = input.value.trim();
    if (!question || !state.activeProject) return;

    const msgBox = $('#ai-chat-messages');
    const userBubble = document.createElement('div');
    userBubble.style.padding = '0.6rem 0.8rem';
    userBubble.style.borderRadius = '6px';
    userBubble.style.background = 'var(--bg-surface-elevated)';
    userBubble.style.border = '1px solid var(--border-subtle)';
    userBubble.innerHTML = `<strong>You:</strong> <div style="white-space:pre-wrap; margin-top:0.25rem;">${escapeHtml(question)}</div>`;
    msgBox.appendChild(userBubble);
    input.value = '';

    const aiBubble = document.createElement('div');
    aiBubble.style.padding = '0.6rem 0.8rem';
    aiBubble.style.borderRadius = '6px';
    aiBubble.style.background = 'var(--bg-surface)';
    aiBubble.style.border = '1px solid var(--border-subtle)';
    aiBubble.innerHTML = `<strong>CodePilot AI:</strong> <div style="white-space:pre-wrap; margin-top:0.25rem;">Consulting codebase evidence…</div>`;
    msgBox.appendChild(aiBubble);
    msgBox.scrollTop = msgBox.scrollHeight;

    try {
      const res = await api(`/api/projects/${encodeURIComponent(state.activeProject)}/ai/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          conversationId: state.activeConvo,
          messages: [{ role: 'user', content: question }]
        })
      });
      state.activeConvo = res.conversationId;
      aiBubble.querySelector('div').textContent = res.reply;
      loadConversations();
    } catch (err) {
      aiBubble.querySelector('div').textContent = `Error: ${err.message}`;
    }
  });

  $('#btn-new-chat')?.addEventListener('click', () => {
    state.activeConvo = null;
    $('#ai-chat-messages').innerHTML = '<p class="muted">Started a fresh conversation. Enter your question below.</p>';
    loadConversations();
  });

  // Trigger Deployment
  $('#btn-trigger-deploy')?.addEventListener('click', async () => {
    if (!state.activeProject) return;
    const provider = $('#deploy-provider-select').value;
    try {
      await api(`/api/projects/${encodeURIComponent(state.activeProject)}/deploy`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider, environment: 'production' })
      });
      loadDeployments();
    } catch (err) { alert(err.message); }
  });
});