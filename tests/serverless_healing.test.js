const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createApp } = require('../src/server');
const { Store } = require('../src/db');
const { makeZip } = require('./helpers');

test('Serverless auto-heals non-existent project on cold start container during import-url or revision requests', async (t) => {
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

  // 1. Direct ZIP import with non-existent project ID auto-heals
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
  assert.equal(statusCode, 201, `Expected 201 Created but got ${statusCode}: ${responseBody}`);

  const parsed = JSON.parse(responseBody);
  assert.ok(parsed.revision?.id);

  // 2. The project was auto-healed in the database
  const projectInDb = await store.project(foreignProjectId);
  assert.ok(projectInDb, 'Project should exist in DB after auto-healing');
  assert.equal(projectInDb.id, foreignProjectId);
});
