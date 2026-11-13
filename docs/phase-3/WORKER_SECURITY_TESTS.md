# Worker Security Tests

Date: 2026-11-13

Provider environment: unavailable. No Vercel project/OIDC credentials or authorized Sandbox budget was supplied. Unit validation is not treated as provider security evidence.

| # | Attack | Expected | Actual/provider evidence | Status |
| --- | --- | --- | --- | --- |
| 1 | Host file read | No host mounts/files | Not run in provider | `NOT TESTED` |
| 2 | Production environment read | No production secrets | Adapter passes only CI/job ID; provider not run | `NOT TESTED` |
| 3 | Cloud metadata | Denied by firewall | Provider firewall not exercised | `NOT TESTED` |
| 4 | PostgreSQL connection | Denied | Provider firewall not exercised | `NOT TESTED` |
| 5 | Internal API access | Denied | Provider firewall not exercised | `NOT TESTED` |
| 6 | DNS exfiltration | Denied | Provider DNS behavior not exercised | `NOT TESTED` |
| 7 | Outbound HTTP | Denied | Provider firewall not exercised | `NOT TESTED` |
| 8 | Path traversal | Workspace upload rejected | Unit validation passes; no provider attack | `NOT TESTED` |
| 9 | Symlink escape | No boundary escape | Archive rejects symlinks; provider not run | `NOT TESTED` |
| 10 | Process exhaustion | Contained/terminated | Provider PID control not established | `NOT TESTED` |
| 11 | Memory exhaustion | MicroVM-contained | Resource allocation not attacked | `NOT TESTED` |
| 12 | Disk exhaustion | Contained by quota | Provider disk quota not established | `NOT TESTED` |
| 13 | Output flood | Output truncated | Collection limit implemented; provider not run | `NOT TESTED` |
| 14 | Infinite loop | Command killed | Timeout configured; provider not run | `NOT TESTED` |
| 15 | Lifetime overrun | Sandbox stopped | Session timeout configured; provider not run | `NOT TESTED` |
| 16 | Cross-user workspace | Separate microVM | Provider isolation not run | `NOT TESTED` |
| 17 | Survive cancellation | Terminated/cancelled | DB cancellation unit-tested; active VM not run | `NOT TESTED` |
| 18 | Persistent background process | Destroyed with sandbox | Provider deletion not run | `NOT TESTED` |
| 19 | Modify worker runtime | Confined to disposable VM | Provider boundary not run | `NOT TESTED` |
| 20 | Cross-job artifact | Authorization denied | Local owner test passes; real Blob not run | `NOT TESTED` |

Fixture inventory: `tests/fixtures/malicious/scenarios.json`. Test entry: `tests/worker_adversarial.provider.test.js`, skipped unless an explicitly authorized provider environment exists. Gate A is `BLOCKED`.
