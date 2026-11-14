# Phase 7 Queue Consumer Report

Date: 2026-11-14

## Verdict

The missing deployable Queue consumer entry point is closed at the local implementation and provider-contract level. Real Vercel Queue delivery remains **BLOCKED** because no linked staging project, OIDC identity, topic, deployment, or provisioning authorization is available. Local callback tests are not reported as real Vercel integration.

## Provider contract

The installed `@vercel/queue` 0.11.0 declarations and current [Vercel Queues documentation](https://vercel.com/docs/queues) require plain `api/` Node functions to use `QueueClient.handleNodeCallback`. Push consumers are registered with an `experimentalTriggers` entry whose type is `queue/v2beta`. Vercel documents these trigger functions as internal Queue infrastructure endpoints rather than public URLs; the SDK performs callback parsing, lease operations, acknowledgment, retries, and OIDC-authenticated Queue API calls.

Implemented deployment surfaces:

- `api/queue-consumer.js` is a Connect-style Vercel Node function.
- `vercel.json` registers `codepilot-jobs`.
- `vercel.staging.json` separately registers `codepilot-staging-jobs`.
- both declare a 300-second function ceiling, 60-second retry interval, and zero initial delay.
- the SDK visibility timeout is calculated from the command timeout with cleanup allowance and is bounded to the provider-supported range.

The normal `/api/:path*` rewrite continues to target `api/index.js`; it does not make the trigger function a public application endpoint. Actual air-gapping and callback authentication remain provider claims until deployed and probed.

## Application authorization and reconciliation

Queue payloads remain minimal untrusted routing hints: `{ version, jobId, outboxId }`. Before a job can be claimed, the consumer now verifies:

1. exact schema and identifier format;
2. authenticated SDK delivery metadata is present;
3. the delivery topic matches the configured topic and outbox topic;
4. the outbox exists and is `PUBLISHED`;
5. the received envelope matches the immutable outbox envelope;
6. the provider message ID matches the message ID persisted after publication;
7. the job exists and has an actor and project;
8. the actor still has project access, including workspace membership rules;
9. the immutable revision belongs to the job project;
10. the job type is supported by the execution consumer;
11. `executionReleaseVerified`, external-worker mode, and the Vercel Sandbox provider are all enabled.

Any ownership, revision, topic, message-ID, outbox, job-type, or release-gate violation is made durable as `BLOCKED`, records an operational event and audit event where a job exists, and is acknowledged as non-retryable poison. It cannot silently remain `DISPATCHED`. A pending publication is retryable rather than acknowledged. Valid jobs are atomically claimed with a lease. Terminal, running, cancellation-requested, and already-completed jobs are treated as idempotent duplicate deliveries.

Cancellation and timeout transitions remain durable. Processing errors create sanitized operational records. Retry directives exponentially back off transient failures and acknowledge explicit non-retryable poison. The job store’s maximum attempts and poisoned state remain the terminal retry boundary.

Only `test-execution` is accepted by the real execution consumer. Other durable job records can still be created by older/static workflow APIs, but delivery to this consumer is explicitly reconciled to `BLOCKED` rather than falsely completed. No asynchronous static-analysis worker is claimed by this report.

## Local contract evidence

`tests/phase7_queue_consumer.test.js` verifies:

- Node callback and `queue/v2beta` manifests;
- provider metadata forwarding and calculated visibility timeout;
- malformed envelope/metadata rejection;
- one-time execution and duplicate idempotency;
- audit and operational records;
- cross-user actor rejection;
- provider message-ID tampering rejection;
- release-blocked delivery;
- cancellation and timeout state;
- poison acknowledgment and transient backoff.

The focused Queue suites passed 10/10. The full local suite passed 91 tests with zero failures. The conditional PostgreSQL integration suite now also exercises real consumer claim/completion/redelivery when `TEST_POSTGRES_URL` is provided, but it was **BLOCKED/skipped** in this phase.

## Remaining provider gate

A real Queue result requires a deployed staging function, a staging-only topic, actual OIDC callback delivery, PostgreSQL, duplicate redelivery, retry timing, lease renewal, poison acknowledgment, and deployment-version routing evidence. None was performed.

