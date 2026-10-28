// CodePilot AI — Client-Side Application Controller
const state = {
  projects: [],
  activeProject: null,
  activeRevision: null,
  activeFile: null,
  activeConvo: null,
  activeNote: null,
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
  if (!container) return;
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

    renderStats(data.counts || {});
    loadActiveTab();
  } catch (err) {
    showFeedback('#project-feedback', err.message, true);
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

  // Highlight active flow pill
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

  // Render Edges with directional markers
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

  // Render Nodes with custom card styles
  nodes.forEach((node) => {
    const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    g.setAttribute('class', `flow-node-group ${state.flow.selectedNode === node.id ? 'selected' : ''}`);
    g.setAttribute('transform', `translate(${node.x}, ${node.y})`);

    const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    rect.setAttribute('width', node.width);
    rect.setAttribute('height', node.height);
    rect.setAttribute('rx', 8);
    rect.setAttribute('class', 'node-box');

    // Type indicator stripe
    const stripe = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    stripe.setAttribute('x', 0);
    stripe.setAttribute('y', 0);
    stripe.setAttribute('width', 5);
    stripe.setAttribute('height', node.height);
    stripe.setAttribute('rx', 3);
    stripe.setAttribute('fill', getNodeTypeColor(node.type));

    const title = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    title.setAttribute('x', 14);
    title.setAttribute('y', 24);
    title.setAttribute('class', 'node-title');
    title.textContent = node.label.length > 22 ? `${node.label.slice(0, 20)}…` : node.label;

    const sub = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    sub.setAttribute('x', 14);
    sub.setAttribute('y', 44);
    sub.setAttribute('class', 'node-sub');
    sub.textContent = node.subtitle ? (node.subtitle.length > 25 ? `${node.subtitle.slice(0, 23)}…` : node.subtitle) : '';

    g.appendChild(rect);
    g.appendChild(stripe);
    g.appendChild(title);
    g.appendChild(sub);

    g.addEventListener('click', () => selectFlowNode(node));
    nodesLayer.appendChild(g);
  });
}

function getNodeTypeColor(type) {
  switch (type) {
    case 'api-endpoint': return '#38bdf8'; // Cyan
    case 'client-view': return '#818cf8'; // Indigo
    case 'service-module': case 'entrypoint': return '#34d399'; // Emerald
    case 'database-entity': return '#fbbf24'; // Amber
    case 'external-package': return '#a855f7'; // Purple
    case 'flow-decision': return '#f59e0b'; // Amber diamond
    case 'error-handler': case 'error-outcome': return '#f43f5e'; // Rose
    default: return '#38bdf8';
  }
}

function selectFlowNode(node) {
  state.flow.selectedNode = node.id;
  renderFlowGraph(state.flow.data);

  const panel = $('#flow-inspector-panel');
  const body = $('#inspector-body');
  if (!panel || !body) return;

  body.classList.remove('hidden');
  $('#inspector-title').textContent = node.label;
  $('#inspector-subtitle').textContent = node.subtitle || node.type;
  $('#inspector-badge').textContent = node.evidence || 'Static Analysis';
  $('#inspector-file-loc').textContent = node.path ? `${node.path}:${node.line || 1}` : 'Inferred Component';

  const excerpt = $('#inspector-excerpt');
  if (node.excerpt) {
    excerpt.textContent = node.excerpt;
    excerpt.classList.remove('hidden');
  } else {
    excerpt.textContent = `Component Type: ${node.type}\nLayer: ${node.layer || 'core'}\nProvenance: Verified via static AST inspection.`;
  }

  // Open in Code Explorer Action
  const btnExplorer = $('#btn-open-in-explorer');
  if (node.path) {
    btnExplorer.classList.remove('hidden');
    btnExplorer.onclick = () => {
      $('[data-tab="tab-code"]')?.click();
      viewFile(node.path);
    };
  } else {
    btnExplorer.classList.add('hidden');
  }
}

// Flow Canvas Pan & Zoom Interaction
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
    if (e.target.closest('.flow-node-group')) return;
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

  // Flow Diagram Type Pills
  $$('.flow-type-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      loadFlowDiagram(btn.dataset.flow);
    });
  });

  // Export SVG
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

  // Export JSON
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

  // Save Diagram
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

  // Diagram AI Natural Language Q&A Form
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

