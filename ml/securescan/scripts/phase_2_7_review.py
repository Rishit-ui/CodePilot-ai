"""Generate the Phase 2.7 review and provenance pack without training."""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
import subprocess
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from securescan_ml.curation import DiskGuard
from securescan_ml.phase27 import generate_phase27


def _git(*args: str, check: bool = True) -> str:
    result = subprocess.run(["git", *args], text=True, capture_output=True, check=check)
    return result.stdout.strip()


def _exists(revision: str) -> bool:
    return subprocess.run(
        ["git", "cat-file", "-e", f"{revision}^{{commit}}"], capture_output=True
    ).returncode == 0


def _blob_hash(revision: str, path: str) -> str:
    content = subprocess.check_output(["git", "show", f"{revision}:{path}"])
    return hashlib.sha256(content).hexdigest()


def provenance(extraction_revision: str) -> dict[str, object]:
    current = _git("rev-parse", "HEAD")
    changed = []
    for line in _git("diff", "--name-status", extraction_revision, current).splitlines():
        if not line:
            continue
        status, path = line.split("\t", 1)
        relevant = path.startswith("ml/securescan/")
        impact = "none identified"
        if path.endswith("phase26.py"):
            impact = "extraction execution: foreign-key batch ordering; successful extraction source differs from recorded clean commit"
        elif relevant:
            impact = "potential SecureScan data or report behavior"
        changed.append({"status": status, "path": path, "relevant": relevant, "impact": impact})
    relevant_paths = [
        "ml/securescan/securescan_ml/curation.py",
        "ml/securescan/securescan_ml/phase26.py",
        "ml/securescan/scripts/phase_2_6_curate.py",
    ]
    hashes = {}
    for path in relevant_paths:
        current_path = Path(path)
        hashes[path] = {
            "extraction_commit_sha256": _blob_hash(extraction_revision, path) if _exists(extraction_revision) else "",
            "current_commit_sha256": _blob_hash(current, path) if _exists(current) else "",
            "working_tree_sha256": hashlib.sha256(current_path.read_bytes()).hexdigest() if current_path.exists() else "",
        }
    return {
        "branch": _git("branch", "--show-current"),
        "extraction_revision": extraction_revision,
        "extraction_revision_exists": _exists(extraction_revision),
        "analysis_revision": "UNRESOLVED_DIRTY_WORKTREE",
        "analysis_revision_explanation": (
            "Derived stages and final reports ran while HEAD advanced and relevant files had uncommitted changes; "
            "the curation database stores only the extraction HEAD, not a working-tree digest per stage."
        ),
        "current_revision": current,
        "current_revision_exists": _exists(current),
        "working_tree_status": _git("status", "--short"),
        "recent_history": _git("log", "--format=%H %aI %s", "-12"),
        "reflog": _git("reflog", "-15", "--date=iso-strict"),
        "changed_files": changed,
        "relevant_file_hashes": hashes,
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--raw-database", type=Path, required=True)
    parser.add_argument("--curation-database", type=Path, required=True)
    parser.add_argument("--reports-dir", type=Path, required=True)
    parser.add_argument("--extraction-revision", default="89387d0f88c4df0b0212b1f14c388a729c9d73e8")
    parser.add_argument("--min-free-gib", type=float, default=85)
    args = parser.parse_args()
    DiskGuard(args.curation_database.parent, args.min_free_gib).check("Phase 2.7 review start")
    result = generate_phase27(
        args.raw_database,
        args.curation_database,
        args.reports_dir,
        provenance(args.extraction_revision),
    )
    DiskGuard(args.curation_database.parent, args.min_free_gib).check("Phase 2.7 review complete")
    print(json.dumps(result, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
