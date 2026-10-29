# CodePilot AI — Impact Engine: Existing Implementation Audit

**Document Status:** Complete (Phase 1 Baseline Audit)  
**Date:** 2026-10-29  
**Module Target:** CodePilot Impact Engine — Evidence-Aware Dependency Analysis and Regression Test Selection  
**Repository:** [CodePilot-ai](https://github.com/Rishit-ui/CodePilot-ai)  

---

## 1. Executive Summary & Objective

This audit inspects the current CodePilot AI architecture to establish the baseline implementation before introducing the **CodePilot Impact Engine**. The objective is to identify existing static analysis, graph generation, database storage, test execution, and user interface workflows, and document exactly what is working, what is rudimentary, and what is missing.

No architectural components will be discarded or duplicated unnecessarily. The Impact Engine will integrate with the existing database schemas, API routing, and frontend design system while introducing mathematically sound dependency evidence reconciliation, incremental graph invalidation, and conservative regression test selection.

---

## 2. Existing Repository Architecture & Components

| Subsystem | Location | Current Implementation & Operational Status |
| :--- | :--- | :--- |
| **Server & API Routing** | `src/server.js`, `api/index.js` | **WORKING:** HTTP/JSON API using Node.js standard libraries (`node:http`), supporting serverless (Vercel) and standalone environments. Auto-heals project containers on multi-instance setups. |
| **Database & Persistence** | `src/db.js` | **WORKING:** Universal storage supporting embedded SQLite (with in-memory fallback) and PostgreSQL (`pg`). Maintains relational tables for revisions, files, symbols, edges, findings, operations, and test runs. |
| **Static Code Analysis** | `src/analyzer.js`, `src/analyzers/javascript.js`, `python.js`, `docker.js` | **PARTIAL:** Regex-based lexical analysis extracting symbols (functions, classes, routes) and basic dependencies (`imports`, `require()`, `package`). Limited AST depth; lacks cross-file call resolution and dynamic dispatch tracking. |
| **Flow & Graph Visualizer** | `src/flow.js` | **WORKING:** Generates 7 visual architecture and flow graphs (Architecture, Data Flow, Security Boundaries, Error Paths, etc.) mapped directly to AST symbols and static edges. |
| **Test Execution** | `src/test_runner.js`, `POST /api/projects/:id/tests/run` | **PARTIAL / ISOLATED:** Sanitized execution using child process spawning. Filters commands against an allowlist (`npm test`, `pytest`, etc.). On Vercel, returns CI proxy status. Lacks selective test execution based on change delta. |
| **Change/Patch Planning** | `src/planner.js`, `src/server.js` | **WORKING:** Generates multi-task plans, unified diff patches, and rollback mechanisms. Lacks granular impact prediction prior to patch execution. |
| **Frontend Workspace** | `public/app.js`, `public/index.html` | **WORKING:** Modular dashboard featuring dedicated views (Overview, Repository Analysis, Flow Diagrams, Security Findings, AI Chat, API/DB Studio). |

---

## 3. Existing Dependency & Graph Representations

### 3.1 Relational Schema (`symbols` & `edges`)
In `src/db.js`:
- `symbols`: Stores `id`, `revision_id`, `file_path`, `name`, `kind` (`function`, `class`, `route:*`, `entrypoint`), and `line`.
- `edges`: Stores `id`, `revision_id`, `source_path`, `target_path`, `type` (`imports`, `depends-on-package`), `confidence` (`confirmed`), `line`, and `provenance` (`static-es-import`, `static-require`).

### 3.2 Key Limitations in Existing Graph Representation:
1. **File-Level Granularity:** Edges connect `source_path` to `target_path` rather than granular symbol-to-symbol nodes (e.g., `Function -> Function`, `Class -> Interface`, `API Endpoint -> Controller Function`).
2. **Binary / Uniform Confidence:** Existing edges label confidence uniformly as `'confirmed'` with no uncertainty modeling for ambiguous references, wildcard imports, or dynamic property accesses (`obj[method]()`).
3. **No Multi-Evidence Reification:** An edge cannot represent conflicting evidence (e.g., static import present, but runtime trace proves conditional branch never traversed; or dynamic RPC call observed at runtime but absent in static imports).
4. **Monolithic Invalidation:** Re-analyzing a project requires dropping and re-inserting all edges for a revision. No incremental subgraph update exists for single-file diffs.

---

## 4. Existing Test Infrastructure

- **Test Framework:** Node.js native test runner (`node:test`, `node:assert/strict`).
- **Test Corpus:** 39 automated unit, integration, and serverless tests located in `tests/`.
- **Strengths:** 
  - Zero heavy third-party dependencies.
  - High execution velocity (<700ms full suite execution).
  - Deterministic in-memory database mock helpers.
- **Deficiencies for Impact Intelligence:**
  - Tests are executed either in full (`npm test`) or manually per file.
  - There is no mapping connecting test files or test suites to the specific source symbols or modules they exercise.
  - No selective regression testing algorithm is present.

---

## 5. Security Controls & Constraints

1. **SSRF Gateway:** `src/importer.js` strictly validates remote URLs against private, loopback, and cloud metadata IPs (`169.254.169.254`, `127.0.0.1`, RFC 1918) and handles HTTP redirects securely.
2. **Command Injection Mitigation:** `src/test_runner.js` enforces a command allowlist (`ALLOWED_TEST_COMMANDS`) and sanitizes process environment variables (stripping AWS/GitHub tokens, passing only minimal `PATH`, `NODE_ENV=test`, `CI=true`).
3. **Serverless Execution Boundary:** On Vercel, serverless function timeouts (30s) and read-only filesystems (except `/tmp`) prevent long-running background test execution or unconstrained compiler invocations. Any heavy execution must be sandboxed or run via discrete batch runs.

---

## 6. Proposed Impact Engine Architecture & Non-Duplication Strategy

To avoid duplicating existing functionality:
1. **Reuse Ingestion & Storage:** The Impact Engine will leverage `Store` in `src/db.js` for revision management and file content access.
2. **Dedicated Modular Directory (`src/impact/`):**
   - `src/impact/graph.js`: Typed dependency graph supporting symbol-level nodes, edge evidence provenance, and uncertainty modeling.
   - `src/impact/analyzer.js`: Granular JavaScript/TypeScript dependency and call-graph extractor with AST-level call site resolution.
   - `src/impact/reconcile.js`: Multi-source evidence reconciliation algorithm reconciling static, runtime, API contract, and configuration evidence.
   - `src/impact/invalidation.js`: Incremental graph invalidator determining affected subgraphs across revision diffs.
   - `src/impact/impact.js`: Change-impact traversal engine calculating direct, transitive, and uncertain impact cones.
   - `src/impact/test-selector.js`: Regression test selection engine implementing full, change-based, and evidence-aware selection strategies.
   - `src/impact/runner.js`: Security-isolated test runner with resource boundaries, timeouts, and execution trace collection.
3. **Database Migration:** Introduce relational tables for `impact_graphs`, `impact_evidence`, and `impact_analyses` without altering existing `symbols` or `edges` tables, ensuring zero regressions on existing `src/flow.js` views.

---

## 7. Action Plan

- [x] **Phase 1:** Complete baseline implementation audit (`EXISTING_IMPLEMENTATION_AUDIT.md`).
- [ ] **Phase 2:** Formulate research hypotheses and define the minimum functional slice (`RESEARCH_HYPOTHESIS.md`).
- [ ] **Phase 3:** Implement typed dependency graph model and granular source analysis (`src/impact/graph.js`, `src/impact/analyzer.js`).
- [ ] **Phase 4:** Implement evidence reconciliation and incremental graph invalidation (`src/impact/reconcile.js`, `src/impact/invalidation.js`).
- [ ] **Phase 5:** Implement change-impact engine and regression test selection (`src/impact/impact.js`, `src/impact/test-selector.js`, `src/impact/runner.js`).
- [ ] **Phase 6:** Develop reproducible benchmark fixtures and experiment protocol (`tests/impact-engine/fixtures/`, `docs/impact-engine/EXPERIMENT_PROTOCOL.md`).
- [ ] **Phase 7:** Integrate REST APIs in `src/server.js` and build frontend Impact Analysis workspace in `public/`.
- [ ] **Phase 8:** Automated validation, equivalence tests (incremental vs full rebuild), and security checks.
- [ ] **Phase 9:** Structured prior-art review (`PRIOR_ART_MATRIX.md`) and patent-agent discussion package (`PATENT_AGENT_BRIEF.md`).
