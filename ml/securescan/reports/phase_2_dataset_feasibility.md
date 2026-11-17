# SecureScan Phase 2 Dataset Feasibility

## Scope and protected baseline

This phase performed research and feasibility checks only. It did not train a model, change an API/frontend/Docker configuration, deploy, commit, or push.

- Branch: `feature/securescan-ml`
- Starting local HEAD: `05e70e5fc824f87a14c48bad5b4aef17333076f7`
- Starting working tree: clean
- Phase 1 and Phase 1.5 reports and serialized artifacts were not modified.

Phase 1.5 was already committed locally before this investigation began. This phase does not claim authorship of that commit.

## CVEfixes v1.0.8

### Official identity and published scope

- Dataset: [Zenodo record 13118970](https://zenodo.org/records/13118970), published 28 July 2024.
- Release: `v1.0.8`.
- Collection source: [secureIT-project/CVEfixes](https://github.com/secureIT-project/CVEfixes), pinned during this audit to `9283b50b3f04e3c5b0a17fc419ab0feea23fc438`.
- Official aggregate counts: 4,249 projects, 11,873 CVEs, 12,107 fixing commits, 51,342 changed files, 138,974 functions and 272 CWE types.
- Coverage date: CVEs published through 23 July 2024.

These are release-level counts from the authors, not independently recomputed counts.

### Schema and provenance

The official `Doc/DataDictionary.md` documents the relational chain needed for provenance:

`repository.repo_url` → `commits.(repo_url, hash)` → `fixes.(repo_url, hash, cve_id)` → `file_change.(hash, file_change_id)` → `method_change.file_change_id`

Relevant semantics:

- `file_change.programming_language` identifies the detected file language.
- `file_change.code_before` is documented as the vulnerable pre-fix file; `code_after` is the post-fix file.
- `method_change.code` contains a function/method body.
- `method_change.before_change` is documented as “Vulnerable or not (True/False).” The collection code writes string `True` for pre-change methods and `False` for post-change methods.
- `fixes` connects each repository/commit to CVEs; `cwe_classification` connects CVEs to CWEs.

The schema supports project-held-out grouping and commit/CVE tracing. It does not contain an explicit before/after pair identifier. Candidate pairs must be reconstructed within a `file_change_id` using validated signatures/names and diff evidence; additions, deletions, overloads and renames must remain unpaired unless resolved unambiguously.

### Storage and hardware gate

Measured on this workstation before any CVEfixes payload download:

- Free disk: 10,719,510,528 bytes (10.72 GB decimal).
- Physical RAM: 16,989,736,960 bytes (16.99 GB); approximately 3.73 GB free at the initial check.
- CPU logical cores: 16.

The Zenodo object is exactly 12,708,711,268 bytes, already larger than available free disk. HTTP range inspection of the remote ZIP central directory—without downloading the payload—found 15 entries. Extraction would produce a 12,660,640,828-byte `CVEfixes_v1.0.8.sql.gz` nested dump plus other files. Restoring that gzip stream creates a substantially larger SQLite database.

Engineering storage plan:

| Item | Planning allowance |
|---|---:|
| Outer ZIP | 12.71 GB |
| Extracted nested SQL gzip and support files | 12.78 GB |
| Estimated SQLite database | 45–65 GB |
| Indexes, query scratch, derived manifests and safety margin | 15–25 GB |
| Recommended free space before acquisition | **at least 85 GB** |

The 45–65 GB database range is a planning estimate, not a measured v1.0.8 database size. A future download must measure the restored database before analysis. With only 10.72 GB free, downloading was prohibited by the phase stopping rule.

SQLite can be queried incrementally using `COUNT`, grouped aggregates, indexed joins and cursor batches. The whole database must never be loaded into Pandas. RAM is adequate for incremental SQL and bounded batches, but not for materializing all code or clone features at once.

### Required questions and present evidence

| Question | Finding |
|---|---|
| Number of C functions | **Not verified**; requires the database. |
| Number of C++ functions | **Not verified**; requires the database. |
| Unique C/C++ projects | **Not verified**; global official count is 4,249. |
| Unique CVEs/fixing commits | Official global counts are 11,873 / 12,107; C/C++ counts not verified. |
| Vulnerable/non-vulnerable samples | **Not verified**. `before_change` semantics are documented, but actual values/examples were not queried. |
| Duplicate/conflicting-label rates | **Not verified**. |
| Reliable before/after pairs | Schema permits candidate reconstruction, but no explicit pair key exists; actual match precision not verified. |
| Unmodified benign functions | Not directly enumerated in `method_change`. Full before/after file snapshots could support extraction, but this requires a new provenance-preserving procedure. |
| Project-held-out splits | Feasible in principle using canonical `repo_url`, subject to alias/fork normalization and clone grouping. |
| Large enough for training | Aggregate scale is promising, but C/C++ usable counts and label quality must pass the pre-training gate. |

No C/C++ count, duplicate rate or label ratio is inferred from the global totals.

## DiverseVul

### Official identity

- Authors’ repository: [wagner-group/diversevul](https://github.com/wagner-group/diversevul), pinned to `50a2c18b810252a79c892d8b5d96cd61a656b2da`.
- Dataset and metadata were downloaded only from the two author-linked Google Drive objects.
- Dataset file: 736,915,162 bytes; SHA-256 `7937c26003c4c24a396747432487e8abdd1c4622b5547ae93855bee15266bd57`.
- Metadata file: 2,200,902 bytes; SHA-256 `974397b28f3f530e85faca31b27455a8bae0e1a114a6053368a4708d1c9c3454`.

The audit streamed JSONL records and did not load the entire dataset into Pandas.

### Measured release contents

| Measurement | Verified value |
|---|---:|
| Total rows | 330,492 |
| `target=1` vulnerable | 18,945 |
| `target=0` benign | 311,547 |
| Project-name values | 800 |
| Unique `(project, commit_id)` keys | 7,653 |
| Nonblank CWE values | 150 |
| Empty functions | 1 |
| Metadata rows | 7,511 |
| Metadata project names | 795 |
| Distinct metadata repository URLs | 1,179 |
| Dataset commits mapped by exact project+commit | 7,169 |
| Dataset commits without exact metadata mapping | 484 |
| Dataset rows with exact metadata mapping | 308,696 (93.40%) |
| Dataset rows without exact metadata mapping | 21,796 (6.60%) |

The paper reports 18,945 vulnerable plus 330,492 non-vulnerable functions, but the current official author-hosted JSON contains 330,492 total rows and only 311,547 benign rows. The paper reports 797 projects and 7,514 commits; the release has 800 project-name values and 7,653 project/commit keys. These discrepancies must be resolved with the authors or documented as release drift before training.

The release is described as C/C++, but individual rows contain neither language nor filename. Exact C versus C++ counts cannot be recovered from the release.

### Labels, benign sampling and pairs

The paper defines `target=1` as the pre-fix changed function and `target=0` as either the post-fix function or an unchanged function in a related file. It also reports only 60% vulnerable-label accuracy in a 50-function manual sample. The JSON does not mark which benign-generation path produced each target-zero row and does not provide a before/after pair key. Reliable pair evaluation cannot be reconstructed from this release alone.

Natural unchanged negatives exist by collection design, which is better than a patched-only negative set, but their identity and proportions are lost in the published JSON.

### Duplicate audit

- Raw function text: zero exact duplicate groups, consistent with the paper’s raw-MD5 deduplication.
- Whitespace-normalized exact hashes: 898 groups, 1,797 rows, 899 extra rows.
- Normalized groups with both labels: 459.
- Normalized groups spanning project-name values: 28.
- Identifier/literal-canonicalized structural candidates: 24,023 groups / 73,350 rows, including 2,790 conflicting-label groups and 3,676 cross-project groups.

Canonical groups are heuristic type-2 clone candidates, not proven semantic duplicates. They demonstrate that raw-MD5 deduplication is insufficient for project-held-out experiments and that clone components must be resolved before splitting.

### Project split feasibility

A project-held-out split is feasible only for rows with a validated canonical repository URL. Project names are not safe grouping keys: 795 metadata project labels map to 1,179 URLs, and 484 dataset commit keys lack an exact metadata mapping. Required preparation:

1. Normalize repository URLs and resolve moves/forks/aliases.
2. Exclude unresolved commit mappings from the benchmark.
3. Construct cross-project clone components before splitting.
4. Keep every repository and connected clone component in one partition.

## Supplementary validation corpus

[NIST Juliet C/C++ 1.3](https://samate.nist.gov/SARD/test-suites/112) provides 64,099 synthetic test cases across 118 CWEs, a 146 MB download and a published SHA-256. It is U.S. public-domain/CC0 material. It is suitable for deterministic CWE coverage and pipeline sanity tests, but not for training, natural-prevalence estimates, or claims of real-world project generalization.

## Feasibility conclusion

CVEfixes has the strongest provenance and clearest dataset license, but this workstation cannot safely acquire it. DiverseVul is locally auditable and large enough for research, but its release inconsistencies, missing provenance, unresolved dataset license and acknowledged label noise make it unsuitable as the sole authoritative training corpus. The preferred next step is a storage-provisioned, bounded CVEfixes pilot—not model training.
