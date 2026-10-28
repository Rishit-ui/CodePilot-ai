const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { createApp } = require('../src/server');
const { makeZip } = require('./helpers');

function request(server, method, reqPath, headers = {}, body = null) {
  return new Promise((resolve, reject) => {
    const addr = server.address();
    const port = typeof addr === 'object' ? addr.port : 3000;
    const req = http.request(
      {
        host: '127.0.0.1',
        port,
        method,
        path: reqPath,
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

test('Developer Workspaces & Productivity API Test Suite', async (t) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codepilot-workspaces-test-'));
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

  const sampleZip = makeZip([
    {
      name: 'package.json',
      content: JSON.stringify({
        name: 'micro-billing',
        version: '1.0.0',
        dependencies: { express: '^4.19.0', pg: '^8.11.0' }
      })
    },
    {
      name: 'src/server.js',
      content: `
        const express = require('express');
        const app = express();
        app.get('/api/health', (req, res) => res.json({ status: 'ok' }));
        app.post('/api/charge', async (req, res) => {
          const amount = req.body.amount;
          if (!amount) return res.status(400).json({ error: 'amount required' });
          res.json({ success: true, amount });
        });
        app.listen(3000);
      `
    }
  ]);

  const projRes = await request(app.server, 'POST', '/api/projects', {
    'Content-Type': 'application/json'
  }, {
    name: 'Workspace Demo',
    description: 'Demonstration of CodePilot workspaces'
  });
  assert.equal(projRes.status, 201);
  const projectId = projRes.body.project.id;
  assert.ok(projectId);

  const importRes = await request(app.server, 'POST', `/api/projects/${projectId}/import`, {
    'Content-Type': 'application/zip'
  }, sampleZip);
  assert.equal(importRes.status, 201);

  // 2. CodePilot Flow API
  const flowArchRes = await request(app.server, 'GET', `/api/projects/${projectId}/flow?type=architecture`);
  assert.equal(flowArchRes.status, 200);
  assert.equal(flowArchRes.body.diagram.diagramType, 'architecture');
  assert.ok(flowArchRes.body.diagram.nodes.length >= 2);

  const flowCallRes = await request(app.server, 'GET', `/api/projects/${projectId}/flow?type=call-graph`);
  assert.equal(flowCallRes.status, 200);
  assert.equal(flowCallRes.body.diagram.diagramType, 'call-graph');

  const flowExplainRes = await request(app.server, 'POST', `/api/projects/${projectId}/flow/explain`, {
    'Content-Type': 'application/json'
  }, {
    diagram: flowArchRes.body.diagram,
    query: 'Explain the architecture layers and data flow'
  });
  assert.equal(flowExplainRes.status, 200);
  assert.ok(flowExplainRes.body.explanation.length > 20);

  // 3. Multi-turn AI Assistant Chat
  const chatRes = await request(app.server, 'POST', `/api/projects/${projectId}/ai/chat`, {
    'Content-Type': 'application/json'
  }, {
    messages: [
      { role: 'user', content: 'What endpoints does this project expose?' }
    ]
  });
  assert.equal(chatRes.status, 200);
  assert.ok(chatRes.body.reply.includes('/api/charge') || chatRes.body.reply.includes('endpoint'));
  assert.ok(Array.isArray(chatRes.body.citations));

  // 4. Inline AI Code Actions
  const codeExplainRes = await request(app.server, 'POST', `/api/projects/${projectId}/ai/explain`, {
    'Content-Type': 'application/json'
  }, {
    filePath: 'src/server.js',
    code: 'app.post("/api/charge", async (req, res) => { const amount = req.body.amount; });'
  });
  assert.equal(codeExplainRes.status, 200);
  assert.ok(codeExplainRes.body.explanation.length > 20);

  const testGenRes = await request(app.server, 'POST', `/api/projects/${projectId}/ai/generate-tests`, {
    'Content-Type': 'application/json'
  }, {
    filePath: 'src/server.js',
    code: 'function add(a, b) { return a + b; }'
  });
  assert.equal(testGenRes.status, 200);
  assert.ok(testGenRes.body.testCode.includes('test(') || testGenRes.body.testCode.includes('assert'));

  const refactorRes = await request(app.server, 'POST', `/api/projects/${projectId}/ai/refactor`, {
    'Content-Type': 'application/json'
  }, {
    filePath: 'src/server.js',
    code: 'var x = 10; var y = 20;',
    goal: 'Modernize with const'
  });
  assert.equal(refactorRes.status, 200);
  assert.ok(refactorRes.body.refactoredCode);
  assert.ok(refactorRes.body.diff);

  // 5. Tasks & Kanban Management
  const taskCreateRes = await request(app.server, 'POST', `/api/projects/${projectId}/tasks`, {
    'Content-Type': 'application/json'
  }, {
    title: 'Implement idempotency key validation',
    description: 'Ensure duplicate payment charges are avoided',
    priority: 'high',
    targetFile: 'src/server.js'
  });
  assert.equal(taskCreateRes.status, 201);
  const taskId = taskCreateRes.body.task.id;
  assert.equal(taskCreateRes.body.task.status, 'todo');

  const taskListRes = await request(app.server, 'GET', `/api/projects/${projectId}/tasks`);
  assert.equal(taskListRes.status, 200);
  assert.ok(taskListRes.body.tasks.some(t => t.id === taskId));

  const taskPatchRes = await request(app.server, 'PATCH', `/api/projects/${projectId}/tasks/${taskId}`, {
    'Content-Type': 'application/json'
  }, {
    status: 'in_progress'
  });
  assert.equal(taskPatchRes.status, 200);
  assert.equal(taskPatchRes.body.task.status, 'in_progress');

  // AI Task Generation from project findings/codebase
  const taskAutoRes = await request(app.server, 'POST', `/api/projects/${projectId}/tasks/generate`, {
    'Content-Type': 'application/json'
  }, {
    requirement: 'Security review for billing endpoint'
  });
  assert.equal(taskAutoRes.status, 201);
  assert.ok(taskAutoRes.body.tasks.length >= 1);

  // 6. Notes & Knowledge Base
  const noteCreateRes = await request(app.server, 'POST', `/api/projects/${projectId}/notes`, {
    'Content-Type': 'application/json'
  }, {
    title: 'Billing Architecture Decisions',
    content: 'We use Express with standard error middleware.',
    category: 'architecture',
    tags: 'billing,security'
  });
  assert.equal(noteCreateRes.status, 201);
  const noteId = noteCreateRes.body.note.id;

  const noteListRes = await request(app.server, 'GET', `/api/projects/${projectId}/notes`);
  assert.equal(noteListRes.status, 200);
  assert.ok(noteListRes.body.notes.some(n => n.id === noteId));

  const noteDeleteRes = await request(app.server, 'DELETE', `/api/projects/${projectId}/notes/${noteId}`);
  assert.equal(noteDeleteRes.status, 200);

  // 7. API Studio
  const apiSaveRes = await request(app.server, 'POST', `/api/projects/${projectId}/api-requests`, {
    'Content-Type': 'application/json'
  }, {
    name: 'Get Health Status',
    method: 'GET',
    url: 'https://example.com/api/health'
  });
  assert.equal(apiSaveRes.status, 201);

  const apiListRes = await request(app.server, 'GET', `/api/projects/${projectId}/api-requests`);
  assert.equal(apiListRes.status, 200);
  assert.ok(apiListRes.body.requests.length >= 1);

  // SSRF Protection on API Studio Execution
  const ssrfBlockedRes = await request(app.server, 'POST', `/api/projects/${projectId}/api-requests/execute`, {
    'Content-Type': 'application/json'
  }, {
    method: 'GET',
    url: 'http://169.254.169.254/latest/meta-data/'
  });
  assert.equal(ssrfBlockedRes.status, 400);
  assert.equal(ssrfBlockedRes.body.error.code, 'SSRF_BLOCKED');

  // 8. Database Studio
  const dbSchemaRes = await request(app.server, 'GET', `/api/projects/${projectId}/db-schema`);
  assert.equal(dbSchemaRes.status, 200);
  assert.ok(Array.isArray(dbSchemaRes.body.tables));
  assert.ok(dbSchemaRes.body.tables.some(t => t.name === 'projects'));

  const dbQueryRes = await request(app.server, 'POST', `/api/projects/${projectId}/db-query`, {
    'Content-Type': 'application/json'
  }, {
    query: 'SELECT id, name FROM projects LIMIT 1'
  });
  assert.equal(dbQueryRes.status, 200);
  assert.ok(Array.isArray(dbQueryRes.body.rows));
  assert.equal(typeof dbQueryRes.body.executionTimeMs, 'number');

  // Database Studio Mutation Block
  const dbMutationBlocked = await request(app.server, 'POST', `/api/projects/${projectId}/db-query`, {
    'Content-Type': 'application/json'
  }, {
    query: 'DROP TABLE projects'
  });
  assert.equal(dbMutationBlocked.status, 400);
  assert.equal(dbMutationBlocked.body.error.code, 'READ_ONLY_QUERY_REQUIRED');

  // 9. Global Command Palette Search
  const searchRes = await request(app.server, 'GET', `/api/projects/${projectId}/search?q=server`);
  assert.equal(searchRes.status, 200);
  assert.ok(Array.isArray(searchRes.body.results));
  assert.ok(searchRes.body.results.some(r => r.name.includes('server.js')));
});
