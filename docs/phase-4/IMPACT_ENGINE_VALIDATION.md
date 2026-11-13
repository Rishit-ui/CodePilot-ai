# Impact Engine Validation

## Actual implemented algorithm

1. Parse JavaScript/TypeScript with `@babel/parser` and Python with `@lezer/python`.
2. Create revision-scoped repository, file, symbol, endpoint, configuration, test and external-package nodes.
3. Create typed edges for imports, references, calls, inheritance, routes, configuration and test coverage. Every edge contains source, file/line when available, parser/method, revision and limitations.
4. Reconcile evidence deterministically as confirmed, statically inferred, runtime observed, contract-derived, conflicted, unresolved or invalidated. Phase 4 does not manufacture runtime-observed evidence.
5. Compute direct impact from changed files and symbols, then traverse incoming dependency edges for the transitive impact cone. Conflicted, unresolved and invalidated edges expand the uncertainty cone.
6. Select tests using full-suite, changed-file, stored-coverage or evidence-aware strategies.
7. For incremental updates, diff file content hashes, delete removed nodes, reparse changed/added files, reconcile evidence and compare the result with a clean rebuild.

## Correctness evidence

Tests cover stable node/edge identity, evidence merging, serialization/restoration, cycles, self-calls, relative imports, deleted and renamed files, stale evidence invalidation, revision isolation and full-rebuild equivalence. All 50/200/1,000-source-file benchmark graphs reconstructed equivalently after the controlled incremental change.

## Benchmark result boundary

Across nine synthetic scenarios and 14 declared affected-test instances, evidence-aware selection chose 14 tests with 14 true positives, 0 false positives and 0 misses. Full-suite chose 36 tests with 22 false positives and no misses. Changed-file and stored-coverage each chose 6 tests and missed 8 declared affected-test instances.

These are controlled synthetic CommonJS results. They do not show production accuracy, external validity, novelty, patentability or superiority over prior systems. See `EXPERIMENT_RESULTS.md`, the machine-readable result, dataset, and limitations before drawing conclusions.
