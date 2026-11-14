# End-to-End Test Report

Environment: Windows local workspace, Node.js test runner and Edge/Playwright. Cloud credentials were absent.

## Executed evidence

| Command/run | Result |
| --- | --- |
| Baseline `npm run check` | exit 0 |
| Valid baseline `npm test` | 78 discovered, 76 passed, 0 failed, 2 skipped |
| Baseline `npm run test:e2e` | 1 passed, 0 failed |
| Final pre-doc `npm run check` | exit 0 |
| First expanded `npm test` | 88 discovered, 82 passed, 1 failed, 5 skipped; retention assertion expected `undefined` instead of Store's actual `null` |
| Corrected expanded `npm test` | 88 discovered, 83 passed, 0 failed, 5 skipped |
| Final `npm run check` after frontend integration | exit 0 |
| Final `npm test` after frontend integration | 88 discovered, 83 passed, 0 failed, 5 skipped |
| Final `npm run test:e2e` | 1 passed, 0 failed |

An earlier baseline attempt inside the restricted sandbox produced six `EACCES` loopback failures and a stalled concurrent browser run. It was invalidated as an environment/concurrency attempt and was not counted as a product baseline. The suites were rerun serially with loopback/browser permission.

The local browser scenario registers/authenticates, traverses all 14 workspaces, checks responsive views and verifies that execution is visibly disabled. API integration covers project creation/import, analysis, reports, grounded QA, impact analysis, test selection, patch/apply/rollback, persistence, audit history and cross-user isolation. The new private-Blob browser path was syntax-checked but could not be exercised without a private store and CORS-authorized presigned URL.

Cloud-dependent steps were not executed: private provider upload, actual Queue delivery, external AI answer, Sandbox test execution/artifacts, managed PostgreSQL staging and deployed-browser workflow. Conditional skips are: real Queue, real Blob, real AI, real PostgreSQL and real Sandbox adversarial verification.

Therefore the local platform workflow is `PASS`; the complete real-cloud workflow is `BLOCKED`.
