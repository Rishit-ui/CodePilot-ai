const crypto = require('node:crypto');
const { QueueClient } = require('@vercel/queue');
const { Store } = require('../db');
const { VercelSandboxProvider } = require('../execution/vercel_sandbox_provider');
const { ExecutionOrchestrator } = require('../execution/orchestrator');
const { JobConsumer } = require('./vercel_queue');

function queueRetryDirective(error, metadata) {
  if (error?.retryable === false) return { acknowledge: true };
  const attempts = Math.max(1, Number(metadata?.deliveryCount || 1));
  return { afterSeconds: Math.min(60, 2 ** Math.min(attempts, 5)) };
}

function buildQueueConsumer(config, dependencies = {}) {
  if (config.queue?.provider !== 'vercel-queues') throw new Error('Vercel Queue consumer requires CODEPILOT_QUEUE_PROVIDER=vercel-queues.');
  if (config.isProduction && !config.databaseUrl) throw new Error('A durable PostgreSQL database is required for the production Queue consumer.');
  const store = dependencies.store || new Store({ dataDir: config.dataDir, databaseUrl: config.databaseUrl, database: config.database, sessionSecret: config.sessionSecret });
  const executionEnabled = Boolean(config.execution.releaseVerified && config.execution.mode === 'external-worker' && config.execution.provider === 'vercel-sandbox');
  const provider = executionEnabled ? (dependencies.provider || new VercelSandboxProvider({
    timeoutMs: config.execution.timeoutMs,
    commandTimeoutMs: config.execution.commandTimeoutMs,
    outputBytes: config.execution.outputBytes,
    vcpus: config.execution.vcpus,
    maxFiles: config.limits.maxFiles,
    maxFileBytes: config.limits.maxFileBytes,
    maxWorkspaceBytes: config.limits.maxExtractedBytes
  })) : null;
  const orchestrator = executionEnabled ? (dependencies.orchestrator || new ExecutionOrchestrator({
    store,
    provider,
    workspaceLoader: async (job) => {
      if (!job.revision_id) throw new Error('Execution job has no immutable revision.');
      const files = await store.all('SELECT path, content, bytes, excluded_reason FROM files WHERE revision_id=? ORDER BY path', job.revision_id);
      return files.filter((file) => !file.excluded_reason && file.content !== null).map((file) => ({ path: file.path, content: Buffer.from(file.content, 'utf8') }));
    }
  })) : null;
  const consumer = dependencies.consumer || new JobConsumer({
    store,
    orchestrator,
    workerId: `vercel-${crypto.randomUUID()}`,
    expectedTopic: config.queue.topic,
    requireMetadata: true,
    executionEnabled,
    allowedJobTypes: ['test-execution']
  });
  const queueClient = dependencies.queueClient || new QueueClient({ region: config.queue.region });
  const nodeCallbackFactory = dependencies.nodeCallbackFactory || queueClient.handleNodeCallback;
  const handler = nodeCallbackFactory(
    async (message, metadata) => consumer.consume(message, metadata),
    {
      visibilityTimeoutSeconds: Math.min(3600, Math.max(90, Math.ceil((config.execution.commandTimeoutMs + 30_000) / 1000))),
      retry: queueRetryDirective
    }
  );
  handler.codepilot = { executionEnabled, topic: config.queue.topic, store, consumer };
  return handler;
}

module.exports = { buildQueueConsumer, queueRetryDirective };
