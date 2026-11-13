# Phase 2 Recovery Report

Date: 2026-11-13

Status: `PASS` in the temporary PostgreSQL 17 environment.

## Migration behavior

Schema setup and version insertion execute in one PostgreSQL transaction. Versions are inserted idempotently. A failed transaction was rolled back and did not retain the test migration version. SQLite upgrade testing started from a legacy `projects` table without `owner_id`; startup added the column, preserved the project, recorded versions 1-4, and a second startup made no duplicate versions.

## Backup and restoration performed

1. `pg_dump -Fc` created `/tmp/codepilot_phase2_v4.dump` inside the temporary database container.
2. A separate database, `codepilot_restore_phase2_v4`, was created.
3. `pg_restore` completed with exit 0.
4. Source and restored counts matched exactly: users 10, projects 5, owned projects 5, revisions 4, edges 4, audit events 32, migrations 4, execution jobs 0, operational events 0.

## Production runbook

1. Stop writes or place the API in maintenance mode.
2. Record application revision and current `schema_migrations` rows.
3. Create and verify a provider snapshot plus `pg_dump -Fc "$DATABASE_URL" -f codepilot-YYYYMMDD.dump`.
4. Restore into a new staging database with `createdb` and `pg_restore`; do not overwrite production during verification.
5. Start the exact application image against the restored database and check `/api/ready`, ownership, revision, graph, patch, test, and audit records.
6. Apply migrations in staging, then production under an approved change window.
7. On migration failure, startup rolls back. Keep the previous image and database snapshot available; restore to a new database and switch the connection only after validation.

Provider snapshots, point-in-time recovery, cross-region restore, and production-scale recovery time are `NOT TESTED`.
