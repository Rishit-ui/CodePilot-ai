# CodePilot Impact Engine — Research Hypotheses & Theoretical Framework

**Document Status:** Research Formulation (Phase 2)  
**Date:** 2026-10-29  
**Module Target:** Evidence-Aware Dependency Reconciliation, Incremental Invalidation, and Regression Test Selection  
**Disclaimer:** This technical document frames an engineering research investigation. None of the formulations herein are asserted as established scientific discoveries, patentable inventions, or prior-art-free claims prior to rigorous experimental validation and formal legal patent assessment.

---

## 1. Problem Formulation

Software change-impact analysis and selective regression testing rely on models of system dependencies (call graphs, data-flow graphs, component dependency graphs). However, in modern dynamic, multi-tier software systems, no single source of dependency truth is simultaneously complete, sound, and current:

1. **Static Analysis Incompleteness:** Static source analysis cannot resolve dynamic dispatch, runtime reflection, environment-based service routing, or dynamically imported modules with full recall without introducing overwhelming over-approximation (false positive edges).
2. **Dynamic / Trace Evidence Staleness & Under-Coverage:** Dynamic tracing only captures observed execution paths under existing test suites. If a path is rarely exercised, or if a recent code change has invalidated past execution assumptions, runtime traces are incomplete or stale.
3. **Multi-Source Contradictions:** When static analysis detects a syntactic dependency but an API gateway configuration or runtime trace indicates the path is unreachable, or conversely when runtime telemetry reveals a cross-boundary dependency invisible to the local source AST, conventional tools either discard one source or produce uncalibrated unions.
4. **Graph Rebuild Overhead:** Full dependency graph regeneration on every micro-commit imposes quadratic or cubic scaling overhead on large codebases, discouraging continuous impact evaluation.

The overarching research question is:
> *Can an explicit evidence-reconciled dependency graph combined with conservative boundary invalidation reduce analysis time and test-execution cost while maintaining zero acceptable loss in regression detection compared to full-suite testing?*

---

## 2. Research Area A: Evidence-Aware Dependency Reconciliation

### 2.1 Technical Problem
Conventional dependency graphs store binary edges $(u, v) \in E$. When multiple evidence modalities exist—such as AST lexical imports, runtime function entry traces, OpenAPI service schemas, and environment configuration mappings—they frequently disagree. A simplistic union ($E_{\text{static}} \cup E_{\text{dynamic}}$) causes bloated impact cones due to stale traces, while an intersection ($E_{\text{static}} \cap E_{\text{dynamic}}$) causes dangerous false negatives (missed regressions).

### 2.2 Baseline Approaches
- **Static Conservative Supergraph:** Assumes any syntactically feasible call might happen. Tends to over-select tests (poor precision).
- **Dynamic Coverage Matrices (e.g., fault localization / test prioritization matrices):** Considers only edges observed during previous test runs. Vulnerable to newly added code paths or un-exercised branches (poor recall on new features).
- **Ad-Hoc Union:** Combines all sources without revision tagging, allowing stale historical observations to persist indefinitely.

### 2.3 Assumptions & Limitations
- **Assumption 1:** Software artifacts provide verifiable revision identifiers (e.g., Git commit SHAs, content hashes).
- **Assumption 2:** Evidence records can be tagged with collection provenance and revision bounds.
- **Limitation:** In the presence of obfuscated code or untyped dynamic evaluation (`eval`), static analysis may fail to provide even lexical candidate targets.

### 2.4 Testable Hypothesis $H_1$
> **Hypothesis $H_1$ (Reconciliation Safety & Precision):**  
> Formally representing dependencies as multi-attributed tuples $e = (u, v, \tau, \mathcal{S}, \kappa, \rho)$, where $\mathcal{S}$ is an evidence bundle with revision timestamps and $\kappa \in \{\text{confirmed}, \text{inferred}, \text{observed}, \text{conflicted}, \text{unresolved}\}$, and applying deterministic reconciliation rules (invalidating stale runtime evidence upon AST signature mutation while promoting corroborated edges) will achieve a higher test-selection precision than the static conservative supergraph without reducing regression fault recall.

