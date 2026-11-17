from __future__ import annotations

import json
import sqlite3
from pathlib import Path

from securescan_ml.curation import create_schema, deterministic_group_split
from securescan_ml.phase27 import _duplicate_review, _manifest_audit, _review_decisions


def build_review_fixture(path: Path) -> sqlite3.Connection:
    connection = sqlite3.connect(path)
    connection.row_factory = sqlite3.Row
    create_schema(connection)
    repos = [
        ("https://github.com/example/a", "https://github.com/example/a", "github.com", "example", "a", 1),
        ("https://github.com/example/b", "https://github.com/example/b", "github.com", "example", "b", 1),
    ]
    connection.executemany("INSERT INTO repositories VALUES(?,?,?,?,?,?)", repos)
    connection.executemany(
        "INSERT INTO all_methods VALUES(?,?,?,?,?,?,?)",
        [
            ("m1", "f1", "parse", "parse(int)", "True", "parse(int)", 1),
            ("m2", "f2", "parse", "parse(int)", "False", "parse(int)", 1),
        ],
    )
    candidates = [
        ("m1", "f1", "parse", "parse(int)", "True", "C", "h1", "MODIFY", "a.c", "a.c", repos[0][0], 0, '["CVE-1"]', "same", "n1", "c1", "0", b"", 4, 20),
        ("m2", "f2", "parse", "parse(int)", "False", "C++", "h2", "MODIFY", "b.cpp", "b.cpp", repos[1][0], 0, '["CVE-2"]', "same", "n2", "c2", "0", b"", 4, 20),
    ]
    connection.executemany("INSERT INTO candidates VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)", candidates)
    connection.executemany(
        "INSERT INTO licenses VALUES(?,?,?,?,?,?,?,?,?,?)",
        [
            (repos[0][0], "h1", "MIT", "explicit_permissive", "LICENSE", "url", "sha", "2026-11-17", "approved_pilot", "fixture"),
            (repos[1][0], "different", "MIT", "explicit_permissive", "LICENSE", "url", "sha", "2026-11-17", "approved_pilot", "fixture"),
        ],
    )
    groups = [{"group_id": "g1", "size": 1}, {"group_id": "g2", "size": 1}]
    assignments = deterministic_group_split(groups, seed=42)
    connection.executemany(
        "INSERT INTO components VALUES(?,?,?,?)",
        [("m1", "g1", 1, None), ("m2", "g2", 1, None)],
    )
    connection.executemany(
        "INSERT INTO split_manifest VALUES(?,?,?,?)",
        [("m1", "g1", assignments["g1"], 42), ("m2", "g2", assignments["g2"], 42)],
    )
    connection.execute(
        "INSERT INTO duplicate_groups VALUES(?,?,?,?,?,?,?,?,?,?)",
        ("exact:same", "same", 2, 2, 2, 2, 2, 2, '["B_conflicting_labels","F_ambiguous_or_unresolved"]', 1),
    )
    connection.executemany(
        "INSERT INTO duplicate_members VALUES(?,?)", [("exact:same", "m1"), ("exact:same", "m2")]
    )
    connection.commit()
    return connection


def test_manifest_audit_preserves_cohort_and_reports_revision_gap(tmp_path: Path) -> None:
    connection = build_review_fixture(tmp_path / "review.sqlite")
    rows, audit = _manifest_audit(connection)
    assert len(rows) == 2
    assert audit["deterministic_seed_42_reproduction"] is True
    assert audit["components_crossing_splits"] == 0
    assert audit["licence_evidence_exact_revision_rows"] == 1
    assert audit["licence_evidence_other_revision_rows"] == 1
    assert all(row["cohort_description"] == "proposed_candidate_cohort" for row in rows)
    assert all(row["legal_clearance_decision"] == "" for row in rows)
    connection.close()


def test_duplicate_queue_never_selects_a_winning_label(tmp_path: Path) -> None:
    connection = build_review_fixture(tmp_path / "review.sqlite")
    groups, members = _duplicate_review(connection)
    assert len(groups) == 1
    assert {member["before_change"] for member in members} == {"True", "False"}
    assert groups[0]["review_decision"] == ""
    assert all(member["review_decision"] == "" for member in members)
    assert "winning_label" not in json.dumps(groups)
    connection.close()


def test_human_gate_fields_remain_empty() -> None:
    decisions = _review_decisions(
        {"rows": 2, "licence_evidence_exact_revision_rows": 1, "licence_evidence_other_revision_rows": 1}
    )
    assert all(decision["status"] in {"BLOCKED", "REQUIRES_REVIEW"} for decision in decisions)
    assert all(decision["review_decision"] == "" for decision in decisions)
    assert all(decision["review_rationale"] == "" for decision in decisions)
