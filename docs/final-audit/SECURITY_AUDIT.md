# CodePilot AI Security Audit

Audit date: 2026-11-13

Phase: 1 critical repair

Status: repaired and locally verified; public deployment remains out of scope

## Repaired findings

| Finding | Previous behavior | Repair | Verification |
| --- | --- | --- | --- |
| Missing route authentication | Most API routes accepted anonymous requests when authentication was disabled by default. | A central gate now allows only health, readiness, registration, and login without a session. Production forces authentication on. | `tests/security_repair.test.js`, `tests/vercel.test.js` |
| Missing tenant authorization | Project lists were global and project routes did not enforce ownership. Child IDs could be addressed independently. | Projects have an `owner_id`; workspace membership supplies RBAC; every `/api/projects/:id` route is authorized before dispatch; child resource IDs are bound to the URL project. | Cross-user list/read/delete/audit tests pass. |
| Global audit and database exposure | `/api/audit` returned all events; Database Studio queried the platform database for ordinary users. | Audit events are filtered to accessible projects. Platform database schema/query routes require a global administrator when auth is enabled. | `tests/security_repair.test.js`; route inspection. |
| Weak production secret handling | Vercel could receive a committed known secret and production auth could be disabled. | Production requires an explicit secret of at least 32 characters, rejects known placeholders, and rejects disabled auth. Development uses an unpredictable process-local secret if omitted. Session tokens are HMAC-hashed at rest. | `tests/config.test.js`. |
| Fabricated test success | Both serverless test endpoints returned hard-coded success, exit code 0, and invented durations. | Test states are `PASS`, `FAIL`, `NOT_EXECUTED`, `BLOCKED`, or `PENDING`. Serverless returns `NOT_EXECUTED` with null exit code/duration unless a real runner result exists. | `tests/security_repair.test.js`, `tests/impact_selection.test.js`. |

## Role policy

| Role | Read | Create/update/import/analyze/patch/test | Deploy | Delete project | Admin membership |
| --- | --- | --- | --- | --- | --- |
| Owner | Yes | Yes | Yes | Yes | Yes |
| Admin | Yes | Yes | Yes | No | Yes |
| Editor | Yes | Yes | No | No | No |
| Viewer | Yes | No | No | No | No |

Global administrators can access all projects and the platform Database Studio. An inaccessible project returns `404` to avoid confirming another tenant's identifiers.

## Remaining risks

- Authentication endpoints do not yet have an application-level rate limiter. Production must add one or enforce equivalent controls at a trusted reverse proxy.
- Test subprocesses run with a reduced environment and allowlist but still share the host kernel and filesystem permissions. Untrusted execution requires a separate sandbox worker or microVM before multi-tenant production use.
- Existing sessions created before this repair are invalid because persisted session identifiers are now HMAC hashes. Users must log in again; user/project data is retained.
- PostgreSQL ownership migration is an idempotent startup `ALTER TABLE`. Back up production data and run the migration in staging before rollout.

No secrets were added to source control, logs, or documentation.
