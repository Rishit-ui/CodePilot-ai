# Impact Engine Technical Evidence Record

This record is intentionally separate from product readiness. It preserves materials for a later discussion with a qualified patent agent; it does not characterize the implementation as novel or patentable.

- Algorithm source: `src/impact/*.js`, `src/parsing/source.js`.
- Controlled dataset: `benchmarks/impact-engine/dataset.json`.
- Reproducible runner: `scripts/phase4/impact-benchmark.js`.
- Raw results: `results/impact-engine/phase4_benchmark_results.json`.
- Protocol and limitations: `docs/phase-4/EXPERIMENT_PROTOCOL.md` and `EXPERIMENT_RESULTS.md`.
- Existing comparison notes: `docs/impact-engine/PRIOR_ART_MATRIX.md`; these are not a professional search.

The potentially relevant technical combination is a revision-scoped typed dependency graph, explicit provenance/status reconciliation, uncertainty-conservative impact traversal and test selection, plus incremental invalidation checked against full rebuilds. Each component has known related work. Evidence presently available is synthetic and insufficient to establish a specific differentiating contribution over prior art.
