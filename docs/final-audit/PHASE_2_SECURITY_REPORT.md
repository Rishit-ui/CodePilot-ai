# Phase 2 Security Report

Date: 2026-11-13

## Distributed abuse controls — `PASS`

`src/rate_limit.js` applies database-backed, atomic fixed-window limits to registration, login, AI, imports/ZIP processing, analysis, patch operations, execution, and deployment. Each policy has a user/subject bucket and a higher shared-IP bucket. Thresholds and windows are environment-configurable. Exhaustion returns HTTP 429 and `Retry-After`; production returns 503 if the shared store fails.

Forwarded client IPs are ignored unless proxy trust is explicit. `CODEPILOT_TRUSTED_PROXY_HOPS` selects the trusted hop rather than accepting arbitrary `X-Forwarded-For`. Repeated login failures use a redacted account/IP-derived bucket and emit `security.authentication_failed` / `security.rate_limited` audit events without credentials.

Verification includes concurrent access through two SQLite Store instances, fail-closed behavior, trusted-proxy parsing, real PostgreSQL concurrency across two pools, and an HTTP authentication-abuse test. The PostgreSQL race allowed exactly 12 of 24 concurrent requests.

## Untrusted execution — production `PASS` by disablement; worker `BLOCKED`

Production rejects `CODEPILOT_EXECUTION_MODE=local-development`. The documented production/Compose mode is `disabled`. Test endpoints return `BLOCKED`, `executed: false`, null exit code, and null duration; they never invoke imported code or report fabricated success.

An `external-worker` mode persists jobs with project/actor ownership, attempts, maximum attempts, exponential retry availability, cancellation state, leases, failure text, and audit events. It does not claim to provide a sandbox. No secure gVisor, microVM, or hardened ephemeral-container worker was available in this environment, so host-file, secret, fork-bomb, memory, egress, filesystem, timeout, and cleanup attack tests are `NOT TESTED`. Public untrusted execution must remain disabled until that boundary is built and independently tested.

## Sensitive data

Operational event details redact password/secret/token/authorization fields and are length-bounded. API error logging includes a request ID and bounded error message, not request bodies, cookies, credentials, source archives, or session tokens.
