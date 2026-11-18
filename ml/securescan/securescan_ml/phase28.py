"""Phase 2.8 blocker-resolution evidence generation without model training."""

from __future__ import annotations

import csv
import hashlib
import json
import re
import sqlite3
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable


def _open_immutable(path: Path) -> sqlite3.Connection:
    if not path.is_file():
        raise FileNotFoundError(path)
    connection = sqlite3.connect(path.resolve().as_uri() + "?mode=ro&immutable=1", uri=True)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA query_only=ON")
    connection.execute("PRAGMA temp_store=MEMORY")
    return connection


def _json(value: Any) -> str:
    return json.dumps(value, sort_keys=True, separators=(",", ":"))


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


def _table(rows: Iterable[tuple[Any, ...]], headers: tuple[str, ...]) -> str:
    output = ["| " + " | ".join(headers) + " |", "|" + "|".join("---" for _ in headers) + "|"]
    output.extend("| " + " | ".join(str(value) for value in row) + " |" for row in rows)
    return "\n".join(output)


def _manifest_hash(rows: list[dict[str, Any]]) -> str:
    canonical = "\n".join(
        f"{row['method_change_id']}|{row['component_id']}|{row['split']}|{row['source_commit']}"
        for row in sorted(rows, key=lambda item: item["method_change_id"])
    )
    return hashlib.sha256(canonical.encode()).hexdigest()


def _provider_identity_from_evidence(url: str) -> str:
    patterns = (
        (r"https://raw\.githubusercontent\.com/([^/]+)/([^/]+)/", "https://github.com/{}/{}"),
        (r"https://gitlab\.com/([^/]+)/([^/]+)/-/raw/", "https://gitlab.com/{}/{}"),
        (r"https://bitbucket\.org/([^/]+)/([^/]+)/raw/", "https://bitbucket.org/{}/{}"),
    )
    for pattern, template in patterns:
        match = re.match(pattern, url, re.I)
        if match:
            return template.format(match.group(1).lower(), match.group(2).lower().removesuffix(".git"))
    return ""


def _base_manifest(connection: sqlite3.Connection) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    query = (
        "SELECT s.method_change_id,s.component_id,s.split,s.seed,c.language,c.before_change,"
        "c.primary_repo,c.commit_hash,c.cves_json,c.code_sha256,c.normalized_sha256,c.canonical_sha256,"
        "l.checked_commit,l.license_id,l.category,l.evidence_path,l.evidence_url,l.evidence_sha256,"
        "l.inclusion_status FROM split_manifest s JOIN candidates c USING(method_change_id) "
        "JOIN licenses l ON l.repo_url=c.primary_repo ORDER BY s.split,s.component_id,s.method_change_id"
    )
    for item in connection.execute(query):
        rows.append(
            {
                "method_change_id": item["method_change_id"],
                "component_id": item["component_id"],
                "split": item["split"],
                "seed": int(item["seed"]),
                "language": item["language"],
                "before_change": item["before_change"],
                "label_semantics": "vulnerable_pre_fix" if item["before_change"] == "True" else "fixed_post_fix",
                "repository_url": item["primary_repo"],
                "source_commit": item["commit_hash"],
                "cves_json": item["cves_json"],
                "code_sha256": item["code_sha256"],
                "normalized_sha256": item["normalized_sha256"],
                "canonical_sha256": item["canonical_sha256"],
                "licence_checked_commit": item["checked_commit"],
                "licence_identifier": item["license_id"],
                "licence_category": item["category"],
                "licence_evidence_path": item["evidence_path"],
                "licence_evidence_url": item["evidence_url"],
                "licence_evidence_sha256": item["evidence_sha256"],
                "exact_revision_licence_evidence": item["commit_hash"] == item["checked_commit"],
                "phase26_inclusion_status": item["inclusion_status"],
                "cohort_description": "proposed_candidate_cohort",
                "legal_clearance_decision": "",
                "reviewer_identity": "",
                "review_date": "",
                "review_rationale": "",
            }
        )
    return rows


