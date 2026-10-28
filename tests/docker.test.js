const test = require('node:test');
const assert = require('node:assert/strict');
const { detectStack, generateDockerfile, generateDockerCompose, diagnoseDockerFailure } = require('../src/docker');
const { createUnifiedDiff } = require('../src/planner');

test('detectStack identifies Node.js and Next.js applications', () => {
  const files = [
    { path: 'package.json', content: '{"name":"demo","dependencies":{"next":"14.0.0"}}' },
    { path: 'pages/index.js', content: 'export default () => <div>Hello</div>' }
  ];
  const stack = detectStack(files);
  assert.equal(stack.type, 'node');
  assert.equal(stack.isNext, true);
  assert.equal(stack.port, 3000);
});

test('generateDockerfile produces multi-stage non-root container with health check', () => {
  const stack = { type: 'node', version: '20-alpine', port: 3000 };
  const df = generateDockerfile(stack);
  assert.ok(df.includes('FROM node:20-alpine AS builder'));
  assert.ok(df.includes('FROM node:20-alpine AS runner'));
  assert.ok(df.includes('USER appuser'));
  assert.ok(df.includes('HEALTHCHECK'));
  assert.ok(df.includes('EXPOSE 3000'));
});

test('diagnoseDockerFailure identifies permission and dependency errors', () => {
  const depDiag = diagnoseDockerFailure(1, 'npm ERR! Could not resolve dependency @types/node');
  assert.equal(depDiag.category, 'dependency_resolution');

  const permDiag = diagnoseDockerFailure(1, 'Error: EACCES: permission denied, open /app/config.json');
  assert.equal(permDiag.category, 'permissions');
});

test('createUnifiedDiff generates standard diff output', () => {
  const oldText = 'const x = 1;\nconst y = 2;\n';
  const newText = 'const x = 1;\nconst y = 3;\n';
  const diff = createUnifiedDiff('test.js', oldText, newText);

  assert.ok(diff.includes('--- a/test.js'));
  assert.ok(diff.includes('+++ b/test.js'));
  assert.ok(diff.includes('-const y = 2;'));
  assert.ok(diff.includes('+const y = 3;'));
});
