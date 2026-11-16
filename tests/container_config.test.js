const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = (name) => fs.readFileSync(path.join(root, name), 'utf8');

test('production Compose topology uses private PostgreSQL with durable volumes', () => {
  const compose = read('docker-compose.yml');
  assert.match(compose, /postgres:\s*\n\s+image: postgres:17-alpine/);
  assert.match(compose, /postgres-data:\/var\/lib\/postgresql\/data/);
  assert.match(compose, /condition: service_healthy/);
  assert.match(compose, /DATABASE_URL: postgresql:\/\//);
  const postgresService = compose.slice(compose.indexOf('  postgres:'), compose.indexOf('  codepilot:'));
  assert.doesNotMatch(postgresService, /\n\s+ports:/);
  assert.match(compose, /CODEPILOT_EXECUTION_MODE: disabled/);
});

test('container runtime is non-root, health-checked, and terminates gracefully', () => {
  const dockerfile = read('Dockerfile');
  const server = read('src/server.js');
  assert.match(dockerfile, /npm ci --omit=dev/);
  assert.match(dockerfile, /USER codepilot/);
  assert.match(dockerfile, /HEALTHCHECK/);
  assert.match(dockerfile, /STOPSIGNAL SIGTERM/);
  assert.match(server, /process\.once\('SIGTERM'/);
  assert.match(server, /await app\.store\.close\(\)/);
});

test('Docker environment template contains no committed secret values', () => {
  const env = read('.env.docker.example');
  assert.match(env, /^CODEPILOT_SESSION_SECRET=$/m);
  assert.match(env, /^POSTGRES_PASSWORD=$/m);
  assert.match(read('.gitignore'), /^\.env\.docker$/m);
});
