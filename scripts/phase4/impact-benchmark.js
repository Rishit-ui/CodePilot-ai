const fs = require('node:fs');
const path = require('node:path');
const { performance } = require('node:perf_hooks');
const { SourceCodeImpactAnalyzer } = require('../../src/impact/analyzer');
const { EvidenceReconciler } = require('../../src/impact/reconcile');
const { RegressionTestSelector, SelectionStrategy } = require('../../src/impact/test-selector');
const { updateGraphIncrementally, verifyGraphEquivalence } = require('../../src/impact/invalidation');
const { ValidationStatus } = require('../../src/impact/graph');

const root = path.resolve(__dirname, '../..');
const dataset = JSON.parse(fs.readFileSync(path.join(root, 'benchmarks/impact-engine/dataset.json'), 'utf8'));

function entry(filePath, content) {
  return { path: filePath, content, bytes: Buffer.byteLength(content), excludedReason: null };
}

function controlledRepository() {
  return [
    entry('package.json', '{"name":"controlled-impact-fixture"}'),
    entry('src/core/database.js', 'function query(sql) { return [{ id: 1 }]; }\nmodule.exports = { query };'),
    entry('src/services/orderService.js', 'const db = require("../core/database");\nfunction getOrder(id) { return db.query(String(id)); }\nmodule.exports = { getOrder };'),
    entry('src/controllers/checkoutController.js', 'const orders = require("../services/orderService");\nfunction checkout(id) { return orders.getOrder(id); }\napp.post("/checkout", checkout);\nmodule.exports = { checkout };'),
    entry('src/utils/math.js', 'function add(a, b) { return a + b; }\nmodule.exports = { add };'),
    entry('src/utils/string.js', 'function upper(value) { return value.toUpperCase(); }\nmodule.exports = { upper };'),
    entry('tests/math.test.js', 'const math = require("../src/utils/math");\ntest("math regression", () => math.add(1, 2));'),
    entry('tests/string.test.js', 'const string = require("../src/utils/string");\ntest("string regression", () => string.upper("a"));'),
    entry('tests/checkout.test.js', 'const checkout = require("../src/controllers/checkoutController");\ntest("checkout regression", () => checkout.checkout(1));'),
    entry('tests/database.test.js', 'const db = require("../src/core/database");\ntest("database regression", () => db.query("select 1"));')
  ];
}

function selectedFiles(result) {
  return new Set(result.selectedTestFiles);
}

function classification(selected, truth, universe) {
  const expected = new Set(truth);
  let tp = 0; let fp = 0; let fn = 0; let tn = 0;
  for (const file of universe) {
    if (selected.has(file) && expected.has(file)) tp += 1;
    else if (selected.has(file)) fp += 1;
    else if (expected.has(file)) fn += 1;
    else tn += 1;
  }
  return {
    truePositive: tp, falsePositive: fp, falseNegative: fn, trueNegative: tn,
    accuracy: universe.length ? (tp + tn) / universe.length : 1,
    precision: tp + fp ? tp / (tp + fp) : 1,
    recall: tp + fn ? tp / (tp + fn) : 1,
    falsePositiveRate: fp + tn ? fp / (fp + tn) : 0,
    missedDependencyCount: fn
  };
}

function largeRepository(fileCount) {
  const entries = [entry('src/module0.js', 'function value0() { return 0; }\nmodule.exports = { value0 };')];
  for (let index = 1; index < fileCount; index += 1) {
    entries.push(entry(`src/module${index}.js`, `const previous = require("./module${index - 1}");\nfunction value${index}() { return previous.value${index - 1}() + 1; }\nmodule.exports = { value${index} };`));
  }
  for (let index = 0; index < fileCount; index += Math.max(1, Math.floor(fileCount / 10))) {
    entries.push(entry(`tests/module${index}.test.js`, `const subject = require("../src/module${index}");\ntest("module ${index}", () => subject.value${index}());`));
  }
  return entries;
}

function time(operation, iterations = 5) {
  const samples = [];
  let value;
  for (let index = 0; index < iterations; index += 1) {
    const started = performance.now();
    value = operation();
    samples.push(performance.now() - started);
  }
  return { value, samples, averageMs: samples.reduce((sum, sample) => sum + sample, 0) / samples.length };
}

