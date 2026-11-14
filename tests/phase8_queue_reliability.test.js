const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { Store } = require('../src/db');
const { JobConsumer, OutboxDispatcher } = require('../src/queue/vercel_queue');

const topic = 'codepilot-phase8-jobs';

async function fixture(t, { maxAttempts = 3, publish = true } = {}) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codepilot-phase8-'));
  const store = new Store(dataDir);
  const owner = await store.createUser(`owner-${crypto.randomUUID()}@example.test`, 'Owner', 'StrongPass!123');
  const stranger = await store.createUser(`stranger-${crypto.randomUUID()}@example.test`, 'Stranger', 'StrongPass!123');
  const project = await store.createProject('Phase 8 reliability', '', null, owner.id);
  const created = await store.createWorkflowJob({
    projectId: project.id,
    actorId: owner.id,
    jobType: 'test-execution',
    executionProfile: 'node-test',
    idempotencyKey: `phase8:${crypto.randomUUID()}`,
    maxAttempts,
    topic
  });
  const metadata = { messageId: `msg-${created.job.id}`, deliveryCount: 1, topicName: topic };
  if (publish) {
    await new OutboxDispatcher({ store, publisher: { async publish() { return { messageId: metadata.messageId }; } } }).dispatch();
  }
  t.after(async () => {
    await store.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });
  return { store, owner, stranger, project, created, envelope: JSON.parse(created.outbox.payload), metadata };
}

test('concurrent duplicate deliveries atomically lease and execute a job once', async (t) => {
  const f = await fixture(t);
  let executions = 0;
  const consumer = new JobConsumer({
    store: f.store,
    workerId: 'phase8-race-worker',
    expectedTopic: topic,
    requireMetadata: true,
    executionEnabled: true,
    orchestrator: {
      async execute(job, workerId) {
        executions += 1;
        await new Promise((resolve) => setImmediate(resolve));
        return f.store.completeExecutionJob(job.id, workerId, { status: 'PASS', executed: true }, 'phase8-provider', 'phase8-run');
      }
    }
  });

  const results = await Promise.all([
    consumer.consume(f.envelope, f.metadata),
    consumer.consume(f.envelope, { ...f.metadata, deliveryCount: 2 })
  ]);
  assert.equal(executions, 1);
  assert.equal(results.filter((result) => result?.status === 'SUCCEEDED').length, 1);
  assert.equal(results.filter((result) => result?.duplicate === true).length, 1);
  assert.equal((await f.store.get('SELECT status FROM execution_jobs WHERE id=?', f.created.job.id)).status, 'SUCCEEDED');
});

test('interrupted outbox publication remains durable and retries with the same idempotency key', async (t) => {
  const f = await fixture(t, { publish: false });
  const keys = [];
  let attempts = 0;
  const publisher = {
    async publish(outbox) {
      attempts += 1;
      keys.push(outbox.idempotency_key);
      if (attempts === 1) throw new Error('provider accepted request but response was interrupted');
      return { messageId: f.metadata.messageId };
    }
  };
  const dispatcher = new OutboxDispatcher({ store: f.store, publisher });
  const first = await dispatcher.dispatch();
  assert.equal(first[0].status, 'PENDING');
  await f.store.run("UPDATE job_outbox SET available_at=? WHERE id=?", new Date(0).toISOString(), f.created.outbox.id);
  const second = await dispatcher.dispatch();
  assert.equal(second[0].status, 'PUBLISHED');
  assert.equal(attempts, 2);
  assert.equal(new Set(keys).size, 1);
  const outbox = await f.store.get('SELECT status, attempts FROM job_outbox WHERE id=?', f.created.outbox.id);
  assert.equal(outbox.status, 'PUBLISHED');
  assert.equal(Number(outbox.attempts), 2);
  assert.equal((await f.store.get('SELECT status FROM execution_jobs WHERE id=?', f.created.job.id)).status, 'DISPATCHED');
});

