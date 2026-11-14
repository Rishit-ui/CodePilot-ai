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

test('real private Vercel Blob upload, SHA-256, download, and deletion require explicit opt-in', { skip: process.env.TEST_VERCEL_BLOB !== '1' }, async () => {
  assert.ok(process.env.BLOB_READ_WRITE_TOKEN, 'BLOB_READ_WRITE_TOKEN is required.');
  const storage = new VercelBlobStorage({ token: process.env.BLOB_READ_WRITE_TOKEN });
  const body = Buffer.from(`codepilot-phase6-private-object:${crypto.randomUUID()}`);
  const objectKey = `codepilot/phase6-${crypto.randomUUID()}/provider-test.bin`;
  const expectedSha256 = crypto.createHash('sha256').update(body).digest('hex');
  try {
    const upload = await storage.authorizeUpload({ objectKey, contentType: 'application/octet-stream', sizeBytes: body.length });
    const uploadResponse = await fetch(upload.presignedUrl, { method: 'PUT', headers: { 'content-type': 'application/octet-stream' }, body });
    assert.ok(uploadResponse.ok, `Private upload failed with HTTP ${uploadResponse.status}.`);
    const verified = await storage.verifyObject(objectKey, body.length);
    assert.equal(verified.size, body.length);
    assert.equal(verified.sha256, expectedSha256);
    const download = await storage.authorizeDownload(objectKey);
    const downloadResponse = await fetch(download.presignedUrl);
    assert.ok(downloadResponse.ok, `Private download failed with HTTP ${downloadResponse.status}.`);
    assert.deepEqual(Buffer.from(await downloadResponse.arrayBuffer()), body);
  } finally {
    await storage.deleteObject(objectKey).catch(() => {});
  }
});
