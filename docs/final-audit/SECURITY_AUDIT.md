# CodePilot AI Security Audit

Updated: 2026-11-13 (Phase 2)

## Current controls

| Control | Status | Evidence |
| --- | --- | --- |
| Central route authentication | `PASS` | Anonymous/invalid session regressions and Vercel rewrite tests. |
| Project/nested-resource authorization | `PASS` | Owner/workspace RBAC and cross-user read/write/audit tests. |
| Production secrets | `PASS` | Missing, weak, placeholder, and auth-disabled configurations fail startup. |
| Distributed abuse prevention | `PASS` | PostgreSQL atomic buckets, user/IP policies, trusted proxy handling, Retry-After, fail-closed production behavior. |
| Truthful test results | `PASS` | Unexecuted production/serverless tests return `BLOCKED`, never `PASS`. |
| Durable production database | `PASS` | Actual PostgreSQL lifecycle and restart test. |
| Untrusted execution | `PASS` only because disabled in production | No sandbox claim; external worker implementation is `BLOCKED`. |

The rate limiter protects registration/login/session creation, failed authentication, AI, import/ZIP, analysis, patch, test execution, and deployment routes. Higher IP limits reduce shared-network lockout while subject buckets constrain individual accounts. Security events omit credentials and raw account identifiers.

Production execution is fail-safe: `local-development` mode is rejected and Compose selects `disabled`. No Docker socket, production secret, or database credential is passed to untrusted code because no such code is launched. This is not evidence of a secure worker; isolation attack tests remain `NOT TESTED`.

## Residual security risks

- A hardened ephemeral worker (gVisor/microVM or equivalent), default-deny egress, resource quotas, read-only filesystem, cleanup, and adversarial tests do not yet exist.
- Proxy trust must match the real load-balancer hop topology; a wrong hop count can identify the proxy rather than the client.
- Provider-specific PostgreSQL TLS CA and connection-proxy behavior require staging verification.
- Development can deliberately disable auth or run local subprocesses. Keep it bound to a trusted workstation.

No secret was added to tracked files or reports.
