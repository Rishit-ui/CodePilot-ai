# Phase 6 Staging Test Report

Status date: 2026-11-14.

## Executed locally

| Command | Actual result | Interpretation |
|---|---|---|
| `npm run check` | PASS | All configured JavaScript syntax checks passed, including the Phase 6 preflight script |
| `npm test` | PASS: 83 passed, 0 failed, 5 skipped, 88 total | The 5 skipped tests are explicit real-provider gates: Queue, Blob, external AI, PostgreSQL, and Sandbox |
| `npm run preflight:staging` | PASS as a read-only audit; all providers reported BLOCKED | No values printed; credentials/gates absent, Vercel unlinked, queue consumer absent |
| `npm run test:e2e` | PASS: 22 passed, 0 failed | Local deterministic browser QA; not provider evidence |

The first sandboxed `npm test` attempt had 9 `connect EACCES 127.0.0.1` failures because the execution sandbox denied loopback fixture servers. The identical suite was rerun with scoped permission for localhost test servers and passed 83/83 executed tests. The denied run is not represented as a product failure or a pass.

## Real-provider test status

| Test area | Status | Evidence/reason |
|---|---|---|
| PostgreSQL connectivity, migrations, restart, concurrency, isolation | **BLOCKED** | `TEST_POSTGRES_URL` absent; no managed database provisioned |
| Queue publishing | **BLOCKED** | Test is implemented and gated; no identity/topic |
| Queue consumption, duplicate delivery, retry | **BLOCKED** | No deployed consumer entry point; local idempotency/retry unit tests pass but are not provider evidence |
| Private upload/download and SHA-256 | **BLOCKED** | Full gated provider test implemented; no staging Blob store/credential |
| OpenAI/Anthropic/Gemini generation | **BLOCKED** | Real transport path exists; no selected provider/model/key |
| Source citations | **PASS (local engine only)** | Browser/API tests verify repository grounding; no external AI provider claim |
| Sandbox creation/termination | **BLOCKED** | No linked Vercel project/identity |
| 20-scenario sandbox adversarial gate | **FAIL (implementation readiness)** | Credential-gated test deliberately fails because the actual provider harness is not implemented; execution must remain off |
| Full staging workflow with real persistence/providers | **BLOCKED** | Required resources and authorization unavailable |

## Workflow coverage that did run

The local fixture covers registration, login, project creation, ZIP import, analysis, architecture export, local grounded AI, Impact Engine/test selection, and patch review. It uses temporary SQLite, local deterministic AI, disabled Queue/Blob/Sandbox, and no GitHub network import. It therefore does **not** prove managed persistence, provider queues, private object storage, external AI, sandbox execution, or a deployed staging URL.

## Safety assertions

- `executionReleaseVerified=false` remains unchanged.
- Browser execution controls remain disabled.
- No provider test gate was enabled.
- No production or staging resource was created.
- No secret was printed or committed.
- No deployment, commit, or push occurred.

