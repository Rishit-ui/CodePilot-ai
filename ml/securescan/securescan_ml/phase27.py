"""Phase 2.7 review ledgers and reports; never trains or exports a model."""

from __future__ import annotations

import csv
import hashlib
import json
import sqlite3
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path
from statistics import median
from typing import Any, Iterable

from .curation import deterministic_group_split


ZENODO_URL = "https://zenodo.org/records/13118970"
DATA_DICTIONARY_URL = "https://github.com/secureIT-project/CVEfixes/blob/main/Doc/DataDictionary.md"
README_URL = "https://github.com/secureIT-project/CVEfixes/blob/main/README.md"


COUNT_QUERIES = {
    "physical_method_rows": "SELECT COUNT(*) FROM method_change;",
    "before_change_rows": (
        "SELECT CAST(before_change AS TEXT) AS before_change, COUNT(*) AS rows "
        "FROM method_change GROUP BY CAST(before_change AS TEXT) ORDER BY before_change;"
    ),
    "phase26_logical_groups": (
        "SELECT COUNT(*) FROM (SELECT file_change_id, CASE "
        "WHEN LOWER(TRIM(COALESCE(signature,''))) NOT IN ('','nan','none') THEN TRIM(signature) "
        "WHEN LOWER(TRIM(COALESCE(name,''))) NOT IN ('','nan','none') THEN TRIM(name) "
        "ELSE '__unkeyed__:' || method_change_id END AS logical_key "
        "FROM method_change GROUP BY file_change_id, logical_key);"
    ),
    "phase26_pair_cardinality": (
        "WITH grouped AS (SELECT file_change_id, "
        "CASE WHEN LOWER(TRIM(COALESCE(signature,''))) NOT IN ('','nan','none') THEN TRIM(signature) "
        "WHEN LOWER(TRIM(COALESCE(name,''))) NOT IN ('','nan','none') THEN TRIM(name) "
        "ELSE '__unkeyed__:' || method_change_id END AS logical_key, "
        "SUM(CAST(before_change AS TEXT)='True') AS before_rows, "
        "SUM(CAST(before_change AS TEXT)='False') AS after_rows "
        "FROM method_change GROUP BY file_change_id, logical_key) "
        "SELECT CASE WHEN before_rows=1 AND after_rows=1 THEN 'one_to_one' "
        "WHEN before_rows=0 THEN 'unmatched_after' WHEN after_rows=0 THEN 'unmatched_before' "
        "WHEN before_rows=1 THEN 'one_to_many' WHEN after_rows=1 THEN 'many_to_one' "
        "ELSE 'many_to_many' END AS classification, COUNT(*) AS groups, "
        "SUM(before_rows) AS before_rows, SUM(after_rows) AS after_rows "
        "FROM grouped GROUP BY classification ORDER BY classification;"
    ),
    "c_cpp_pair_cardinality": (
        "SELECT classification, COUNT(*) AS groups FROM ("
        "SELECT CASE WHEN SUM(c.before_change='True')=1 AND SUM(c.before_change='False')=1 THEN 'one_to_one' "
        "WHEN SUM(c.before_change='True')=0 THEN 'unmatched_after' "
        "WHEN SUM(c.before_change='False')=0 THEN 'unmatched_before' "
        "WHEN SUM(c.before_change='True')=1 THEN 'one_to_many' "
        "WHEN SUM(c.before_change='False')=1 THEN 'many_to_one' ELSE 'many_to_many' END classification "
        "FROM candidates c WHERE COALESCE(NULLIF(c.signature,''),NULLIF(c.method_name,'')) IS NOT NULL "
        "GROUP BY c.file_change_id,COALESCE(NULLIF(c.signature,''),NULLIF(c.method_name,''))) "
        "GROUP BY classification ORDER BY classification;"
    ),
}


def _json(value: Any) -> str:
    return json.dumps(value, sort_keys=True, separators=(",", ":"))


def _open_immutable(path: Path) -> sqlite3.Connection:
    """Open a frozen SQLite artifact without creating journal or SHM files."""
    if not path.is_file():
        raise FileNotFoundError(path)
    connection = sqlite3.connect(path.resolve().as_uri() + "?mode=ro&immutable=1", uri=True)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA query_only=ON")
    connection.execute("PRAGMA temp_store=MEMORY")
    return connection


def _write_json(path: Path, value: Any) -> None:
    path.write_text(json.dumps(value, indent=2, sort_keys=True), encoding="utf-8")


