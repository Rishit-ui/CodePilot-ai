# CodePilot Impact Engine — System Architecture

## Overview

The CodePilot Impact Engine is an evidence-aware dependency analysis and regression test selection module embedded in the CodePilot AI platform. It answers the question: **given a set of changed source files, which components and regression tests are likely affected?**

```
┌────────────────────────────────────────────────────────────────────────┐
│                       CodePilot AI Platform                            │
│                                                                        │
│  ┌──────────────┐    REST API    ┌───────────────────────────────────┐ │
│  │   Frontend   │◄─────────────►│        src/server.js               │ │
│  │ (index.html/ │               │  POST /impact/analyze              │ │
│  │   app.js)    │               │  POST /impact/select-tests         │ │
│  └──────────────┘               │  POST /impact/run-tests            │ │
│                                 │  GET  /impact/graph                │ │
│                                 │  GET  /impact/history              │ │
│                                 └────────────────┬──────────────────┘ │
│                                                  │                    │
│                          ┌───────────────────────▼──────────────────┐ │
│                          │          Impact Engine Core               │ │
│                          │                                           │ │
│                          │  ┌──────────────┐  ┌──────────────────┐  │ │
│                          │  │  analyzer.js │  │   reconcile.js   │  │ │
│                          │  │ (AST-based   │  │ (Evidence        │  │ │
│                          │  │  symbol &    │  │  reconciliation  │  │ │
│                          │  │  import      │  │  9 rules)        │  │ │
│                          │  │  extraction) │  └────────┬─────────┘  │ │
│                          │  └──────┬───────┘           │            │ │
│                          │         │                   │            │ │
│                          │  ┌──────▼───────────────────▼─────────┐  │ │
│                          │  │          graph.js                   │  │ │
│                          │  │  TypedDependencyGraph               │  │ │
│                          │  │  - NodeKind (FILE, FUNCTION, etc.)  │  │ │
│                          │  │  - EdgeType (CALLS, IMPORTS, etc.)  │  │ │
│                          │  │  - EvidenceSource                   │  │ │
│                          │  │  - ValidationStatus                 │  │ │
│                          │  └──────┬──────────────────────────────┘  │ │
│                          │         │                                  │ │
│                          │  ┌──────▼───────┐  ┌──────────────────┐  │ │
│                          │  │invalidation  │  │    impact.js     │  │ │
│                          │  │    .js       │  │ ChangeImpactEng. │  │ │
│                          │  │(incremental  │  │ - direct cone    │  │ │
│                          │  │ graph update)│  │ - transitive     │  │ │
│                          │  └──────────────┘  │ - uncertainty    │  │ │
│                          │                    │ - endpoints      │  │ │
│                          │                    └──────┬───────────┘  │ │
│                          │                           │              │ │
│                          │  ┌────────────────────────▼───────────┐  │ │
│                          │  │        test-selector.js             │  │ │
│                          │  │  RegressionTestSelector             │  │ │
│                          │  │  Strategies: ALL | CHANGED_FILE |  │  │ │
│                          │  │             EVIDENCE_AWARE         │  │ │
│                          │  └────────────────────────────────────┘  │ │
│                          │                                           │ │
│                          │  ┌────────────────────────────────────┐  │ │
│                          │  │           runner.js                │  │ │
│                          │  │  IsolatedTestRunner                │  │ │
│                          │  │  - command allowlist               │  │ │
│                          │  │  - secret stripping                │  │ │
│                          │  │  - shell=false on Windows          │  │ │
│                          │  └────────────────────────────────────┘  │ │
│                          └───────────────────────┬──────────────────┘ │
│                                                  │                    │
│                          ┌───────────────────────▼──────────────────┐ │
│                          │        src/db.js (SQLite via better-      │ │
│                          │        sqlite3) — impact_analyses table   │ │
│                          └──────────────────────────────────────────┘ │
└────────────────────────────────────────────────────────────────────────┘
```

## Module Responsibilities

| Module | File | Responsibility |
|--------|------|----------------|
| Graph | `src/impact/graph.js` | Typed dependency graph with evidence, edge kinds, validation states |
| Analyzer | `src/impact/analyzer.js` | Static AST-based extraction of symbols, imports, configs, tests, routes |
| Reconciler | `src/impact/reconcile.js` | 9-rule precedence reconciliation of conflicting evidence sources |
| Invalidation | `src/impact/invalidation.js` | Incremental graph update and equivalence verification |
| Impact Engine | `src/impact/impact.js` | Change-impact cone traversal: direct, transitive, uncertainty, endpoints |
| Test Selector | `src/impact/test-selector.js` | Three test selection strategies with reduction metrics |
| Runner | `src/impact/runner.js` | Isolated subprocess test execution with allowlist and secret stripping |

## Data Flow

```
Project Files
     │
     ▼
SourceCodeImpactAnalyzer.analyzeDirectory()
     │  extracts: files, functions, imports, tests, routes, config keys
     │
     ▼
TypedDependencyGraph  ←──── EvidenceReconciler (9 rules)
     │  nodes + evidence-annotated edges
     │
     ├──► computeRevisionDiff()        ← incremental invalidation
     │        └──► updateGraphIncrementally()
     │
     └──► ChangeImpactEngine.computeImpact(changedFiles)
               │  returns: { direct, transitive, uncertainty, affectedEndpoints, affectedConfigKeys }
               │
               ▼
         RegressionTestSelector.select(strategy, graph, impactCone, changedFiles)
               │  returns: { selectedTests, totalAvailable, selectedCount, reduction }
               │
               ▼
         IsolatedTestRunner.run(testFiles)
               │  returns: { status, exitCode, output, durationMs }
               │
               ▼
         Store.saveImpactAnalysis()  → SQLite impact_analyses table
```

## API Surface

All routes are prefixed with `/api/projects/:id/impact`.

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/graph` | Return the current serialized dependency graph |
| `POST` | `/analyze` | Build graph + compute impact cone for changed files |
| `POST` | `/select-tests` | Select regression tests using the specified strategy |
| `POST` | `/run-tests` | Select and execute regression tests in an isolated subprocess |
| `GET` | `/history` | List past impact analyses stored in the database |

## Security Properties

- **Command allowlist**: `IsolatedTestRunner` only executes pre-approved commands (`npm test`, `npx jest`, `python -m pytest`, etc.)
- **Secret stripping**: All environment variables containing secret-related key names are removed before spawning subprocesses
- **Shell injection prevention**: `shell: false` always; on Windows, `npm.cmd` is used directly
- **SSRF protection**: No dynamic URL construction from user input in the engine itself

## Technology Stack

| Layer | Technology |
|-------|-----------|
| Runtime | Node.js ≥18 (ESM-compatible CJS) |
| AST parsing | `acorn` (JS/TS), regex heuristics (Python, config files) |
| Graph storage | In-memory `Map` structures (serialized to JSON for API response) |
| Persistence | SQLite via `better-sqlite3` (existing `src/db.js`) |
| Testing | Node.js built-in `node:test` runner |
| Benchmarking | Custom script at `scripts/impact-engine/benchmark.js` |
