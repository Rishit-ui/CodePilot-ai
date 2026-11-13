const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { createApp } = require('../src/server');

function request(server, method, pathname, token, body, extraHeaders = {}) {
  return new Promise((resolve, reject) => {
    const encoded = body === undefined ? null : Buffer.from(JSON.stringify(body));
    const req = http.request({ host: '127.0.0.1', port: server.address().port, method, path: pathname, headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}), ...(encoded ? { 'content-type': 'application/json', 'content-length': encoded.length } : {}), ...extraHeaders
    } }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(Buffer.concat(chunks).toString() || '{}') }));
    });
    req.on('error', reject);
    if (encoded) req.write(encoded);
    req.end();
  });
}

test('Phase 3 APIs keep execution release-blocked and enforce job/upload ownership', async (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codepilot-phase3-api-'));
  let verifiedObject = null;
  const app = createApp({
    config: {
      dataDir, databaseUrl: null, sessionSecret: 'phase3-api-secret-value-over-32-characters', authEnabled: true,
      isProduction: false, isVercel: false, database: {}, rateLimit: { enabled: false, policies: {} },
      execution: { mode: 'disabled', releaseVerified: false, provider: 'disabled' },
      queue: { provider: 'vercel-queues', topic: 'phase3-jobs', region: 'iad1' },
      storage: { provider: 'vercel-blob', maxObjectBytes: 1024 * 1024, uploadTtlMs: 600000, artifactRetentionDays: 7 },
      quotas: { jobsPerHour: 20, concurrentJobs: 10, storageBytesPerUser: 1024 * 1024 },
      ai: { provider: 'local' }, deployment: { allowedProviders: [] }, limits: { maxQuestionChars: 2000, maxUploadBytes: 1024 * 1024 }
    },
    queuePublisher: { async publish(outbox) { return { messageId: `message-${outbox.id}` }; } },
    objectStorage: {
      async authorizeUpload({ objectKey }) { return { presignedUrl: `https://private.invalid/${objectKey}`, validUntil: Date.now() + 600000 }; },
      async verifyObject() { return verifiedObject; },
      async authorizeDownload(objectKey) { return { presignedUrl: `https://private.invalid/${objectKey}?signed=1`, validUntil: Date.now() + 60000 }; }
    }
  });
  await new Promise((resolve) => app.server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { app.server.close(); await app.store.close(); fs.rmSync(dataDir, { recursive: true, force: true }); });
  const owner = await app.store.createUser('phase3-owner@example.com', 'Owner', 'StrongPass!123');
  const stranger = await app.store.createUser('phase3-stranger@example.com', 'Stranger', 'StrongPass!123');
  const administrator = await app.store.createUser('phase3-admin@example.com', 'Admin', 'StrongPass!123', 1);
  const ownerSession = await app.store.createSession(owner.id);
  const strangerSession = await app.store.createSession(stranger.id);
  const adminSession = await app.store.createSession(administrator.id);
  const project = await app.store.createProject('Phase 3', '', null, owner.id);

  const blocked = await request(app.server, 'POST', `/api/projects/${project.id}/jobs`, ownerSession.token, { jobType: 'test-execution', executionProfile: 'node-test', idempotencyKey: 'test:release-blocked' });
  assert.equal(blocked.status, 503);
  assert.equal(blocked.body.error.code, 'EXECUTION_RELEASE_BLOCKED');

  const created = await request(app.server, 'POST', `/api/projects/${project.id}/jobs`, ownerSession.token, { jobType: 'source-analysis', idempotencyKey: 'analysis:phase3-api' });
  assert.equal(created.status, 202);
  assert.equal(created.body.job.status, 'DISPATCHED');
  const duplicate = await request(app.server, 'POST', `/api/projects/${project.id}/jobs`, ownerSession.token, { jobType: 'source-analysis', idempotencyKey: 'analysis:phase3-api' });
  assert.equal(duplicate.status, 200);
  assert.equal(duplicate.body.duplicate, true);
  assert.equal((await request(app.server, 'GET', `/api/jobs/${created.body.job.id}`, strangerSession.token)).status, 404);
  assert.equal((await request(app.server, 'GET', `/api/jobs/${created.body.job.id}`, ownerSession.token)).status, 200);
  assert.equal((await request(app.server, 'GET', '/api/operations/metrics', ownerSession.token)).status, 403);
  const metrics = await request(app.server, 'GET', '/api/operations/metrics', adminSession.token);
  assert.equal(metrics.status, 200);
  assert.ok(Array.isArray(metrics.body.metrics.jobs));

  const content = Buffer.from('zip bytes supplied directly to private storage');
  const sha256 = crypto.createHash('sha256').update(content).digest('hex');
  verifiedObject = { size: content.length, sha256, etag: 'etag-private', contentType: 'application/zip' };
  const authorized = await request(app.server, 'POST', `/api/projects/${project.id}/uploads/authorize`, ownerSession.token, { sizeBytes: content.length, sha256, contentType: 'application/zip' });
  assert.equal(authorized.status, 201);
  assert.equal((await request(app.server, 'POST', `/api/projects/${project.id}/uploads/${authorized.body.intent.id}/complete`, strangerSession.token)).status, 404);
  const completed = await request(app.server, 'POST', `/api/projects/${project.id}/uploads/${authorized.body.intent.id}/complete`, ownerSession.token);
  assert.equal(completed.status, 202);
  assert.equal(completed.body.upload.status, 'VERIFIED');
  assert.equal(completed.body.job.job_type, 'repository-ingestion');
});
