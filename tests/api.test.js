const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { createApp } = require('../src/server');
const { makeZip } = require('./helpers');

function request(server, method, path, headers = {}, body = null) {
  return new Promise((resolve, reject) => {
    const addr = server.address();
    const port = typeof addr === 'object' ? addr.port : 3000;
    const req = http.request(
      {
        host: '127.0.0.1',
        port,
        method,
        path,
        headers: {
          'Host': `127.0.0.1:${port}`,
          ...headers
        }
      },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const raw = Buffer.concat(chunks);
          let json = null;
          try {
            json = JSON.parse(raw.toString('utf8'));
          } catch {}
          resolve({
            status: res.statusCode,
            headers: res.headers,
            body: json,
            rawText: raw.toString('utf8')
          });
        });
      }
    );
    req.on('error', reject);
    if (body) {
      if (Buffer.isBuffer(body)) req.write(body);
      else if (typeof body === 'object') req.write(JSON.stringify(body));
      else req.write(body);
    }
    req.end();
  });
}

test('Full CodePilot AI API Lifecycle Integration Test', async (t) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codepilot-test-'));
  const config = {
    env: 'test',
    isProduction: false,
    host: '127.0.0.1',
    port: 0,
    dataDir: tmpDir,
    sessionSecret: 'test-secret-key-32-characters-minimum',
    authEnabled: false,
    ai: { provider: 'local', apiKey: '', model: 'local-deterministic', baseUrl: '' },
    deployment: { allowedProviders: ['mock', 'local-docker'], renderApiKey: '', vercelToken: '', flyApiToken: '' },
    limits: {
      maxUploadBytes: 10 * 1024 * 1024,
      maxExtractedBytes: 25 * 1024 * 1024,
      maxFiles: 1000,
      maxFileBytes: 2 * 1024 * 1024,
      maxCompressionRatio: 100,
      maxQuestionChars: 2000,
      maxSearchResults: 100,
      commandTimeoutMs: 10000
    }
  };

  const app = createApp({ config });
  await new Promise((resolve) => app.server.listen(0, '127.0.0.1', resolve));

  t.after(() => {
    app.server.close();
    app.store.close();
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {}
  });

  // 1. Health & Readiness
  const healthRes = await request(app.server, 'GET', '/api/health');
  assert.equal(healthRes.status, 200);
  assert.equal(healthRes.body.status, 'ok');

  const readyRes = await request(app.server, 'GET', '/api/ready');
  assert.equal(readyRes.status, 200);
  assert.equal(readyRes.body.status, 'ready');

  // 2. Authentication & Workspaces
  const regRes = await request(app.server, 'POST', '/api/auth/register', { 'Content-Type': 'application/json' }, {
    email: 'architect@example.com',
    name: 'Lead Architect',
    password: 'SecurePassword123!'
  });
  assert.equal(regRes.status, 201);
  assert.equal(regRes.body.user.email, 'architect@example.com');
  const token = regRes.body.token;
  assert.ok(token);

  const meRes = await request(app.server, 'GET', '/api/auth/me', { 'Authorization': `Bearer ${token}` });
  assert.equal(meRes.status, 200);
  assert.equal(meRes.body.user.name, 'Lead Architect');

  const wsRes = await request(app.server, 'POST', '/api/workspaces', {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${token}`
  }, { name: 'Core Platform Engineering' });
  assert.equal(wsRes.status, 201);
  const workspaceId = wsRes.body.workspace.id;

  // 3. Project Creation
  const projRes = await request(app.server, 'POST', '/api/projects', {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${token}`
  }, {
    name: 'Payment Service',
    description: 'Critical payment processing gateway',
    workspaceId
  });
  assert.equal(projRes.status, 201);
  const projectId = projRes.body.project.id;

  // 4. Import ZIP Revision
  const zipBuffer = makeZip([
    {
      name: 'package.json',
      content: JSON.stringify({
        name: 'payment-service',
        version: '1.0.0',
        dependencies: { express: '^4.18.2' }
      })
    },
    {
      name: 'src/server.js',
      content: `
        const express = require('express');
        const app = express();
        const PORT = process.env.PORT || 8080;

        app.get('/api/health', (req, res) => res.json({ status: 'ok' }));
        app.post('/api/charge', (req, res) => {
          // TODO: Add 3D-Secure 2.0 authentication check
          res.json({ success: true, transactionId: 'tx_12345' });
        });

        module.exports = app;
      `
    },
    {
      name: 'src/config.js',
      content: `
        const secretKey = "AKIA1234567890ABCDEF";
        const envVal = process.env.DATABASE_URL;
      `
    },
    {
      name: '.env.example',
      content: 'PORT=8080\nDATABASE_URL=postgres://user:pass@localhost:5432/paydb\n'
    }
  ]);

  const importRes = await request(app.server, 'POST', `/api/projects/${projectId}/import`, {
    'Content-Type': 'application/zip'
  }, zipBuffer);
  assert.equal(importRes.status, 201);
  assert.equal(importRes.body.summary.files, 4);
  const revisionId = importRes.body.revision.id;

  // 5. Code Explorer
  const filesRes = await request(app.server, 'GET', `/api/projects/${projectId}/files`);
  assert.equal(filesRes.status, 200);
  assert.equal(filesRes.body.files.length, 4);

  const fileRes = await request(app.server, 'GET', `/api/projects/${projectId}/file?path=src/config.js`);
  assert.equal(fileRes.status, 200);
  assert.ok(fileRes.body.file.content.includes('[REDACTED_AWS_KEY]'));
  assert.ok(!fileRes.body.file.content.includes('AKIA1234567890ABCDEF'));

  // 6. Architecture Graph & 15-Section Report
  const graphRes = await request(app.server, 'GET', `/api/projects/${projectId}/graph`);
  assert.equal(graphRes.status, 200);
  assert.ok(graphRes.body.nodes.length >= 3);

  const reportRes = await request(app.server, 'GET', `/api/projects/${projectId}/architecture-report`);
  assert.equal(reportRes.status, 200);
  assert.ok(reportRes.body.report.executiveOverview);
  assert.ok(reportRes.body.report.technologyInventory);
  assert.ok(reportRes.body.report.apiArchitecture);
  assert.equal(reportRes.body.report.apiArchitecture.routeCount, 2);

  const reportMdRes = await request(app.server, 'GET', `/api/projects/${projectId}/architecture-report.md`);
  assert.equal(reportMdRes.status, 200);
  assert.ok(reportMdRes.rawText.includes('CodePilot AI Architecture Report'));
  assert.ok(reportMdRes.rawText.includes('1. Executive Overview'));

  // 7. Findings & Suppression
  const findingsRes = await request(app.server, 'GET', `/api/projects/${projectId}/findings`);
  assert.equal(findingsRes.status, 200);
  const highFinding = findingsRes.body.findings.find((f) => f.severity === 'high');
  assert.ok(highFinding);
  assert.equal(highFinding.status, 'open');

  const suppressRes = await request(app.server, 'POST', `/api/projects/${projectId}/findings/${highFinding.id}/suppress`, {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${token}`
  }, { reason: 'Test dummy credential in synthetic fixture repository' });
  assert.equal(suppressRes.status, 200);
  assert.equal(suppressRes.body.finding.status, 'suppressed');

  // 8. AI Grounded Assistant
  const askRes = await request(app.server, 'POST', `/api/projects/${projectId}/ask`, {
    'Content-Type': 'application/json'
  }, { question: 'Where is the charge endpoint defined?' });
  assert.equal(askRes.status, 200);
  assert.ok(askRes.body.citations.length > 0);
  assert.equal(askRes.body.citations[0].path, 'src/server.js');

  // 9. Implementation Planner
  const planRes = await request(app.server, 'POST', `/api/projects/${projectId}/plans`, {
    'Content-Type': 'application/json'
  }, { requirement: 'Implement Stripe webhook verification and idempotency layer' });
  assert.equal(planRes.status, 201);
  assert.ok(planRes.body.plan.tasks.length >= 3);
  const taskId = planRes.body.plan.tasks[0].id;

  const taskUpdateRes = await request(app.server, 'PATCH', `/api/projects/${projectId}/tasks/${taskId}`, {
    'Content-Type': 'application/json'
  }, { status: 'completed' });
  assert.equal(taskUpdateRes.status, 200);
  assert.equal(taskUpdateRes.body.task.status, 'completed');

  // 10. Patches & Unified Diff
  const patchRes = await request(app.server, 'POST', `/api/projects/${projectId}/patches`, {
    'Content-Type': 'application/json'
  }, {
    title: 'Add status check to health route',
    targetFile: 'src/server.js',
    newContent: 'app.get("/api/health", (req, res) => res.json({ status: "healthy", uptime: 100 }));\n'
  });
  assert.equal(patchRes.status, 201);
  const patchId = patchRes.body.patch.id;
  assert.ok(patchRes.body.patch.diff.includes('--- a/src/server.js'));

  const applyRes = await request(app.server, 'POST', `/api/projects/${projectId}/patches/${patchId}/apply`);
  assert.equal(applyRes.status, 200);
  assert.equal(applyRes.body.patch.status, 'applied');

  const rollbackRes = await request(app.server, 'POST', `/api/projects/${projectId}/patches/${patchId}/rollback`);
  assert.equal(rollbackRes.status, 200);
  assert.equal(rollbackRes.body.patch.status, 'rolled_back');

  // 11. Docker Assistant
  const dockerRes = await request(app.server, 'GET', `/api/projects/${projectId}/docker`);
  assert.equal(dockerRes.status, 200);
  assert.equal(dockerRes.body.stack.type, 'node');
  assert.ok(dockerRes.body.dockerfile.includes('FROM node:20-alpine'));
  assert.ok(dockerRes.body.dockerCompose.includes('version:'));

  // 12. Deployment Readiness & Live Verification
  const readinessRes = await request(app.server, 'GET', `/api/projects/${projectId}/deployment-readiness`);
  assert.equal(readinessRes.status, 200);
  assert.ok(readinessRes.body.checks.length >= 4);

  const deployRes = await request(app.server, 'POST', `/api/projects/${projectId}/deploy`, {
    'Content-Type': 'application/json'
  }, { provider: 'mock', environment: 'staging' });
  assert.equal(deployRes.status, 201);
  assert.equal(deployRes.body.deployment.status, 'verified');
  assert.equal(deployRes.body.deployment.health_status, 'healthy');

  // 13. Audit Log
  const auditRes = await request(app.server, 'GET', '/api/audit');
  assert.equal(auditRes.status, 200);
  assert.ok(auditRes.body.events.length >= 4);
});