test('expired worker leases recover, while exhausted leases become poisoned failures', async (t) => {
  const recoverable = await fixture(t);
  assert.ok(await recoverable.store.claimExecutionJob(recoverable.created.job.id, 'crashed-worker', 60_000));
  await recoverable.store.run('UPDATE execution_jobs SET lease_expires_at=? WHERE id=?', new Date(0).toISOString(), recoverable.created.job.id);
  const recovered = await recoverable.store.recoverExpiredExecutionJobs();
  assert.equal(recovered.recovered, 1);
  assert.ok(await recoverable.store.claimExecutionJob(recoverable.created.job.id, 'replacement-worker', 60_000));

  const exhausted = await fixture(t, { maxAttempts: 1 });
  assert.ok(await exhausted.store.claimExecutionJob(exhausted.created.job.id, 'last-worker', 60_000));
  await exhausted.store.run('UPDATE execution_jobs SET lease_expires_at=? WHERE id=?', new Date(0).toISOString(), exhausted.created.job.id);
  const terminal = await exhausted.store.recoverExpiredExecutionJobs();
  assert.equal(terminal.exhausted, 1);
  const job = await exhausted.store.get('SELECT status, poisoned, error_message FROM execution_jobs WHERE id=?', exhausted.created.job.id);
  assert.equal(job.status, 'FAILED');
  assert.equal(Number(job.poisoned), 1);
  assert.match(job.error_message, /lease expired after retry limit/);
});

test('running cancellation is owner-only and resolves durably after failure or worker loss', async (t) => {
  const active = await fixture(t);
  assert.ok(await active.store.claimExecutionJob(active.created.job.id, 'cancel-worker', 60_000));
  assert.equal(await active.store.cancelWorkflowJob(active.created.job.id, active.stranger.id), null);
  assert.equal((await active.store.cancelWorkflowJob(active.created.job.id, active.owner.id)).status, 'CANCEL_REQUESTED');
  assert.equal((await active.store.failWorkflowJob(active.created.job.id, 'cancel-worker', 'cancelled by owner')).status, 'CANCELLED');

  const crashed = await fixture(t);
  assert.ok(await crashed.store.claimExecutionJob(crashed.created.job.id, 'lost-worker', 60_000));
  await crashed.store.cancelWorkflowJob(crashed.created.job.id, crashed.owner.id);
  await crashed.store.run('UPDATE execution_jobs SET lease_expires_at=? WHERE id=?', new Date(0).toISOString(), crashed.created.job.id);
  const summary = await crashed.store.recoverExpiredExecutionJobs();
  assert.equal(summary.cancelled, 1);
  assert.equal((await crashed.store.get('SELECT status FROM execution_jobs WHERE id=?', crashed.created.job.id)).status, 'CANCELLED');
});

test('job access is tenant-scoped and persisted diagnostics redact secret material', async (t) => {
  const f = await fixture(t, { publish: false });
  assert.equal(await f.store.getExecutionJobForUser(f.created.job.id, f.stranger), null);
  assert.equal(await f.store.cancelWorkflowJob(f.created.job.id, f.stranger.id), null);
  assert.deepEqual(await f.store.listExecutionJobsForUser(f.stranger), []);

  const secret = 'phase8-sensitive-value';
  await f.store.markOutboxFailure(f.created.outbox.id, `authorization=Bearer-${secret}; token=${secret}; api_key=${secret}`);
  const outbox = await f.store.get('SELECT last_error FROM job_outbox WHERE id=?', f.created.outbox.id);
  assert.doesNotMatch(outbox.last_error, new RegExp(secret));
  assert.match(outbox.last_error, /\[REDACTED\]/);
  await f.store.recordOperationalEvent('phase8.redaction_test', 'error', f.project.id, null, `Bearer ${secret} password=${secret}`);
  const event = await f.store.get("SELECT detail FROM operational_events WHERE event_type='phase8.redaction_test'");
  assert.doesNotMatch(event.detail, new RegExp(secret));
});

test('operational metrics expose stale leases and poison counts without sensitive details', async (t) => {
  const f = await fixture(t);
  await f.store.run("UPDATE execution_jobs SET status='RUNNING', lease_expires_at=?, poisoned=1 WHERE id=?", new Date(0).toISOString(), f.created.job.id);
  const metrics = await f.store.operationalMetrics();
  assert.equal(metrics.staleLeases, 1);
  assert.equal(metrics.poisonedJobs, 1);
  assert.equal('last_error' in metrics, false);
});
