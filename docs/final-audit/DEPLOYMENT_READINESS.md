# Deployment Readiness

Evaluation: 2026-11-13

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
