const { DatabaseSync } = require('node:sqlite');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { hashPassword, verifyPassword, generateToken, sanitizeUser } = require('./auth');

function id(prefix) {
  return `${prefix}_${crypto.randomUUID()}`;
}

function now() {
  return new Date().toISOString();
}

class Store {
  constructor(dataDir) {
    fs.mkdirSync(dataDir, { recursive: true });
    this.db = new DatabaseSync(path.join(dataDir, 'codepilot.db'));
    this.db.exec('PRAGMA foreign_keys = ON;');
    this.initSchema();
  }

  initSchema() {
    this.db.exec(`
      -- Users & Sessions
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        email TEXT UNIQUE NOT NULL,
        name TEXT NOT NULL,
        password_hash TEXT NOT NULL,
        is_global_admin INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS sessions (
        token TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        expires_at TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      -- Workspaces & RBAC
      CREATE TABLE IF NOT EXISTS workspaces (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        slug TEXT UNIQUE NOT NULL,
        owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS workspace_members (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        role TEXT NOT NULL DEFAULT 'editor', -- 'owner', 'admin', 'editor', 'viewer'
        created_at TEXT NOT NULL,
        UNIQUE(workspace_id, user_id)
      );

      -- Projects & Revisions
      CREATE TABLE IF NOT EXISTS projects (
        id TEXT PRIMARY KEY,
        workspace_id TEXT REFERENCES workspaces(id) ON DELETE SET NULL,
        name TEXT NOT NULL,
        description TEXT,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS revisions (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        content_hash TEXT NOT NULL,
        created_at TEXT NOT NULL,
        status TEXT NOT NULL,
        summary TEXT,
        UNIQUE(project_id, content_hash)
      );

      CREATE TABLE IF NOT EXISTS jobs (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        revision_id TEXT REFERENCES revisions(id) ON DELETE CASCADE,
        stage TEXT NOT NULL,
        status TEXT NOT NULL,
        detail TEXT,
        created_at TEXT NOT NULL,
        completed_at TEXT
      );

      CREATE TABLE IF NOT EXISTS files (
        id TEXT PRIMARY KEY,
        revision_id TEXT NOT NULL REFERENCES revisions(id) ON DELETE CASCADE,
        path TEXT NOT NULL,
        language TEXT,
        bytes INTEGER NOT NULL,
        content TEXT,
        excluded_reason TEXT,
        UNIQUE(revision_id, path)
      );

      CREATE TABLE IF NOT EXISTS symbols (
        id TEXT PRIMARY KEY,
        revision_id TEXT NOT NULL REFERENCES revisions(id) ON DELETE CASCADE,
        file_path TEXT NOT NULL,
        name TEXT NOT NULL,
        kind TEXT NOT NULL,
        line INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS edges (
        id TEXT PRIMARY KEY,
        revision_id TEXT NOT NULL REFERENCES revisions(id) ON DELETE CASCADE,
        source_path TEXT NOT NULL,
        target_path TEXT NOT NULL,
        type TEXT NOT NULL,
        confidence TEXT NOT NULL,
        line INTEGER,
        provenance TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS findings (
        id TEXT PRIMARY KEY,
        revision_id TEXT NOT NULL REFERENCES revisions(id) ON DELETE CASCADE,
        severity TEXT NOT NULL, -- 'critical', 'high', 'medium', 'low', 'info'
        category TEXT NOT NULL,
        message TEXT NOT NULL,
        file_path TEXT,
        line INTEGER,
        evidence TEXT,
        status TEXT NOT NULL DEFAULT 'open', -- 'open', 'suppressed', 'resolved'
        suppression_reason TEXT
      );

      CREATE TABLE IF NOT EXISTS architecture_reports (
        id TEXT PRIMARY KEY,
        revision_id TEXT UNIQUE NOT NULL REFERENCES revisions(id) ON DELETE CASCADE,
        report_json TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS conversations (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        title TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS messages (
        id TEXT PRIMARY KEY,
        conversation_id TEXT REFERENCES conversations(id) ON DELETE CASCADE,
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        revision_id TEXT REFERENCES revisions(id) ON DELETE SET NULL,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        citations TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      -- Implementation Planning & Tasks
      CREATE TABLE IF NOT EXISTS plans (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        revision_id TEXT NOT NULL REFERENCES revisions(id) ON DELETE CASCADE,
        title TEXT NOT NULL,
        requirement TEXT NOT NULL,
        complexity TEXT NOT NULL, -- 'low', 'medium', 'high', 'complex'
        status TEXT NOT NULL DEFAULT 'draft', -- 'draft', 'in_progress', 'completed'
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS plan_tasks (
        id TEXT PRIMARY KEY,
        plan_id TEXT NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
        title TEXT NOT NULL,
        description TEXT NOT NULL,
        target_file TEXT,
        sequence_order INTEGER NOT NULL,
        acceptance_criteria TEXT,
        status TEXT NOT NULL DEFAULT 'pending' -- 'pending', 'in_progress', 'completed', 'blocked'
      );

      -- Patch & Code Modification Engine
      CREATE TABLE IF NOT EXISTS patches (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        revision_id TEXT NOT NULL REFERENCES revisions(id) ON DELETE CASCADE,
        plan_id TEXT REFERENCES plans(id) ON DELETE SET NULL,
        title TEXT NOT NULL,
        target_file TEXT NOT NULL,
        diff TEXT NOT NULL,
        original_content TEXT,
        patched_content TEXT,
        status TEXT NOT NULL DEFAULT 'draft', -- 'draft', 'approved', 'applied', 'rejected', 'rolled_back'
        applied_at TEXT,
        created_at TEXT NOT NULL
      );

      -- Test Runs
      CREATE TABLE IF NOT EXISTS test_runs (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        revision_id TEXT NOT NULL REFERENCES revisions(id) ON DELETE CASCADE,
        test_type TEXT NOT NULL, -- 'unit', 'integration', 'smoke', 'security'
        command TEXT NOT NULL,
        status TEXT NOT NULL, -- 'passed', 'failed', 'error'
        exit_code INTEGER,
        output TEXT,
        duration_ms INTEGER,
        created_at TEXT NOT NULL
      );

      -- Deployment & Verification
      CREATE TABLE IF NOT EXISTS deployments (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        revision_id TEXT NOT NULL REFERENCES revisions(id) ON DELETE CASCADE,
        provider TEXT NOT NULL, -- 'local-docker', 'render', 'vercel', 'fly', 'mock'
        environment TEXT NOT NULL DEFAULT 'production',
        status TEXT NOT NULL, -- 'draft', 'validating', 'awaiting_approval', 'deploying', 'deployed', 'verifying', 'verified', 'failed', 'rolled_back'
        public_url TEXT,
        health_check_url TEXT,
        health_status TEXT, -- 'healthy', 'unhealthy', 'unverified'
        logs TEXT,
        error_message TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      -- Audit Trail
      CREATE TABLE IF NOT EXISTS audit_events (
        id TEXT PRIMARY KEY,
        actor_id TEXT REFERENCES users(id) ON DELETE SET NULL,
        action TEXT NOT NULL,
        project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
        detail TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      -- Performance Indexes
      CREATE INDEX IF NOT EXISTS idx_files_revision_path ON files(revision_id, path);
      CREATE INDEX IF NOT EXISTS idx_symbols_revision_name ON symbols(revision_id, name);
      CREATE INDEX IF NOT EXISTS idx_edges_revision ON edges(revision_id);
      CREATE INDEX IF NOT EXISTS idx_findings_revision ON findings(revision_id, severity);
      CREATE INDEX IF NOT EXISTS idx_deployments_project ON deployments(project_id, created_at);
      CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_events(created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_sessions_token ON sessions(token);
    `);
  }

