const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { dispatchAI } = require('../src/ai_provider');
const { cleanupAbandonedUploads, cleanupExpiredArtifacts } = require('../src/storage/vercel_blob');
const { Store } = require('../src/db');
const { queueRetryDirective } = require('../src/queue/consumer');

async function localProvider(t, handler) {
  const server = http.createServer(handler);
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  t.after(() => new Promise((resolve) => server.close(resolve)));
  return `http://127.0.0.1:${server.address().port}`;
}

test('AI transport retries transient failures, validates each provider shape, and bounds attempts', async (t) => {
  const calls = { openai: 0, anthropic: 0, gemini: 0 };
  const origin = await localProvider(t, (request, response) => {
    const provider = request.url.startsWith('/openai') ? 'openai' : request.url.startsWith('/anthropic') ? 'anthropic' : 'gemini';
    calls[provider] += 1;
    request.resume();
    if (provider === 'openai' && calls.openai === 1) {
      response.writeHead(429, { 'content-type': 'application/json', 'retry-after': '0' });
      response.end(JSON.stringify({ error: { message: 'transient' } }));
      return;
    }
    response.setHeader('content-type', 'application/json');
    if (provider === 'openai') response.end(JSON.stringify({ choices: [{ message: { content: 'openai-ok' } }] }));
    else if (provider === 'anthropic') response.end(JSON.stringify({ content: [{ type: 'text', text: 'anthropic-ok' }] }));
    else response.end(JSON.stringify({ candidates: [{ content: { parts: [{ text: 'gemini-ok' }] } }] }));
  });

  const common = { apiKey: 'test-key-never-logged', maxRetries: 2, timeoutMs: 1000 };
  assert.equal(await dispatchAI({ ...common, provider: 'openai', baseUrl: `${origin}/openai`, model: 'test' }, 'system', 'user'), 'openai-ok');
  assert.equal(await dispatchAI({ ...common, provider: 'anthropic', baseUrl: `${origin}/anthropic`, model: 'test' }, 'system', 'user'), 'anthropic-ok');
  assert.equal(await dispatchAI({ ...common, provider: 'gemini', baseUrl: `${origin}/gemini`, model: 'test' }, 'system', 'user'), 'gemini-ok');
  assert.deepEqual(calls, { openai: 2, anthropic: 1, gemini: 1 });
});

test('AI transport does not retry authentication failures or expose provider error bodies', async (t) => {
  let calls = 0;
  const secret = 'provider-secret-must-not-escape';
  const origin = await localProvider(t, (request, response) => {
    calls += 1;
    request.resume();
    response.writeHead(401, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ error: { message: `invalid credential ${secret}` } }));
  });
  await assert.rejects(
    dispatchAI({ provider: 'openai', apiKey: secret, baseUrl: origin, model: 'test', maxRetries: 3, timeoutMs: 1000 }, 'system', 'user'),
    (error) => error.status === 401 && !error.message.includes(secret)
  );
  assert.equal(calls, 1);
});

test('AI transport rejects malformed responses and enforces a timeout', async (t) => {
  const malformed = await localProvider(t, (request, response) => { request.resume(); response.end('{not-json'); });
  await assert.rejects(
    dispatchAI({ provider: 'openai', apiKey: 'test', baseUrl: malformed, model: 'test', maxRetries: 0, timeoutMs: 1000 }, 'system', 'user'),
    /malformed JSON/
  );

  const slow = await localProvider(t, (request, response) => { request.resume(); setTimeout(() => response.end('{}'), 1000); });
  await assert.rejects(
    dispatchAI({ provider: 'openai', apiKey: 'test', baseUrl: slow, model: 'test', maxRetries: 0, timeoutMs: 250 }, 'system', 'user'),
    /timed out/
  );
});

