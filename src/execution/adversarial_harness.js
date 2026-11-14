'use strict';

const { validateWorkspace } = require('./provider');

const HARNESS_STATUS = Object.freeze({ PASS: 'PASS', FAIL: 'FAIL', BLOCKED: 'BLOCKED', NOT_TESTED: 'NOT TESTED' });

const ADVERSARIAL_SCENARIOS = Object.freeze([
  { number: 1, id: 'host-filesystem', threat: 'Host filesystem access', attackFixture: 'Probe common host mount paths and mount metadata from inside the guest.', expectedResult: 'No host filesystem or host bind mount is visible.', providerDependency: 'Real Sandbox microVM required.' },
  { number: 2, id: 'environment-secrets', threat: 'Environment-secret access', attackFixture: 'Enumerate guest environment names and compare values to a one-time host-only canary hash.', expectedResult: 'Only the explicit minimal guest environment is present; no host secret/canary is visible.', providerDependency: 'Real Sandbox environment boundary required.' },
  { number: 3, id: 'database-access', threat: 'Database access', attackFixture: 'Attempt a TCP connection to the authorized staging database host without passing credentials.', expectedResult: 'Connection is denied by the Sandbox network policy.', providerDependency: 'Real Sandbox plus TEST_ADVERSARIAL_DB_HOST/PORT required.' },
  { number: 4, id: 'cloud-metadata', threat: 'Cloud metadata access', attackFixture: 'Request 169.254.169.254 metadata endpoints with a strict deadline.', expectedResult: 'Metadata traffic is denied.', providerDependency: 'Real Sandbox network enforcement required.' },
  { number: 5, id: 'private-network', threat: 'Private network access', attackFixture: 'Attempt TCP connections to representative RFC1918 addresses.', expectedResult: 'All private-network connections are denied.', providerDependency: 'Real Sandbox network enforcement required.' },
  { number: 6, id: 'outbound-http', threat: 'Unrestricted outbound HTTP', attackFixture: 'Attempt HTTPS and HTTP requests to public endpoints.', expectedResult: 'All outbound requests are denied under deny-all.', providerDependency: 'Real Sandbox network enforcement required.' },
  { number: 7, id: 'dns-exfiltration', threat: 'DNS-based exfiltration', attackFixture: 'Attempt public A-record resolution.', expectedResult: 'DNS resolution is denied under deny-all.', providerDependency: 'Real Sandbox DNS/network enforcement required.' },
  { number: 8, id: 'path-traversal', threat: 'Path traversal', attackFixture: 'Submit parent-relative, absolute, drive-qualified, and NUL workspace paths.', expectedResult: 'Adapter validation rejects every path before provider upload.', providerDependency: 'Local adapter validation; no provider required.', local: true },
  { number: 9, id: 'symlink-escape', threat: 'Symlink escape', attackFixture: 'Create links toward common host-mount locations and attempt reads/writes.', expectedResult: 'No host target is reachable; all effects remain in the disposable guest.', providerDependency: 'Real Sandbox filesystem boundary required.' },
  { number: 10, id: 'process-exhaustion', threat: 'Process exhaustion', attackFixture: 'Spawn a high bounded number of sleeping children and attempt to reach the process ceiling.', expectedResult: 'Load remains contained and cleanup destroys all children.', providerDependency: 'Real Sandbox; TEST_SANDBOX_DESTRUCTIVE=1 required.' },
  { number: 11, id: 'memory-exhaustion', threat: 'Memory exhaustion', attackFixture: 'Commit memory repeatedly until the guest limit terminates or rejects the process.', expectedResult: 'Failure remains confined to the guest and the worker can be terminated.', providerDependency: 'Real Sandbox; TEST_SANDBOX_DESTRUCTIVE=1 required.' },
  { number: 12, id: 'disk-exhaustion', threat: 'Disk exhaustion', attackFixture: 'Write bounded large chunks until the provider disk ceiling returns ENOSPC or stops the workload.', expectedResult: 'Failure remains confined to the guest and storage is deleted.', providerDependency: 'Real Sandbox; TEST_SANDBOX_DESTRUCTIVE=1 required.' },
  { number: 13, id: 'output-flooding', threat: 'Output flooding', attackFixture: 'Emit output above the configured collection ceiling.', expectedResult: 'Reported bytes are real and collected output is truncated at the configured ceiling.', providerDependency: 'Real Sandbox command output required.' },
  { number: 14, id: 'infinite-execution', threat: 'Infinite execution', attackFixture: 'Run a non-yielding infinite loop with a short command deadline.', expectedResult: 'The command is killed by its deadline and is never reported as passed.', providerDependency: 'Real Sandbox command timeout required.' },
  { number: 15, id: 'timeout-enforcement', threat: 'Timeout enforcement', attackFixture: 'Run beyond the Sandbox session lifetime.', expectedResult: 'The provider stops the session and the harness records the real failure.', providerDependency: 'Real Sandbox session timeout required.' },
  { number: 16, id: 'cross-user-workspace', threat: 'Cross-user workspace access', attackFixture: 'Place unique markers in two separately created user sandboxes and probe across them.', expectedResult: 'Neither sandbox can see the other marker.', providerDependency: 'Two real non-persistent Sandboxes required.' },
  { number: 17, id: 'cross-job-artifact', threat: 'Cross-job artifact access', attackFixture: 'Place a unique artifact marker in one job sandbox and probe from another.', expectedResult: 'The second job cannot read the first job artifact.', providerDependency: 'Two real non-persistent Sandboxes required.' },
  { number: 18, id: 'background-persistence', threat: 'Background-process persistence', attackFixture: 'Start a detached heartbeat process, then stop and delete the Sandbox.', expectedResult: 'The deleted non-persistent Sandbox cannot continue or be resumed.', providerDependency: 'Real Sandbox lifecycle required.' },
  { number: 19, id: 'cancellation-failure', threat: 'Cancellation failure', attackFixture: 'Abort an active long-running command and then destroy the Sandbox.', expectedResult: 'The command is interrupted and cleanup succeeds.', providerDependency: 'Real Sandbox AbortSignal behavior required.' },
  { number: 20, id: 'worker-termination-failure', threat: 'Worker termination failure', attackFixture: 'Stop/delete a Sandbox and attempt command execution and lookup afterward.', expectedResult: 'The instance is inert and cannot be recovered after deletion.', providerDependency: 'Real Sandbox lifecycle required.' }
]);