  close() {
    try {
      this.db.close();
    } catch {}
  }

  run(sql, ...args) {
    return this.db.prepare(sql).run(...args);
  }

  get(sql, ...args) {
    return this.db.prepare(sql).get(...args);
  }

  all(sql, ...args) {
    return this.db.prepare(sql).all(...args);
  }

  audit(action, projectId, detail, actorId = null) {
    const eventId = id('audit');
    this.run(
      'INSERT INTO audit_events VALUES (?, ?, ?, ?, ?, ?)',
      eventId,
      actorId,
      action,
      projectId || null,
      detail,
      now()
    );
    return eventId;
  }

  // User & Auth operations
  createUser(email, name, password, isGlobalAdmin = 0) {
    const userId = id('user');
    const passwordHash = hashPassword(password);
    const createdAt = now();
    this.run(
      'INSERT INTO users VALUES (?, ?, ?, ?, ?, ?)',
      userId,
      email.toLowerCase().trim(),
      name.trim(),
      passwordHash,
      isGlobalAdmin ? 1 : 0,
      createdAt
    );
    this.audit('user.created', null, `Created user ${email}`, userId);
    return { id: userId, email: email.toLowerCase().trim(), name: name.trim(), is_global_admin: isGlobalAdmin ? 1 : 0, created_at: createdAt };
  }

