const test = require('node:test');
const assert = require('node:assert/strict');
const {
  TypedDependencyGraph,
  DependencyNode,
  DependencyEdge,
  EvidenceRecord,
  NodeKind,
  EdgeType,
  EvidenceSource,
  ValidationStatus
} = require('../src/impact/graph');
const { SourceCodeImpactAnalyzer } = require('../src/impact/analyzer');

test('TypedDependencyGraph: nodes, multi-evidence edges, and status reconciliation', () => {
  const graph = new TypedDependencyGraph('rev_001');

  const fileA = graph.addNode({
    id: 'file:src/orders.js',
    kind: NodeKind.FILE,
    name: 'src/orders.js',
    filePath: 'src/orders.js'
  });

  const fileB = graph.addNode({
    id: 'file:src/payments.js',
    kind: NodeKind.FILE,
    name: 'src/payments.js',
    filePath: 'src/payments.js'
  });

  // 1. Static AST evidence
  const edge = graph.addEdge({
    sourceId: fileA.id,
    targetId: fileB.id,
    type: EdgeType.IMPORTS,
    evidence: [new EvidenceRecord({
      source: EvidenceSource.STATIC_AST,
      revisionId: 'rev_001',
      status: ValidationStatus.STATICALLY_INFERRED,
      weight: 0.8
    })]
  });

  assert.equal(edge.status, ValidationStatus.STATICALLY_INFERRED);
  assert.equal(edge.isResolved, true);

  // 2. Corroborating with runtime trace upgrades status to CONFIRMED
  graph.addEvidence(fileA.id, fileB.id, EdgeType.IMPORTS, new EvidenceRecord({
    source: EvidenceSource.RUNTIME_TRACE,
    revisionId: 'rev_001',
    status: ValidationStatus.RUNTIME_OBSERVED,
    weight: 1.0
  }));

  const updatedEdge = graph.getEdge(fileA.id, fileB.id, EdgeType.IMPORTS);
  assert.equal(updatedEdge.status, ValidationStatus.CONFIRMED);
  assert.equal(updatedEdge.evidence.length, 2);

  // 3. Serialization and deserialization round-trip
  const json = graph.toJSON();
  assert.equal(json.metrics.nodeCount, 2);
  assert.equal(json.metrics.edgeCount, 1);
  assert.equal(json.metrics.statusCounts.confirmed, 1);

  const restored = TypedDependencyGraph.fromJSON(json);
  assert.equal(restored.nodes.size, 2);
  assert.equal(restored.edges.size, 1);
  assert.equal(restored.getNode(fileA.id).name, 'src/orders.js');
});

test('SourceCodeImpactAnalyzer: extracts files, functions, imports, tests, and config', () => {
  const analyzer = new SourceCodeImpactAnalyzer();

  const entries = [
    {
      path: 'src/service.js',
      content: `
        const config = process.env.DATABASE_PORT;
        const utils = require('./utils');
        
        async function processPayment(orderId) {
          return utils.calculateTax(orderId);
        }

        class PaymentGateway extends BaseGateway {}

        module.exports = { processPayment, PaymentGateway };
      `,
      bytes: 300,
      excludedReason: null
    },
    {
      path: 'src/utils.js',
      content: `
        function calculateTax(amount) {
          return amount * 0.18;
        }
        module.exports = { calculateTax };
      `,
      bytes: 120,
      excludedReason: null
    },
    {
      path: 'tests/service.test.js',
      content: `
        const { processPayment } = require('../src/service');
        test('processes payment successfully', async () => {
          assert.ok(true);
        });
      `,
      bytes: 180,
      excludedReason: null
    }
  ];

  const graph = analyzer.buildGraph(entries, 'rev_test_100');

  // Verify file nodes
  assert.ok(graph.hasNode('file:src/service.js'));
  assert.ok(graph.hasNode('file:src/utils.js'));
  assert.ok(graph.hasNode('file:tests/service.test.js'));

  // Verify function node
  assert.ok(graph.hasNode('fn:src/service.js#processPayment'));
  assert.ok(graph.hasNode('fn:src/utils.js#calculateTax'));

  // Verify class node
  assert.ok(graph.hasNode('class:src/service.js#PaymentGateway'));

  // Verify config key extraction
  assert.ok(graph.hasNode('config:DATABASE_PORT'));

  // Verify import edge between service and utils
  const importEdge = graph.getEdge('file:src/service.js', 'file:src/utils.js', EdgeType.IMPORTS);
  assert.ok(importEdge);
  assert.equal(importEdge.type, EdgeType.IMPORTS);

  // Verify test node and coverage edge
  assert.ok(graph.hasNode('test:tests/service.test.js#processes payment successfully'));
  const testNode = graph.getNode('test:tests/service.test.js#processes payment successfully');
  assert.equal(testNode.kind, NodeKind.TEST);

  const testCoverageEdges = graph.getOutEdges(testNode.id).filter((e) => e.type === EdgeType.COVERS);
  assert.ok(testCoverageEdges.length > 0);
  assert.equal(testCoverageEdges[0].targetId, 'file:src/service.js');
});
