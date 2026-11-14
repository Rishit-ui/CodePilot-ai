const crypto = require('node:crypto');
const { issueSignedToken, presignUrl, head, get, del } = require('@vercel/blob');

function safeObjectKey(value) {
  return typeof value === 'string' && /^codepilot\/[A-Za-z0-9_-]+\/[A-Za-z0-9_.-]+$/.test(value) && !value.includes('..');
}

class VercelBlobStorage {
  constructor({ token, storeId, maxObjectBytes = 250 * 1024 * 1024 } = {}) {
    this.options = { token, storeId };
    this.maxObjectBytes = maxObjectBytes;
  }

  async authorizeUpload({ objectKey, contentType, sizeBytes, ttlMs = 10 * 60 * 1000 }) {
    if (!safeObjectKey(objectKey) || sizeBytes < 1 || sizeBytes > this.maxObjectBytes) throw new Error('Invalid private object upload request.');
    const validUntil = Date.now() + Math.min(ttlMs, 15 * 60 * 1000);
    const token = await issueSignedToken({ pathname: objectKey, operations: ['put'], validUntil, allowedContentTypes: [contentType], maximumSizeInBytes: sizeBytes, ...this.options });
    const { presignedUrl } = await presignUrl(token, { operation: 'put', pathname: objectKey, access: 'private', validUntil, allowedContentTypes: [contentType], maximumSizeInBytes: sizeBytes, allowOverwrite: false });
    return { presignedUrl, validUntil };
  }

  async verifyObject(objectKey, expectedMaxBytes = this.maxObjectBytes) {
    if (!safeObjectKey(objectKey)) throw new Error('Invalid private object key.');
    const metadata = await head(objectKey, this.options);
    if (metadata.size > expectedMaxBytes) throw new Error('Stored object exceeds its authorized maximum.');
    const response = await get(objectKey, { access: 'private', useCache: false, ...this.options });
    if (!response || response.statusCode !== 200) throw new Error('Private object is unavailable.');
    const hash = crypto.createHash('sha256');
    const reader = response.stream.getReader();
    let size = 0;
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > expectedMaxBytes) { await reader.cancel(); throw new Error('Stored object exceeded its authorized maximum while hashing.'); }
      hash.update(value);
    }
    return { size, sha256: hash.digest('hex'), etag: response.blob.etag, contentType: response.blob.contentType };
  }

  async authorizeDownload(objectKey, ttlMs = 5 * 60 * 1000) {
    if (!safeObjectKey(objectKey)) throw new Error('Invalid private object key.');
    const validUntil = Date.now() + Math.min(ttlMs, 15 * 60 * 1000);
    const token = await issueSignedToken({ pathname: objectKey, operations: ['get'], validUntil, ...this.options });
    const { presignedUrl } = await presignUrl(token, { operation: 'get', pathname: objectKey, access: 'private', validUntil, useCache: false });
    return { presignedUrl, validUntil };
  }

  async deleteObject(objectKey) {
    if (!safeObjectKey(objectKey)) throw new Error('Invalid private object key.');
    await del(objectKey, this.options);
  }
}

async function cleanupAbandonedUploads({ store, storage, limit = 100, timestamp = new Date().toISOString() }) {
  const rows = await store.expiredUploadIntents(timestamp, limit);
  const results = [];
  for (const row of rows) {
    try {
      await storage.deleteObject(row.object_key);
      await store.markUploadIntentAbandoned(row.id, 'Expired upload authorization; private object deleted if present.');
      results.push({ intentId: row.id, status: 'DELETED' });
    } catch (error) {
      await store.recordOperationalEvent('storage.cleanup_failed', 'warning', row.project_id, null, `upload=${row.id}`);
      results.push({ intentId: row.id, status: 'RETRY_REQUIRED' });
    }
  }
  return results;
}

async function cleanupExpiredArtifacts({ store, storage, limit = 100, timestamp = new Date().toISOString() }) {
  const rows = await store.expiredJobArtifacts(timestamp, limit);
  const results = [];
  for (const row of rows) {
    try {
      await storage.deleteObject(row.object_key);
      await store.deleteJobArtifactRecord(row.id);
      await store.recordOperationalEvent('storage.artifact_expired', 'info', row.project_id, null, `artifact=${row.id}`);
      results.push({ artifactId: row.id, status: 'DELETED' });
    } catch {
      await store.recordOperationalEvent('storage.cleanup_failed', 'warning', row.project_id, null, `artifact=${row.id}`);
      results.push({ artifactId: row.id, status: 'RETRY_REQUIRED' });
    }
  }
  return results;
}

module.exports = { VercelBlobStorage, safeObjectKey, cleanupAbandonedUploads, cleanupExpiredArtifacts };
