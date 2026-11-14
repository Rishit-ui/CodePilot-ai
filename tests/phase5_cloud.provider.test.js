const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { VercelQueuePublisher } = require('../src/queue/vercel_queue');
const { VercelBlobStorage } = require('../src/storage/vercel_blob');

test('real Vercel Queue publication requires explicit opt-in and provider authorization', { skip: process.env.TEST_VERCEL_QUEUE !== '1' }, async () => {
  assert.ok(process.env.CODEPILOT_QUEUE_TOPIC, 'CODEPILOT_QUEUE_TOPIC is required.');
  const suffix = crypto.randomUUID();
  const result = await new VercelQueuePublisher({ region: process.env.CODEPILOT_QUEUE_REGION || 'iad1' }).publish({
    topic: process.env.CODEPILOT_QUEUE_TOPIC,
    payload: JSON.stringify({ version: 1, jobId: `provider-smoke-${suffix}`, outboxId: `provider-smoke-${suffix}` }),
    idempotency_key: `provider-smoke-${suffix}`
  });
  assert.ok(result.messageId, 'Provider did not return a queue message ID.');
});

test('real private Vercel Blob verification requires explicit opt-in and a test object', { skip: process.env.TEST_VERCEL_BLOB !== '1' }, async () => {
  assert.ok(process.env.BLOB_READ_WRITE_TOKEN, 'BLOB_READ_WRITE_TOKEN is required.');
  assert.ok(process.env.TEST_BLOB_OBJECT_KEY, 'TEST_BLOB_OBJECT_KEY is required.');
  const storage = new VercelBlobStorage({ token: process.env.BLOB_READ_WRITE_TOKEN });
  const verified = await storage.verifyObject(process.env.TEST_BLOB_OBJECT_KEY);
  assert.ok(verified.size > 0);
  assert.match(verified.sha256, /^[a-f0-9]{64}$/);
  if (process.env.TEST_BLOB_SHA256) assert.equal(verified.sha256, process.env.TEST_BLOB_SHA256);
});