### 2.5 Disproof Criteria (Falsification)
$H_1$ is disproved if on deterministic evaluation benchmarks:
1. The evidence-reconciled graph fails to select a test that detects a real regression (Recall $< 100\%$ relative to full suite), OR
2. The number of selected tests equals or exceeds the static conservative supergraph across $>90\%$ of change scenarios (Precision gain is statistically indistinguishable from zero, $p > 0.05$).

### 2.6 Measurable Outcomes
- Fault detection recall rate: $R = \frac{|D_{\text{selected}} \cap D_{\text{total}}|}{|D_{\text{total}}|}$.
- Test reduction ratio: $\eta = 1 - \frac{|T_{\text{selected}}|}{|T_{\text{full}}|}$.
- Proportion of unresolved or contradictory edges correctly classified as high-risk fallback regions.

### 2.7 Prior-Art Search Requirements
- Hybrid static/dynamic call graph construction (e.g., Gupta et al., Ernst et al. Daikon invariants).
- Multi-provenance software dependency models.
- Uncertainty modeling in program slicing and pointer analysis.

---

## 3. Research Area B: Incremental Graph Invalidation & Subgraph Rebuilding

### 3.1 Technical Problem
Re-analyzing an entire multi-thousand-file repository on each commit to reconstruct the dependency graph is computationally prohibitive. However, naïve file-level invalidation (e.g., updating only the modified file's direct edges) fails when a change alters an exported interface, renames a symbol, alters an inheritance hierarchy, or modifies a shared configuration key, silently corrupting transitive paths.

### 3.2 Baseline Approaches
- **Full Clean Rebuild:** Recomputes all nodes and edges from scratch on every revision change. Safe but $O(|V| + |E|)$ with heavy AST parsing cost.
- **Direct-File Invalidation:** Re-parses only the changed file $f$ and replaces edges where $\text{source}(e) = f$. Fails when incoming edges from other files depend on deleted or changed exports of $f$.

### 3.3 Assumptions & Limitations
- **Assumption 1:** Diffs can be computed deterministically between revisions $R_{\text{prev}}$ and $R_{\text{curr}}$ at the file and symbol level.
- **Limitation:** Macro expansions or deep metaprogramming can cause non-local semantic shifts without syntactic changes in importing files.

### 3.4 Testable Hypothesis $H_2$
> **Hypothesis $H_2$ (Incremental Equivalence & Efficiency):**  
> An invalidation algorithm that traverses the reverse dependency boundary of altered export signatures and configuration keys to identify an invalidation cone $\mathcal{C}_{\text{inv}}$, and recomputes only $\mathcal{C}_{\text{inv}}$ while preserving unaffected cached subgraphs, produces a graph that is structurally isomorphic and evidence-equivalent to a full clean rebuild, while reducing re-computation latency by at least $50\%$ on changes altering $\le 5\%$ of files.

### 3.5 Disproof Criteria (Falsification)
$H_2$ is disproved if:
1. Automated graph equivalence tests detect any missing edge, spurious edge, or mismatched evidence label between an incrementally updated graph and a clean full rebuild on any supported fixture, OR
2. Incremental update latency $T_{\text{incr}}$ exceeds full rebuild latency $T_{\text{full}}$ on average for localized diffs ($|\Delta F| \le 5$).

### 3.6 Measurable Outcomes
- Graph Isomorphism & Edge Equivalence: $\Delta(G_{\text{incr}}, G_{\text{rebuild}}) = 0$.
- Execution Wall-Clock and CPU Time: Ratio $T_{\text{incr}} / T_{\text{full}}$.
- Invalidation cone accuracy: $|\mathcal{C}_{\text{inv}}| / |V_{\text{total}}|$.

### 3.7 Prior-Art Search Requirements
- Incremental compilation and dependency tracking (e.g., TypeScript compiler watch mode, Rust incremental compilation, Gradle/Bazel task graph invalidation).
- Dynamic graph maintenance algorithms (e.g., Ramalingam & Reps incremental dataflow).

---

## 4. Research Area C: Conservative Regression Test Selection Under Incomplete Evidence

### 4.1 Technical Problem
Regression Test Selection (RTS) seeks to identify a minimal subset of tests $T \subseteq T_{\text{all}}$ that exercises modified code. When dependency information is incomplete (e.g., dynamic imports, missing test coverage maps, unparsed reflection, or contradictory evidence), conventional RTS tools either unsafely omit tests (causing regression escapes) or fall back entirely to running the entire test suite, forfeiting all efficiency gains.

### 4.2 Baseline Approaches
- **Full Suite Execution ($T_{\text{all}}$):** Runs 100% of tests. Perfect recall (subject to test suite capability), maximum resource expenditure.
- **File-Level Coverage RTS:** Selects any test whose coverage trace touched a modified file. Fails if coverage trace is stale or if modification introduces new dependencies not exercised in the trace.
- **Pure Static RTS:** Selects tests with static call paths to changed functions. Misses dynamic, event-driven, or framework-routed paths.

### 4.3 Assumptions & Limitations
- **Assumption 1:** A fallback policy must err on the side of safety: running an unnecessary test is acceptable; failing to run a test that catches a defect is unacceptable.
- **Limitation:** If a change modifies a foundational root utility (e.g., `src/config.js` or global middleware), conservative selection may legitimately select the entire test suite.

### 4.4 Testable Hypothesis $H_3$
> **Hypothesis $H_3$ (Conservative Fallback & Recall Preservation):**  
> A three-tier test selection policy that categorizes affected nodes into direct impact, transitive impact, and *uncertainty cones* (nodes impacted by conflicting, unresolved, or stale evidence), and automatically elevates uncertainty cones to conservative selection, will achieve $100\%$ fault detection recall relative to the full test suite on controlled regression benchmarks while executing fewer tests than the full suite for modular changes.

### 4.5 Disproof Criteria (Falsification)
$H_3$ is disproved if:
1. Any injected synthetic regression that is detected by the full suite is missed by the conservative evidence-aware test selector (any false negative in controlled regression experiments).
2. The selection decision cannot be explained by an auditable, verifiable causal evidence chain.

### 4.6 Measurable Outcomes
- Regression Detection Recall: Must equal $100.0\%$ on benchmark suite.
- Test Execution Time Savings: $(T_{\text{full}} - T_{\text{selected}}) / T_{\text{full}}$.
- Auditability score: $100\%$ of selected and omitted tests accompanied by documented decision rationales.

### 4.7 Prior-Art Search Requirements
- Safe Regression Test Selection (e.g., Rothermel & Harrold, Ekstazi by Gligoric et al., STARTS by Legunsen et al.).
- Risk-based and budget-constrained test prioritization.
- Handling of non-determinism, reflection, and dynamic languages in test selection.

---

## 5. Summary of Experimental Protocol Plan

The empirical evaluation of hypotheses $H_1, H_2, H_3$ will be conducted against reproducible fixtures created in `tests/impact-engine/fixtures/`:
1. **Fixture 1 (Direct Call & Refactor):** Simple direct function call modifications.
2. **Fixture 2 (Transitive Propagation):** Deep dependency chains across 5+ modules.
3. **Fixture 3 (Dynamic / Event Dispatch):** Dynamic event emitters and conditional route handlers.
4. **Fixture 4 (Configuration & Env Contract):** Configuration key dependencies affecting service routing.
5. **Fixture 5 (Stale & Contradictory Evidence):** Historical traces that contradict current AST signatures.
6. **Fixture 6 (Renamed / Deleted Symbols):** Interface mutation and edge invalidation.

Each benchmark scenario will record metrics to `results/impact-engine/` in structured JSON and human-readable markdown.
