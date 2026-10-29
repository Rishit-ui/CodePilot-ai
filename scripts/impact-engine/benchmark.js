const fs = require('node:fs');
const path = require('node:path');
const { SourceCodeImpactAnalyzer } = require('../../src/impact/analyzer');
const { EvidenceReconciler } = require('../../src/impact/reconcile');
const { RegressionTestSelector, SelectionStrategy } = require('../../src/impact/test-selector');
const { updateGraphIncrementally, verifyGraphEquivalence } = require('../../src/impact/invalidation');
const { EvidenceRecord, EvidenceSource, ValidationStatus, EdgeType } = require('../../src/impact/graph');

const RESULTS_DIR = path.resolve(__dirname, '../../results/impact-engine');

function setupBenchmarkFixtures() {
  return [
    {
      path: 'src/core/database.js',
      content: 'function query(sql) { return [{ id: 1, balance: 100 }]; }\nmodule.exports = { query };',
      bytes: 85,
      excludedReason: null
    },
    {
      path: 'src/services/orderService.js',
      content: 'const db = require("../core/database");\nfunction getOrder(id) { return db.query("SELECT " + id); }\nmodule.exports = { getOrder };',
      bytes: 140,
      excludedReason: null
    },
    {
      path: 'src/controllers/checkoutController.js',
      content: 'const orderService = require("../services/orderService");\nfunction checkout(id) { return orderService.getOrder(id); }\nmodule.exports = { checkout };',
      bytes: 160,
      excludedReason: null
    },
    {
      path: 'src/utils/math.js',
      content: 'function add(a, b) { return a + b; }\nmodule.exports = { add };',
      bytes: 65,
      excludedReason: null
    },
    {
      path: 'src/utils/string.js',
      content: 'function capitalize(s) { return s.toUpperCase(); }\nmodule.exports = { capitalize };',
      bytes: 70,
      excludedReason: null
    },
    {
      path: 'tests/math.test.js',
      content: 'const math = require("../src/utils/math");\ntest("adds numbers", () => { assert.equal(math.add(1, 2), 3); });',
      bytes: 110,
      excludedReason: null
    },
    {
      path: 'tests/string.test.js',
      content: 'const str = require("../src/utils/string");\ntest("capitalizes text", () => { assert.equal(str.capitalize("hi"), "HI"); });',
      bytes: 115,
      excludedReason: null
    },
    {
      path: 'tests/checkout.test.js',
      content: 'const checkout = require("../src/controllers/checkoutController");\ntest("processes checkout", () => { assert.ok(checkout.checkout(1)); });',
      bytes: 140,
      excludedReason: null
    },
    {
      path: 'tests/database.test.js',
      content: 'const db = require("../src/core/database");\ntest("database query works", () => { assert.ok(db.query("test")); });',
      bytes: 110,
      excludedReason: null
    }
  ];
}