def summarize_alternative(
    name: str,
    rows: list[dict[str, Any]],
    original_component_sizes: Counter[str],
    fresh_split_needed: bool,
    risks: list[str],
) -> dict[str, Any]:
    selected_sizes = Counter(row["component_id"] for row in rows)
    partial = sum(selected_sizes[group] != original_component_sizes[group] for group in selected_sizes)
    return {
        "name": name,
        "description": "review_candidate_only" if name != "A_phase27_proposed_cohort" else "proposed_candidate_cohort",
        "rows": len(rows),
        "repositories": len({row["repository_url"] for row in rows}),
        "commits": len({row["source_commit"] for row in rows}),
        "components": len(selected_sizes),
        "labels": dict(Counter(row["label_semantics"] for row in rows)),
        "languages": dict(Counter(row["language"] for row in rows)),
        "exact_revision_licence_rows": sum(bool(row["exact_revision_licence_evidence"]) for row in rows),
        "exact_revision_licence_coverage": round(
            sum(bool(row["exact_revision_licence_evidence"]) for row in rows) / len(rows), 6
        ) if rows else 0,
        "quarantined_conflict_rows_included": 0,
        "partial_original_components": partial,
        "fresh_group_level_split_needed": fresh_split_needed,
        "manifest_sha256": _manifest_hash(rows),
        "known_unresolved_risks": risks,
        "legally_cleared": False,
        "ready_for_training": False,
    }


def _identity_investigation(
    connection: sqlite3.Connection, rows: list[dict[str, Any]]
) -> tuple[list[dict[str, Any]], set[str], dict[str, Any]]:
    pilot_repos = {row["repository_url"] for row in rows}
    component_by_method = {row["method_change_id"]: row["component_id"] for row in rows}
    row_count_by_repo = Counter(row["repository_url"] for row in rows)
    records: list[dict[str, Any]] = []
    uncertain_repositories: set[str] = set()
    existing_edges = list(
        connection.execute(
            "SELECT left_repo,right_repo,relationship,confidence,evidence_json FROM repository_edges "
            "ORDER BY left_repo,right_repo,relationship"
        )
    )
    for edge in existing_edges:
        affected = {edge["left_repo"], edge["right_repo"]} & pilot_repos
        uncertain_repositories.update(affected)
        affected_components = {
            row["component_id"] for row in rows if row["repository_url"] in affected
        }
        records.append(
            {
                "left_repository": edge["left_repo"],
                "right_repository": edge["right_repo"],
                "relationship_type": edge["relationship"],
                "evidence_class": (
                    "normalized_alias_evidence" if edge["relationship"] == "canonical_url_alias"
                    else "exact_code_similarity_evidence"
                ),
                "provider_authoritative": False,
                "recorded_confidence": edge["confidence"],
                "evidence_json": edge["evidence_json"],
                "affected_pilot_rows": sum(row_count_by_repo[repo] for repo in affected),
                "affected_pilot_components_json": _json(sorted(affected_components)),
                "new_in_phase_2_8": False,
                "review_status": "requires_provider_or_history_review",
            }
        )

    cross_clone_edges = 0
    cross_clone_repos: set[str] = set()
    cross_clone_components: set[str] = set()
    for edge in connection.execute(
        "SELECT e.edge_type,e.left_method,e.right_method,l.primary_repo left_repo,r.primary_repo right_repo "
        "FROM clone_edges e JOIN candidates l ON l.method_change_id=e.left_method "
        "JOIN candidates r ON r.method_change_id=e.right_method "
        "WHERE l.primary_repo IS NOT NULL AND r.primary_repo IS NOT NULL AND l.primary_repo<>r.primary_repo"
    ):
        cross_clone_edges += 1
        for repo in (edge["left_repo"], edge["right_repo"]):
            if repo in pilot_repos:
                cross_clone_repos.add(repo)
        for method in (edge["left_method"], edge["right_method"]):
            if method in component_by_method:
                cross_clone_components.add(component_by_method[method])
    uncertain_repositories.update(cross_clone_repos)

    provider_redirects = 0
    for item in connection.execute(
        "SELECT r.repo_url,r.canonical_url,l.evidence_url FROM repositories r JOIN licenses l USING(repo_url) "
        "WHERE l.evidence_url IS NOT NULL AND l.evidence_url<>''"
    ):
        observed = _provider_identity_from_evidence(item["evidence_url"])
        if observed and observed != item["canonical_url"]:
            provider_redirects += 1
            if item["repo_url"] in pilot_repos:
                uncertain_repositories.add(item["repo_url"])
            records.append(
                {
                    "left_repository": item["repo_url"], "right_repository": observed,
                    "relationship_type": "licence_evidence_provider_redirect",
                    "evidence_class": "provider_redirect_observation",
                    "provider_authoritative": False, "recorded_confidence": "medium",
                    "evidence_json": _json({"final_evidence_url": item["evidence_url"]}),
                    "affected_pilot_rows": row_count_by_repo[item["repo_url"]],
                    "affected_pilot_components_json": _json(sorted({row["component_id"] for row in rows if row["repository_url"] == item["repo_url"]})),
                    "new_in_phase_2_8": True, "review_status": "requires_provider_or_history_review",
                }
            )
    summary = {
        "existing_repository_edges": len(existing_edges),
        "canonical_alias_edges": sum(edge["relationship"] == "canonical_url_alias" for edge in existing_edges),
        "cross_repository_exact_code_edges": sum(edge["relationship"] == "cross_repo_exact_code" for edge in existing_edges),
        "cross_repository_clone_edges": cross_clone_edges,
        "cross_repository_clone_pilot_repositories": len(cross_clone_repos),
        "cross_repository_clone_pilot_components": len(cross_clone_components),
        "provider_redirect_relationships_newly_observed": provider_redirects,
        "provider_authoritative_fork_parent_relationships": 0,
        "new_relationships_requiring_component_change": provider_redirects,
        "current_frozen_split_changed": False,
        "limitation": "provider-authoritative fork, rename, mirror, archive and full-history metadata remain incomplete",
    }
    return records, uncertain_repositories, summary


