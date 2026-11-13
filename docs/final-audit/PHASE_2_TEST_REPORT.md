# Phase 2 Test Report

Date: 2026-11-13

## Baseline

Before Phase 2 edits, `npm run check` passed and `npm test` reported 53 passed, 0 failed, 0 skipped.

## Added coverage

- `tests/rate_limit.test.js`: shared concurrency, proxy trust, fail-closed storage, login escalation, credential-safe audit data.
- `tests/postgres.integration.test.js`: actual PostgreSQL lifecycle, migrations, persistence, constraints, concurrency, tenant isolation.
- `tests/migrations.test.js`: existing SQLite schema upgrade, data retention, repeat invocation.
- `tests/queue.test.js`: retry bounds, terminal failure, and owner cancellation.
- Existing serverless security tests now assert truthful `BLOCKED` execution.

## Executed evidence

| Command/check | Result |
| --- | --- |
| Phase 2 baseline `npm run check` | `PASS`, exit 0 |
| Phase 2 baseline `npm test` | 53 pass, 0 fail |
| Final `npm run check` | `PASS`, exit 0 |
| Final `npm test` | 59 pass, 0 fail, 1 skipped; exit 0 (60 discovered) |
| Live PostgreSQL test | 1 pass, 0 fail, exit 0 |
| PostgreSQL dump/restore | `PASS`; source/restored counts matched |
| Docker image build | `PASS`, exit 0 |
| Docker health/readiness | `PASS`; healthy, non-root, PostgreSQL ready |
| Cloud deployment | `NOT TESTED` (prohibited) |
| Worker isolation attack suite | `NOT TESTED` (no secure worker; feature disabled) |

The conditional PostgreSQL test is the single default-suite skip when `TEST_POSTGRES_URL` is absent. It was then run separately against the actual service and passed. Thus every discovered test had a passing execution in its applicable environment; no skipped test is presented as a pass in the default run.
