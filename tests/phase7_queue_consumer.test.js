const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Store } = require('../src/db');
const { JobConsumer, OutboxDispatcher, NonRetryableQueueError, validateQueueEnvelope, validateDeliveryMetadata } = require('../src/queue/vercel_queue');
const { buildQueueConsumer, queueRetryDirective } = require('../src/queue/consumer');

const topic = 'codepilot-staging-jobs';

async function fixture(t, jobType = 'test-execution') {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codepilot-phase7-queue-'));
  const store = new Store(dataDir);
  const owner = await store.createUser(`owner-${Date.now()}-${Math.random()}@example.test`, 'Owner', 'StrongPass!123');
  const stranger = await store.createUser(`stranger-${Date.now()}-${Math.random()}@example.test`, 'Stranger', 'StrongPass!123');
  const project = await store.createProject('Queue contract', '', null, owner.id);
  const created = await store.createWorkflowJob({ projectId: project.id, actorId: owner.id, jobType, executionProfile: jobType === 'test-execution' ? 'node-test' : null, idempotencyKey: `phase7:${Date.now()}:${Math.random()}`, topic });
  const dispatcher = new OutboxDispatcher({ store, publisher: { async publish() { return { messageId: `msg-${created.job.id}` }; } } });
  await dispatcher.dispatch();
  t.after(async () => { await store.close(); fs.rmSync(dataDir, { recursive: true, force: true }); });
  return { store, owner, stranger, project, created, envelope: JSON.parse(created.outbox.payload), metadata: { messageId: `msg-${created.job.id}`, deliveryCount: 1, topicName: topic, consumerGroup: 'phase7-contract', region: 'iad1' } };
}