// Code AI Actions
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
      feedback.textContent = res.tests;
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
      feedback.textContent = res.result;
    } catch (err) { feedback.textContent = err.message; }
  });
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
      const bubble = document.createElement('div');
      bubble.style.padding = '0.6rem 0.8rem';
      bubble.style.borderRadius = '6px';
      bubble.style.background = m.role === 'user' ? 'var(--bg-surface-elevated)' : 'var(--bg-surface)';
      bubble.style.border = '1px solid var(--border-subtle)';
      bubble.innerHTML = `<strong>${m.role === 'user' ? 'You' : 'CodePilot AI'}:</strong> <div style="white-space:pre-wrap; margin-top:0.25rem;">${escapeHtml(m.content)}</div>`;
      msgBox.appendChild(bubble);
    });
    msgBox.scrollTop = msgBox.scrollHeight;
  } catch {}
}

// ==========================================================================
// Tasks & Kanban Workspace
// ==========================================================================
async function loadTasks() {
  if (!state.activeProject) return;
  const colTodo = $('#tasks-list-todo');
  const colProg = $('#tasks-list-in-progress');
  const colReview = $('#tasks-list-in-review');
  const colDone = $('#tasks-list-done');
  if (!colTodo) return;

  colTodo.innerHTML = ''; colProg.innerHTML = ''; colReview.innerHTML = ''; colDone.innerHTML = '';
  let countTodo = 0, countProg = 0, countRev = 0, countDone = 0;

  try {
    const data = await api(`/api/projects/${encodeURIComponent(state.activeProject)}/tasks`);
    data.tasks.forEach((t) => {
      const card = document.createElement('div');
      card.className = 'task-card';
      card.innerHTML = `
        <div class="task-card-header">
          <span class="task-card-title">${escapeHtml(t.title)}</span>
          <span class="badge ${t.priority === 'urgent' ? 'badge-warning' : 'badge-accent'}">${t.priority}</span>
        </div>
        <p class="muted" style="font-size:0.8rem;">${escapeHtml(t.description || 'No description')}</p>
        <div class="task-card-meta">
          ${t.target_file ? `<span class="badge badge-idle">${escapeHtml(t.target_file)}</span>` : ''}
          <div style="margin-left:auto; display:flex; gap:0.25rem;">
            ${t.status !== 'todo' ? `<button type="button" class="btn btn-secondary" style="font-size:0.7rem; padding:0.15rem 0.35rem;" onclick="moveTask('${t.id}', 'todo')">← Todo</button>` : ''}
            ${t.status !== 'in-progress' ? `<button type="button" class="btn btn-secondary" style="font-size:0.7rem; padding:0.15rem 0.35rem;" onclick="moveTask('${t.id}', 'in-progress')">Progress</button>` : ''}
            ${t.status !== 'done' ? `<button type="button" class="btn btn-accent" style="font-size:0.7rem; padding:0.15rem 0.35rem;" onclick="moveTask('${t.id}', 'done')">✓ Done</button>` : ''}
            <button type="button" class="btn btn-secondary" style="color:var(--accent-rose); font-size:0.7rem; padding:0.15rem 0.35rem;" onclick="deleteTaskItem('${t.id}')">✕</button>
          </div>
        </div>
      `;

      if (t.status === 'in-progress') { colProg.appendChild(card); countProg++; }
      else if (t.status === 'in-review') { colReview.appendChild(card); countRev++; }
      else if (t.status === 'done') { colDone.appendChild(card); countDone++; }
      else { colTodo.appendChild(card); countTodo++; }
    });

    $('#count-todo').textContent = countTodo;
    $('#count-in-progress').textContent = countProg;
    $('#count-in-review').textContent = countRev;
    $('#count-done').textContent = countDone;
  } catch {}
}

