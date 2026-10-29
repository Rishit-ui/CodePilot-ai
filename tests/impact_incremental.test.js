const test = require('node:test');
const assert = require('node:assert/strict');
const {
  TypedDependencyGraph,
  EvidenceRecord,
  EvidenceSource,
  ValidationStatus,
  EdgeType
} = require('../src/impact/graph');
const { SourceCodeImpactAnalyzer } = require('../src/impact/analyzer');
const { EvidenceReconciler } = require('../src/impact/reconcile');
const {
  computeRevisionDiff,
  computeInvalidationCone,
  updateGraphIncrementally,
  verifyGraphEquivalence
} = require('../src/impact/invalidation');

test('EvidenceReconciler: handles corroboration, contracts, and contradictions deterministically', () => {
  const reconciler = new EvidenceReconciler();
  const graph = new TypedDependencyGraph('rev_100');

  graph.addNode({ id: 'file:src/a.js', kind: 'file', name: 'a.js' });
  graph.addNode({ id: 'file:src/b.js', kind: 'file', name: 'b.js' });

  // 1. Static AST edge
  const edge = graph.addEdge({
    sourceId: 'file:src/a.js',
    targetId: 'file:src/b.js',
    type: EdgeType.IMPORTS,
    evidence: [new EvidenceRecord({
      source: EvidenceSource.STATIC_AST,
      revisionId: 'rev_100',
      status: ValidationStatus.STATICALLY_INFERRED
    })]
  });

  reconciler.reconcileGraph(graph, [], 'rev_100');
  assert.equal(edge.status, ValidationStatus.STATICALLY_INFERRED);
  assert.equal(edge.isResolved, true);

  // 2. Corroborated with runtime trace -> CONFIRMED
  graph.addEvidence('file:src/a.js', 'file:src/b.js', EdgeType.IMPORTS, new EvidenceRecord({
    source: EvidenceSource.RUNTIME_TRACE,
    revisionId: 'rev_100',
    status: ValidationStatus.RUNTIME_OBSERVED
  }));

  reconciler.reconcileGraph(graph, [], 'rev_100');
  assert.equal(edge.status, ValidationStatus.CONFIRMED);
  assert.equal(edge.isResolved, true);

  // 3. Contradiction injection -> CONFLICTED
  graph.addEvidence('file:src/a.js', 'file:src/b.js', EdgeType.IMPORTS, new EvidenceRecord({
    source: EvidenceSource.RUNTIME_TRACE,
    revisionId: 'rev_100',
    status: ValidationStatus.CONFLICTED,
    details: { contradiction: true, reason: 'Method threw UnreachableRouteException' }
  }));

  reconciler.reconcileGraph(graph, [], 'rev_100');
  assert.equal(edge.status, ValidationStatus.CONFLICTED);
  assert.equal(edge.isResolved, false);
});

test('Incremental Graph Invalidation: matches full clean rebuild isomorphically', () => {
  const analyzer = new SourceCodeImpactAnalyzer();
  const reconciler = new EvidenceReconciler();

  // Initial Revision R0
  const entriesR0 = [
    {
      path: 'src/math.js',
      content: 'function add(a, b) { return a + b; }\nmodule.exports = { add };',
      bytes: 60,
      excludedReason: null
    },
    {
      path: 'src/calc.js',
      content: 'const math = require("./math");\nfunction compute(x) { return math.add(x, 10); }\nmodule.exports = { compute };',
      bytes: 110,
      excludedReason: null
    },
    {
      path: 'tests/calc.test.js',
      content: 'const calc = require("../src/calc");\ntest("calculates sum", () => { assert.equal(calc.compute(5), 15); });',
      bytes: 100,
      excludedReason: null
    }
  ];

  const graphR0 = analyzer.buildGraph(entriesR0, 'rev_0');
  reconciler.reconcileGraph(graphR0, [], 'rev_0');

  // Modified Revision R1: math.js adds a subtract function, calc.js is untouched, new helper.js added
  const entriesR1 = [
    {
      path: 'src/math.js',
      content: 'function add(a, b) { return a + b; }\nfunction sub(a, b) { return a - b; }\nmodule.exports = { add, sub };',
      bytes: 100,
      excludedReason: null
    },
    {
      path: 'src/calc.js',
      content: 'const math = require("./math");\nfunction compute(x) { return math.add(x, 10); }\nmodule.exports = { compute };',
      bytes: 110,
      excludedReason: null
    },
    {
      path: 'src/helper.js',
      content: 'function format(val) { return String(val); }\nmodule.exports = { format };',
      bytes: 75,
      excludedReason: null
    },
    {
      path: 'tests/calc.test.js',
      content: 'const calc = require("../src/calc");\ntest("calculates sum", () => { assert.equal(calc.compute(5), 15); });',
      bytes: 100,
      excludedReason: null
    }
  ];

  // 1. Perform Incremental Update
  const incrementalResult = updateGraphIncrementally(graphR0, entriesR0, entriesR1, 'rev_1', { analyzer, reconciler });
  assert.equal(incrementalResult.strategy, 'incremental-cone-update');

  // 2. Perform Clean Full Rebuild
  const fullRebuildGraph = analyzer.buildGraph(entriesR1, 'rev_1');
  reconciler.reconcileGraph(fullRebuildGraph, [], 'rev_1');

  // 3. Verify Absolute Equivalence
  const equiv = verifyGraphEquivalence(incrementalResult.graph, fullRebuildGraph);
  assert.equal(equiv.isEquivalent, true, `Differences found: ${equiv.differences.join('; ')}`);

  // Verify new symbol node was added
  assert.ok(incrementalResult.graph.hasNode('fn:src/math.js#sub'));
  assert.ok(incrementalResult.graph.hasNode('fn:src/helper.js#format'));
});
