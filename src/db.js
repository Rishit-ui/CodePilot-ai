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

function toPostgresSql(sql) {
  let paramIndex = 1;
  return sql.replace(/\?/g, () => `$${paramIndex++}`);
}

const SCHEMA_DDL = `
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
    role TEXT NOT NULL DEFAULT 'editor',
    created_at TEXT NOT NULL,
    UNIQUE(workspace_id, user_id)
  );

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
    severity TEXT NOT NULL,
    category TEXT NOT NULL,
    message TEXT NOT NULL,
    file_path TEXT,
    line INTEGER,
    evidence TEXT,
    status TEXT NOT NULL DEFAULT 'open',
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

  CREATE TABLE IF NOT EXISTS plans (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    revision_id TEXT NOT NULL REFERENCES revisions(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    requirement TEXT NOT NULL,
    complexity TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'draft',
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
    status TEXT NOT NULL DEFAULT 'pending'
  );

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
    status TEXT NOT NULL DEFAULT 'draft',
    applied_at TEXT,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS test_runs (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    revision_id TEXT NOT NULL REFERENCES revisions(id) ON DELETE CASCADE,
    test_type TEXT NOT NULL,
    command TEXT NOT NULL,
    status TEXT NOT NULL,
    exit_code INTEGER,
    output TEXT,
    duration_ms INTEGER,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS deployments (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    revision_id TEXT NOT NULL REFERENCES revisions(id) ON DELETE CASCADE,
    provider TEXT NOT NULL,
    environment TEXT NOT NULL DEFAULT 'production',
    status TEXT NOT NULL,
    public_url TEXT,
    health_check_url TEXT,
    health_status TEXT,
    logs TEXT,
    error_message TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS audit_events (
    id TEXT PRIMARY KEY,
    actor_id TEXT REFERENCES users(id) ON DELETE SET NULL,
    action TEXT NOT NULL,
    project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
    detail TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_files_revision_path ON files(revision_id, path);
  CREATE INDEX IF NOT EXISTS idx_symbols_revision_name ON symbols(revision_id, name);
  CREATE INDEX IF NOT EXISTS idx_edges_revision ON edges(revision_id);
  CREATE INDEX IF NOT EXISTS idx_findings_revision ON findings(revision_id, severity);
  CREATE INDEX IF NOT EXISTS idx_deployments_project ON deployments(project_id, created_at);
  CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_events(created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_sessions_token ON sessions(token);
`;

class Store {
  constructor(dataDirOrOptions, maybeDatabaseUrl) {
    let dataDir = '.data';
    let databaseUrl = null;

    if (typeof dataDirOrOptions === 'object' && dataDirOrOptions !== null) {
      dataDir = dataDirOrOptions.dataDir || '.data';
      databaseUrl = dataDirOrOptions.databaseUrl || null;
    } else {
      dataDir = dataDirOrOptions || '.data';
      databaseUrl = maybeDatabaseUrl || null;
    }

    this.databaseUrl = databaseUrl;
    this.dataDir = dataDir;

    if (this.databaseUrl) {
      this.dialect = 'postgres';
      const { Pool } = require('pg');
      const isLocalhost = this.databaseUrl.includes('localhost') || this.databaseUrl.includes('127.0.0.1');
      this.pool = new Pool({
        connectionString: this.databaseUrl,
        ssl: isLocalhost ? false : { rejectUnauthorized: false },
        max: 10,
        idleTimeoutMillis: 30000
      });
      this.initPostgresSchema();
    } else {
      this.dialect = 'sqlite';
      let DatabaseSync;
      try {
        DatabaseSync = require('node:sqlite').DatabaseSync;
      } catch (err) {
        throw new Error(
          'SQLite requires Node.js >= 22.5.0 (with node:sqlite) or a PostgreSQL connection string via DATABASE_URL.'
        );
      }
      fs.mkdirSync(this.dataDir, { recursive: true });
      this.sqlite = new DatabaseSync(path.join(this.dataDir, 'codepilot.db'));
      this.sqlite.exec('PRAGMA foreign_keys = ON;');
      this.sqlite.exec(SCHEMA_DDL);
    }
  }

