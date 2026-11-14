# Phase 8 Baseline Audit

Date: 2026-11-15 (Asia/Calcutta)

## Source identity

- Project: `C:\Users\Rishit\OneDrive\Desktop\CodePilot AI`
- Git root: `C:/Users/Rishit/OneDrive/Desktop/CodePilot AI`
- Branch: `main`
- Starting HEAD: `28d6c9eadcaee79f91676046a00413db38af4b34` (`updated`)
- Remote: `origin` points to the expected CodePilot-ai GitHub repository.
- Starting user-owned untracked files: `CodePilot-AI-Phase-7.zip` and `tash list`. Both are protected and were left untouched.

The expected Phase 7 implementation is tracked at the starting commit. It includes the Vercel Queue callback entry point, transactional outbox, durable job state, authorization checks, release gate, and 20-scenario adversarial harness.

## Baseline validation

| Command | Actual result |
|---|---|
| `npm run check` | PASS |
| `npm test` | PASS outside the desktop network sandbox: 91 passed, 0 failed, 5 skipped, 96 total |
| `npm run test:e2e` | PASS: 23 passed, 0 failed |
| `npm run preflight:staging` | PASS as a read-only audit; PostgreSQL, Queue, Blob, Sandbox, and external AI all BLOCKED |

The first sandboxed `npm test` invocation produced 9 failures caused by denied loopback connections (`EACCES`). The unchanged suite was rerun with local-loopback permission and passed. This environmental run is not reported as an application failure.

## Configuration and safeguards

- `EXECUTION_RELEASE_VERIFIED` was and remains source-controlled `false`.
- Production authentication cannot be disabled.
- Production execution cannot be enabled through environment configuration alone.
- Production requires durable PostgreSQL and a strong explicit session secret.
- Provider tests require explicit opt-in gates and credentials.
- Preflight reports only configured/not-configured booleans and did not print secret values.

## Baseline risks carried into Phase 8

1. A running job moved to `CANCEL_REQUESTED` could remain stranded after worker loss.
2. A `RUNNING` job whose final lease expired could remain nonterminal after exhausting attempts.
3. Persisted queue and worker diagnostic strings were not consistently secret-redacted.
4. Real provider queue delivery, PostgreSQL concurrency, and 19 Sandbox isolation scenarios lacked authorized infrastructure evidence.
5. No production deployment or real-provider adversarial campaign was authorized.

## Protected Phase 7 assets

Phase 8 preserves `api/queue-consumer.js`, `src/queue/consumer.js`, `src/queue/vercel_queue.js`, `src/execution/adversarial_harness.js`, the Phase 7 tests, the provider adapter, the five Phase 7 reports, and the false execution release gate.