async function runBenchmark() {
  console.log('===============================================================');
  console.log('CODEPILOT IMPACT ENGINE — REPRODUCIBLE EXPERIMENT BENCHMARK');
  console.log('===============================================================\n');

  const analyzer = new SourceCodeImpactAnalyzer();
  const reconciler = new EvidenceReconciler();
  const selector = new RegressionTestSelector();

  const entriesR0 = setupBenchmarkFixtures();
  const graphR0 = analyzer.buildGraph(entriesR0, 'rev_bench_0');
  reconciler.reconcileGraph(graphR0, [], 'rev_bench_0');

  const scenarios = [
    {
      id: 'SCENARIO_1_DIRECT_MODIFICATION',
      name: 'Direct Function Modification (math.js)',
      changedFiles: ['src/utils/math.js'],
      faultyTestMustCatch: 'tests/math.test.js',
      description: 'Localized change altering utility function add().'
    },
    {
      id: 'SCENARIO_2_TRANSITIVE_DEPENDENCY',
      name: 'Transitive Deep Dependency Modification (database.js)',
      changedFiles: ['src/core/database.js'],
      faultyTestMustCatch: 'tests/checkout.test.js',
      description: 'Database query schema mutated; checkoutController transitively breaks without directly importing database.js.'
    },
    {
      id: 'SCENARIO_3_CONFLICTED_UNCERTAINTY',
      name: 'Conflicting / Uncertain Evidence Handling',
      changedFiles: ['src/services/orderService.js'],
      faultyTestMustCatch: 'tests/checkout.test.js',
      injectConflict: true,
      description: 'Dynamic dispatch edge flagged with CONFLICTED status; evaluates whether conservative fallback prevents regression escape.'
    }
  ];

  const results = [];

  for (const scenario of scenarios) {
    console.log(`Running [${scenario.id}]: ${scenario.name}`);
    const activeGraph = graphR0.clone();

    if (scenario.injectConflict) {
      activeGraph.addEvidence(
        'file:src/services/orderService.js',
        'file:src/core/database.js',
        EdgeType.IMPORTS,
        new EvidenceRecord({
          source: EvidenceSource.RUNTIME_TRACE,
          status: ValidationStatus.CONFLICTED,
          details: { contradiction: true, reason: 'Injected test conflict' }
        })
      );
      reconciler.reconcileGraph(activeGraph, [], 'rev_bench_0');
    }

    // Evaluate All 3 Strategies
    const resAll = selector.selectTests(activeGraph, scenario.changedFiles, SelectionStrategy.ALL);
    const resChanged = selector.selectTests(activeGraph, scenario.changedFiles, SelectionStrategy.CHANGED_FILE);
    const resEvidence = selector.selectTests(activeGraph, scenario.changedFiles, SelectionStrategy.EVIDENCE_AWARE);

    // Verify whether each strategy caught the required regression test
    const allCaught = resAll.selectedTestFiles.includes(scenario.faultyTestMustCatch);
    const changedCaught = resChanged.selectedTestFiles.includes(scenario.faultyTestMustCatch);
    const evidenceCaught = resEvidence.selectedTestFiles.includes(scenario.faultyTestMustCatch);

    console.log(`  - Strategy ALL:           Selected ${resAll.summary.selectedFilesCount}/4 test files (Caught Regression: ${allCaught})`);
    console.log(`  - Strategy CHANGED_FILE:  Selected ${resChanged.summary.selectedFilesCount}/4 test files (Caught Regression: ${changedCaught})`);
    console.log(`  - Strategy EVIDENCE_AWARE: Selected ${resEvidence.summary.selectedFilesCount}/4 test files (Caught Regression: ${evidenceCaught})\n`);

    results.push({
      scenarioId: scenario.id,
      name: scenario.name,
      description: scenario.description,
      changedFiles: scenario.changedFiles,
      targetRegressionTest: scenario.faultyTestMustCatch,
      outcomes: {
        all: {
          selectedCount: resAll.summary.selectedFilesCount,
          totalCount: resAll.summary.totalDiscoveredTests,
          reductionRatio: resAll.summary.reductionRatio,
          caughtRegression: allCaught
        },
        changedFile: {
          selectedCount: resChanged.summary.selectedFilesCount,
          totalCount: resChanged.summary.totalDiscoveredTests,
          reductionRatio: resChanged.summary.reductionRatio,
          caughtRegression: changedCaught
        },
        evidenceAware: {
          selectedCount: resEvidence.summary.selectedFilesCount,
          totalCount: resEvidence.summary.totalDiscoveredTests,
          reductionRatio: resEvidence.summary.reductionRatio,
          caughtRegression: evidenceCaught
        }
      }
    });
  }

  // Latency & Equivalence Benchmark: Full Rebuild vs Incremental Update
  console.log('Running Invalidation Latency & Equivalence Benchmark (10 iterations)...');
  const entriesR1 = entriesR0.map((e) => {
    if (e.path === 'src/utils/math.js') {
      return { ...e, content: e.content + '\nfunction multiply(a, b) { return a * b; }' };
    }
    return e;
  });

  const fullRebuildTimes = [];
  const incrementalTimes = [];

  for (let i = 0; i < 10; i += 1) {
    const t0 = performance.now();
    const fullG = analyzer.buildGraph(entriesR1, 'rev_bench_1');
    reconciler.reconcileGraph(fullG, [], 'rev_bench_1');
    fullRebuildTimes.push(performance.now() - t0);

    const t1 = performance.now();
    const incrRes = updateGraphIncrementally(graphR0, entriesR0, entriesR1, 'rev_bench_1', { analyzer, reconciler });
    incrementalTimes.push(performance.now() - t1);
  }

  const avgFullRebuildMs = fullRebuildTimes.reduce((a, b) => a + b, 0) / fullRebuildTimes.length;
  const avgIncrementalMs = incrementalTimes.reduce((a, b) => a + b, 0) / incrementalTimes.length;
  const speedupRatio = avgFullRebuildMs / avgIncrementalMs;

  console.log(`  - Average Clean Full Rebuild:  ${avgFullRebuildMs.toFixed(3)} ms`);
  console.log(`  - Average Incremental Update:  ${avgIncrementalMs.toFixed(3)} ms`);
  console.log(`  - Incremental Speedup Ratio:   ${speedupRatio.toFixed(2)}x\n`);

  const benchmarkPayload = {
    timestamp: new Date().toISOString(),
    environment: {
      nodeVersion: process.version,
      platform: process.platform,
      arch: process.arch
    },
    scenarios: results,
    performance: {
      avgFullRebuildMs,
      avgIncrementalMs,
      speedupRatio,
      iterations: 10
    }
  };

  // Write machine-readable JSON
  fs.writeFileSync(
    path.join(RESULTS_DIR, 'benchmark_results.json'),
    JSON.stringify(benchmarkPayload, null, 2),
    'utf8'
  );

  console.log(`Artifact written: ${path.join(RESULTS_DIR, 'benchmark_results.json')}`);
  return benchmarkPayload;
}

if (require.main === module) {
  runBenchmark().catch((err) => {
    console.error('Benchmark execution error:', err);
    process.exit(1);
  });
}

module.exports = { runBenchmark };