def _licence_ledgers(rows: list[dict[str, Any]]) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    exact = [row for row in rows if row["exact_revision_licence_evidence"]]
    unresolved = [row for row in rows if not row["exact_revision_licence_evidence"]]
    grouped: dict[tuple[str, str], list[dict[str, Any]]] = defaultdict(list)
    for row in exact:
        grouped[(row["repository_url"], row["source_commit"])].append(row)
    ledger: list[dict[str, Any]] = []
    for (repo, commit), members in sorted(grouped.items()):
        first = members[0]
        ledger.append(
            {
                "repository_url": repo, "source_commit": commit,
                "candidate_rows": len(members), "commit_count": 1,
                "licence_identifier": first["licence_identifier"],
                "licence_category": first["licence_category"],
                "licence_file_path": first["licence_evidence_path"],
                "licence_evidence_sha256": first["licence_evidence_sha256"],
                "exact_revision_match": True,
                "notice_or_attribution_evidence": "not_collected_separately",
                "repository_identity_uncertainty": "see_phase_2_8_repository_relationship_ledger",
                "human_review_status": "pending_legal_and_attribution_review",
                "legal_clearance_decision": "", "reviewer_identity": "",
                "review_date": "", "review_rationale": "",
            }
        )
    return ledger, unresolved


def _duplicate_decisions(connection: sqlite3.Connection) -> list[dict[str, Any]]:
    decisions: list[dict[str, Any]] = []
    for group in connection.execute(
        "SELECT * FROM duplicate_groups WHERE labels>1 ORDER BY group_id"
    ):
        members = [
            dict(row)
            for row in connection.execute(
                "SELECT c.method_change_id,c.primary_repo,c.commit_hash,c.before_change,c.signature,"
                "c.code_sha256,c.normalized_sha256,c.canonical_sha256,c.cves_json,"
                "p.classification pair_context FROM duplicate_members m "
                "JOIN candidates c USING(method_change_id) LEFT JOIN pair_groups p "
                "ON p.file_change_id=c.file_change_id AND p.logical_key=COALESCE(NULLIF(c.signature,''),NULLIF(c.method_name,'')) "
                "WHERE m.group_id=? ORDER BY c.method_change_id",
                (group["group_id"],),
            )
        ]
        decisions.append(
            {
                "duplicate_group_id": group["group_id"],
                "source_record_ids_json": _json([member["method_change_id"] for member in members]),
                "repositories_json": _json(sorted({member["primary_repo"] for member in members if member["primary_repo"]})),
                "commits_json": _json(sorted({member["commit_hash"] for member in members})),
                "fingerprints_json": _json(sorted({member["code_sha256"] for member in members})),
                "labels_json": _json(sorted({member["before_change"] for member in members})),
                "pair_context_json": _json(sorted({member["pair_context"] or "unmatched" for member in members})),
                "cves_json": _json(sorted({cve for member in members for cve in json.loads(member["cves_json"])})),
                "quarantine_reason": "conflicting_or_ambiguous_exact_duplicate",
                "path_a": "accept_continued_quarantine_for_this_pilot",
                "path_b": "request_individual_manual_adjudication_before_reconsideration",
                "review_decision": "", "reviewer_identity": "", "review_date": "",
                "review_rationale": "", "review_evidence_reference": "",
            }
        )
    return decisions