function sanitizeEvidence(value) {
  return String(value || '')
    .replace(/(password|secret|token|authorization|api[_-]?key)\s*[:=]\s*[^\s,;]+/gi, '$1=[REDACTED]')
    .slice(0, 4000);
}

function localPathTraversalResult() {
  const limits = { maxFiles: 10, maxFileBytes: 1024, maxWorkspaceBytes: 4096 };
  const attacks = ['../escape', '/absolute', 'C:/drive', 'nested/../../escape', 'nul\0path'];
  const rejected = attacks.map((candidate) => {
    try { validateWorkspace([{ path: candidate, content: Buffer.from('attack') }], limits); return false; } catch { return true; }
  });
  const passed = rejected.every(Boolean);
  return {
    status: passed ? HARNESS_STATUS.PASS : HARNESS_STATUS.FAIL,
    actualResult: passed ? 'All unsafe workspace paths were rejected before provider upload.' : 'At least one unsafe workspace path was accepted.',
    evidence: `rejected=${rejected.filter(Boolean).length}/${attacks.length}`
  };
}

async function runAdversarialHarness({ adapter = null, destructive = false } = {}) {
  const results = [];
  for (const scenario of ADVERSARIAL_SCENARIOS) {
    let outcome;
    if (scenario.local) {
      outcome = localPathTraversalResult();
    } else if (!adapter) {
      outcome = { status: HARNESS_STATUS.BLOCKED, actualResult: 'No authorized real Sandbox adapter is available.', evidence: 'Provider call not attempted.' };
    } else if ([10, 11, 12].includes(scenario.number) && !destructive) {
      outcome = { status: HARNESS_STATUS.BLOCKED, actualResult: 'Destructive resource-boundary test was not authorized.', evidence: 'Set TEST_SANDBOX_DESTRUCTIVE=1 only with an approved cost/risk window.' };
    } else {
      try {
        outcome = await adapter.runScenario(scenario, { destructive });
      } catch (error) {
        outcome = { status: HARNESS_STATUS.FAIL, actualResult: 'Harness or provider call failed unexpectedly.', evidence: `${error.name || 'Error'}: ${error.message || 'unknown error'}` };
      }
    }
    const status = Object.values(HARNESS_STATUS).includes(outcome?.status) ? outcome.status : HARNESS_STATUS.FAIL;
    results.push({
      ...scenario,
      status,
      actualResult: sanitizeEvidence(outcome?.actualResult || 'No result was returned.'),
      evidence: sanitizeEvidence(outcome?.evidence || 'No evidence was returned.')
    });
  }
  return {
    generatedAt: new Date().toISOString(),
    provider: adapter?.name || null,
    results,
    summary: Object.fromEntries(Object.values(HARNESS_STATUS).map((status) => [status, results.filter((result) => result.status === status).length])),
    releaseEligible: results.length === 20 && results.every((result) => result.status === HARNESS_STATUS.PASS)
  };
}

module.exports = { ADVERSARIAL_SCENARIOS, HARNESS_STATUS, runAdversarialHarness, sanitizeEvidence, localPathTraversalResult };
