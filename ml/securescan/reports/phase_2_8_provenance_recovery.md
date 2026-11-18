# Phase 2.8 Provenance Recovery

## Status: BLOCKED — reconstructed source available, exact execution identity unverified

- Recorded extraction HEAD: `89387d0f88c4df0b0212b1f14c388a729c9d73e8`.
- Current source HEAD: `1df272f02db04f5d78cd8f5c7d0c940c4affa2ec`.
- Stashes found: **0**; patch/backup files found: **0**.
- Relevant unreachable snapshot found: `f789a55c6cce4070e40c82eb1f8ec107a8999bb4`.
- Reconstructed extraction tuple: `HIGH_CONFIDENCE_RECONSTRUCTION_NOT_EXACTLY_VERIFIED`.

The reconstruction uses the script and curation blobs from `89387d0…` plus the
seven-line foreign-key batch-order patch committed at `7baaaa5…`. Commit and
reflog timing, the original FK failure, and the later single-file fix support
this reconstruction. No runtime digest, command transcript with file hashes, or
preserved bytecode proves it was the exact executed tuple. It is therefore a
high-confidence reconstruction, not verified original executed source.

Phase 2.6 analysis remains `UNRESOLVED_DIRTY_WORKTREE`: no per-stage source hash
was stored. Current committed Phase 2.7 source is independently identified, but
does not retroactively identify each Phase 2.6 stage.