  getUserByEmail(email) {
    return this.get('SELECT * FROM users WHERE email = ?', email.toLowerCase().trim());
  }

  getUserById(userId) {
    const u = this.get('SELECT * FROM users WHERE id = ?', userId);
    return sanitizeUser(u);
  }

  authenticateUser(email, password) {
    const user = this.getUserByEmail(email);
    if (!user) return null;
    if (!verifyPassword(password, user.password_hash)) return null;
    return sanitizeUser(user);
  }

  createSession(userId, expiresInHours = 72) {
    const token = generateToken();
    const expiresAt = new Date(Date.now() + expiresInHours * 3600 * 1000).toISOString();
    this.run('INSERT INTO sessions VALUES (?, ?, ?, ?)', token, userId, expiresAt, now());
    return { token, expiresAt };
  }

  getSessionUser(token) {
    if (!token) return null;
    const session = this.get('SELECT * FROM sessions WHERE token = ?', token);
    if (!session) return null;
    if (new Date(session.expires_at) < new Date()) {
      this.run('DELETE FROM sessions WHERE token = ?', token);
      return null;
    }
    return this.getUserById(session.user_id);
  }

  deleteSession(token) {
    this.run('DELETE FROM sessions WHERE token = ?', token);
  }

  // Workspaces
  createWorkspace(name, ownerId) {
    const wsId = id('ws');
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || `ws-${Date.now()}`;
    const createdAt = now();
    this.run('INSERT INTO workspaces VALUES (?, ?, ?, ?, ?)', wsId, name, slug, ownerId, createdAt);
    this.run('INSERT INTO workspace_members VALUES (?, ?, ?, ?, ?)', id('member'), wsId, ownerId, 'owner', createdAt);
    this.audit('workspace.created', null, `Created workspace ${name}`, ownerId);
    return { id: wsId, name, slug, owner_id: ownerId, created_at: createdAt };
  }

  getUserWorkspaces(userId) {
    return this.all(`
      SELECT w.*, wm.role 
      FROM workspaces w
      JOIN workspace_members wm ON w.id = wm.workspace_id
      WHERE wm.user_id = ?
      ORDER BY w.created_at DESC
    `, userId);
  }

  getWorkspaceRole(workspaceId, userId) {
    const member = this.get('SELECT role FROM workspace_members WHERE workspace_id = ? AND user_id = ?', workspaceId, userId);
    return member ? member.role : null;
  }

  // Projects
  createProject(name, description = '', workspaceId = null, actorId = null) {
    const project = { id: id('project'), workspace_id: workspaceId, name, description, created_at: now() };
    this.run(
      'INSERT INTO projects VALUES (?, ?, ?, ?, ?)',
      project.id,
      project.workspace_id,
      project.name,
      project.description,
      project.created_at
    );
    this.audit('project.created', project.id, `Created project ${name}`, actorId);
    return project;
  }

  listProjects(workspaceId = null) {
    if (workspaceId) {
      return this.all(`
        SELECT p.*, 
          (SELECT id FROM revisions r WHERE r.project_id=p.id ORDER BY created_at DESC LIMIT 1) AS latest_revision_id,
          (SELECT status FROM revisions r WHERE r.project_id=p.id ORDER BY created_at DESC LIMIT 1) AS latest_status
        FROM projects p 
        WHERE p.workspace_id = ?
        ORDER BY created_at DESC
      `, workspaceId);
    }
    return this.all(`
      SELECT p.*, 
        (SELECT id FROM revisions r WHERE r.project_id=p.id ORDER BY created_at DESC LIMIT 1) AS latest_revision_id,
        (SELECT status FROM revisions r WHERE r.project_id=p.id ORDER BY created_at DESC LIMIT 1) AS latest_status
      FROM projects p 
      ORDER BY created_at DESC
    `);
  }

  project(idValue) {
    return this.get('SELECT * FROM projects WHERE id = ?', idValue);
  }

  deleteProject(projectId, actorId = null) {
    const p = this.project(projectId);
    if (!p) return false;
    this.run('DELETE FROM projects WHERE id = ?', projectId);
    this.audit('project.deleted', projectId, `Deleted project ${p.name}`, actorId);
    return true;
  }

