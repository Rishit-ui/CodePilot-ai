const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
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
