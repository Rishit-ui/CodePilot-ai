# CodePilot AI — System Architecture Specification

## 1. High-Level Architecture Overview

CodePilot AI is implemented as a modular monolith with self-contained subsystems designed for zero-dependency portability and isolation:

```
[ Web Browser Client ]
         │ (HTTP / JSON / Inert Previews)
         ▼
┌────────────────────────────────────────────────────────┐
│                      Fast API Gateway                  │
│   (node:http · REST Endpoints · Strict CSP Header)     │
└─────────┬──────────────┬──────────────┬────────────────┘
          │              │              │
          ▼              ▼              ▼
┌──────────────┐ ┌──────────────┐ ┌──────────────────────┐
│ Auth & RBAC  │ │ Ingestion &  │ │ Analysis & AST Index │
│  (scrypt /   │ │ SSRF Shield  │ │ (JS/TS, Python, Go,  │
│  Sessions)   │ │ (readZip)    │ │  Docker, SQL)        │
└──────────────┘ └──────────────┘ └──────────┬───────────┘
                                             │
          ┌──────────────────────────────────┴───────────┐
          ▼                                              ▼
┌──────────────────────┐                       ┌──────────────────────┐
│ Architecture Engine  │                       │ Diagnostics & AI QA  │
│ (15-Section Report & │                       │ (Grounded Citations  │
│  Dependency Graph)   │                       │  & Secret Redaction) │
└─────────┬────────────┘                       └──────────┬───────────┘
          │                                               │
          ▼                                               ▼
┌──────────────────────┐                       ┌──────────────────────┐
│ Planner & Patches    │                       │ Cloud Deployment     │
│ (Unified Diffs &     │                       │ (Readiness Audit &   │
│  Rollback Checks)    │                       │  Live Health Checks) │
└─────────┬────────────┘                       └──────────┬───────────┘
          │                                               │
          └──────────────────────┬────────────────────────┘
                                 ▼
                     ┌──────────────────────┐
                     │ SQLite Data Store    │
                     │ (DatabaseSync)       │
                     └──────────────────────┘
```

## 2. Core Subsystems

### Ingestion Engine & SSRF Shield (`src/archive.js`, `src/importer.js`)
- Enforces hard resource limits: 10 MB upload, 30 MB extracted, 1,500 files, 2 MB per file.
- Zip Slip protection validates paths against traversal (`..`, `\`, null bytes).
- Blocks symbolic links (`unixType === 0o120000`).
- Enforces compression ratio check (max 100:1) to mitigate zip bomb attacks.
- SSRF Shield strictly blocks loopback (`127.0.0.0/8`, `::1`), RFC 1918 private ranges (`10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`), and Cloud Metadata (`169.254.169.254`, `metadata.google.internal`).

### Analysis & Symbol Extraction (`src/analyzer.js`, `src/analyzers/`)
- Multi-language AST classification for JavaScript, TypeScript, Python, Go, Dockerfile, Docker Compose, and SQL.
- Extracts exported functions, classes, interfaces, routes (`app.get`, `@app.get`), and dependencies.
- Automatic credential redaction (AWS Keys, GitHub PATs, private keys, database connection strings).

### Architecture Engine (`src/architecture.js`)
- Generates structured graph data for interactive dependency diagrams.
- Synthesizes the full 15-section Architecture Report complying with Specification Section 13.
- Exports formatted Markdown reports on demand.

### Grounded AI Assistant (`src/ai.js`)
- Lexical and symbol-based evidence retrieval.
- Never extrapolates beyond current revision code lines.
- Outputs verified citations with exact line numbers (`file.js:line`).
- Sanitizes untrusted code inputs against prompt injection vectors.

### Deployment & Live Verification (`src/deployer.js`)
- Evaluates 5-point readiness checklist before any deployment.
- Supports provider adapters: `local-docker`, `render`, `vercel`, `fly`, `mock`.
- **Live Health Verification**: Verifies HTTP response and JSON health payload before marking any deployment as `verified`.

## 3. Data Model & Database Entities

The SQLite database (`src/db.js`) manages 14 relational tables:
1. `users` — Registered accounts, hashed passwords, global admin flags.
2. `sessions` — High-entropy bearer tokens with expiration timestamps.
3. `workspaces` — Tenant isolation boundaries with slugs.
4. `workspace_members` — RBAC roles (`owner`, `admin`, `editor`, `viewer`).
5. `projects` — Project definitions scoped to workspaces.
6. `revisions` — Immutable codebase states identified by SHA-256 content hashes.
7. `files` — Indexed files, languages, sizes, and redacted text content.
8. `symbols` — Functions, classes, routes, and environment variable references.
9. `edges` — Dependency relationships with confidence and provenance metadata.
10. `findings` — Vulnerabilities, maintenance markers, and suppression justification.
11. `plans` & `plan_tasks` — Feature requirements decomposed into testable ordered tasks.
12. `patches` — Unified diffs, original and patched content, and rollback states.
13. `deployments` — Provider records, public URLs, logs, and verified health status.
14. `audit_events` — Immutable security log tracking all critical state modifications.
