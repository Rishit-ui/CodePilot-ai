# SecureScan Phase 2.6 Duplicate Audit

## Status: PASS for inventory and quarantine; REQUIRES_REVIEW for resolution

- Exact duplicate groups: **553**.
- Rows in exact duplicate groups: **1,248**.
- Conflicting-label groups: **381**.
- Cross-repository exact groups: **73**.
- Conflict groups automatically majority-voted: **0**.
- A–F classification counts: `{"A_identical_code_identical_label": 172, "B_conflicting_labels": 381, "C_cross_repository": 73, "D_same_repository_repeat": 480, "E_same_logical_method_before_after": 8, "F_ambiguous_or_unresolved": 381}`.
- Near-duplicate edge counts: `{"canonical_type2": 1470, "normalized_exact": 180, "verified_near_clone": 4460}`.

Every conflicting member is retained in
`phase_2_6_conflicting_duplicates.csv/json` with method, repository, commit,
CVE and raw/normalized/canonical hashes. Conflicting and repository-ambiguous
groups are quarantined. Exact, whitespace-normalized, canonical type-2 and
verified near-clone evidence remain separate edge types. Manual review is still
required to distinguish context-dependent semantics, genuine label noise,
repository aliases and vulnerable/fixed state reuse.