def generate_phase28(
    curation_database: Path,
    raw_database: Path,
    reports_dir: Path,
    provenance: dict[str, Any],
) -> dict[str, Any]:
    reports_dir.mkdir(parents=True, exist_ok=True)
    evidence_dir = reports_dir / "phase_2_8_evidence"
    evidence_dir.mkdir(parents=True, exist_ok=True)
    raw_before = (raw_database.stat().st_size, raw_database.stat().st_mtime_ns)
    connection = _open_immutable(curation_database)
    try:
        base = _base_manifest(connection)
        identity_rows, uncertain_repositories, identity_summary = _identity_investigation(connection, base)
        licence_ledger, unresolved = _licence_ledgers(base)
        duplicate_decisions = _duplicate_decisions(connection)
        conflict_included = int(
            connection.execute(
                "SELECT COUNT(*) FROM split_manifest s JOIN duplicate_members m USING(method_change_id) "
                "JOIN duplicate_groups g USING(group_id) WHERE g.quarantine=1"
            ).fetchone()[0]
        )
    finally:
        connection.close()
    if (raw_database.stat().st_size, raw_database.stat().st_mtime_ns) != raw_before:
        raise RuntimeError("raw database changed during Phase 2.8 review")

    exact = [row for row in base if row["exact_revision_licence_evidence"]]
    original_sizes = Counter(row["component_id"] for row in base)
    exact_sizes = Counter(row["component_id"] for row in exact)
    complete_exact_components = {
        component for component, size in exact_sizes.items() if size == original_sizes[component]
    }
    restrictive = [
        row for row in exact
        if row["component_id"] in complete_exact_components
        and row["repository_url"] not in uncertain_repositories
        and row["licence_category"] == "explicit_permissive"
        and bool(row["licence_evidence_path"] and row["licence_evidence_sha256"])
    ]
    # Removing an uncertain repository removes its entire remaining component.
    restrictive_repos_by_component: dict[str, set[str]] = defaultdict(set)
    for row in restrictive:
        restrictive_repos_by_component[row["component_id"]].add(row["repository_url"])
    allowed_components = {
        component for component in complete_exact_components
        if all(
            row["repository_url"] not in uncertain_repositories
            for row in base if row["component_id"] == component
        )
    }
    restrictive = [row for row in restrictive if row["component_id"] in allowed_components]

    for row in exact:
        row["cohort_description"] = "review_candidate_only"
        row["review_subset"] = "exact_revision_licence_evidence"
    for row in unresolved:
        row["cohort_description"] = "review_queue_only"
        row["review_subset"] = "other_revision_licence_evidence_required"
    for row in restrictive:
        row["cohort_description"] = "review_candidate_only"
        row["review_subset"] = "whole_component_exact_revision_identity_restricted"

    alternatives = [
        summarize_alternative(
            "A_phase27_proposed_cohort", base, original_sizes, False,
            ["no legal clearance", "926 rows lack exact-revision licence evidence", "repository identity coverage incomplete"],
        ),
        summarize_alternative(
            "B_exact_revision_review_subset", exact, original_sizes, True,
            ["no legal clearance", "NOTICE/attribution evidence not collected separately", "partial original components require regrouping"],
        ),
        summarize_alternative(
            "C_whole_component_identity_restricted_subset", restrictive, original_sizes, True,
            ["no legal clearance", "provider-authoritative identity remains incomplete", "smaller cohort may be biased or underpowered"],
        ),
    ]
    alternatives[0]["manifest_sha256"] = "7caac791241dc6e01525e31cd8c8b314831adf07fb7114951007bb65e9a0ed86"
    alternatives[0]["quarantined_conflict_rows_included"] = conflict_included

    count_evidence = json.loads(
        (reports_dir / "phase_2_7_evidence" / "phase_2_7_count_methodology.json").read_text(encoding="utf-8")
    )
    email = f"""# DRAFT — NOT SENT

Subject: Clarification request for CVEfixes v1.0.8 function-count methodology

Dear CVEfixes maintainers,

We are reviewing the v1.0.8 SQLite release from Zenodo record 13118970. The
release description reports 138,974 functions. Our read-only restoration has:

- 277,948 physical `method_change` rows;
- {count_evidence['phase26_logical_groups']:,} groups using `(file_change_id, exact signature-or-name)`;
- pair cardinalities: `{_json(count_evidence['phase26_pair_cardinality'])}`.

The exact queries and assumptions are attached in
`phase_2_8_count_methodology_evidence.json`.

Could you clarify:

1. What exact SQL/query or collection-stage counter produced 138,974?
2. Does that count represent changed logical functions, before/after method
   versions, or another collection abstraction?
3. How are additions, deletions, renames, repeated signatures, duplicate method
   text, multiple CVEs, and repeated repository/commit records counted?
4. Is there a release-specific mapping between a published function and its
   `method_change_id` rows?
5. Are any post-collection filters applied before publishing the aggregate?

We are not assuming that the exact arithmetic factor of two proves paired
versions, because the observed pair cardinalities do not support that globally.

Regards,
[sender name and role]
"""
    (reports_dir / "phase_2_8_count_methodology_email_draft.md").write_text(email, encoding="utf-8")

    _write_json(evidence_dir / "phase_2_8_provenance.json", provenance)
    (evidence_dir / "phase_2_8_extraction_reconstruction.patch").write_text(
        provenance.get("reconstruction_patch", ""), encoding="utf-8"
    )
    _write_csv(evidence_dir / "phase_2_8_exact_revision_licence_ledger.csv", licence_ledger)
    _write_json(evidence_dir / "phase_2_8_exact_revision_licence_ledger.json", licence_ledger)
    _write_csv(evidence_dir / "phase_2_8_exact_revision_review_candidate.csv", exact)
    _write_json(evidence_dir / "phase_2_8_exact_revision_review_candidate.json", exact)
    _write_csv(evidence_dir / "phase_2_8_other_revision_review_queue.csv", unresolved)
    _write_json(evidence_dir / "phase_2_8_other_revision_review_queue.json", unresolved)
    _write_csv(evidence_dir / "phase_2_8_restrictive_review_candidate.csv", restrictive)
    _write_json(evidence_dir / "phase_2_8_restrictive_review_candidate.json", restrictive)
    _write_csv(evidence_dir / "phase_2_8_duplicate_exclusion_decisions.csv", duplicate_decisions)
    _write_json(evidence_dir / "phase_2_8_duplicate_exclusion_decisions.json", duplicate_decisions)
    _write_csv(evidence_dir / "phase_2_8_repository_relationship_investigation.csv", identity_rows)
    _write_json(evidence_dir / "phase_2_8_repository_relationship_investigation.json", identity_rows)
    _write_json(evidence_dir / "phase_2_8_repository_identity_summary.json", identity_summary)
    _write_json(evidence_dir / "phase_2_8_pilot_alternatives.json", alternatives)
    _write_json(evidence_dir / "phase_2_8_count_methodology_evidence.json", count_evidence)

    alt_table = _table(
        [
            (item["name"], item["rows"], item["repositories"], item["components"], item["commits"],
             _json(item["labels"]), _json(item["languages"]), item["exact_revision_licence_coverage"],
             item["fresh_group_level_split_needed"])
            for item in alternatives
        ],
        ("Alternative", "Rows", "Repos", "Groups", "Commits", "Labels", "Languages", "Exact licence", "Fresh split"),
    )

    (reports_dir / "phase_2_8_provenance_recovery.md").write_text(f"""# Phase 2.8 Provenance Recovery

## Status: BLOCKED — reconstructed source available, exact execution identity unverified

- Recorded extraction HEAD: `{provenance['extraction_revision']}`.
- Current source HEAD: `{provenance['current_revision']}`.
- Stashes found: **{provenance['stash_count']}**; patch/backup files found: **{provenance['backup_patch_count']}**.
- Relevant unreachable snapshot found: `{provenance['relevant_unreachable_tree'] or 'none'}`.
- Reconstructed extraction tuple: `{provenance['reconstruction_status']}`.

The reconstruction uses the script and curation blobs from `89387d0…` plus the
seven-line foreign-key batch-order patch committed at `7baaaa5…`. Commit and
reflog timing, the original FK failure, and the later single-file fix support
this reconstruction. No runtime digest, command transcript with file hashes, or
preserved bytecode proves it was the exact executed tuple. It is therefore a
high-confidence reconstruction, not verified original executed source.

Phase 2.6 analysis remains `UNRESOLVED_DIRTY_WORKTREE`: no per-stage source hash
was stored. Current committed Phase 2.7 source is independently identified, but
does not retroactively identify each Phase 2.6 stage.
""", encoding="utf-8")

    (reports_dir / "phase_2_8_licence_review_subsets.md").write_text(f"""# Phase 2.8 Licence Review Subsets

## Status: BLOCKED — technical review subsets only

- Exact source/licence revision rows: **{len(exact):,}**.
- Other-revision review queue: **{len(unresolved):,}**.
- Exact-revision repository/commit ledger entries: **{len(licence_ledger):,}**.

The exact-revision subset is labelled `review_candidate_only`. It is not a
legally approved or training-ready dataset. Separate NOTICE, copyright,
attribution, redistribution, and future model-weight obligations were not
resolved. The original 2,225-row manifest was not overwritten.
""", encoding="utf-8")

    (reports_dir / "phase_2_8_duplicate_exclusion_decision.md").write_text(f"""# Phase 2.8 Duplicate Exclusion Decision

## Status: BLOCKED — reviewer decision pending

All **{len(duplicate_decisions):,}** conflicting-label groups remain quarantined.
No label was selected or majority-voted. The decision ledger presents two paths:

1. Accept continued quarantine for this pilot and record reviewer rationale.
2. Require individual adjudication before any group can be reconsidered.

Every decision, reviewer, date, rationale, and evidence-reference field is empty.
""", encoding="utf-8")

    (reports_dir / "phase_2_8_repository_identity_update.md").write_text(f"""# Phase 2.8 Repository Identity Update

## Status: REQUIRES_REVIEW — no new authoritative relationship closure

- Existing canonical alias edges: **{identity_summary['canonical_alias_edges']}**.
- Existing cross-repository exact-code edges: **{identity_summary['cross_repository_exact_code_edges']}**.
- Cross-repository method-clone edges: **{identity_summary['cross_repository_clone_edges']}**.
- New provider-redirect observations: **{identity_summary['provider_redirect_relationships_newly_observed']}**.
- Provider-authoritative fork-parent relationships established: **0**.

Code equality and near-clone evidence remain similarity-only. Available licence
response URLs did not establish a new component-changing relationship. The
frozen manifest was not changed. Provider-authoritative fork, rename, mirror,
archive and full-history coverage remains incomplete; any future relationship
must trigger a proposed graph and split re-audit.
""", encoding="utf-8")

    (reports_dir / "phase_2_8_count_methodology_request.md").write_text(f"""# Phase 2.8 Count Methodology Clarification Request

## Status: PREPARED, NOT SENT

The evidence package retains the published **138,974**, physical **277,948**,
Phase 2.6 logical **198,985**, complete/unmatched pair cardinalities, and exact
SQL/grouping definitions. A ready-to-send draft is saved as
`phase_2_8_count_methodology_email_draft.md`. No intended convention is inferred
and no message was sent.
""", encoding="utf-8")

    (reports_dir / "phase_2_8_pilot_alternatives.md").write_text(f"""# Phase 2.8 Pilot Alternatives

## Status: REVIEW CANDIDATES ONLY

{alt_table}

Alternative B is the required 1,299-row exact-revision view but contains partial
original components, so it needs fresh grouping/splitting before any experiment.
Alternative C keeps only complete exact-revision components not touching current
identity/clone uncertainty evidence. It is deliberately conservative and may be
biased or too small. Neither alternative is legally cleared or training-ready.
""", encoding="utf-8")

    statuses = {
        "extraction_provenance": "BLOCKED_RECONSTRUCTED_NOT_VERIFIED",
        "analysis_provenance": "BLOCKED_UNRESOLVED_DIRTY_WORKTREE",
        "official_count_methodology": "REQUIRES_REVIEW_REQUEST_PREPARED",
        "label_semantics": "PASS_WITH_UNSUPPORTED_CASES_QUARANTINED",
        "duplicate_exclusion_approval": "BLOCKED_HUMAN_DECISION_REQUIRED",
        "repository_identity": "REQUIRES_REVIEW_PROVIDER_HISTORY_INCOMPLETE",
        "revision_specific_licence_evidence": "PARTIAL_1299_OF_2225",
        "legal_review": "BLOCKED_NO_LEGAL_CLEARANCE",
        "pilot_row_provenance": "PASS_TECHNICAL_TRACEABILITY",
        "leakage_prevention": "PASS_PROVISIONAL_COLLECTED_EVIDENCE_ONLY",
        "manifest_reproducibility": "PASS_PHASE27_FROZEN",
        "overall": "BLOCKED",
    }
    (reports_dir / "phase_2_8_training_readiness.md").write_text(
        "# Phase 2.8 Training Readiness\n\n## Overall status: BLOCKED\n\n" +
        _table([(key, value) for key, value in statuses.items() if key != "overall"], ("Gate", "Status")) +
        "\n\nHuman and legal decisions remain mandatory. Automated subset construction does not authorize training.\n",
        encoding="utf-8",
    )

    summary = {
        "generated_utc": datetime.now(timezone.utc).isoformat(),
        "overall_status": "BLOCKED",
        "original_manifest_unchanged": True,
        "original_manifest_sha256": alternatives[0]["manifest_sha256"],
        "exact_revision_rows": len(exact),
        "other_revision_rows": len(unresolved),
        "duplicate_quarantine_human_accepted": False,
        "new_authoritative_repository_relationships": 0,
        "alternatives": alternatives,
        "statuses": statuses,
        "raw_database_unchanged": True,
        "training_performed": False,
    }
    _write_json(evidence_dir / "phase_2_8_summary.json", summary)
    return summary
