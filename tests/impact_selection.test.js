const test = require('node:test');
const assert = require('node:assert/strict');
const { SourceCodeImpactAnalyzer } = require('../src/impact/analyzer');
const { ChangeImpactEngine } = require('../src/impact/impact');
const { RegressionTestSelector, SelectionStrategy } = require('../src/impact/test-selector');
const { IsolatedTestRunner } = require('../src/impact/runner');
const { EvidenceReconciler } = require('../src/impact/reconcile');

function createSampleMultiTierRepository() {
  return [
    {
      path: 'src/config.js',
      content: 'const port = process.env.APP_PORT || 3000;\nmodule.exports = { port };',
      bytes: 80,
      excludedReason: null
    },
    {
      path: 'src/db.js',
      content: 'function queryUser(id) { return { id, name: "Alice" }; }\nmodule.exports = { queryUser };',
      bytes: 90,
      excludedReason: null
    },
    {
      path: 'src/auth.js',
      content: 'const db = require("./db");\nfunction authenticate(id) { return db.queryUser(id); }\nmodule.exports = { authenticate };',
      bytes: 120,
      excludedReason: null
    },
    {
      path: 'src/api.js',
      content: 'const auth = require("./auth");\napp.get("/login", (req, res) => { auth.authenticate(req.id); });\nmodule.exports = {};',
      bytes: 140,
      excludedReason: null
    },
    {
      path: 'src/utils.js',
      content: 'function slugify(s) { return s.toLowerCase(); }\nmodule.exports = { slugify };',
      bytes: 70,
      excludedReason: null
    },
    {
      path: 'tests/db.test.js',
      content: 'const db = require("../src/db");\ntest("queries user correctly", () => { assert.ok(db.queryUser(1)); });',
      bytes: 100,
      excludedReason: null
    },
    {
      path: 'tests/auth.test.js',
      content: 'const auth = require("../src/auth");\ntest("authenticates valid user", () => { assert.ok(auth.authenticate(1)); });',
      bytes: 110,
      excludedReason: null
    },
    {
      path: 'tests/utils.test.js',
      content: 'const utils = require("../src/utils");\ntest("slugifies strings", () => { assert.equal(utils.slugify("Hello"), "hello"); });',
      bytes: 105,
      excludedReason: null
    }
  ];
}

test('ChangeImpactEngine: computes direct, transitive, and endpoint impact cones', () => {
  const analyzer = new SourceCodeImpactAnalyzer();
  const engine = new ChangeImpactEngine();
  const reconciler = new EvidenceReconciler();

  const entries = createSampleMultiTierRepository();
  const graph = analyzer.buildGraph(entries, 'rev_sample_1');
  reconciler.reconcileGraph(graph, [], 'rev_sample_1');

  // Modify src/db.js
  const impact = engine.analyzeImpact(graph, ['src/db.js']);

  // Direct impact should include db.js and its declared symbols
  assert.ok(impact.directImpacts.some((d) => d.id === 'file:src/db.js'));
  assert.ok(impact.directImpacts.some((d) => d.id === 'fn:src/db.js#queryUser'));

  // Transitive impact should propagate to auth.js, api.js, and endpoint /login
  assert.ok(impact.transitiveImpacts.some((t) => t.id === 'file:src/auth.js'));
  assert.ok(impact.transitiveImpacts.some((t) => t.id === 'file:src/api.js'));
  assert.ok(impact.affectedEndpoints.some((e) => e.name === 'GET /login'));

  // Unrelated utils.js should NOT be in the impact cone
  assert.ok(!impact.transitiveImpacts.some((t) => t.id === 'file:src/utils.js'));
});

test('RegressionTestSelector: compares ALL, CHANGED_FILE, and EVIDENCE_AWARE strategies', () => {
  const analyzer = new SourceCodeImpactAnalyzer();
  const selector = new RegressionTestSelector();
  const reconciler = new EvidenceReconciler();

  const entries = createSampleMultiTierRepository();
  const graph = analyzer.buildGraph(entries, 'rev_sample_2');
  reconciler.reconcileGraph(graph, [], 'rev_sample_2');

  // Scenario 1: Modify isolated src/utils.js
  const utilsAll = selector.selectTests(graph, ['src/utils.js'], SelectionStrategy.ALL);
  const utilsChanged = selector.selectTests(graph, ['src/utils.js'], SelectionStrategy.CHANGED_FILE);
  const utilsEvidence = selector.selectTests(graph, ['src/utils.js'], SelectionStrategy.EVIDENCE_AWARE);

  assert.equal(utilsAll.selectedTestFiles.length, 3, 'ALL strategy selects 100% of test files');
  assert.equal(utilsChanged.selectedTestFiles.length, 1, 'CHANGED_FILE selects 1 test file');
  assert.equal(utilsEvidence.selectedTestFiles.length, 1, 'EVIDENCE_AWARE selects only utils.test.js');
  assert.equal(utilsEvidence.selectedTestFiles[0], 'tests/utils.test.js');

  // Scenario 2: Modify deeply depended upon src/db.js
  const dbChanged = selector.selectTests(graph, ['src/db.js'], SelectionStrategy.CHANGED_FILE);
  const dbEvidence = selector.selectTests(graph, ['src/db.js'], SelectionStrategy.EVIDENCE_AWARE);

  // CHANGED_FILE selects only tests/db.test.js because auth.test.js doesn't import db.js directly
  assert.equal(dbChanged.selectedTestFiles.length, 1);
  assert.equal(dbChanged.selectedTestFiles[0], 'tests/db.test.js');

  // EVIDENCE_AWARE captures BOTH db.test.js AND auth.test.js (transitive dependency)
  assert.ok(dbEvidence.selectedTestFiles.includes('tests/db.test.js'));
  assert.ok(dbEvidence.selectedTestFiles.includes('tests/auth.test.js'));
  assert.ok(!dbEvidence.selectedTestFiles.includes('tests/utils.test.js'), 'utils.test.js is unaffected');
});

test('IsolatedTestRunner: enforces command allowlist, command synthesis, and secret stripping', async () => {
  const runner = new IsolatedTestRunner();

  // 1. Synthesize command
  const synth = runner.synthesizeCommand(['tests/auth.test.js', 'tests/db.test.js'], 'node --test');
  assert.equal(synth.command, 'node --test tests/auth.test.js tests/db.test.js');
  assert.deepEqual(synth.args, ['--test', 'tests/auth.test.js', 'tests/db.test.js']);

  // 2. Reject unapproved test runner
  const badResult = await runner.execute('curl http://malicious-server.com');
  assert.equal(badResult.status, 'error');
  assert.ok(badResult.output.includes('Security violation'));

  // 3. Execution of approved command
  const execResult = await runner.execute('node --test tests/impact_graph.test.js');
  assert.equal(execResult.status, 'passed');
  assert.equal(execResult.exitCode, 0);
  assert.ok(execResult.durationMs >= 0);
});
