const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { Store } = require('../src/db');

const databaseUrl = process.env.TEST_POSTGRES_URL;

test('actual PostgreSQL lifecycle, migrations, restart persistence, concurrency, and tenant isolation', { skip: !databaseUrl }, async () => {
  const options = {
    dataDir: '.unused', databaseUrl,
    database: { sslMode: 'disable', poolMax: 4, connectionTimeoutMs: 5000, queryTimeoutMs: 15000 },
    sessionSecret: 'postgres-integration-secret-value-over-32-characters'
  };
  const store = new Store(options);
  await store.ensureReady();
  const suffix = crypto.randomUUID();
  const alice = await store.createUser(`alice-${suffix}@example.com`, 'Alice', 'StrongPass!123');
  const bob = await store.createUser(`bob-${suffix}@example.com`, 'Bob', 'StrongPass!123');
  const session = await store.createSession(alice.id);
  assert.equal((await store.getSessionUser(session.token)).id, alice.id);
  const workspace = await store.createWorkspace(`Workspace ${suffix}`, alice.id);
  const project = await store.createProject('Lifecycle Project', 'before update', workspace.id, alice.id);
  const disposableProject = await store.createProject('Disposable Project', 'delete verification', workspace.id, alice.id);
  assert.equal(await store.deleteProject(disposableProject.id, alice.id), true);
  assert.equal(await store.project(disposableProject.id), null);
  const updated = await store.updateProject(project.id, { name: 'Updated Lifecycle Project', description: 'after update' }, alice.id);
  assert.equal(updated.name, 'Updated Lifecycle Project');
  const saved = await store.saveRevision(project.id, `hash-${suffix}`, {
    files: [{ path: 'src/app.js', language: 'JavaScript', bytes: 32, content: 'export const value = 1;', excludedReason: null }],
    symbols: [{ filePath: 'src/app.js', name: 'value', kind: 'const', line: 1 }],
    edges: [{ sourcePath: 'src/app.js', targetPath: 'src/lib.js', type: 'imports', confidence: 'confirmed', line: 1, provenance: 'integration-test' }],
    findings: []
  }, 'PostgreSQL integration revision');
  const plan = await store.createPlan(project.id, saved.revision.id, 'Lifecycle plan', 'Verify PostgreSQL', 'small', []);
  await store.createPatch(project.id, saved.revision.id, plan.id, 'Patch history', 'src/app.js', 'diff', 'before', 'after');
  await store.run('INSERT INTO test_runs VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', `test_${suffix}`, project.id, saved.revision.id, 'external', 'node --test', 'PASS', 0, 'verified', 1, new Date().toISOString());
  const second = new Store(options);
  await second.ensureReady();
  const buckets = await Promise.all(Array.from({ length: 24 }, (_, index) => (index % 2 ? store : second).consumeRateLimit(`pg-shared-${suffix}`, 12, 60_000, 1000)));
  assert.equal(buckets.filter((result) => result.allowed).length, 12);
  assert.equal(await store.getProjectAccess(project.id, bob), null);
  assert.ok((await store.listProjects(null, alice.id)).some((candidate) => candidate.id === project.id));
  assert.equal((await store.listProjects(null, bob.id)).length, 0);
  const migrations = await store.all('SELECT version FROM schema_migrations ORDER BY version');
  assert.deepEqual(migrations.map((row) => Number(row.version)), [1, 2, 3, 4]);
  await assert.rejects(() => store.run('INSERT INTO revisions VALUES (?, ?, ?, ?, ?, ?)', `bad_${suffix}`, 'missing-project', 'bad', new Date().toISOString(), 'ready', null));
  const migrationClient = await store.pool.connect();
  try {
    await migrationClient.query('BEGIN');
    await migrationClient.query("INSERT INTO schema_migrations VALUES (999, 'interrupted-test', $1)", [new Date().toISOString()]);
    await assert.rejects(() => migrationClient.query('SELECT * FROM intentionally_missing_table'));
    await migrationClient.query('ROLLBACK');
  } finally {
    migrationClient.release();
  }
  assert.equal(await store.get('SELECT version FROM schema_migrations WHERE version=999'), null);
  await second.close();
  await store.close();

  const restarted = new Store(options);
  await restarted.ensureReady();
  const persisted = await restarted.projectSummary(project.id);
  assert.equal(persisted.project.owner_id, alice.id);
  assert.equal(Number(persisted.counts.files), 1);
  assert.equal(Number(persisted.counts.edges), 1);
  assert.equal((await restarted.listPatches(project.id)).length, 1);
  assert.equal(Number((await restarted.get('SELECT COUNT(*) AS count FROM test_runs WHERE project_id=?', project.id)).count), 1);
  assert.ok((await restarted.listAuditEventsForUser(alice)).some((event) => event.project_id === project.id));
  await restarted.close();
});
