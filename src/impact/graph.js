const crypto = require('node:crypto');

const NodeKind = Object.freeze({
  REPOSITORY: 'repository',
  FILE: 'file',
  MODULE: 'module',
  FUNCTION: 'function',
  CLASS: 'class',
  ENDPOINT: 'endpoint',
  SERVICE: 'service',
  CONFIG: 'config',
  TEST: 'test',
  EXTERNAL: 'external'
});

const EdgeType = Object.freeze({
  IMPORTS: 'imports',
  CALLS: 'calls',
  EXTENDS: 'extends',
  REFERENCES: 'references',
  ROUTES_TO: 'routes-to',
  CONFIGURES: 'configures',
  COVERS: 'covers',
  INVOKES_DYNAMICALLY: 'invokes-dynamically'
});

const EvidenceSource = Object.freeze({
  STATIC_AST: 'static-ast',
  RUNTIME_TRACE: 'runtime-trace',
  API_CONTRACT: 'api-contract',
  CONFIG_MANIFEST: 'config-manifest',
  COVERAGE_MAP: 'coverage-map',
  HISTORICAL_GRAPH: 'historical-graph'
});

const ValidationStatus = Object.freeze({
  CONFIRMED: 'confirmed',             // Multi-source corroborated or unambiguous direct binding
  STATICALLY_INFERRED: 'inferred',     // Extracted via static AST without dynamic corroboration
  RUNTIME_OBSERVED: 'observed',       // Observed in actual execution trace
  CONTRACT_DERIVED: 'contract',       // Sourced from route, schema, or configuration contracts
  CONFLICTED: 'conflicted',           // Multiple sources provide contradictory assertions
  UNRESOLVED: 'unresolved'            // Known ambiguous target, dynamic reflection, or unparsed call
});

class DependencyNode {
  constructor({ id, kind, name, filePath = null, line = null, metadata = {} }) {
    if (!id || typeof id !== 'string') throw new TypeError('DependencyNode requires a non-empty string id');
    if (!Object.values(NodeKind).includes(kind)) {
      throw new TypeError(`Invalid node kind: "${kind}". Must be one of ${Object.values(NodeKind).join(', ')}`);
    }
    this.id = id;
    this.kind = kind;
    this.name = name || id;
    this.filePath = filePath;
    this.line = line;
    this.metadata = Object.freeze({ ...metadata });
  }

  toJSON() {
    return {
      id: this.id,
      kind: this.kind,
      name: this.name,
      filePath: this.filePath,
      line: this.line,
      metadata: this.metadata
    };
  }
}

class EvidenceRecord {
  constructor({
    id = null,
    source,
    sourceLocation = null,
    revisionId = null,
    timestamp = new Date().toISOString(),
    method = 'direct-analysis',
    status = ValidationStatus.STATICALLY_INFERRED,
    weight = 0.5,
    details = {},
    limitations = []
  }) {
    if (!Object.values(EvidenceSource).includes(source)) {
      throw new TypeError(`Invalid evidence source: "${source}"`);
    }
    if (!Object.values(ValidationStatus).includes(status)) {
      throw new TypeError(`Invalid validation status: "${status}"`);
    }
    this.id = id || `evi_${crypto.randomUUID()}`;
    this.source = source;
    this.sourceLocation = sourceLocation ? Object.freeze({ ...sourceLocation }) : null;
    this.revisionId = revisionId;
    this.timestamp = timestamp;
    this.method = method;
    this.status = status;
    this.weight = Math.max(0.0, Math.min(1.0, Number(weight) || 0.0));
    this.details = Object.freeze({ ...details });
    this.limitations = Object.freeze([...(limitations || [])]);
  }

  toJSON() {
    return {
      id: this.id,
      source: this.source,
      sourceLocation: this.sourceLocation,
      revisionId: this.revisionId,
      timestamp: this.timestamp,
      method: this.method,
      status: this.status,
      weight: this.weight,
      details: this.details,
      limitations: this.limitations
    };
  }
}

class DependencyEdge {
  constructor({ sourceId, targetId, type, evidence = [], status = null, isResolved = true }) {
    if (!sourceId || !targetId) throw new TypeError('DependencyEdge requires valid sourceId and targetId');
    if (!Object.values(EdgeType).includes(type)) {
      throw new TypeError(`Invalid edge type: "${type}"`);
    }
    this.sourceId = sourceId;
    this.targetId = targetId;
    this.type = type;
    this.id = `${sourceId}->${targetId}:${type}`;
    this.evidence = [];
    this.status = status || ValidationStatus.STATICALLY_INFERRED;
    this.isResolved = isResolved;

    if (Array.isArray(evidence)) {
      for (const item of evidence) {
        this.addEvidence(item instanceof EvidenceRecord ? item : new EvidenceRecord(item));
      }
    }
  }

