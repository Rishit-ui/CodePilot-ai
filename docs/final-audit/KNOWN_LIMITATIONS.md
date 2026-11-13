# Known Limitations

Updated: 2026-11-13

- Arbitrary repository test execution is disabled in production. The local runner is for trusted development only; there is no verified gVisor/microVM worker.
- Worker isolation, network denial, resource exhaustion, timeout enforcement, cleanup, and production-secret non-disclosure attack tests are `NOT TESTED` because no worker was deployed.
- `execution_jobs` provides durable ownership, retry, cancellation, lease, and failure state, but no production queue consumer or Vercel Queue transport is provisioned. Queue-delay/job-timeout telemetry is therefore `NOT TESTED`.
- Vercel has a 4.5 MB function payload ceiling; larger repository ingestion needs direct object-storage upload and a queued importer. No object-storage integration exists.
- The 30-second Vercel function configuration is appropriate only for bounded API work. Long analysis belongs in a worker.
- Managed PostgreSQL provider TLS, connection proxy, failover, scaling, PITR, and cross-region recovery are `NOT TESTED`; only a local PostgreSQL 17 container was verified.
- PostgreSQL migrations are startup transactions, not a standalone reviewed migration CLI. Always snapshot and stage before production rollout.
- The fixed-window limiter can allow traffic near a window boundary. It is shared and atomic, but not a sliding-window algorithm.
- External AI providers and real cloud deployment adapters require credentials and were not exercised.
- Static dependency analysis remains incomplete for reflection, generated code, runtime-only imports, and languages without dedicated analyzers.
