const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createApp } = require('../src/server');
const { Store } = require('../src/db');
const { makeZip } = require('./helpers');

test('Impact Engine REST API Lifecycle: graph, analyze, select-tests, run-tests, history', async (t) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codepilot-impact-api-test-'));
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
        maxCompressionRatio: 100,
        commandTimeoutMs: 15000
      }
    }
  });

  const project = await store.createProject('Impact Test Project');
  const zipBuf = makeZip([
    {
      name: 'src/calc.js',
      content: 'function multiply(a, b) { return a * b; }\nmodule.exports = { multiply };'
    },
    {
      name: 'tests/calc.test.js',
      content: 'const calc = require("../src/calc");\ntest("multiplies numbers", () => { assert.equal(calc.multiply(3, 4), 12); });'
    }
  ]);

  // 1. Ingest Revision
  const importReq = {
    method: 'POST',
    url: `/api/projects/${project.id}/import`,
    headers: { 'content-type': 'application/zip' },
    on: function(event, handler) {
      if (event === 'data') handler(zipBuf);
      if (event === 'end') setImmediate(handler);
      return this;
    }
  };

  let importResBody = '';
  const importRes = {
    writeHead: () => {},
    setHeader: () => {},
    end: (chunk) => { if (chunk) importResBody += chunk; }
  };

  await app.handler(importReq, importRes);
  const imported = JSON.parse(importResBody);
  assert.ok(imported.revision?.id);

  // 2. GET /api/projects/:id/impact/graph
  const graphReq = {
    method: 'GET',
    url: `/api/projects/${project.id}/impact/graph`,
    headers: {},
    on: function(event, handler) {
      if (event === 'end') setImmediate(handler);
      return this;
    }
  };
  let graphResBody = '';
  const graphRes = {
    writeHead: (code) => { assert.equal(code, 200); },
    setHeader: () => {},
    end: (chunk) => { if (chunk) graphResBody += chunk; }
  };
  await app.handler(graphReq, graphRes);
  const graphData = JSON.parse(graphResBody);
  assert.ok(graphData.graph?.nodes);
  assert.ok(graphData.graph?.edges);
  assert.equal(graphData.graph.metrics.nodeCount >= 3, true);

  // 3. POST /api/projects/:id/impact/analyze
  const analyzePayload = Buffer.from(JSON.stringify({ changedFiles: ['src/calc.js'] }));
  const analyzeReq = {
    method: 'POST',
    url: `/api/projects/${project.id}/impact/analyze`,
    headers: { 'content-type': 'application/json' },
    on: function(event, handler) {
      if (event === 'data') handler(analyzePayload);
      if (event === 'end') setImmediate(handler);
      return this;
    }
  };
  let analyzeResBody = '';
  const analyzeRes = {
    writeHead: (code) => { assert.equal(code, 200); },
    setHeader: () => {},
    end: (chunk) => { if (chunk) analyzeResBody += chunk; }
  };
  await app.handler(analyzeReq, analyzeRes);
  const analyzeData = JSON.parse(analyzeResBody);
  assert.ok(analyzeData.impact?.directImpacts.some((d) => d.id === 'file:src/calc.js'));

  // 4. POST /api/projects/:id/impact/select-tests
  const selectPayload = Buffer.from(JSON.stringify({
    changedFiles: ['src/calc.js'],
    strategy: 'evidence-aware'
  }));
  const selectReq = {
    method: 'POST',
    url: `/api/projects/${project.id}/impact/select-tests`,
    headers: { 'content-type': 'application/json' },
    on: function(event, handler) {
      if (event === 'data') handler(selectPayload);
      if (event === 'end') setImmediate(handler);
      return this;
    }
  };
  let selectResBody = '';
  const selectRes = {
    writeHead: (code) => { assert.equal(code, 200); },
    setHeader: () => {},
    end: (chunk) => { if (chunk) selectResBody += chunk; }
  };
  await app.handler(selectReq, selectRes);
  const selectData = JSON.parse(selectResBody);
  assert.equal(selectData.selection?.strategy, 'evidence-aware');
  assert.ok(selectData.selection?.selectedTestFiles.includes('tests/calc.test.js'));

  // 5. POST /api/projects/:id/impact/run-tests
  const runPayload = Buffer.from(JSON.stringify({
    changedFiles: ['src/calc.js'],
    strategy: 'evidence-aware'
  }));
  const runReq = {
    method: 'POST',
    url: `/api/projects/${project.id}/impact/run-tests`,
    headers: { 'content-type': 'application/json' },
    on: function(event, handler) {
      if (event === 'data') handler(runPayload);
      if (event === 'end') setImmediate(handler);
      return this;
    }
  };
  let runResBody = '';
  const runRes = {
    writeHead: (code) => { assert.equal(code, 200); },
    setHeader: () => {},
    end: (chunk) => { if (chunk) runResBody += chunk; }
  };
  await app.handler(runReq, runRes);
  const runData = JSON.parse(runResBody);
  assert.ok(runData.selection);
  assert.ok(runData.execution);

  // 6. GET /api/projects/:id/impact/history
  const historyReq = {
    method: 'GET',
    url: `/api/projects/${project.id}/impact/history`,
    headers: {},
    on: function(event, handler) {
      if (event === 'end') setImmediate(handler);
      return this;
    }
  };
  let historyResBody = '';
  const historyRes = {
    writeHead: (code) => { assert.equal(code, 200); },
    setHeader: () => {},
    end: (chunk) => { if (chunk) historyResBody += chunk; }
  };
  await app.handler(historyReq, historyRes);
  const historyData = JSON.parse(historyResBody);
  assert.ok(Array.isArray(historyData.history));
  assert.ok(historyData.history.length >= 1);
});
