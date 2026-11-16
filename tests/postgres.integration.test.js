const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { Store } = require('../src/db');
const { JobConsumer } = require('../src/queue/vercel_queue');

const databaseUrl = process.env.TEST_POSTGRES_URL;

test('actual PostgreSQL lifecycle, migrations, restart persistence, concurrency, and tenant isolation', { skip: !databaseUrl }, async () => {
  const databaseHost = new URL(databaseUrl).hostname;
  const options = {
    dataDir: '.unused', databaseUrl,
    database: { sslMode: process.env.TEST_POSTGRES_SSL_MODE || (['localhost', '127.0.0.1', '::1'].includes(databaseHost) ? 'disable' : 'verify-full'), poolMax: 4, connectionTimeoutMs: 5000, queryTimeoutMs: 15000 },
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
  const phase3Job = await store.createWorkflowJob({ projectId: project.id, actorId: alice.id, revisionId: saved.revision.id, jobType: 'source-analysis', idempotencyKey: `pg-phase3:${suffix}`, topic: 'phase3-jobs' });
  assert.equal(phase3Job.job.status, 'QUEUED');
  assert.equal((await store.createWorkflowJob({ projectId: project.id, actorId: alice.id, revisionId: saved.revision.id, jobType: 'source-analysis', idempotencyKey: `pg-phase3:${suffix}`, topic: 'phase3-jobs' })).created, false);
  const consumerJob = await store.createWorkflowJob({ projectId: project.id, actorId: alice.id, revisionId: saved.revision.id, jobType: 'test-execution', executionProfile: 'node-test', idempotencyKey: `pg-consumer:${suffix}`, topic: 'phase7-jobs' });
  await store.markOutboxPublished(consumerJob.outbox.id, `pg-message-${suffix}`);
  const consumer = new JobConsumer({
    store, workerId: `pg-worker-${suffix}`, expectedTopic: 'phase7-jobs', requireMetadata: true, executionEnabled: true,
    orchestrator: { async execute(job, workerId) { return store.completeExecutionJob(job.id, workerId, { status: 'PASS', executed: true }, 'postgres-contract', `pg-run-${suffix}`); } }
  });
  const consumed = await consumer.consume(JSON.parse(consumerJob.outbox.payload), { messageId: `pg-message-${suffix}`, deliveryCount: 1, topicName: 'phase7-jobs', consumerGroup: 'phase7-postgres', region: 'iad1' });
  assert.equal(consumed.status, 'SUCCEEDED');
  assert.deepEqual(await consumer.consume(JSON.parse(consumerJob.outbox.payload), { messageId: `pg-message-${suffix}`, deliveryCount: 2, topicName: 'phase7-jobs', consumerGroup: 'phase7-postgres', region: 'iad1' }), { duplicate: true, status: 'SUCCEEDED' });
  await store.run('INSERT INTO test_runs VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', `test_${suffix}`, project.id, saved.revision.id, 'external', 'node --test', 'PASS', 0, 'verified', 1, new Date().toISOString());
  const second = new Store(options);
  await second.ensureReady();
  const buckets = await Promise.all(Array.from({ length: 24 }, (_, index) => (index % 2 ? store : second).consumeRateLimit(`pg-shared-${suffix}`, 12, 60_000, 1000)));
  assert.equal(buckets.filter((result) => result.allowed).length, 12);
  assert.equal(await store.getProjectAccess(project.id, bob), null);
  assert.ok((await store.listProjects(null, alice.id)).some((candidate) => candidate.id === project.id));
  assert.equal((await store.listProjects(null, bob.id)).length, 0);
  const migrations = await store.all('SELECT version FROM schema_migrations ORDER BY version');
  assert.deepEqual(migrations.map((row) => Number(row.version)), [1, 2, 3, 4, 5, 6]);
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
  assert.equal(Number((await restarted.get('SELECT COUNT(*) AS count FROM execution_jobs WHERE project_id=? AND idempotency_key=?', project.id, `pg-phase3:${suffix}`)).count), 1);
  assert.equal(Number((await restarted.get('SELECT COUNT(*) AS count FROM job_outbox WHERE job_id=?', phase3Job.job.id)).count), 1);
  assert.ok((await restarted.listAuditEventsForUser(alice)).some((event) => event.project_id === project.id));
  await restarted.close();
});
