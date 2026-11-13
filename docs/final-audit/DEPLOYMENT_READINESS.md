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
| Production image | `PASS` | `codepilot-ai:phase2-final` built; healthy, non-root, DB ready. |
| Execution security | `PASS` by disablement | `CODEPILOT_EXECUTION_MODE=disabled`; secure worker `BLOCKED`. |
| Serverless routing/auth | `PASS` | Entry point and rewrite regression tests. |
| Managed Vercel deployment | `NOT TESTED` | No deploy or provider credentials used. |
| External queue/worker availability | `NOT TESTED` | Durable DB jobs exist; no worker provisioned. |

Required production variables: `NODE_ENV=production`, `CODEPILOT_AUTH_ENABLED=true`, a unique 32+ character `CODEPILOT_SESSION_SECRET`, durable `DATABASE_URL`, appropriate `CODEPILOT_DB_SSL_MODE` (normally `verify-full`), `CODEPILOT_RATE_LIMIT_ENABLED=true`, and `CODEPILOT_EXECUTION_MODE=disabled` until the worker gate passes.

Readiness requires PostgreSQL. `/api/ready` returns 503 with sanitized dependency status when it is unavailable. Do not use SQLite on Vercel or for horizontally scaled production.
