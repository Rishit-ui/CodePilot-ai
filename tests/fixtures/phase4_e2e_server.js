const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createApp } = require('../../src/server');

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codepilot-phase4-e2e-'));
const app = createApp({
  queuePublisher: { async publish(outbox) { return { messageId: `browser-${outbox.id}` }; } },
  config: {
    env: 'test', isProduction: false, host: '127.0.0.1', port: 3414, dataDir,
    sessionSecret: 'phase4-browser-session-secret-over-32-characters', authEnabled: true,
    ai: { provider: 'local', apiKey: '', model: 'local-deterministic', baseUrl: '' },
    deployment: { allowedProviders: ['mock'], renderApiKey: '', vercelToken: '', flyApiToken: '' },
    execution: { mode: 'disabled', releaseVerified: false, provider: 'disabled' },
    queue: { provider: 'disabled' }, storage: { provider: 'disabled' },
    limits: { maxUploadBytes: 10 * 1024 * 1024, maxExtractedBytes: 25 * 1024 * 1024, maxFiles: 1000, maxFileBytes: 2 * 1024 * 1024, maxCompressionRatio: 100, maxQuestionChars: 2000, maxSearchResults: 100, commandTimeoutMs: 10000 }
  }
});

app.server.listen(3414, '127.0.0.1', () => process.stdout.write('Phase 4 E2E server ready\n'));
async function shutdown() {
  app.server.close();
  await app.store.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
  process.exit(0);
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
