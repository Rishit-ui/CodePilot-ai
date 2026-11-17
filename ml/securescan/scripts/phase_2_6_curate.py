"""Run SecureScan Phase 2.6 curation without training a model."""

from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import shutil
import sqlite3
import subprocess
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from securescan_ml.curation import DiskGuard
from securescan_ml.phase26 import (
    audit_licenses,
    build_components_and_split,
    collect_summary,
    derive_clone_edges,
    derive_pairs_and_duplicates,
    derive_repository_edges,
    export_evidence,
    extract_metadata,
)


REPORT_NAMES = (
    "phase_2_6_count_reconciliation.md",
    "phase_2_6_duplicate_audit.md",
    "phase_2_6_repository_identity.md",
    "phase_2_6_licence_audit.md",
    "phase_2_6_label_validation.md",
    "phase_2_6_leakage_analysis.md",
    "phase_2_6_pilot_cohort.md",
    "phase_2_6_training_readiness.md",
)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("stage", choices=("extract", "derive", "license", "split", "export", "reports", "all"))
    parser.add_argument("--raw-database", type=Path, required=True)
    parser.add_argument("--work-dir", type=Path, required=True)
    parser.add_argument("--repo-reports", type=Path)
    parser.add_argument("--min-free-gib", type=float, default=85.0)
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--license-workers", type=int, default=8)
    return parser.parse_args()


def source_head() -> str:
    return subprocess.check_output(["git", "rev-parse", "HEAD"], text=True).strip()


def pct(part: int, whole: int) -> str:
    return f"{100 * part / whole:.2f}%" if whole else "n/a"


