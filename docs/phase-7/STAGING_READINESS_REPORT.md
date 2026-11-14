# Phase 7 Staging Readiness Report

Date: 2026-11-14

## Decision

Code-level staging preparation with execution disabled is **GO**. Provisioning or deploying a real staging environment is **NO-GO/BLOCKED** until explicitly authorized. Production and untrusted execution are **NO-GO**.

## Audit matrix

| Area | Current evidence | Status |
|---|---|---|
| Environment matrix | Phase 6 matrix remains valid; Phase 7 adds `TEST_SANDBOX_DESTRUCTIVE`, `TEST_ADVERSARIAL_DB_HOST`, and `TEST_ADVERSARIAL_DB_PORT` placeholders | **PASS locally** |
| Queue consumer route | `api/queue-consumer.js`, Node callback factory, separate production/staging triggers | **PASS locally; provider BLOCKED** |
| Queue authentication | Vercel internal trigger + SDK OIDC contract; DB authorization rechecked | **PASS by contract; provider claim NOT TESTED** |
| Private Blob authorization | Private signed put/get, size and SHA-256 verification, cleanup | **PASS locally; provider BLOCKED** |
| AI configuration | External provider requires explicit key and model in production mode; timeouts/retries bounded | **PASS locally; provider BLOCKED** |
| PostgreSQL | Pool, migrations, TLS modes, ownership, outbox, leases; managed integration gate absent | **PASS locally; managed provider BLOCKED** |
| Sandbox | Deny-all, non-persistent, no ports, finite lifetime; 20-fixture harness ready | **PASS implementation; real security BLOCKED** |
| Vercel rewrites | Public API remains routed to authenticated `api/index.js`; Queue function registered directly as an internal trigger | **PASS locally** |
| Function runtime | Node engine `>=24`; API functions 30 seconds; consumer 300 seconds | **PASS configuration; plan compatibility BLOCKED** |
| Job lifecycle | Transactional outbox, publication reconciliation, claim lease, ownership, cancellation, timeout, poison, duplicate handling, audits | **PASS locally** |
| Health/readiness | Database is probed; Queue/Blob/AI remain `configured-not-probed`, not falsely healthy | **PASS locally** |
| Deployment permissions | No deployment credential is configured or required by this phase | **PASS by absence** |

## Independent staging resources

Real staging must use a separate Vercel project, PostgreSQL database/role, Queue topic (`codepilot-staging-jobs`), private Blob store, Sandbox identity/budget, AI project/key, session secret, and domains. No production credentials, data, topics, stores, or domains may be reused.

The checked `.env.staging.example` contains placeholders only. `npm run preflight:staging` reports presence booleans and resolved SDK versions without values. Current result: consumer entry point detected; Vercel project link absent; PostgreSQL, Queue, Blob, Sandbox, and external AI remain BLOCKED.

## Activation order

1. Review these changes and approve a staging-only cost ceiling.
2. Create the isolated Vercel project and managed PostgreSQL database.
3. Configure secrets only in provider-managed secret storage.
4. Validate Node runtime, plan duration, region, Queue Beta access, and Sandbox eligibility.
5. Run PostgreSQL and Blob gates first.
6. Deploy the Queue consumer and test real callback authentication, duplicate delivery, retries, poison acknowledgment, and state reconciliation.
7. Run external AI tests with a selected model and budget.
8. Run all 20 Sandbox scenarios, including separately authorized destructive cases.
9. Keep `CODEPILOT_EXECUTION_MODE=disabled` and `executionReleaseVerified=false`; a passing campaign does not automatically alter either.

No resource was provisioned and no deployment was attempted.

