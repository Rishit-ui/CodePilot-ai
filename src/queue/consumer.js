const crypto = require('node:crypto');
const { handleCallback } = require('@vercel/queue');
const { Store } = require('../db');
const { VercelSandboxProvider } = require('../execution/vercel_sandbox_provider');
const { ExecutionOrchestrator } = require('../execution/orchestrator');
const { JobConsumer } = require('./vercel_queue');

function queueRetryDirective(error, metadata) {
  if (error?.retryable === false) return { acknowledge: true };
  const attempts = Math.max(1, Number(metadata?.deliveryCount || 1));
  return { afterSeconds: Math.min(60, 2 ** Math.min(attempts, 5)) };
}

function buildQueueConsumer(config) {
  if (!config.execution.releaseVerified || config.execution.mode !== 'external-worker' || config.execution.provider !== 'vercel-sandbox') {
    throw new Error('Execution consumer is release-blocked until real-provider adversarial verification passes.');
  }
  const store = new Store({ dataDir: config.dataDir, databaseUrl: config.databaseUrl, database: config.database, sessionSecret: config.sessionSecret });
  const provider = new VercelSandboxProvider({
    timeoutMs: config.execution.timeoutMs,
    commandTimeoutMs: config.execution.commandTimeoutMs,
    outputBytes: config.execution.outputBytes,
    vcpus: config.execution.vcpus,
    maxFiles: config.limits.maxFiles,
    maxFileBytes: config.limits.maxFileBytes,
    maxWorkspaceBytes: config.limits.maxExtractedBytes
  });
  const orchestrator = new ExecutionOrchestrator({
    store,
    provider,
    workspaceLoader: async (job) => {
      if (!job.revision_id) throw new Error('Execution job has no immutable revision.');
      const files = await store.all('SELECT path, content, bytes, excluded_reason FROM files WHERE revision_id=? ORDER BY path', job.revision_id);
      return files.filter((file) => !file.excluded_reason && file.content !== null).map((file) => ({ path: file.path, content: Buffer.from(file.content, 'utf8') }));
    }
  });
  const consumer = new JobConsumer({ store, orchestrator, workerId: `vercel-${crypto.randomUUID()}` });
  return handleCallback(
    async (message) => consumer.consume(message),
    {
      visibilityTimeoutSeconds: 90,
      retry: queueRetryDirective
    }
  );
}

module.exports = { buildQueueConsumer, queueRetryDirective };
