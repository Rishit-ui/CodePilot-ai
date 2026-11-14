'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { EXECUTION_RELEASE_VERIFIED } = require('../../src/config');

const root = path.resolve(__dirname, '../..');
const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const packageLock = JSON.parse(fs.readFileSync(path.join(root, 'package-lock.json'), 'utf8'));
const providerPackages = ['@vercel/sandbox', '@vercel/queue', '@vercel/blob', 'pg'];
const variables = [
  ['CODEPILOT_SESSION_SECRET', true], ['DATABASE_URL', true], ['POSTGRES_URL', true],
  ['VERCEL_OIDC_TOKEN', true], ['BLOB_READ_WRITE_TOKEN', true], ['BLOB_STORE_ID', false],
  ['CODEPILOT_AI_API_KEY', true], ['OPENAI_API_KEY', true], ['ANTHROPIC_API_KEY', true],
  ['GEMINI_API_KEY', true], ['GOOGLE_API_KEY', true], ['CODEPILOT_WORKER_TOKEN', true]
];

function configured(name) {
  return typeof process.env[name] === 'string' && process.env[name].trim().length > 0;
}

const report = {
  generatedAt: new Date().toISOString(),
  mode: 'read-only',
  executionReleaseVerified: EXECUTION_RELEASE_VERIFIED,
  packages: Object.fromEntries(providerPackages.map((name) => [name, {
    requested: packageJson.dependencies?.[name] || null,
    resolved: packageLock.packages?.[`node_modules/${name}`]?.version || null
  }])),
  configuration: Object.fromEntries(variables.map(([name, secret]) => [name, { configured: configured(name), secret }])),
  testGates: Object.fromEntries(['TEST_POSTGRES_URL', 'TEST_VERCEL_QUEUE', 'TEST_VERCEL_BLOB', 'TEST_VERCEL_SANDBOX', 'TEST_EXTERNAL_AI'].map((name) => [name, configured(name)])),
  vercelLink: fs.existsSync(path.join(root, '.vercel', 'project.json')),
  consumerEntrypoint: false
};

report.providerReadiness = {
  postgres: report.testGates.TEST_POSTGRES_URL ? 'READY_FOR_AUTHORIZED_TEST' : 'BLOCKED',
  queue: report.testGates.TEST_VERCEL_QUEUE && report.consumerEntrypoint ? 'READY_FOR_AUTHORIZED_TEST' : 'BLOCKED',
  blob: report.testGates.TEST_VERCEL_BLOB ? 'READY_FOR_AUTHORIZED_TEST' : 'BLOCKED',
  sandbox: report.testGates.TEST_VERCEL_SANDBOX ? 'READY_FOR_AUTHORIZED_TEST' : 'BLOCKED',
  ai: report.testGates.TEST_EXTERNAL_AI ? 'READY_FOR_AUTHORIZED_TEST' : 'BLOCKED'
};

process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);

