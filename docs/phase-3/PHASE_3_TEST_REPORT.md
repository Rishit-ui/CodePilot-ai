# Phase 3 Test Report

Date: 2026-11-13

## Baseline

`npm run check`: exit 0. `npm test`: 59 pass, 0 fail, 1 conditional PostgreSQL skip.

## Phase 3 local coverage

- Release gate cannot be enabled by environment configuration.
- Transactional outbox/idempotent creation and publication.
- Duplicate delivery, leases, recovery, cancellation, retry and poisoned jobs.
- Job and upload API authorization/cross-user denial.
- Upload size/SHA-256 verification and artifact ownership.
- Predefined execution profiles and unsafe workspace rejection.
- Actual-result persistence and cleanup on success/failure with a fake provider.
- Migration version 5 and real PostgreSQL outbox restart persistence.

These are local implementation tests. Fake provider tests are not Vercel security/durability evidence.

## External dependencies

Actual PostgreSQL 17: `PASS`, one integration test, zero failures. A preliminary repeat used the container-only database hostname from the application container and timed out before setup; translating that hostname to the published loopback port produced the passing result above. This was an infrastructure-addressing error, not an application assertion failure.

Actual Sandbox/Queue/Blob/staging: `NOT TESTED`. No provider credentials or deployment authorization were available, so the adversarial provider suite is explicitly skipped and execution remains blocked.

## Final verification

| Verification | Actual result |
| --- | --- |
| `npm run check` | `PASS`, exit 0 |
| `npm test` | 71 discovered; 69 pass; 0 fail; 2 skipped; exit 0 |
| Conditional PostgreSQL 17 integration | 1 pass; 0 fail; exit 0 |
| `npm audit --omit=dev` | 0 vulnerabilities; exit 0 |
| `docker compose config --quiet` with placeholders | `PASS`, exit 0 |
| `docker build -t codepilot-ai:phase3-final .` | `PASS`, exit 0 |
| Final container health | `healthy`; HTTP health and readiness succeeded |
| Final container identity | non-root `codepilot` |
| Final runtime release state | execution `disabled`; release verified `false`; queue/storage/worker `disabled` |
| Real Vercel Sandbox adversarial suite | `NOT TESTED` / `BLOCKED` |
| Real Vercel Queue and Private Blob tests | `NOT TESTED` / `BLOCKED` |
| Vercel staging deployment | `NOT TESTED`; deployment prohibited |

The two complete-suite skips are the conditional PostgreSQL test (executed separately against PostgreSQL 17 and passed) and the real Vercel Sandbox adversarial suite (not authorized and not executed). No skipped test is represented as passing.
