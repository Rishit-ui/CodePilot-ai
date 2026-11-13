const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Store } = require('../src/db');

test('durable execution jobs retry with bounds and support owner cancellation', async (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codepilot-queue-'));
  const store = new Store(dataDir);
  t.after(async () => { await store.close(); fs.rmSync(dataDir, { recursive: true, force: true }); });
  const user = await store.createUser('queue@example.com', 'Queue Owner', 'StrongPass!123');
  const project = await store.createProject('Queue Project', '', null, user.id);
  const job = await store.enqueueExecutionJob(project.id, user.id, 'test-execution', { revisionId: 'rev' }, 2);
  assert.equal(job.status, 'PENDING');
  const retry = await store.recordExecutionFailure(job.id, 'worker unavailable', 1);
  assert.equal(retry.status, 'PENDING');
  assert.equal(Number(retry.attempts), 1);
  const failed = await store.recordExecutionFailure(job.id, 'worker unavailable', 1);
  assert.equal(failed.status, 'FAILED');
  assert.equal(Number(failed.attempts), 2);
  const cancellable = await store.enqueueExecutionJob(project.id, user.id, 'analysis', {}, 3);
  assert.equal(await store.requestExecutionCancellation(cancellable.id, 'different-user'), null);
  const cancelled = await store.requestExecutionCancellation(cancellable.id, user.id);
  assert.equal(cancelled.status, 'CANCELLED');
  assert.equal(Number(cancelled.cancel_requested), 1);
});
