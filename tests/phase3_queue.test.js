const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Store } = require('../src/db');
const { OutboxDispatcher, JobConsumer } = require('../src/queue/vercel_queue');

async function fixture(t) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codepilot-phase3-queue-'));
  const store = new Store(dataDir);
  const owner = await store.createUser(`owner-${Date.now()}@example.com`, 'Owner', 'StrongPass!123');
  const stranger = await store.createUser(`stranger-${Date.now()}@example.com`, 'Stranger', 'StrongPass!123');
  const project = await store.createProject('Queue project', '', null, owner.id);
  t.after(async () => { await store.close(); fs.rmSync(dataDir, { recursive: true, force: true }); });
  return { store, owner, stranger, project };
}

test('transactional outbox and idempotency prevent duplicate job publication', async (t) => {
  const { store, owner, project } = await fixture(t);
  const first = await store.createWorkflowJob({ projectId: project.id, actorId: owner.id, jobType: 'source-analysis', idempotencyKey: 'analysis:duplicate-key', topic: 'jobs' });
  const duplicate = await store.createWorkflowJob({ projectId: project.id, actorId: owner.id, jobType: 'source-analysis', idempotencyKey: 'analysis:duplicate-key', topic: 'jobs' });
  assert.equal(first.created, true);
  assert.equal(duplicate.created, false);
  assert.equal(first.job.id, duplicate.job.id);
  assert.equal(Number((await store.get('SELECT COUNT(*) AS count FROM job_outbox')).count), 1);

  const sent = [];
  const dispatcher = new OutboxDispatcher({ store, publisher: { async publish(outbox) { sent.push(JSON.parse(outbox.payload)); return { messageId: 'msg-1' }; } } });
  await dispatcher.dispatch();
  await dispatcher.dispatch();
  assert.equal(sent.length, 1);
  assert.equal((await store.get('SELECT status FROM job_outbox')).status, 'PUBLISHED');
  assert.equal((await store.get('SELECT status FROM execution_jobs WHERE id=?', first.job.id)).status, 'DISPATCHED');
});

test('consumer revalidates outbox, claims once, and treats redelivery idempotently', async (t) => {
  const { store, owner, project } = await fixture(t);
  const created = await store.createWorkflowJob({ projectId: project.id, actorId: owner.id, jobType: 'source-analysis', idempotencyKey: 'analysis:consumer-key', topic: 'jobs' });
  const dispatcher = new OutboxDispatcher({ store, publisher: { async publish() { return { messageId: 'msg-2' }; } } });
  await dispatcher.dispatch();
  const envelope = JSON.parse(created.outbox.payload);
  let runs = 0;
  const consumer = new JobConsumer({ store, workerId: 'worker-1', orchestrator: { async execute(job, workerId) { runs += 1; return store.completeExecutionJob(job.id, workerId, { status: 'PASS', executed: true }, 'fake-provider', 'sandbox-1'); } } });
  const completed = await consumer.consume(envelope);
  const duplicate = await consumer.consume(envelope);
  assert.equal(completed.status, 'SUCCEEDED');
  assert.deepEqual(duplicate, { duplicate: true, status: 'SUCCEEDED' });
  assert.equal(runs, 1);
  await assert.rejects(() => consumer.consume({ version: 1, jobId: created.job.id, outboxId: created.outbox.id, source: 'forbidden' }), /Invalid queue message/);
});

test('owner cancellation, retry bounds, poison handling, and lease recovery are durable', async (t) => {
  const { store, owner, stranger, project } = await fixture(t);
  const cancellable = await store.createWorkflowJob({ projectId: project.id, actorId: owner.id, jobType: 'report-generation', idempotencyKey: 'report:cancellable', topic: 'jobs' });
  assert.equal(await store.cancelWorkflowJob(cancellable.job.id, stranger.id), null);
  assert.equal((await store.cancelWorkflowJob(cancellable.job.id, owner.id)).status, 'CANCELLED');

  const poison = await store.createWorkflowJob({ projectId: project.id, actorId: owner.id, jobType: 'source-analysis', idempotencyKey: 'analysis:poison', maxAttempts: 2, topic: 'jobs' });
  await store.markJobDispatched(poison.job.id, 'msg-poison');
  let claimed = await store.claimExecutionJob(poison.job.id, 'worker-poison', 1000);
  assert.ok(claimed);
  assert.equal((await store.failWorkflowJob(poison.job.id, 'worker-poison', 'first failure', { retryDelayMs: 0 })).status, 'QUEUED');
  claimed = await store.claimExecutionJob(poison.job.id, 'worker-poison', 1000);
  assert.ok(claimed);
  const failed = await store.failWorkflowJob(poison.job.id, 'worker-poison', 'second failure');
  assert.equal(failed.status, 'FAILED');
  assert.equal(Number(failed.poisoned), 1);

  const recoverable = await store.createWorkflowJob({ projectId: project.id, actorId: owner.id, jobType: 'source-analysis', idempotencyKey: 'analysis:recover', topic: 'jobs' });
  await store.markJobDispatched(recoverable.job.id, 'msg-recover');
  await store.claimExecutionJob(recoverable.job.id, 'dead-worker', 1000);
  await store.run("UPDATE execution_jobs SET lease_expires_at='2000-01-01T00:00:00.000Z' WHERE id=?", recoverable.job.id);
  await store.recoverExpiredExecutionJobs();
  assert.equal((await store.get('SELECT status FROM execution_jobs WHERE id=?', recoverable.job.id)).status, 'QUEUED');
});