function runBenchmark({ write = true } = {}) {
  const analyzer = new SourceCodeImpactAnalyzer();
  const reconciler = new EvidenceReconciler();
  const selector = new RegressionTestSelector();
  const entries = controlledRepository();
  const graph = analyzer.buildGraph(entries, 'benchmark-r1');
  reconciler.reconcileGraph(graph, [], 'benchmark-r1');
  const universe = [...new Set([...graph.nodes.values()].filter((node) => node.kind === 'test').map((node) => node.filePath))];
  const strategies = [SelectionStrategy.ALL, SelectionStrategy.CHANGED_FILE, SelectionStrategy.COVERAGE, SelectionStrategy.EVIDENCE_AWARE];

  const scenarios = dataset.scenarios.map((scenario) => {
    const active = graph.clone();
    if (scenario.injectConflict) {
      const edge = active.getEdge('file:src/services/orderService.js', 'file:src/core/database.js', 'imports');
      if (edge) {
        edge.evidence[0].status = ValidationStatus.CONFLICTED;
        edge.evidence[0].details = Object.freeze({ contradiction: true, reason: 'Controlled contradictory fixture' });
      }
    }
    if (scenario.invalidateEvidence) {
      for (const edge of active.edges.values()) {
        if (edge.sourceId.includes('database') || edge.targetId.includes('database')) {
          for (const evidence of edge.evidence) evidence.revisionId = 'benchmark-r0';
        }
      }
      active.revisionId = 'benchmark-r2';
    }
    reconciler.reconcileGraph(active, [], active.revisionId);
    const outcomes = {};
    for (const strategy of strategies) {
      const selection = selector.selectTests(active, scenario.changedFiles, strategy);
      const selected = selectedFiles(selection);
      outcomes[strategy] = {
        selectedTests: [...selected].sort(), selectedCount: selected.size,
        ...classification(selected, scenario.regressionTests, universe)
      };
    }
    return { ...scenario, outcomes };
  });

  const performanceResults = [];
  for (const size of [50, 200, 1000]) {
    const fixture = largeRepository(size);
    const heapBefore = process.memoryUsage().heapUsed;
    const full = time(() => analyzer.buildGraph(fixture, `large-${size}`), 3);
    const revised = fixture.map((item) => item.path === `src/module${size - 1}.js`
      ? entry(item.path, `${item.content}\n// controlled revision`) : item);
    const incremental = time(() => updateGraphIncrementally(full.value, fixture, revised, `large-${size}-r2`, { analyzer, reconciler }), 3);
    const rebuilt = analyzer.buildGraph(revised, `large-${size}-r2`);
    const equivalence = verifyGraphEquivalence(incremental.value.graph, rebuilt);
    performanceResults.push({
      sourceFileCount: size, totalFixtureFiles: fixture.length,
      graphNodes: full.value.nodes.size, graphEdges: full.value.edges.size,
      fullRebuildAverageMs: full.averageMs, incrementalAverageMs: incremental.averageMs,
      incrementalToFullRatio: incremental.averageMs / full.averageMs,
      heapDeltaBytes: process.memoryUsage().heapUsed - heapBefore,
      fullRebuildEquivalent: equivalence.isEquivalent,
      equivalenceDifferences: equivalence.differences
    });
  }

  const result = {
    generatedAt: new Date().toISOString(),
    datasetVersion: dataset.datasetVersion,
    environment: { node: process.version, platform: process.platform, architecture: process.arch, cpuCount: require('node:os').cpus().length },
    methodology: 'Controlled synthetic dependency mutations with independently declared expected regression-test sets.',
    scenarios,
    performance: performanceResults,
    limitations: dataset.limitations
  };
  if (write) {
    const output = path.join(root, 'results/impact-engine/phase4_benchmark_results.json');
    fs.mkdirSync(path.dirname(output), { recursive: true });
    fs.writeFileSync(output, JSON.stringify(result, null, 2));
  }
  return result;
}

if (require.main === module) console.log(JSON.stringify(runBenchmark(), null, 2));
module.exports = { runBenchmark, controlledRepository, classification };
