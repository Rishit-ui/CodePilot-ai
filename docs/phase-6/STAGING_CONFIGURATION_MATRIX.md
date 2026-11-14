# Phase 6 Staging Configuration Matrix

Status date: 2026-11-14. This matrix was derived from `src/config.js`, the provider adapters, the provider-gated tests, and Vercel SDK behavior. It contains names and placeholders only. No credential values were read or recorded.

## Application and security

| Variable | Purpose | Requirement | Secret | Scope | Source | Validation |
|---|---|---:|---:|---|---|---|
| `NODE_ENV` | Select production-strength startup validation | Required (`production`) | No | Staging and production | Deployment settings | Startup reports production mode |
| `VERCEL` | Vercel runtime marker, injected by Vercel | Automatic on Vercel | No | Staging and production | Vercel runtime | Runtime environment |
| `NEXT_PUBLIC_VERCEL_ENV` | Vercel environment label | Automatic on Vercel | No | Staging and production | Vercel runtime | Must be `preview` for staging policy |
| `CODEPILOT_HOST` | HTTP bind address | Optional | No | Both | Operator | Health probe |
| `CODEPILOT_PORT` | HTTP port | Optional | No | Both | Operator/runtime | Health probe |
| `CODEPILOT_DATA_DIR` | Local SQLite/data directory; not suitable for durable serverless staging | Optional locally | No | Local only | Operator | Restart persistence test |
| `CODEPILOT_SESSION_SECRET` | Session token hashing/signing secret | Required in production mode, at least 32 characters | Yes | Separate value per environment | Secret manager | Startup rejects missing/weak values; auth tests |
| `CODEPILOT_AUTH_ENABLED` | Server-side authentication switch | Required `true` in production mode | No | Both | Operator | Startup rejects disabled production auth |
| `CODEPILOT_RATE_LIMIT_ENABLED` | Distributed rate limiting | Required `true` in production mode | No | Both | Operator | Rate-limit regression tests |
| `CODEPILOT_TRUST_PROXY` | Honor proxy forwarding only behind trusted ingress | Required for Vercel ingress | No | Both | Operator | Proxy trust test |
| `CODEPILOT_TRUSTED_PROXY_HOPS` | Number of trusted proxy hops | Required when proxy trust is enabled | No | Both | Operator | Forwarded-IP test |
| `CODEPILOT_AUTH_FAILURE_MAX` | Failed-auth threshold | Optional bounded tuning | No | Both | Operator | Rate-limit test |
| `CODEPILOT_AUTH_FAILURE_WINDOW_MS` | Failed-auth time window | Optional bounded tuning | No | Both | Operator | Rate-limit test |

The rate policies also accept exact dynamic names `CODEPILOT_RATE_<POLICY>_SUBJECT_MAX`, `CODEPILOT_RATE_<POLICY>_IP_MAX`, and `CODEPILOT_RATE_<POLICY>_WINDOW_MS`, where `<POLICY>` is one of `REGISTRATION`, `LOGIN`, `AI`, `IMPORT`, `ANALYSIS`, `PATCH`, `EXECUTION`, or `DEPLOYMENT`. They are optional, non-secret, environment-scoped tuning values and are validated by bounded parsing plus rate-limit tests.

## PostgreSQL

| Variable | Purpose | Requirement | Secret | Scope | Source | Validation |
|---|---|---:|---:|---|---|---|
| `DATABASE_URL` | Primary PostgreSQL connection URL | Required for durable staging; preferred name | Yes | Staging-only credential | Managed PostgreSQL dashboard | `TEST_POSTGRES_URL` lifecycle/migration/isolation suite |
| `POSTGRES_URL` | Fallback PostgreSQL URL | Optional alternative | Yes | Staging-only credential | Managed PostgreSQL dashboard | Same suite |
| `POSTGRES_PRISMA_URL` | Additional accepted fallback URL | Optional alternative | Yes | Staging-only credential | Managed PostgreSQL dashboard | Startup adapter selection |
| `CODEPILOT_DB_SSL_MODE` | TLS verification mode | Required `verify-full` for managed staging | No | Both | Operator/provider requirements | TLS connection and hostname validation |
| `CODEPILOT_DB_POOL_MAX` | Pool size | Optional | No | Both | Capacity plan | Concurrency suite and provider metrics |
| `CODEPILOT_DB_CONNECTION_TIMEOUT_MS` | Connection timeout | Optional | No | Both | Operator | Unavailable-database failure test |
| `CODEPILOT_DB_QUERY_TIMEOUT_MS` | Query timeout | Optional | No | Both | Operator | Slow-query failure test |
| `TEST_POSTGRES_URL` | Opt-in real integration-test connection | Required only for authorized test | Yes | Staging test only | Dedicated ephemeral/test database | Enables `tests/postgres.integration.test.js` |
| `TEST_POSTGRES_SSL_MODE` | Test connection TLS mode | Optional; use `verify-full` for managed DB | No | Staging test only | Operator | Integration test connection |

