# Phase 5 Provider Compatibility Audit

Audit date: 2026-11-14. No provider credentials were present, no cloud resource was provisioned, and no deployment was attempted.

## Installed interfaces

| Component | Installed version | Source/API audit | Runtime result |
| --- | ---: | --- | --- |
| Vercel Sandbox | `@vercel/sandbox` 4.0.0 | `Sandbox.create`, `writeFiles`, `runCommand`, `stop`, and `delete` match installed declarations. `networkPolicy: 'deny-all'` is supported. | `BLOCKED` — no authorized account run. |
| Vercel Queues | `@vercel/queue` 0.11.0 | `send` and `handleCallback` match installed declarations. Callback auth is provider-managed; delivery is at least once. | `BLOCKED` — no topic/callback or credentials. |
| Vercel Blob | `@vercel/blob` 2.9.0 | Private `issueSignedToken`, `presignUrl`, `head`, `get`, and `del` are exported. Private storage needs SDK >=2.3. | `BLOCKED` — no private store/token/test object. |
| Vercel Functions | hosted service | Request/response payload limit is 4.5 MB; duration and memory depend on plan/configuration. Direct-to-Blob upload remains required for large ZIPs. | `NOT TESTED` — no staging deployment. |
| OpenAI-compatible | raw HTTPS | Chat Completions request/response is implemented; Responses API migration was not attempted in this phase. | Local protocol fixture `PASS`; real provider `BLOCKED`. |
| Anthropic | raw HTTPS | Messages request uses `x-api-key`, an explicit API version, system prompt, and messages. | Local protocol fixture `PASS`; real provider `BLOCKED`. |
| Gemini | raw HTTPS | `generateContent` remains supported but is now documented as legacy; Google recommends Interactions for new integrations. | Local protocol fixture `PASS`; real provider `BLOCKED`. |

## Current provider facts

- Vercel Queues is Beta, at-least-once, supports retention up to 24 hours and visibility leases up to 60 minutes. CodePilot explicitly uses a 90-second callback visibility timeout and bounded redelivery delays.
- Vercel Private Blob requires authenticated reads/writes. Browser uploads are authorized with short-lived scoped tokens; the server token is never returned.
- Vercel Blob pricing currently lists 1 GB/month Hobby inclusion, $0.023/GB-month on demand, and separately metered operations/transfer. No CodePilot usage estimate is claimed because no provider usage was measured.
- Vercel Sandbox pricing in `iad1` currently lists $0.128/active CPU hour and $0.0212/GB-hour provisioned memory on paid plans, with regional variation. No sandbox was created.
- Official Vercel pages conflict on the region count: the September 2026 changelog says all 20 compute regions, while the Sandbox pricing page says 19. Staging must verify the selected region in the target account.
- AI rate limits and model access are account/model specific. Production now requires an explicit model name, key, timeout, response ceiling, and bounded retry policy.

## Sources

- https://vercel.com/docs/sandbox
- https://vercel.com/docs/sandbox/pricing
- https://vercel.com/changelog/vercel-sandbox-is-now-available-in-all-regions
- https://vercel.com/docs/queues
- https://vercel.com/docs/queues/api
- https://vercel.com/docs/vercel-blob/private-storage
- https://vercel.com/docs/vercel-blob/usage-and-pricing
- https://vercel.com/docs/functions/limitations
- https://developers.openai.com/api/reference/resources/chat
- https://developers.openai.com/api/docs/guides/rate-limits
- https://platform.claude.com/docs/en/api/errors
- https://platform.claude.com/docs/en/api/rate-limits
- https://ai.google.dev/gemini-api/docs/interactions-overview
- https://ai.google.dev/gemini-api/docs/generate-content/api-errors

SDK declarations in the installed lockfile are the source of truth for code signatures; hosted documentation is the source for service behavior. Account-specific availability and pricing remain subject to verification before authorization.