  initPostgresSchema() {
    this.readyPromise = (async () => {
      try {
        await this.pool.query(SCHEMA_DDL);
      } catch (err) {
        console.error('Failed to initialize PostgreSQL schema:', err.message);
      }
    })();
  }

  async ensureReady() {
    if (this.readyPromise) {
      await this.readyPromise;
    }
  }

  async close() {
    try {
      if (this.dialect === 'postgres' && this.pool) {
        await this.pool.end();
      } else if (this.sqlite) {
        this.sqlite.close();
      }
    } catch {}
  }

  async run(sql, ...args) {
    if (this.dialect === 'postgres') {
      await this.ensureReady();
      const res = await this.pool.query(toPostgresSql(sql), args);
      return { changes: res.rowCount };
    }
    return this.sqlite.prepare(sql).run(...args);
  }

  async get(sql, ...args) {
    if (this.dialect === 'postgres') {
      await this.ensureReady();
      const res = await this.pool.query(toPostgresSql(sql), args);
      return res.rows[0] || null;
    }
    return this.sqlite.prepare(sql).get(...args) || null;
  }

  async all(sql, ...args) {
    if (this.dialect === 'postgres') {
      await this.ensureReady();
      const res = await this.pool.query(toPostgresSql(sql), args);
      return res.rows;
    }
    return this.sqlite.prepare(sql).all(...args);
  }

