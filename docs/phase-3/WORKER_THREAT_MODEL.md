# Worker Threat Model

## Assets

Production database/session/AI/queue/storage credentials, confidential source archives, project ownership, artifacts, internal APIs, host files, provider budget, and other users' jobs.

## Trust boundaries

1. Browser to authenticated API.
2. API transaction to PostgreSQL/outbox.
3. Outbox publisher to Vercel Queue.
4. Queue callback to database-authorized consumer.
5. Consumer to one non-persistent Sandbox microVM.
6. Sandbox to private object storage through narrowly scoped objects only.

Queue payloads are untrusted routing hints. They contain only version, job ID and outbox ID. The consumer rechecks the published outbox row and atomically claims the PostgreSQL job. Source code and secrets are not queue payloads.

## Controls implemented

- Source-controlled production execution gate.
- Immutable revision binding and owner-scoped job APIs.
- Transactional outbox, idempotency keys, leases, retries, poison state and cancellation.
- Default-deny sandbox network configuration and no mounts/ports.
- Minimal sandbox environment and predefined commands.
- Non-persistent sandbox deletion in `finally`.
- Private object keys, short authorization lifetime, size/SHA-256 verification and owned artifacts.
- Per-user submission/concurrency/storage configuration ceilings.

## Unverified assumptions

Actual microVM isolation, network enforcement including DNS/metadata, provider disk/process ceilings, cancellation during active provider calls, deletion guarantees, and account compatibility are `NOT TESTED`. These assumptions prevent execution release.
