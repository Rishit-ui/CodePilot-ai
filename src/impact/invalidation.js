const crypto = require('node:crypto');
const {
  NodeKind,
  EdgeType,
  TypedDependencyGraph,
  DependencyEdge,
  EvidenceRecord,
  ValidationStatus,
  EvidenceSource
} = require('./graph');
const { SourceCodeImpactAnalyzer } = require('./analyzer');
const { EvidenceReconciler } = require('./reconcile');

function hashContent(str) {
  if (!str) return '';
  return crypto.createHash('sha256').update(str).digest('hex');
}

/**
 * Computes the file-level difference between two repository revisions.
 */
function computeRevisionDiff(oldEntries, newEntries) {
  const oldMap = new Map(oldEntries.map((e) => [e.path, e]));
  const newMap = new Map(newEntries.map((e) => [e.path, e]));

  const addedFiles = [];
  const modifiedFiles = [];
  const deletedFiles = [];
  const unchangedFiles = [];

  for (const [path, newEntry] of newMap.entries()) {
    const oldEntry = oldMap.get(path);
    if (!oldEntry) {
      addedFiles.push(path);
    } else if (newEntry.bytes !== oldEntry.bytes || hashContent(newEntry.content) !== hashContent(oldEntry.content)) {
      modifiedFiles.push(path);
    } else {
      unchangedFiles.push(path);
    }
  }

  for (const path of oldMap.keys()) {
    if (!newMap.has(path)) {
      deletedFiles.push(path);
    }
  }

  return {
    addedFiles,
    modifiedFiles,
    deletedFiles,
    unchangedFiles,
    hasChanges: addedFiles.length > 0 || modifiedFiles.length > 0 || deletedFiles.length > 0
  };
}

/**
 * Computes the invalidation cone C_inv of nodes that depend directly or transitively
 * on changed files.
 */
function computeInvalidationCone(graph, changedFilePaths, maxDepth = 10) {
  const invalidationCone = new Set();
  const queue = [];

  // Seed with changed files and their child symbols
  for (const filePath of changedFilePaths) {
    const fileNodeId = `file:${filePath}`;
    if (graph.hasNode(fileNodeId)) {
      invalidationCone.add(fileNodeId);
      queue.push({ id: fileNodeId, depth: 0 });
    }

    // Include child functions/classes of the file
    for (const node of graph.nodes.values()) {
      if (node.filePath === filePath) {
        invalidationCone.add(node.id);
        queue.push({ id: node.id, depth: 0 });
      }
    }
  }

  // Traverse incoming edges (reverse dependency propagation)
  while (queue.length > 0) {
    const { id, depth } = queue.shift();
    if (depth >= maxDepth) continue;

    const inEdges = graph.getInEdges(id);
    for (const edge of inEdges) {
      // Invalidate the source of the edge (the importer or caller)
      if (!invalidationCone.has(edge.sourceId)) {
        invalidationCone.add(edge.sourceId);
        queue.push({ id: edge.sourceId, depth: depth + 1 });
      }
    }
  }

  return invalidationCone;
}

/**
 * Incrementally updates an existing TypedDependencyGraph against a new revision.
 */