  async audit(action, projectId, detail, actorId = null) {
    const eventId = id('audit');
    await this.run(
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
  async createUser(email, name, password, isGlobalAdmin = 0) {
    const userId = id('user');
    const passwordHash = hashPassword(password);
    const createdAt = now();
    await this.run(
      'INSERT INTO users VALUES (?, ?, ?, ?, ?, ?)',
      userId,
      email.toLowerCase().trim(),
      name.trim(),
      passwordHash,
      isGlobalAdmin ? 1 : 0,
      createdAt
    );
    await this.audit('user.created', null, `Created user ${email}`, userId);
    return {
      id: userId,
      email: email.toLowerCase().trim(),
      name: name.trim(),
      is_global_admin: isGlobalAdmin ? 1 : 0,
      created_at: createdAt
    };
  }

  async getUserByEmail(email) {
    return await this.get('SELECT * FROM users WHERE email = ?', email.toLowerCase().trim());
  }

  async getUserById(userId) {
    const u = await this.get('SELECT * FROM users WHERE id = ?', userId);
    return sanitizeUser(u);
  }

  async authenticateUser(email, password) {
    const user = await this.getUserByEmail(email);
    if (!user) return null;
    if (!verifyPassword(password, user.password_hash)) return null;
    return sanitizeUser(user);
  }

  async createSession(userId, expiresInHours = 72) {
    const token = generateToken();
    const expiresAt = new Date(Date.now() + expiresInHours * 3600 * 1000).toISOString();
    await this.run('INSERT INTO sessions VALUES (?, ?, ?, ?)', token, userId, expiresAt, now());
    return { token, expiresAt };
  }

  async getSessionUser(token) {
    if (!token) return null;
    const session = await this.get('SELECT * FROM sessions WHERE token = ?', token);
    if (!session) return null;
    if (new Date(session.expires_at) < new Date()) {
      await this.run('DELETE FROM sessions WHERE token = ?', token);
      return null;
    }
    return await this.getUserById(session.user_id);
  }

  async deleteSession(token) {
    await this.run('DELETE FROM sessions WHERE token = ?', token);
  }

  // Workspaces
  async createWorkspace(name, ownerId) {
    const wsId = id('ws');
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || `ws-${Date.now()}`;
    const createdAt = now();
    await this.run('INSERT INTO workspaces VALUES (?, ?, ?, ?, ?)', wsId, name, slug, ownerId, createdAt);
    await this.run('INSERT INTO workspace_members VALUES (?, ?, ?, ?, ?)', id('member'), wsId, ownerId, 'owner', createdAt);
    await this.audit('workspace.created', null, `Created workspace ${name}`, ownerId);
    return { id: wsId, name, slug, owner_id: ownerId, created_at: createdAt };
  }

  async getUserWorkspaces(userId) {
    return await this.all(`
      SELECT w.*, wm.role 
      FROM workspaces w
      JOIN workspace_members wm ON w.id = wm.workspace_id
      WHERE wm.user_id = ?
      ORDER BY w.created_at DESC
    `, userId);
  }

  async getWorkspaceRole(workspaceId, userId) {
    const member = await this.get('SELECT role FROM workspace_members WHERE workspace_id = ? AND user_id = ?', workspaceId, userId);
    return member ? member.role : null;
  }

  // Projects
  async createProject(name, description = '', workspaceId = null, actorId = null) {
    const project = { id: id('project'), workspace_id: workspaceId, name, description, created_at: now() };
    await this.run(
      'INSERT INTO projects VALUES (?, ?, ?, ?, ?)',
      project.id,
      project.workspace_id,
      project.name,
      project.description,
      project.created_at
    );
    await this.audit('project.created', project.id, `Created project ${name}`, actorId);
    return project;
  }

  async listProjects(workspaceId = null) {
    if (workspaceId) {
      return await this.all(`
        SELECT p.*, 
          (SELECT id FROM revisions r WHERE r.project_id=p.id ORDER BY created_at DESC LIMIT 1) AS latest_revision_id,
          (SELECT status FROM revisions r WHERE r.project_id=p.id ORDER BY created_at DESC LIMIT 1) AS latest_status
        FROM projects p 
        WHERE p.workspace_id = ?
        ORDER BY created_at DESC
      `, workspaceId);
    }
    return await this.all(`
      SELECT p.*, 
        (SELECT id FROM revisions r WHERE r.project_id=p.id ORDER BY created_at DESC LIMIT 1) AS latest_revision_id,
        (SELECT status FROM revisions r WHERE r.project_id=p.id ORDER BY created_at DESC LIMIT 1) AS latest_status
      FROM projects p 
      ORDER BY created_at DESC
    `);
  }

  async project(idValue) {
    return await this.get('SELECT * FROM projects WHERE id = ?', idValue);
  }

  async deleteProject(projectId, actorId = null) {
    const p = await this.project(projectId);
    if (!p) return false;
    await this.audit('project.deleted', null, `Deleted project ${p.name} (${projectId})`, actorId);
    await this.run('DELETE FROM projects WHERE id = ?', projectId);
    return true;
  }

  // Revisions & Jobs
  async latestRevision(projectId) {
    return await this.get('SELECT * FROM revisions WHERE project_id = ? ORDER BY created_at DESC LIMIT 1', projectId);
  }

  async createJob(projectId, stage, detail) {
    const job = { id: id('job'), projectId, stage, detail, createdAt: now() };
    await this.run('INSERT INTO jobs VALUES (?, ?, ?, ?, ?, ?, ?, ?)', job.id, projectId, null, stage, 'running', detail, job.createdAt, null);
    return job;
  }

  async finishJob(jobId, revisionId, status, detail) {
    await this.run('UPDATE jobs SET revision_id=?, status=?, detail=?, completed_at=? WHERE id=?', revisionId || null, status, detail, now(), jobId);
  }

  async saveRevision(projectId, contentHash, records, summary = null) {
    const existing = await this.get('SELECT * FROM revisions WHERE project_id=? AND content_hash=?', projectId, contentHash);
    if (existing) return { revision: existing, duplicate: true };

    const revision = { id: id('revision'), projectId, contentHash, createdAt: now() };

    if (this.dialect === 'postgres') {
      const client = await this.pool.connect();
      try {
        await client.query('BEGIN');
        await client.query(toPostgresSql('INSERT INTO revisions VALUES (?, ?, ?, ?, ?, ?)'), [revision.id, projectId, contentHash, revision.createdAt, 'ready', summary]);
        for (const file of records.files) {
          await client.query(toPostgresSql('INSERT INTO files VALUES (?, ?, ?, ?, ?, ?, ?)'), [id('file'), revision.id, file.path, file.language, file.bytes, file.content, file.excludedReason || null]);
        }
        for (const symbol of records.symbols) {
          await client.query(toPostgresSql('INSERT INTO symbols VALUES (?, ?, ?, ?, ?, ?)'), [id('symbol'), revision.id, symbol.filePath, symbol.name, symbol.kind, symbol.line]);
        }
        for (const edge of records.edges) {
          await client.query(toPostgresSql('INSERT INTO edges VALUES (?, ?, ?, ?, ?, ?, ?, ?)'), [id('edge'), revision.id, edge.sourcePath, edge.targetPath, edge.type, edge.confidence, edge.line || null, edge.provenance]);
        }
        for (const finding of records.findings) {
          await client.query(toPostgresSql('INSERT INTO findings VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'), [id('finding'), revision.id, finding.severity, finding.category, finding.message, finding.filePath || null, finding.line || null, finding.evidence || null, 'open', null]);
        }
        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }
    } else {
      this.sqlite.exec('BEGIN');
      try {
        this.sqlite.prepare('INSERT INTO revisions VALUES (?, ?, ?, ?, ?, ?)').run(revision.id, projectId, contentHash, revision.createdAt, 'ready', summary);
        for (const file of records.files) {
          this.sqlite.prepare('INSERT INTO files VALUES (?, ?, ?, ?, ?, ?, ?)').run(id('file'), revision.id, file.path, file.language, file.bytes, file.content, file.excludedReason || null);
        }
        for (const symbol of records.symbols) {
          this.sqlite.prepare('INSERT INTO symbols VALUES (?, ?, ?, ?, ?, ?)').run(id('symbol'), revision.id, symbol.filePath, symbol.name, symbol.kind, symbol.line);
        }
        for (const edge of records.edges) {
          this.sqlite.prepare('INSERT INTO edges VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(id('edge'), revision.id, edge.sourcePath, edge.targetPath, edge.type, edge.confidence, edge.line || null, edge.provenance);
        }
        for (const finding of records.findings) {
          this.sqlite.prepare('INSERT INTO findings VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(id('finding'), revision.id, finding.severity, finding.category, finding.message, finding.filePath || null, finding.line || null, finding.evidence || null, 'open', null);
        }
        this.sqlite.exec('COMMIT');
      } catch (error) {
        this.sqlite.exec('ROLLBACK');
        throw error;
      }
    }

    await this.audit('revision.imported', projectId, `Imported revision ${revision.id}`);
    return { revision: { ...revision, status: 'ready', summary }, duplicate: false };
  }

  async projectSummary(projectId) {
    const project = await this.project(projectId);
    if (!project) return null;
    const revision = await this.latestRevision(projectId);
    if (!revision) return { project, revision: null, counts: {} };

    const count = async (table) => {
      const row = await this.get(`SELECT COUNT(*) AS count FROM ${table} WHERE revision_id=?`, revision.id);
      return Number(row?.count || 0);
    };

    return {
      project,
      revision,
      counts: {
        files: await count('files'),
        symbols: await count('symbols'),
        edges: await count('edges'),
        findings: await count('findings')
      }
    };
  }

  // Findings suppression
  async suppressFinding(findingId, reason, actorId = null) {
    const finding = await this.get('SELECT * FROM findings WHERE id = ?', findingId);
    if (!finding) return null;
    await this.run("UPDATE findings SET status='suppressed', suppression_reason=? WHERE id=?", reason, findingId);
    await this.audit('finding.suppressed', null, `Suppressed finding ${findingId}: ${reason}`, actorId);
    return { ...finding, status: 'suppressed', suppression_reason: reason };
  }

  // Implementation Plans
  async createPlan(projectId, revisionId, title, requirement, complexity, tasks = []) {
    const planId = id('plan');
    const createdAt = now();

    await this.run('INSERT INTO plans VALUES (?, ?, ?, ?, ?, ?, ?, ?)', planId, projectId, revisionId, title, requirement, complexity, 'draft', createdAt);
    let order = 1;
    for (const task of tasks) {
      await this.run(
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

    return await this.getPlan(planId);
  }

  async getPlan(planId) {
    const plan = await this.get('SELECT * FROM plans WHERE id = ?', planId);
    if (!plan) return null;
    const tasks = await this.all('SELECT * FROM plan_tasks WHERE plan_id = ? ORDER BY sequence_order ASC', planId);
    return { ...plan, tasks };
  }

  async listPlans(projectId) {
    const plans = await this.all('SELECT * FROM plans WHERE project_id = ? ORDER BY created_at DESC', projectId);
    const enriched = [];
    for (const p of plans) {
      const countRow = await this.get('SELECT COUNT(*) AS count FROM plan_tasks WHERE plan_id = ?', p.id);
      enriched.push({
        ...p,
        taskCount: Number(countRow?.count || 0)
      });
    }
    return enriched;
  }

  async updateTaskStatus(taskId, status) {
    await this.run('UPDATE plan_tasks SET status = ? WHERE id = ?', status, taskId);
    return await this.get('SELECT * FROM plan_tasks WHERE id = ?', taskId);
  }

  // Patches
  async createPatch(projectId, revisionId, planId, title, targetFile, diff, originalContent, patchedContent) {
    const patchId = id('patch');
    const createdAt = now();
    await this.run(
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
    return await this.getPatch(patchId);
  }

  async getPatch(patchId) {
    return await this.get('SELECT * FROM patches WHERE id = ?', patchId);
  }

  async listPatches(projectId) {
    return await this.all('SELECT * FROM patches WHERE project_id = ? ORDER BY created_at DESC', projectId);
  }

  async applyPatch(patchId, actorId = null) {
    const patch = await this.getPatch(patchId);
    if (!patch) return null;
    const appliedAt = now();
    await this.run("UPDATE patches SET status = 'applied', applied_at = ? WHERE id = ?", appliedAt, patchId);
    await this.run("UPDATE files SET content = ? WHERE revision_id = ? AND path = ?", patch.patched_content, patch.revision_id, patch.target_file);
    await this.audit('patch.applied', patch.project_id, `Applied patch ${patch.title} to ${patch.target_file}`, actorId);
    return { ...patch, status: 'applied', applied_at: appliedAt };
  }

  async rollbackPatch(patchId, actorId = null) {
    const patch = await this.getPatch(patchId);
    if (!patch || patch.status !== 'applied') return null;
    await this.run("UPDATE patches SET status = 'rolled_back' WHERE id = ?", patchId);
    await this.run("UPDATE files SET content = ? WHERE revision_id = ? AND path = ?", patch.original_content, patch.revision_id, patch.target_file);
    await this.audit('patch.rolled_back', patch.project_id, `Rolled back patch ${patch.title} for ${patch.target_file}`, actorId);
    return { ...patch, status: 'rolled_back' };
  }

  // Deployments
  async createDeployment(projectId, revisionId, provider, environment = 'production') {
    const depId = id('deploy');
    const timestamp = now();
    await this.run(
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
    return await this.get('SELECT * FROM deployments WHERE id = ?', depId);
  }

  async updateDeployment(depId, updates) {
    const dep = await this.get('SELECT * FROM deployments WHERE id = ?', depId);
    if (!dep) return null;
    const updatedAt = now();
    const newLogs = updates.log ? (dep.logs || '') + `[${updatedAt}] ${updates.log}\n` : dep.logs;

    const fields = [];
    const values = [];

    if (updates.status !== undefined) { fields.push('status = ?'); values.push(updates.status); }
    if (updates.publicUrl !== undefined) { fields.push('public_url = ?'); values.push(updates.publicUrl); }
    if (updates.healthCheckUrl !== undefined) { fields.push('health_check_url = ?'); values.push(updates.healthCheckUrl); }
    if (updates.healthStatus !== undefined) { fields.push('health_status = ?'); values.push(updates.healthStatus); }
    if (newLogs !== undefined) { fields.push('logs = ?'); values.push(newLogs); }
    if (updates.errorMessage !== undefined) { fields.push('error_message = ?'); values.push(updates.errorMessage); }

    fields.push('updated_at = ?');
    values.push(updatedAt);
    values.push(depId);

    const queryStr = `UPDATE deployments SET ${fields.join(', ')} WHERE id = ?`;
    await this.run(queryStr, ...values);
    return await this.get('SELECT * FROM deployments WHERE id = ?', depId);
  }

  async listDeployments(projectId) {
    return await this.all('SELECT * FROM deployments WHERE project_id = ? ORDER BY created_at DESC LIMIT 50', projectId);
  }

  async getDeployment(depId) {
    return await this.get('SELECT * FROM deployments WHERE id = ?', depId);
  }
}

module.exports = { Store };
