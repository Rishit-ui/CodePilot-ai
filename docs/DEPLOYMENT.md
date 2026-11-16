# Deployment

## Release sequence

1. Reconcile the intended Git commit with the staging deployment metadata.
2. Run every gate in `docs/TESTING.md`.
3. Deploy the immutable candidate to staging with a staging-only PostgreSQL database and session secret.
4. Verify registration, login, project ownership, imports, analysis, AI grounding, patches, rate limiting, audit history, health, readiness, and persistence.
5. Promote the exact verified commit to production only when all mandatory gates pass and a rollback point exists.

The execution feature is a separate release surface. Keep `CODEPILOT_EXECUTION_MODE=disabled`, `CODEPILOT_WORKER_PROVIDER=disabled`, and the source-controlled `executionReleaseVerified` gate false until a real isolated-worker adversarial campaign passes. Platform analysis functionality may be released while execution remains disabled.

## Mandatory production configuration

Use a managed PostgreSQL URL with TLS verification, a unique 32+ character session secret, server-side authentication, distributed rate limiting, and exact proxy trust. Never reuse staging credentials. Provider keys are optional and must be stored in the platform secret manager. Deployments must fail closed when mandatory values are missing.

No deployment is successful until the deployed `/api/health` and `/api/ready` endpoints, authenticated browser flows, persistence, and logs are checked against the intended commit.
