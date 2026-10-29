const {
  ValidationStatus,
  EvidenceSource,
  EdgeType,
  EvidenceRecord,
  DependencyEdge
} = require('./graph');

/**
 * Reconciles multi-source evidence across static, runtime, API, and config modalities.
 */
class EvidenceReconciler {
  constructor(options = {}) {
    this.options = {
      staleRevisionThreshold: options.staleRevisionThreshold || 1,
      conservativeFallback: options.conservativeFallback !== false,
      ...options
    };
  }

  /**
   * Reconciles all edges in the provided graph against current revision and external evidence.
   * @param {TypedDependencyGraph} graph
   * @param {Array<EvidenceRecord>} externalEvidence e.g. newly ingested runtime traces or coverage
   * @param {string} currentRevisionId
   * @returns {{ reconciledEdges: number, conflictedEdges: number, unresolvedEdges: number, decisions: Array<object> }}
   */
  reconcileGraph(graph, externalEvidence = [], currentRevisionId = null) {
    const activeRevision = currentRevisionId || graph.revisionId;
    const decisions = [];
    let conflictedEdges = 0;
    let unresolvedEdges = 0;

    // 1. Ingest external evidence into corresponding graph edges
    for (const evi of externalEvidence) {
      const record = evi instanceof EvidenceRecord ? evi : new EvidenceRecord(evi);
      const sourceId = record.details?.sourceId;
      const targetId = record.details?.targetId;
      const type = record.details?.edgeType || EdgeType.CALLS;

      if (sourceId && targetId && graph.hasNode(sourceId) && graph.hasNode(targetId)) {
        graph.addEvidence(sourceId, targetId, type, record);
      }
    }

    // 2. Process each edge's evidence bundle
    for (const edge of graph.edges.values()) {
      const decision = this.reconcileEdge(edge, activeRevision);
      decisions.push(decision);

      if (edge.status === ValidationStatus.CONFLICTED) conflictedEdges += 1;
      if (edge.status === ValidationStatus.UNRESOLVED) unresolvedEdges += 1;
    }

    return {
      reconciledEdges: graph.edges.size,
      conflictedEdges,
      unresolvedEdges,
      decisions
    };
  }

  /**
   * Reconciles a single edge based on deterministic precedence rules.
   */
  reconcileEdge(edge, currentRevisionId) {
    const evidenceList = edge.evidence;
    const edgeId = edge.id;

    if (!evidenceList || evidenceList.length === 0) {
      edge.status = ValidationStatus.UNRESOLVED;
      edge.isResolved = false;
      return {
        edgeId,
        decision: 'unresolved-no-evidence',
        status: ValidationStatus.UNRESOLVED,
        explanation: 'No evidence records attached to edge.'
      };
    }

    // Filter active vs stale evidence
    const currentEvidence = [];
    const staleEvidence = [];

    for (const evi of evidenceList) {
      if (currentRevisionId && evi.revisionId && evi.revisionId !== currentRevisionId) {
        staleEvidence.push(evi);
      } else {
        currentEvidence.push(evi);
      }
    }

    const hasStatic = currentEvidence.some((e) => e.source === EvidenceSource.STATIC_AST);
    const hasRuntime = currentEvidence.some((e) => e.source === EvidenceSource.RUNTIME_TRACE);
    const hasContract = currentEvidence.some((e) => e.source === EvidenceSource.API_CONTRACT || e.source === EvidenceSource.CONFIG_MANIFEST);
    const hasCoverage = currentEvidence.some((e) => e.source === EvidenceSource.COVERAGE_MAP);

    // Rule 1: Contradiction Detection
    // When runtime trace explicitly reports an error or absence while static claims confirmed,
    // or when limitations indicate unresolved dynamic dispatch with conflicting targets.
    const explicitConflict = currentEvidence.find((e) => e.status === ValidationStatus.CONFLICTED || e.details?.contradiction === true);
    if (explicitConflict) {
      edge.status = ValidationStatus.CONFLICTED;
      edge.isResolved = false;
      return {
        edgeId,
        decision: 'mark-conflicted',
        status: ValidationStatus.CONFLICTED,
        explanation: `Contradictory evidence detected: ${explicitConflict.details?.reason || 'Conflicting claims across sources.'}`,
        conservativeFallback: this.options.conservativeFallback
      };
    }

    // Rule 2: Corroboration (Static AST + Runtime Trace)
    if (hasStatic && hasRuntime) {
      edge.status = ValidationStatus.CONFIRMED;
      edge.isResolved = true;
      return {
        edgeId,
        decision: 'corroborated-confirmed',
        status: ValidationStatus.CONFIRMED,
        explanation: 'Edge corroborated by both static AST analysis and runtime execution trace.'
      };
    }

    // Rule 3: Contract Derived (API routes, schemas, environment config)
    if (hasContract) {
      edge.status = ValidationStatus.CONTRACT_DERIVED;
      edge.isResolved = true;
      return {
        edgeId,
        decision: 'contract-established',
        status: ValidationStatus.CONTRACT_DERIVED,
        explanation: 'Edge established via declarative API route contract or environment configuration key.'
      };
    }

    // Rule 4: Runtime Observed without Static AST (Dynamic invocation / reflection)
    if (hasRuntime && !hasStatic) {
      edge.status = ValidationStatus.RUNTIME_OBSERVED;
      edge.isResolved = true;
      return {
        edgeId,
        decision: 'runtime-dynamic-call',
        status: ValidationStatus.RUNTIME_OBSERVED,
        explanation: 'Dynamic call path observed during runtime execution; not syntactically explicit in AST.'
      };
    }

    // Rule 5: Statically Inferred (Only Static AST present)
    if (hasStatic && !hasRuntime) {
      edge.status = ValidationStatus.STATICALLY_INFERRED;
      edge.isResolved = true;
      return {
        edgeId,
        decision: 'static-inferred-baseline',
        status: ValidationStatus.STATICALLY_INFERRED,
        explanation: 'Inferred purely from lexical/syntactic AST parsing; uncorroborated by runtime trace.'
      };
    }

    // Rule 6: Historical / Coverage Map Only
    if (hasCoverage && !hasStatic && !hasRuntime) {
      edge.status = staleEvidence.length > 0 ? ValidationStatus.UNRESOLVED : ValidationStatus.STATICALLY_INFERRED;
      edge.isResolved = edge.status !== ValidationStatus.UNRESOLVED;
      return {
        edgeId,
        decision: edge.isResolved ? 'coverage-map-inferred' : 'stale-coverage-unresolved',
        status: edge.status,
        explanation: edge.isResolved
          ? 'Inferred from static test coverage mapping.'
          : 'Coverage evidence belongs to prior revision and may be invalidated by recent code changes.'
      };
    }

    // Fallback: Default to conservative unresolved
    edge.status = ValidationStatus.UNRESOLVED;
    edge.isResolved = false;
    return {
      edgeId,
      decision: 'unresolved-fallback',
      status: ValidationStatus.UNRESOLVED,
      explanation: 'Ambiguous or unverified relationship; conservative fallback engaged.'
    };
  }
}

module.exports = {
  EvidenceReconciler
};
