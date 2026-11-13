# Feature Implementation Matrix

Assessment date: 2026-11-14

| Capability | Status | Evidence / boundary |
| --- | --- | --- |
| Central API authentication | Implemented and tested | Public route allowlist plus anonymous/invalid/valid-session regression tests. |
| Project ownership and workspace RBAC | Implemented and tested | Owner migration, scoped listing, role permission checks, cross-user denial tests. |
| Nested resource isolation | Implemented and tested | Direct child identifiers must belong to the authorized URL project. |
| Audit isolation | Implemented and tested | Cross-user audit test verifies inaccessible project events are absent. |
| Production secret validation | Implemented and tested | Missing, weak, known placeholder, disabled-auth, and valid production configurations tested. |
| Session storage protection | Implemented and tested | Random bearer token returned once; only its HMAC identifier is persisted. |
| ZIP and remote import protections | Implemented and tested | Existing archive and SSRF suites remain passing. |
| Repository inventory and analysis | Implemented and tested locally | Per-file SHA-256, processed/partial/unsupported/excluded reporting, ZIP edge cases and persistent revisions tested. |
| JavaScript/TypeScript analysis | Implemented and tested | Babel AST for ESM, CommonJS, dynamic imports, symbols, TypeScript syntax, routes and lines. |
| Python analysis | Implemented and tested | Lezer syntax tree for definitions, imports, decorators/routes, calls, lines and recovery diagnostics. |
| Other recognized languages | Inventory only or limited rules | Extension recognition is not represented as AST/semantic support. |
| Impact Engine | Implemented; synthetic validation only | Nine controlled scenarios; four strategies; raw results retained. Independent real-repository accuracy remains unverified. |
| Patch workflow | Implemented and tested locally | Target validation, unified diff preview, atomic apply/rollback, revision-conflict protection and audit events. |
| Browser authentication/workspaces | Implemented and tested locally | Playwright/Edge registration, session, import, 14 workspaces, responsive layout and zero final-run console errors. |
| Test execution truthfulness | Implemented and tested | Real subprocesses map to `PASS`/`FAIL`; unexecuted serverless branches return `NOT_EXECUTED`. |
| Production Docker image | Implemented and tested | Real image build succeeded; container became healthy as non-root `codepilot`; health returned HTTP 200. |
| SQLite persistence | Implemented and tested | Local integration suite and healthy container use Node built-in SQLite. |
| PostgreSQL adapter | Implemented and locally verified | PostgreSQL 17 lifecycle/restart/concurrency evidence from Phase 3; managed-provider behavior remains untested. |
| External CI result retrieval | Not implemented | No provider integration exists; endpoints report `NOT_EXECUTED`. |
| Untrusted test sandbox | Blocked | Requires isolated worker infrastructure. |
| Real cloud deployment | Blocked external configuration | No deployment was requested or executed in Phase 1. |
| Authentication rate limiting | Implemented and tested | Shared database buckets, forwarded-IP trust boundary and repeated-login abuse tests. |

The previous serverless project “auto-healing” behavior was removed because accepting arbitrary project IDs created an authorization bypass and uncontrolled data creation.
