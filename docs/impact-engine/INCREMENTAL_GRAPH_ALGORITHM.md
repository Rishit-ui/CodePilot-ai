# Incremental Graph Invalidation Algorithm

**Document Status:** Implementation Reference  
**Date:** 2026-10-29  
**Module:** `src/impact/invalidation.js`  
**Purpose:** Incremental update of typed dependency graphs across revisions without full re-computation.

---

## 1. Problem Overview

Re-parsing an entire codebase on each code change generates $O(|V| + |E|)$ overhead. The goal of incremental invalidation is to update the dependency graph $G = (V, E)$ to $G' = (V', E')$ such that:
$$G' \equiv \text{FullRebuild}(R_{\text{new}})$$
while parsing only the altered files and their reverse dependency boundary $\mathcal{C}_{\text{inv}}$.

---

## 2. Invalidation Cone Formulation

Let $F_{\text{mod}}, F_{\text{add}}, F_{\text{del}}$ represent the modified, added, and deleted files between revisions $R_{\text{old}}$ and $R_{\text{new}}$.

The **Invalidation Cone** $\mathcal{C}_{\text{inv}}$ is the set of graph nodes whose syntactic or semantic validity may be affected:
$$\mathcal{C}_{\text{inv}} = \bigcup_{f \in F_{\text{mod}} \cup F_{\text{add}} \cup F_{\text{del}}} \text{Cone}(f)$$
where:
$$\text{Cone}(f) = \{ f \} \cup \{ s \in V \mid s \in \text{symbols}(f) \} \cup \{ u \in V \mid (u, f) \in E^* \}$$
and $E^*$ represents the transitive closure of incoming dependency edges (importers, callers, subscribers).

---

## 3. Algorithm Pseudocode

```
Algorithm UpdateGraphIncrementally(oldGraph, oldEntries, newEntries, newRevisionId):
Input:
  oldGraph: TypedDependencyGraph for R_old
  oldEntries, newEntries: Lists of repository file records
  newRevisionId: String
Output:
  { graph: TypedDependencyGraph, strategy: String, invalidationConeSize: Integer }

1. Compute Diff:
     diff <- ComputeRevisionDiff(oldEntries, newEntries)
     changedCount <- |diff.addedFiles| + |diff.modifiedFiles| + |diff.deletedFiles|
     totalCount   <- |newEntries|

2. Threshold Check (Safety Fallback):
     If changedCount / totalCount > 0.40:
       freshGraph <- Analyzer.BuildGraph(newEntries, newRevisionId)
       Reconciler.ReconcileGraph(freshGraph, newRevisionId)
       Return { graph: freshGraph, strategy: "full-rebuild-fallback", invalidationConeSize: |freshGraph.nodes| }

3. Clone Graph:
     G <- oldGraph.Clone()
     G.revisionId <- newRevisionId

4. Prune Deleted Artifacts:
     For each f in diff.deletedFiles:
       Remove all nodes v where v.filePath == f from G
       (Automatically prunes connected incoming and outgoing edges)

5. Calculate Invalidation Cone:
     C_inv <- ComputeInvalidationCone(G, diff.modifiedFiles U diff.addedFiles)

6. Invalidate Outgoing Edges of Modified Files:
     For each f in diff.modifiedFiles:
       Remove all symbol nodes declared in f
       Remove all outgoing edges from file node f

7. Add New Nodes:
     For each f in diff.addedFiles:
       Add file node f to G
       Connect repo root to f

8. Selective Re-Analysis:
     For each f in diff.modifiedFiles U diff.addedFiles:
       Analyzer.AnalyzeFile(f, newEntries[f].content, G, candidates, newRevisionId)

9. Evidence Reconciliation:
     Reconciler.ReconcileGraph(G, newRevisionId)

10. Return { graph: G, strategy: "incremental-cone-update", invalidationConeSize: |C_inv| }
```

---

## 4. Correctness & Equivalence Proof Criteria

To guarantee that incremental updates never trade correctness for speed, the system verifies:
1. **Node Set Equivalence:** $V(G_{\text{incr}}) = V(G_{\text{rebuild}})$
2. **Edge Set Equivalence:** $E(G_{\text{incr}}) = E(G_{\text{rebuild}})$
3. **Status Equivalence:** $\forall e \in E(G_{\text{incr}}), \quad \kappa_{\text{incr}}(e) = \kappa_{\text{rebuild}}(e)$

The test suite in `tests/impact_incremental.test.js` enforces bitwise isomorphism between incremental updates and clean full rebuilds across multi-step mutation sequences.
