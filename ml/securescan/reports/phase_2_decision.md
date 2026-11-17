# SecureScan Phase 2 Decision

## Decision: Proceed with CVEfixes—conditionally and as a bounded pilot

Selected option: **1. Proceed with CVEfixes.**

This is a dataset-research decision, not authorization to download, train, integrate or deploy. The current machine fails the storage gate, so work stops at feasibility and experiment design.

## Why CVEfixes is preferred

- It provides relational repository, commit, CVE, CWE, file and method provenance.
- Its official README explicitly licenses the dataset compilation under CC BY 4.0 and collection software under MIT.
- It stores both file snapshots and changed-method representations, enabling auditable pair reconstruction and a new unchanged-function extraction procedure.
- Canonical `repo_url` supports genuine project-held-out splits.
- Its official aggregate scale—4,249 projects and 138,974 functions—is potentially adequate, subject to C/C++ and quality gates.

## Why DiverseVul is not selected as the primary corpus

- The author-hosted release disagrees with the paper’s total/benign row, project and commit counts.
- 484 of 7,653 dataset project/commit keys lack exact metadata mappings; 21,796 rows have no exact repository-URL mapping.
- The JSON loses C versus C++ identity, filename, patched-versus-unchanged negative origin and before/after pairing.
- Whitespace-normalized duplicates include 459 conflicting-label groups.
- The paper reports only 60% vulnerable-label accuracy in its manual sample.
- The repository publishes no explicit dataset license, and upstream project licenses are not included.

DiverseVul may later serve as a locally held, separately reported sensitivity corpus after license clarification and provenance cleanup. It must not be silently merged into CVEfixes; the corpora can share projects/code and use related fix-commit labeling, so independence and contamination must be measured first.

## Current blockers

| Gate | Status | Evidence |
|---|---|---|
| CVEfixes official provenance/schema | PASS | Official source and data dictionary inspected. |
| CVEfixes compilation license | PASS | CC BY 4.0 stated by official README. |
| Upstream source licenses | BLOCKED | Not supplied as a dataset field; bounded per-project audit required. |
| Storage for v1.0.8 | FAIL | 9.96 GB free after research downloads; >=85 GB recommended. |
| C/C++ counts and project counts | NOT VERIFIED | Full database correctly not downloaded. |
| Label distribution/duplicate rates | NOT VERIFIED | Requires incremental database audit. |
| Pair reliability | NOT VERIFIED | Schema supports candidates but has no explicit pair key. |
| Natural benign extraction | DESIGN COMPLETE, NOT EXECUTED | Requires file parsing and a bounded repository pilot. |
| Model training | NOT STARTED | Prohibited in Phase 2. |

## Required next authorized step

Provision a separate research volume with at least 85 GB free—preferably 100 GB—then run a no-training CVEfixes pilot:

1. Download and verify the official v1.0.8 archive.
2. Restore SQLite by streaming and measure actual database/temp sizes.
3. Run aggregate C/C++/project/CVE/commit/label/null counts.
4. Audit exact/clone/conflicting labels incrementally.
5. Validate at least 100 labels and a stratified sample of reconstructed pairs.
6. Extract unchanged negatives for a small, preselected repository subset only.
7. Produce the immutable provenance, exclusion and split manifests.
8. Re-evaluate the predeclared dataset gate before any training request.

If CVEfixes fails label relevance, pair precision, C/C++ scale or upstream-license gates, choose option 4 at that time and investigate alternatives. Do not substitute an unofficial mirror.