## Vercel Queue, Blob, and Sandbox

| Variable | Purpose | Requirement | Secret | Scope | Source | Validation |
|---|---|---:|---:|---|---|---|
| `CODEPILOT_QUEUE_PROVIDER` | Enables queue adapter | Required `vercel-queues` for staging | No | Both | Operator | Readiness plus gated queue test |
| `CODEPILOT_QUEUE_TOPIC` | Durable job topic | Required | No | Separate staging topic | Operator/Vercel Queue | Publish and consume test |
| `CODEPILOT_QUEUE_REGION` | Queue region | Optional; default `iad1` | No | Both | Vercel supported-region selection | Publish/consume in chosen region |
| `VERCEL_OIDC_TOKEN` | Short-lived Vercel SDK authentication | Automatic in linked deployments; required for local provider calls unless another SDK-supported credential is supplied | Yes | Staging-only identity | Vercel project OIDC injection | Real SDK calls; never log |
| `CODEPILOT_STORAGE_PROVIDER` | Enables private Blob adapter | Required `vercel-blob` for staging | No | Both | Operator | Readiness plus gated Blob test |
| `BLOB_READ_WRITE_TOKEN` | Blob store credential used by current adapter/test | Required when OIDC/store binding is not supplying access | Yes | Staging store only | Vercel Blob store connection | Upload/hash/download/delete test |
| `BLOB_STORE_ID` | Blob store identifier for OIDC binding | Required for OIDC store access | No | Staging store only | Vercel Blob dashboard | Blob SDK call |
| `CODEPILOT_STORAGE_MAX_OBJECT_BYTES` | Object size ceiling | Optional bounded tuning | No | Both | Operator | Oversize authorization rejection |
| `CODEPILOT_UPLOAD_TTL_MS` | Upload authorization lifetime | Optional bounded tuning | No | Both | Operator | Expiry cleanup tests |
| `CODEPILOT_ARTIFACT_RETENTION_DAYS` | Artifact retention | Optional bounded tuning | No | Both | Operator | Retention cleanup tests |
| `CODEPILOT_EXECUTION_MODE` | Execution master switch | Required `disabled` in staging until gate passes | No | Both | Operator | Startup/config and browser assertions |
| `CODEPILOT_WORKER_PROVIDER` | Sandbox adapter selector | Keep `disabled`; later `vercel-sandbox` only for authorized tests | No | Staging test | Operator | Startup and gated adversarial test |
| `CODEPILOT_WORKER_URL` | External worker endpoint if remote-worker mode is used | Optional/not used by Vercel Sandbox adapter | No | Environment-specific | Worker deployment | Authenticated health and job test |
| `CODEPILOT_WORKER_TOKEN` | External worker bearer secret | Required only with external worker URL | Yes | Separate staging secret | Secret manager | Rejected invalid token; never log |
| `CODEPILOT_WORKER_TIMEOUT_MS` | Sandbox lifetime | Optional bounded tuning | No | Both | Operator | Timeout scenario |
| `CODEPILOT_WORKER_COMMAND_TIMEOUT_MS` | Command deadline | Optional bounded tuning | No | Both | Operator | Infinite-loop/timeout scenario |
| `CODEPILOT_WORKER_OUTPUT_BYTES` | Captured output ceiling | Optional bounded tuning | No | Both | Operator | Output truncation test |
| `CODEPILOT_WORKER_VCPUS` | Sandbox CPU request | Optional bounded tuning | No | Staging test | Cost/capacity plan | Sandbox resource metadata |
| `TEST_VERCEL_QUEUE` | Explicit real Queue test gate | Optional; set `1` only for authorized run | No | Staging test | Operator | Enables provider test |
| `TEST_VERCEL_BLOB` | Explicit real Blob test gate | Optional; set `1` only for authorized run | No | Staging test | Operator | Enables provider test |
| `TEST_VERCEL_SANDBOX` | Explicit real Sandbox test gate | Optional; set `1` only for authorized run | No | Staging test | Operator | Enables provider adversarial test |