def _write_csv(path: Path, rows: list[dict[str, Any]]) -> None:
    if not rows:
        path.write_text("", encoding="utf-8")
        return
    with path.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=list(rows[0]))
        writer.writeheader()
        writer.writerows(rows)


def _percentile(values: list[int], fraction: float) -> int:
    if not values:
        return 0
    ordered = sorted(values)
    return ordered[round((len(ordered) - 1) * fraction)]


def _table(rows: Iterable[tuple[Any, ...]], headers: tuple[str, ...]) -> str:
    body = ["| " + " | ".join(headers) + " |", "|" + "|".join("---" for _ in headers) + "|"]
    body.extend("| " + " | ".join(str(value) for value in row) + " |" for row in rows)
    return "\n".join(body)


def _count_evidence(raw: sqlite3.Connection, curated: sqlite3.Connection) -> dict[str, Any]:
    physical = raw.execute("SELECT COUNT(*) FROM method_change").fetchone()[0]
    before = {
        str(row[0]): int(row[1])
        for row in raw.execute(
            "SELECT CAST(before_change AS TEXT),COUNT(*) FROM method_change "
            "GROUP BY CAST(before_change AS TEXT)"
        )
    }
    pair_rows = [
        dict(row)
        for row in curated.execute(
            "SELECT classification,COUNT(*) groups,SUM(before_count) before_rows,"
            "SUM(after_count) after_rows FROM pair_groups GROUP BY classification ORDER BY classification"
        )
    ]
    candidate_pairs = {
        row["classification"]: int(row["groups"])
        for row in curated.execute(
            "WITH grouped AS (SELECT file_change_id,COALESCE(NULLIF(signature,''),NULLIF(method_name,'')) pair_key,"
            "SUM(before_change='True') b,SUM(before_change='False') a FROM candidates "
            "WHERE COALESCE(NULLIF(signature,''),NULLIF(method_name,'')) IS NOT NULL "
            "GROUP BY file_change_id,pair_key), classified AS (SELECT CASE "
            "WHEN b=1 AND a=1 THEN 'one_to_one' WHEN b=0 THEN 'unmatched_after' "
            "WHEN a=0 THEN 'unmatched_before' WHEN b=1 THEN 'one_to_many' "
            "WHEN a=1 THEN 'many_to_one' ELSE 'many_to_many' END classification FROM grouped) "
            "SELECT classification,COUNT(*) groups FROM classified GROUP BY classification"
        )
    }
    return {
        "official_published_functions": 138_974,
        "physical_method_rows": int(physical),
        "before_change_rows": before,
        "phase26_logical_groups": int(curated.execute("SELECT COUNT(*) FROM pair_groups").fetchone()[0]),
        "phase26_pair_cardinality": pair_rows,
        "c_cpp_pair_cardinality": candidate_pairs,
        "exact_duplicate_groups": int(curated.execute("SELECT COUNT(*) FROM duplicate_groups").fetchone()[0]),
        "multiple_cve_candidate_rows": int(
            curated.execute("SELECT COUNT(*) FROM candidates WHERE json_array_length(cves_json)>1").fetchone()[0]
        ),
        "ambiguous_repository_candidate_rows": int(
            curated.execute("SELECT COUNT(*) FROM candidates WHERE repo_ambiguous=1").fetchone()[0]
        ),
        "queries": COUNT_QUERIES,
        "conclusion": "official_semantic_count_not_reproduced",
    }


def _relationship_maps(connection: sqlite3.Connection) -> tuple[dict[str, list[dict[str, str]]], list[dict[str, Any]]]:
    by_repo: dict[str, list[dict[str, str]]] = defaultdict(list)
    rows: list[dict[str, Any]] = []
    for edge in connection.execute(
        "SELECT left_repo,right_repo,relationship,confidence,evidence_json "
        "FROM repository_edges ORDER BY left_repo,right_repo,relationship"
    ):
        authority = "normalized_identity_evidence" if edge["relationship"] == "canonical_url_alias" else "inferred_code_similarity"
        record = {
            "left_repo": edge["left_repo"],
            "right_repo": edge["right_repo"],
            "relationship": edge["relationship"],
            "recorded_confidence": edge["confidence"],
            "authority_class": authority,
            "evidence_json": edge["evidence_json"],
            "human_review_decision": "",
            "reviewer_identity": "",
            "review_date": "",
            "review_rationale": "",
        }
        rows.append(record)
        by_repo[edge["left_repo"]].append(record)
        by_repo[edge["right_repo"]].append(record)
    return by_repo, rows


