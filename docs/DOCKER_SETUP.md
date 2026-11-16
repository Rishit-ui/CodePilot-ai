# Docker Setup

## Topology

The production-style local stack contains `codepilot` and `postgres`. PostgreSQL is reachable only on the internal Compose network. `postgres-data` preserves the database and `codepilot-data` preserves application working data. The application runs as the non-root `codepilot` user with a read-only root filesystem, dropped Linux capabilities, a bounded temporary filesystem, health checks, and graceful `SIGTERM` handling.

## Start

1. Copy `.env.docker.example` to `.env.docker` (`Copy-Item .env.docker.example .env.docker` in PowerShell).
2. Generate independent random values for `CODEPILOT_SESSION_SECRET` (at least 32 characters) and `POSTGRES_PASSWORD`. Use URL-safe characters for the database password because Compose inserts it into `DATABASE_URL`.
3. Run `docker compose --env-file .env.docker config --quiet`.
4. Run `docker compose --env-file .env.docker up --build -d`.
5. Wait for `docker compose --env-file .env.docker ps` to show both services healthy, then open `http://127.0.0.1:3000`.

Do not commit `.env.docker`. The database has no host port. Execution remains disabled by configuration and by the source-controlled release gate.

## Resource profile

On the verified Windows 11 / Docker Desktop host, the candidate application image was 378,217,071 bytes. A settled idle snapshot used about 39 MiB for the app and 23 MiB for PostgreSQL; imports and analysis temporarily require more memory and disk. Database storage grows in the `postgres-data` volume, while Docker image and build cache usage varies by Docker Desktop configuration. No Redis, object-storage emulator, or additional background service is required.

## Operations

- Logs: `docker compose --env-file .env.docker logs --no-log-prefix codepilot`
- Stop without deleting data: `docker compose --env-file .env.docker down`
- Rebuild: `docker compose --env-file .env.docker up --build -d`
- Destructive volume deletion is intentionally not part of routine instructions.
