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
    owner_id TEXT REFERENCES users(id) ON DELETE SET NULL,
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

  CREATE TABLE IF NOT EXISTS diagrams (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    revision_id TEXT REFERENCES revisions(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    diagram_type TEXT NOT NULL,
    graph_data TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS tasks (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    description TEXT,
    status TEXT NOT NULL DEFAULT 'todo',
    priority TEXT NOT NULL DEFAULT 'medium',
    due_date TEXT,
    target_file TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS notes (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    content TEXT NOT NULL,
    category TEXT NOT NULL DEFAULT 'general',
    tags TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS api_requests (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    method TEXT NOT NULL DEFAULT 'GET',
    url TEXT NOT NULL,
    headers TEXT,
    body TEXT,
    collection_name TEXT NOT NULL DEFAULT 'Default',
    last_status INTEGER,
    last_response TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS operations (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    revision_id TEXT REFERENCES revisions(id) ON DELETE CASCADE,
    type TEXT NOT NULL,
    name TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'queued',
    stage TEXT NOT NULL DEFAULT 'initialization',
    progress INTEGER NOT NULL DEFAULT 0,
    config TEXT,
    summary TEXT,
    error_message TEXT,
    created_at TEXT NOT NULL,
    completed_at TEXT
  );

  CREATE TABLE IF NOT EXISTS operation_events (
    id TEXT PRIMARY KEY,
    operation_id TEXT NOT NULL REFERENCES operations(id) ON DELETE CASCADE,
    stage TEXT NOT NULL,
    message TEXT NOT NULL,
    severity TEXT NOT NULL DEFAULT 'info',
    created_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_files_revision_path ON files(revision_id, path);
  CREATE INDEX IF NOT EXISTS idx_symbols_revision_name ON symbols(revision_id, name);
  CREATE INDEX IF NOT EXISTS idx_edges_revision ON edges(revision_id);
  CREATE INDEX IF NOT EXISTS idx_findings_revision ON findings(revision_id, severity);
  CREATE INDEX IF NOT EXISTS idx_deployments_project ON deployments(project_id, created_at);
  CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_events(created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_sessions_token ON sessions(token);
  CREATE INDEX IF NOT EXISTS idx_diagrams_project ON diagrams(project_id, created_at);
  CREATE INDEX IF NOT EXISTS idx_tasks_project ON tasks(project_id, status);
  CREATE INDEX IF NOT EXISTS idx_notes_project ON notes(project_id, created_at);
  CREATE INDEX IF NOT EXISTS idx_api_requests_project ON api_requests(project_id);
  CREATE INDEX IF NOT EXISTS idx_operations_project ON operations(project_id, created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_op_events_operation ON operation_events(operation_id, created_at ASC);
  CREATE TABLE IF NOT EXISTS impact_analyses (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    revision_id TEXT NOT NULL REFERENCES revisions(id) ON DELETE CASCADE,
    changed_files TEXT NOT NULL,
    strategy TEXT NOT NULL,
    impact_summary TEXT,
    selected_tests TEXT,
    created_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_impact_analyses_project ON impact_analyses(project_id, created_at DESC);

  CREATE TABLE IF NOT EXISTS schema_migrations (
    version INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    applied_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS rate_limit_buckets (
    bucket_key TEXT PRIMARY KEY,
    window_start INTEGER NOT NULL,
    request_count INTEGER NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_rate_limit_updated ON rate_limit_buckets(updated_at);

  CREATE TABLE IF NOT EXISTS operational_events (
    id TEXT PRIMARY KEY,
    event_type TEXT NOT NULL,
    severity TEXT NOT NULL,
    project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
    request_id TEXT,
    detail TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_operational_events_created ON operational_events(created_at DESC);

  CREATE TABLE IF NOT EXISTS execution_jobs (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    actor_id TEXT REFERENCES users(id) ON DELETE SET NULL,
    job_type TEXT NOT NULL,
    payload TEXT NOT NULL,
    status TEXT NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 0,
    max_attempts INTEGER NOT NULL DEFAULT 3,
    available_at TEXT NOT NULL,
    lease_owner TEXT,
    lease_expires_at TEXT,
    cancel_requested INTEGER NOT NULL DEFAULT 0,
    error_message TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    revision_id TEXT REFERENCES revisions(id) ON DELETE SET NULL,
    idempotency_key TEXT,
    execution_profile TEXT,
    provider TEXT,
    provider_execution_id TEXT,
    progress_stage TEXT,
    result_json TEXT,
    started_at TEXT,
    completed_at TEXT,
    expires_at TEXT,
    queue_message_id TEXT,
    poisoned INTEGER NOT NULL DEFAULT 0
  );

  CREATE INDEX IF NOT EXISTS idx_execution_jobs_claim ON execution_jobs(status, available_at, created_at);

  CREATE TABLE IF NOT EXISTS job_outbox (
    id TEXT PRIMARY KEY,
    job_id TEXT NOT NULL REFERENCES execution_jobs(id) ON DELETE CASCADE,
    topic TEXT NOT NULL,
    payload TEXT NOT NULL,
    idempotency_key TEXT NOT NULL UNIQUE,
    status TEXT NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 0,
    available_at TEXT NOT NULL,
    published_at TEXT,
    queue_message_id TEXT,
    last_error TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_job_outbox_publish ON job_outbox(status, available_at, created_at);

  CREATE TABLE IF NOT EXISTS job_artifacts (
    id TEXT PRIMARY KEY,
    job_id TEXT NOT NULL REFERENCES execution_jobs(id) ON DELETE CASCADE,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    owner_id TEXT REFERENCES users(id) ON DELETE CASCADE,
    kind TEXT NOT NULL,
    object_key TEXT NOT NULL UNIQUE,
    content_type TEXT,
    size_bytes INTEGER NOT NULL,
    sha256 TEXT NOT NULL,
    created_at TEXT NOT NULL,
    expires_at TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_job_artifacts_owner ON job_artifacts(owner_id, created_at DESC);

  CREATE TABLE IF NOT EXISTS upload_intents (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    object_key TEXT NOT NULL UNIQUE,
    expected_size INTEGER NOT NULL,
    expected_sha256 TEXT NOT NULL,
    content_type TEXT NOT NULL,
    status TEXT NOT NULL,
    actual_size INTEGER,
    actual_sha256 TEXT,
    provider_etag TEXT,
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    completed_at TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_upload_intents_owner ON upload_intents(owner_id, created_at DESC);

  CREATE TABLE IF NOT EXISTS resource_usage_events (
    id TEXT PRIMARY KEY,
    owner_id TEXT REFERENCES users(id) ON DELETE SET NULL,
    project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
    job_id TEXT REFERENCES execution_jobs(id) ON DELETE SET NULL,
    metric TEXT NOT NULL,
    value INTEGER NOT NULL,
    unit TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_resource_usage_owner ON resource_usage_events(owner_id, metric, created_at DESC);

`;

class Store {
  constructor(dataDirOrOptions, maybeDatabaseUrl) {
    let dataDir = '.data';
    let databaseUrl = null;
    let sessionSecret = null;
    let databaseConfig = null;

    if (typeof dataDirOrOptions === 'object' && dataDirOrOptions !== null) {
      dataDir = dataDirOrOptions.dataDir || '.data';
      databaseUrl = dataDirOrOptions.databaseUrl || null;
      sessionSecret = dataDirOrOptions.sessionSecret || null;
      databaseConfig = dataDirOrOptions.database || null;
    } else {
      dataDir = dataDirOrOptions || '.data';
      databaseUrl = maybeDatabaseUrl || null;
    }

    this.databaseUrl = databaseUrl;
    this.dataDir = dataDir;
    this.sessionSecret = sessionSecret || crypto.randomBytes(32).toString('hex');
    this.databaseConfig = databaseConfig || {};

    if (this.databaseUrl) {
      this.dialect = 'postgres';
      const { Pool } = require('pg');
      const isLocalhost = this.databaseUrl.includes('localhost') || this.databaseUrl.includes('127.0.0.1');
      const sslMode = this.databaseConfig.sslMode || (isLocalhost ? 'disable' : 'verify-full');
      const ssl = sslMode === 'disable' || (sslMode === 'prefer' && isLocalhost)
        ? false
        : { rejectUnauthorized: sslMode === 'verify-full' };
      this.pool = new Pool({
        connectionString: this.databaseUrl,
        ssl,
        max: this.databaseConfig.poolMax || 10,
        idleTimeoutMillis: 30000,
        connectionTimeoutMillis: this.databaseConfig.connectionTimeoutMs || 5000,
        query_timeout: this.databaseConfig.queryTimeoutMs || 15000,
        statement_timeout: this.databaseConfig.queryTimeoutMs || 15000
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
      const projectColumns = this.sqlite.prepare('PRAGMA table_info(projects)').all();
      if (!projectColumns.some((column) => column.name === 'owner_id')) {
        this.sqlite.exec('ALTER TABLE projects ADD COLUMN owner_id TEXT REFERENCES users(id) ON DELETE SET NULL;');
      }
      const executionColumns = new Set(this.sqlite.prepare('PRAGMA table_info(execution_jobs)').all().map((column) => column.name));
      const additions = [
        ['revision_id', 'TEXT REFERENCES revisions(id) ON DELETE SET NULL'], ['idempotency_key', 'TEXT'],
        ['execution_profile', 'TEXT'], ['provider', 'TEXT'], ['provider_execution_id', 'TEXT'],
        ['progress_stage', 'TEXT'], ['result_json', 'TEXT'], ['started_at', 'TEXT'],
        ['completed_at', 'TEXT'], ['expires_at', 'TEXT'], ['queue_message_id', 'TEXT'],
        ['poisoned', 'INTEGER NOT NULL DEFAULT 0']
      ];
      for (const [column, definition] of additions) {
        if (!executionColumns.has(column)) this.sqlite.exec(`ALTER TABLE execution_jobs ADD COLUMN ${column} ${definition};`);
      }
      this.sqlite.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_execution_jobs_idempotency ON execution_jobs(actor_id, idempotency_key) WHERE idempotency_key IS NOT NULL;');
      this.sqlite.exec('CREATE INDEX IF NOT EXISTS idx_execution_jobs_owner ON execution_jobs(actor_id, created_at DESC);');
      this.sqlite.prepare('INSERT OR IGNORE INTO schema_migrations VALUES (?, ?, ?)').run(1, 'baseline-schema', now());
      this.sqlite.prepare('INSERT OR IGNORE INTO schema_migrations VALUES (?, ?, ?)').run(2, 'project-ownership-and-rate-limits', now());
      this.sqlite.prepare('INSERT OR IGNORE INTO schema_migrations VALUES (?, ?, ?)').run(3, 'operational-monitoring', now());
      this.sqlite.prepare('INSERT OR IGNORE INTO schema_migrations VALUES (?, ?, ?)').run(4, 'durable-execution-queue', now());
      this.sqlite.prepare('INSERT OR IGNORE INTO schema_migrations VALUES (?, ?, ?)').run(5, 'phase3-outbox-artifacts-and-workflows', now());
    }
  }

  initPostgresSchema() {
    this.readyPromise = (async () => {
      const client = await this.pool.connect();
      try {
        await client.query('BEGIN');
        await client.query(SCHEMA_DDL);
        await client.query('ALTER TABLE projects ADD COLUMN IF NOT EXISTS owner_id TEXT REFERENCES users(id) ON DELETE SET NULL');
        await client.query('ALTER TABLE execution_jobs ADD COLUMN IF NOT EXISTS revision_id TEXT REFERENCES revisions(id) ON DELETE SET NULL');
        await client.query('ALTER TABLE execution_jobs ADD COLUMN IF NOT EXISTS idempotency_key TEXT');
        await client.query('ALTER TABLE execution_jobs ADD COLUMN IF NOT EXISTS execution_profile TEXT');
        await client.query('ALTER TABLE execution_jobs ADD COLUMN IF NOT EXISTS provider TEXT');
        await client.query('ALTER TABLE execution_jobs ADD COLUMN IF NOT EXISTS provider_execution_id TEXT');
        await client.query('ALTER TABLE execution_jobs ADD COLUMN IF NOT EXISTS progress_stage TEXT');
        await client.query('ALTER TABLE execution_jobs ADD COLUMN IF NOT EXISTS result_json TEXT');
        await client.query('ALTER TABLE execution_jobs ADD COLUMN IF NOT EXISTS started_at TEXT');
        await client.query('ALTER TABLE execution_jobs ADD COLUMN IF NOT EXISTS completed_at TEXT');
        await client.query('ALTER TABLE execution_jobs ADD COLUMN IF NOT EXISTS expires_at TEXT');
        await client.query('ALTER TABLE execution_jobs ADD COLUMN IF NOT EXISTS queue_message_id TEXT');
        await client.query('ALTER TABLE execution_jobs ADD COLUMN IF NOT EXISTS poisoned INTEGER NOT NULL DEFAULT 0');
        await client.query('CREATE UNIQUE INDEX IF NOT EXISTS idx_execution_jobs_idempotency ON execution_jobs(actor_id, idempotency_key) WHERE idempotency_key IS NOT NULL');
        await client.query('CREATE INDEX IF NOT EXISTS idx_execution_jobs_owner ON execution_jobs(actor_id, created_at DESC)');
        await client.query("INSERT INTO schema_migrations VALUES (1, 'baseline-schema', $1) ON CONFLICT (version) DO NOTHING", [now()]);
        await client.query("INSERT INTO schema_migrations VALUES (2, 'project-ownership-and-rate-limits', $1) ON CONFLICT (version) DO NOTHING", [now()]);
        await client.query("INSERT INTO schema_migrations VALUES (3, 'operational-monitoring', $1) ON CONFLICT (version) DO NOTHING", [now()]);
        await client.query("INSERT INTO schema_migrations VALUES (4, 'durable-execution-queue', $1) ON CONFLICT (version) DO NOTHING", [now()]);
        await client.query("INSERT INTO schema_migrations VALUES (5, 'phase3-outbox-artifacts-and-workflows', $1) ON CONFLICT (version) DO NOTHING", [now()]);
        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        throw new Error(`PostgreSQL initialization failed: ${err.message}`);
      } finally {
        client.release();
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

  async ping() {
    const startedAt = Date.now();
    await this.get('SELECT 1 AS healthy');
    return { status: 'available', dialect: this.dialect, latencyMs: Date.now() - startedAt };
  }

  async consumeRateLimit(bucketKey, limit, windowMs, timestamp = Date.now()) {
    const expiredBefore = timestamp - windowMs;
    const row = await this.get(`
      INSERT INTO rate_limit_buckets (bucket_key, window_start, request_count, updated_at)
      VALUES (?, ?, 1, ?)
      ON CONFLICT(bucket_key) DO UPDATE SET
        window_start = CASE WHEN rate_limit_buckets.window_start <= ? THEN ? ELSE rate_limit_buckets.window_start END,
        request_count = CASE WHEN rate_limit_buckets.window_start <= ? THEN 1 ELSE rate_limit_buckets.request_count + 1 END,
        updated_at = ?
      RETURNING window_start, request_count
    `, bucketKey, timestamp, now(), expiredBefore, timestamp, expiredBefore, now());
    const retryAfterSeconds = Math.max(1, Math.ceil((Number(row.window_start) + windowMs - timestamp) / 1000));
    return { allowed: Number(row.request_count) <= limit, remaining: Math.max(0, limit - Number(row.request_count)), retryAfterSeconds };
  }

  async resetRateLimit(bucketKey) {
    await this.run('DELETE FROM rate_limit_buckets WHERE bucket_key=?', bucketKey);
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

  async recordOperationalEvent(eventType, severity, projectId, requestId, detail) {
    const safeDetail = String(detail || '').replace(/(password|secret|token|authorization)=?[^;\s]*/gi, '$1=[REDACTED]').slice(0, 1000);
    await this.run('INSERT INTO operational_events VALUES (?, ?, ?, ?, ?, ?, ?)', id('event'), eventType, severity, projectId || null, requestId || null, safeDetail, now());
  }

  async enqueueExecutionJob(projectId, actorId, jobType, payload = {}, maxAttempts = 3) {
    const jobId = id('execjob');
    const timestamp = now();
    await this.run(
      `INSERT INTO execution_jobs
       (id, project_id, actor_id, job_type, payload, status, attempts, max_attempts, available_at,
        lease_owner, lease_expires_at, cancel_requested, error_message, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      jobId, projectId, actorId || null, jobType, JSON.stringify(payload), 'PENDING', 0,
      maxAttempts, timestamp, null, null, 0, null, timestamp, timestamp
    );
    await this.audit('execution.queued', projectId, `Queued ${jobType} job ${jobId}`, actorId);
    return this.get('SELECT * FROM execution_jobs WHERE id=?', jobId);
  }

  async requestExecutionCancellation(jobId, actorId) {
    const job = await this.get('SELECT * FROM execution_jobs WHERE id=?', jobId);
    if (!job || (actorId && job.actor_id && job.actor_id !== actorId)) return null;
    await this.run("UPDATE execution_jobs SET cancel_requested=1, status=CASE WHEN status='PENDING' THEN 'CANCELLED' ELSE status END, updated_at=? WHERE id=?", now(), jobId);
    return this.get('SELECT * FROM execution_jobs WHERE id=?', jobId);
  }

  async recordExecutionFailure(jobId, message, baseDelayMs = 1000) {
    const job = await this.get('SELECT * FROM execution_jobs WHERE id=?', jobId);
    if (!job) return null;
    const attempts = Number(job.attempts) + 1;
    const retry = attempts < Number(job.max_attempts) && !Number(job.cancel_requested);
    const availableAt = new Date(Date.now() + Math.min(60_000, baseDelayMs * (2 ** (attempts - 1)))).toISOString();
    await this.run('UPDATE execution_jobs SET attempts=?, status=?, available_at=?, error_message=?, lease_owner=NULL, lease_expires_at=NULL, updated_at=? WHERE id=?', attempts, retry ? 'PENDING' : 'FAILED', availableAt, String(message).slice(0, 1000), now(), jobId);
    await this.recordOperationalEvent('worker.execution_failed', 'error', job.project_id, null, `job=${jobId}; attempt=${attempts}`);
    return this.get('SELECT * FROM execution_jobs WHERE id=?', jobId);
  }

  async createWorkflowJob({ projectId, actorId, revisionId = null, jobType, executionProfile = null, payload = {}, idempotencyKey, maxAttempts = 3, lifetimeMs = 15 * 60 * 1000, topic = 'codepilot-jobs' }) {
    if (!projectId || !actorId || !jobType || !idempotencyKey) throw new Error('projectId, actorId, jobType and idempotencyKey are required.');
    if (!/^[A-Za-z0-9._:-]{8,200}$/.test(idempotencyKey)) throw new Error('Invalid idempotency key.');
    const existing = await this.get('SELECT * FROM execution_jobs WHERE actor_id=? AND idempotency_key=?', actorId, idempotencyKey);
    if (existing) return { job: existing, created: false, outbox: await this.get('SELECT * FROM job_outbox WHERE job_id=?', existing.id) };
    const timestamp = now();
    const jobId = id('execjob');
    const outboxId = id('outbox');
    const expiresAt = new Date(Date.now() + lifetimeMs).toISOString();
    const safePayload = JSON.stringify(payload);
    if (Buffer.byteLength(safePayload) > 16 * 1024) throw new Error('Job payload exceeds 16 KiB. Store source and artifacts outside the queue.');
    const queuePayload = JSON.stringify({ version: 1, jobId, outboxId });
    const insertJob = `INSERT INTO execution_jobs
      (id, project_id, actor_id, job_type, payload, status, attempts, max_attempts, available_at,
       lease_owner, lease_expires_at, cancel_requested, error_message, created_at, updated_at,
       revision_id, idempotency_key, execution_profile, progress_stage, expires_at, poisoned)
      VALUES (?, ?, ?, ?, ?, 'QUEUED', 0, ?, ?, NULL, NULL, 0, NULL, ?, ?, ?, ?, ?, 'queued', ?, 0)`;
    const insertOutbox = `INSERT INTO job_outbox
      (id, job_id, topic, payload, idempotency_key, status, attempts, available_at, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, 'PENDING', 0, ?, ?, ?)`;
    if (this.dialect === 'postgres') {
      await this.ensureReady();
      const client = await this.pool.connect();
      try {
        await client.query('BEGIN');
        await client.query(toPostgresSql(insertJob), [jobId, projectId, actorId, jobType, safePayload, maxAttempts, timestamp, timestamp, timestamp, revisionId, idempotencyKey, executionProfile, expiresAt]);
        await client.query(toPostgresSql(insertOutbox), [outboxId, jobId, topic, queuePayload, `publish:${jobId}`, timestamp, timestamp, timestamp]);
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        if (error.code === '23505') {
          const raced = await this.get('SELECT * FROM execution_jobs WHERE actor_id=? AND idempotency_key=?', actorId, idempotencyKey);
          if (raced) return { job: raced, created: false, outbox: await this.get('SELECT * FROM job_outbox WHERE job_id=?', raced.id) };
        }
        throw error;
      } finally {
        client.release();
      }
    } else {
      this.sqlite.exec('BEGIN IMMEDIATE');
      try {
        this.sqlite.prepare(insertJob).run(jobId, projectId, actorId, jobType, safePayload, maxAttempts, timestamp, timestamp, timestamp, revisionId, idempotencyKey, executionProfile, expiresAt);
        this.sqlite.prepare(insertOutbox).run(outboxId, jobId, topic, queuePayload, `publish:${jobId}`, timestamp, timestamp, timestamp);
        this.sqlite.exec('COMMIT');
      } catch (error) {
        this.sqlite.exec('ROLLBACK');
        const raced = await this.get('SELECT * FROM execution_jobs WHERE actor_id=? AND idempotency_key=?', actorId, idempotencyKey);
        if (raced) return { job: raced, created: false, outbox: await this.get('SELECT * FROM job_outbox WHERE job_id=?', raced.id) };
        throw error;
      }
    }
    await this.audit('job.created', projectId, `Created durable ${jobType} job ${jobId}`, actorId);
    return { job: await this.get('SELECT * FROM execution_jobs WHERE id=?', jobId), created: true, outbox: await this.get('SELECT * FROM job_outbox WHERE id=?', outboxId) };
  }

  async getExecutionJobForUser(jobId, user) {
    const job = await this.get('SELECT * FROM execution_jobs WHERE id=?', jobId);
    if (!job || !user || (!user.is_global_admin && job.actor_id !== user.id)) return null;
    return job;
  }

  async listExecutionJobsForUser(user, limit = 50) {
    if (!user) return [];
    return user.is_global_admin
      ? this.all('SELECT * FROM execution_jobs ORDER BY created_at DESC LIMIT ?', limit)
      : this.all('SELECT * FROM execution_jobs WHERE actor_id=? ORDER BY created_at DESC LIMIT ?', user.id, limit);
  }

  async claimExecutionJob(jobId, workerId, leaseMs = 60_000) {
    const timestamp = now();
    const leaseExpires = new Date(Date.now() + leaseMs).toISOString();
    const claimed = await this.get(`UPDATE execution_jobs SET status='RUNNING', attempts=attempts+1, lease_owner=?, lease_expires_at=?,
      started_at=COALESCE(started_at, ?), progress_stage='running', updated_at=?
      WHERE id=? AND status IN ('QUEUED','DISPATCHED') AND cancel_requested=0 AND attempts < max_attempts AND available_at <= ? AND expires_at > ?
      RETURNING *`, workerId, leaseExpires, timestamp, timestamp, jobId, timestamp, timestamp);
    if (claimed) await this.recordResourceUsage(claimed.actor_id, claimed.project_id, claimed.id, 'queue_delay_ms', Math.max(0, Date.now() - Date.parse(claimed.created_at)), 'ms');
    return claimed;
  }

  async markJobDispatched(jobId, queueMessageId) {
    await this.run("UPDATE execution_jobs SET status=CASE WHEN status='QUEUED' THEN 'DISPATCHED' ELSE status END, queue_message_id=?, progress_stage='dispatched', updated_at=? WHERE id=?", queueMessageId || null, now(), jobId);
    return this.get('SELECT * FROM execution_jobs WHERE id=?', jobId);
  }

  async completeExecutionJob(jobId, workerId, result, provider, providerExecutionId) {
    const timestamp = now();
    const updated = await this.get(`UPDATE execution_jobs SET status='SUCCEEDED', result_json=?, provider=?, provider_execution_id=?,
      progress_stage='completed', completed_at=?, lease_owner=NULL, lease_expires_at=NULL, updated_at=?
      WHERE id=? AND status='RUNNING' AND lease_owner=? AND cancel_requested=0 RETURNING *`, JSON.stringify(result), provider, providerExecutionId, timestamp, timestamp, jobId, workerId);
    if (updated) await this.audit('job.succeeded', updated.project_id, `Job ${jobId} completed with provider ${provider}`, updated.actor_id);
    return updated;
  }

  async failWorkflowJob(jobId, workerId, errorMessage, { timedOut = false, retryDelayMs = 1000 } = {}) {
    const job = await this.get('SELECT * FROM execution_jobs WHERE id=?', jobId);
    if (!job || job.lease_owner !== workerId || job.status !== 'RUNNING') return null;
    const exhausted = Number(job.attempts) >= Number(job.max_attempts);
    const cancelled = Number(job.cancel_requested) === 1;
    const terminal = timedOut ? 'TIMED_OUT' : cancelled ? 'CANCELLED' : exhausted ? 'FAILED' : 'QUEUED';
    const availableAt = new Date(Date.now() + Math.min(60_000, retryDelayMs * (2 ** Math.max(0, Number(job.attempts) - 1)))).toISOString();
    const completedAt = ['TIMED_OUT', 'CANCELLED', 'FAILED'].includes(terminal) ? now() : null;
    await this.run(`UPDATE execution_jobs SET status=?, available_at=?, error_message=?, poisoned=?, completed_at=?,
      lease_owner=NULL, lease_expires_at=NULL, progress_stage=?, updated_at=? WHERE id=?`, terminal, availableAt, String(errorMessage).slice(0, 1000), exhausted ? 1 : 0, completedAt, terminal.toLowerCase(), now(), jobId);
    if (exhausted) await this.recordOperationalEvent('queue.poisoned_job', 'error', job.project_id, null, `job=${jobId}; attempts=${job.attempts}`);
    return this.get('SELECT * FROM execution_jobs WHERE id=?', jobId);
  }

  async blockWorkflowJob(jobId, reason, eventType = 'queue.job_rejected') {
    const job = await this.get('SELECT * FROM execution_jobs WHERE id=?', jobId);
    if (!job || ['SUCCEEDED', 'FAILED', 'CANCELLED', 'TIMED_OUT', 'EXPIRED', 'BLOCKED'].includes(job.status)) return job;
    const detail = String(reason || 'Queue delivery was rejected.').slice(0, 1000);
    const timestamp = now();
    const updated = await this.get(`UPDATE execution_jobs SET status='BLOCKED', poisoned=1, error_message=?, completed_at=?,
      lease_owner=NULL, lease_expires_at=NULL, progress_stage='blocked', updated_at=? WHERE id=?
      AND status NOT IN ('SUCCEEDED','FAILED','CANCELLED','TIMED_OUT','EXPIRED','BLOCKED') RETURNING *`, detail, timestamp, timestamp, jobId);
    if (updated) {
      await this.recordOperationalEvent(eventType, 'error', updated.project_id, null, `job=${jobId}; ${detail}`);
      await this.audit('job.blocked', updated.project_id, `Blocked job ${jobId}: ${detail}`, updated.actor_id);
    }
    return updated || this.get('SELECT * FROM execution_jobs WHERE id=?', jobId);
  }

  async cancelWorkflowJob(jobId, actorId) {
    const job = await this.get('SELECT * FROM execution_jobs WHERE id=? AND actor_id=?', jobId, actorId);
    if (!job || ['SUCCEEDED', 'FAILED', 'CANCELLED', 'TIMED_OUT', 'EXPIRED'].includes(job.status)) return null;
    const status = ['QUEUED', 'DISPATCHED'].includes(job.status) ? 'CANCELLED' : 'CANCEL_REQUESTED';
    await this.run('UPDATE execution_jobs SET cancel_requested=1, status=?, completed_at=?, progress_stage=?, updated_at=? WHERE id=?', status, status === 'CANCELLED' ? now() : null, status.toLowerCase(), now(), jobId);
    await this.audit('job.cancellation_requested', job.project_id, `Cancellation requested for job ${jobId}`, actorId);
    return this.get('SELECT * FROM execution_jobs WHERE id=?', jobId);
  }

  async retryWorkflowJob(jobId, actorId) {
    const job = await this.get('SELECT * FROM execution_jobs WHERE id=? AND actor_id=?', jobId, actorId);
    if (!job || !['FAILED', 'TIMED_OUT', 'BLOCKED'].includes(job.status) || Number(job.attempts) >= Number(job.max_attempts)) return null;
    await this.run("UPDATE execution_jobs SET status='QUEUED', cancel_requested=0, poisoned=0, error_message=NULL, available_at=?, completed_at=NULL, progress_stage='queued', updated_at=? WHERE id=?", now(), now(), jobId);
    await this.run("UPDATE job_outbox SET status='PENDING', available_at=?, last_error=NULL, updated_at=? WHERE job_id=?", now(), now(), jobId);
    return this.get('SELECT * FROM execution_jobs WHERE id=?', jobId);
  }

  async recoverExpiredExecutionJobs(timestamp = now()) {
    await this.run("UPDATE execution_jobs SET status='EXPIRED', completed_at=?, progress_stage='expired', lease_owner=NULL, lease_expires_at=NULL, updated_at=? WHERE status NOT IN ('SUCCEEDED','FAILED','CANCELLED','TIMED_OUT','EXPIRED') AND expires_at <= ?", timestamp, timestamp, timestamp);
    await this.run("UPDATE execution_jobs SET status='QUEUED', progress_stage='recovered', lease_owner=NULL, lease_expires_at=NULL, available_at=?, updated_at=? WHERE status='RUNNING' AND lease_expires_at < ? AND cancel_requested=0 AND attempts < max_attempts", timestamp, timestamp, timestamp);
  }

  async pendingOutbox(limit = 10) {
    return this.all("SELECT * FROM job_outbox WHERE status='PENDING' AND available_at <= ? ORDER BY created_at LIMIT ?", now(), limit);
  }

  async markOutboxPublished(outboxId, queueMessageId) {
    const timestamp = now();
    await this.run("UPDATE job_outbox SET status='PUBLISHED', attempts=attempts+1, published_at=?, queue_message_id=?, updated_at=? WHERE id=? AND status='PENDING'", timestamp, queueMessageId || null, timestamp, outboxId);
    const outbox = await this.get('SELECT * FROM job_outbox WHERE id=?', outboxId);
    if (outbox) await this.markJobDispatched(outbox.job_id, queueMessageId);
    return outbox;
  }

  async markOutboxFailure(outboxId, errorMessage) {
    const row = await this.get('SELECT * FROM job_outbox WHERE id=?', outboxId);
    if (!row) return null;
    const attempts = Number(row.attempts) + 1;
    const terminal = attempts >= 5;
    const availableAt = new Date(Date.now() + Math.min(60_000, 1000 * (2 ** (attempts - 1)))).toISOString();
    await this.run('UPDATE job_outbox SET status=?, attempts=?, available_at=?, last_error=?, updated_at=? WHERE id=?', terminal ? 'FAILED' : 'PENDING', attempts, availableAt, String(errorMessage).slice(0, 1000), now(), outboxId);
    await this.recordOperationalEvent('queue.publication_failed', terminal ? 'error' : 'warning', null, null, `outbox=${outboxId}; attempt=${attempts}`);
    if (terminal) await this.run("UPDATE execution_jobs SET status='BLOCKED', poisoned=1, error_message='Queue publication exhausted retries', completed_at=?, updated_at=? WHERE id=?", now(), now(), row.job_id);
    return this.get('SELECT * FROM job_outbox WHERE id=?', outboxId);
  }

  async createUploadIntent({ projectId, ownerId, objectKey, expectedSize, expectedSha256, contentType, ttlMs = 15 * 60 * 1000 }) {
    const intentId = id('upload');
    const timestamp = now();
    await this.run('INSERT INTO upload_intents VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', intentId, projectId, ownerId, objectKey, expectedSize, expectedSha256, contentType, 'AUTHORIZED', null, null, null, timestamp, new Date(Date.now() + ttlMs).toISOString(), null);
    await this.audit('upload.authorized', projectId, `Authorized private upload ${intentId}`, ownerId);
    return this.get('SELECT * FROM upload_intents WHERE id=?', intentId);
  }

  async getUploadIntentForUser(intentId, user) {
    if (!user) return null;
    return user.is_global_admin
      ? this.get('SELECT * FROM upload_intents WHERE id=?', intentId)
      : this.get('SELECT * FROM upload_intents WHERE id=? AND owner_id=?', intentId, user.id);
  }

  async completeUploadIntent(intentId, ownerId, { size, sha256, etag }) {
    const intent = await this.get("SELECT * FROM upload_intents WHERE id=? AND owner_id=? AND status='AUTHORIZED'", intentId, ownerId);
    if (!intent || Date.parse(intent.expires_at) <= Date.now()) return null;
    const valid = Number(size) === Number(intent.expected_size) && sha256 === intent.expected_sha256;
    await this.run('UPDATE upload_intents SET status=?, actual_size=?, actual_sha256=?, provider_etag=?, completed_at=? WHERE id=?', valid ? 'VERIFIED' : 'REJECTED', size, sha256, etag || null, now(), intentId);
    await this.audit(valid ? 'upload.verified' : 'upload.rejected', intent.project_id, `Upload ${intentId} ${valid ? 'verified' : 'failed size/hash verification'}`, ownerId);
    return this.get('SELECT * FROM upload_intents WHERE id=?', intentId);
  }

  async expiredUploadIntents(timestamp = now(), limit = 100) {
    return this.all("SELECT * FROM upload_intents WHERE status='AUTHORIZED' AND expires_at <= ? ORDER BY expires_at LIMIT ?", timestamp, Math.min(Math.max(Number(limit) || 1, 1), 500));
  }

  async markUploadIntentAbandoned(intentId, detail = 'Expired upload authorization.') {
    const intent = await this.get("UPDATE upload_intents SET status='ABANDONED', completed_at=? WHERE id=? AND status='AUTHORIZED' RETURNING *", now(), intentId);
    if (intent) await this.audit('upload.abandoned', intent.project_id, `${detail} ${intentId}`, intent.owner_id);
    return intent;
  }

  async createJobArtifact({ jobId, projectId, ownerId, kind, objectKey, contentType, sizeBytes, sha256, expiresAt = null }) {
    const artifactId = id('artifact');
    await this.run('INSERT INTO job_artifacts VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', artifactId, jobId, projectId, ownerId, kind, objectKey, contentType || null, sizeBytes, sha256, now(), expiresAt);
    return this.get('SELECT * FROM job_artifacts WHERE id=?', artifactId);
  }

  async getArtifactForUser(artifactId, user) {
    if (!user) return null;
    return user.is_global_admin
      ? this.get('SELECT * FROM job_artifacts WHERE id=?', artifactId)
      : this.get('SELECT * FROM job_artifacts WHERE id=? AND owner_id=?', artifactId, user.id);
  }

  async expiredJobArtifacts(timestamp = now(), limit = 100) {
    return this.all('SELECT * FROM job_artifacts WHERE expires_at IS NOT NULL AND expires_at <= ? ORDER BY expires_at LIMIT ?', timestamp, Math.min(Math.max(Number(limit) || 1, 1), 500));
  }

  async deleteJobArtifactRecord(artifactId) {
    return this.get('DELETE FROM job_artifacts WHERE id=? RETURNING *', artifactId);
  }

  async recordResourceUsage(ownerId, projectId, jobId, metric, value, unit) {
    await this.run('INSERT INTO resource_usage_events VALUES (?, ?, ?, ?, ?, ?, ?, ?)', id('usage'), ownerId || null, projectId || null, jobId || null, metric, value, unit, now());
  }

  async operationalMetrics() {
    const jobs = await this.all('SELECT status, COUNT(*) AS count FROM execution_jobs GROUP BY status ORDER BY status');
    const outbox = await this.all('SELECT status, COUNT(*) AS count FROM job_outbox GROUP BY status ORDER BY status');
    const oldest = await this.get("SELECT MIN(created_at) AS oldest FROM job_outbox WHERE status='PENDING'");
    const failures = await this.get("SELECT COUNT(*) AS count FROM operational_events WHERE severity='error' AND created_at>=?", new Date(Date.now() - 60 * 60 * 1000).toISOString());
    return {
      jobs,
      outbox,
      oldestPendingOutboxAgeMs: oldest?.oldest ? Math.max(0, Date.now() - Date.parse(oldest.oldest)) : 0,
      operationalErrorsLastHour: Number(failures?.count || 0),
      database: this.dialect === 'postgres'
        ? { dialect: 'postgres', total: this.pool.totalCount, idle: this.pool.idleCount, waiting: this.pool.waitingCount }
        : { dialect: 'sqlite' }
    };
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
    const tokenHash = crypto.createHmac('sha256', this.sessionSecret).update(token).digest('hex');
    const expiresAt = new Date(Date.now() + expiresInHours * 3600 * 1000).toISOString();
    await this.run('INSERT INTO sessions VALUES (?, ?, ?, ?)', tokenHash, userId, expiresAt, now());
    return { token, expiresAt };
  }

  async getSessionUser(token) {
    if (!token) return null;
    const tokenHash = crypto.createHmac('sha256', this.sessionSecret).update(token).digest('hex');
    const session = await this.get('SELECT * FROM sessions WHERE token = ?', tokenHash);
    if (!session) return null;
    if (new Date(session.expires_at) < new Date()) {
      await this.run('DELETE FROM sessions WHERE token = ?', tokenHash);
      return null;
    }
    return await this.getUserById(session.user_id);
  }

  async deleteSession(token) {
    const tokenHash = crypto.createHmac('sha256', this.sessionSecret).update(token).digest('hex');
    await this.run('DELETE FROM sessions WHERE token = ?', tokenHash);
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
    const project = { id: id('project'), workspace_id: workspaceId, owner_id: actorId, name, description, created_at: now() };
    await this.run(
      'INSERT INTO projects (id, workspace_id, owner_id, name, description, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      project.id,
      project.workspace_id,
      project.owner_id,
      project.name,
      project.description,
      project.created_at
    );
    await this.audit('project.created', project.id, `Created project ${name}`, actorId);
    return project;
  }

  async listProjects(workspaceId = null, userId = null) {
    if (userId) {
      const workspaceClause = workspaceId ? 'AND p.workspace_id = ?' : '';
      const params = workspaceId ? [userId, userId, workspaceId] : [userId, userId];
      return await this.all(`
        SELECT DISTINCT p.*,
          (SELECT id FROM revisions r WHERE r.project_id=p.id ORDER BY created_at DESC LIMIT 1) AS latest_revision_id,
          (SELECT status FROM revisions r WHERE r.project_id=p.id ORDER BY created_at DESC LIMIT 1) AS latest_status
        FROM projects p
        LEFT JOIN workspace_members wm ON p.workspace_id = wm.workspace_id AND wm.user_id = ?
        WHERE (p.owner_id = ? OR wm.user_id IS NOT NULL) ${workspaceClause}
        ORDER BY p.created_at DESC
      `, ...params);
    }
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

  async updateProject(projectId, updates = {}, actorId = null) {
    const project = await this.project(projectId);
    if (!project) return null;
    const name = updates.name === undefined ? project.name : String(updates.name).trim();
    const description = updates.description === undefined ? project.description : String(updates.description).trim();
    if (!name || name.length > 100) return null;
    await this.run('UPDATE projects SET name=?, description=? WHERE id=?', name, description, projectId);
    await this.audit('project.updated', projectId, `Updated project ${projectId}`, actorId);
    return this.project(projectId);
  }

  async getProjectAccess(projectId, user) {
    if (!user) return null;
    const project = await this.project(projectId);
    if (!project) return null;
    if (user.is_global_admin) return { project, role: 'admin' };
    if (project.owner_id === user.id) return { project, role: 'owner' };
    if (project.workspace_id) {
      const role = await this.getWorkspaceRole(project.workspace_id, user.id);
      if (role) return { project, role };
    }
    return null;
  }

  async resourceBelongsToProject(resourceType, resourceId, projectId) {
    const definitions = {
      diagram: ['diagrams', 'id', 'project_id'], task: ['tasks', 'id', 'project_id'],
      note: ['notes', 'id', 'project_id'], conversation: ['conversations', 'id', 'project_id'],
      apiRequest: ['api_requests', 'id', 'project_id'], operation: ['operations', 'id', 'project_id'],
      patch: ['patches', 'id', 'project_id']
    };
    if (resourceType === 'finding') {
      return Boolean(await this.get('SELECT f.id FROM findings f JOIN revisions r ON f.revision_id=r.id WHERE f.id=? AND r.project_id=?', resourceId, projectId));
    }
    if (resourceType === 'task') {
      return Boolean(await this.get(`
        SELECT id FROM tasks WHERE id=? AND project_id=?
        UNION ALL
        SELECT pt.id FROM plan_tasks pt JOIN plans p ON pt.plan_id=p.id WHERE pt.id=? AND p.project_id=?
        LIMIT 1
      `, resourceId, projectId, resourceId, projectId));
    }
    const def = definitions[resourceType];
    if (!def) return true;
    return Boolean(await this.get(`SELECT ${def[1]} FROM ${def[0]} WHERE ${def[1]}=? AND ${def[2]}=?`, resourceId, projectId));
  }

  async listAuditEventsForUser(user) {
    if (user?.is_global_admin) return this.all('SELECT * FROM audit_events ORDER BY created_at DESC LIMIT 100');
    return this.all(`
      SELECT DISTINCT a.* FROM audit_events a
      LEFT JOIN projects p ON a.project_id=p.id
      LEFT JOIN workspace_members wm ON p.workspace_id=wm.workspace_id AND wm.user_id=?
      WHERE a.actor_id=? OR p.owner_id=? OR wm.user_id IS NOT NULL
      ORDER BY a.created_at DESC LIMIT 100
    `, user.id, user.id, user.id);
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
    if (!patch || patch.status !== 'draft') return null;
    const current = await this.get('SELECT content FROM files WHERE revision_id=? AND path=?', patch.revision_id, patch.target_file);
    if (!current) return { error: 'TARGET_NOT_FOUND', patch };
    if ((current.content || '') !== (patch.original_content || '')) return { error: 'REVISION_CONFLICT', patch };
    const appliedAt = now();
    if (this.dialect === 'postgres') {
      const client = await this.pool.connect();
      try {
        await client.query('BEGIN');
        const fileUpdate = await client.query(
          'UPDATE files SET content=$1 WHERE revision_id=$2 AND path=$3 AND COALESCE(content, \'\')=$4',
          [patch.patched_content, patch.revision_id, patch.target_file, patch.original_content || '']
        );
        if (fileUpdate.rowCount !== 1) throw new Error('REVISION_CONFLICT');
        const patchUpdate = await client.query("UPDATE patches SET status='applied', applied_at=$1 WHERE id=$2 AND status='draft'", [appliedAt, patchId]);
        if (patchUpdate.rowCount !== 1) throw new Error('PATCH_STATE_CONFLICT');
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        if (['REVISION_CONFLICT', 'PATCH_STATE_CONFLICT'].includes(error.message)) return { error: error.message, patch };
        throw error;
      } finally { client.release(); }
    } else {
      this.sqlite.exec('BEGIN IMMEDIATE');
      try {
        const fileUpdate = this.sqlite.prepare("UPDATE files SET content=? WHERE revision_id=? AND path=? AND COALESCE(content, '')=?")
          .run(patch.patched_content, patch.revision_id, patch.target_file, patch.original_content || '');
        if (fileUpdate.changes !== 1) throw new Error('REVISION_CONFLICT');
        const patchUpdate = this.sqlite.prepare("UPDATE patches SET status='applied', applied_at=? WHERE id=? AND status='draft'").run(appliedAt, patchId);
        if (patchUpdate.changes !== 1) throw new Error('PATCH_STATE_CONFLICT');
        this.sqlite.exec('COMMIT');
      } catch (error) {
        this.sqlite.exec('ROLLBACK');
        if (['REVISION_CONFLICT', 'PATCH_STATE_CONFLICT'].includes(error.message)) return { error: error.message, patch };
        throw error;
      }
    }
    await this.audit('patch.applied', patch.project_id, `Applied patch ${patch.title} to ${patch.target_file}`, actorId);
    return { ...patch, status: 'applied', applied_at: appliedAt };
  }

  async rollbackPatch(patchId, actorId = null) {
    const patch = await this.getPatch(patchId);
    if (!patch || patch.status !== 'applied') return null;
    const current = await this.get('SELECT content FROM files WHERE revision_id=? AND path=?', patch.revision_id, patch.target_file);
    if (!current) return { error: 'TARGET_NOT_FOUND', patch };
    if ((current.content || '') !== (patch.patched_content || '')) return { error: 'REVISION_CONFLICT', patch };
    if (this.dialect === 'postgres') {
      const client = await this.pool.connect();
      try {
        await client.query('BEGIN');
        const fileUpdate = await client.query(
          'UPDATE files SET content=$1 WHERE revision_id=$2 AND path=$3 AND COALESCE(content, \'\')=$4',
          [patch.original_content, patch.revision_id, patch.target_file, patch.patched_content || '']
        );
        if (fileUpdate.rowCount !== 1) throw new Error('REVISION_CONFLICT');
        const patchUpdate = await client.query("UPDATE patches SET status='rolled_back' WHERE id=$1 AND status='applied'", [patchId]);
        if (patchUpdate.rowCount !== 1) throw new Error('PATCH_STATE_CONFLICT');
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        if (['REVISION_CONFLICT', 'PATCH_STATE_CONFLICT'].includes(error.message)) return { error: error.message, patch };
        throw error;
      } finally { client.release(); }
    } else {
      this.sqlite.exec('BEGIN IMMEDIATE');
      try {
        const fileUpdate = this.sqlite.prepare("UPDATE files SET content=? WHERE revision_id=? AND path=? AND COALESCE(content, '')=?")
          .run(patch.original_content, patch.revision_id, patch.target_file, patch.patched_content || '');
        if (fileUpdate.changes !== 1) throw new Error('REVISION_CONFLICT');
        const patchUpdate = this.sqlite.prepare("UPDATE patches SET status='rolled_back' WHERE id=? AND status='applied'").run(patchId);
        if (patchUpdate.changes !== 1) throw new Error('PATCH_STATE_CONFLICT');
        this.sqlite.exec('COMMIT');
      } catch (error) {
        this.sqlite.exec('ROLLBACK');
        if (['REVISION_CONFLICT', 'PATCH_STATE_CONFLICT'].includes(error.message)) return { error: error.message, patch };
        throw error;
      }
    }
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

  // --- Diagrams & Flow Persistence ---
  async saveDiagram(projectId, revisionId, title, diagramType, graphData) {
    const diagId = id('diagram');
    const timestamp = now();
    const dataStr = typeof graphData === 'string' ? graphData : JSON.stringify(graphData);
    await this.run(
      'INSERT INTO diagrams VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      diagId,
      projectId,
      revisionId || null,
      title,
      diagramType,
      dataStr,
      timestamp,
      timestamp
    );
    await this.audit('diagram.saved', projectId, `Saved diagram: ${title} (${diagramType})`);
    return await this.get('SELECT * FROM diagrams WHERE id = ?', diagId);
  }

  async listDiagrams(projectId) {
    return await this.all('SELECT id, project_id, revision_id, title, diagram_type, created_at, updated_at FROM diagrams WHERE project_id = ? ORDER BY updated_at DESC', projectId);
  }

  async getDiagram(diagramId) {
    return await this.get('SELECT * FROM diagrams WHERE id = ?', diagramId);
  }

  async deleteDiagram(diagramId) {
    const d = await this.getDiagram(diagramId);
    if (!d) return false;
    await this.run('DELETE FROM diagrams WHERE id = ?', diagramId);
    return true;
  }

  // --- Tasks & Kanban ---
  async createTask(projectId, title, description = '', priority = 'medium', targetFile = null, dueDate = null) {
    const taskId = id('task');
    const timestamp = now();
    await this.run(
      'INSERT INTO tasks VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      taskId,
      projectId,
      title,
      description,
      'todo',
      priority,
      dueDate,
      targetFile,
      timestamp,
      timestamp
    );
    await this.audit('task.created', projectId, `Created task: ${title}`);
    return await this.get('SELECT * FROM tasks WHERE id = ?', taskId);
  }

  async listTasks(projectId, status = null) {
    if (status) {
      return await this.all('SELECT * FROM tasks WHERE project_id = ? AND status = ? ORDER BY created_at DESC', projectId, status);
    }
    return await this.all('SELECT * FROM tasks WHERE project_id = ? ORDER BY created_at DESC', projectId);
  }

  async getTask(taskId) {
    return await this.get('SELECT * FROM tasks WHERE id = ?', taskId);
  }

  async updateTask(taskId, updates) {
    const task = await this.getTask(taskId);
    if (!task) return null;
    const updatedAt = now();
    const fields = [];
    const values = [];

    if (updates.title !== undefined) { fields.push('title = ?'); values.push(updates.title); }
    if (updates.description !== undefined) { fields.push('description = ?'); values.push(updates.description); }
    if (updates.status !== undefined) { fields.push('status = ?'); values.push(updates.status); }
    if (updates.priority !== undefined) { fields.push('priority = ?'); values.push(updates.priority); }
    if (updates.targetFile !== undefined) { fields.push('target_file = ?'); values.push(updates.targetFile); }
    if (updates.dueDate !== undefined) { fields.push('due_date = ?'); values.push(updates.dueDate); }

    fields.push('updated_at = ?');
    values.push(updatedAt);
    values.push(taskId);

    await this.run(`UPDATE tasks SET ${fields.join(', ')} WHERE id = ?`, ...values);
    return await this.getTask(taskId);
  }

  async deleteTask(taskId) {
    const task = await this.getTask(taskId);
    if (!task) return false;
    await this.run('DELETE FROM tasks WHERE id = ?', taskId);
    return true;
  }

  // --- Notes & Knowledge Base ---
  async createNote(projectId, title, content, category = 'general', tags = '') {
    const noteId = id('note');
    const timestamp = now();
    await this.run(
      'INSERT INTO notes VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      noteId,
      projectId,
      title,
      content,
      category,
      tags,
      timestamp,
      timestamp
    );
    return await this.get('SELECT * FROM notes WHERE id = ?', noteId);
  }

  async listNotes(projectId, category = null) {
    if (category) {
      return await this.all('SELECT * FROM notes WHERE project_id = ? AND category = ? ORDER BY updated_at DESC', projectId, category);
    }
    return await this.all('SELECT * FROM notes WHERE project_id = ? ORDER BY updated_at DESC', projectId);
  }

  async getNote(noteId) {
    return await this.get('SELECT * FROM notes WHERE id = ?', noteId);
  }

  async updateNote(noteId, updates) {
    const note = await this.getNote(noteId);
    if (!note) return null;
    const updatedAt = now();
    const fields = [];
    const values = [];

    if (updates.title !== undefined) { fields.push('title = ?'); values.push(updates.title); }
    if (updates.content !== undefined) { fields.push('content = ?'); values.push(updates.content); }
    if (updates.category !== undefined) { fields.push('category = ?'); values.push(updates.category); }
    if (updates.tags !== undefined) { fields.push('tags = ?'); values.push(updates.tags); }

    fields.push('updated_at = ?');
    values.push(updatedAt);
    values.push(noteId);

    await this.run(`UPDATE notes SET ${fields.join(', ')} WHERE id = ?`, ...values);
    return await this.getNote(noteId);
  }

  async deleteNote(noteId) {
    const note = await this.getNote(noteId);
    if (!note) return false;
    await this.run('DELETE FROM notes WHERE id = ?', noteId);
    return true;
  }

  // --- API Studio Requests ---
  async saveApiRequest(projectId, name, method, url, headers = '{}', body = '', collectionName = 'Default') {
    const reqId = id('apireq');
    const timestamp = now();
    await this.run(
      'INSERT INTO api_requests VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      reqId,
      projectId,
      name,
      method.toUpperCase(),
      url,
      typeof headers === 'string' ? headers : JSON.stringify(headers),
      body || '',
      collectionName,
      null,
      null,
      timestamp,
      timestamp
    );
    return await this.get('SELECT * FROM api_requests WHERE id = ?', reqId);
  }

  async listApiRequests(projectId) {
    return await this.all('SELECT * FROM api_requests WHERE project_id = ? ORDER BY collection_name ASC, created_at DESC', projectId);
  }

  async getApiRequest(reqId) {
    return await this.get('SELECT * FROM api_requests WHERE id = ?', reqId);
  }

  async updateApiRequestResult(reqId, status, response) {
    await this.run(
      'UPDATE api_requests SET last_status = ?, last_response = ?, updated_at = ? WHERE id = ?',
      status,
      typeof response === 'string' ? response.slice(0, 10000) : JSON.stringify(response).slice(0, 10000),
      now(),
      reqId
    );
  }

  async deleteApiRequest(reqId) {
    const r = await this.getApiRequest(reqId);
    if (!r) return false;
    await this.run('DELETE FROM api_requests WHERE id = ?', reqId);
    return true;
  }

  // --- Conversations & Messages ---
  async createConversation(projectId, title) {
    const convoId = id('convo');
    await this.run('INSERT INTO conversations VALUES (?, ?, ?, ?)', convoId, projectId, title, now());
    return await this.get('SELECT * FROM conversations WHERE id = ?', convoId);
  }

  async listConversations(projectId) {
    return await this.all('SELECT * FROM conversations WHERE project_id = ? ORDER BY created_at DESC', projectId);
  }

  async getConversation(convoId) {
    return await this.get('SELECT * FROM conversations WHERE id = ?', convoId);
  }

  async deleteConversation(convoId) {
    const c = await this.getConversation(convoId);
    if (!c) return false;
    await this.run('DELETE FROM conversations WHERE id = ?', convoId);
    return true;
  }

  async addMessage(convoId, projectId, revisionId, role, content, citations = []) {
    const msgId = id('msg');
    const citStr = typeof citations === 'string' ? citations : JSON.stringify(citations);
    await this.run(
      'INSERT INTO messages VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      msgId,
      convoId,
      projectId,
      revisionId || null,
      role,
      content,
      citStr,
      now()
    );
    return await this.get('SELECT * FROM messages WHERE id = ?', msgId);
  }

  async listMessages(convoId) {
    return await this.all('SELECT * FROM messages WHERE conversation_id = ? ORDER BY created_at ASC', convoId);
  }

  // --- Global Cross-App Search ---
  async globalSearch(projectId, query) {
    const q = `%${(query || '').toLowerCase().trim()}%`;
    const rev = await this.latestRevision(projectId);
    const revId = rev ? rev.id : null;

    const results = {
      files: [],
      symbols: [],
      findings: [],
      tasks: [],
      notes: [],
      diagrams: []
    };

    if (revId) {
      results.files = await this.all(
        'SELECT path, language, bytes FROM files WHERE revision_id = ? AND LOWER(path) LIKE ? LIMIT 10',
        revId,
        q
      );
      results.symbols = await this.all(
        'SELECT file_path, name, kind, line FROM symbols WHERE revision_id = ? AND LOWER(name) LIKE ? LIMIT 10',
        revId,
        q
      );
      results.findings = await this.all(
        'SELECT severity, category, message, file_path, line FROM findings WHERE revision_id = ? AND (LOWER(message) LIKE ? OR LOWER(file_path) LIKE ?) LIMIT 10',
        revId,
        q,
        q
      );
    }

    results.tasks = await this.all(
      'SELECT id, title, status, priority FROM tasks WHERE project_id = ? AND (LOWER(title) LIKE ? OR LOWER(description) LIKE ?) LIMIT 10',
      projectId,
      q,
      q
    );

    results.notes = await this.all(
      'SELECT id, title, category FROM notes WHERE project_id = ? AND (LOWER(title) LIKE ? OR LOWER(content) LIKE ?) LIMIT 10',
      projectId,
      q,
      q
    );

    results.diagrams = await this.all(
      'SELECT id, title, diagram_type FROM diagrams WHERE project_id = ? AND LOWER(title) LIKE ? LIMIT 10',
      projectId,
      q
    );

    return results;
  }

  // --- Operations Management ---
  async createOperation(projectId, revisionId, type, name, config = {}) {
    const opId = id('op');
    const ts = now();
    const configStr = typeof config === 'string' ? config : JSON.stringify(config);
    await this.run(
      'INSERT INTO operations (id, project_id, revision_id, type, name, status, stage, progress, config, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      opId,
      projectId,
      revisionId || null,
      type,
      name,
      'running',
      'initialization',
      0,
      configStr,
      ts
    );
    await this.addOperationEvent(opId, 'initialization', `Started operation: ${name}`, 'info');
    return this.getOperation(opId);
  }

  async getOperation(opId) {
    const op = await this.get('SELECT * FROM operations WHERE id = ?', opId);
    if (!op) return null;
    const events = await this.all(
      'SELECT id, stage, message, severity, created_at FROM operation_events WHERE operation_id = ? ORDER BY created_at ASC',
      opId
    );
    return { ...op, events };
  }

  async listOperations(projectId, limit = 50) {
    return this.all(
      'SELECT id, project_id, revision_id, type, name, status, stage, progress, summary, error_message, created_at, completed_at FROM operations WHERE project_id = ? ORDER BY created_at DESC LIMIT ?',
      projectId,
      limit
    );
  }

  async updateOperation(opId, { status, stage, progress, summary, errorMessage }) {
    const existing = await this.get('SELECT * FROM operations WHERE id = ?', opId);
    if (!existing) return null;

    const nextStatus = status !== undefined ? status : existing.status;
    const nextStage = stage !== undefined ? stage : existing.stage;
    const nextProgress = progress !== undefined ? progress : existing.progress;
    const nextSummary = summary !== undefined ? summary : existing.summary;
    const nextError = errorMessage !== undefined ? errorMessage : existing.error_message;
    const completedAt = (nextStatus === 'completed' || nextStatus === 'failed' || nextStatus === 'cancelled') ? now() : existing.completed_at;

    await this.run(
      'UPDATE operations SET status = ?, stage = ?, progress = ?, summary = ?, error_message = ?, completed_at = ? WHERE id = ?',
      nextStatus,
      nextStage,
      nextProgress,
      nextSummary,
      nextError,
      completedAt,
      opId
    );
    return this.getOperation(opId);
  }

  async addOperationEvent(opId, stage, message, severity = 'info') {
    const eventId = id('opevt');
    const ts = now();
    await this.run(
      'INSERT INTO operation_events (id, operation_id, stage, message, severity, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      eventId,
      opId,
      stage,
      message,
      severity,
      ts
    );
    return { id: eventId, operation_id: opId, stage, message, severity, created_at: ts };
  }

  async saveImpactAnalysis(projectId, revisionId, changedFiles, strategy, summary, selectedTests) {
    const analysisId = `impact_${crypto.randomUUID()}`;
    const ts = now();
    await this.run(
      'INSERT INTO impact_analyses VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      analysisId,
      projectId,
      revisionId,
      JSON.stringify(changedFiles),
      strategy,
      JSON.stringify(summary),
      JSON.stringify(selectedTests),
      ts
    );
    return { id: analysisId, created_at: ts };
  }

  async listImpactAnalyses(projectId, limit = 20) {
    return this.all(
      'SELECT * FROM impact_analyses WHERE project_id = ? ORDER BY created_at DESC LIMIT ?',
      projectId,
      limit
    );
  }
}

module.exports = { Store };


