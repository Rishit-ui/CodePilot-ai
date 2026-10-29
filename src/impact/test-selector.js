const path = require('node:path').posix;
const { NodeKind, EdgeType, ValidationStatus } = require('./graph');
const { ChangeImpactEngine } = require('./impact');

const SelectionStrategy = Object.freeze({
  ALL: 'all',                          // Baseline 1: Run 100% of discovered tests
  CHANGED_FILE: 'changed-file',        // Baseline 2: Simple changed-file / direct import
  EVIDENCE_AWARE: 'evidence-aware'     // Proposed: Multi-provenance, transitive, and uncertainty-elevated
});

class RegressionTestSelector {
  constructor(options = {}) {
    this.options = {
      defaultStrategy: options.defaultStrategy || SelectionStrategy.EVIDENCE_AWARE,
      impactEngine: options.impactEngine || new ChangeImpactEngine(),
      ...options
    };
  }

  /**
   * Discovers all test nodes in the dependency graph.
   * @param {TypedDependencyGraph} graph
   * @returns {Array<DependencyNode>}
   */
  discoverTests(graph) {
    const tests = [];
    for (const node of graph.nodes.values()) {
      if (node.kind === NodeKind.TEST) {
        tests.push(node);
      }
    }
    return tests;
  }

  /**
   * Selects regression tests based on change impact and chosen strategy.
   * @param {TypedDependencyGraph} graph
   * @param {Array<string>} changedFilePaths
   * @param {string} strategy 'all' | 'changed-file' | 'evidence-aware'
   * @returns {TestSelectionResult}
   */
  selectTests(graph, changedFilePaths = [], strategy = null) {
    const activeStrategy = strategy || this.options.defaultStrategy;
    const allTests = this.discoverTests(graph);
    const impactReport = this.options.impactEngine.analyzeImpact(graph, changedFilePaths);

    // Group test nodes by file for test runner command synthesis
    const testFileSet = new Set();
    const decisions = [];
    const selectedTestNodes = [];

    // Helper to find which source files a test file imports
    const getTestDependencies = (testFileId) => {
      const outEdges = graph.getOutEdges(testFileId);
      return outEdges
        .filter((e) => e.type === EdgeType.IMPORTS || e.type === EdgeType.COVERS)
        .map((e) => e.targetId);
    };

    if (activeStrategy === SelectionStrategy.ALL) {
      // Strategy A: Select 100% of tests
      for (const testNode of allTests) {
        testFileSet.add(testNode.filePath);
        selectedTestNodes.push(testNode);
        decisions.push({
          testId: testNode.id,
          testFile: testNode.filePath,
          testName: testNode.name,
          selected: true,
          selectionReason: 'Full regression baseline: all test suites selected.',
          strategy: activeStrategy
        });
      }
    } else if (activeStrategy === SelectionStrategy.CHANGED_FILE) {
      // Strategy B: Changed-File Baseline (Direct file name or immediate import match)
      const changedFileSet = new Set(changedFilePaths);

      for (const testNode of allTests) {
        const isDirectTestFile = changedFileSet.has(testNode.filePath);
        const testDeps = getTestDependencies(`file:${testNode.filePath}`);
        const touchesChangedFile = testDeps.some((depId) => {
          const depPath = depId.replace(/^file:/, '');
          return changedFileSet.has(depPath);
        });

        if (isDirectTestFile || touchesChangedFile) {
          testFileSet.add(testNode.filePath);
          selectedTestNodes.push(testNode);
          decisions.push({
            testId: testNode.id,
            testFile: testNode.filePath,
            testName: testNode.name,
            selected: true,
            selectionReason: isDirectTestFile
              ? 'Test file itself was directly modified.'
              : 'Direct import match with modified source file.',
            strategy: activeStrategy
          });
        } else {
          decisions.push({
            testId: testNode.id,
            testFile: testNode.filePath,
            testName: testNode.name,
            selected: false,
            selectionReason: 'Test does not directly reference modified file.',
            strategy: activeStrategy
          });
        }
      }
    } else {
      // Strategy C: Evidence-Aware Selection (Proposed Method)
      const affectedIds = new Set();

      // Collect all directly and transitively affected node IDs
      for (const impact of impactReport.directImpacts) affectedIds.add(impact.id);
      for (const impact of impactReport.transitiveImpacts) affectedIds.add(impact.id);
      for (const impact of impactReport.uncertaintyCone) affectedIds.add(impact.id);

      // Check for global configuration changes that warrant conservative fallback
      const configChanged = changedFilePaths.some((f) => f.includes('.env') || f.includes('config') || f.includes('package.json'));

      for (const testNode of allTests) {
        let isSelected = false;
        let reason = '';

        if (configChanged) {
          isSelected = true;
          reason = 'Conservative fallback: Root configuration or manifest modified; running full suite.';
        } else if (affectedIds.has(testNode.id)) {
          isSelected = true;
          reason = `Test is directly inside the change impact cone (${testNode.id}).`;
        } else {
          // Check if test covers or imports any affected node
          const testFileId = `file:${testNode.filePath}`;
          const testDeps = getTestDependencies(testFileId);
          const matchedDep = testDeps.find((depId) => affectedIds.has(depId));

          if (matchedDep) {
            isSelected = true;
            reason = `Test dependency ${matchedDep} is transitively affected by code change.`;
          }
        }

        if (isSelected) {
          testFileSet.add(testNode.filePath);
          selectedTestNodes.push(testNode);
          decisions.push({
            testId: testNode.id,
            testFile: testNode.filePath,
            testName: testNode.name,
            selected: true,
            selectionReason: reason,
            strategy: activeStrategy
          });
        } else {
          decisions.push({
            testId: testNode.id,
            testFile: testNode.filePath,
            testName: testNode.name,
            selected: false,
            selectionReason: 'No direct, transitive, or uncertainty dependency on changed components.',
            strategy: activeStrategy
          });
        }
      }
    }

    const totalTests = allTests.length;
    const selectedCount = selectedTestNodes.length;
    const reductionRatio = totalTests === 0 ? 0 : ((totalTests - selectedCount) / totalTests);

    return {
      strategy: activeStrategy,
      revisionId: graph.revisionId,
      changedFiles: changedFilePaths,
      summary: {
        totalDiscoveredTests: totalTests,
        selectedTestsCount: selectedCount,
        omittedTestsCount: totalTests - selectedCount,
        selectedFilesCount: testFileSet.size,
        reductionPercent: (reductionRatio * 100).toFixed(1) + '%',
        reductionRatio
      },
      selectedTestFiles: Array.from(testFileSet),
      selectedTestNodes: selectedTestNodes.map((n) => ({ id: n.id, name: n.name, filePath: n.filePath })),
      decisions,
      impactSummary: impactReport.summary
    };
  }
}

module.exports = {
  SelectionStrategy,
  RegressionTestSelector
};