def _repository_ledgers(connection: sqlite3.Connection) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    relationships, _ = _relationship_maps(connection)
    commits: dict[str, set[str]] = defaultdict(set)
    for row in connection.execute(
        "SELECT DISTINCT r.repo_url,c.commit_hash FROM candidate_repositories r "
        "JOIN candidates c USING(method_change_id)"
    ):
        commits[row["repo_url"]].add(row["commit_hash"])
    pilot = {
        row["repo_url"]: dict(row)
        for row in connection.execute(
            "SELECT c.primary_repo repo_url,COUNT(*) pilot_rows,COUNT(DISTINCT c.commit_hash) pilot_commits,"
            "SUM(c.commit_hash=l.checked_commit) exact_revision_rows,"
            "SUM(c.commit_hash<>l.checked_commit) other_revision_rows "
            "FROM split_manifest s JOIN candidates c USING(method_change_id) "
            "JOIN licenses l ON l.repo_url=c.primary_repo GROUP BY c.primary_repo"
        )
    }
    all_rows: list[dict[str, Any]] = []
    pilot_rows: list[dict[str, Any]] = []
    query = (
        "SELECT r.*,l.checked_commit,l.license_id,l.category,l.evidence_path,l.evidence_url,"
        "l.evidence_sha256,l.verification_date,l.inclusion_status,l.reason "
        "FROM repositories r LEFT JOIN licenses l USING(repo_url) ORDER BY r.repo_url"
    )
    for item in connection.execute(query):
        repo = item["repo_url"]
        rels = relationships.get(repo, [])
        record = {
            "repository_url": repo,
            "canonical_repository_url": item["canonical_url"],
            "host": item["host"],
            "owner": item["owner"],
            "repository_name": item["repo_name"],
            "known_candidate_commits_json": _json(sorted(commits[repo])),
            "licence_checked_commit": item["checked_commit"] or "",
            "licence_identifier_or_expression": item["license_id"] or "",
            "licence_category": item["category"] or "unable_to_verify_provenance",
            "licence_evidence_path": item["evidence_path"] or "",
            "licence_evidence_url": item["evidence_url"] or "",
            "licence_evidence_sha256": item["evidence_sha256"] or "",
            "licence_verification_date": item["verification_date"] or "",
            "phase26_inclusion_status": item["inclusion_status"] or "quarantined",
            "identity_relationships_json": _json(
                [
                    {
                        "left": rel["left_repo"], "right": rel["right_repo"],
                        "type": rel["relationship"], "authority": rel["authority_class"],
                    }
                    for rel in rels
                ]
            ),
            "provenance_confidence": "revision_specific" if item["checked_commit"] and item["evidence_sha256"] else "incomplete",
            "review_status": "human_legal_review_required",
            "unresolved_questions": (
                "Confirm licence/NOTICE/copyright obligations at every used revision; "
                "confirm canonical identity, fork/mirror/rename history, and redistribution obligations."
            ),
            "legal_clearance_decision": "",
            "reviewer_identity": "",
            "review_date": "",
            "review_rationale": "",
        }
        all_rows.append(record)
        if repo in pilot:
            detail = pilot[repo]
            pilot_record = dict(record)
            pilot_record.update(
                {
                    "pilot_rows": int(detail["pilot_rows"]),
                    "pilot_commits": int(detail["pilot_commits"]),
                    "rows_matching_licence_checked_commit": int(detail["exact_revision_rows"]),
                    "rows_at_other_commits": int(detail["other_revision_rows"]),
                    "cohort_description": "proposed_candidate_cohort",
                }
            )
            pilot_rows.append(pilot_record)
    return all_rows, pilot_rows


