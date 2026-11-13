const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { createApp } = require('../src/server');

function request(server, method, requestPath, token, body) {
  return new Promise((resolve, reject) => {
    const headers = {};
    if (token) headers.Authorization = `Bearer ${token}`;
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    const req = http.request({ host: '127.0.0.1', port: server.address().port, method, path: requestPath, headers }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(Buffer.concat(chunks).toString('utf8')) }));
    });
    req.on('error', reject);
    if (body !== undefined) req.end(JSON.stringify(body)); else req.end();
  });
}

const configFor = (dataDir, overrides = {}) => ({
  env: 'test', isProduction: false, isVercel: false, host: '127.0.0.1', port: 0,
  dataDir, databaseUrl: null, sessionSecret: 'security-test-secret-with-more-than-32-characters', authEnabled: true,
  ai: { provider: 'local', apiKey: '', model: 'local', baseUrl: '' },
  deployment: { allowedProviders: ['mock'], renderApiKey: '', vercelToken: '', flyApiToken: '' },
  limits: { maxUploadBytes: 1024 * 1024, maxRemoteDownloadBytes: 1024 * 1024, maxExtractedBytes: 1024 * 1024, maxFiles: 100, maxFileBytes: 100000, maxCompressionRatio: 100, maxQuestionChars: 2000, maxSearchResults: 100, commandTimeoutMs: 10000 },
  ...overrides
});

async function register(server, email, name) {
  const result = await request(server, 'POST', '/api/auth/register', null, { email, name, password: 'StrongPass!123' });
  assert.equal(result.status, 201);
  return result.body;
}

test('central auth rejects anonymous and invalid sessions while allowing authenticated requests', async (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codepilot-auth-'));
  const app = createApp({ config: configFor(dataDir) });
  await new Promise((resolve) => app.server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { app.server.close(); await app.store.close(); fs.rmSync(dataDir, { recursive: true, force: true }); });
  assert.equal((await request(app.server, 'GET', '/api/health')).status, 200);
  assert.equal((await request(app.server, 'GET', '/api/projects')).status, 401);
  assert.equal((await request(app.server, 'GET', '/api/projects', 'invalid-session')).status, 401);
  const alice = await register(app.server, 'alice@example.com', 'Alice');
  assert.equal((await request(app.server, 'GET', '/api/projects', alice.token)).status, 200);
});

test('project ownership and nested resource ownership prevent cross-user access', async (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codepilot-owner-'));
  const app = createApp({ config: configFor(dataDir) });
  await new Promise((resolve) => app.server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { app.server.close(); await app.store.close(); fs.rmSync(dataDir, { recursive: true, force: true }); });
  const alice = await register(app.server, 'alice.owner@example.com', 'Alice');
  const bob = await register(app.server, 'bob.viewer@example.com', 'Bob');
  const created = await request(app.server, 'POST', '/api/projects', alice.token, { name: 'Alice Project' });
  assert.equal(created.status, 201);
  const projectId = created.body.project.id;
  assert.equal((await request(app.server, 'GET', `/api/projects/${projectId}`, alice.token)).status, 200);
  assert.equal((await request(app.server, 'GET', `/api/projects/${projectId}`, bob.token)).status, 404);
  assert.equal((await request(app.server, 'DELETE', `/api/projects/${projectId}`, bob.token)).status, 404);
  const bobProjects = await request(app.server, 'GET', '/api/projects', bob.token);
  assert.equal(bobProjects.body.projects.length, 0);
  const aliceAudit = await request(app.server, 'GET', '/api/audit', alice.token);
  const bobAudit = await request(app.server, 'GET', '/api/audit', bob.token);
  assert.ok(aliceAudit.body.events.some((event) => event.project_id === projectId));
  assert.ok(!bobAudit.body.events.some((event) => event.project_id === projectId));
});

test('serverless test endpoints report BLOCKED without fabricated execution data', async (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codepilot-teststate-'));
  const app = createApp({ config: configFor(dataDir, { isVercel: true, authEnabled: false }) });
  t.after(async () => { await app.store.close(); fs.rmSync(dataDir, { recursive: true, force: true }); });
  const project = await app.store.createProject('Test State Project');
  await app.store.saveRevision(project.id, 'hash', { files: [{ path: 'a.js', language: 'JavaScript', bytes: 1, content: 'x', excludedReason: null }], symbols: [], edges: [], findings: [] });
  const invoke = async (url, payload) => {
    let status; let raw = '';
    const req = { method: 'POST', url, headers: { 'content-type': 'application/json' }, body: payload };
    const res = { writeHead: (code) => { status = code; }, end: (chunk) => { raw += chunk || ''; } };
    await app.handler(req, res);
    return { status, body: JSON.parse(raw) };
  };
  const regular = await invoke(`/api/projects/${project.id}/tests/run`, { command: 'npm test' });
  assert.equal(regular.body.result.status, 'BLOCKED');
  assert.equal(regular.body.result.executed, false);
  assert.equal(regular.body.result.exitCode, null);
  assert.equal(regular.body.result.durationMs, null);
  const impact = await invoke(`/api/projects/${project.id}/impact/run-tests`, { changedFiles: [] });
  assert.equal(impact.body.execution.status, 'BLOCKED');
  assert.equal(impact.body.execution.executed, false);
  assert.notEqual(impact.body.execution.exitCode, 0);
});