test('Vercel Queue consumer entry uses the Node callback contract and queue/v2beta trigger', async () => {
  const production = JSON.parse(fs.readFileSync(path.resolve('vercel.json'), 'utf8'));
  const staging = JSON.parse(fs.readFileSync(path.resolve('vercel.staging.json'), 'utf8'));
  for (const [manifest, expectedTopic] of [[production, 'codepilot-jobs'], [staging, topic]]) {
    const definition = manifest.functions['api/queue-consumer.js'];
    assert.equal(definition.maxDuration, 300);
    assert.deepEqual(definition.experimentalTriggers, [{ type: 'queue/v2beta', topic: expectedTopic, retryAfterSeconds: 60, initialDelaySeconds: 0 }]);
  }
  const source = fs.readFileSync(path.resolve('src/queue/consumer.js'), 'utf8');
  assert.match(source, /new QueueClient/);
  assert.match(source, /handleNodeCallback/);
  assert.doesNotMatch(source, /handleCallback\s*\(/);
});

test('consumer builder forwards provider metadata and remains release-blocked', async (t) => {
  const { store } = await fixture(t);
  let capturedOptions;
  let capturedMessage;
  const fakeConsumer = { async consume(message, metadata) { capturedMessage = { message, metadata }; } };
  const config = {
    isProduction: false, dataDir: '.', databaseUrl: null, database: {}, sessionSecret: 'x'.repeat(32),
    queue: { provider: 'vercel-queues', topic, region: 'iad1' },
    execution: { releaseVerified: false, mode: 'disabled', provider: 'disabled', commandTimeoutMs: 60_000 },
    limits: { maxFiles: 100, maxFileBytes: 1024, maxExtractedBytes: 4096 }
  };
  const handler = buildQueueConsumer(config, {
    store, consumer: fakeConsumer, queueClient: {},
    nodeCallbackFactory(callback, options) {
      capturedOptions = options;
      return async () => callback({ version: 1, jobId: 'execjob_00000000-0000-0000-0000-000000000000', outboxId: 'outbox_00000000-0000-0000-0000-000000000000' }, { messageId: 'provider-message', deliveryCount: 1, topicName: topic });
    }
  });
  assert.equal(handler.codepilot.executionEnabled, false);
  assert.equal(capturedOptions.visibilityTimeoutSeconds, 90);
  await handler();
  assert.equal(capturedMessage.metadata.messageId, 'provider-message');
});

test('schema and authenticated delivery metadata validation reject malformed input', () => {
  assert.throws(() => validateQueueEnvelope({ version: 1, jobId: 'x', outboxId: 'y' }), (error) => error instanceof NonRetryableQueueError && error.code === 'INVALID_IDENTIFIERS');
  assert.throws(() => validateQueueEnvelope({ version: 1, jobId: 'execjob_00000000-0000-0000-0000-000000000000', outboxId: 'outbox_00000000-0000-0000-0000-000000000000', extra: true }), /Invalid queue message envelope/);
  assert.throws(() => validateDeliveryMetadata({ messageId: 'm', deliveryCount: 1, topicName: 'other' }, topic), (error) => error.code === 'TOPIC_MISMATCH');
});

test('authorized delivery executes once, records audits, and duplicate delivery is idempotent', async (t) => {
  const { store, created, envelope, metadata } = await fixture(t);
  let executions = 0;
  const consumer = new JobConsumer({
    store, workerId: 'phase7-worker', expectedTopic: topic, requireMetadata: true, executionEnabled: true,
    orchestrator: { async execute(job, workerId) { executions += 1; return store.completeExecutionJob(job.id, workerId, { status: 'PASS', executed: true }, 'contract-provider', 'contract-run'); } }
  });
  assert.equal((await consumer.consume(envelope, metadata)).status, 'SUCCEEDED');
  assert.deepEqual(await consumer.consume(envelope, metadata), { duplicate: true, status: 'SUCCEEDED' });
  assert.equal(executions, 1);
  assert.ok(await store.get("SELECT id FROM audit_events WHERE action='queue.delivery_claimed' AND project_id=?", created.job.project_id));
  assert.ok(await store.get("SELECT id FROM operational_events WHERE event_type='queue.duplicate_delivery' AND project_id=?", created.job.project_id));
});

test('unauthorized project actor and tampered delivery ID are blocked without processing', async (t) => {
  const unauthorized = await fixture(t);
  await unauthorized.store.run('UPDATE execution_jobs SET actor_id=? WHERE id=?', unauthorized.stranger.id, unauthorized.created.job.id);
  let executions = 0;
  const consumer = new JobConsumer({ store: unauthorized.store, workerId: 'phase7-worker', expectedTopic: topic, requireMetadata: true, executionEnabled: true, orchestrator: { async execute() { executions += 1; } } });
  await assert.rejects(() => consumer.consume(unauthorized.envelope, unauthorized.metadata), (error) => error.code === 'JOB_OWNER_MISMATCH' && error.retryable === false);
  assert.equal((await unauthorized.store.get('SELECT status FROM execution_jobs WHERE id=?', unauthorized.created.job.id)).status, 'BLOCKED');
  assert.equal(executions, 0);

  const tampered = await fixture(t);
  const secondConsumer = new JobConsumer({ store: tampered.store, workerId: 'phase7-worker-2', expectedTopic: topic, requireMetadata: true, executionEnabled: true, orchestrator: { async execute() { executions += 1; } } });
  await assert.rejects(() => secondConsumer.consume(tampered.envelope, { ...tampered.metadata, messageId: 'wrong-provider-message' }), (error) => error.code === 'MESSAGE_ID_MISMATCH');
  assert.equal((await tampered.store.get('SELECT status FROM execution_jobs WHERE id=?', tampered.created.job.id)).status, 'BLOCKED');
  assert.equal(executions, 0);
});

test('unsupported durable job types are acknowledged as poison and reconciled to BLOCKED', async (t) => {
  const unsupported = await fixture(t, 'source-analysis');
  let executions = 0;
  const consumer = new JobConsumer({ store: unsupported.store, workerId: 'phase7-type-worker', expectedTopic: topic, requireMetadata: true, executionEnabled: true, orchestrator: { async execute() { executions += 1; } } });
  await assert.rejects(() => consumer.consume(unsupported.envelope, unsupported.metadata), (error) => error.code === 'UNSUPPORTED_JOB_TYPE' && error.retryable === false);
  const job = await unsupported.store.get('SELECT status, poisoned, error_message FROM execution_jobs WHERE id=?', unsupported.created.job.id);
  assert.equal(job.status, 'BLOCKED');
  assert.equal(Number(job.poisoned), 1);
  assert.match(job.error_message, /Unsupported consumer job type/);
  assert.equal(executions, 0);
});

test('release safeguard, cancellation, timeout, poison acknowledgment, and retry policy reconcile state', async (t) => {
  const blocked = await fixture(t);
  const releaseBlockedConsumer = new JobConsumer({ store: blocked.store, workerId: 'blocked-worker', expectedTopic: topic, requireMetadata: true, executionEnabled: false, orchestrator: null });
  await assert.rejects(() => releaseBlockedConsumer.consume(blocked.envelope, blocked.metadata), (error) => error.code === 'EXECUTION_RELEASE_BLOCKED' && error.retryable === false);
  assert.equal((await blocked.store.get('SELECT status FROM execution_jobs WHERE id=?', blocked.created.job.id)).status, 'BLOCKED');

  const cancelled = await fixture(t);
  await cancelled.store.cancelWorkflowJob(cancelled.created.job.id, cancelled.owner.id);
  const cancelledConsumer = new JobConsumer({ store: cancelled.store, workerId: 'cancel-worker', expectedTopic: topic, requireMetadata: true, executionEnabled: true, orchestrator: { async execute() { throw new Error('must not run'); } } });
  assert.deepEqual(await cancelledConsumer.consume(cancelled.envelope, cancelled.metadata), { duplicate: true, status: 'CANCELLED' });

  const timedOut = await fixture(t);
  const timeoutConsumer = new JobConsumer({
    store: timedOut.store, workerId: 'timeout-worker', expectedTopic: topic, requireMetadata: true, executionEnabled: true,
    orchestrator: { async execute(job, workerId) { await timedOut.store.failWorkflowJob(job.id, workerId, 'provider timeout', { timedOut: true }); throw Object.assign(new Error('provider timeout'), { name: 'TimeoutError' }); } }
  });
  await assert.rejects(() => timeoutConsumer.consume(timedOut.envelope, timedOut.metadata), /provider timeout/);
  assert.equal((await timedOut.store.get('SELECT status FROM execution_jobs WHERE id=?', timedOut.created.job.id)).status, 'TIMED_OUT');

  assert.deepEqual(queueRetryDirective(new NonRetryableQueueError('poison'), { deliveryCount: 1 }), { acknowledge: true });
  assert.deepEqual(queueRetryDirective(new Error('transient'), { deliveryCount: 1 }), { afterSeconds: 2 });
  assert.deepEqual(queueRetryDirective(new Error('transient'), { deliveryCount: 99 }), { afterSeconds: 32 });
});

