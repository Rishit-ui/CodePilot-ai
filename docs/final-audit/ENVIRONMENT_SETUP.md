# Environment Setup

Updated: 2026-11-13

## Local trusted development

Requirements: Node.js 24+, npm, and optionally Docker. Run `npm ci`, copy `.env.example` to `.env`, then use `npm run check`, `npm test`, and `npm start`. SQLite is the local default. `CODEPILOT_EXECUTION_MODE=local-development` may execute approved commands and is only for trusted repositories on a trusted workstation.

## Production configuration

```dotenv
NODE_ENV=production
CODEPILOT_AUTH_ENABLED=true
CODEPILOT_SESSION_SECRET=<unique secret of at least 32 characters>
DATABASE_URL=postgres://<user>:<password>@<host>:5432/<database>
CODEPILOT_DB_SSL_MODE=verify-full
CODEPILOT_DB_POOL_MAX=3
CODEPILOT_DB_CONNECTION_TIMEOUT_MS=5000
CODEPILOT_DB_QUERY_TIMEOUT_MS=15000
CODEPILOT_RATE_LIMIT_ENABLED=true
CODEPILOT_TRUST_PROXY=true
CODEPILOT_TRUSTED_PROXY_HOPS=1
CODEPILOT_EXECUTION_MODE=disabled
```

Production refuses a missing/weak session secret, disabled auth, local execution, or enabled distributed limiting without PostgreSQL. Never put actual credentials in `.env.example` or Git.

Rate policies are configurable as `CODEPILOT_RATE_<POLICY>_SUBJECT_MAX`, `..._IP_MAX`, and `..._WINDOW_MS`, where policy is `REGISTRATION`, `LOGIN`, `AI`, `IMPORT`, `ANALYSIS`, `PATCH`, `EXECUTION`, or `DEPLOYMENT`. Configure `CODEPILOT_AUTH_FAILURE_MAX` and `CODEPILOT_AUTH_FAILURE_WINDOW_MS` separately. Trust forwarded IPs only behind a known proxy and set the exact trusted hop count.

## Docker

```powershell
$env:CODEPILOT_SESSION_SECRET = '<strong generated value>'
$env:DATABASE_URL = 'postgres://...'
$env:CODEPILOT_DB_SSL_MODE = 'verify-full'
docker compose config
docker compose up --build
```

Compose requires both secret and database URL and keeps execution disabled. The image runs as `codepilot` and exposes port 3000.

## PostgreSQL migration and recovery

Startup initializes the schema transactionally and records migration versions. Before upgrades, take a provider snapshot and custom dump; restore into a new database and validate it before switching. See `PHASE_2_RECOVERY_REPORT.md`.

## Vercel

Use pooled PostgreSQL credentials suitable for serverless connections. Keep execution disabled. Direct request/response payloads cannot exceed 4.5 MB; route larger uploads through future object storage. Do not launch long work after returning a response. The managed queue/worker architecture is a next-phase item, not currently configured.

Verify `GET /api/health` for liveness and `GET /api/ready` for PostgreSQL/rate-limit availability. A 503 readiness response means the instance must not receive production traffic.
