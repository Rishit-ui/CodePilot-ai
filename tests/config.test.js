const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { loadConfig } = require('../src/config');

test('loadConfig loads safe defaults in development', () => {
  const config = loadConfig(path.resolve(__dirname, '..'));
  assert.equal(config.host, '127.0.0.1');
  assert.equal(config.port, 3000);
  assert.equal(typeof config.limits.maxUploadBytes, 'number');
  assert.ok(config.limits.maxUploadBytes >= 1024);
  assert.equal(config.ai.provider, 'local');
  assert.ok(Array.isArray(config.deployment.allowedProviders));
});

test('loadConfig prevents insecure session secret in production', () => {
  const origEnv = process.env.NODE_ENV;
  const origSecret = process.env.CODEPILOT_SESSION_SECRET;
  try {
    process.env.NODE_ENV = 'production';
    delete process.env.CODEPILOT_SESSION_SECRET;
    assert.throws(() => {
      loadConfig(path.resolve(__dirname, '..'));
    }, /CODEPILOT_SESSION_SECRET/);
  } finally {
    process.env.NODE_ENV = origEnv;
    if (origSecret) process.env.CODEPILOT_SESSION_SECRET = origSecret;
  }
});

test('production rejects weak secrets and disabled authentication, including Vercel', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'codepilot-config-'));
  const keys = ['NODE_ENV', 'VERCEL', 'DATABASE_URL', 'CODEPILOT_SESSION_SECRET', 'CODEPILOT_AUTH_ENABLED'];
  const original = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  try {
    process.env.NODE_ENV = 'production';
    process.env.VERCEL = '1';
    process.env.CODEPILOT_AUTH_ENABLED = 'true';
    delete process.env.CODEPILOT_SESSION_SECRET;
    assert.throws(() => loadConfig(tempRoot), /explicitly set/);
    process.env.CODEPILOT_SESSION_SECRET = 'change-this-known-placeholder-secret-value';
    assert.throws(() => loadConfig(tempRoot), /known placeholder/);
    process.env.CODEPILOT_SESSION_SECRET = 'a'.repeat(64);
    process.env.DATABASE_URL = 'postgres://user:pass@db.example.com/codepilot';
    process.env.CODEPILOT_AUTH_ENABLED = 'false';
    assert.throws(() => loadConfig(tempRoot), /cannot be disabled/);
    process.env.CODEPILOT_AUTH_ENABLED = 'true';
    const config = loadConfig(tempRoot);
    assert.equal(config.authEnabled, true);
    assert.equal(config.sessionSecret, 'a'.repeat(64));
    assert.equal(config.database.sslMode, 'verify-full');
  } finally {
    for (const key of keys) original[key] === undefined ? delete process.env[key] : process.env[key] = original[key];
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});
