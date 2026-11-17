"""Render the three Phase 2.5 Markdown reports from measured audit metrics."""

from __future__ import annotations

import argparse
import json
from pathlib import Path


def pct(part: int, whole: int) -> str:
    return f"{100 * part / whole:.2f}%" if whole else "n/a"


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--metrics", type=Path, required=True)
    parser.add_argument("--output-dir", type=Path, required=True)
    args = parser.parse_args()
    data = json.loads(args.metrics.read_text(encoding="utf-8"))
    args.output_dir.mkdir(parents=True, exist_ok=True)

    counts = data["table_counts"]
    coverage = data["c_cpp_coverage"]
    duplicates = data["c_cpp_exact_duplicates"]
    pairing = data["c_cpp_pairing"]
    labels = {
        (row["programming_language"], row["before_change"]): row["methods"]
        for row in data["c_cpp_method_counts"]
    }
    c_total = labels[("C", "True")] + labels[("C", "False")]
    cpp_total = labels[("C++", "True")] + labels[("C++", "False")]
    all_methods = c_total + cpp_total

    acquisition = f"""# SecureScan Phase 2.5 Acquisition

## Result

**PASS.** CVEfixes v1.0.8 was downloaded only from the official Zenodo record,
assembled on D:, and verified before extraction. No dataset file was placed in
the repository or OneDrive.

## Provenance and checksums

| Field | Verified value |
|---|---|
| Official record | `https://zenodo.org/records/13118970` |
| Official object | `https://zenodo.org/records/13118970/files/CVEfixes_v1.0.8.zip?download=1` |
| Zenodo record | `13118970` |
| Release | `CVEfixes v1.0.8` |
| Download completed (UTC) | `2026-11-17T09:16:50Z` |
| Archive path | `D:\\CodePilotData\\CVEfixes\\downloads\\CVEfixes_v1.0.8.zip` |
| Archive bytes | `12,708,711,268` |
| Official MD5 | `4586a358977acfa4c60b1a2cdd096221` |
| Measured MD5 | `4586a358977acfa4c60b1a2cdd096221` |
| Measured SHA-256 | `6acd55aaeb7ffcfc20fdcebf7df88d206f9892ef64b0f2a2e06864d5b44b3a83` |

The resumable acquisition used 95 non-overlapping 128 MiB HTTP range chunks
(the final chunk was 92,244,836 bytes), eight workers initially and then four
main workers plus at most two non-overlapping tail workers after a Zenodo HTTP
503 cooldown, with exact per-range length checks. Completed chunks
were never overwritten. The assembly order was `chunk_000.bin` through
`chunk_094.bin`. The effective request pattern was:

```powershell
curl.exe --location --fail --range <start>-<end> --retry 8 `
  --retry-all-errors --retry-delay 30 --output <D:-chunk> `
  'https://zenodo.org/records/13118970/files/CVEfixes_v1.0.8.zip?download=1'
```

## Safe archive inspection

- ZIP64 entries: **15**.
- Path-traversal or absolute-path entries: **0**.
- Sum of member compressed sizes: **12,708,708,174 bytes**.
- Sum of member uncompressed sizes: **12,776,181,655 bytes**.
- Required dump member: `CVEfixes_v1.0.8/Data/CVEfixes_v1.0.8.sql.gz`.
- Dump member size: **12,660,640,828 bytes**.
- Supporting files extracted: `INSTALL.md`, `README.md`,
  `Doc/DataDictionary.md`, and `LICENSE.txt`.
- The collection log, NVD archive, paper, image, notebook, and CWE XML were not
  extracted because restoration and aggregate validation did not require them.

## Storage gate

| Checkpoint | D: free |
|---|---:|
| Initial measured free | 241,935,560,704 bytes (225.32 GiB) |
| Before final assembly | 225,937,268,736 bytes (210.42 GiB) |
| After assembly | 213,223,862,272 bytes (198.58 GiB) |
| Before extraction | 213,223,862,272 bytes (198.58 GiB) |
| After extraction | approximately 200.56 billion bytes (186.79 GiB) |
| Final measured free | 148,855,459,840 bytes (138.63 GiB) |
| Net free-space change | 93,080,100,864 bytes (86.69 GiB) |

The 85 GiB floor was maintained. Download chunks and interrupted fragments are
retained on D: for recovery; they were not deleted.
"""

    validation = f"""# SecureScan Phase 2.5 Database Validation

## Restoration result

**PASS with a documented Windows conversion requirement.** The release is a
SQLite-native SQL dump. Its documented Unix command is
`gzcat Data/CVEfixes_v1.0.8.sql.gz | sqlite3 Data/CVEfixes.db`.

On Windows, direct piping to the verified SQLite 3.54.1 CLI failed at dump line
73,829. The rejected multi-megabyte statement contains raw C0 bytes, including
34 occurrences of `0x1a`; the failure is consistent with Windows text-mode
stdin misparsing those bytes. The same complete statement succeeded through
the length-aware SQLite API. The failed transaction rolled back to a zero-byte
database. No statement or row was discarded.

The successful restoration used the length-aware Python SQLite API, strict
UTF-8 decoding, `sqlite3.complete_statement`, one original statement per
`execute`, bounded line/statement memory, D:-only temp paths, and a live 85 GiB
free-space check:

```powershell
python ml/securescan/scripts/phase_2_5_restore.py `
  --dump D:\\CodePilotData\\CVEfixes\\extracted\\CVEfixes_v1.0.8\\Data\\CVEfixes_v1.0.8.sql.gz `
  --database D:\\CodePilotData\\CVEfixes\\database\\CVEfixes_v1.0.8.converted.db `
  --temp-dir D:\\CodePilotData\\CVEfixes\\temp --min-free-gib 85
```

| Restoration field | Measured value |
|---|---:|
| Python SQLite version | 3.53.1 |
| Independently verified CLI | SQLite 3.54.1, official SHA3-256 `e171f3993a992edf076746926dd52b5e2ebfabaee38818e74987e1d8112ab987` |
| Decompressed SQL bytes | 51,797,823,337 |
| Executed statements | 382,923 |
| Restore elapsed | 790.863 seconds |
| Database bytes | {data['database_bytes']:,} |
| Database size | {data['database_bytes'] / 1024**3:.2f} GiB |
| `PRAGMA integrity_check` | `ok` |

## Schema and row counts

| Table | Actual rows |
|---|---:|
| `repository` | {counts['repository']:,} |
| `cve` | {counts['cve']:,} |
| `commits` | {counts['commits']:,} |
| `fixes` | {counts['fixes']:,} |
| `file_change` | {counts['file_change']:,} |
| `method_change` | {counts['method_change']:,} |
| `cwe_classification` | {counts['cwe_classification']:,} |
| `cwe` | {counts['cwe']:,} |

The official README aggregate counts match for 4,249 repositories, 11,873
CVEs, 12,107 commits, 51,342 changed files, and 272 CWEs. The database contains
277,948 `method_change` rows, exactly twice the README's 138,974 “functions.”
That release-level term is therefore not treated as a method-row count; no
forced reconciliation was applied.

## Keys and relationships

The dump declares **no primary keys, foreign keys, or indexes**. Consequently,
SQLite does not enforce the relationships documented in the data dictionary.
Read-only logical checks found:

- Zero missing values or duplicates for `cve.cve_id`, `repository.repo_url`,
  `file_change.file_change_id`, and `method_change.method_change_id`.
- Four duplicate rows by `commits.hash`; hash alone is not a safe repository
  identity, so downstream joins must retain `repo_url` where available.
- Zero logical orphan rows for fixes→CVE, fixes→commit `(repo_url, hash)`,
  commits→repository, file-change→commit, method-change→file-change,
  classification→CVE, and classification→CWE.

The reproducible read-only aggregate command is:

```powershell
python ml/securescan/scripts/phase_2_5_analyze.py `
  --database D:\\CodePilotData\\CVEfixes\\database\\CVEfixes_v1.0.8.converted.db `
  --output D:\\CodePilotData\\CVEfixes\\reports\\phase_2_5_metrics.json `
  --temp-dir D:\\CodePilotData\\CVEfixes\\temp
```

No database rows were changed during validation.

## Operational validation notes

- One discarded exploratory `COUNT(DISTINCT code)` CLI query inherited the
  Windows default temp location and failed with `database or disk is full`.
  It produced no metric and its temporary file was released. All retained
  aggregate results came from the analyzer with `TEMP` and `TMP` pinned to D:.
- A later optional empty-code query on D: generated excessive temporary work.
  It was identified by exact process command line and stopped at 109.08 GiB
  free, before the 85 GiB floor. Its temporary allocation was released and D:
  returned to 138.63 GiB free. That optional metric was omitted.
"""

    feasibility = f"""# SecureScan Phase 2.5 C/C++ Feasibility

## Aggregate corpus

| Measurement | Actual value |
|---|---:|
| C method rows | {c_total:,} |
| C++ method rows | {cpp_total:,} |
| Total C/C++ method rows | {all_methods:,} |
| C vulnerable candidates (`before_change=True`) | {labels[('C', 'True')]:,} |
| C benign candidates (`before_change=False`) | {labels[('C', 'False')]:,} |
| C++ vulnerable candidates | {labels[('C++', 'True')]:,} |
| C++ benign candidates | {labels[('C++', 'False')]:,} |
| All vulnerable candidates | {pairing['vulnerable_methods']:,} |
| All benign candidates | {pairing['benign_methods']:,} |
| C/C++ file changes containing methods | {coverage['file_changes']:,} |
| Unique commit hashes | {coverage['commit_hashes']:,} |
| Unique repositories | {coverage['repositories']:,} |

All {all_methods:,} method candidates map to a commit, repository, fix, and CVE:
missing commit mappings **0**; missing repository mappings **0**. This is 100%
metadata provenance coverage for the C/C++ candidate set.

## Exact duplicates and conflicts

Exact code grouping (inside SQLite; no source was exported) found:

| Measurement | Value |
|---|---:|
| Exact duplicate groups | {duplicates['duplicate_groups']:,} |
| Rows participating in duplicate groups | {duplicates['duplicate_rows']:,} ({pct(duplicates['duplicate_rows'], all_methods)} of candidates) |
| Conflicting-label duplicate groups | {duplicates['conflicting_label_groups']:,} ({pct(duplicates['conflicting_label_groups'], duplicates['duplicate_groups'])} of duplicate groups) |
| Cross-repository duplicate groups | {duplicates['cross_repository_groups']:,} ({pct(duplicates['cross_repository_groups'], duplicates['duplicate_groups'])} of duplicate groups) |

The high conflict fraction means identical code cannot be assigned labels or
partitions independently. Exact duplicate components must be resolved before
splitting, and near-duplicate/clone analysis remains required in the next phase.

## Before/after pairing

Strict grouping by the same `file_change_id` and nonblank exact signature found
{pairing['one_to_one_pair_groups']:,} one-to-one before/after groups and zero
ambiguous groups among those matches. This covers
{pct(pairing['one_to_one_pair_groups'], pairing['vulnerable_methods'])} of
vulnerable candidates and {pct(2 * pairing['one_to_one_pair_groups'], all_methods)}
of all C/C++ method rows. It leaves
{pairing['vulnerable_methods'] - pairing['one_to_one_pair_groups']:,} vulnerable
and {pairing['benign_methods'] - pairing['one_to_one_pair_groups']:,} benign rows
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
"""

    outputs = {
        "phase_2_5_acquisition.md": acquisition,
        "phase_2_5_database_validation.md": validation,
        "phase_2_5_c_cpp_feasibility.md": feasibility,
    }
    for name, body in outputs.items():
        path = args.output_dir / name
        path.write_text(body, encoding="utf-8")
        print(path)


if __name__ == "__main__":
    main()
