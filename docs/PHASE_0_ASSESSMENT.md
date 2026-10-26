# CodePilot AI — Phase 0 Assessment and Implementation Plan

Assessment date: 2026-10-26

## Evidence-based current state

The selected workspace is an empty directory. It has no Git metadata, source files, package manifests, lockfiles, environment templates, database migrations, tests, Docker configuration, CI configuration, or deployment integration. Consequently, no existing application behavior, build command, test suite, architecture, deployment configuration, or security control can be verified.

A nearby archive, `C:\Users\Rishit\OneDrive\Desktop\code.zip`, was inspected only as a read-only ZIP manifest. Its root project is `codeAi` and its contents describe a railway-booking application, not CodePilot AI. It has not been extracted, imported, or treated as this workspace's source of truth.

| Assessment area | Status | Evidence |
| --- | --- | --- |
| Repository and Git history | Missing | Workspace contains no `.git` directory or files. |
| Frontend | Missing | No source or frontend manifest exists. |
| Backend/API | Missing | No server code, API contract, or dependency manifest exists. |
| Data model and migrations | Missing | No database configuration or migrations exist. |
| Tests | Missing | No test files or runners exist. |
| Containers and CI/CD | Missing | No Docker or workflow files exist. |
| Environment configuration | Missing | No `.env.example` or configuration schema exists. |
| Deployment integration | Unconfigured | No provider credentials, adapter, or deployment metadata exists. |

## Constraints and decisions

- This is a greenfield build, so the specification's recommended modular-monolith approach is the appropriate starting point.
- The first implementation must establish a small, runnable, observable foundation before authentication, uploads, AI providers, code execution, or deployment operations are introduced.
- Imported repository content must remain untrusted data. No imported code may be executed by the web/API process.
- Provider-backed operations, paid services, OAuth applications, production infrastructure, and deployments remain out of scope until credentials, provider selection, and explicit authorization are supplied.

## Dependency-aware delivery plan

### Milestone 1 — Runnable foundation

Create the repository baseline, TypeScript/Next.js frontend, FastAPI backend, local PostgreSQL development configuration, configuration validation, structured logging, health/readiness endpoints, error handling, and a minimal test harness. Add a safe `.env.example`, `.gitignore`, local setup guide, and CI checks for format, lint, types, tests, and builds.

Dependencies: runtime versions, package-manager selection, Docker availability, and a local PostgreSQL strategy. No authentication or import feature may depend on unvalidated environment configuration.

Exit evidence: fresh-install instructions work; frontend and API start; health tests and production builds pass.

### Milestone 2 — Identity, workspaces, and project isolation

Add migrations and workspace-scoped entities, server-side authorization, audit-event infrastructure, and project CRUD. Start with a local development identity adapter and keep production auth behind an established provider adapter.

Dependencies: Milestone 1 database, migration framework, configuration, and API error model.

Exit evidence: migration tests and cross-workspace authorization tests pass.

### Milestone 3 — Secure import and immutable revisions

Implement ZIP import first with streaming validation, extraction limits, traversal/symlink protection, isolated storage, revision hashes, job states, cancellation where safe, and retry/idempotency. Defer Git provider import until OAuth/provider scope is approved.

Dependencies: Milestone 2 authorization and storage interface; a durable job runner/queue; defined resource limits.

Exit evidence: safe fixture imports pass and malicious/malformed archives are rejected without writing outside the isolated import area.

### Milestone 4 — Deterministic inventory and analysis

Implement file inventory, configurable exclusions, TypeScript/JavaScript and Python adapters first, lexical fallback, symbol extraction, import edges, route discovery, evidence/provenance records, and analysis reports. Add additional languages only after adapter-specific fixtures and tests exist.

Dependencies: immutable revision storage and background job states from Milestone 3.

Exit evidence: fixture repositories produce source-linked inventories, graph data, and correctly labeled parser fallbacks.

### Milestone 5 — Explorer and diagrams

Build the project overview, file/symbol search, source viewer rendered as inert text, architecture graph API, and accessible diagram explorer with filtering, source references, and large-graph limits.

Dependencies: Milestone 4 graph/report contracts and authorization checks.

Exit evidence: browser/API tests validate navigation, source links, empty/error states, and no active uploaded content execution.

### Milestone 6 — Grounded AI assistance

Add a provider-neutral model adapter, bounded retrieval, revision-bound context, answer/source-reference validation, rate-limit/error handling, and persisted conversations. Start with deterministic retrieval and feature-gate provider calls until a model provider is configured.

Dependencies: Milestone 4 indexes, Milestone 2 isolation, explicit model/provider configuration, and usage limits.

Exit evidence: answers cite valid current-revision evidence; stale and provider-failure tests pass.

### Milestone 7 — Findings, patch review, and controlled checks

Add deterministic diagnostics, dependency-aware plans, patch previews and conflict checks. Any test/build execution must run only in isolated workers with explicit approval, a command allowlist, budgets, timeouts, and audit records.

Dependencies: immutable revisions, audit log, durable workers, and a sandbox design that has been threat-modeled and tested.

Exit evidence: no repository code executes in the API process; denied/timeout/cancelled paths are tested.

### Milestone 8 — Docker and deployment readiness

Generate reviewable Docker configurations and local runbooks, validate them in isolated builds where Docker is available, then add provider-neutral deployment planning. Add a specific deployment adapter only after the provider, account, cost limits, and approval workflow are confirmed.

Dependencies: worker isolation, configuration/secrets management, and explicit deployment authorization.

Exit evidence: generated configuration is validated against fixtures; no deployment is reported successful without actual provider health verification.

### Milestone 9 — Production hardening

Complete observability, quotas, retention/deletion workflows, incident runbooks, accessibility testing, CI/CD staging, backup/recovery verification, and a feature matrix with verified versus unverified status.

Dependencies: stable implementations and real hosting choices from earlier milestones.

## Immediate next step

Begin Milestone 1 by selecting supported Node.js and Python versions, a package manager, and a local development database approach. Create only the minimal foundation needed to start and test the frontend and API; do not add an AI provider, source execution, cloud deployment, or Git-provider integration yet.

## Phase 0 verification record

- `Get-ChildItem -Force` and a recursive file count: workspace contains zero entries.
- `Test-Path .git`: false.
- `rg --files` excluding generated directories: no files returned.
- Read-only ZIP manifest inspection: external `code.zip` is unrelated to the target product and was not imported.

No build or test command was available to run, so no application behavior is verified.
