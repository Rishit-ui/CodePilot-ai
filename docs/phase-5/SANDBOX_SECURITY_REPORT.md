# Sandbox Security Report

Decision: `BLOCKED`. `executionReleaseVerified=false` remains source controlled and production execution remains disabled.

The Vercel adapter uses an ephemeral non-persistent sandbox, zero exposed ports, `deny-all` network policy, one vCPU by default, fixed maximum lifetime, fixed command timeout, predefined command profiles, validated workspace paths/sizes, bounded output, no production/database secrets, and stop/delete cleanup. The orchestrator records real provider IDs/output only and terminates in `finally`.

Local unit tests verify profile allowlisting, path/size validation, output truncation, real exit/duration propagation, failure truthfulness and cleanup invocation. These do not establish cloud isolation.

The real-provider adversarial test is skipped without explicit authorization. If someone sets `TEST_VERCEL_SANDBOX=1`, it now fails loudly because the 20 provider-backed attack implementations do not yet exist; it can no longer yield a misleading pass composed of skipped subtests.

| Attack class | Result |
| --- | --- |
| Host files, production secrets, metadata, DB/internal API | `NOT TESTED` on provider |
| DNS/HTTP exfiltration and network isolation | `NOT TESTED` on provider |
| Traversal, symlink, cross-user workspace/artifact | Local validation `PASS`; provider `NOT TESTED` |
| Process, memory, disk, output exhaustion | Output bound local `PASS`; provider ceilings `NOT TESTED` |
| Infinite loop, timeout, cancellation, background process | Local orchestration `PASS`; provider enforcement `NOT TESTED` |
| Termination and runtime persistence | Cleanup call local `PASS`; remote termination `NOT TESTED` |

The platform may be staged for authenticated repository management, static analysis and reporting. The execution feature is a separate `NO-GO` until every real attack has recorded expected and observed outcomes.
