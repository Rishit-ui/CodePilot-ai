# CodePilot AI

> **Autonomous Codebase Intelligence, AI Software Engineering, DevOps, and Verified Cloud Deployment Platform**

[![CI/CD](https://github.com/Rishit-ui/CodePilot-AI/actions/workflows/ci.yml/badge.svg)](https://github.com/Rishit-ui/CodePilot-AI/actions)
[![Node.js](https://img.shields.io/badge/node-%3E%3D24.0.0-brightgreen.svg)](https://nodejs.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

CodePilot AI transforms an unfamiliar codebase or software idea into an understandable, testable, maintainable, containerized, and verified deployable software system.

---

## Key Capabilities

- **Zero-Dependency Architecture**: Built on Node.js 24 with native SQLite (`node:sqlite DatabaseSync`), cryptographic security (`node:crypto`), and built-in test runner (`node:test`).
- **Secure Repository Ingestion**:
  - ZIP archive ingestion with streaming validation, Zip Slip protection, symlink rejection, and zip bomb mitigation.
  - Remote URL archive import with strict SSRF defense (blocking private networks, loopback, and cloud metadata).
- **Multi-Language AST Analysis**:
  - Classifies JavaScript, TypeScript, Python, Go, Java, Docker, and SQL.
  - Discovers application entry points, HTTP route endpoints (`Express`, `FastAPI`, `Flask`), and package dependencies.
- **15-Section Architecture Reports**:
  - Synthesizes executive overviews, technology inventories, boundary maps, frontend/backend architecture, database schemas, and recommended next actions.
  - One-click export to formatted Markdown documentation.
- **Interactive Architecture Graph**:
  - Visual dependency graph illustrating file-to-file imports and package dependencies with node inspection.
- **Grounded AI Assistant**:
  - Question answering strictly grounded in current revision source lines.
  - Exact source citations (`file.js:line`) with prompt-injection defense and offline deterministic fallback.
- **Diagnostics & Credential Shield**:
  - Detects AWS keys, GitHub PATs, private keys, database connection strings, unpinned Docker base images, and maintenance markers.
  - One-click suppression workflow with mandatory audit trail justification.
- **Implementation Planner & Reviewable Patches**:
  - Decomposes natural language requests into ordered, testable tasks and acceptance criteria.
  - Generates unified diffs with conflict detection, patch application, and instant rollback.
- **Docker Assistant**:
  - Stack detection for Node, Next.js, Python, and Go.
  - Generates multi-stage Dockerfiles with non-root security users, health checks, `.dockerignore`, and `docker-compose.yml`.
- **Verified Cloud Deployment**:
  - Pre-deployment 5-point readiness audit.
  - Supported provider adapters: `local-docker`, `render`, `vercel`, `fly`, `mock`.
  - **Live Verification**: Never reports success without conducting an actual live HTTP probe against the healthcheck endpoint.

---

## Quick Start Guide

### Prerequisites
- Node.js >= 24.0.0
- (Optional) Docker for containerized deployment

### 1. Installation
Clone the repository:
```bash
git clone https://github.com/Rishit-ui/CodePilot-AI.git
cd "CodePilot AI"
```

### 2. Configuration
Copy the configuration template:
```bash
cp .env.example .env
```
*(In development, default values work out of the box with zero external keys required).*

### 3. Run Automated Tests
Execute the comprehensive test suite (unit tests, SSRF defenses, security scanning, API lifecycle):
```bash
npm test
```

### 4. Verify Syntax & Contracts
```bash
npm run check
```

### 5. Launch Application
Start the server:
```bash
npm start
```
Open your browser and navigate to:
```
http://127.0.0.1:3000
```

---

## Vercel Deployment

CodePilot AI is fully optimized for **Vercel Serverless Functions** and static edge hosting:

1. Import the repository `https://github.com/Rishit-ui/CodePilot-ai` into your Vercel Dashboard.
2. In **Project Settings > Environment Variables**, configure:
   - `DATABASE_URL` (or attach **Vercel Postgres** / **Neon** / **Supabase** via marketplace integrations).
   - `CODEPILOT_SESSION_SECRET` (generate a random 32+ character string).
   - *(Optional)* `CODEPILOT_AI_PROVIDER` (`local` by default, or `openai`, `anthropic`, `gemini`).
   - *(Optional)* `CODEPILOT_AI_API_KEY` (if using an external AI provider).
3. Deploy! Vercel will automatically serve the static dashboard from `public/` and route all `/api/*` endpoints to the serverless function in `api/index.js` as defined in `vercel.json`.

---

## Docker Deployment

To run CodePilot AI in an isolated container:

```bash
docker compose up --build
```
The application will be accessible at `http://localhost:3000`.

---

## API Documentation

| Method | Endpoint | Description |
| :--- | :--- | :--- |
| `GET` | `/api/health` | Service health status, version, and active capabilities |
| `GET` | `/api/ready` | Database readiness check |
| `POST` | `/api/auth/register` | Register a new user |
| `POST` | `/api/auth/login` | Authenticate user and obtain session token |
| `GET` | `/api/projects` | List all projects |
| `POST` | `/api/projects` | Create a new project |
| `POST` | `/api/projects/:id/import` | Ingest a ZIP repository archive |
| `POST` | `/api/projects/:id/import-url` | Ingest remote archive with SSRF validation |
| `GET` | `/api/projects/:id/files` | Query indexed files in current revision |
| `GET` | `/api/projects/:id/file?path=...` | Retrieve redacted, inert file content |
| `GET` | `/api/projects/:id/graph` | Retrieve dependency graph nodes and edges |
| `GET` | `/api/projects/:id/architecture-report`| Generate 15-section Architecture Report (JSON) |
| `GET` | `/api/projects/:id/architecture-report.md` | Download formatted Architecture Report (Markdown) |
| `GET` | `/api/projects/:id/findings` | Retrieve diagnostics, issues, and security findings |
| `POST` | `/api/projects/:id/findings/:findingId/suppress` | Suppress finding with audit justification |
| `POST` | `/api/projects/:id/ask` | Query grounded AI assistant with citations |
| `POST` | `/api/projects/:id/plans` | Generate implementation plan from requirement |
| `POST` | `/api/projects/:id/patches` | Generate unified diff patch |
| `POST` | `/api/projects/:id/patches/:id/apply` | Apply patch to current revision |
| `POST` | `/api/projects/:id/patches/:id/rollback` | Roll back applied patch |
| `GET` | `/api/projects/:id/docker` | Generate Dockerfile, Compose, and .dockerignore |
| `GET` | `/api/projects/:id/deployment-readiness` | Assess 5-point deployment readiness |
| `POST` | `/api/projects/:id/deploy` | Trigger provider deployment and live verification |
| `GET` | `/api/audit` | Query immutable security audit log |

---

## Security & Isolation

For full threat models and security controls, see [`docs/THREAT_MODEL.md`](docs/THREAT_MODEL.md).  
For architectural specifications and data models, see [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

---

## License

MIT License.
