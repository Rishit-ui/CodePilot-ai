const test = require('node:test');
const assert = require('node:assert/strict');
const { hashPassword, verifyPassword, generateToken, hasPermission } = require('../src/auth');

test('hashPassword creates salt and derived key, verifyPassword verifies correctly', () => {
  const password = 'mySecretPassword123!';
  const hash = hashPassword(password);

  assert.ok(hash.includes(':'));
  assert.equal(verifyPassword(password, hash), true);
  assert.equal(verifyPassword('wrongPassword', hash), false);
  assert.equal(verifyPassword('', hash), false);
});

test('generateToken produces unique high-entropy hex strings', () => {
  const t1 = generateToken();
  const t2 = generateToken();
  assert.equal(typeof t1, 'string');
  assert.equal(t1.length, 64);
  assert.notEqual(t1, t2);
});

test('hasPermission enforces role hierarchy', () => {
  assert.equal(hasPermission('owner', 'delete'), true);
  assert.equal(hasPermission('owner', 'deploy'), true);

  assert.equal(hasPermission('admin', 'deploy'), true);
  assert.equal(hasPermission('admin', 'delete'), false);

  assert.equal(hasPermission('editor', 'write'), true);
  assert.equal(hasPermission('editor', 'deploy'), false);

  assert.equal(hasPermission('viewer', 'read'), true);
  assert.equal(hasPermission('viewer', 'write'), false);
  assert.equal(hasPermission('unknown_role', 'read'), false);
});