def _duplicate_review(connection: sqlite3.Connection) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    groups: list[dict[str, Any]] = []
    members_csv: list[dict[str, Any]] = []
    conflicts = connection.execute(
        "SELECT * FROM duplicate_groups WHERE labels>1 ORDER BY group_id"
    )
    for group in conflicts:
        members: list[dict[str, Any]] = []
        query = (
            "SELECT c.method_change_id,c.file_change_id,c.method_name,c.signature,c.before_change,"
            "c.language,c.commit_hash,c.primary_repo,c.repo_ambiguous,c.cves_json,c.code_sha256,"
            "c.normalized_sha256,c.canonical_sha256,p.classification pair_classification "
            "FROM duplicate_members m JOIN candidates c USING(method_change_id) "
            "LEFT JOIN pair_groups p ON p.file_change_id=c.file_change_id "
            "AND p.logical_key=COALESCE(NULLIF(c.signature,''),NULLIF(c.method_name,'')) "
            "WHERE m.group_id=? ORDER BY c.method_change_id"
        )
        for item in connection.execute(query, (group["group_id"],)):
            member = dict(item)
            member["existing_label_semantics"] = (
                "vulnerable_pre_fix" if item["before_change"] == "True" else "fixed_post_fix"
            )
            members.append(member)
            members_csv.append(
                {
                    "duplicate_group_id": group["group_id"],
                    **member,
                    "why_conflict": "same exact source-code SHA-256 occurs with both vulnerable and fixed labels",
                    "quarantine_reason": "conflicting_or_ambiguous_exact_duplicate",
                    "review_question": (
                        "Is the conflict explained by pair state, repository context, aliasing, or label noise?"
                    ),
                    "review_decision": "",
                    "reviewer_identity": "",
                    "review_date": "",
                    "review_rationale": "",
                    "review_evidence_reference": "",
                }
            )
        groups.append(
            {
                "duplicate_group_id": group["group_id"],
                "occurrences": int(group["occurrences"]),
                "repositories": int(group["repositories"]),
                "labels": int(group["labels"]),
                "cves": int(group["cves"]),
                "commits": int(group["commits"]),
                "categories": json.loads(group["categories_json"]),
                "quarantine_reason": "conflicting_or_ambiguous_exact_duplicate",
                "why_conflict": "identical code fingerprint is associated with both before_change values",
                "suggested_reviewer_questions": [
                    "Does the same text have different semantics because repository or call context differs?",
                    "Is this a vulnerable/fixed state reuse or pairing artifact?",
                    "Do repository aliases or mirrors explain repeated evidence?",
                    "Is either source label unsupported by the fixing commit and diff?",
                ],
                "members": members,
                "review_decision": "",
                "reviewer_identity": "",
                "review_date": "",
                "review_rationale": "",
                "review_evidence_reference": "",
            }
        )
    return groups, members_csv


