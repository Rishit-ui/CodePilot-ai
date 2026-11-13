# Queue Architecture

Status: local reliability behavior `PASS`; real Vercel Queues delivery `BLOCKED`.

Job creation and outbox insertion occur in one PostgreSQL transaction. An outbox dispatcher uses official `@vercel/queue` 0.11.0 `send(topic, payload, { idempotencyKey, retentionSeconds, region })`. Failure leaves the row pending with bounded exponential retry; five publication failures mark the job `BLOCKED` rather than losing it.

Messages contain exactly `{version, jobId, outboxId}`. The consumer rejects extra or malformed fields, verifies the published outbox row, and atomically changes only a claimable job to `RUNNING`. Duplicate delivery observes the existing running/terminal state and does not repeat work. Leases recover abandoned work; attempts are bounded; exhausted jobs become persisted poisoned failures. Owners can cancel and retry eligible jobs.

States: `QUEUED`, `DISPATCHED`, `RUNNING`, `SUCCEEDED`, `FAILED`, `CANCEL_REQUESTED`, `CANCELLED`, `TIMED_OUT`, `BLOCKED`, `EXPIRED`.

The provider offers at-least-once delivery and idempotency keys according to https://vercel.com/docs/queues. No queue project, OIDC token, push callback or real redelivery was available, so provider durability, callback authentication, visibility behavior and poison delivery are `NOT TESTED`. The staging file intentionally does not register a queue trigger while execution is release-blocked.
