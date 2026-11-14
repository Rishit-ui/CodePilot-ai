# Phase 6 Provider Integration Report

Status date: 2026-11-14. No provider resources were created, no provider API was called, no deployment occurred, and no secrets were displayed.

## Implementation audit

| Provider | Implementation found | Mock/simulation boundary | Phase 6 status |
|---|---|---|---|
| Vercel Sandbox | `src/execution/vercel_sandbox_provider.js` calls `Sandbox.create`, writes files, runs an allowlisted profile, captures actual output, and stops/deletes the ephemeral sandbox with deny-all networking | Unit tests use a fake provider; the real adversarial test is credential-gated and currently declares its harness incomplete | **BLOCKED** |
| Vercel Queue | `src/queue/vercel_queue.js` calls the Queue SDK `send` with an idempotency key; `src/queue/consumer.js` can wrap a consumer | Local tests inject a fake publisher. No deployed queue consumer entry point is wired, so publish-to-consume/retry cannot be verified end to end | **BLOCKED** |
| Private Vercel Blob | `src/storage/vercel_blob.js` issues signed private put/get URLs, verifies actual bytes with SHA-256, and deletes objects | Local storage tests use a fake storage object. The real provider test now performs upload, verification, download, byte equality, and cleanup behind `TEST_VERCEL_BLOB=1` | **BLOCKED** |
| OpenAI | `src/ai_provider.js` sends real HTTPS requests and validates response shape, retry, timeout, and size behavior | Transport tests use local fixture HTTP responses; provider connectivity is gated | **BLOCKED** |
| Anthropic | Same real transport module with Anthropic request/response mapping | Local fixture transport only | **BLOCKED** |
| Gemini | Same real transport module with Gemini `generateContent` mapping | Local fixture transport only | **BLOCKED** |
| PostgreSQL | `src/db.js` uses `pg.Pool`, migrations 1–5, transactions, ownership filters, outbox, leases, and distributed limits | Default local tests use SQLite. The real lifecycle suite is gated by `TEST_POSTGRES_URL` | **BLOCKED** |

`executionReleaseVerified` remains compiled as `false`. Configuration alone cannot turn execution on.

## Pre-flight result

`npm run preflight:staging` completed and revealed only booleans, never values:

- no Vercel project link (`.vercel/project.json`) is present;
- no Vercel CLI is installed in the repository;
- all real-provider test gates are off;
- database, Vercel, Blob, AI, and worker credentials are absent;
- the queue consumer entry point is absent;
- installed SDKs are `@vercel/sandbox` 4.0.0, `@vercel/queue` 0.11.0, `@vercel/blob` 2.9.0, and `pg` 8.23.1 (resolved versions from the lockfile).

Account access, plan eligibility, quota state, and existing resource inventory are **NOT TESTED** because authenticated provider access was unavailable and the user did not authorize provisioning.

## Current official service facts and cost envelope

- [Vercel Queues](https://vercel.com/docs/queues) is documented as Beta and at-least-once delivery. [Queue pricing](https://vercel.com/docs/queues/pricing) meters operations. Budget for duplicate deliveries and idempotent consumers.
- [Vercel Blob usage and pricing](https://vercel.com/docs/vercel-blob/usage-and-pricing) lists Hobby allowances of 1 GB storage, 10,000 simple operations, 2,000 advanced operations, and 10 GB transfer per month; on-demand rates shown are $0.023/GB-month, $0.40/million simple operations, $5/million advanced operations, and $0.05/GB transfer. [Private Blob delivery](https://vercel.com/docs/vercel-blob/private-storage) also traverses authenticated delivery paths.
- [Vercel Sandbox pricing](https://vercel.com/docs/sandbox/pricing) lists a Hobby allowance of 5 active CPU hours, 420 GB-hours, 5,000 creations, and 20 GB transfer. The page shows Pro `iad1` starting rates of $0.128/active CPU-hour, $0.0212/provisioned GB-hour, $0.60/million creations, and $0.15/GB transfer. Region availability must be confirmed in the intended account because current Vercel pages have not been provider-account verified here.
- [Vercel Functions pricing](https://vercel.com/docs/functions/usage-and-pricing) must be included for API, private delivery, and queue consumer execution; the current page shows `iad1` active CPU at $0.128/hour and memory at $0.0106/GB-hour.
- [Neon pricing](https://neon.com/pricing) is one viable managed PostgreSQL option, not a selection made by this audit. The current page lists Free at $0 with 100 CU-hours/project/month and 1 GB/project, and Launch usage at $0.106/CU-hour plus $0.35/GB-month. Verify limits, region, backups, and acceptable-use constraints before choosing it.
- AI spend is model- and token-dependent. Consult the selected provider immediately before authorization: [OpenAI API pricing](https://platform.openai.com/pricing/), [Anthropic API pricing](https://platform.claude.com/docs/en/about-claude/pricing), and [Gemini API pricing](https://ai.google.dev/gemini-api/docs/pricing). No model was selected and no token-cost estimate is asserted here.

## Proposed staging resources (not created)

| Resource | Isolation requirement | Minimum validation | State |
|---|---|---|---|
| Vercel project | New project/environment; no production domains or secrets | Preview URL, headers, auth, health | Not provisioned |
| Managed PostgreSQL | New database/role, TLS verify-full, least privilege | migrations, restart persistence, concurrency, tenant isolation | Not provisioned |
| Queue | Staging-only topic and consumer group | publish, consume, duplicate, retry, poison envelope | Not provisioned; consumer entry point must be implemented first |
| Blob | Private staging-only store | signed upload/download, SHA-256, ownership, cleanup | Not provisioned |
| Sandbox | Staging identity, deny-all network, strict spend cap | all 20 adversarial scenarios | Not provisioned; harness incomplete |
| AI | Separate project/key with hard budget and selected model | real grounded generation, citations, error redaction | Not provisioned |

## Required authorization boundary

Before any real run, the owner must explicitly authorize provider access and any possible spend, create or approve isolated staging resources, configure secrets in provider-managed secret storage, and select one AI provider/model. Production credentials are not acceptable.