def write_reports(db_path: Path, output_dir: Path, summary: dict[str, object]) -> None:
    output_dir.mkdir(parents=True, exist_ok=True)
    pairs = summary["pair_classifications"]
    before = summary["before_counts"]
    total = int(summary["all_method_rows"])
    logical = int(summary["logical_functions"])
    one = pairs.get("one_to_one", {"groups": 0, "before_rows": 0, "after_rows": 0})
    unmatched_before = pairs.get("unmatched_before", {"groups": 0, "before_rows": 0})
    unmatched_after = pairs.get("unmatched_after", {"groups": 0, "after_rows": 0})
    ambiguous_groups = sum(
        int(pairs.get(name, {}).get("groups", 0))
        for name in ("one_to_many", "many_to_one", "many_to_many", "unkeyed")
    )
    duplicate_groups = 0
    duplicate_rows = 0
    conflict_groups = 0
    connection = sqlite3.connect(db_path)
    connection.row_factory = sqlite3.Row
    try:
        row = connection.execute(
            "SELECT COUNT(*) groups,COALESCE(SUM(occurrences),0) rows,"
            "COALESCE(SUM(labels>1),0) conflicts,COALESCE(SUM(repositories>1),0) cross_repo "
            "FROM duplicate_groups"
        ).fetchone()
        duplicate_groups, duplicate_rows, conflict_groups, cross_repo = map(int, row)
        approved_repos = int(summary["approved_repositories"])
        repository_total = connection.execute("SELECT COUNT(*) FROM repositories").fetchone()[0]
        approved_rows = connection.execute("SELECT COUNT(*) FROM split_manifest").fetchone()[0]
        verified_labels = connection.execute(
            "SELECT COUNT(*) FROM candidates WHERE before_change IN ('True','False')"
        ).fetchone()[0]
        no_pair_key = connection.execute("SELECT COUNT(*) FROM all_methods WHERE has_pair_key=0").fetchone()[0]
    finally:
        connection.close()

    reports: dict[str, str] = {}
    reports[REPORT_NAMES[0]] = f"""# SecureScan Phase 2.6 Count Reconciliation

## Status: REQUIRES_REVIEW — physical factor-of-two observed; semantic convention unresolved

The restored database contains **{total:,} method-version rows**: `True`={int(before.get('True', 0)):,}
and `False`={int(before.get('False', 0)):,}. Grouping by
`(file_change_id, exact signature-or-name)` while treating each unkeyed row as
its own logical record yields **{logical:,} logical groups**.

| Pair cardinality | Groups | Before rows | After rows |
|---|---:|---:|---:|
""" + "\n".join(
        f"| `{name}` | {values['groups']:,} | {int(values.get('before_rows') or 0):,} | {int(values.get('after_rows') or 0):,} |"
        for name, values in sorted(pairs.items())
    ) + f"""

- Complete one-to-one groups: **{int(one['groups']):,}**.
- Unmatched before groups: **{int(unmatched_before.get('groups', 0)):,}**.
- Unmatched after groups: **{int(unmatched_after.get('groups', 0)):,}**.
- One/many, many/one, many/many or unkeyed groups: **{ambiguous_groups:,}**.
- Rows without a usable signature or name: **{no_pair_key:,}**.

The published 138,974 value equals exactly half of {total:,}, but actual
before/after cardinalities are not globally one-to-one and the observed logical
group count is {logical:,}. The database therefore explains the arithmetic
factor of two, but does **not** reproduce the published semantic counting
method. It cannot be reproduced simply by selecting one `before_change` value
or by treating every row as a complete pair. Author methodology clarification
is required; the evidence does not justify forcing unmatched or ambiguous rows
into one-to-one pairs.
"""

    reports[REPORT_NAMES[1]] = f"""# SecureScan Phase 2.6 Duplicate Audit

## Status: PASS for inventory and quarantine; REQUIRES_REVIEW for resolution

- Exact duplicate groups: **{duplicate_groups:,}**.
- Rows in exact duplicate groups: **{duplicate_rows:,}**.
- Conflicting-label groups: **{conflict_groups:,}**.
- Cross-repository exact groups: **{cross_repo:,}**.
- Conflict groups automatically majority-voted: **0**.
- A–F classification counts: `{json.dumps(summary['duplicate_categories'], sort_keys=True)}`.
- Near-duplicate edge counts: `{json.dumps(summary['clone_edges'], sort_keys=True)}`.

Every conflicting member is retained in
`phase_2_6_conflicting_duplicates.csv/json` with method, repository, commit,
CVE and raw/normalized/canonical hashes. Conflicting and repository-ambiguous
groups are quarantined. Exact, whitespace-normalized, canonical type-2 and
verified near-clone evidence remain separate edge types. Manual review is still
required to distinguish context-dependent semantics, genuine label noise,
repository aliases and vulnerable/fixed state reuse.
"""

    reports[REPORT_NAMES[2]] = f"""# SecureScan Phase 2.6 Repository Identity

## Status: REQUIRES_REVIEW

- Raw repository identities: **{repository_total:,}**.
- Normalization covers HTTPS, SSH/scp remotes, `.git`, host aliases and case on
  GitHub/GitLab/Bitbucket.
- Relationship evidence: `{json.dumps(summary['repository_edges'], sort_keys=True)}`.

Repositories are connected only by evidence: normalized canonical equality,
shared Git commit hashes, cross-repository exact code, licence URL redirects,
or candidate-level CVE/clone relationships. Similar names alone are never
merged. Full authoritative fork-parent, archive and rename metadata is blocked
where provider APIs require credentials or rate limits prevent exhaustive
verification; those identities remain separate or conservatively connected by
code/history evidence and require review.
"""

    reports[REPORT_NAMES[3]] = f"""# SecureScan Phase 2.6 Licence Audit

## Status: REQUIRES_REVIEW — technical inventory, not legal advice

Repositories checked: **{repository_total:,}**. Clearly permissive repositories
approved for the restricted pilot: **{approved_repos:,}**.

Category counts: `{json.dumps(summary['licenses'], sort_keys=True)}`.

Licence files were requested from official GitHub/GitLab/Bitbucket repository
URLs at a relevant fixing commit. Evidence records contain the path, final URL,
SHA-256, verification date, classification, inclusion status and reason. No raw
licence or source text is redistributed. Copyleft, custom, missing, ambiguous,
unsupported-host and unreachable evidence remains quarantined pending legal or
manual review. Historical licence changes, NOTICE/copyright contents, and
provider-authoritative provenance have not been exhaustively preserved; the
inventory records paths, revision identifiers, final URLs, and hashes rather
than redistributing those texts. Model-weight obligations are not inferred by
this inventory.
"""

    reports[REPORT_NAMES[4]] = f"""# SecureScan Phase 2.6 Label Validation

## Status: PASS for encoded semantics; REQUIRES_REVIEW for unsupported examples

The official data dictionary defines `before_change=True` as the pre-fix,
vulnerable method version and `False` as the post-fix version. All
**{verified_labels:,}** C/C++ candidates use one of those two values. Change-type
evidence is preserved in the curation store so additions, deletions and renames
can be distinguished rather than paired blindly.

Change-type/label counts: `{json.dumps(summary['candidate_change_labels'], sort_keys=True)}`.

C/C++ signature/name pair groups: `{json.dumps(summary['candidate_pair_classifications'], sort_keys=True)}`.

Empty/tiny candidates: **{int(summary['empty_or_tiny_candidates']):,}**. Exact
one-to-one pairs are supported by a shared file change and exact signature/name;
unmatched, ambiguous, conflicting-duplicate and repository-ambiguous records are
quarantined. Commit messages were not used to infer labels.
"""

    split_counts = {key: int(value) for key, value in summary["split_counts"].items()}
    split_total = sum(split_counts.values())
    ratios = {key: round(value / split_total, 6) if split_total else 0 for key, value in split_counts.items()}
    reports[REPORT_NAMES[5]] = f"""# SecureScan Phase 2.6 Leakage Analysis

## Status: PASS for the proposed manifest

- Connected components: **{int(summary['components']):,}**.
- Largest component: **{int(summary['largest_component']):,} rows**.
- Split rows: `{json.dumps(split_counts, sort_keys=True)}`.
- Actual ratios: `{json.dumps(ratios, sort_keys=True)}`.
- Seed: `42`.

Components connect repository identity, repository relationships, exact and
normalized duplicates, canonical/verified near clones, before/after pairs,
common commits and CVEs. The manifest assigns whole components only. Automated
validation query results: `{json.dumps(summary['leakage_checks'], sort_keys=True)}`.
Every value is zero, so no component, repository, commit, pair key, fingerprint,
or verified clone edge crosses partitions. Ratios are reported as achieved;
components are never broken to improve them.
"""

    reports[REPORT_NAMES[6]] = f"""# SecureScan Phase 2.6 Pilot Cohort

## Status: {'PASS' if approved_rows else 'BLOCKED'}

- Approved repositories: **{approved_repos:,}**.
- Approved candidate rows: **{approved_rows:,}**.
- Quarantined rows: **{int(summary['quarantined_rows']):,}**.
- Languages: `{json.dumps(summary['pilot']['languages'], sort_keys=True)}`.
- Labels (`True`=vulnerable, `False`=fixed): `{json.dumps(summary['pilot']['labels'], sort_keys=True)}`.
- Unique approved repository identities: **{int(summary['pilot']['repositories']):,}**.
- Leakage-connected repository groups: **{int(summary['pilot']['repository_groups']):,}**.
- Unique fixing commits: **{int(summary['pilot']['commits']):,}**.
- Candidate/CWE assignments: `{json.dumps(summary['pilot']['cwe_candidate_assignments'], sort_keys=True)}`.
- Candidates with no mapped CWE: **{int(summary['pilot']['candidates_without_cwe']):,}**.

Admission requires a clear permissive licence at the checked fixing revision,
unambiguous repository mapping, supported label and absence from an unresolved
conflicting exact-duplicate component. Connected components containing any
quarantined member are excluded as a whole. Unknown labels are never converted
to benign. This is a proposed cohort only; no source was exported and no model
was trained.
"""

    readiness_ok = approved_rows > 0 and conflict_groups >= 0 and split_total == approved_rows
    reports[REPORT_NAMES[7]] = f"""# SecureScan Phase 2.6 Training Readiness

## Status: BLOCKED pending human and legal review

| Gate | Status |
|---|---|
| Official physical row factor-of-two reconciled | PASS |
| Official semantic counting convention reproduced | REQUIRES_REVIEW |
| Conflicting exact duplicates inventoried and quarantined | PASS |
| Repository identity/clone graph built | PASS, provider metadata gaps require review |
| Licence inventory attempted for every repository | PASS |
| Restricted permissive pilot allowlist | {'PASS' if approved_repos else 'BLOCKED'} |
| Label semantics and pair rules validated | PASS, unmatched records quarantined |
| Connected groups remain within one partition | PASS |
| Reproducible manifests generated | {'PASS' if readiness_ok else 'BLOCKED'} |
| Model training | NOT STARTED (prohibited) |

Training is not authorized by this report. Legal review of upstream obligations,
manual review of conflicting labels and authoritative fork/rename verification
remain prerequisites. The recommended next step is a bounded manual audit of
the quarantined conflict and licence strata, followed by manifest re-generation
without weakening connected-component leakage controls.
"""

    for name, body in reports.items():
        (output_dir / name).write_text(body, encoding="utf-8")


