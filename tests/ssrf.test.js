const test = require('node:test');
const assert = require('node:assert/strict');
const { isPrivateIp, validateUrlForSSRF, SSRFError } = require('../src/importer');

test('isPrivateIp correctly flags loopback, private, and cloud metadata IPs', () => {
  // Loopback
  assert.equal(isPrivateIp('127.0.0.1'), true);
  assert.equal(isPrivateIp('127.0.1.5'), true);
  assert.equal(isPrivateIp('::1'), true);

  // RFC 1918 Private
  assert.equal(isPrivateIp('10.0.0.1'), true);
  assert.equal(isPrivateIp('10.255.255.254'), true);
  assert.equal(isPrivateIp('172.16.0.1'), true);
  assert.equal(isPrivateIp('172.31.255.255'), true);
  assert.equal(isPrivateIp('192.168.1.1'), true);

  // Link-local / Cloud Metadata
  assert.equal(isPrivateIp('169.254.169.254'), true);
  assert.equal(isPrivateIp('169.254.1.1'), true);

  // Valid public IPs
  assert.equal(isPrivateIp('8.8.8.8'), false);
  assert.equal(isPrivateIp('1.1.1.1'), false);
  assert.equal(isPrivateIp('142.250.190.46'), false);
});

test('validateUrlForSSRF rejects non-http protocols', async () => {
  await assert.rejects(async () => {
    await validateUrlForSSRF('ftp://example.com/repo.zip');
  }, /Unsupported protocol/);

  await assert.rejects(async () => {
    await validateUrlForSSRF('file:///etc/passwd');
  }, /Unsupported protocol/);
});

test('validateUrlForSSRF rejects localhost and loopback domains', async () => {
  await assert.rejects(async () => {
    await validateUrlForSSRF('http://localhost:3000/archive.zip');
  }, /blocked by SSRF policy/);

  await assert.rejects(async () => {
    await validateUrlForSSRF('http://sub.localhost:8080/archive.zip');
  }, /blocked by SSRF policy/);

  await assert.rejects(async () => {
    await validateUrlForSSRF('http://metadata.google.internal/computeMetadata/v1/');
  }, /blocked by SSRF policy/);
});

test('validateUrlForSSRF rejects direct private IPs in URL', async () => {
  await assert.rejects(async () => {
    await validateUrlForSSRF('http://127.0.0.1:3000/app.zip');
  }, /private or restricted/);

  await assert.rejects(async () => {
    await validateUrlForSSRF('http://169.254.169.254/latest/meta-data');
  }, /private or restricted/);
});
