const { DatabaseSync } = require('node:sqlite');
const fs = require('node:fs');
const path = require('node:path');

function id(prefix) { return `${prefix}_${crypto.randomUUID()}`; }
function now() { return new Date().toISOString(); }

class Store {
  constructor(dataDir) {
    fs.mkdirSync(dataDir, { recursive: true });
    this.db = new DatabaseSync(path.join(dataDir, 'codepilot.db'));
    this.db.exec('PRAGMA foreign_keys = ON;');
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS projects (id TEXT PRIMARY KEY, name TEXT NOT NULL, created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS revisions (id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE, content_hash TEXT NOT NULL, created_at TEXT NOT NULL, status TEXT NOT NULL, UNIQUE(project_id, content_hash));
      CREATE TABLE IF NOT EXISTS jobs (id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE, revision_id TEXT REFERENCES revisions(id) ON DELETE CASCADE, stage TEXT NOT NULL, status TEXT NOT NULL, detail TEXT, created_at TEXT NOT NULL, completed_at TEXT);
      CREATE TABLE IF NOT EXISTS files (id TEXT PRIMARY KEY, revision_id TEXT NOT NULL REFERENCES revisions(id) ON DELETE CASCADE, path TEXT NOT NULL, language TEXT, bytes INTEGER NOT NULL, content TEXT, excluded_reason TEXT, UNIQUE(revision_id, path));
      CREATE TABLE IF NOT EXISTS symbols (id TEXT PRIMARY KEY, revision_id TEXT NOT NULL REFERENCES revisions(id) ON DELETE CASCADE, file_path TEXT NOT NULL, name TEXT NOT NULL, kind TEXT NOT NULL, line INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS edges (id TEXT PRIMARY KEY, revision_id TEXT NOT NULL REFERENCES revisions(id) ON DELETE CASCADE, source_path TEXT NOT NULL, target_path TEXT NOT NULL, type TEXT NOT NULL, confidence TEXT NOT NULL, line INTEGER, provenance TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS findings (id TEXT PRIMARY KEY, revision_id TEXT NOT NULL REFERENCES revisions(id) ON DELETE CASCADE, severity TEXT NOT NULL, category TEXT NOT NULL, message TEXT NOT NULL, file_path TEXT, line INTEGER, evidence TEXT);
      CREATE TABLE IF NOT EXISTS messages (id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE, revision_id TEXT NOT NULL REFERENCES revisions(id) ON DELETE CASCADE, role TEXT NOT NULL, content TEXT NOT NULL, citations TEXT NOT NULL, created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS audit_events (id TEXT PRIMARY KEY, action TEXT NOT NULL, project_id TEXT REFERENCES projects(id) ON DELETE SET NULL, detail TEXT NOT NULL, created_at TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS files_revision_path ON files(revision_id, path);
      CREATE INDEX IF NOT EXISTS symbols_revision_name ON symbols(revision_id, name);
      CREATE INDEX IF NOT EXISTS edges_revision ON edges(revision_id);
    `);
  }
  run(sql, ...args) { return this.db.prepare(sql).run(...args); }
  get(sql, ...args) { return this.db.prepare(sql).get(...args); }
  all(sql, ...args) { return this.db.prepare(sql).all(...args); }
  audit(action, projectId, detail) { this.run('INSERT INTO audit_events VALUES (?, ?, ?, ?, ?)', id('audit'), action, projectId || null, detail, now()); }
  createProject(name) { const project = { id: id('project'), name, created_at: now() }; this.run('INSERT INTO projects VALUES (?, ?, ?)', project.id, project.name, project.created_at); this.audit('project.created', project.id, `Created project ${name}`); return project; }
  listProjects() { return this.all(`SELECT p.*, (SELECT id FROM revisions r WHERE r.project_id=p.id ORDER BY created_at DESC LIMIT 1) AS latest_revision_id, (SELECT status FROM revisions r WHERE r.project_id=p.id ORDER BY created_at DESC LIMIT 1) AS latest_status FROM projects p ORDER BY created_at DESC`); }
  project(idValue) { return this.get('SELECT * FROM projects WHERE id = ?', idValue); }
  latestRevision(projectId) { return this.get('SELECT * FROM revisions WHERE project_id = ? ORDER BY created_at DESC LIMIT 1', projectId); }
  createJob(projectId, stage, detail) { const job = { id: id('job'), projectId, stage, detail, createdAt: now() }; this.run('INSERT INTO jobs VALUES (?, ?, ?, ?, ?, ?, ?, ?)', job.id, projectId, null, stage, 'running', detail, job.createdAt, null); return job; }
  finishJob(jobId, revisionId, status, detail) { this.run('UPDATE jobs SET revision_id=?, status=?, detail=?, completed_at=? WHERE id=?', revisionId || null, status, detail, now(), jobId); }
  saveRevision(projectId, contentHash, records) {
    const existing = this.get('SELECT * FROM revisions WHERE project_id=? AND content_hash=?', projectId, contentHash);
    if (existing) return { revision: existing, duplicate: true };
    const revision = { id: id('revision'), projectId, contentHash, createdAt: now() };
    this.db.exec('BEGIN');
    try {
      this.run('INSERT INTO revisions VALUES (?, ?, ?, ?, ?)', revision.id, projectId, contentHash, revision.createdAt, 'ready');
      for (const file of records.files) this.run('INSERT INTO files VALUES (?, ?, ?, ?, ?, ?, ?)', id('file'), revision.id, file.path, file.language, file.bytes, file.content, file.excludedReason || null);
      for (const symbol of records.symbols) this.run('INSERT INTO symbols VALUES (?, ?, ?, ?, ?, ?)', id('symbol'), revision.id, symbol.filePath, symbol.name, symbol.kind, symbol.line);
      for (const edge of records.edges) this.run('INSERT INTO edges VALUES (?, ?, ?, ?, ?, ?, ?, ?)', id('edge'), revision.id, edge.sourcePath, edge.targetPath, edge.type, edge.confidence, edge.line || null, edge.provenance);
      for (const finding of records.findings) this.run('INSERT INTO findings VALUES (?, ?, ?, ?, ?, ?, ?, ?)', id('finding'), revision.id, finding.severity, finding.category, finding.message, finding.filePath || null, finding.line || null, finding.evidence || null);
      this.db.exec('COMMIT');
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
    this.audit('revision.imported', projectId, `Imported revision ${revision.id}`);
    return { revision: { ...revision, status: 'ready' }, duplicate: false };
  }
  projectSummary(projectId) {
    const project = this.project(projectId); if (!project) return null;
    const revision = this.latestRevision(projectId);
    if (!revision) return { project, revision: null, counts: {} };
    const count = (table) => this.get(`SELECT COUNT(*) AS count FROM ${table} WHERE revision_id=?`, revision.id).count;
    return { project, revision, counts: { files: count('files'), symbols: count('symbols'), edges: count('edges'), findings: count('findings') } };
  }
}

module.exports = { Store };