test('expired upload cleanup deletes only provider objects tied to expired authorized intents', async (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codepilot-phase5-storage-'));
  const store = new Store(dataDir);
  t.after(async () => { await store.close(); fs.rmSync(dataDir, { recursive: true, force: true }); });
  const owner = await store.createUser('phase5-storage@example.com', 'Owner', 'StrongPass!123');
  const project = await store.createProject('Cleanup', '', null, owner.id);
  const expired = await store.createUploadIntent({
    projectId: project.id, ownerId: owner.id, objectKey: `codepilot/${owner.id}/expired.zip`,
    expectedSize: 10, expectedSha256: 'a'.repeat(64), contentType: 'application/zip', ttlMs: 60_000
  });
  const active = await store.createUploadIntent({
    projectId: project.id, ownerId: owner.id, objectKey: `codepilot/${owner.id}/active.zip`,
    expectedSize: 10, expectedSha256: 'b'.repeat(64), contentType: 'application/zip', ttlMs: 60_000
  });
  await store.run("UPDATE upload_intents SET expires_at='2000-01-01T00:00:00.000Z' WHERE id=?", expired.id);
  const deleted = [];
  const result = await cleanupAbandonedUploads({ store, storage: { async deleteObject(key) { deleted.push(key); } } });
  assert.deepEqual(result, [{ intentId: expired.id, status: 'DELETED' }]);
  assert.deepEqual(deleted, [expired.object_key]);
  assert.equal((await store.get('SELECT status FROM upload_intents WHERE id=?', expired.id)).status, 'ABANDONED');
  assert.equal((await store.get('SELECT status FROM upload_intents WHERE id=?', active.id)).status, 'AUTHORIZED');
});

test('artifact retention cleanup deletes expired provider objects and preserves active artifacts', async (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codepilot-phase5-artifacts-'));
  const store = new Store(dataDir);
  t.after(async () => { await store.close(); fs.rmSync(dataDir, { recursive: true, force: true }); });
  const owner = await store.createUser('phase5-artifact@example.com', 'Owner', 'StrongPass!123');
  const project = await store.createProject('Retention', '', null, owner.id);
  const created = await store.createWorkflowJob({ projectId: project.id, actorId: owner.id, jobType: 'artifact-test', idempotencyKey: 'artifact:test:phase5' });
  const expired = await store.createJobArtifact({ jobId: created.job.id, projectId: project.id, ownerId: owner.id, kind: 'log', objectKey: `codepilot/${owner.id}/expired.log`, sizeBytes: 1, sha256: 'a'.repeat(64), expiresAt: '2000-01-01T00:00:00.000Z' });
  const active = await store.createJobArtifact({ jobId: created.job.id, projectId: project.id, ownerId: owner.id, kind: 'log', objectKey: `codepilot/${owner.id}/active.log`, sizeBytes: 1, sha256: 'b'.repeat(64), expiresAt: '2999-01-01T00:00:00.000Z' });
  const deleted = [];
  const result = await cleanupExpiredArtifacts({ store, storage: { async deleteObject(key) { deleted.push(key); } } });
  assert.deepEqual(result, [{ artifactId: expired.id, status: 'DELETED' }]);
  assert.deepEqual(deleted, [expired.object_key]);
  assert.equal(await store.get('SELECT id FROM job_artifacts WHERE id=?', expired.id), null);
  assert.equal((await store.get('SELECT id FROM job_artifacts WHERE id=?', active.id)).id, active.id);
});

test('queue retry policy acknowledges poison envelopes and bounds transient backoff', () => {
  assert.deepEqual(queueRetryDirective({ retryable: false }, { deliveryCount: 1 }), { acknowledge: true });
  assert.deepEqual(queueRetryDirective(new Error('temporary'), { deliveryCount: 1 }), { afterSeconds: 2 });
  assert.deepEqual(queueRetryDirective(new Error('temporary'), { deliveryCount: 99 }), { afterSeconds: 32 });
});

test('real AI provider connectivity requires explicit opt-in and credentials', { skip: process.env.TEST_EXTERNAL_AI !== '1' }, async () => {
  assert.ok(process.env.CODEPILOT_AI_API_KEY, 'CODEPILOT_AI_API_KEY is required.');
  assert.ok(process.env.CODEPILOT_AI_PROVIDER, 'CODEPILOT_AI_PROVIDER is required.');
  assert.ok(process.env.CODEPILOT_AI_MODEL, 'CODEPILOT_AI_MODEL is required.');
  const reply = await dispatchAI({
    provider: process.env.CODEPILOT_AI_PROVIDER,
    apiKey: process.env.CODEPILOT_AI_API_KEY,
    model: process.env.CODEPILOT_AI_MODEL,
    baseUrl: process.env.CODEPILOT_AI_BASE_URL || '',
    timeoutMs: 25_000,
    maxRetries: 1
  }, 'Reply with exactly: CODEPILOT_PROVIDER_OK', 'Connectivity check.');
  assert.match(reply, /CODEPILOT_PROVIDER_OK/);
});
