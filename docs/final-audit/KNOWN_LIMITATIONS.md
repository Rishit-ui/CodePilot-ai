# Known Limitations

Updated: 2026-11-13

- Registration and login have no in-process rate limiter. Public deployments need a trusted gateway policy or an application implementation.
- Test runners execute approved commands as subprocesses of the application account. They are not safe for mutually untrusted tenants until moved to isolated workers with CPU, memory, time, network, and filesystem controls.
- Serverless environments do not execute repository tests. They return `NOT_EXECUTED`; no external CI provider is integrated.
- PostgreSQL support was inspected and migrated for `owner_id`, but Phase 1 did not exercise a live PostgreSQL database. SQLite was tested locally and in the production container.
- Development may explicitly set `CODEPILOT_AUTH_ENABLED=false`. Production rejects that setting. Development bypass mode must stay bound to a trusted local environment.
- Existing pre-repair sessions are invalidated by HMAC-at-rest token storage and require login again.
- Static analysis remains strongest for JavaScript/TypeScript. Python uses lexical patterns; other languages receive shallower analysis.
- Dynamic imports, runtime reflection, generated code, and runtime-only call relationships can remain unresolved.
- Real cloud deployments and external LLM calls require provider credentials and were not executed during Phase 1.
