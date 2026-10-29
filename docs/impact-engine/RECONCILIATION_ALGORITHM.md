# Evidence Reconciliation Algorithm

**Document Status:** Implementation Reference  
**Date:** 2026-10-29  
**Module:** `src/impact/reconcile.js`  
**Purpose:** Deterministic reconciliation of multi-source dependency evidence.

---

## 1. Problem & Architecture

In software systems, dependency evidence arrives from multiple distinct modalities:
- **Static AST Extraction:** High precision on lexical imports, but incomplete on dynamic dispatch, plugin hooks, or reflection.
- **Runtime Traces:** Proof of actual execution, but conditioned on test coverage and historically stale once source code mutates.
- **API Contracts:** Route declarations and OpenAPI manifests defining cross-boundary paths.
- **Configuration Manifests:** Environment variable routing and feature flags.

The Evidence Reconciler takes an edge $e = (u, v)$ and its attached evidence records $\mathcal{E}(e) = \{r_1, r_2, \dots, r_k\}$, applies deterministic precedence rules, and assigns an auditable `ValidationStatus`:
$$\kappa(e) \in \{\text{confirmed}, \text{inferred}, \text{observed}, \text{contract}, \text{conflicted}, \text{unresolved}\}$$

---

## 2. Algorithm Pseudocode

```
Algorithm ReconcileEdge(edge, currentRevisionId):
Input:
  edge: DependencyEdge with evidence list E
  currentRevisionId: String (active commit/revision hash)
Output:
  ReconciliationDecision { decision, status, explanation }

1. If E is empty:
     edge.status <- UNRESOLVED
     edge.isResolved <- false
     Return Decision("unresolved-no-evidence", UNRESOLVED)

2. Partition E into:
     E_current <- { r in E | r.revisionId == currentRevisionId or r.revisionId is null }
     E_stale   <- { r in E | r.revisionId != currentRevisionId and r.revisionId is not null }

3. Contradiction Check:
     If exists r in E_current such that r.status == CONFLICTED or r.details.contradiction == true:
       edge.status <- CONFLICTED
       edge.isResolved <- false
       Return Decision("mark-conflicted", CONFLICTED, conservativeFallback=true)

4. Corroboration Rule (Static AST + Runtime Trace):
     hasStatic  <- exists r in E_current with r.source == STATIC_AST
     hasRuntime <- exists r in E_current with r.source == RUNTIME_TRACE
     If hasStatic and hasRuntime:
       edge.status <- CONFIRMED
       edge.isResolved <- true
       Return Decision("corroborated-confirmed", CONFIRMED)

5. Contract Rule:
     hasContract <- exists r in E_current with r.source in {API_CONTRACT, CONFIG_MANIFEST}
     If hasContract:
       edge.status <- CONTRACT_DERIVED
       edge.isResolved <- true
       Return Decision("contract-established", CONTRACT_DERIVED)

6. Dynamic Runtime Observation (Runtime only):
     If hasRuntime and not hasStatic:
       edge.status <- RUNTIME_OBSERVED
       edge.isResolved <- true
       Return Decision("runtime-dynamic-call", RUNTIME_OBSERVED)

7. Static AST Inference (Static only):
     If hasStatic and not hasRuntime:
       edge.status <- STATICALLY_INFERRED
       edge.isResolved <- true
       Return Decision("static-inferred-baseline", STATICALLY_INFERRED)

8. Stale Fallback:
     If E_current is empty and E_stale is non-empty:
       edge.status <- UNRESOLVED
       edge.isResolved <- false
       Return Decision("stale-evidence-unresolved", UNRESOLVED)

9. Default Fallback:
     edge.status <- UNRESOLVED
     edge.isResolved <- false
     Return Decision("unresolved-fallback", UNRESOLVED)
```

---

## 3. Complexity & Data Structure Analysis

- **Time Complexity:** For a graph with $|E|$ edges, where each edge has at most $|\mathcal{E}|$ evidence records (typically $|\mathcal{E}| \le 4$), iterating and evaluating precedence runs in $O(|E| \cdot |\mathcal{E}|) = O(|E|)$ linear time.
- **Space Complexity:** Operates directly on the in-memory graph representation without duplicating adjacency matrices, requiring $O(|E|)$ additional memory for the decision audit log.
- **Deterministic Property:** The precedence rules contain no non-deterministic iterations, random sampling, or heuristic race conditions. Given the exact same evidence set, the output is guaranteed to be bitwise identical.

---

## 4. Limitations & Fallback Behavior

1. **Uncertainty Elevation:** Whenever an edge resolves to `CONFLICTED` or `UNRESOLVED`, the downstream test selector automatically elevates the edge to the *Uncertainty Cone*, preventing regression escapes.
2. **Dynamic Language Bounds:** If dynamic code constructs a target using arbitrary string concatenation (`require('./' + variable)`), the static analyzer marks the target as unresolved rather than guessing, which preserves audit integrity.
