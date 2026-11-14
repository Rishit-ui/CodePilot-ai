# Phase 8 Test Report

Date: 2026-11-15

## Final local results

| Command | Result |
|---|---|
| `npm run check` | PASS |
| `npm run test:phase8` | 6 passed, 0 failed, 0 skipped |
| `npm test` | 97 passed, 0 failed, 5 skipped, 102 total |
| `npm run test:e2e` | 23 passed, 0 failed |
| `npm run preflight:staging` | PASS read-only; all external providers BLOCKED |
| `git diff --check` | Recorded in final verification |

The five skipped tests require real Vercel Queue, private Blob, external AI, PostgreSQL, or Vercel Sandbox authorization. A skipped provider test is not a pass.

## Phase 8 scenarios added

1. Concurrent duplicate delivery executes once.
2. Interrupted outbox publishing retries durably with the same idempotency key.
3. Worker crash recovery requeues a live job and poisons an exhausted job.
4. Running cancellation is owner-only and resolves after failure or worker loss.
5. Cross-tenant job access fails and persisted diagnostics redact secrets.
6. Operational metrics report stale leases and poisoned jobs without exposing diagnostic text.

Existing tests cover anonymous/invalid authentication, project and nested-resource ownership, queue poison paths, execution policy, path traversal, SSRF, rate limiting, timeouts, provider failure semantics, sandbox cleanup contracts, and truthful unexecuted-test states.

## Evidence limitation

The local suite validates code behavior and state transitions. It does not validate real provider isolation, provider outages, managed PostgreSQL concurrency, cloud network policy, or production deployment.
