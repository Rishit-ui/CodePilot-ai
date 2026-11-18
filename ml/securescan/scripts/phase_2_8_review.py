"""Generate Phase 2.8 technical review evidence without changing Git or data."""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
import subprocess
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from securescan_ml.curation import DiskGuard
from securescan_ml.phase28 import generate_phase28


EXTRACTION_REVISION = "89387d0f88c4df0b0212b1f14c388a729c9d73e8"
FIX_REVISION = "7baaaa5b2ce5b6f5024b1dc80f4b163a202625d4"
RELEVANT_PATHS = (
    "ml/securescan/scripts/phase_2_6_curate.py",
    "ml/securescan/securescan_ml/curation.py",
    "ml/securescan/securescan_ml/phase26.py",
)


def _git(*args: str, check: bool = True) -> str:
    result = subprocess.run(["git", *args], capture_output=True, text=True, check=check)
    return result.stdout.strip()


def _blob(revision: str, path: str) -> bytes:
    return subprocess.check_output(["git", "show", f"{revision}:{path}"])


def _blob_record(revision: str, path: str) -> dict[str, str]:
    content = _blob(revision, path)
    line = _git("ls-tree", revision, "--", path)
    return {
        "revision": revision, "path": path,
        "git_blob": line.split()[2] if line else "",
        "sha256": hashlib.sha256(content).hexdigest(),
    }


def collect_provenance() -> dict[str, object]:
    current = _git("rev-parse", "HEAD")
    patch = _git("diff", EXTRACTION_REVISION, FIX_REVISION, "--", "ml/securescan/securescan_ml/phase26.py")
    phase_files = []
    for path in RELEVANT_PATHS:
        selected = FIX_REVISION if path.endswith("phase26.py") else EXTRACTION_REVISION
        phase_files.append(_blob_record(selected, path))
    stashes = _git("stash", "list")
    backup_files = [
        path for path in _git("ls-files", "--others", "--exclude-standard").splitlines()
        if path.endswith((".patch", ".diff", ".bak", ".backup", "~"))
    ]
    fsck = _git("fsck", "--no-reflogs", "--unreachable", "--no-progress", check=False)
    relevant_tree = ""
    for line in fsck.splitlines():
        if not line.startswith("unreachable tree "):
            continue
        tree = line.split()[2]
        listing = _git("ls-tree", "-r", tree, check=False)
        if all(path in listing for path in RELEVANT_PATHS):
            relevant_tree = tree
            break
    return {
        "extraction_revision": EXTRACTION_REVISION,
        "fix_revision": FIX_REVISION,
        "current_revision": current,
        "branch": _git("branch", "--show-current"),
        "working_tree_status_before_phase28": _git("status", "--short"),
        "history": _git("log", "--format=%H %aI %s", "-18"),
        "reflog": _git("reflog", "-20", "--date=iso-strict"),
        "stash_count": 0 if not stashes else len(stashes.splitlines()),
        "stash_list": stashes,
        "backup_patch_count": len(backup_files),
        "backup_patch_files": backup_files,
        "unreachable_objects": fsck.splitlines(),
        "relevant_unreachable_tree": relevant_tree,
        "reconstructed_source_files": phase_files,
        "reconstruction_patch": patch + "\n",
        "reconstruction_status": "HIGH_CONFIDENCE_RECONSTRUCTION_NOT_EXACTLY_VERIFIED",
        "verified_extraction_source": False,
        "verified_analysis_source": False,
        "analysis_source_status": "UNRESOLVED_DIRTY_WORKTREE_NO_PER_STAGE_DIGEST",
        "current_source_verified": True,
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--raw-database", type=Path, required=True)
    parser.add_argument("--curation-database", type=Path, required=True)
    parser.add_argument("--reports-dir", type=Path, required=True)
    parser.add_argument("--min-free-gib", type=float, default=85)
    args = parser.parse_args()
    guard = DiskGuard(args.curation_database.parent, args.min_free_gib)
    guard.check("Phase 2.8 review start")
    summary = generate_phase28(
        args.curation_database, args.raw_database, args.reports_dir, collect_provenance()
    )
    guard.check("Phase 2.8 review complete")
    print(json.dumps(summary, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
