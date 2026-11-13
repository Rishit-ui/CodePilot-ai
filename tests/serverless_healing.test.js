const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createApp } = require('../src/server');
const { Store } = require('../src/db');
const { makeZip } = require('./helpers');

test('Serverless rejects non-existent project identifiers without creating data', async (t) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codepilot-healing-'));
  const store = new Store(tmpDir);

  t.after(async () => {
    store.close();
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {}
  });

  const app = createApp({
    store,
    config: {
      authEnabled: false,
      limits: {
        maxUploadBytes: 10 * 1024 * 1024,
        maxRemoteDownloadBytes: 100 * 1024 * 1024,
        maxExtractedBytes: 20 * 1024 * 1024,
        maxFiles: 1000,
        maxFileBytes: 2 * 1024 * 1024,
        maxCompressionRatio: 100
      }
    }
  });

  // A random projectId from another ephemeral container
  const foreignProjectId = 'project_coldstart123';

  // Direct ZIP import with an unowned/non-existent ID must not create a project.
  const zipBuf = makeZip([{ name: 'app.js', content: 'console.log("auto healed");' }]);
  
  const mockReq = {
    method: 'POST',
    url: `/api/projects/${foreignProjectId}/import`,
    headers: { 'content-type': 'application/zip' },
    on: function(event, handler) {
      if (event === 'data') handler(zipBuf);
      if (event === 'end') setImmediate(handler);
      return this;
    }
  };

  let statusCode = 0;
  let responseBody = '';
  const mockRes = {
    writeHead: (code, headers) => { statusCode = code; },
    setHeader: () => {},
    end: (chunk) => { if (chunk) responseBody += chunk; }
  };

  await app.handler(mockReq, mockRes);
  assert.equal(statusCode, 404, `Expected 404 but got ${statusCode}: ${responseBody}`);
  const parsed = JSON.parse(responseBody);
  assert.equal(parsed.error?.code, 'PROJECT_NOT_FOUND');

  const projectInDb = await store.project(foreignProjectId);
  assert.equal(projectInDb, null, 'Rejected project identifiers must not create database rows');
});
