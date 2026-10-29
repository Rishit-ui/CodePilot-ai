# Regression Test Selection Algorithm

**Document Status:** Implementation Reference  
**Date:** 2026-10-29  
**Module:** `src/impact/test-selector.js`  
**Purpose:** Multi-strategy regression test selection with auditable decision logs and conservative uncertainty elevation.

---

## 1. Problem Formulation

Given a software repository with test suite $T = \{t_1, t_2, \dots, t_n\}$ and a change delta $\Delta = \{f_1, f_2, \dots, f_m\}$, Regression Test Selection (RTS) seeks to identify a subset $T_{\text{sel}} \subseteq T$ such that:
1. **Safety (Fault Recall):** If any test $t \in T$ would reveal a regression introduced by $\Delta$, then $t \in T_{\text{sel}}$ (Recall = 100%).
2. **Efficiency (Reduction Ratio):** The execution cost of $T_{\text{sel}}$ is significantly lower than $T$ for localized modular changes ($|T_{\text{sel}}| < |T|$).

---

## 2. Selection Strategies

The engine implements three distinct strategies for comparative benchmarking:

### Strategy 1: Full Regression Baseline (`all`)
- Selects 100% of discovered tests: $T_{\text{sel}} = T$.
- Guaranteed zero regression escapes, but maximal test duration and compute expenditure.

### Strategy 2: Changed-File Baseline (`changed-file`)
- Selects tests that directly correspond to a modified file or directly import it.
- **Vulnerability:** Fails to detect regressions caused by transitive dependency chains, dynamic dispatch, or shared configuration mutations.

### Strategy 3: Evidence-Aware Conservative Selection (`evidence-aware`) — Proposed Method
- Constructs the full change impact cone $\mathcal{C}_{\text{impact}} = \mathcal{C}_{\text{direct}} \cup \mathcal{C}_{\text{transitive}} \cup \mathcal{C}_{\text{uncertainty}}$.
- Automatically elevates the **Uncertainty Cone** $\mathcal{C}_{\text{uncertainty}}$ (nodes with `conflicted`, `unresolved`, or stale dependency evidence) into mandatory selection.
- If root configuration files (`.env`, `package.json`, global manifests) are modified, automatically triggers conservative fallback to full suite execution.

---

## 3. Algorithm Pseudocode

```
Algorithm SelectRegressionTests(graph, changedFiles, strategy):
Input:
  graph: TypedDependencyGraph
  changedFiles: List of modified file paths
  strategy: 'all' | 'changed-file' | 'evidence-aware'
Output:
  TestSelectionResult { selectedTestFiles, decisions, summary }

1. Discover Tests:
     allTests <- { node in graph.nodes | node.kind == TEST }

2. Compute Impact:
     impactReport <- ChangeImpactEngine.AnalyzeImpact(graph, changedFiles)
     affectedNodeIds <- impactReport.directImpacts U impactReport.transitiveImpacts U impactReport.uncertaintyCone

3. Execute Selection:
     selectedFiles <- Set()
     decisions <- List()

     If strategy == 'all':
       For each t in allTests:
         selectedFiles.Add(t.filePath)
         decisions.Append(Decision(t, selected=true, reason="Full regression baseline"))

     Else if strategy == 'changed-file':
       changedSet <- Set(changedFiles)
       For each t in allTests:
         deps <- GetTestDependencies(t)
         touchesDirect <- (t.filePath in changedSet) or (exists d in deps such that d in changedSet)
         selectedFiles.AddIf(touchesDirect, t.filePath)
         decisions.Append(Decision(t, selected=touchesDirect))

     Else (strategy == 'evidence-aware'):
       configModified <- exists f in changedFiles such that IsConfigOrManifest(f)
       For each t in allTests:
         If configModified:
           selectedFiles.Add(t.filePath)
           decisions.Append(Decision(t, selected=true, reason="Conservative config fallback"))
         Else if t.id in affectedNodeIds:
           selectedFiles.Add(t.filePath)
           decisions.Append(Decision(t, selected=true, reason="Directly in impact cone"))
         Else:
           deps <- GetTestDependencies(t)
           matchedDep <- FirstMatch(deps, d in affectedNodeIds)
           If matchedDep is not null:
             selectedFiles.Add(t.filePath)
             decisions.Append(Decision(t, selected=true, reason="Transitively affected dependency: " + matchedDep))
           Else:
             decisions.Append(Decision(t, selected=false, reason="No direct or transitive dependency"))

4. Return TestSelectionResult(selectedFiles, decisions, summary)
```

---

## 4. Auditability & Explainability

Every single test selection decision is recorded with a traceable causal rationale explaining:
1. The exact dependency path from the changed component to the test.
2. The evidence modality supporting the path (`static-ast`, `runtime-trace`, `api-contract`).
3. Whether uncertainty elevation was invoked.
