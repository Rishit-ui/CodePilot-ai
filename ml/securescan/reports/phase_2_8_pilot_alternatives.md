# Phase 2.8 Pilot Alternatives

## Status: REVIEW CANDIDATES ONLY

| Alternative | Rows | Repos | Groups | Commits | Labels | Languages | Exact licence | Fresh split |
|---|---|---|---|---|---|---|---|---|
| A_phase27_proposed_cohort | 2225 | 219 | 217 | 411 | {"fixed_post_fix":1349,"vulnerable_pre_fix":876} | {"C":1381,"C++":844} | 0.58382 | False |
| B_exact_revision_review_subset | 1299 | 219 | 217 | 219 | {"fixed_post_fix":804,"vulnerable_pre_fix":495} | {"C":736,"C++":563} | 1.0 | True |
| C_whole_component_identity_restricted_subset | 897 | 135 | 135 | 135 | {"fixed_post_fix":549,"vulnerable_pre_fix":348} | {"C":488,"C++":409} | 1.0 | True |

Alternative B is the required 1,299-row exact-revision view but contains partial
original components, so it needs fresh grouping/splitting before any experiment.
Alternative C keeps only complete exact-revision components not touching current
identity/clone uncertainty evidence. It is deliberately conservative and may be
biased or too small. Neither alternative is legally cleared or training-ready.