async function moveTask(taskId, newStatus) {
  try {
    await api(`/api/projects/${encodeURIComponent(state.activeProject)}/tasks/${encodeURIComponent(taskId)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: newStatus })
    });
    loadTasks();
  } catch (err) { alert(err.message); }
}

async function deleteTaskItem(taskId) {
  if (!confirm('Delete this task?')) return;
  try {
    await api(`/api/projects/${encodeURIComponent(state.activeProject)}/tasks/${encodeURIComponent(taskId)}`, { method: 'DELETE' });
    loadTasks();
  } catch (err) { alert(err.message); }
}

// ==========================================================================
// Notes & Knowledge Base Workspace
// ==========================================================================
async function loadNotes() {
  const container = $('#notes-list-container');
  if (!container || !state.activeProject) return;
  try {
    const data = await api(`/api/projects/${encodeURIComponent(state.activeProject)}/notes`);
    container.innerHTML = '';
    data.notes.forEach((n) => {
      const item = document.createElement('div');
      item.className = `notes-item ${state.activeNote === n.id ? 'active' : ''}`;
      item.innerHTML = `<strong>${escapeHtml(n.title)}</strong><div class="muted" style="font-size:0.75rem;">${escapeHtml(n.category)} · ${new Date(n.updated_at).toLocaleDateString()}</div>`;
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
  loadNotes();
}

// ==========================================================================
// API Studio Controller
// ==========================================================================
function initApiStudio() {
  $('#btn-send-api-req')?.addEventListener('click', async () => {
    const method = $('#api-req-method').value;
    const url = $('#api-req-url').value.trim();
    if (!url) return alert('Enter target URL.');

    const statusBadge = $('#api-resp-status');
    const respBody = $('#api-resp-body');
    statusBadge.textContent = 'Sending…';
    statusBadge.className = 'badge badge-idle';

    let headers = {};
    try {
      const hText = $('#api-req-headers').value.trim();
      if (hText) headers = JSON.parse(hText);
    } catch { return alert('Invalid JSON in Request Headers.'); }

    let body = null;
    const bText = $('#api-req-body').value.trim();
    if (bText && method !== 'GET') body = bText;

    try {
      const res = await api(`/api/projects/${encodeURIComponent(state.activeProject)}/api-requests/execute`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ method, url, headers, body })
      });
      const result = res.result;
      statusBadge.textContent = `${result.status} ${result.statusText} (${result.durationMs}ms)`;
      statusBadge.className = `badge ${result.status >= 200 && result.status < 300 ? 'badge-accent' : 'badge-warning'}`;
      respBody.textContent = result.body;
    } catch (err) {
      statusBadge.textContent = 'Error';
      statusBadge.className = 'badge badge-warning';
      respBody.textContent = err.message;
    }
  });
}

// ==========================================================================
// Database Studio Controller
// ==========================================================================
async function loadDbStudio() {
  if (!state.activeProject) return;
  const tablesContainer = $('#db-tables-list');
  try {
    const data = await api(`/api/projects/${encodeURIComponent(state.activeProject)}/db-schema`);
    $('#db-dialect-badge').textContent = data.dialect;
    tablesContainer.innerHTML = '';
    data.tables.forEach((t) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'btn btn-secondary';
      btn.style.fontSize = '0.75rem';
      btn.style.textAlign = 'left';
      btn.textContent = `📊 ${t}`;
      btn.onclick = () => {
        $('#db-sql-input').value = `SELECT * FROM ${t} LIMIT 15;`;
        $('#btn-run-sql').click();
      };
      tablesContainer.appendChild(btn);
    });
  } catch {}
}

function initDbStudio() {
  $('#btn-run-sql')?.addEventListener('click', async () => {
    const sql = $('#db-sql-input').value.trim();
    if (!sql) return alert('Enter a SQL statement.');

    const tele = $('#db-query-telemetry');
    const table = $('#db-results-table');
    tele.textContent = 'Executing query…';

    try {
      const data = await api(`/api/projects/${encodeURIComponent(state.activeProject)}/db-query`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sql })
      });
      tele.textContent = `Returned ${data.rowCount} rows in ${data.durationMs}ms.`;
      
      table.innerHTML = '';
      if (data.columns.length > 0) {
        const thead = document.createElement('thead');
        const trHead = document.createElement('tr');
        data.columns.forEach((col) => {
          const th = document.createElement('th');
          th.textContent = col;
          trHead.appendChild(th);
        });
        thead.appendChild(trHead);
        table.appendChild(thead);

        const tbody = document.createElement('tbody');
        data.rows.forEach((row) => {
          const tr = document.createElement('tr');
          data.columns.forEach((col) => {
            const td = document.createElement('td');
            td.textContent = row[col] !== null ? String(row[col]) : 'NULL';
            tr.appendChild(td);
          });
          tbody.appendChild(tr);
        });
        table.appendChild(tbody);
      } else {
        table.innerHTML = '<tr><td class="muted">Query executed successfully (no tabular rows returned).</td></tr>';
      }
    } catch (err) {
      tele.textContent = `Error: ${err.message}`;
    }
  });
}

// ==========================================================================
// Global Command Palette (Ctrl+K)
// ==========================================================================
function initCommandPalette() {
  const palette = $('#command-palette');
  const input = $('#palette-search-input');
  const results = $('#palette-results-container');
  if (!palette || !input || !results) return;

  function openPalette() {
    palette.classList.remove('hidden');
    input.value = '';
    input.focus();
    renderDefaultCommands();
  }

  function closePalette() {
    palette.classList.add('hidden');
  }

  $('#btn-open-palette')?.addEventListener('click', openPalette);

  window.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      if (palette.classList.contains('hidden')) openPalette();
      else closePalette();
    } else if (e.key === 'Escape' && !palette.classList.contains('hidden')) {
      closePalette();
    }
  });

  palette.addEventListener('click', (e) => {
    if (e.target === palette) closePalette();
  });

  function renderDefaultCommands() {
    const commands = [
      { icon: '🏛️', label: 'Open CodePilot Flow (Visual Architecture)', tab: 'tab-flow' },
      { icon: '📂', label: 'Open Code Workspace & File Tree', tab: 'tab-code' },
      { icon: '🤖', label: 'Open AI Assistant', tab: 'tab-ai' },
      { icon: '📋', label: 'Open Tasks & Kanban Board', tab: 'tab-tasks' },
      { icon: '📝', label: 'Open Project Notes & Knowledge Base', tab: 'tab-notes' },
      { icon: '🌐', label: 'Open API Studio', tab: 'tab-api' },
      { icon: '🗄️', label: 'Open Database Studio', tab: 'tab-db' },
      { icon: '🔍', label: 'View Codebase Security & Findings', tab: 'tab-findings' }
    ];

    results.innerHTML = commands
      .map(
        (cmd) => `
        <div class="palette-item" onclick="switchWorkspaceTab('${cmd.tab}'); document.querySelector('#command-palette').classList.add('hidden');">
          <span>${cmd.icon} ${cmd.label}</span>
          <span class="palette-kbd">Jump</span>
        </div>
      `
      )
      .join('');
  }

  input.addEventListener('input', async () => {
    const q = input.value.trim();
    if (!q) return renderDefaultCommands();
    if (!state.activeProject) return;

    try {
      const data = await api(`/api/projects/${encodeURIComponent(state.activeProject)}/search?q=${encodeURIComponent(q)}`);
      results.innerHTML = '';
      const r = data.results;

      (r.files || []).forEach((f) => {
        const item = document.createElement('div');
        item.className = 'palette-item';
        item.innerHTML = `<span>📄 ${escapeHtml(f.path)}</span><small class="badge">${f.language || 'file'}</small>`;
        item.onclick = () => {
          closePalette();
          $('[data-tab="tab-code"]')?.click();
          viewFile(f.path);
        };
        results.appendChild(item);
      });

      (r.tasks || []).forEach((t) => {
        const item = document.createElement('div');
        item.className = 'palette-item';
        item.innerHTML = `<span>📋 ${escapeHtml(t.title)}</span><small class="badge">${t.status}</small>`;
        item.onclick = () => {
          closePalette();
          $('[data-tab="tab-tasks"]')?.click();
        };
        results.appendChild(item);
      });

      (r.diagrams || []).forEach((d) => {
        const item = document.createElement('div');
        item.className = 'palette-item';
        item.innerHTML = `<span>🏛️ ${escapeHtml(d.title)}</span><small class="badge">${d.diagram_type}</small>`;
        item.onclick = () => {
          closePalette();
          $('[data-tab="tab-flow"]')?.click();
          loadFlowDiagram(d.diagram_type);
        };
        results.appendChild(item);
      });
    } catch {}
  });
}

// Workspace Navigation
function switchWorkspaceTab(tabId) {
  $$('.nav-tab').forEach((tab) => {
    tab.classList.toggle('active', tab.dataset.tab === tabId);
  });
  $$('.tab-panel').forEach((panel) => {
    panel.classList.toggle('hidden', panel.id !== tabId);
    panel.classList.toggle('active', panel.id === tabId);
  });
  loadActiveTab();
}

function loadActiveTab() {
  const activeTab = $('.nav-tab.active')?.dataset.tab;
  switch (activeTab) {
    case 'tab-flow': loadFlowDiagram(); break;
    case 'tab-code': loadFileList(); break;
    case 'tab-ai': loadConversations(); break;
    case 'tab-tasks': loadTasks(); break;
    case 'tab-notes': loadNotes(); break;
    case 'tab-api': break;
    case 'tab-db': loadDbStudio(); break;
    case 'tab-findings': loadFindings(); break;
    case 'tab-planner': loadPlans(); break;
    case 'tab-patches': loadPatches(); break;
    case 'tab-docker': loadDocker(); break;
    case 'tab-deploy': loadDeployments(); break;
    case 'tab-audit': loadAudit(); break;
  }
}

// Findings & Diagnostics
async function loadFindings() {
  const container = $('#findings-list-container');
  if (!container || !state.activeRevision) return;
  try {
    const data = await api(`/api/projects/${encodeURIComponent(state.activeProject)}/findings`);
    container.innerHTML = '';
    const filter = $('#findings-filter-select')?.value || 'all';
    const filtered = filter === 'all' ? data.findings : data.findings.filter((f) => f.severity === filter);

    if (!filtered.length) {
      container.innerHTML = '<span class="muted" style="font-size:0.85rem;">No security findings detected in this category.</span>';
      return;
    }

    filtered.forEach((f) => {
      const card = document.createElement('div');
      card.className = 'finding-card';
      card.innerHTML = `
        <div class="finding-header">
          <span class="badge ${f.severity === 'critical' || f.severity === 'high' ? 'badge-warning' : 'badge-idle'}">${f.severity.toUpperCase()}</span>
          <strong>${escapeHtml(f.category)}: ${escapeHtml(f.message)}</strong>
        </div>
        <p class="meta-text" style="margin-top:0.35rem;">Location: ${escapeHtml(f.filePath || 'Global')}${f.line ? `:${f.line}` : ''}</p>
        ${f.evidence ? `<pre style="font-size:0.75rem; background:var(--bg-input); padding:0.4rem; border-radius:4px; margin-top:0.35rem;">${escapeHtml(f.evidence)}</pre>` : ''}
      `;
      container.appendChild(card);
    });
  } catch {}
}

// Planner
async function loadPlans() {
  const container = $('#plans-container');
  if (!container || !state.activeProject) return;
  try {
    const data = await api(`/api/projects/${encodeURIComponent(state.activeProject)}/plans`);
    container.innerHTML = '';
    data.plans.forEach((p) => {
      const card = document.createElement('div');
      card.className = 'plan-card';
      card.innerHTML = `
        <h4>${escapeHtml(p.title)} <small class="badge badge-accent">${p.complexity}</small></h4>
        <p class="muted" style="font-size:0.85rem; margin-top:0.35rem;">${escapeHtml(p.requirement)}</p>
      `;
      container.appendChild(card);
    });
  } catch {}
}

// Patches
async function loadPatches() {
  const container = $('#patches-container');
  if (!container || !state.activeProject) return;
  try {
    const data = await api(`/api/projects/${encodeURIComponent(state.activeProject)}/patches`);
    container.innerHTML = '';
    data.patches.forEach((p) => {
      const card = document.createElement('div');
      card.className = 'patch-card';
      card.innerHTML = `
        <h4>${escapeHtml(p.title)} <small class="badge ${p.status === 'applied' ? 'badge-accent' : 'badge-idle'}">${p.status}</small></h4>
        <pre class="diff-viewer" style="margin-top:0.5rem; max-height:200px; overflow-y:auto;">${escapeHtml(p.diff)}</pre>
      `;
      container.appendChild(card);
    });
  } catch {}
}

// Docker
async function loadDocker() {
  if (!state.activeRevision) return;
  try {
    const data = await api(`/api/projects/${encodeURIComponent(state.activeProject)}/docker`);
    $('#docker-stack-badge').textContent = `Stack: ${data.stack.primaryLanguage} (${data.stack.framework || 'standard'})`;
    $('#dockerfile-preview').textContent = data.dockerfile;
    $('#compose-preview').textContent = data.dockerCompose;
  } catch {}
}

// Deployments
async function loadDeployments() {
  if (!state.activeProject) return;
  try {
    const rData = await api(`/api/projects/${encodeURIComponent(state.activeProject)}/deployment-readiness`);
    $('#readiness-checklist').innerHTML = `
      <div style="font-weight:700; margin-bottom:0.5rem;">Readiness Status: <span class="badge ${rData.ready ? 'badge-accent' : 'badge-warning'}">${rData.ready ? 'VERIFIED READY' : 'ACTION REQUIRED'}</span></div>
      ${rData.checks.map((c) => `<div>${c.passed ? '✓' : '✗'} <strong>${escapeHtml(c.name)}</strong>: ${escapeHtml(c.detail)}</div>`).join('')}
    `;

    const dData = await api(`/api/projects/${encodeURIComponent(state.activeProject)}/deployments`);
    $('#deployments-history').innerHTML = dData.deployments.map((d) => `
      <div class="deploy-card">
        <div><strong>Provider: ${escapeHtml(d.provider)}</strong> · Status: <span class="badge badge-accent">${d.status}</span></div>
        <p class="meta-text">${new Date(d.created_at).toLocaleString()}</p>
        <pre style="font-size:0.75rem; background:var(--bg-input); padding:0.4rem; border-radius:4px; margin-top:0.35rem;">${escapeHtml(d.logs || 'No logs recorded.')}</pre>
      </div>
    `).join('');
  } catch {}
}

// Audit
async function loadAudit() {
  try {
    const data = await api('/api/audit');
    $('#audit-events-container').innerHTML = data.events.map((e) => `
      <div class="audit-row">
        <span>[${new Date(e.created_at).toLocaleTimeString()}] <strong>${escapeHtml(e.action)}</strong></span>
        <span>${escapeHtml(e.detail)}</span>
      </div>
    `).join('');
  } catch {}
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

  // Navigation tab clicks
  $$('.nav-tab').forEach((tab) => {
    tab.addEventListener('click', () => switchWorkspaceTab(tab.dataset.tab));
  });

  // Project Creation
  $('#project-create-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = $('#new-project-name').value.trim();
    if (!name) return;
    try {
      const data = await api('/api/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name })
      });
      $('#new-project-name').value = '';
      await loadProjects();
      selectProject(data.project.id);
    } catch (err) {
      showFeedback('#project-feedback', err.message, true);
    }
  });

  // Project Deletion
  $('#btn-delete-project')?.addEventListener('click', async () => {
    if (!state.activeProject) return;
    if (!confirm('Are you sure you want to delete this active project?')) return;
    try {
      await api(`/api/projects/${encodeURIComponent(state.activeProject)}`, { method: 'DELETE' });
      state.activeProject = null;
      state.activeRevision = null;
      $('#workspace-container').classList.add('hidden');
      await loadProjects();
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

  // Refresh
  $('#btn-refresh')?.addEventListener('click', () => {
    if (state.activeProject) selectProject(state.activeProject);
  });

  // File search filter
  $('#file-search-input')?.addEventListener('input', () => loadFileList());

  // Task creation modal
  $('#btn-create-task-modal')?.addEventListener('click', async () => {
    const title = prompt('Task title:');
    if (!title) return;
    const desc = prompt('Task description (optional):') || '';
    const pri = prompt('Priority (low, medium, high, urgent):', 'medium') || 'medium';
    try {
      await api(`/api/projects/${encodeURIComponent(state.activeProject)}/tasks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, description: desc, priority: pri })
      });
      loadTasks();
    } catch (err) { alert(err.message); }
  });

  // AI Task generation
  $('#btn-generate-ai-tasks')?.addEventListener('click', async () => {
    const req = prompt('Describe requirements or goal to generate tasks for:', 'Improve test coverage, fix high severity findings, and document APIs');
    if (!req) return;
    try {
      await api(`/api/projects/${encodeURIComponent(state.activeProject)}/tasks/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ requirement: req })
      });
      loadTasks();
    } catch (err) { alert(err.message); }
  });

  // Notes save & delete
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
