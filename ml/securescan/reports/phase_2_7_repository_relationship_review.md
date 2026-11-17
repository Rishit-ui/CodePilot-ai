# Phase 2.7 Repository Relationship Review

## Status: REQUIRES_REVIEW — leakage safety is provisional

- Repository edges: `{"canonical_url_alias":4,"cross_repo_exact_code":33}`.
- Method-level clone edges: `{"canonical_type2":1470,"normalized_exact":180,"verified_near_clone":4460}`.

Canonical URL normalization evidence is deterministic but is not a substitute
for provider-authoritative fork, rename, archive, mirror, redirect, or full Git
history metadata. Cross-repository exact-code and method clone edges are
similarity evidence, not authoritative identity proof. No claim is made that all
relationships have been discovered. Any new relationship must trigger component
reconstruction and a fresh split audit.
