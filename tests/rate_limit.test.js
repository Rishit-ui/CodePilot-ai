const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Store } = require('../src/db');
const { requestIp, enforceRateLimit } = require('../src/rate_limit');
const { createApp } = require('../src/server');
const http = require('node:http');

test('distributed bucket is consistent across store instances and concurrent calls', async (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codepilot-rate-'));
  const first = new Store(dataDir);
  const second = new Store(dataDir);
  t.after(async () => { await first.close(); await second.close(); fs.rmSync(dataDir, { recursive: true, force: true }); });
  const results = await Promise.all(Array.from({ length: 20 }, (_, index) => (index % 2 ? first : second).consumeRateLimit('shared', 10, 60_000, 1000)));
  assert.equal(results.filter((result) => result.allowed).length, 10);
  assert.equal(results.filter((result) => !result.allowed).length, 10);
  const reset = await first.consumeRateLimit('shared', 10, 60_000, 61_001);
  assert.equal(reset.allowed, true);
  assert.equal(reset.remaining, 9);
});

test('forwarded IP is ignored unless proxy trust is explicit', () => {
  const request = { headers: { 'x-forwarded-for': '203.0.113.10' }, socket: { remoteAddress: '127.0.0.1' } };
  assert.equal(requestIp(request, { trustProxy: false, trustedProxyHops: 0 }), '127.0.0.1');
  assert.equal(requestIp(request, { trustProxy: true, trustedProxyHops: 0 }), '203.0.113.10');
});

test('production limiter fails closed when its distributed store is unavailable', async () => {
  let statusCode = 0; let body = '';
  const response = { writeHead(code) { statusCode = code; }, end(value) { body = value; } };
  const allowed = await enforceRateLimit({
    store: { consumeRateLimit: async () => { throw new Error('database unavailable'); } },
    request: { method: 'POST', headers: {}, socket: { remoteAddress: '127.0.0.1' } }, response,
    config: { enabled: true, failClosed: true, trustProxy: false, trustedProxyHops: 0, policies: { login: { subjectMax: 10, ipMax: 10, windowMs: 60_000 } } },
    user: null, pathname: '/api/auth/login',
    json(res, code, payload) { statusCode = code; res.end(JSON.stringify(payload)); }
  });
  assert.equal(allowed, false);
  assert.equal(statusCode, 503);
  assert.equal(JSON.parse(body).error.code, 'RATE_LIMIT_UNAVAILABLE');
});

test('repeated authentication failures escalate to HTTP 429 without logging credentials', async (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codepilot-auth-rate-'));
  const policies = { login: { subjectMax: 20, ipMax: 20, windowMs: 60_000 } };
  const app = createApp({ config: {
    dataDir, databaseUrl: null, sessionSecret: 'auth-rate-secret-value-with-more-than-32-characters',
    authEnabled: true, isProduction: false, isVercel: false,
    rateLimit: { enabled: true, failClosed: false, trustProxy: false, trustedProxyHops: 0, authFailureMax: 2, authFailureWindowMs: 60_000, policies },
    execution: { mode: 'local-development' }, ai: { provider: 'local' }, deployment: { allowedProviders: [] },
    limits: { maxQuestionChars: 2000 }
  } });
  await new Promise((resolve) => app.server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { app.server.close(); await app.store.close(); fs.rmSync(dataDir, { recursive: true, force: true }); });
  async function login() {
    return new Promise((resolve, reject) => {
      const body = JSON.stringify({ email: 'victim@example.com', password: 'NotThePassword!1' });
      const req = http.request({ host: '127.0.0.1', port: app.server.address().port, method: 'POST', path: '/api/auth/login', headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) } }, (res) => { res.resume(); res.on('end', () => resolve(res.statusCode)); });
      req.on('error', reject); req.end(body);
    });
  }
  assert.equal(await login(), 401);
  assert.equal(await login(), 401);
  assert.equal(await login(), 429);
  const events = await app.store.all("SELECT detail FROM audit_events WHERE action='security.authentication_failed'");
  assert.ok(events.length >= 2);
  assert.ok(events.every((event) => !event.detail.includes('victim@example.com') && !event.detail.includes('NotThePassword')));
});
