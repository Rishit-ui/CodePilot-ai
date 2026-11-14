# Phase 7 Sandbox Adversarial Harness

Date: 2026-11-14

## Verdict

The 20-scenario harness implementation blocker is closed. Real Sandbox security is still **BLOCKED**: no authorized Vercel Sandbox was created and no provider-specific attack was executed. The release gate remains false.

Reusable components:

- `src/execution/adversarial_harness.js` defines the canonical scenarios, status model, evidence redaction, local checks, aggregation, and release eligibility.
- `tests/providers/vercel_sandbox_adversarial_adapter.js` implements genuine Vercel fixtures using `Sandbox.create`, deny-all networking, non-persistence, no ports, bounded commands, stop, and delete.
- `tests/worker_adversarial.provider.test.js` validates harness completeness locally and runs the real adapter only with `TEST_VERCEL_SANDBOX=1`.
- process, memory, and disk exhaustion additionally require `TEST_SANDBOX_DESTRUCTIVE=1` and an approved cost/risk window.

The harness can declare release eligibility only when all 20 results are `PASS`. `BLOCKED`, `NOT TESTED`, or `FAIL` results keep it false. Current local aggregate: **1 PASS, 19 BLOCKED, 0 FAIL, 0 NOT TESTED**.

## Scenario register

| # | Threat | Attack fixture | Expected result | Actual result and evidence | Provider dependency | Status |
|---:|---|---|---|---|---|---|
| 1 | Host filesystem access | Probe host mount paths and mount metadata | No host filesystem/bind mount visible | Provider call not attempted | Real microVM | **BLOCKED** |
| 2 | Environment-secret access | Enumerate environment names and compare values to a host-only canary hash | No host secrets/canary visible | Provider call not attempted; fixture never prints values | Real environment boundary | **BLOCKED** |
| 3 | Database access | TCP connection to a non-secret staging DB host without credentials | Denied by network policy | Provider call not attempted; DB host absent | Real Sandbox and test DB host | **BLOCKED** |
| 4 | Cloud metadata access | Requests to link-local metadata endpoints | Denied | Provider call not attempted | Real network enforcement | **BLOCKED** |
| 5 | Private network access | TCP probes to representative RFC1918 addresses | All denied | Provider call not attempted | Real network enforcement | **BLOCKED** |
| 6 | Unrestricted outbound HTTP | HTTP/HTTPS public requests | All denied under deny-all | Provider call not attempted | Real network enforcement | **BLOCKED** |
| 7 | DNS exfiltration | Public A-record resolution | DNS denied | Provider call not attempted | Real DNS enforcement | **BLOCKED** |
| 8 | Path traversal | Parent, absolute, drive-qualified, nested-parent, and NUL paths | Rejected before upload | 5/5 rejected locally. The test found and repaired acceptance of `C:/...` paths | Adapter validation | **PASS** |
| 9 | Symlink escape | Links toward common host-mount paths | No host target reachable | Provider call not attempted | Real filesystem boundary | **BLOCKED** |
| 10 | Process exhaustion | High bounded child-process fan-out | Contained; cleanup destroys children | Destructive run not authorized | Real Sandbox plus destructive gate | **BLOCKED** |
| 11 | Memory exhaustion | Commit memory until rejection/termination | Guest-contained failure and cleanup | Destructive run not authorized | Real Sandbox plus destructive gate | **BLOCKED** |
| 12 | Disk exhaustion | Write until provider disk ceiling | ENOSPC/termination confined; disk deleted | Destructive run not authorized | Real Sandbox plus destructive gate | **BLOCKED** |
| 13 | Output flooding | Emit three times the configured capture ceiling | Real byte count; output truncated | Provider call not attempted | Real command output | **BLOCKED** |
| 14 | Infinite execution | Non-yielding loop with short command timeout | Killed; never reported PASS | Provider call not attempted | Real command timeout | **BLOCKED** |
| 15 | Timeout enforcement | Command longer than Sandbox lifetime | Session stopped | Provider call not attempted | Real session lifetime | **BLOCKED** |
| 16 | Cross-user workspace access | Unique markers in two user Sandboxes | No cross-visibility | Provider call not attempted | Two real Sandboxes | **BLOCKED** |
| 17 | Cross-job artifact access | Unique marker in one job Sandbox, probe from another | No cross-visibility | Provider call not attempted | Two real Sandboxes | **BLOCKED** |
| 18 | Background-process persistence | Detached heartbeat then stop/delete | Cannot continue or resume | Provider call not attempted | Real lifecycle | **BLOCKED** |
| 19 | Cancellation failure | Abort an active infinite command | Interrupted and deleted | Provider call not attempted | Real AbortSignal/lifecycle | **BLOCKED** |
| 20 | Worker termination failure | Stop/delete then command and lookup attempts | Instance inert and unavailable | Provider call not attempted | Real lifecycle | **BLOCKED** |

## Evidence integrity

Network probes return PASS only from actual provider command output. A missing adapter returns BLOCKED before the attack. Destructive scenarios cannot run from the ordinary provider flag alone. Evidence is capped and redacts password, secret, token, authorization, and API-key patterns. No real-provider result was generated in Phase 7.

Vercel currently documents deny-all as an explicit policy rather than the default, so the adapter always supplies it. See the official [Vercel Sandbox overview](https://vercel.com/sandbox) and [advanced egress firewall documentation](https://vercel.com/changelog/advanced-egress-firewall-filtering-for-vercel-sandbox).

