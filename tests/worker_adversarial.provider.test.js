const test = require('node:test');

const scenarios = [
  'host file access', 'production environment secrets', 'cloud metadata', 'PostgreSQL access',
  'internal API access', 'DNS exfiltration', 'outbound HTTP', 'path traversal', 'symlink escape',
  'process exhaustion', 'memory exhaustion', 'disk exhaustion', 'output flooding', 'infinite loop',
  'execution timeout', 'cross-user workspace', 'execution after cancellation', 'persistent background process',
  'worker runtime modification', 'cross-job artifact access'
];

test('real Vercel Sandbox adversarial suite requires authorized provider credentials', { skip: process.env.TEST_VERCEL_SANDBOX !== '1' }, async (t) => {
  // Deliberately not simulated: each scenario must be implemented and observed
  // in an authorized provider account before the source-controlled release gate changes.
  for (const scenario of scenarios) {
    await t.test(scenario, { skip: 'Provider-backed attack implementation and credentials are not authorized in this environment.' }, () => {});
  }
});
