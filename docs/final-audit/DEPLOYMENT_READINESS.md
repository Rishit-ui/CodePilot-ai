# Deployment Readiness

Evaluation date: 2026-11-13

Decision: `BLOCKED` for public production deployment; Docker packaging is verified

| Gate | Result | Evidence |
| --- | --- | --- |
| Syntax validation | PASS | `npm run check` exited 0 after repairs. |
| Automated tests | PASS | Final suite: 53 passed, 0 failed, 0 skipped. |
| Route authentication | PASS | Central middleware and serverless rewrite regression tests. |
| Project ownership | PASS | Owner/workspace RBAC and cross-user access tests. |
| Production secrets | PASS | Startup rejects missing/weak/placeholder secrets and disabled production auth. |
| Truthful test states | PASS | No serverless branch reports PASS without execution. |
| Compose interpolation | PASS | `docker compose config` succeeded with an injected secret. |
| Image build | PASS | `docker build --tag codepilot-ai:phase1 .` succeeded using `npm ci --omit=dev`; npm reported 0 vulnerabilities. |
| Container runtime | PASS | Temporary container reported `running healthy`, ran as `codepilot`, and returned HTTP 200 from `/api/health`. |
| Live PostgreSQL | NOT VERIFIED | No PostgreSQL service or production database was supplied. |
| Rate limiting | BLOCKED | Auth endpoints lack application-level throttling. |
| Untrusted execution isolation | BLOCKED | Test execution is a host subprocess, not a separate sandbox worker. |
| Cloud deployment | NOT EXECUTED | Phase instructions prohibited deployment. |

## Required production configuration

- `NODE_ENV=production`
- `CODEPILOT_AUTH_ENABLED=true`
- `CODEPILOT_SESSION_SECRET`: unique random value of at least 32 characters supplied by a secret manager
- `DATABASE_URL`: required for PostgreSQL; omit only when using the persistent SQLite volume

Docker Compose preserves `/app/.data` in `codepilot-data` and requires the session secret through `${CODEPILOT_SESSION_SECRET:?...}`. The image contains production dependencies, `src`, and `public`; `.env`, Git metadata, tests, logs, and local data are excluded.

Do not deploy publicly until rate limiting and isolated untrusted execution are resolved or those features are disabled at the production boundary.