  // Revisions & Jobs
  latestRevision(projectId) {
    return this.get('SELECT * FROM revisions WHERE project_id = ? ORDER BY created_at DESC LIMIT 1', projectId);
  }

  createJob(projectId, stage, detail) {
    const job = { id: id('job'), projectId, stage, detail, createdAt: now() };
    this.run('INSERT INTO jobs VALUES (?, ?, ?, ?, ?, ?, ?, ?)', job.id, projectId, null, stage, 'running', detail, job.createdAt, null);
    return job;
  }

  finishJob(jobId, revisionId, status, detail) {
    this.run('UPDATE jobs SET revision_id=?, status=?, detail=?, completed_at=? WHERE id=?', revisionId || null, status, detail, now(), jobId);
  }

  saveRevision(projectId, contentHash, records, summary = null) {
    const existing = this.get('SELECT * FROM revisions WHERE project_id=? AND content_hash=?', projectId, contentHash);
    if (existing) return { revision: existing, duplicate: true };

    const revision = { id: id('revision'), projectId, contentHash, createdAt: now() };
    this.db.exec('BEGIN');
    try {
      this.run('INSERT INTO revisions VALUES (?, ?, ?, ?, ?, ?)', revision.id, projectId, contentHash, revision.createdAt, 'ready', summary);
      for (const file of records.files) {
        this.run('INSERT INTO files VALUES (?, ?, ?, ?, ?, ?, ?)', id('file'), revision.id, file.path, file.language, file.bytes, file.content, file.excludedReason || null);
      }
      for (const symbol of records.symbols) {
        this.run('INSERT INTO symbols VALUES (?, ?, ?, ?, ?, ?)', id('symbol'), revision.id, symbol.filePath, symbol.name, symbol.kind, symbol.line);
      }
      for (const edge of records.edges) {
        this.run('INSERT INTO edges VALUES (?, ?, ?, ?, ?, ?, ?, ?)', id('edge'), revision.id, edge.sourcePath, edge.targetPath, edge.type, edge.confidence, edge.line || null, edge.provenance);
      }
      for (const finding of records.findings) {
        this.run('INSERT INTO findings VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', id('finding'), revision.id, finding.severity, finding.category, finding.message, finding.filePath || null, finding.line || null, finding.evidence || null, 'open', null);
      }
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
    this.audit('revision.imported', projectId, `Imported revision ${revision.id}`);
    return { revision: { ...revision, status: 'ready', summary }, duplicate: false };
  }

  projectSummary(projectId) {
    const project = this.project(projectId);
    if (!project) return null;
    const revision = this.latestRevision(projectId);
    if (!revision) return { project, revision: null, counts: {} };

    const count = (table) => this.get(`SELECT COUNT(*) AS count FROM ${table} WHERE revision_id=?`, revision.id).count;
    return {
      project,
      revision,
      counts: {
        files: count('files'),
        symbols: count('symbols'),
        edges: count('edges'),
        findings: count('findings')
      }
    };
  }

  // Findings suppression
  suppressFinding(findingId, reason, actorId = null) {
    const finding = this.get('SELECT * FROM findings WHERE id = ?', findingId);
    if (!finding) return null;
    this.run("UPDATE findings SET status='suppressed', suppression_reason=? WHERE id=?", reason, findingId);
    this.audit('finding.suppressed', null, `Suppressed finding ${findingId}: ${reason}`, actorId);
    return { ...finding, status: 'suppressed', suppression_reason: reason };
  }

  // Implementation Plans
  createPlan(projectId, revisionId, title, requirement, complexity, tasks = []) {
    const planId = id('plan');
    const createdAt = now();
    this.db.exec('BEGIN');
    try {
      this.run('INSERT INTO plans VALUES (?, ?, ?, ?, ?, ?, ?, ?)', planId, projectId, revisionId, title, requirement, complexity, 'draft', createdAt);
      let order = 1;
      for (const task of tasks) {
        this.run(
          'INSERT INTO plan_tasks VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
          id('task'),
          planId,
          task.title,
          task.description,
          task.targetFile || null,
          order++,
          task.acceptanceCriteria || null,
          'pending'
        );
      }
      this.db.exec('COMMIT');
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }
    return this.getPlan(planId);
  }

  getPlan(planId) {
    const plan = this.get('SELECT * FROM plans WHERE id = ?', planId);
    if (!plan) return null;
    const tasks = this.all('SELECT * FROM plan_tasks WHERE plan_id = ? ORDER BY sequence_order ASC', planId);
    return { ...plan, tasks };
  }

  listPlans(projectId) {
    const plans = this.all('SELECT * FROM plans WHERE project_id = ? ORDER BY created_at DESC', projectId);
    return plans.map((p) => ({
      ...p,
      taskCount: this.get('SELECT COUNT(*) AS count FROM plan_tasks WHERE plan_id = ?', p.id).count
    }));
  }

  updateTaskStatus(taskId, status) {
    this.run('UPDATE plan_tasks SET status = ? WHERE id = ?', status, taskId);
    return this.get('SELECT * FROM plan_tasks WHERE id = ?', taskId);
  }

  // Patches
  createPatch(projectId, revisionId, planId, title, targetFile, diff, originalContent, patchedContent) {
    const patchId = id('patch');
    const createdAt = now();
    this.run(
      'INSERT INTO patches VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      patchId,
      projectId,
      revisionId,
      planId || null,
      title,
      targetFile,
      diff,
      originalContent,
      patchedContent,
      'draft',
      null,
      createdAt
    );
    return this.get('SELECT * FROM patches WHERE id = ?', patchId);
  }

  getPatch(patchId) {
    return this.get('SELECT * FROM patches WHERE id = ?', patchId);
  }

  listPatches(projectId) {
    return this.all('SELECT * FROM patches WHERE project_id = ? ORDER BY created_at DESC', projectId);
  }

  applyPatch(patchId, actorId = null) {
    const patch = this.getPatch(patchId);
    if (!patch) return null;
    const appliedAt = now();
    this.run("UPDATE patches SET status = 'applied', applied_at = ? WHERE id = ?", appliedAt, patchId);
    // Also update file in current revision if present
    this.run("UPDATE files SET content = ? WHERE revision_id = ? AND path = ?", patch.patched_content, patch.revision_id, patch.target_file);
    this.audit('patch.applied', patch.project_id, `Applied patch ${patch.title} to ${patch.target_file}`, actorId);
    return { ...patch, status: 'applied', applied_at: appliedAt };
  }

  rollbackPatch(patchId, actorId = null) {
    const patch = this.getPatch(patchId);
    if (!patch || patch.status !== 'applied') return null;
    this.run("UPDATE patches SET status = 'rolled_back' WHERE id = ?", patchId);
    // Restore original file content
    this.run("UPDATE files SET content = ? WHERE revision_id = ? AND path = ?", patch.original_content, patch.revision_id, patch.target_file);
    this.audit('patch.rolled_back', patch.project_id, `Rolled back patch ${patch.title} for ${patch.target_file}`, actorId);
    return { ...patch, status: 'rolled_back' };
  }

  // Deployments
  createDeployment(projectId, revisionId, provider, environment = 'production') {
    const depId = id('deploy');
    const timestamp = now();
    this.run(
      'INSERT INTO deployments VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      depId,
      projectId,
      revisionId,
      provider,
      environment,
      'validating',
      null,
      null,
      'unverified',
      `[${timestamp}] Deployment initialized for provider: ${provider}\n`,
      null,
      timestamp,
      timestamp
    );
    return this.get('SELECT * FROM deployments WHERE id = ?', depId);
  }

  updateDeployment(depId, updates) {
    const dep = this.get('SELECT * FROM deployments WHERE id = ?', depId);
    if (!dep) return null;
    const updatedAt = now();
    const newLogs = updates.log ? (dep.logs || '') + `[${updatedAt}] ${updates.log}\n` : dep.logs;
    this.run(`
      UPDATE deployments SET 
        status = COALESCE(?, status),
        public_url = COALESCE(?, public_url),
        health_check_url = COALESCE(?, health_check_url),
        health_status = COALESCE(?, health_status),
        logs = ?,
        error_message = COALESCE(?, error_message),
        updated_at = ?
      WHERE id = ?
    `,
      updates.status || null,
      updates.publicUrl || null,
      updates.healthCheckUrl || null,
      updates.healthStatus || null,
      newLogs,
      updates.errorMessage || null,
      updatedAt,
      depId
    );
    return this.get('SELECT * FROM deployments WHERE id = ?', depId);
  }

  listDeployments(projectId) {
    return this.all('SELECT * FROM deployments WHERE project_id = ? ORDER BY created_at DESC LIMIT 50', projectId);
  }

  getDeployment(depId) {
    return this.get('SELECT * FROM deployments WHERE id = ?', depId);
  }
}

module.exports = { Store };