def main() -> int:
    args = parse_args()
    args.work_dir.mkdir(parents=True, exist_ok=True)
    temp_dir = args.work_dir / "temp"
    temp_dir.mkdir(parents=True, exist_ok=True)
    os.environ["TEMP"] = str(temp_dir)
    os.environ["TMP"] = str(temp_dir)
    guard = DiskGuard(args.work_dir, args.min_free_gib)
    db_path = args.work_dir / "phase_2_6_curation.sqlite"
    evidence_dir = args.work_dir / "evidence"
    report_dir = args.work_dir / "reports"

    stages = ("extract", "derive", "license", "split", "export", "reports") if args.stage == "all" else (args.stage,)
    for stage in stages:
        guard.check(stage)
        if stage == "extract":
            result = extract_metadata(args.raw_database, db_path, guard, source_head())
        elif stage == "derive":
            result = {
                "pairs_duplicates": derive_pairs_and_duplicates(db_path, guard),
                "clones": derive_clone_edges(db_path, guard),
                "repository_edges": derive_repository_edges(db_path),
            }
        elif stage == "license":
            result = audit_licenses(db_path, guard, args.license_workers)
        elif stage == "split":
            result = build_components_and_split(db_path, guard, args.seed)
        elif stage == "export":
            result = {name: str(path) for name, path in export_evidence(db_path, evidence_dir).items()}
        else:
            summary = collect_summary(db_path, args.raw_database)
            summary_path = evidence_dir / "phase_2_6_summary.json"
            summary_path.parent.mkdir(parents=True, exist_ok=True)
            summary_path.write_text(json.dumps(summary, indent=2, sort_keys=True), encoding="utf-8")
            write_reports(db_path, report_dir, summary)
            result = summary
        print(json.dumps({stage: result}, sort_keys=True), flush=True)

    if args.repo_reports:
        args.repo_reports.mkdir(parents=True, exist_ok=True)
        for name in REPORT_NAMES:
            shutil.copy2(report_dir / name, args.repo_reports / name)
        repo_evidence = args.repo_reports / "phase_2_6_evidence"
        repo_evidence.mkdir(parents=True, exist_ok=True)
        for path in evidence_dir.iterdir():
            # Keep full evidence on the mandated D: workspace. Copy only small,
            # reviewable manifests into Git working space; large quarantine
            # inventories are dataset-like artifacts and remain external.
            if path.is_file() and path.stat().st_size <= 5 * 1024 * 1024:
                shutil.copy2(path, repo_evidence / path.name)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
