# Queue Provider Report

Status: `PASS` for local durability/idempotency logic; `BLOCKED` for real Vercel delivery.

The PostgreSQL/SQLite execution row remains authoritative. Queue messages contain only schema version, job ID and outbox ID. The transactional outbox prevents a job from being published before its database transaction commits. The consumer revalidates the published outbox row, atomically claims the job lease, and treats terminal/redelivered jobs idempotently.

Phase 5 adds an explicit 90-second provider visibility lease, bounded retry delay, and poison-envelope acknowledgement. Invalid schema or an envelope with no published database outbox row is non-retryable; transient failures back off to a 32-second ceiling. Application attempts, cancellation, lease recovery and terminal poison state remain durable in the database.

Tests cover duplicate publication, duplicate delivery, cancellation, bounded attempts, lease recovery, poison policy and retry bounds. The conditional real publication test was skipped because `TEST_VERCEL_QUEUE`, an authorized topic and provider credentials were absent. It tests publication only; actual callback delivery, callback authentication, provider lease renewal, region behavior and end-to-end reconciliation remain `BLOCKED`.

No ZIP, source tree or secret is placed in a queue message. No queue was provisioned.
