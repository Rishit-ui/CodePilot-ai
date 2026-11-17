# SecureScan Phase 2.5 Database Validation

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
  --dump D:\CodePilotData\CVEfixes\extracted\CVEfixes_v1.0.8\Data\CVEfixes_v1.0.8.sql.gz `
  --database D:\CodePilotData\CVEfixes\database\CVEfixes_v1.0.8.converted.db `
  --temp-dir D:\CodePilotData\CVEfixes\temp --min-free-gib 85
```

| Restoration field | Measured value |
|---|---:|
| Python SQLite version | 3.53.1 |
| Independently verified CLI | SQLite 3.54.1, official SHA3-256 `e171f3993a992edf076746926dd52b5e2ebfabaee38818e74987e1d8112ab987` |
| Decompressed SQL bytes | 51,797,823,337 |
| Executed statements | 382,923 |
| Restore elapsed | 790.863 seconds |
| Database bytes | 51,688,558,592 |
| Database size | 48.14 GiB |
| `PRAGMA integrity_check` | `ok` |

## Schema and row counts

| Table | Actual rows |
|---|---:|
| `repository` | 4,249 |
| `cve` | 11,873 |
| `commits` | 12,107 |
| `fixes` | 12,923 |
| `file_change` | 51,342 |
| `method_change` | 277,948 |
| `cwe_classification` | 12,198 |
| `cwe` | 272 |

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
  --database D:\CodePilotData\CVEfixes\database\CVEfixes_v1.0.8.converted.db `
  --output D:\CodePilotData\CVEfixes\reports\phase_2_5_metrics.json `
  --temp-dir D:\CodePilotData\CVEfixes\temp
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
