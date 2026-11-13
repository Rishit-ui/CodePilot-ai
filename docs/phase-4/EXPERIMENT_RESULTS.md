# Impact Engine Experiment Results

Run timestamp: `2026-11-13T18:48:40.710Z` (machine-readable UTC). Environment: Node.js v24.21.0, Windows x64, 16 logical CPUs.

## Aggregate selection results

| Strategy | Selected test instances | True positives | False positives | Missed dependencies |
| --- | ---: | ---: | ---: | ---: |
| Full suite | 36 | 14 | 22 | 0 |
| Changed file | 6 | 6 | 0 | 8 |
| Stored coverage | 6 | 6 | 0 | 8 |
| Evidence-aware | 14 | 14 | 0 | 0 |

The direct, API-contract, deletion and rename fixtures were handled by all selective strategies. Changed-file and stored-coverage strategies missed transitive, cross-module, configuration, conflicting and stale dependency cases. Evidence-aware selection conservatively selected all four tests for the configuration change.

## Graph performance

| Source files | Graph nodes / edges | Full rebuild average | Incremental average | Incremental/full ratio | Equivalent |
| ---: | ---: | ---: | ---: | ---: | --- |
| 50 | 121 / 189 | 11.140 ms | 1.789 ms | 0.161 | yes |
| 200 | 421 / 639 | 20.057 ms | 3.585 ms | 0.179 | yes |
| 1,000 | 2,021 / 3,039 | 64.118 ms | 15.243 ms | 0.238 | yes |

Observed heap deltas were approximately 1.23 MB, 9.57 MB and 27.67 MB. They are coarse process observations and not leak measurements.

## Limitations

- Synthetic JavaScript/CommonJS only; no independent public corpus.
- Expected regressions are declared from fixture topology rather than observed production failures.
- Only one workstation and runtime were measured.
- Timing samples are small and include JIT/garbage-collection noise.
- No claim of novelty, patentability or freedom to operate is made.
- A professional prior-art search and independent real-repository comparison are still required.
