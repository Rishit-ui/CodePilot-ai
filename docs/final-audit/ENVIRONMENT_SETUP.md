# CodePilot AI — Environment Setup Guide

> **Status:** Production-ready as of audit date 2026-11-13.  
> All commands use PowerShell syntax (Windows) with Bash equivalents noted where they differ.

---

## Table of Contents

1. [Prerequisites](#1-prerequisites)
2. [Clone & Install](#2-clone--install)
3. [Environment Variables](#3-environment-variables)
4. [Local Development with SQLite](#4-local-development-with-sqlite)
5. [Production with PostgreSQL](#5-production-with-postgresql)
6. [AI Provider Configuration](#6-ai-provider-configuration)
7. [Vercel Deployment](#7-vercel-deployment)
8. [Docker Deployment](#8-docker-deployment)
9. [Health Check Verification](#9-health-check-verification)

---

## 1. Prerequisites

| Requirement | Minimum Version | Notes |
|-------------|----------------|-------|
| **Node.js** | `>= 20.0.0` | v24 recommended (used in CI). `node --version` to verify. |
| **npm** | bundled with Node | v9+ preferred |
| **git** | any recent | For cloning and GitHub import features |
| **Docker** (optional) | 24+ | For containerised deployment only |

> [!IMPORTANT]
> The `package.json` `engines` field declares `"node": ">=20.0.0"`. Running on Node 18 or earlier is unsupported and may cause test failures.

---

## 2. Clone & Install

```powershell
# Clone the repository
git clone https://github.com/Rishit-ui/CodePilot-AI.git
Set-Location "CodePilot AI"

# Install all dependencies
npm install
```

The five runtime dependencies installed by `npm install`:

| Package | Version | Purpose |
|---------|---------|---------|
| `acorn` | ^8.19.0 | JavaScript AST parsing for impact engine |
| `adm-zip` | ^0.6.1 | ZIP archive decompression |
| `better-sqlite3` | ^13.1.1 | SQLite3 driver for local/dev database |
| `node-fetch` | ^3.3.2 | Remote URL fetching for GitHub/URL import |
| `pg` | ^8.23.1 | PostgreSQL driver for production database |

### Verify syntax and contracts

```powershell
npm run check    # Node.js --check on all source files; must exit 0
npm test         # 47 tests; all should pass
```

---

## 3. Environment Variables

Copy the template to create your local configuration:

```powershell
Copy-Item .env.example .env
```

The full list of supported variables (all optional in development):

### Server Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `NODE_ENV` | `development` | Set to `production` in deployed environments |
| `CODEPILOT_HOST` | `127.0.0.1` | Listen address. Use `0.0.0.0` in Docker |
| `CODEPILOT_PORT` | `3000` | TCP port the HTTP server binds to |
| `CODEPILOT_DATA_DIR` | `.data` | Directory where SQLite DB and uploaded files are stored |

### Session & Authentication

| Variable | Default | Description |
|----------|---------|-------------|
| `CODEPILOT_SESSION_SECRET` | *(dev fallback)* | **Required in production** (`NODE_ENV=production`). Minimum 32 chars. The server throws `FATAL` on startup if missing in prod. |
| `CODEPILOT_AUTH_ENABLED` | `false` | Set `true` to enforce bearer-token authentication on all API routes |

> [!CAUTION]
> Never deploy to production without setting a strong, unique `CODEPILOT_SESSION_SECRET`. The dev fallback is public knowledge.

### Database

| Variable | Description |
|----------|-------------|
| `DATABASE_URL` | PostgreSQL connection string (e.g. `postgres://user:pass@host/db`). Triggers PostgreSQL mode. |
| `POSTGRES_URL` | Alternative name accepted by Vercel Postgres integration |
| `POSTGRES_PRISMA_URL` | Alternative name accepted by Neon/Supabase |

If none of these are set, the application defaults to SQLite at `CODEPILOT_DATA_DIR/codepilot.db`.

### AI Provider

| Variable | Default | Description |
|----------|---------|-------------|
| `CODEPILOT_AI_PROVIDER` | `local` | AI backend: `local`, `openai`, `anthropic`, or `gemini` |
| `CODEPILOT_AI_API_KEY` | *(empty)* | API key for the chosen provider |
| `CODEPILOT_AI_MODEL` | `gpt-4o-mini` | Model identifier (e.g. `gpt-4o`, `claude-3-5-sonnet-20241022`, `gemini-1.5-pro`) |
| `CODEPILOT_AI_BASE_URL` | *(empty)* | Optional custom base URL for OpenAI-compatible APIs |

### Cloud Deployment Adapters (optional)

| Variable | Description |
|----------|-------------|
| `RENDER_API_KEY` | Required only for `render` provider deployments |
| `VERCEL_TOKEN` | Required only for programmatic Vercel deployments via the API |
| `FLY_API_TOKEN` | Required only for `fly` provider deployments |

### Ingestion & Execution Limits

| Variable | Default | Description |
|----------|---------|-------------|
| `CODEPILOT_MAX_UPLOAD_BYTES` | `10485760` (10 MB) | Maximum ZIP upload size (Vercel: 4.5 MB) |
| `CODEPILOT_MAX_EXTRACTED_BYTES` | `31457280` (30 MB) | Maximum total uncompressed content |
| `CODEPILOT_MAX_FILES` | `1500` | Maximum files per archive |
| `CODEPILOT_MAX_FILE_BYTES` | `2097152` (2 MB) | Maximum single file size |
| `CODEPILOT_MAX_COMPRESSION_RATIO` | `100` | Zip-bomb protection ratio ceiling |
| `CODEPILOT_CMD_TIMEOUT_MS` | `30000` | Test runner subprocess timeout in ms |

---

## 4. Local Development with SQLite

SQLite is the default for local development — no database setup required.

```powershell
# 1. Copy env template
Copy-Item .env.example .env

# 2. Start the dev server with auto-reload
npm run dev
# or for a one-shot start:
npm start
```

The SQLite database is automatically created at `.data/codepilot.db` on first start. Schema is initialised via the `Store` class in `src/db.js`.

**Access the UI:**
```
http://127.0.0.1:3000
```

**Check health endpoint:**
```powershell
Invoke-RestMethod http://127.0.0.1:3000/api/health
```

Expected response:
```json
{
  "status": "ok",
  "version": "0.2.0",
  "capabilities": {
    "database": "sqlite",
    "auth": "local-open",
    "aiProvider": "local"
  }
}
```

---

## 5. Production with PostgreSQL

PostgreSQL is used in hosted environments (Vercel, Render, Fly, Docker + managed DB).

```powershell
# .env for production
$env:NODE_ENV              = "production"
$env:DATABASE_URL          = "postgres://user:password@hostname:5432/codepilot"
$env:CODEPILOT_SESSION_SECRET = "your-32-plus-char-random-secret-here"
$env:CODEPILOT_HOST        = "0.0.0.0"
$env:CODEPILOT_PORT        = "3000"

node src/server.js
```

The `Store` class automatically switches from `better-sqlite3` to the `pg` client when `DATABASE_URL` is set. Schema and table creation happen automatically on startup for both dialects.

**Supported PostgreSQL providers:**
- Vercel Postgres
- Neon
- Supabase
- AWS RDS / Aurora
- Any standard PostgreSQL 14+ server

---

## 6. AI Provider Configuration

The AI subsystem defaults to `local` mode (deterministic evidence-based citations, no external API key needed). To use a live LLM:

### OpenAI

```dotenv
CODEPILOT_AI_PROVIDER=openai
CODEPILOT_AI_API_KEY=sk-...
CODEPILOT_AI_MODEL=gpt-4o-mini
```

### Anthropic

```dotenv
CODEPILOT_AI_PROVIDER=anthropic
CODEPILOT_AI_API_KEY=sk-ant-...
CODEPILOT_AI_MODEL=claude-3-5-sonnet-20241022
```

### Google Gemini

```dotenv
CODEPILOT_AI_PROVIDER=gemini
CODEPILOT_AI_API_KEY=AIza...
CODEPILOT_AI_MODEL=gemini-1.5-pro
```

### Custom OpenAI-Compatible API

```dotenv
CODEPILOT_AI_PROVIDER=openai
CODEPILOT_AI_API_KEY=your-key
CODEPILOT_AI_MODEL=your-model-name
CODEPILOT_AI_BASE_URL=https://your-openai-compatible-api.example.com/v1
```

> [!NOTE]
> If `CODEPILOT_AI_PROVIDER=local` (the default), all AI endpoints fall back to deterministic evidence-citation mode and work without any API key. This is safe for demos and testing.

---

## 7. Vercel Deployment

CodePilot AI ships with a `vercel.json` routing configuration targeting the serverless entry point at `api/index.js`.

### Steps

1. **Import to Vercel**  
   Go to [vercel.com/new](https://vercel.com/new) and import the GitHub repository `Rishit-ui/CodePilot-AI`.

2. **Configure environment variables** in the Vercel dashboard under *Project Settings → Environment Variables*:

   | Variable | Value |
   |----------|-------|
   | `DATABASE_URL` | Your Postgres connection string (Vercel Postgres, Neon, Supabase) |
   | `CODEPILOT_SESSION_SECRET` | 32+ random characters |
   | `NODE_ENV` | `production` |
   | `CODEPILOT_AI_PROVIDER` | `local` (default) or `openai`/`anthropic`/`gemini` |
   | `CODEPILOT_AI_API_KEY` | Required only if not using `local` provider |

3. **Deploy** — Vercel automatically detects `vercel.json` and deploys.

### Vercel routing (from `vercel.json`)

```json
{
  "rewrites": [
    { "source": "/api/:path*", "destination": "/api/index.js?__path=/api/:path*" }
  ],
  "functions": {
    "api/index.js": { "memory": 1024, "maxDuration": 30 }
  }
}
```

All `/api/*` traffic is routed to `api/index.js` which re-exports the full Node.js request handler from `src/server.js`. Static assets from `public/` are served by Vercel's CDN edge.

> [!IMPORTANT]
> Vercel enforces a 4.5 MB upload limit per request. The config automatically reduces `maxUploadBytes` to `4.5 MB` when `VERCEL=1` is detected.

---

## 8. Docker Deployment

### Single container (SQLite)

```powershell
# Build image
docker build -t codepilot-ai:latest .

# Run container
docker run -d `
  --name codepilot `
  -p 3000:3000 `
  -e CODEPILOT_SESSION_SECRET="your-strong-secret-here" `
  -v codepilot-data:/app/.data `
  codepilot-ai:latest
```

### Docker Compose (recommended)

```powershell
docker compose up --build
```

The `docker-compose.yml` creates:
- **Service:** `codepilot-ai` listening on port 3000
- **Volume:** `codepilot-data` persisting `.data/` between container restarts
- **Network:** `codepilot-net` (bridge)

> [!WARNING]
> The example `CODEPILOT_SESSION_SECRET` in `docker-compose.yml` is a placeholder. **Replace it** with a strong random value before production use.

### Dockerfile notes

- **Base image:** `node:24-alpine` — minimal attack surface
- **Non-root user:** Runs as `codepilot` (not root)
- **Health check:** `wget` probes `http://127.0.0.1:3000/api/health` every 30 s
- **Exposed port:** 3000

---

## 9. Health Check Verification

After starting the server (any mode), verify it is running correctly:

```powershell
# Health status
Invoke-RestMethod http://127.0.0.1:3000/api/health | ConvertTo-Json

# Database readiness
Invoke-RestMethod http://127.0.0.1:3000/api/ready | ConvertTo-Json
```

**Expected `/api/health` response fields:**

| Field | Expected value |
|-------|---------------|
| `status` | `"ok"` |
| `version` | `"0.2.0"` |
| `capabilities.database` | `"sqlite"` (dev) or `"postgres"` (prod) |
| `capabilities.auth` | `"local-open"` or `"enabled"` |
| `capabilities.aiProvider` | `"local"`, `"openai"`, `"anthropic"`, or `"gemini"` |

**Expected `/api/ready` response:**

```json
{ "status": "ready" }
```

A non-200 response from `/api/ready` indicates a database connectivity problem.