function updateGraphIncrementally(oldGraph, oldEntries, newEntries, newRevisionId, options = {}) {
  const diff = computeRevisionDiff(oldEntries, newEntries);
  const totalFiles = newEntries.length || 1;
  const changedFileCount = diff.addedFiles.length + diff.modifiedFiles.length + diff.deletedFiles.length;

  const analyzer = options.analyzer || new SourceCodeImpactAnalyzer();
  const reconciler = options.reconciler || new EvidenceReconciler();

  // Fallback Rule: If change impacts > 60% of the repository (or > 40% in large repos > 10 files), fall back to clean full rebuild
  const fallbackRatio = options.fallbackRatioThreshold || (totalFiles > 10 ? 0.40 : 0.70);
  if (changedFileCount / totalFiles > fallbackRatio) {
    const freshGraph = analyzer.buildGraph(newEntries, newRevisionId);
    reconciler.reconcileGraph(freshGraph, options.externalEvidence || [], newRevisionId);
    return {
      graph: freshGraph,
      strategy: 'full-rebuild-fallback',
      invalidationConeSize: freshGraph.nodes.size,
      diff
    };
  }

  const updatedGraph = oldGraph.clone();
  updatedGraph.revisionId = newRevisionId;
  const newMap = new Map(newEntries.map((e) => [e.path, e]));
  const candidates = new Set(newEntries.map((e) => e.path));

  // 1. Remove deleted files and their child symbols
  for (const deletedPath of diff.deletedFiles) {
    const fileId = `file:${deletedPath}`;
    const toRemove = [];
    for (const node of updatedGraph.nodes.values()) {
      if (node.filePath === deletedPath || node.id === fileId) {
        toRemove.push(node.id);
      }
    }
    for (const id of toRemove) {
      updatedGraph.removeNode(id);
    }
  }

  // 2. Compute invalidation cone for modified and added files
  const changedPaths = [...diff.modifiedFiles, ...diff.addedFiles];
  const invalidationCone = computeInvalidationCone(updatedGraph, changedPaths);

  // 3. Clear existing symbols and outgoing edges of modified files
  for (const modifiedPath of diff.modifiedFiles) {
    const fileId = `file:${modifiedPath}`;
    const toRemove = [];
    for (const node of updatedGraph.nodes.values()) {
      if (node.filePath === modifiedPath && node.id !== fileId) {
        toRemove.push(node.id);
      }
    }
    for (const id of toRemove) {
      updatedGraph.removeNode(id);
    }
    // Remove outgoing edges from the modified file
    const outEdges = updatedGraph.getOutEdges(fileId);
    for (const edge of outEdges) {
      updatedGraph.removeEdge(edge.id);
    }
  }

  // 4. Add new file nodes for added files
  for (const addedPath of diff.addedFiles) {
    const entry = newMap.get(addedPath);
    if (entry && !entry.excludedReason) {
      const fileId = `file:${addedPath}`;
      const isTestFile = /(?:^|\/)(?:tests?|__tests__|spec)\/|(?:\.|\_)(?:test|spec)\.[a-zA-Z]+$/i.test(addedPath);
      updatedGraph.addNode({
        id: fileId,
        kind: isTestFile ? NodeKind.TEST : NodeKind.FILE,
        name: addedPath,
        filePath: addedPath,
        metadata: { bytes: entry.bytes, isTest: isTestFile }
      });
      updatedGraph.addEdge(new DependencyEdge({
        sourceId: 'repo:root',
        targetId: fileId,
        type: EdgeType.REFERENCES,
        evidence: [new EvidenceRecord({
          source: EvidenceSource.STATIC_AST,
          revisionId: newRevisionId,
          method: 'repository-manifest',
          status: ValidationStatus.CONFIRMED,
          weight: 1.0,
          details: { path: addedPath }
        })]
      }));
    }
  }

  // 5. Re-analyze modified and added files
  for (const changedPath of changedPaths) {
    const entry = newMap.get(changedPath);
    if (entry && !entry.excludedReason && entry.content) {
      analyzer.analyzeFile(changedPath, entry.content, updatedGraph, candidates, newRevisionId);
    }
  }

  // 6. Carry forward validated revision timestamp for preserved unaffected edges
  for (const edge of updatedGraph.edges.values()) {
    for (const evi of edge.evidence) {
      if (!evi.revisionId || evi.revisionId === oldGraph.revisionId) {
        evi.revisionId = newRevisionId;
      }
    }
  }

  // 7. Run evidence reconciliation on the updated graph
  reconciler.reconcileGraph(updatedGraph, options.externalEvidence || [], newRevisionId);

  return {
    graph: updatedGraph,
    strategy: 'incremental-cone-update',
    invalidationConeSize: invalidationCone.size,
    diff
  };
}

/**
 * Verifies graph isomorphism and edge equivalence between an incremental update
 * and a full clean rebuild.
 */
function verifyGraphEquivalence(incrementalGraph, fullRebuildGraph) {
  const differences = [];

  // 1. Compare node sets
  if (incrementalGraph.nodes.size !== fullRebuildGraph.nodes.size) {
    differences.push(`Node count mismatch: incremental has ${incrementalGraph.nodes.size}, rebuild has ${fullRebuildGraph.nodes.size}`);
  }

  for (const [id, rebuildNode] of fullRebuildGraph.nodes.entries()) {
    const incrNode = incrementalGraph.getNode(id);
    if (!incrNode) {
      differences.push(`Missing node in incremental graph: ${id}`);
    } else if (incrNode.kind !== rebuildNode.kind) {
      differences.push(`Node kind mismatch for ${id}: ${incrNode.kind} vs ${rebuildNode.kind}`);
    }
  }

  // 2. Compare edge sets
  if (incrementalGraph.edges.size !== fullRebuildGraph.edges.size) {
    differences.push(`Edge count mismatch: incremental has ${incrementalGraph.edges.size}, rebuild has ${fullRebuildGraph.edges.size}`);
  }

  for (const [id, rebuildEdge] of fullRebuildGraph.edges.entries()) {
    const incrEdge = incrementalGraph.edges.get(id);
    if (!incrEdge) {
      differences.push(`Missing edge in incremental graph: ${id}`);
    } else {
      if (incrEdge.type !== rebuildEdge.type) {
        differences.push(`Edge type mismatch for ${id}: ${incrEdge.type} vs ${rebuildEdge.type}`);
      }
      if (incrEdge.status !== rebuildEdge.status) {
        differences.push(`Edge status mismatch for ${id}: ${incrEdge.status} vs ${rebuildEdge.status}`);
      }
    }
  }

  return {
    isEquivalent: differences.length === 0,
    differences
  };
}

module.exports = {
  computeRevisionDiff,
  computeInvalidationCone,
  updateGraphIncrementally,
  verifyGraphEquivalence
};
