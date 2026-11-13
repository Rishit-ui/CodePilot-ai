# Impact Engine Experiment Protocol

Dataset: `benchmarks/impact-engine/dataset.json`. Runner: `scripts/phase4/impact-benchmark.js`. Machine result: `results/impact-engine/phase4_benchmark_results.json`.

The dataset declares expected affected tests independently of selector output for direct, transitive, cross-module, configuration, API-contract, conflicting-evidence, stale-evidence, deleted-file and renamed-file scenarios. Four strategies run over the same graph: all tests, direct changed-file, stored coverage relationships and evidence-aware transitive selection.

For each strategy/scenario, the runner records selected tests, true/false positives, true/false negatives, accuracy, precision, recall, false-positive rate and missed dependency count. Performance fixtures contain 50, 200 and 1,000 chained source files plus ten test files. Three measured rebuilds and incremental updates are performed per size, followed by graph-equivalence comparison and coarse heap-delta measurement.

Reproduction:

```text
npm ci
npm run benchmark:impact
```

Controls: no cloud calls, no untrusted execution, fixed fixture topology, identical strategy input graph, raw JSON retained. Timing varies with warm-up and machine load. Synthetic declared ground truth is not production telemetry and is not a substitute for mutation testing on independent real repositories.
