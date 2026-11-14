const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './tests/e2e',
  timeout: 30_000,
  retries: 0,
  workers: 1,
  reporter: [['list'], ['json', { outputFile: 'results/phase6/playwright-results.json' }]],
  use: {
    baseURL: 'http://127.0.0.1:3414',
    channel: 'msedge',
    headless: true,
    viewport: { width: 1440, height: 1000 },
    trace: 'retain-on-failure'
  },
  webServer: {
    command: 'node tests/fixtures/phase4_e2e_server.js',
    url: 'http://127.0.0.1:3414/api/health',
    reuseExistingServer: false,
    timeout: 30_000,
    gracefulShutdown: { signal: 'SIGTERM', timeout: 1_000 }
  }
});
