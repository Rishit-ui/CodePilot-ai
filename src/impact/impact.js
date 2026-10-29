const { NodeKind, EdgeType, ValidationStatus } = require('./graph');

class ChangeImpactEngine {
  constructor(options = {}) {
    this.options = {
      maxTransitiveDepth: options.maxTransitiveDepth || 20,
      conservativeUncertainty: options.conservativeUncertainty !== false,
      ...options
    };
  }

  /**
   * Computes the change-impact cone from an array of changed file paths.
   * @param {TypedDependencyGraph} graph
   * @param {Array<string>} changedFilePaths
   * @returns {ImpactReport}
   */
  analyzeImpact(graph, changedFilePaths = []) {
    const directNodes = new Map();       // id -> { node, evidenceChain }
    const transitiveNodes = new Map();   // id -> { node, depth, evidenceChain }
    const uncertaintyNodes = new Map();  // id -> { node, reason, evidenceChain }
    const unresolvableNodes = new Map(); // id -> { node, limitation }

    const visited = new Set();
    const queue = []; // { id, depth, chain }

    // 1. Identify directly affected nodes
    for (const filePath of changedFilePaths) {
      const fileId = `file:${filePath}`;
      const fileNode = graph.getNode(fileId);

      if (fileNode) {
        directNodes.set(fileId, {
          node: fileNode,
          reason: 'Direct file modification',
          evidenceChain: ['Direct file modification detected in revision diff']
        });
        visited.add(fileId);
        queue.push({ id: fileId, depth: 0, chain: [`file:${filePath}`] });
      }

      // Identify symbols defined inside the modified file
      for (const node of graph.nodes.values()) {
        if (node.filePath === filePath && node.id !== fileId) {
          directNodes.set(node.id, {
            node,
            reason: `Declared symbol inside modified file: ${node.name}`,
            evidenceChain: [`Declared in modified file ${filePath}`]
          });
          visited.add(node.id);
          queue.push({ id: node.id, depth: 0, chain: [node.id] });
        }
      }
    }

    // 2. Transitive Traversal (Reverse dependencies: callers, importers, dependents)
    while (queue.length > 0) {
      const { id, depth, chain } = queue.shift();
      if (depth >= this.options.maxTransitiveDepth) continue;

      const inEdges = graph.getInEdges(id);
      for (const edge of inEdges) {
        const sourceNode = graph.getNode(edge.sourceId);
        if (!sourceNode || sourceNode.kind === NodeKind.REPOSITORY) continue;

        const nextChain = [...chain, `${edge.type} (via ${edge.status}) -> ${sourceNode.id}`];

        // Check for edge uncertainty or conflicts
        const isUncertain = edge.status === ValidationStatus.CONFLICTED || edge.status === ValidationStatus.UNRESOLVED;
        if (isUncertain) {
          uncertaintyNodes.set(sourceNode.id, {
            node: sourceNode,
            reason: `Dependent via ${edge.status} edge: ${edge.id}`,
            evidenceChain: nextChain,
            edgeStatus: edge.status
          });
        }

        if (!visited.has(sourceNode.id)) {
          visited.add(sourceNode.id);
          transitiveNodes.set(sourceNode.id, {
            node: sourceNode,
            depth: depth + 1,
            evidenceChain: nextChain,
            edgeStatus: edge.status
          });
          queue.push({ id: sourceNode.id, depth: depth + 1, chain: nextChain });
        }
      }
    }

    // 3. Find affected API Endpoints, Configuration, and Tests
    const affectedEndpoints = [];
    const affectedTests = [];
    const affectedConfigs = [];

    for (const [id, item] of [...directNodes, ...transitiveNodes]) {
      const { node, evidenceChain } = item;
      if (node.kind === NodeKind.ENDPOINT) {
        affectedEndpoints.push({ node, evidenceChain });
      } else if (node.kind === NodeKind.TEST) {
        affectedTests.push({ node, evidenceChain });
      } else if (node.kind === NodeKind.CONFIG) {
        affectedConfigs.push({ node, evidenceChain });
      }

      // Check outgoing edges from affected files for exposed endpoints and configurations
      const outEdges = graph.getOutEdges(node.id);
      for (const edge of outEdges) {
        if (edge.type === EdgeType.ROUTES_TO) {
          const endpointNode = graph.getNode(edge.targetId);
          if (endpointNode && !affectedEndpoints.some((e) => e.node.id === endpointNode.id)) {
            affectedEndpoints.push({
              node: endpointNode,
              evidenceChain: [...evidenceChain, `Exposes endpoint via ${edge.type}`]
            });
          }
        } else if (edge.type === EdgeType.CONFIGURES) {
          const configNode = graph.getNode(edge.targetId);
          if (configNode && !affectedConfigs.some((c) => c.node.id === configNode.id)) {
            affectedConfigs.push({
              node: configNode,
              evidenceChain: [...evidenceChain, `References config via ${edge.type}`]
            });
          }
        }
      }
    }

    // 4. Categorize risk level
    let riskLevel = 'LOW';
    if (affectedEndpoints.length > 0 || affectedConfigs.length > 0) {
      riskLevel = 'HIGH';
    } else if (transitiveNodes.size > 5 || uncertaintyNodes.size > 0) {
      riskLevel = 'MEDIUM';
    }

    return {
      revisionId: graph.revisionId,
      changedFiles: changedFilePaths,
      summary: {
        directCount: directNodes.size,
        transitiveCount: transitiveNodes.size,
        uncertaintyCount: uncertaintyNodes.size,
        affectedEndpointsCount: affectedEndpoints.length,
        affectedTestsCount: affectedTests.length,
        riskLevel
      },
      directImpacts: Array.from(directNodes.values()).map((d) => ({
        id: d.node.id,
        kind: d.node.kind,
        name: d.node.name,
        filePath: d.node.filePath,
        reason: d.reason,
        evidenceChain: d.evidenceChain
      })),
      transitiveImpacts: Array.from(transitiveNodes.values()).map((t) => ({
        id: t.node.id,
        kind: t.node.kind,
        name: t.node.name,
        filePath: t.node.filePath,
        depth: t.depth,
        edgeStatus: t.edgeStatus,
        evidenceChain: t.evidenceChain
      })),
      uncertaintyCone: Array.from(uncertaintyNodes.values()).map((u) => ({
        id: u.node.id,
        kind: u.node.kind,
        name: u.node.name,
        filePath: u.node.filePath,
        reason: u.reason,
        edgeStatus: u.edgeStatus,
        evidenceChain: u.evidenceChain
      })),
      affectedEndpoints: affectedEndpoints.map((e) => ({
        id: e.node.id,
        name: e.node.name,
        evidenceChain: e.evidenceChain
      })),
      affectedTests: affectedTests.map((t) => ({
        id: t.node.id,
        name: t.node.name,
        filePath: t.node.filePath,
        evidenceChain: t.evidenceChain
      }))
    };
  }
}

module.exports = {
  ChangeImpactEngine
};
