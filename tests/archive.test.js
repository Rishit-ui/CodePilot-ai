const test = require('node:test');
const assert = require('node:assert/strict');
const { readZip, ArchiveError, contentHash } = require('../src/archive');
const { makeZip } = require('./helpers');

const defaultLimits = {
  maxUploadBytes: 10 * 1024 * 1024,
  maxExtractedBytes: 25 * 1024 * 1024,
  maxFiles: 1000,
  maxFileBytes: 2 * 1024 * 1024,
  maxCompressionRatio: 100
};

test('readZip parses valid zip files and computes SHA-256 hash', () => {
  const zipBuf = makeZip([
    { name: 'index.js', content: 'console.log("hello world");' },
    { name: 'package.json', content: '{"name":"demo"}' }
  ]);

  const hash = contentHash(zipBuf);
  assert.equal(typeof hash, 'string');
  assert.equal(hash.length, 64);

  const entries = readZip(zipBuf, defaultLimits);
  assert.equal(entries.length, 2);
  assert.equal(entries[0].path, 'index.js');
  assert.equal(entries[0].data.toString('utf8'), 'console.log("hello world");');
  assert.equal(entries[1].path, 'package.json');
});

test('readZip rejects zip slip path traversal attempts', () => {
  const badZip = makeZip([
    { name: '../etc/passwd', content: 'malicious' }
  ]);

  assert.throws(() => {
    readZip(badZip, defaultLimits);
  }, /Unsafe archive path/);
});

test('readZip rejects absolute paths', () => {
  const badZip = makeZip([
    { name: '/var/log/secret.txt', content: 'malicious' }
  ]);

  assert.throws(() => {
    readZip(badZip, defaultLimits);
  }, /Unsafe archive path/);
});

test('readZip rejects symbolic links', () => {
  const symlinkZip = makeZip([
    { name: 'symlink.txt', content: '/etc/passwd', unixType: 0o120000 }
  ]);

  assert.throws(() => {
    readZip(symlinkZip, defaultLimits);
  }, /Symbolic links are not permitted/);
});

test('readZip enforces file count limits', () => {
  const strictLimits = { ...defaultLimits, maxFiles: 1 };
  const zipBuf = makeZip([
    { name: 'file1.txt', content: 'one' },
    { name: 'file2.txt', content: 'two' }
  ]);

  assert.throws(() => {
    readZip(zipBuf, strictLimits);
  }, /exceeds file-count limits/);
});