Vercel also injects `VERCEL_REGION` and `VERCEL_DEPLOYMENT_ID`; these are non-secret runtime metadata, not operator requirements. The current code does not consume either directly.

## AI providers

| Variable | Purpose | Requirement | Secret | Scope | Source | Validation |
|---|---|---:|---:|---|---|---|
| `CODEPILOT_AI_PROVIDER` | Selects `local`, `openai`, `anthropic`, or `gemini` | Required | No | Both | Operator | Startup provider validation |
| `CODEPILOT_AI_API_KEY` | Provider-neutral key consumed by application config | Required for external provider | Yes | Staging-only key | Selected AI provider dashboard | Gated real generation test |
| `CODEPILOT_AI_MODEL` | Exact selected model ID | Required for external provider in production mode | No | Environment-specific | Provider model catalog | Real request returns model output |
| `CODEPILOT_AI_BASE_URL` | Optional compatible/custom API endpoint | Optional | No unless URL embeds credentials (prohibited) | Environment-specific | Provider docs | HTTPS allowlist and real request |
| `CODEPILOT_AI_TIMEOUT_MS` | Request deadline | Optional | No | Both | Operator | Timeout transport test |
| `CODEPILOT_AI_MAX_RETRIES` | Retry ceiling | Optional | No | Both | Operator | Retry transport test |
| `CODEPILOT_AI_MAX_RESPONSE_BYTES` | Response ceiling | Optional | No | Both | Operator | Bounded-response test |
| `OPENAI_API_KEY` | Accepted by the provider-gated test as an OpenAI key source | Optional alternative for test | Yes | Staging test | OpenAI project API keys | Real OpenAI request |
| `ANTHROPIC_API_KEY` | Accepted by the provider-gated test | Optional alternative for test | Yes | Staging test | Anthropic Console | Real Anthropic request |
| `GEMINI_API_KEY` | Accepted by the provider-gated test | Optional alternative for test | Yes | Staging test | Google AI Studio/Cloud project | Real Gemini request |
| `GOOGLE_API_KEY` | Accepted Gemini key alias in the provider-gated test | Optional alternative for test | Yes | Staging test | Google Cloud/AI Studio | Real Gemini request |
| `TEST_EXTERNAL_AI` | Explicit real AI test gate | Optional; set `1` only for authorized run | No | Staging test | Operator | Enables provider test |

## Limits, quotas, and deployment adapters

The following exact names are optional, non-secret, and environment-scoped: `CODEPILOT_JOBS_PER_USER_HOUR`, `CODEPILOT_CONCURRENT_JOBS_PER_USER`, `CODEPILOT_STORAGE_BYTES_PER_USER`, `CODEPILOT_MAX_UPLOAD_BYTES`, `CODEPILOT_MAX_REMOTE_BYTES`, `CODEPILOT_MAX_EXTRACTED_BYTES`, `CODEPILOT_MAX_FILES`, `CODEPILOT_MAX_FILE_BYTES`, `CODEPILOT_MAX_COMPRESSION_RATIO`, and `CODEPILOT_CMD_TIMEOUT_MS`. Validate them with boundary tests and staged quota/size failures.

`RENDER_API_KEY`, `VERCEL_TOKEN`, and `FLY_API_TOKEN` are secret deployment-adapter credentials. They are not required for this staging validation and must remain absent because Phase 6 does not authorize deployment or provisioning. If used later, obtain them from the corresponding provider dashboard and scope them to a non-production project.

## Safe activation order

1. Create dedicated staging resources and identities; do not copy production values.
2. Configure secrets in the provider dashboard, never in Git or chat.
3. run `npm run preflight:staging`; it reports presence booleans only.
4. Keep `CODEPILOT_EXECUTION_MODE=disabled` and the compiled release gate false.
5. Enable one `TEST_*` gate at a time for an explicitly authorized, cost-bounded run.

