# Phase 3 Initial Audit

Date: 2026-11-13

Baseline branch and commit: `main` at `f1d49fb8f309dcff931339254e1c541714e2e63d`.

The working tree was clean at Phase 3 start. `commits.txt` (1,946 bytes) and `impact-bundle.txt` (153,012 bytes) existed and were preserved.

## Measured baseline

| Check | Actual result |
| --- | --- |
| `npm run check` | `PASS`, exit 0 |
| `npm test` | 60 discovered; 59 pass; 0 fail; 1 conditional PostgreSQL skip |
| Authentication/ownership | Central API authentication, project authorization and nested-resource binding present |
| PostgreSQL | `pg.Pool`, TLS modes, timeouts, migrations 1-4 and parameterized query adapter present |
| Distributed limiter | PostgreSQL/SQLite atomic buckets, subject/IP policy and fail-closed production behavior present |
| Execution | Production default `disabled`; local trusted subprocess path still present only outside production |
| Queue | Durable execution row existed, but no provider publication, outbox or consumer |
| Object storage | No private direct-upload provider or owned artifact model |
| Docker | Phase 2 non-root production image configuration present |

Previous reports were used only as navigation. This audit re-ran the repository checks and inspected the current implementation.
