# Phase 2.7 Provenance Reconciliation

## Status: BLOCKED

| Revision role | Identity |
|---|---|
| Extraction metadata HEAD | `89387d0f88c4df0b0212b1f14c388a729c9d73e8` |
| Phase 2.6 analysis source | **UNRESOLVED** — analysis ran from a changing, dirty working tree |
| Current checked-out revision | `7baaaa5b2ce5b6f5024b1dc80f4b163a202625d4` |
| Current branch | `feature/securescan-ml` |

Both commits exist locally: extraction=True, current=True.

| Status | Path | Potential impact |
|---|---|---|
| M | ml/securescan/securescan_ml/phase26.py | extraction execution: foreign-key batch ordering; successful extraction source differs from recorded clean commit |

The only committed difference between the recorded extraction HEAD and current
HEAD is the foreign-key-safe batch-order fix in `phase26.py`. That fix can affect
whether extraction succeeds and is present in the successfully used working
tree, but not in the recorded commit. Later analysis/report changes are also
uncommitted. The extraction HEAD alone therefore does not identify the exact
source state used. Reflog and hashes are preserved in the machine-readable
provenance ledger; no repository state was changed during this investigation.