def _manifest_audit(connection: sqlite3.Connection) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for item in connection.execute(
        "SELECT s.method_change_id,s.component_id,s.split,s.seed,c.language,c.before_change,"
        "c.primary_repo,c.commit_hash,c.cves_json,c.code_sha256,c.normalized_sha256,c.canonical_sha256,"
        "l.checked_commit,l.license_id,l.category,l.evidence_path,l.evidence_sha256,l.inclusion_status "
        "FROM split_manifest s JOIN candidates c USING(method_change_id) "
        "LEFT JOIN licenses l ON l.repo_url=c.primary_repo ORDER BY s.split,s.component_id,s.method_change_id"
    ):
        exact_revision = bool(item["checked_commit"] and item["checked_commit"] == item["commit_hash"])
        rows.append(
            {
                "method_change_id": item["method_change_id"],
                "component_id": item["component_id"],
                "split": item["split"],
                "seed": item["seed"],
                "language": item["language"],
                "before_change": item["before_change"],
                "label_semantics": "vulnerable_pre_fix" if item["before_change"] == "True" else "fixed_post_fix",
                "repository_url": item["primary_repo"],
                "source_commit": item["commit_hash"],
                "cves_json": item["cves_json"],
                "code_sha256": item["code_sha256"],
                "normalized_sha256": item["normalized_sha256"],
                "canonical_sha256": item["canonical_sha256"],
                "licence_checked_commit": item["checked_commit"] or "",
                "licence_identifier": item["license_id"] or "",
                "licence_category": item["category"] or "",
                "licence_evidence_path": item["evidence_path"] or "",
                "licence_evidence_sha256": item["evidence_sha256"] or "",
                "licence_evidence_matches_source_revision": exact_revision,
                "phase26_inclusion_status": item["inclusion_status"] or "",
                "cohort_description": "proposed_candidate_cohort",
                "legal_clearance_decision": "",
                "reviewer_identity": "",
                "review_date": "",
                "review_rationale": "",
            }
        )

    split_distribution: dict[str, dict[str, Any]] = {}
    for split in ("train", "validation", "test"):
        selected = [row for row in rows if row["split"] == split]
        sizes = list(Counter(row["component_id"] for row in selected).values())
        split_distribution[split] = {
            "rows": len(selected),
            "labels": dict(Counter(row["label_semantics"] for row in selected)),
            "languages": dict(Counter(row["language"] for row in selected)),
            "groups": len(sizes),
            "group_size": {
                "min": min(sizes, default=0), "median": median(sizes) if sizes else 0,
                "p90": _percentile(sizes, 0.90), "max": max(sizes, default=0),
            },
        }
    group_sizes = list(Counter(row["component_id"] for row in rows).values())
    groups = [
        {"group_id": group_id, "size": size}
        for group_id, size in Counter(row["component_id"] for row in rows).items()
    ]
    expected = deterministic_group_split(groups, seed=42)
    actual = {row["component_id"]: row["split"] for row in rows}
    canonical = "\n".join(
        f"{row['method_change_id']}|{row['component_id']}|{row['split']}|{row['seed']}" for row in rows
    )
    checks = {
        "rows": len(rows),
        "repositories": len({row["repository_url"] for row in rows}),
        "commits": len({row["source_commit"] for row in rows}),
        "groups": len(group_sizes),
        "all_rows_have_repository_and_commit": all(row["repository_url"] and row["source_commit"] for row in rows),
        "all_rows_have_supported_label_and_language": all(
            row["before_change"] in {"True", "False"} and row["language"] in {"C", "C++"} for row in rows
        ),
        "conflicting_duplicate_rows_included": int(
            connection.execute(
                "SELECT COUNT(*) FROM split_manifest s JOIN duplicate_members m USING(method_change_id) "
                "JOIN duplicate_groups g USING(group_id) WHERE g.quarantine=1"
            ).fetchone()[0]
        ),
        "non_permissive_phase26_rows_included": sum(row["licence_category"] != "explicit_permissive" for row in rows),
        "licence_evidence_exact_revision_rows": sum(row["licence_evidence_matches_source_revision"] for row in rows),
        "licence_evidence_other_revision_rows": sum(not row["licence_evidence_matches_source_revision"] for row in rows),
        "components_crossing_splits": int(
            connection.execute(
                "SELECT COUNT(*) FROM (SELECT component_id FROM split_manifest GROUP BY component_id "
                "HAVING COUNT(DISTINCT split)>1)"
            ).fetchone()[0]
        ),
        "deterministic_seed_42_reproduction": expected == actual,
        "manifest_sha256": hashlib.sha256(canonical.encode()).hexdigest(),
        "split_distribution": split_distribution,
        "overall_group_size": {
            "min": min(group_sizes, default=0), "median": median(group_sizes) if group_sizes else 0,
            "p90": _percentile(group_sizes, 0.90), "max": max(group_sizes, default=0),
        },
    }
    return rows, checks


def _review_decisions(manifest: dict[str, Any]) -> list[dict[str, Any]]:
    decisions = [
        {
            "gate": "source_revision_provenance", "status": "BLOCKED",
            "decision_question": "Can the dirty working-tree code used for successful extraction and later analysis be frozen and independently identified?",
            "evidence": "Extraction metadata records HEAD 89387d0, while the required FK-order fix first appears in commit 7baaaa5 and analysis reports include later uncommitted changes.",
            "decision_options": "accept a separately hashed source bundle; rerun extraction from a frozen revision; retain blocker",
            "effect_if_unresolved": f"all {manifest['rows']} proposed rows remain non-frozen", "required_reviewer_role": "data engineering owner",
        },
        {
            "gate": "official_count_methodology", "status": "REQUIRES_REVIEW",
            "decision_question": "What exact aggregation produced the official 138,974 function count?",
            "evidence": "Official record publishes 138,974; restored rows=277,948; Phase 2.6 logical groups=198,985.",
            "decision_options": "obtain author query/methodology; document release convention; retain unresolved mismatch",
            "effect_if_unresolved": f"all {manifest['rows']} rows retain dataset-methodology caveat", "required_reviewer_role": "CVEfixes maintainer or dataset methodologist",
        },
        {
            "gate": "duplicate_conflict_review", "status": "BLOCKED",
            "decision_question": "For each of 381 exact-code conflicting-label groups, is the conflict explained or must it stay excluded?",
            "evidence": "Per-member repository, commit, CVE, pair, label, signature, and fingerprint ledger.",
            "decision_options": "confirm quarantine; document context-specific validity; correct only with source-diff evidence",
            "effect_if_unresolved": "conflicting groups remain quarantined; proposed cohort stays unchanged", "required_reviewer_role": "security dataset reviewer",
        },
        {
            "gate": "repository_identity_coverage", "status": "REQUIRES_REVIEW",
            "decision_question": "Are undiscovered forks, mirrors, renames, or shared history capable of connecting current components?",
            "evidence": "4 normalized aliases and 33 cross-repository exact-code edges; provider-authoritative history is incomplete.",
            "decision_options": "obtain provider metadata/history; accept explicitly bounded risk; retain blocker",
            "effect_if_unresolved": "split is only provisionally leakage-safe", "required_reviewer_role": "repository provenance reviewer",
        },
        {
            "gate": "licence_and_legal_review", "status": "BLOCKED",
            "decision_question": "Are source use, attribution, redistribution, and future weight obligations acceptable at every used revision?",
            "evidence": f"{manifest['licence_evidence_exact_revision_rows']} rows match the checked licence revision; {manifest['licence_evidence_other_revision_rows']} do not.",
            "decision_options": "clear with documented obligations; require more revision evidence; exclude affected repositories/rows",
            "effect_if_unresolved": f"none of the {manifest['rows']} rows is represented as legally cleared", "required_reviewer_role": "qualified legal/licensing reviewer",
        },
    ]
    for decision in decisions:
        decision.update(
            {
                "review_decision": "", "reviewer_identity": "", "reviewer_role": "",
                "review_date": "", "review_rationale": "", "evidence_reference": "",
            }
        )
    return decisions


