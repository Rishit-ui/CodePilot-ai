# CodePilot Impact Engine — Patent Agent Brief

> **IMPORTANT DISCLAIMER**: This document is prepared for informational purposes to facilitate a conversation with a registered patent attorney or patent agent. It does **not** constitute legal advice, does not establish patentability, does not establish freedom-to-operate, and does not represent a legal opinion of any kind. Patent eligibility determinations require professional legal assessment by a qualified practitioner.

---

## 1. Invention Disclosure Summary

**Project**: CodePilot Impact Engine  
**Module path**: `src/impact/`  
**Repository**: https://github.com/Rishit-ui/CodePilot-ai  
**Disclosure date**: 2026-10-29  

### Problem Addressed

Software change-impact analysis must combine multiple, potentially conflicting sources of dependency information (static analysis, runtime traces, API specifications, configuration files, test coverage) to determine which components and tests are affected by a source code change. Existing tools typically rely on a single evidence source, failing when that source is incomplete, stale, or contradictory.

### Technical Solution

The engine:
1. Constructs a **typed dependency graph** where each edge carries evidence records annotated with source provenance and revision identifiers.
2. Applies a **deterministic 9-rule precedence ordering** to reconcile conflicting evidence and assign a validation status (`CORROBORATED`, `UNVERIFIED`, `CONTRADICTED`, `INVALIDATED`) and confidence score to each edge.
3. Performs **incremental graph invalidation** when source files change: computes a diff of affected nodes, invalidates the forward reachability cone, and triggers selective re-analysis. Falls back to full rebuild when the invalidation fraction exceeds a configurable threshold.
4. Computes a **three-tier impact cone**: direct dependencies, transitive dependencies, and an uncertainty cone of nodes with conflicting or unverified evidence.
5. Selects regression tests using one of three strategies: `all` (baseline), `changed-file` (naïve), or `evidence-aware` (graph-traversal with uncertainty inclusion). The evidence-aware strategy achieves 100% recall on the benchmark scenarios while reducing test execution by 50–75%.

---

## 2. Claims Candidates for Attorney Review

The following are potential claim areas for attorney analysis. These are NOT formal patent claims.

### Claim Area A — Evidence-Annotated Dependency Graph
A method of representing software dependencies wherein each dependency edge is annotated with one or more evidence records, each record identifying an evidence source (static analysis, runtime trace, API specification, configuration file, test coverage), a revision identifier, and source-specific payload data.

### Claim Area B — Deterministic Multi-Source Reconciliation
A method of reconciling conflicting dependency evidence using a fixed precedence ordering of evidence sources, wherein conflicts are recorded rather than silently resolved, and edges are assigned a validation status reflecting the reconciliation outcome.

### Claim Area C — Uncertainty-Inclusive Impact Cone
A change-impact analysis method that produces a three-tier result: (1) directly dependent nodes, (2) transitively dependent nodes, (3) an uncertainty set of nodes connected through edges with contradicted or unverified validation status — ensuring nodes with uncertain dependencies are conservatively included in the impact set.

### Claim Area D — Adaptive Incremental Graph Update
A graph maintenance method that computes the revision diff between two graph states, identifies the minimum invalidation cone, and selectively updates only invalidated regions, falling back to full rebuild when the invalidation fraction exceeds a threshold calibrated to repository size.

### Claim Area E — Multi-Strategy Test Selection with Recall Guarantee
A test selection system providing selectable strategies with formally defined recall properties: the evidence-aware strategy guarantees inclusion of all tests in the uncertainty cone, providing a weaker recall guarantee than `all` but stronger than `changed-file`.

---

## 3. Prior Art Identified

A prior art matrix is documented in `PRIOR_ART_MATRIX.md`. Key overlapping systems:

| System | Overlap |
|--------|---------|
| Bazel / Buck2 | Dependency graph, selective test execution |
| Microsoft COSMOS (ESEC/FSE 2019) | Dynamic call-graph test selection |
| pytest-testmon | Coverage-based selective execution |
| Nx Affected | Git-diff + project-graph traversal |
| AGM belief revision | Theoretical basis for evidence conflict resolution |

The **specific combination** of typed multi-source evidence, deterministic reconciliation, incremental invalidation with fallback, and three-tier uncertainty cone has not been found in the prior art survey. This does not mean such combination is absent in the literature; it means it was not located in the survey conducted.

---

## 4. Questions for Patent Attorney

1. Does the deterministic 9-rule reconciliation of multi-source dependency evidence constitute a patentable method distinct from probabilistic approaches (Dempster-Shafer)?
2. Is the uncertainty-inclusive impact cone (Claim Area C) distinguishable from standard transitive closure with null-edge handling in existing systems?
3. Does the adaptive fallback threshold in incremental graph update (Claim Area D) constitute a non-obvious engineering choice?
4. Is the prior art survey in `PRIOR_ART_MATRIX.md` sufficiently broad for freedom-to-operate analysis?
5. What jurisdictions are appropriate for filing given the software-implemented nature of the claims?

---

## 5. Inventorship Notes

The module was designed and implemented by the CodePilot AI development team. Attribution records are available in the git commit history of the repository.

---

## 6. Next Steps

- [ ] Retain a registered patent attorney or agent for formal evaluation
- [ ] Conduct professional prior art search (USPTO, EPO, Google Patents)
- [ ] File provisional application if attorney recommends doing so (provides 12-month priority date)
- [ ] Document any commercial use or public disclosure dates (public GitHub repository constitutes public disclosure)

> **Reminder**: A public GitHub repository constitutes prior art and public disclosure. Any patent application must be filed within 12 months of the first public disclosure in the United States (35 U.S.C. § 102(b)(1)(A)).
