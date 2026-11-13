const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { DatabaseSync } = require('node:sqlite');
const { Store } = require('../src/db');

test('legacy SQLite projects are upgraded without losing rows and migrations are idempotent', async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codepilot-migration-'));
  const databasePath = path.join(dataDir, 'codepilot.db');
  const legacy = new DatabaseSync(databasePath);
  legacy.exec(`
    CREATE TABLE users (
      id TEXT PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      is_global_admin INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );
    CREATE TABLE projects (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      created_at TEXT NOT NULL
    );
  `);
  legacy.prepare('INSERT INTO users VALUES (?, ?, ?, ?, ?, ?)').run('user_legacy', 'legacy@example.com', 'Legacy', 'unused', 0, new Date().toISOString());
  legacy.prepare('INSERT INTO projects VALUES (?, ?, ?, ?)').run('project_legacy', 'Preserved', 'legacy row', new Date().toISOString());
  legacy.close();

  const store = new Store({ dataDir, sessionSecret: 'migration-test-secret-value-over-32-characters' });
  await store.ensureReady();
  assert.equal((await store.project('project_legacy')).name, 'Preserved');
  assert.ok((await store.all('PRAGMA table_info(projects)')).some((column) => column.name === 'owner_id'));
  assert.deepEqual((await store.all('SELECT version FROM schema_migrations ORDER BY version')).map((row) => row.version), [1, 2, 3, 4]);
  await store.close();

  const reopened = new Store({ dataDir, sessionSecret: 'migration-test-secret-value-over-32-characters' });
  await reopened.ensureReady();
  assert.equal((await reopened.project('project_legacy')).description, 'legacy row');
  assert.equal((await reopened.all('SELECT version FROM schema_migrations')).length, 4);
  await reopened.close();
});
