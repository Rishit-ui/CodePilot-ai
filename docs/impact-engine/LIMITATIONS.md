# CodePilot Impact Engine — Known Limitations

This document records the current limitations of the CodePilot Impact Engine.
Honest acknowledgement of limitations is essential for credible research and responsible engineering.

---

## 1. Static Analysis Completeness

**Limitation**: The analyzer uses AST traversal (via `acorn`) for JavaScript/TypeScript and regular-expression heuristics for Python, Dockerfiles, and configuration files. It does not instrument runtime execution.

**Consequences**:
- Dynamic `require()` calls (computed module paths) produce no edges.
- `eval()`, `Function()`, and similar constructs are invisible.
- Decorator-driven dependency injection (NestJS, Angular) may not be resolved.
- Monkey-patching at runtime is not detected.
- Circular imports are handled (visited-set prevents infinite loops), but the edges may appear in incorrect directions.

**Mitigation**: The uncertainty cone captures nodes with `UNVERIFIED` or `CONTRADICTED` edge status, ensuring they are included in the impact set even when static analysis is insufficient.

---

## 2. Incremental Update Performance on Small Repositories

**Observed finding** (documented in `EXPERIMENT_RESULTS.md`): On micro-fixtures with fewer than 10 files, incremental graph updates are slower than full rebuilds.

- Full rebuild avg: **0.401 ms**
- Incremental update avg: **0.542 ms**
- Incremental is **0.74×** (worse) on small fixtures

**Reason**: The diff + clone overhead dominates when the graph is small.

**Mitigation**: The fallback threshold is set to 70% invalidation for small repos and 40% for larger repos. Below the threshold, the engine falls back to full rebuild automatically.

**Claimed benefit**: Incremental updates provide benefit only when the invalidation fraction is below the threshold and the graph is large enough that cloning is cheaper than rebuilding from scratch.

---

## 3. Cross-Language Boundaries

**Limitation**: The analyzer treats each file independently. Cross-language calls (e.g., a Node.js process spawning a Python subprocess, or a JavaScript FFI call into Rust) produce no dependency edges.

**Consequence**: The impact cone will not propagate across language boundaries.

---

## 4. External Service Dependencies

**Limitation**: Dependencies on external HTTP services, databases, or message queues are not discovered through static analysis. Only `ROUTES_TO` and `CONFIGURES` edges are produced for Express routes and environment variable reads.

**Consequence**: If a changed function reads from a database that is also consumed by another service, the other service is not included in the impact cone.

---

## 5. Test Coverage Integration

**Limitation**: The current implementation does not ingest real test coverage reports (e.g., Istanbul/V8 coverage JSON, pytest-cov XML). The `TEST_COVERAGE` evidence source is defined in the data model but not yet populated by the analyzer.

**Consequence**: The evidence-aware strategy relies on static file-path conventions (`*.test.js`, `test_*.py`) to discover test files, not on actual coverage data.

---

## 6. Git History Integration

**Limitation**: The impact engine does not directly read the git history. The `changedFiles` input is supplied by the caller (user or CI pipeline). If the caller provides an incomplete list of changed files, the impact cone will be incomplete.

---

## 7. Regression Detection — Known False Negatives

The benchmark (Scenario 2 and 3) shows that the `changed-file` strategy misses regressions when the changed file is not directly imported by the affected test.

The `evidence-aware` strategy correctly identifies these cases through transitive edge traversal. However, any false negative in edge construction (see §1) may cause the evidence-aware strategy to also miss a regression.

**The `all` strategy has zero false negatives but 0% reduction.**

---

## 8. Security Scope

The `IsolatedTestRunner` allowlist prevents injection of arbitrary shell commands. However:
- It does not sandbox file system access.
- It does not sandbox network access.
- Test processes run with the same user privileges as the Node.js server.
- The allowlist is defined in code; modifying `src/impact/runner.js` changes the security boundary.

For production deployment, tests should be run in a fully isolated container or virtual machine.

---

## 9. Novelty and Patent Status

The reconciliation algorithm, incremental invalidation approach, and evidence-aware test selection as implemented here are **not claimed to be novel**. Related prior art exists in:

- Google's Bazel build system (dependency analysis, selective test execution)
- Microsoft's COSMOS (change-impact analysis)
- Facebook's Sapienz and related tools
- Academic literature on regression test selection

See `PRIOR_ART_MATRIX.md` and `PATENT_AGENT_BRIEF.md` for a full assessment. The engine is intended as a research exploration, not a patent filing.

---

## 10. Scalability

The in-memory graph representation does not scale beyond repositories of approximately:
- **10,000 nodes** before memory pressure (each node ~500 bytes + edges)
- **100 MB** of source code before analysis latency exceeds 30 seconds

For large monorepos, partitioned analysis (per-package sub-graphs) would be required.
