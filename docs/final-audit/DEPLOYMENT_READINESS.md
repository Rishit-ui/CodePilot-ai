# Deployment Readiness

Evaluation: 2026-11-14

Decision: `PASS` for a controlled deployment with arbitrary repository execution disabled; `BLOCKED` for enabling multi-tenant untrusted execution; cloud deployment itself is `NOT TESTED` and was prohibited.

| Gate | Status | Evidence |
| --- | --- | --- |
| Authentication and tenant isolation | `PASS` | Phase 1 regressions retained. |
| Distributed rate limiting | `PASS` | Actual PostgreSQL multi-pool concurrency and HTTP abuse tests. |
| PostgreSQL lifecycle/restart | `PASS` | PostgreSQL 17 integration test. |
| Migrations | `PASS` | Fresh init, legacy upgrade, repeat run, rollback, constraints. |
| Backup/restore | `PASS` | Custom dump restored; all measured counts matched. |
| Production image | `PASS` | Current-tree `codepilot-ai:phase3-final` built; healthy as non-root `codepilot`; PostgreSQL and rate-limit store ready; execution disabled. |
| Execution security | `PASS` by disablement | `CODEPILOT_EXECUTION_MODE=disabled`; secure worker `BLOCKED`. |
| Serverless routing/auth | `PASS` | Entry point and rewrite regression tests. |
| Managed Vercel deployment | `NOT TESTED` | No deploy or provider credentials used. |
| External queue/worker availability | `NOT TESTED` | Durable DB jobs exist; no worker provisioned. |
| Phase 4 parser/evidence correctness | `PASS` locally | Real JS/TS/Python parsers and explicit non-AST labels; expanded regression tests. |
| Phase 4 browser workflow | `PASS` locally | Edge/Playwright: 1 passed; 14 workspaces; desktop/mobile screenshots; final console clean. |
| Impact accuracy on external repositories | `NOT TESTED` | Only the controlled synthetic dataset was measured. |

Required production variables: `NODE_ENV=production`, `CODEPILOT_AUTH_ENABLED=true`, a unique 32+ character `CODEPILOT_SESSION_SECRET`, durable `DATABASE_URL`, appropriate `CODEPILOT_DB_SSL_MODE` (normally `verify-full`), `CODEPILOT_RATE_LIMIT_ENABLED=true`, and `CODEPILOT_EXECUTION_MODE=disabled` until the worker gate passes.

Readiness requires PostgreSQL. `/api/ready` returns 503 with sanitized dependency status when it is unavailable. Do not use SQLite on Vercel or for horizontally scaled production.

## Phase 3 release split

| Release surface | Decision |
| --- | --- |
| Platform: repository management, static analysis, reports, execution disabled | `PASS` for controlled staging/use under the Phase 2 infrastructure evidence |
| Execution feature | `BLOCKED`; source-controlled gate remains false |
| Vercel Queue/Blob/Sandbox provider stack | `NOT TESTED` against real providers |
| Vercel staging deployment | `NOT TESTED`; no deployment authorized |

`/api/health` and `/api/ready` report queue/storage providers as configured-not-probed rather than available. Environment variables cannot enable execution without a reviewed source change.

## Phase 4 release split

The authenticated platform surface is `GO` for controlled staging/use with execution disabled and within documented parser/benchmark limits. Untrusted execution remains `BLOCKED`; the source-controlled release flag is unchanged. No cloud deployment was performed.

## Phase 5 release split

Provider SDK compatibility was audited on 2026-11-14 and local lifecycle gaps were repaired. Final local evidence is 88 tests discovered, 83 passed, 0 failed and 5 explicit external-provider/infrastructure skips. The real-cloud gates remain blocked because no provider credentials or staging resources were authorized.

| Release surface | Decision |
| --- | --- |
| Local/authenticated platform with execution disabled | `PASS` locally |
| Controlled cloud staging | `BLOCKED` pending managed PostgreSQL, Queue, private Blob and deployed readiness evidence |
| External AI | `BLOCKED` pending real auth/model/connectivity test |
| Untrusted execution | `BLOCKED`; `executionReleaseVerified=false` |
| Production deployment | `NOT TESTED`; not authorized |

See `docs/phase-5/PHASE_5_FINAL_HANDOVER.md`. A configured provider is not reported as a healthy provider until a real probe succeeds.
