const test = require('node:test');
const assert = require('node:assert/strict');
const { ADVERSARIAL_SCENARIOS, HARNESS_STATUS, runAdversarialHarness } = require('../src/execution/adversarial_harness');
const { VercelSandboxAdversarialAdapter } = require('./providers/vercel_sandbox_adversarial_adapter');

test('20-scenario adversarial harness is complete and classifies unavailable provider evidence truthfully', async () => {
  assert.equal(ADVERSARIAL_SCENARIOS.length, 20);
  assert.deepEqual(ADVERSARIAL_SCENARIOS.map((scenario) => scenario.number), Array.from({ length: 20 }, (_, index) => index + 1));
  for (const scenario of ADVERSARIAL_SCENARIOS) {
    assert.ok(scenario.threat);
    assert.ok(scenario.attackFixture);
    assert.ok(scenario.expectedResult);
    assert.ok(scenario.providerDependency);
  }
  const report = await runAdversarialHarness();
  assert.equal(report.results.length, 20);
  assert.equal(report.summary[HARNESS_STATUS.PASS], 1);
  assert.equal(report.summary[HARNESS_STATUS.BLOCKED], 19);
  assert.equal(report.summary[HARNESS_STATUS.FAIL], 0);
  assert.equal(report.releaseEligible, false);
  assert.equal(report.results.find((result) => result.number === 8).status, HARNESS_STATUS.PASS);
  assert.ok(report.results.filter((result) => result.providerDependency.startsWith('Real Sandbox')).every((result) => result.status === HARNESS_STATUS.BLOCKED));
});

test('real Vercel Sandbox adversarial suite requires explicit provider and destructive-test authorization', { skip: process.env.TEST_VERCEL_SANDBOX !== '1', timeout: 45 * 60_000 }, async () => {
  const adapter = new VercelSandboxAdversarialAdapter();
  const report = await runAdversarialHarness({ adapter, destructive: process.env.TEST_SANDBOX_DESTRUCTIVE === '1' });
  const incomplete = report.results.filter((result) => result.status !== HARNESS_STATUS.PASS);
  assert.deepEqual(incomplete, [], `Sandbox release gate failed:\n${incomplete.map((result) => `${result.number}. ${result.threat}: ${result.status} — ${result.actualResult} (${result.evidence})`).join('\n')}`);
  assert.equal(report.releaseEligible, true);
});
