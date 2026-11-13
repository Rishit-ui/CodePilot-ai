# Feature Implementation Matrix

Assessment date: 2026-11-13

| Capability | Status | Evidence / boundary |
| --- | --- | --- |
| Central API authentication | Implemented and tested | Public route allowlist plus anonymous/invalid/valid-session regression tests. |
| Project ownership and workspace RBAC | Implemented and tested | Owner migration, scoped listing, role permission checks, cross-user denial tests. |
| Nested resource isolation | Implemented and tested | Direct child identifiers must belong to the authorized URL project. |
| Audit isolation | Implemented and tested | Cross-user audit test verifies inaccessible project events are absent. |
| Production secret validation | Implemented and tested | Missing, weak, known placeholder, disabled-auth, and valid production configurations tested. |
| Session storage protection | Implemented and tested | Random bearer token returned once; only its HMAC identifier is persisted. |
| ZIP and remote import protections | Implemented and tested | Existing archive and SSRF suites remain passing. |
| Repository inventory and analysis | Implemented and tested | Existing analyzer, architecture, flow, and impact suites remain passing. |
| Test execution truthfulness | Implemented and tested | Real subprocesses map to `PASS`/`FAIL`; unexecuted serverless branches return `NOT_EXECUTED`. |
| Production Docker image | Implemented and tested | Real image build succeeded; container became healthy as non-root `codepilot`; health returned HTTP 200. |
| SQLite persistence | Implemented and tested | Local integration suite and healthy container use Node built-in SQLite. |
| PostgreSQL adapter | Implemented, incompletely verified | Schema and adapter exist; no live PostgreSQL service was exercised in Phase 1. |
| External CI result retrieval | Not implemented | No provider integration exists; endpoints report `NOT_EXECUTED`. |
| Untrusted test sandbox | Blocked | Requires isolated worker infrastructure. |
| Real cloud deployment | Blocked external configuration | No deployment was requested or executed in Phase 1. |
| Authentication rate limiting | Not implemented | Reverse-proxy protection is required until an application limiter is added. |

The previous serverless project “auto-healing” behavior was removed because accepting arbitrary project IDs created an authorization bypass and uncontrolled data creation.
