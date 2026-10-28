const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const { createApp } = require('../src/server');

test('Engineering Operations & Lifecycle Events API', async () => {
  const tmpDir = path.join(__dirname, '..', '.data_test_ops_' + Date.now());
  const app = createApp({
    config: {
      dataDir: tmpDir,
      databaseUrl: null,
      authEnabled: false,
      ai: { provider: 'local' },
      limits: { maxQuestionChars: 2000 }
    }
  });

  try {
    // 1. Create project
    const project = await app.store.createProject('Ops Project Test', 'Testing Operations Lifecycle');
    assert.ok(project.id);

    // 2. Launch operation
    const op = await app.store.createOperation(
      project.id,
      null,
      'repository-analysis',
      'AST Architecture Scan',
      { scope: 'full' }
    );
    assert.ok(op.id);
    assert.equal(op.status, 'running');
    assert.equal(op.stage, 'initialization');
    assert.equal(op.events.length, 1);

    // 3. Add lifecycle events & update progress
    await app.store.addOperationEvent(op.id, 'file-discovery', 'Discovered 14 files in repository tree');
    await app.store.updateOperation(op.id, { stage: 'file-discovery', progress: 25 });

    await app.store.addOperationEvent(op.id, 'ast-parsing', 'Extracted 42 symbols and 8 API routes');
    await app.store.updateOperation(op.id, {
      status: 'completed',
      stage: 'completed',
      progress: 100,
      summary: 'Architecture analysis ready.'
    });

    // 4. Retrieve operation details and verify event history
    const fetched = await app.store.getOperation(op.id);
    assert.equal(fetched.status, 'completed');
    assert.equal(fetched.progress, 100);
    assert.equal(fetched.summary, 'Architecture analysis ready.');
    assert.equal(fetched.events.length, 3);
    assert.equal(fetched.events[1].stage, 'file-discovery');
    assert.equal(fetched.events[2].stage, 'ast-parsing');

    // 5. List operations for project
    const list = await app.store.listOperations(project.id);
    assert.equal(list.length, 1);
    assert.equal(list[0].id, op.id);
  } finally {
    if (app.store && app.store.close) app.store.close();
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
  }
});
