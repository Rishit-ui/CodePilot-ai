# Phase 2.7 Count Methodology Review

## Status: REQUIRES_REVIEW

- Official v1.0.8 statement: **138,974 functions**.
- Physical `method_change` rows: **277,948**.
- Phase 2.6 `(file_change_id, signature-or-name)` groups: **198,985**.
- C/C++ groups: `{"one_to_one":6931,"unmatched_after":4830,"unmatched_before":1368}`.

| Classification | Groups | Before rows | After rows |
|---|---|---|---|
| one_to_one | 78963 | 78963 | 78963 |
| unmatched_after | 72386 | 0 | 72386 |
| unmatched_before | 47636 | 47636 | 0 |

The [Zenodo v1.0.8 record](https://zenodo.org/records/13118970) and [official README](https://github.com/secureIT-project/CVEfixes/blob/main/README.md)
state that source before and after changing 138,974 functions is included. The
[data dictionary](https://github.com/secureIT-project/CVEfixes/blob/main/Doc/DataDictionary.md) defines method rows, file relationships,
and `before_change`, but supplies no aggregation query for that published count.
The exact queries used here are preserved in `phase_2_7_count_methodology.json`.

The arithmetic factor of two is an observation, not evidence that every
published function has exactly two stored rows. The observed 78,963 complete
global pairs plus unmatched groups do not reproduce 138,974. Multiple CVEs,
duplicate text, repository mappings, and method versions are reported
separately. The official semantic method remains unresolved and requires author
or methodology-owner clarification.
