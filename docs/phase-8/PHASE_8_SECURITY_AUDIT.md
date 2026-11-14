# Phase 8 Security Audit

Date: 2026-11-15

## Verified locally

- Central authentication rejects anonymous and invalid sessions on non-public API routes.
- The only public API routes are health, readiness, registration, and login.
- The central `/api/projects/:id` gate checks the authenticated user's project permission before endpoint database access.
- Job reads, lists, cancellations, and retries are actor-scoped; cross-tenant identifiers do not grant access.
- Queue consumption revalidates the stored actor, project access, revision ownership, topic, message ID, outbox envelope, and permitted job type before claiming work.
- Execution profiles are allowlisted; browser-supplied arbitrary commands are rejected.
- Repository paths reject absolute paths, traversal components, backslashes, NULs, and unsafe normalized paths.
- SSRF tests reject non-HTTP schemes, loopback, private addresses, and metadata targets.
- Rate limits and job quotas are independent of user-supplied limits.
- Production execution stays disabled because `EXECUTION_RELEASE_VERIFIED = false`.

## Vulnerabilities repaired

### Stranded cancellation and exhausted leases

`CANCEL_REQUESTED` jobs were not reconciled when a worker disappeared, and exhausted expired leases could remain `RUNNING`. Recovery now durably resolves these to `CANCELLED` and poisoned `FAILED` states respectively. Cancellation failure handling now accepts both `RUNNING` and `CANCEL_REQUESTED` leases.

### Persisted diagnostic secret exposure

Queue publication and worker error strings could be stored without the same redaction used for operational events. Diagnostic persistence now redacts bearer credentials, password/secret/token/authorization/API-key assignments, and sensitive query parameters before storage.

## Security regression evidence

Phase 8 adds tests for concurrent deliveries, interrupted publishing, worker loss, retry exhaustion, unauthorized cancellation, cross-tenant job access, diagnostic redaction, and safe operational metrics. Existing authentication, authorization, SSRF, path traversal, rate-limit, and execution-policy tests remain enabled.

## Blocked verification

Real microVM filesystem/process isolation, provider-enforced networking, host secret isolation, resource ceilings, concurrent-tenant Sandbox separation, privilege escalation resistance, and escape resistance are BLOCKED. No credentials or infrastructure were available, and local mocks are not evidence for these properties.

No production execution, infrastructure mutation, deployment, credential use, or external provider call occurred.