  addEvidence(record) {
    if (!(record instanceof EvidenceRecord)) {
      throw new TypeError('addEvidence expects an instance of EvidenceRecord');
    }
    this.evidence.push(record);
    this.recomputeStatus();
  }

  recomputeStatus() {
    if (this.evidence.length === 0) {
      this.status = ValidationStatus.UNRESOLVED;
      this.isResolved = false;
      return;
    }

    const statuses = new Set(this.evidence.map((e) => e.status));
    const sources = new Set(this.evidence.map((e) => e.source));

    // Conflicting evidence check: static vs runtime opposition or explicit conflict status
    if (statuses.has(ValidationStatus.CONFLICTED)) {
      this.status = ValidationStatus.CONFLICTED;
      this.isResolved = false;
      return;
    }

    // Corroborated: static AST + runtime trace agreement
    if (sources.has(EvidenceSource.STATIC_AST) && sources.has(EvidenceSource.RUNTIME_TRACE)) {
      this.status = ValidationStatus.CONFIRMED;
      this.isResolved = true;
      return;
    }

    if (statuses.has(ValidationStatus.CONFIRMED)) {
      this.status = ValidationStatus.CONFIRMED;
      this.isResolved = true;
      return;
    }

    if (statuses.has(ValidationStatus.CONTRACT_DERIVED)) {
      this.status = ValidationStatus.CONTRACT_DERIVED;
      this.isResolved = true;
      return;
    }

    if (statuses.has(ValidationStatus.RUNTIME_OBSERVED)) {
      this.status = ValidationStatus.RUNTIME_OBSERVED;
      this.isResolved = true;
      return;
    }

    if (statuses.has(ValidationStatus.UNRESOLVED)) {
      this.status = ValidationStatus.UNRESOLVED;
      this.isResolved = false;
      return;
    }

    this.status = ValidationStatus.STATICALLY_INFERRED;
    this.isResolved = true;
  }

  toJSON() {
    return {
      id: this.id,
      sourceId: this.sourceId,
      targetId: this.targetId,
      type: this.type,
      status: this.status,
      isResolved: this.isResolved,
      evidence: this.evidence.map((e) => e.toJSON())
    };
  }
}

class TypedDependencyGraph {
  constructor(revisionId = null) {
    this.revisionId = revisionId;
    this.nodes = new Map();
    this.edges = new Map();
    this.outEdges = new Map(); // sourceId -> Set<edgeId>
    this.inEdges = new Map();  // targetId -> Set<edgeId>
  }

  addNode(node) {
    const instance = node instanceof DependencyNode ? node : new DependencyNode(node);
    this.nodes.set(instance.id, instance);
    if (!this.outEdges.has(instance.id)) this.outEdges.set(instance.id, new Set());
    if (!this.inEdges.has(instance.id)) this.inEdges.set(instance.id, new Set());
    return instance;
  }

  getNode(id) {
    return this.nodes.get(id) || null;
  }

  hasNode(id) {
    return this.nodes.has(id);
  }

  removeNode(id) {
    if (!this.nodes.has(id)) return false;

    // Remove all connected edges
    const outSet = this.outEdges.get(id) || new Set();
    for (const edgeId of [...outSet]) {
      this.removeEdge(edgeId);
    }
    const inSet = this.inEdges.get(id) || new Set();
    for (const edgeId of [...inSet]) {
      this.removeEdge(edgeId);
    }

    this.outEdges.delete(id);
    this.inEdges.delete(id);
    this.nodes.delete(id);
    return true;
  }

  addEdge(edge) {
    const instance = edge instanceof DependencyEdge ? edge : new DependencyEdge(edge);
    if (!this.nodes.has(instance.sourceId)) {
      throw new Error(`Cannot add edge: source node "${instance.sourceId}" does not exist in graph.`);
    }
    if (!this.nodes.has(instance.targetId)) {
      throw new Error(`Cannot add edge: target node "${instance.targetId}" does not exist in graph.`);
    }

    const existing = this.edges.get(instance.id);
    if (existing) {
      // Merge evidence records into existing edge
      for (const evi of instance.evidence) {
        existing.addEvidence(evi);
      }
      return existing;
    }

    this.edges.set(instance.id, instance);
    this.outEdges.get(instance.sourceId).add(instance.id);
    this.inEdges.get(instance.targetId).add(instance.id);
    return instance;
  }

  addEvidence(sourceId, targetId, type, evidenceRecord) {
    const edgeId = `${sourceId}->${targetId}:${type}`;
    let edge = this.edges.get(edgeId);
    if (!edge) {
      edge = this.addEdge(new DependencyEdge({ sourceId, targetId, type }));
    }
    const record = evidenceRecord instanceof EvidenceRecord ? evidenceRecord : new EvidenceRecord(evidenceRecord);
    edge.addEvidence(record);
    return edge;
  }