def generate_phase27(
    raw_database: Path,
    curation_database: Path,
    reports_dir: Path,
    provenance: dict[str, Any],
) -> dict[str, Any]:
    """Generate review-only Phase 2.7 reports and ledgers from immutable inputs."""
    reports_dir.mkdir(parents=True, exist_ok=True)
    evidence_dir = reports_dir / "phase_2_7_evidence"
    evidence_dir.mkdir(parents=True, exist_ok=True)
    raw_stat_before = (raw_database.stat().st_size, raw_database.stat().st_mtime_ns)
    curated = _open_immutable(curation_database)
    raw = _open_immutable(raw_database)
    try:
        counts = _count_evidence(raw, curated)
        all_repositories, pilot_repositories = _repository_ledgers(curated)
        duplicate_groups, duplicate_members = _duplicate_review(curated)
        relationship_map, relationship_rows = _relationship_maps(curated)
        del relationship_map
        manifest_rows, manifest = _manifest_audit(curated)
        clone_counts = {
            row["edge_type"]: int(row["n"])
            for row in curated.execute("SELECT edge_type,COUNT(*) n FROM clone_edges GROUP BY edge_type")
        }
    finally:
        raw.close()
        curated.close()
    if (raw_database.stat().st_size, raw_database.stat().st_mtime_ns) != raw_stat_before:
        raise RuntimeError("raw database changed during Phase 2.7 read-only review")

    decisions = _review_decisions(manifest)

    _write_json(evidence_dir / "phase_2_7_count_methodology.json", counts)
    _write_json(evidence_dir / "phase_2_7_provenance.json", provenance)
    _write_csv(evidence_dir / "phase_2_7_repository_licence_ledger.csv", all_repositories)
    _write_json(evidence_dir / "phase_2_7_repository_licence_ledger.json", all_repositories)
    _write_csv(evidence_dir / "phase_2_7_pilot_repository_licence_ledger.csv", pilot_repositories)
    _write_json(evidence_dir / "phase_2_7_pilot_repository_licence_ledger.json", pilot_repositories)
    _write_csv(evidence_dir / "phase_2_7_duplicate_review_members.csv", duplicate_members)
    _write_json(evidence_dir / "phase_2_7_duplicate_review_groups.json", duplicate_groups)
    _write_csv(evidence_dir / "phase_2_7_repository_relationships.csv", relationship_rows)
    _write_json(evidence_dir / "phase_2_7_repository_relationships.json", relationship_rows)
    _write_csv(evidence_dir / "phase_2_7_proposed_candidate_cohort.csv", manifest_rows)
    _write_json(evidence_dir / "phase_2_7_proposed_candidate_cohort.json", manifest_rows)
    _write_json(evidence_dir / "phase_2_7_manifest_audit.json", manifest)
    _write_csv(evidence_dir / "phase_2_7_human_decisions.csv", decisions)
    _write_json(evidence_dir / "phase_2_7_human_decisions.json", decisions)

    diff_rows = provenance.get("changed_files", [])
    diff_table = _table(
        [(row["status"], row["path"], row["impact"]) for row in diff_rows],
        ("Status", "Path", "Potential impact"),
    ) if diff_rows else "No committed file differences were found."
    (reports_dir / "phase_2_7_provenance_reconciliation.md").write_text(f"""# Phase 2.7 Provenance Reconciliation

## Status: BLOCKED

| Revision role | Identity |
|---|---|
| Extraction metadata HEAD | `{provenance['extraction_revision']}` |
| Phase 2.6 analysis source | **UNRESOLVED** — analysis ran from a changing, dirty working tree |
| Current checked-out revision | `{provenance['current_revision']}` |
| Current branch | `{provenance['branch']}` |

Both commits exist locally: extraction={provenance['extraction_revision_exists']}, current={provenance['current_revision_exists']}.

{diff_table}

The only committed difference between the recorded extraction HEAD and current
HEAD is the foreign-key-safe batch-order fix in `phase26.py`. That fix can affect
whether extraction succeeds and is present in the successfully used working
tree, but not in the recorded commit. Later analysis/report changes are also
uncommitted. The extraction HEAD alone therefore does not identify the exact
source state used. Reflog and hashes are preserved in the machine-readable
provenance ledger; no repository state was changed during this investigation.
""", encoding="utf-8")

    pair_table = _table(
        [(row["classification"], row["groups"], row["before_rows"], row["after_rows"]) for row in counts["phase26_pair_cardinality"]],
        ("Classification", "Groups", "Before rows", "After rows"),
    )
    (reports_dir / "phase_2_7_count_methodology_review.md").write_text(f"""# Phase 2.7 Count Methodology Review

## Status: REQUIRES_REVIEW

- Official v1.0.8 statement: **138,974 functions**.
- Physical `method_change` rows: **{counts['physical_method_rows']:,}**.
- Phase 2.6 `(file_change_id, signature-or-name)` groups: **{counts['phase26_logical_groups']:,}**.
- C/C++ groups: `{_json(counts['c_cpp_pair_cardinality'])}`.

{pair_table}

The [Zenodo v1.0.8 record]({ZENODO_URL}) and [official README]({README_URL})
state that source before and after changing 138,974 functions is included. The
[data dictionary]({DATA_DICTIONARY_URL}) defines method rows, file relationships,
and `before_change`, but supplies no aggregation query for that published count.
The exact queries used here are preserved in `phase_2_7_count_methodology.json`.

The arithmetic factor of two is an observation, not evidence that every
published function has exactly two stored rows. The observed 78,963 complete
global pairs plus unmatched groups do not reproduce 138,974. Multiple CVEs,
duplicate text, repository mappings, and method versions are reported
separately. The official semantic method remains unresolved and requires author
or methodology-owner clarification.
""", encoding="utf-8")

    exact = manifest["licence_evidence_exact_revision_rows"]
    mismatch = manifest["licence_evidence_other_revision_rows"]
    (reports_dir / "phase_2_7_pilot_licence_review.md").write_text(f"""# Phase 2.7 Pilot Licence and Provenance Review

## Status: BLOCKED — human legal review required

- All repository identities inventoried: **{len(all_repositories):,}**.
- Pilot repository identities: **{len(pilot_repositories):,}**.
- Proposed rows whose source commit equals the licence-checked commit: **{exact:,}**.
- Proposed rows at another commit in the same repository: **{mismatch:,}**.

Phase 2.6 classified the pilot repositories as having clear permissive evidence
at one relevant commit. That does not establish historical licence continuity,
NOTICE/copyright obligations, or legal clearance for every other commit. The
ledgers retain exact URLs, commits, evidence paths, hashes, classifications,
aliases, and empty human-decision fields. No repository or row is represented
as legally cleared by this automated inventory.
""", encoding="utf-8")

    (reports_dir / "phase_2_7_duplicate_manual_review.md").write_text(f"""# Phase 2.7 Duplicate Manual Review

## Status: BLOCKED — 381 human decisions outstanding

The queue contains **{len(duplicate_groups):,} conflicting exact-code groups**
and **{len(duplicate_members):,} traceable member rows**. Each record includes
repository, commit, CVE, signature, label semantics, pairing evidence, hashes,
the existing quarantine reason, review questions, and empty decision fields.
No winning label was selected and every unresolved group remains quarantined.
""", encoding="utf-8")

    repo_edge_counts = Counter(row["relationship"] for row in relationship_rows)
    (reports_dir / "phase_2_7_repository_relationship_review.md").write_text(f"""# Phase 2.7 Repository Relationship Review

## Status: REQUIRES_REVIEW — leakage safety is provisional

- Repository edges: `{_json(dict(repo_edge_counts))}`.
- Method-level clone edges: `{_json(clone_counts)}`.

Canonical URL normalization evidence is deterministic but is not a substitute
for provider-authoritative fork, rename, archive, mirror, redirect, or full Git
history metadata. Cross-repository exact-code and method clone edges are
similarity evidence, not authoritative identity proof. No claim is made that all
relationships have been discovered. Any new relationship must trigger component
reconstruction and a fresh split audit.
""", encoding="utf-8")

    split_rows = []
    for split, detail in manifest["split_distribution"].items():
        split_rows.append((split, detail["rows"], detail["groups"], _json(detail["labels"]), _json(detail["languages"]), _json(detail["group_size"])))
    (reports_dir / "phase_2_7_pilot_manifest_audit.md").write_text(f"""# Phase 2.7 Pilot Manifest Audit

## Status: PASS for automated integrity; BLOCKED for provenance/legal freeze

The manifest remains a **proposed_candidate_cohort**, not an approved training dataset.

{_table(split_rows, ('Split','Rows','Groups','Labels','Languages','Group-size distribution'))}

- Rows: **{manifest['rows']:,}**; repositories: **{manifest['repositories']:,}**;
  commits: **{manifest['commits']:,}**; connected groups: **{manifest['groups']:,}**.
- Repository/commit provenance complete: `{manifest['all_rows_have_repository_and_commit']}`.
- Supported labels/languages complete: `{manifest['all_rows_have_supported_label_and_language']}`.
- Quarantined conflicting rows included: **{manifest['conflicting_duplicate_rows_included']}**.
- Components crossing splits: **{manifest['components_crossing_splits']}**.
- Seed-42 assignment reproduced: `{manifest['deterministic_seed_42_reproduction']}`.
- Manifest SHA-256: `{manifest['manifest_sha256']}`.
- Exact-revision licence evidence: **{exact:,}** rows; other revision: **{mismatch:,}** rows.

No labels or cohort membership were changed.
""", encoding="utf-8")

    decision_rows = "\n".join(
        f"| {item['gate']} | {item['status']} | {item['required_reviewer_role']} | {item['effect_if_unresolved']} |"
        for item in decisions
    )
    (reports_dir / "phase_2_7_human_review_index.md").write_text(f"""# Phase 2.7 Human Review Index

## Overall status: BLOCKED

| Decision gate | Status | Required reviewer | Effect if unresolved |
|---|---|---|---|
{decision_rows}

Exact questions, evidence, neutral decision options, and empty reviewer fields
are in `phase_2_7_human_decisions.csv/json`. Automated checks do not constitute
human or legal approval.
""", encoding="utf-8")

    (reports_dir / "phase_2_7_training_readiness.md").write_text(f"""# Phase 2.7 Training Readiness

## Overall status: BLOCKED

| Gate | Status |
|---|---|
| Source revision provenance | BLOCKED — successful extraction is not identified by a clean immutable revision |
| Official count methodology | REQUIRES_REVIEW — published semantic count not reproduced |
| Label semantics | PASS for documented encoding; unmatched/context cases remain quarantined |
| Duplicate conflict review | BLOCKED — 381 human reviews outstanding |
| Repository identity coverage | REQUIRES_REVIEW — provider-authoritative history incomplete |
| Licence and legal review | BLOCKED — no automated legal clearance; {mismatch:,} rows lack exact-revision licence evidence |
| Pilot-row source provenance | PASS — repository and fixing commit present for every row |
| Leakage prevention | PASS PROVISIONALLY against collected evidence |
| Manifest reproducibility | PASS — seed 42 reproduced, SHA-256 `{manifest['manifest_sha256']}` |
| Model training | NOT STARTED / PROHIBITED IN PHASE 2.7 |

The candidate cohort remains **2,225 rows**, unchanged. It is described only as
`proposed_candidate_cohort`. Training may not begin until every required human
and legal gate has evidence-backed closure.
""", encoding="utf-8")

    summary = {
        "generated_utc": datetime.now(timezone.utc).isoformat(),
        "overall_status": "BLOCKED",
        "cohort_description": "proposed_candidate_cohort",
        "cohort_rows": manifest["rows"],
        "cohort_changed": False,
        "rows_added": 0,
        "rows_removed": 0,
        "count_evidence": counts,
        "manifest": manifest,
        "provenance": provenance,
        "raw_database_unchanged": True,
        "training_performed": False,
    }
    _write_json(evidence_dir / "phase_2_7_summary.json", summary)
    return summary
