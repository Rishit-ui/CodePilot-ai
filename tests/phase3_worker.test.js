const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Store } = require('../src/db');
const { executionProfile, validateWorkspace } = require('../src/execution/provider');
const { ExecutionOrchestrator } = require('../src/execution/orchestrator');
const { VercelSandboxProvider } = require('../src/execution/vercel_sandbox_provider');

test('execution profiles reject browser-supplied arbitrary commands and unsafe workspaces', () => {
  assert.deepEqual(executionProfile('node-test').args, ['test']);
  assert.throws(() => executionProfile('rm -rf /'), /Unsupported execution profile/);
  assert.throws(() => validateWorkspace([{ path: '../escape', content: Buffer.from('x') }], { maxFiles: 10, maxFileBytes: 10, maxWorkspaceBytes: 10 }), /Unsafe workspace path/);
});

test('Vercel adapter bounds collected output without inventing command results', async () => {
  const provider = new VercelSandboxProvider({ outputBytes: 1024 });
  const result = await provider.collectOutput(null, {
    exitCode: 9, durationMs: 27,
    async stdout() { return 'x'.repeat(2000); },
    async stderr() { return 'actual stderr'; }
  });
  assert.equal(result.exitCode, 9);
  assert.equal(result.durationMs, 27);
  assert.equal(result.outputTruncated, true);
  assert.match(result.output, /OUTPUT TRUNCATED/);
});

test('orchestrator records only actual output and always terminates the ephemeral provider', async (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codepilot-phase3-worker-'));
  const store = new Store(dataDir);
  t.after(async () => { await store.close(); fs.rmSync(dataDir, { recursive: true, force: true }); });
  const owner = await store.createUser('worker-owner@example.com', 'Owner', 'StrongPass!123');
  const project = await store.createProject('Worker', '', null, owner.id);
  const created = await store.createWorkflowJob({ projectId: project.id, actorId: owner.id, jobType: 'test-execution', executionProfile: 'node-test', idempotencyKey: 'worker:actual-result', topic: 'jobs' });
  await store.markJobDispatched(created.job.id, 'msg-worker');
  const claimed = await store.claimExecutionJob(created.job.id, 'worker-test', 60000);
  const events = [];
  const provider = {
    name: 'fake-unit-provider',
    async createSandbox() { events.push('create'); return { id: 'sandbox-unit' }; },
    async uploadWorkspace(_handle, files) { events.push(`upload:${files.length}`); },
    async executeCommand() { events.push('execute'); return { exitCode: 7, durationMs: 12 }; },
    async collectOutput(_handle, command) { return { ...command, output: 'real failing output', outputTruncated: false }; },
    async collectArtifacts() { return []; },
    async terminateSandbox() { events.push('terminate'); }
  };
  const orchestrator = new ExecutionOrchestrator({ store, provider, workspaceLoader: async () => [{ path: 'package.json', content: Buffer.from('{}') }] });
  const completed = await orchestrator.execute(claimed, 'worker-test');
  const result = JSON.parse(completed.result_json);
  assert.equal(result.status, 'FAIL');
  assert.equal(result.exitCode, 7);
  assert.equal(result.executed, true);
  assert.deepEqual(events, ['create', 'upload:1', 'execute', 'terminate']);
});

test('orchestrator failure never becomes success and still terminates the provider', async (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codepilot-phase3-worker-fail-'));
  const store = new Store(dataDir);
  t.after(async () => { await store.close(); fs.rmSync(dataDir, { recursive: true, force: true }); });
  const owner = await store.createUser('worker-fail@example.com', 'Owner', 'StrongPass!123');
  const project = await store.createProject('Worker fail', '', null, owner.id);
  const created = await store.createWorkflowJob({ projectId: project.id, actorId: owner.id, jobType: 'test-execution', executionProfile: 'node-test', idempotencyKey: 'worker:failure-result', maxAttempts: 1, topic: 'jobs' });
  await store.markJobDispatched(created.job.id, 'msg-fail');
  const claimed = await store.claimExecutionJob(created.job.id, 'worker-fail', 60000);
  let terminated = false;
  const provider = { name: 'fake-unit-provider', async createSandbox() { return { id: 'sandbox-fail' }; }, async uploadWorkspace() {}, async executeCommand() { throw new Error('provider exploded'); }, async terminateSandbox() { terminated = true; } };
  const orchestrator = new ExecutionOrchestrator({ store, provider, workspaceLoader: async () => [] });
  await assert.rejects(() => orchestrator.execute(claimed, 'worker-fail'), /provider exploded/);
  assert.equal(terminated, true);
  assert.equal((await store.get('SELECT status FROM execution_jobs WHERE id=?', claimed.id)).status, 'FAILED');
});
