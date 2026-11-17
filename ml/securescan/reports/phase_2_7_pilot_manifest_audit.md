# Phase 2.7 Pilot Manifest Audit

## Status: PASS for automated integrity; BLOCKED for provenance/legal freeze

The manifest remains a **proposed_candidate_cohort**, not an approved training dataset.

| Split | Rows | Groups | Labels | Languages | Group-size distribution |
|---|---|---|---|---|---|
| train | 1557 | 155 | {"fixed_post_fix":912,"vulnerable_pre_fix":645} | {"C":990,"C++":567} | {"max":71,"median":4,"min":1,"p90":25} |
| validation | 334 | 32 | {"fixed_post_fix":241,"vulnerable_pre_fix":93} | {"C":167,"C++":167} | {"max":67,"median":4.5,"min":1,"p90":28} |
| test | 334 | 30 | {"fixed_post_fix":196,"vulnerable_pre_fix":138} | {"C":224,"C++":110} | {"max":109,"median":4.5,"min":1,"p90":21} |

- Rows: **2,225**; repositories: **219**;
  commits: **411**; connected groups: **217**.
- Repository/commit provenance complete: `True`.
- Supported labels/languages complete: `True`.
- Quarantined conflicting rows included: **0**.
- Components crossing splits: **0**.
- Seed-42 assignment reproduced: `True`.
- Manifest SHA-256: `7caac791241dc6e01525e31cd8c8b314831adf07fb7114951007bb65e9a0ed86`.
- Exact-revision licence evidence: **1,299** rows; other revision: **926** rows.

No labels or cohort membership were changed.
