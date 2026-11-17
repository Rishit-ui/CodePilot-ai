from __future__ import annotations

import sqlite3
from pathlib import Path

import pytest

from securescan_ml.curation import (
    DiskGuard,
    classify_license_text,
    deterministic_group_split,
    normalize_repository_url,
    open_readonly,
)
from securescan_ml.phase26 import (
    build_components_and_split,
    derive_clone_edges,
    derive_pairs_and_duplicates,
    derive_repository_edges,
    extract_metadata,
)


def build_raw_database(path: Path) -> None:
    connection = sqlite3.connect(path)
    connection.executescript(
        """
        CREATE TABLE repository(repo_url TEXT);
        CREATE TABLE commits(hash TEXT, repo_url TEXT);
        CREATE TABLE fixes(cve_id TEXT, hash TEXT, repo_url TEXT);
        CREATE TABLE file_change(
          file_change_id TEXT, hash TEXT, filename TEXT, old_path TEXT,
          new_path TEXT, change_type TEXT, programming_language TEXT
        );
        CREATE TABLE method_change(
          method_change_id TEXT, file_change_id TEXT, name TEXT,
          signature TEXT, before_change TEXT, code TEXT
        );
        """
    )
    repos = [
        "https://github.com/Example/A.git",
        "git@github.com:Example/B.git",
        "https://gitlab.com/Example/C",
    ]
    connection.executemany("INSERT INTO repository VALUES(?)", [(repo,) for repo in repos])
    connection.executemany(
        "INSERT INTO commits VALUES(?,?)", [("h1", repos[0]), ("h2", repos[1]), ("h3", repos[2])]
    )
    connection.executemany(
        "INSERT INTO fixes VALUES(?,?,?)",
        [("CVE-A", "h1", repos[0]), ("CVE-B", "h2", repos[1]), ("CVE-C", "h3", repos[2])],
    )
    connection.executemany(
        "INSERT INTO file_change VALUES(?,?,?,?,?,?,?)",
        [
            ("f1", "h1", "a.c", "a.c", "a.c", "MODIFY", "C"),
            ("f2", "h2", "b.c", "b.c", "b.c", "MODIFY", "C"),
            ("f3", "h3", "c.cpp", "c.cpp", "c.cpp", "MODIFY", "C++"),
        ],
    )
    exact = "int unsafe(int x) { return x; }"
    connection.executemany(
        "INSERT INTO method_change VALUES(?,?,?,?,?,?)",
        [
            ("m1", "f1", "unsafe", "unsafe(int)", "True", exact),
            ("m2", "f1", "unsafe", "unsafe(int)", "False", exact),
            ("m3", "f2", "unsafe", "unsafe(int)", "True", exact),
            ("m4", "f3", "parse", "parse(char*)", "True", "int parse(char* p){return p[0];}"),
            ("m5", "f3", "parse", "parse(char*)", "False", "int parse(char* p){if(!p)return 0;return p[0];}"),
        ],
    )
    connection.commit()
    connection.close()


def test_repository_alias_normalization() -> None:
    assert normalize_repository_url("git@github.com:Example/Repo.git") == "https://github.com/example/repo"
    assert normalize_repository_url("https://www.github.com/example/repo/") == "https://github.com/example/repo"
    assert normalize_repository_url("https://gitlab.com/Org/Repo.git") == "https://gitlab.com/org/repo"


def test_license_classification_and_quarantine_semantics() -> None:
    assert classify_license_text("Permission is hereby granted, free of charge")[0] == "MIT"
    assert classify_license_text("GNU GENERAL PUBLIC LICENSE Version 3")[1] == "copyleft"
    assert classify_license_text("private terms only") == ("UNKNOWN", "ambiguous_or_custom")


def test_readonly_database_rejects_writes(tmp_path: Path) -> None:
    path = tmp_path / "raw.sqlite"
    connection = sqlite3.connect(path)
    connection.execute("CREATE TABLE example(value TEXT)")
    connection.commit()
    connection.close()
    readonly = open_readonly(path)
    with pytest.raises(sqlite3.OperationalError):
        readonly.execute("INSERT INTO example VALUES('forbidden')")
    readonly.close()


def test_disk_guard_stops_below_floor(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    usage = type("Usage", (), {"free": 10})()
    monkeypatch.setattr("securescan_ml.curation.shutil.disk_usage", lambda _: usage)
    with pytest.raises(RuntimeError, match="safety floor"):
        DiskGuard(tmp_path, minimum_free_gib=1).check("fixture")


def test_deterministic_group_split_preserves_groups() -> None:
    groups = [{"group_id": f"g{i}", "size": size} for i, size in enumerate((10, 8, 5, 4, 3, 2, 1))]
    first = deterministic_group_split(groups, seed=42)
    second = deterministic_group_split(groups, seed=42)
    assert first == second
    assert set(first) == {group["group_id"] for group in groups}
    assert set(first.values()) <= {"train", "validation", "test"}


def test_duplicate_conflict_pair_and_leakage_pipeline(tmp_path: Path) -> None:
    raw = tmp_path / "raw.sqlite"
    curated = tmp_path / "curated.sqlite"
    build_raw_database(raw)
    original = (raw.stat().st_size, raw.stat().st_mtime_ns)
    guard = DiskGuard(tmp_path, minimum_free_gib=0)
    extracted = extract_metadata(raw, curated, guard, "fixture-head")
    assert extracted["c_cpp_candidates"] == 5
    assert (raw.stat().st_size, raw.stat().st_mtime_ns) == original

    audit = derive_pairs_and_duplicates(curated, guard)
    assert audit["duplicate_summary"]["duplicate_groups"] == 1
    assert audit["duplicate_summary"]["conflicting_label_groups"] == 1
    assert audit["pair_group_counts"]["one_to_one"] == 2
    derive_clone_edges(curated, guard)
    derive_repository_edges(curated)

    connection = sqlite3.connect(curated)
    for repo in connection.execute("SELECT repo_url FROM repositories").fetchall():
        connection.execute(
            "INSERT INTO licenses VALUES(?,?,?,?,?,?,?,?,?,?)",
            (repo[0], "fixture", "MIT", "explicit_permissive", "LICENSE", "fixture", "hash", "2026-11-17", "approved_pilot", "fixture"),
        )
    connection.commit()
    connection.close()

    result = build_components_and_split(curated, guard, seed=42)
    assert result["quarantined_rows"] == 3
    connection = sqlite3.connect(curated)
    pair_splits = connection.execute(
        "SELECT method_change_id,split FROM split_manifest WHERE method_change_id IN ('m4','m5')"
    ).fetchall()
    assert len(pair_splits) == 2
    assert len({row[1] for row in pair_splits}) == 1
    leaked = connection.execute(
        "SELECT component_id,COUNT(DISTINCT split) FROM split_manifest GROUP BY component_id HAVING COUNT(DISTINCT split)>1"
    ).fetchall()
    assert leaked == []
    assert connection.execute("SELECT COUNT(*) FROM split_manifest WHERE method_change_id IN ('m1','m2','m3')").fetchone()[0] == 0
    connection.close()

