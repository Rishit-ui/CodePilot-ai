# SecureScan Phase 2.5 C/C++ Feasibility

## Aggregate corpus

| Measurement | Actual value |
|---|---:|
| C method rows | 14,651 |
| C++ method rows | 5,409 |
| Total C/C++ method rows | 20,060 |
| C vulnerable candidates (`before_change=True`) | 6,241 |
| C benign candidates (`before_change=False`) | 8,410 |
| C++ vulnerable candidates | 2,058 |
| C++ benign candidates | 3,351 |
| All vulnerable candidates | 8,299 |
| All benign candidates | 11,761 |
| C/C++ file changes containing methods | 6,383 |
| Unique commit hashes | 4,212 |
| Unique repositories | 763 |

All 20,060 method candidates map to a commit, repository, fix, and CVE:
missing commit mappings **0**; missing repository mappings **0**. This is 100%
metadata provenance coverage for the C/C++ candidate set.

## Exact duplicates and conflicts

Exact code grouping (inside SQLite; no source was exported) found:

| Measurement | Value |
|---|---:|
| Exact duplicate groups | 553 |
| Rows participating in duplicate groups | 1,248 (6.22% of candidates) |
| Conflicting-label duplicate groups | 381 (68.90% of duplicate groups) |
| Cross-repository duplicate groups | 73 (13.20% of duplicate groups) |

The high conflict fraction means identical code cannot be assigned labels or
partitions independently. Exact duplicate components must be resolved before
splitting, and near-duplicate/clone analysis remains required in the next phase.

## Before/after pairing

Strict grouping by the same `file_change_id` and nonblank exact signature found
6,931 one-to-one before/after groups and zero
ambiguous groups among those matches. This covers
83.52% of
vulnerable candidates and 69.10%
of all C/C++ method rows. It leaves
1,368 vulnerable
and 4,830 benign rows
outside a strict one-to-one pair. These unmatched rows must not be paired
automatically; renames, overloads, additions, deletions, and parser failures
still require the predeclared validation procedure.

## Feasibility decision

**Conditionally suitable for the planned project-separated pilot.** The corpus
has 763 C/C++ repositories, 4,212 fixing commit hashes, complete measured
project/commit/CVE provenance, and 8,299 vulnerable candidates. It is not yet
ready for model training because:

1. conflicting exact duplicates must be excluded or adjudicated;
2. cross-project exact and near-duplicate components must remain in one split;
3. repository aliases/forks still require normalization;
4. unmatched before/after rows require manual pair validation;
5. upstream per-project licensing remains an unresolved redistribution gate.

Recommended next step: retain this database immutably, create provenance and
exclusion manifests, perform clone-connected project grouping, then run the
predeclared manual label/pair audit before requesting any split creation or
training. No source corpus was exported, no split was created, and no model was
trained in Phase 2.5.
