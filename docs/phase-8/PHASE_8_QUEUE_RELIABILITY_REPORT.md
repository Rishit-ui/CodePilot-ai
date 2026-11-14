# Phase 8 Queue Reliability Report

Date: 2026-11-15

## Outcome

The local durable state machine passes the new adversarial suite. Real Vercel Queue delivery and managed PostgreSQL behavior remain BLOCKED pending authorized provider resources.

## Verified behavior

| Requirement | Evidence | Status |
|---|---|---|
| Atomic leasing | Concurrent consumers produce one execution and one duplicate result | PASS locally |
| Idempotent delivery | Unique actor/idempotency key and atomic claim | PASS locally |
| Duplicate delivery | Terminal/running redelivery records an operational event without re-execution | PASS locally |
| Lease recovery | Expired non-exhausted lease returns to `QUEUED` | PASS locally |
| Worker crash at retry limit | Expired final lease becomes poisoned `FAILED` | PASS locally |
| Retry backoff | Bounded exponential job, publication, and callback retry policies | PASS locally |
| Poison handling | Invalid/non-retryable work is durably `BLOCKED`; exhausted work is poisoned | PASS locally |
| Queued cancellation | Becomes `CANCELLED` without execution | PASS locally |
| Running cancellation | Owner-only; resolves after worker failure or lease loss | PASS locally |
| Transactional outbox | Job and outbox insert share one transaction | PASS locally |
| Interrupted publishing | Remains pending and retries with the same provider idempotency key | PASS locally |
| Early callback | A `PENDING` outbox is retryable and is not acknowledged as completed | PASS locally |
| Restart persistence | SQLite persistence covered; managed PostgreSQL restart test skipped | PARTIAL / provider BLOCKED |

## Changes

- Added deterministic reconciliation for cancelled, exhausted, expired, and recoverable leases.
- Added a `queue.lease_recovery` operational event with aggregate counts.
- Added stale-lease and poisoned-job metrics.
- Redacted persisted provider/worker diagnostic text.
- Made publication result handling tolerate a missing optional provider message ID.
- Added six Phase 8 reliability/security tests.

## Remaining provider evidence

Actual Vercel duplicate delivery, provider retry timing, callback authentication, Queue outage recovery, PostgreSQL multi-process contention, transaction interruption, and regional failover were not executed. They must not be inferred from the local SQLite contract tests.
