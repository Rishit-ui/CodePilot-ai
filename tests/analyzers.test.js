const test = require('node:test');
const assert = require('node:assert/strict');
const { analyze, redact, languageFor } = require('../src/analyzer');
const { analyzeJavaScript } = require('../src/analyzers/javascript');
const { analyzePython } = require('../src/analyzers/python');
const { analyzeDockerfile } = require('../src/analyzers/docker');

test('languageFor classifies extensions accurately', () => {
  assert.equal(languageFor('src/index.ts'), 'TypeScript');
  assert.equal(languageFor('app.py'), 'Python');
  assert.equal(languageFor('Dockerfile'), 'Dockerfile');
  assert.equal(languageFor('docker-compose.yml'), 'DockerCompose');
  assert.equal(languageFor('schema.sql'), 'SQL');
  assert.equal(languageFor('README.md'), 'Markdown');
});

test('redact masks AWS credentials, GitHub PATs, and private keys', () => {
  const secretContent = `
    const awsKey = "AKIA1234567890ABCDEF";
    const pat = "ghp_1234567890abcdefghijklmnopqrstuv";
    const db = "postgres://admin:superSecretPassword123@localhost:5432/mydb";
    -----BEGIN RSA PRIVATE KEY-----
    MIIEowIBAAKCAQEA0
    -----END RSA PRIVATE KEY-----
  `;

  const cleaned = redact(secretContent);
  assert.ok(!cleaned.includes('AKIA1234567890ABCDEF'));
  assert.ok(cleaned.includes('[REDACTED_AWS_KEY]'));
  assert.ok(!cleaned.includes('ghp_1234567890abcdefghijklmnopqrstuv'));
  assert.ok(cleaned.includes('[REDACTED_GITHUB_PAT]'));
  assert.ok(!cleaned.includes('superSecretPassword123'));
  assert.ok(cleaned.includes('[REDACTED_PASSWORD]'));
  assert.ok(!cleaned.includes('MIIEowIBAAKCAQEA0'));
  assert.ok(cleaned.includes('[REDACTED_PRIVATE_KEY]'));
});

test('analyzeJavaScript extracts symbols, routes, and frameworks', () => {
  const code = `
    import express from 'express';
    import { helper } from './utils';

    const app = express();
    export function calculateTax(rate) { return rate * 1.2; }
    export class UserStore {}

    app.get('/api/users', (req, res) => res.json([]));
    app.post('/api/users', (req, res) => res.json({ id: 1 }));
  `;

  const candidates = new Set(['index.js', 'utils.js']);
  const result = analyzeJavaScript('index.js', code, candidates);

  assert.ok(result.frameworks.includes('Express'));
  assert.ok(result.symbols.some((s) => s.name === 'calculateTax' && s.kind === 'function'));
  assert.ok(result.symbols.some((s) => s.name === 'UserStore' && s.kind === 'class'));
  assert.ok(result.routes.some((r) => r.method === 'GET' && r.path === '/api/users'));
  assert.ok(result.routes.some((r) => r.method === 'POST' && r.path === '/api/users'));
  assert.ok(result.edges.some((e) => e.targetPath === 'utils.js' && e.type === 'imports'));
});

test('analyzePython extracts FastAPI routes and classes', () => {
  const pyCode = `
    from fastapi import FastAPI
    import os

    app = FastAPI()

    class ItemModel:
        pass

    @app.get("/items/{item_id}")
    def read_item(item_id: int):
        return {"item_id": item_id}
  `;

  const result = analyzePython('main.py', pyCode);
  assert.ok(result.frameworks.includes('FastAPI'));
  assert.ok(result.symbols.some((s) => s.name === 'ItemModel' && s.kind === 'class'));
  assert.ok(result.symbols.some((s) => s.name === 'read_item' && s.kind === 'def'));
  assert.ok(result.routes.some((r) => r.method === 'GET' && r.path === '/items/{item_id}'));
});

test('analyzeDockerfile detects unpinned tags and missing USER', () => {
  const dockerContent = `
    FROM node:latest
    WORKDIR /app
    COPY . .
    EXPOSE 3000
    CMD ["node", "server.js"]
  `;

  const result = analyzeDockerfile('Dockerfile', dockerContent);
  assert.equal(result.hasUser, false);
  assert.ok(result.findings.some((f) => f.category === 'docker' && f.severity === 'medium')); // unpinned tag
  assert.ok(result.findings.some((f) => f.category === 'docker-security' && f.message.includes('non-root USER')));
});