  getEdge(sourceId, targetId, type) {
    return this.edges.get(`${sourceId}->${targetId}:${type}`) || null;
  }

  removeEdge(edgeId) {
    const edge = this.edges.get(edgeId);
    if (!edge) return false;

    this.edges.delete(edgeId);
    this.outEdges.get(edge.sourceId)?.delete(edgeId);
    this.inEdges.get(edge.targetId)?.delete(edgeId);
    return true;
  }

  getOutEdges(nodeId) {
    const edgeIds = this.outEdges.get(nodeId) || new Set();
    const result = [];
    for (const id of edgeIds) {
      const e = this.edges.get(id);
      if (e) result.push(e);
    }
    return result;
  }

  getInEdges(nodeId) {
    const edgeIds = this.inEdges.get(nodeId) || new Set();
    const result = [];
    for (const id of edgeIds) {
      const e = this.edges.get(id);
      if (e) result.push(e);
    }
    return result;
  }

  getSuccessors(nodeId) {
    const outEdges = this.getOutEdges(nodeId);
    const successors = new Set();
    for (const e of outEdges) {
      successors.add(e.targetId);
    }
    return Array.from(successors).map((id) => this.getNode(id)).filter(Boolean);
  }

  getPredecessors(nodeId) {
    const inEdges = this.getInEdges(nodeId);
    const predecessors = new Set();
    for (const e of inEdges) {
      predecessors.add(e.sourceId);
    }
    return Array.from(predecessors).map((id) => this.getNode(id)).filter(Boolean);
  }

  clone() {
    const copy = new TypedDependencyGraph(this.revisionId);
    for (const node of this.nodes.values()) {
      copy.addNode(new DependencyNode(node.toJSON()));
    }
    for (const edge of this.edges.values()) {
      const edgeData = edge.toJSON();
      copy.addEdge(new DependencyEdge({
        sourceId: edgeData.sourceId,
        targetId: edgeData.targetId,
        type: edgeData.type,
        status: edgeData.status,
        isResolved: edgeData.isResolved,
        evidence: edgeData.evidence.map((evi) => new EvidenceRecord(evi))
      }));
    }
    return copy;
  }

  computeMetrics() {
    let confirmedCount = 0;
    let inferredCount = 0;
    let observedCount = 0;
    let contractCount = 0;
    let conflictedCount = 0;
    let unresolvedCount = 0;
    let totalEvidence = 0;

    for (const edge of this.edges.values()) {
      totalEvidence += edge.evidence.length;
      switch (edge.status) {
        case ValidationStatus.CONFIRMED: confirmedCount += 1; break;
        case ValidationStatus.STATICALLY_INFERRED: inferredCount += 1; break;
        case ValidationStatus.RUNTIME_OBSERVED: observedCount += 1; break;
        case ValidationStatus.CONTRACT_DERIVED: contractCount += 1; break;
        case ValidationStatus.CONFLICTED: conflictedCount += 1; break;
        case ValidationStatus.UNRESOLVED: unresolvedCount += 1; break;
      }
    }

    return {
      nodeCount: this.nodes.size,
      edgeCount: this.edges.size,
      totalEvidence,
      statusCounts: {
        confirmed: confirmedCount,
        inferred: inferredCount,
        observed: observedCount,
        contract: contractCount,
        conflicted: conflictedCount,
        unresolved: unresolvedCount
      },
      resolvedRatio: this.edges.size === 0 ? 1.0 : (this.edges.size - unresolvedCount - conflictedCount) / this.edges.size
    };
  }

  toJSON() {
    return {
      revisionId: this.revisionId,
      nodes: Array.from(this.nodes.values()).map((n) => n.toJSON()),
      edges: Array.from(this.edges.values()).map((e) => e.toJSON()),
      metrics: this.computeMetrics()
    };
  }

  static fromJSON(data) {
    if (!data || typeof data !== 'object') throw new TypeError('fromJSON requires an object');
    const graph = new TypedDependencyGraph(data.revisionId || null);
    for (const n of data.nodes || []) {
      graph.addNode(new DependencyNode(n));
    }
    for (const e of data.edges || []) {
      graph.addEdge(new DependencyEdge({
        sourceId: e.sourceId,
        targetId: e.targetId,
        type: e.type,
        status: e.status,
        isResolved: e.isResolved,
        evidence: (e.evidence || []).map((evi) => new EvidenceRecord(evi))
      }));
    }
    return graph;
  }
}

module.exports = {
  NodeKind,
  EdgeType,
  EvidenceSource,
  ValidationStatus,
  DependencyNode,
  EvidenceRecord,
  DependencyEdge,
  TypedDependencyGraph
};
