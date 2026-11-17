# SecureScan Phase 2.6 Leakage Analysis

## Status: PASS for the proposed manifest

- Connected components: **717**.
- Largest component: **4,399 rows**.
- Split rows: `{"test": 334, "train": 1557, "validation": 334}`.
- Actual ratios: `{"test": 0.150112, "train": 0.699775, "validation": 0.150112}`.
- Seed: `42`.

Components connect repository identity, repository relationships, exact and
normalized duplicates, canonical/verified near clones, before/after pairs,
common commits and CVEs. The manifest assigns whole components only. Automated
validation query results: `{"clone_edges_crossing_splits": 0, "commits_crossing_splits": 0, "components_crossing_splits": 0, "fingerprints_crossing_splits": 0, "pair_keys_crossing_splits": 0, "repositories_crossing_splits": 0}`.
Every value is zero, so no component, repository, commit, pair key, fingerprint,
or verified clone edge crosses partitions. Ratios are reported as achieved;
components are never broken to improve them.
