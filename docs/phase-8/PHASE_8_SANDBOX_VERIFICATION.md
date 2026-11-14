# Phase 8 Sandbox Verification

Date: 2026-11-15

## Evidence classes

- **Local:** path-validation and orchestration contract tests executed on the development host.
- **Mocked/simulated:** provider adapters used only to verify application control flow; not isolation evidence.
- **Provider-dependent:** requires a real Vercel Sandbox and approved test resources.
- **Independent real infrastructure:** none available in this phase.

## Results

The canonical harness still contains exactly 20 scenarios. Local path traversal protection is PASS. The other 19 scenarios remain BLOCKED because no authorized real Sandbox was created. The harness correctly reports `releaseEligible: false` unless all 20 real results pass.

| Control family | Status | Reason |
|---|---|---|
| Path traversal before upload | PASS locally | Local validation rejects traversal and absolute paths |
| Filesystem and symlink isolation | BLOCKED | Real microVM required |
| Process and child-process isolation | BLOCKED | Real microVM required |
| Network, DNS, private-address, and metadata denial | BLOCKED | Provider network enforcement required |
| Environment and secret isolation | BLOCKED | Approved canary-based provider test required |
| CPU, memory, disk, and output limits | BLOCKED | Destructive provider test window required |
| Timeout and cancellation enforcement | BLOCKED | Real provider lifecycle required |
| Workspace cleanup and background persistence | BLOCKED | Real stop/delete observation required |
| Concurrent job isolation | BLOCKED | Multiple real sandboxes required |
| Privilege escalation and escape resistance | BLOCKED | Provider evidence plus independent adversarial review required |

## Provider verification checklist

1. Use an isolated staging account/project with no production credentials.
2. Confirm plan, region, SDK, image digest, network-policy semantics, and cost ceiling.
3. Configure non-secret canaries; never inject production secrets.
4. Run ordinary scenarios first, retaining provider run IDs and redacted logs.
5. Obtain separate approval for process, memory, and disk exhaustion scenarios.
6. Run concurrent tenant jobs and prove no shared filesystem, process, network, or identifiers.
7. Stop and delete every sandbox; verify commands, lookup, and background activity fail afterward.
8. Have an independent reviewer validate evidence and scenario completeness.
9. Keep the release gate false after failures, blocks, missing evidence, or provider drift.

`EXECUTION_RELEASE_VERIFIED` remains `false`; production execution remains disabled.
