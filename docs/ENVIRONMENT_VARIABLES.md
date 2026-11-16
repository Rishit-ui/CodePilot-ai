# Environment Variables

## Required production values

| Variable | Purpose | Rule |
| --- | --- | --- |
| `CODEPILOT_SESSION_SECRET` | Session security | Secret, unique per environment, at least 32 characters |
| `DATABASE_URL` | Durable PostgreSQL | Secret URL; required in production |
| `CODEPILOT_DB_SSL_MODE` | Database TLS | `verify-full` for managed databases; local Compose uses `disable` only on its private network |
| `CODEPILOT_AUTH_ENABLED` | Server-side auth | Must be `true` in production |
| `CODEPILOT_RATE_LIMIT_ENABLED` | Distributed limiting | Must be `true` in production |
| `CODEPILOT_EXECUTION_MODE` | Execution master switch | Keep `disabled` |

## Local Compose inputs

`.env.docker` supplies `CODEPILOT_SESSION_SECRET`, `POSTGRES_PASSWORD`, and optional `POSTGRES_DB`, `POSTGRES_USER`, `CODEPILOT_BIND_ADDRESS`, and `CODEPILOT_PORT`. PostgreSQL credentials are consumed inside the private Compose network; no database port is published.

## Optional providers

`CODEPILOT_AI_PROVIDER`, `CODEPILOT_AI_API_KEY`, `CODEPILOT_AI_MODEL`, and `CODEPILOT_AI_BASE_URL` configure external AI. Queue, storage, and worker variables are documented in `docs/phase-6/STAGING_CONFIGURATION_MATRIX.md`; they remain disabled for this release. Do not place secrets in Git, Docker images, command output, or logs.

See `.env.example`, `.env.docker.example`, and `docs/phase-6/STAGING_CONFIGURATION_MATRIX.md` for the exact names accepted by the current code.
