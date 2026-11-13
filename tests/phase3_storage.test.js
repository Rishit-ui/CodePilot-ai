const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { Store } = require('../src/db');
const { safeObjectKey } = require('../src/storage/vercel_blob');

test('private upload metadata enforces owner, size, hash, and artifact ownership', async (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codepilot-phase3-storage-'));
  const store = new Store(dataDir);
  t.after(async () => { await store.close(); fs.rmSync(dataDir, { recursive: true, force: true }); });
  const owner = await store.createUser('storage-owner@example.com', 'Owner', 'StrongPass!123');
  const stranger = await store.createUser('storage-stranger@example.com', 'Stranger', 'StrongPass!123');
  const project = await store.createProject('Storage', '', null, owner.id);
  const bytes = Buffer.from('verified archive bytes');
  const sha256 = crypto.createHash('sha256').update(bytes).digest('hex');
  const objectKey = `codepilot/${owner.id}/archive.zip`;
  assert.equal(safeObjectKey(objectKey), true);
  assert.equal(safeObjectKey(`codepilot/${owner.id}/../secret.zip`), false);
  const intent = await store.createUploadIntent({ projectId: project.id, ownerId: owner.id, objectKey, expectedSize: bytes.length, expectedSha256: sha256, contentType: 'application/zip' });
  assert.equal(await store.getUploadIntentForUser(intent.id, stranger), null);
  const rejected = await store.completeUploadIntent(intent.id, owner.id, { size: bytes.length, sha256: '0'.repeat(64), etag: 'bad' });
  assert.equal(rejected.status, 'REJECTED');

  const verifiedIntent = await store.createUploadIntent({ projectId: project.id, ownerId: owner.id, objectKey: `codepilot/${owner.id}/verified.zip`, expectedSize: bytes.length, expectedSha256: sha256, contentType: 'application/zip' });
  const verified = await store.completeUploadIntent(verifiedIntent.id, owner.id, { size: bytes.length, sha256, etag: 'etag-1' });
  assert.equal(verified.status, 'VERIFIED');
  const job = await store.createWorkflowJob({ projectId: project.id, actorId: owner.id, jobType: 'repository-ingestion', idempotencyKey: 'ingest:storage-test', topic: 'jobs' });
  const artifact = await store.createJobArtifact({ jobId: job.job.id, projectId: project.id, ownerId: owner.id, kind: 'report', objectKey: `codepilot/${owner.id}/report.json`, contentType: 'application/json', sizeBytes: 2, sha256: crypto.createHash('sha256').update('{}').digest('hex') });
  assert.equal(await store.getArtifactForUser(artifact.id, stranger), null);
  assert.equal((await store.getArtifactForUser(artifact.id, owner)).id, artifact.id);
});
