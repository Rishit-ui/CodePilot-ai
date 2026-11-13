# Phase 2 Database Report

Date: 2026-11-13

Status: `PASS` for live PostgreSQL integration and persistence verification.

## Implementation

- `src/db.js` selects PostgreSQL when `DATABASE_URL` is present and otherwise retains SQLite for local development.
- PostgreSQL uses `pg.Pool`, configurable pool size, acquisition timeout, query/statement timeout, parameterized values, and provider-selectable TLS (`disable`, `prefer`, `require`, `verify-full`). Production defaults to certificate verification.
- Startup schema initialization is transactional. Failure rolls back and prevents readiness.
- `schema_migrations` tracks four idempotent versions: baseline, ownership/rate limits, operational monitoring, and durable execution queue.
- Foreign keys, ownership fields, rate-limit indexes, operational-event indexes, and execution-job indexes are present in both dialects.
- Production configuration requires durable PostgreSQL when distributed limiting is enabled; Vercel does not use SQLite for durable records.

## Live verification

An actual `postgres:17-alpine` container was started on 2026-11-13. `tests/postgres.integration.test.js` passed against it and exercised user creation, session login lookup, workspace/project create-update-list-delete, revision/import metadata, files, dependency edges, plans, patches, test history, audit history, tenant separation, concurrent rate-limit updates, foreign-key rejection, transaction rollback, close/reopen persistence, and migration versions 1-4.

Command: `TEST_POSTGRES_URL=postgres://... node --test tests/postgres.integration.test.js`

Result: `1 passed, 0 failed`, exit 0. The connection credential was local and temporary and is not committed.

## Restart and integrity evidence

The pool was closed and a new `Store` instance opened against the same database. Project owner, one file, one edge, one patch, one test run, and project audit history remained available. A deliberately failing migration transaction inserted version 999 and then queried a missing table; rollback left version 999 absent. A revision referencing a missing project was rejected by PostgreSQL.

## Limits

No production provider was contacted. Provider-specific CA bundles, regional latency, connection proxies, failover, and capacity remain `NOT TESTED`. Test those against the selected managed PostgreSQL provider in staging.
