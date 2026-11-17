"""Phase 2.6 curation pipeline for the read-only CVEfixes database."""

from __future__ import annotations

import csv
import hashlib
import itertools
import json
import os
import sqlite3
import sys
from collections import Counter, defaultdict
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import date, datetime, timezone
from pathlib import Path
from typing import Any, Iterable
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from .curation import (
    DiskGuard,
    UnionFind,
    classify_license_text,
    create_schema,
    deterministic_group_split,
    fingerprint_code,
    json_list,
    normalize_repository_url,
    open_readonly,
    split_repository_url,
    unpack_signature,
)


LICENSE_PATHS = (
    "LICENSE",
    "LICENSE.md",
    "LICENSE.txt",
    "COPYING",
    "COPYING.md",
    "COPYING.txt",
    "NOTICE",
    "NOTICE.txt",
)


def _valid_key(value: Any) -> str:
    text = "" if value is None else str(value).strip()
    return "" if text.lower() in {"", "nan", "none"} else text


def _insert_batches(connection: sqlite3.Connection, sql: str, rows: list[tuple[Any, ...]]) -> None:
    if rows:
        connection.executemany(sql, rows)
        rows.clear()


def extract_metadata(raw_db: Path, curation_db: Path, guard: DiskGuard, source_head: str) -> dict[str, Any]:
    """Stream raw metadata and C/C++ fingerprints into a compact derived store."""
    guard.check("Phase 2.6 extraction")
    if curation_db.exists():
        raise FileExistsError(f"refusing to overwrite {curation_db}")
    raw_before = (raw_db.stat().st_size, raw_db.stat().st_mtime_ns)
    raw = open_readonly(raw_db)
    derived = sqlite3.connect(curation_db)
    try:
        create_schema(derived)
        derived.execute("PRAGMA journal_mode=WAL")
        derived.execute("PRAGMA synchronous=FULL")
        commits_by_hash: dict[str, list[str]] = defaultdict(list)
        commit_counts: Counter[str] = Counter()
        for row in raw.execute("SELECT hash, repo_url FROM commits"):
            repo = str(row["repo_url"] or "")
            commits_by_hash[str(row["hash"])].append(repo)
            commit_counts[repo] += 1
        fixes: dict[tuple[str, str], set[str]] = defaultdict(set)
        for row in raw.execute("SELECT repo_url, hash, cve_id FROM fixes"):
            fixes[(str(row["repo_url"]), str(row["hash"]))].add(str(row["cve_id"]))

        c_files: dict[str, tuple[str, str, str, str, str]] = {}
        for row in raw.execute(
            "SELECT file_change_id, hash, programming_language, change_type, old_path, new_path FROM file_change "
            "WHERE programming_language IN ('C','C++')"
        ):
            c_files[str(row["file_change_id"])] = (
                str(row["hash"]),
                str(row["programming_language"]),
                str(row["change_type"] or ""),
                str(row["old_path"] or ""),
                str(row["new_path"] or ""),
            )

        method_rows: list[tuple[Any, ...]] = []
        candidate_rows: list[tuple[Any, ...]] = []
        candidate_repo_rows: list[tuple[str, str]] = []
        used_repos: set[str] = set()
        total_methods = 0
        candidates = 0
        cursor = raw.execute(
            "SELECT method_change_id, file_change_id, name, signature, "
            "before_change, code FROM method_change"
        )
        for row in cursor:
            total_methods += 1
            method_id = str(row["method_change_id"])
            file_id = str(row["file_change_id"])
            name = _valid_key(row["name"])
            signature = _valid_key(row["signature"])
            logical_key = signature or name
            before = str(row["before_change"])
            stored_key = logical_key or f"__unkeyed__:{method_id}"
            method_rows.append((method_id, file_id, name, signature, before, stored_key, int(bool(logical_key))))
            if len(method_rows) >= 1_000:
                _insert_batches(
                    derived,
                    "INSERT INTO all_methods VALUES(?,?,?,?,?,?,?)",
                    method_rows,
                )

            if file_id not in c_files:
                continue
            commit_hash, language, change_type, old_path, new_path = c_files[file_id]
            repos = sorted(set(commits_by_hash.get(commit_hash, ())))
            primary_repo = repos[0] if len(repos) == 1 else None
            cves: set[str] = set()
            for repo in repos:
                used_repos.add(repo)
                cves.update(fixes.get((repo, commit_hash), ()))
                candidate_repo_rows.append((method_id, repo))
            code = "" if row["code"] is None else str(row["code"])
            evidence = fingerprint_code(code)
            candidate_rows.append(
                (
                    method_id,
                    file_id,
                    name,
                    signature,
                    before,
                    language,
                    commit_hash,
                    change_type,
                    old_path,
                    new_path,
                    primary_repo,
                    int(len(repos) != 1),
                    json_list(cves),
                    evidence["code_sha256"],
                    evidence["normalized_sha256"],
                    evidence["canonical_sha256"],
                    evidence["simhash64"],
                    evidence["minhash"],
                    evidence["token_count"],
                    evidence["code_chars"],
                )
            )
            candidates += 1
            if len(candidate_rows) >= 500:
                # Candidate rows reference all_methods. Flush any smaller
                # metadata batch first so the derived-store FK is satisfied.
                _insert_batches(
                    derived,
                    "INSERT INTO all_methods VALUES(?,?,?,?,?,?,?)",
                    method_rows,
                )
                _insert_batches(
                    derived,
                    "INSERT INTO candidates VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                    candidate_rows,
                )
                _insert_batches(
                    derived,
                    "INSERT OR IGNORE INTO candidate_repositories VALUES(?,?)",
                    candidate_repo_rows,
                )
                derived.commit()
                if candidates % 2_000 == 0:
                    guard.check(f"candidate {candidates}")
                    print(f"extract: candidates={candidates} methods={total_methods}", flush=True)

        _insert_batches(derived, "INSERT INTO all_methods VALUES(?,?,?,?,?,?,?)", method_rows)
        _insert_batches(
            derived,
            "INSERT INTO candidates VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
            candidate_rows,
        )
        _insert_batches(
            derived,
            "INSERT OR IGNORE INTO candidate_repositories VALUES(?,?)",
            candidate_repo_rows,
        )

        repo_rows: list[tuple[Any, ...]] = []
        for repo in sorted(used_repos):
            canonical = normalize_repository_url(repo)
            host, owner, name = split_repository_url(repo)
            repo_rows.append((repo, canonical, host, owner, name, commit_counts[repo]))
        derived.executemany("INSERT INTO repositories VALUES(?,?,?,?,?,?)", repo_rows)
        metadata = {
            "raw_database": str(raw_db.resolve()),
            "raw_database_bytes": raw_before[0],
            "raw_database_mtime_ns": raw_before[1],
            "source_head": source_head,
            "created_utc": datetime.now(timezone.utc).isoformat(),
            "all_method_rows": total_methods,
            "c_cpp_candidates": candidates,
            "repository_identities": len(used_repos),
        }
        derived.executemany(
            "INSERT INTO metadata(key,value) VALUES(?,?)",
            [(key, json.dumps(value)) for key, value in metadata.items()],
        )
        derived.commit()
    finally:
        raw.close()
        derived.close()
    raw_after = (raw_db.stat().st_size, raw_db.stat().st_mtime_ns)
    if raw_after != raw_before:
        raise RuntimeError("raw database changed during read-only extraction")
    guard.check("post-extraction")
    return metadata


def _pair_classification(before: int, after: int, has_key: bool) -> str:
    if not has_key:
        return "unkeyed"
    if before == 1 and after == 1:
        return "one_to_one"
    if before == 0:
        return "unmatched_after"
    if after == 0:
        return "unmatched_before"
    if before == 1 and after > 1:
        return "one_to_many"
    if before > 1 and after == 1:
        return "many_to_one"
    return "many_to_many"


def derive_pairs_and_duplicates(curation_db: Path, guard: DiskGuard) -> dict[str, Any]:
    guard.check("pair and duplicate derivation")
    connection = sqlite3.connect(curation_db)
    connection.row_factory = sqlite3.Row
    pair_counts: Counter[str] = Counter()
    try:
        connection.execute("DELETE FROM pair_groups")
        rows = connection.execute(
            "SELECT file_change_id, logical_key, has_pair_key, "
            "SUM(before_change='True') before_count, SUM(before_change='False') after_count, "
            "COUNT(*) member_count FROM all_methods "
            "GROUP BY file_change_id, logical_key, has_pair_key"
        )
        inserts = []
        for row in rows:
            classification = _pair_classification(
                int(row["before_count"]), int(row["after_count"]), bool(row["has_pair_key"])
            )
            pair_counts[classification] += 1
            group_id = hashlib.sha256(
                f"{row['file_change_id']}\0{row['logical_key']}\0{row['has_pair_key']}".encode()
            ).hexdigest()
            inserts.append(
                (
                    group_id,
                    row["file_change_id"],
                    row["logical_key"],
                    row["before_count"],
                    row["after_count"],
                    classification,
                    row["member_count"],
                )
            )
            if len(inserts) >= 1_000:
                connection.executemany("INSERT INTO pair_groups VALUES(?,?,?,?,?,?,?)", inserts)
                inserts.clear()
        if inserts:
            connection.executemany("INSERT INTO pair_groups VALUES(?,?,?,?,?,?,?)", inserts)

        connection.execute("DELETE FROM duplicate_members")
        connection.execute("DELETE FROM duplicate_groups")
        duplicate_summary: Counter[str] = Counter()
        hashes = connection.execute(
            "SELECT code_sha256, COUNT(*) occurrences FROM candidates "
            "GROUP BY code_sha256 HAVING COUNT(*)>1 ORDER BY code_sha256"
        )
        for index, item in enumerate(hashes, start=1):
            members = list(
                connection.execute(
                    "SELECT method_change_id,file_change_id,signature,method_name,before_change,"
                    "commit_hash,primary_repo,repo_ambiguous,cves_json,normalized_sha256 "
                    "FROM candidates WHERE code_sha256=? ORDER BY method_change_id",
                    (item["code_sha256"],),
                )
            )
            labels = {row["before_change"] for row in members}
            repos = {row["primary_repo"] for row in members if row["primary_repo"]}
            commits = {row["commit_hash"] for row in members}
            cves = {cve for row in members for cve in json.loads(row["cves_json"])}
            normalized = {row["normalized_sha256"] for row in members}
            logical = {
                (row["file_change_id"], _valid_key(row["signature"]) or _valid_key(row["method_name"]))
                for row in members
            }
            categories = []
            categories.append("A_identical_code_identical_label" if len(labels) == 1 else "B_conflicting_labels")
            categories.append("C_cross_repository" if len(repos) > 1 else "D_same_repository_repeat")
            if len(logical) == 1 and labels == {"True", "False"}:
                categories.append("E_same_logical_method_before_after")
            if len(labels) > 1 or any(row["repo_ambiguous"] for row in members):
                categories.append("F_ambiguous_or_unresolved")
            quarantine = int("B_conflicting_labels" in categories or "F_ambiguous_or_unresolved" in categories)
            group_id = f"exact:{item['code_sha256']}"
            connection.execute(
                "INSERT INTO duplicate_groups VALUES(?,?,?,?,?,?,?,?,?,?)",
                (
                    group_id,
                    item["code_sha256"],
                    len(members),
                    len(repos),
                    len(labels),
                    len(cves),
                    len(commits),
                    len(normalized),
                    json.dumps(categories, separators=(",", ":")),
                    quarantine,
                ),
            )
            connection.executemany(
                "INSERT INTO duplicate_members VALUES(?,?)",
                [(group_id, row["method_change_id"]) for row in members],
            )
            duplicate_summary["groups"] += 1
            duplicate_summary["rows"] += len(members)
            if len(labels) > 1:
                duplicate_summary["conflicting_groups"] += 1
            if len(repos) > 1:
                duplicate_summary["cross_repository_groups"] += 1
            if index % 100 == 0:
                guard.check(f"duplicate group {index}")
        connection.commit()
    finally:
        connection.close()
    return {"pair_group_counts": dict(pair_counts), "duplicate_summary": dict(duplicate_summary)}


def _sketch_similarity(left: bytes, right: bytes) -> float:
    a, b = set(unpack_signature(left)), set(unpack_signature(right))
    return len(a & b) / len(a | b) if a or b else 1.0


def derive_clone_edges(curation_db: Path, guard: DiskGuard, max_bucket: int = 500) -> dict[str, int]:
    guard.check("clone derivation")
    connection = sqlite3.connect(curation_db)
    connection.row_factory = sqlite3.Row
    try:
        connection.execute("DELETE FROM clone_edges")
        rows = list(
            connection.execute(
                "SELECT method_change_id,code_sha256,normalized_sha256,canonical_sha256,"
                "simhash64,minhash,token_count,code_chars FROM candidates ORDER BY method_change_id"
            )
        )
        index = {row["method_change_id"]: row for row in rows}
        inserted: set[tuple[str, str, str]] = set()

        def add(left: str, right: str, edge_type: str, confidence: str, evidence: dict[str, Any]) -> None:
            if left > right:
                left, right = right, left
            key = (left, right, edge_type)
            if left == right or key in inserted:
                return
            inserted.add(key)
            connection.execute(
                "INSERT INTO clone_edges VALUES(?,?,?,?,?)",
                (left, right, edge_type, confidence, json.dumps(evidence, sort_keys=True)),
            )

        for column, edge_type in (
            ("normalized_sha256", "normalized_exact"),
            ("canonical_sha256", "canonical_type2"),
        ):
            groups: dict[str, list[str]] = defaultdict(list)
            for row in rows:
                groups[row[column]].append(row["method_change_id"])
            for digest, members in groups.items():
                exact_hashes = {index[item]["code_sha256"] for item in members}
                if len(members) < 2 or len(exact_hashes) == 1:
                    continue
                representative = members[0]
                for member in members[1:]:
                    if edge_type == "canonical_type2" and min(index[representative]["token_count"], index[member]["token_count"]) < 20:
                        continue
                    add(representative, member, edge_type, "high", {"digest": digest})

        buckets: dict[tuple[int, int], list[str]] = defaultdict(list)
        for row in rows:
            value = int(row["simhash64"], 16)
            for band in range(4):
                buckets[(band, (value >> (16 * band)) & 0xFFFF)].append(row["method_change_id"])
        candidate_pairs: set[tuple[str, str]] = set()
        capped_buckets = 0
        for members in buckets.values():
            if len(members) > max_bucket:
                capped_buckets += 1
                continue
            candidate_pairs.update(tuple(sorted(pair)) for pair in itertools.combinations(members, 2))
        verified = 0
        for number, (left_id, right_id) in enumerate(sorted(candidate_pairs), start=1):
            left, right = index[left_id], index[right_id]
            if left["code_sha256"] == right["code_sha256"] or left["canonical_sha256"] == right["canonical_sha256"]:
                continue
            distance = (int(left["simhash64"], 16) ^ int(right["simhash64"], 16)).bit_count()
            if distance > 3 or min(left["token_count"], right["token_count"]) < 20:
                continue
            length_ratio = min(left["token_count"], right["token_count"]) / max(left["token_count"], right["token_count"])
            similarity = _sketch_similarity(left["minhash"], right["minhash"])
            if length_ratio >= 0.85 and similarity >= 0.85:
                add(
                    left_id,
                    right_id,
                    "verified_near_clone",
                    "medium",
                    {"simhash_distance": distance, "bottom_k_similarity": round(similarity, 6), "length_ratio": round(length_ratio, 6)},
                )
                verified += 1
            if number % 100_000 == 0:
                guard.check(f"near-clone candidate {number}")
        connection.commit()
        return {
            "candidate_pairs": len(candidate_pairs),
            "verified_near_clone_edges": verified,
            "all_clone_edges": len(inserted),
            "capped_lsh_buckets": capped_buckets,
        }
    finally:
        connection.close()


def derive_repository_edges(curation_db: Path) -> dict[str, int]:
    connection = sqlite3.connect(curation_db)
    connection.row_factory = sqlite3.Row
    counts: Counter[str] = Counter()
    try:
        connection.execute("DELETE FROM repository_edges")
        repos = list(connection.execute("SELECT repo_url,canonical_url FROM repositories"))
        canonical_groups: dict[str, list[str]] = defaultdict(list)
        for row in repos:
            canonical_groups[row["canonical_url"]].append(row["repo_url"])

        def add(left: str, right: str, relationship: str, confidence: str, evidence: dict[str, Any]) -> None:
            if left > right:
                left, right = right, left
            if left == right:
                return
            connection.execute(
                "INSERT OR IGNORE INTO repository_edges VALUES(?,?,?,?,?)",
                (left, right, relationship, confidence, json.dumps(evidence, sort_keys=True)),
            )
            if connection.execute("SELECT changes()").fetchone()[0]:
                counts[relationship] += 1

        for canonical, members in canonical_groups.items():
            for left, right in itertools.combinations(sorted(members), 2):
                add(left, right, "canonical_url_alias", "high", {"canonical_url": canonical})

        shared_commits = connection.execute(
            "SELECT commit_hash, GROUP_CONCAT(DISTINCT repo_url) repos "
            "FROM candidates c JOIN candidate_repositories r USING(method_change_id) "
            "GROUP BY commit_hash HAVING COUNT(DISTINCT repo_url)>1"
        )
        for row in shared_commits:
            members = sorted(row["repos"].split(","))
            for left, right in itertools.combinations(members, 2):
                add(left, right, "shared_git_commit", "high", {"commit": row["commit_hash"]})

        cross_exact = connection.execute(
            "SELECT d.group_id, GROUP_CONCAT(DISTINCT r.repo_url) repos "
            "FROM duplicate_groups d JOIN duplicate_members m USING(group_id) "
            "JOIN candidate_repositories r USING(method_change_id) "
            "WHERE d.repositories>1 GROUP BY d.group_id"
        )
        for row in cross_exact:
            members = sorted(row["repos"].split(","))
            for left, right in itertools.combinations(members, 2):
                add(left, right, "cross_repo_exact_code", "medium", {"duplicate_group": row["group_id"]})
        connection.commit()
        return dict(counts)
    finally:
        connection.close()


def _license_urls(repo_url: str, commit: str) -> list[tuple[str, str]]:
    host, owner, name = split_repository_url(repo_url)
    if not owner or not name:
        return []
    if host == "github.com":
        return [(path, f"https://raw.githubusercontent.com/{owner}/{name}/{commit}/{path}") for path in LICENSE_PATHS]
    if host == "gitlab.com":
        return [(path, f"https://gitlab.com/{owner}/{name}/-/raw/{commit}/{path}") for path in LICENSE_PATHS]
    if host == "bitbucket.org":
        return [(path, f"https://bitbucket.org/{owner}/{name}/raw/{commit}/{path}") for path in LICENSE_PATHS]
    return []


def _fetch_license(repo_url: str, commit: str, timeout: int = 12) -> dict[str, str]:
    errors: list[str] = []
    for path, url in _license_urls(repo_url, commit):
        request = Request(url, headers={"User-Agent": "CodePilot-SecureScan-Research/2.6", "Accept": "text/plain"})
        try:
            with urlopen(request, timeout=timeout) as response:
                raw = response.read(1_000_001)
                if len(raw) > 1_000_000:
                    errors.append(f"{path}:over_1mb")
                    continue
                text = raw.decode("utf-8", errors="replace")
                license_id, category = classify_license_text(text)
                return {
                    "license_id": license_id,
                    "category": category,
                    "evidence_path": path,
                    "evidence_url": response.geturl(),
                    "evidence_sha256": hashlib.sha256(raw).hexdigest(),
                    "error": "",
                }
        except HTTPError as exc:
            if exc.code not in {404, 410}:
                errors.append(f"{path}:http_{exc.code}")
        except (URLError, TimeoutError, OSError) as exc:
            errors.append(f"{path}:{type(exc).__name__}")
    host, _, _ = split_repository_url(repo_url)
    return {
        "license_id": "NOT_FOUND" if host in {"github.com", "gitlab.com", "bitbucket.org"} else "UNSUPPORTED_HOST",
        "category": "no_license_found" if host in {"github.com", "gitlab.com", "bitbucket.org"} else "unable_to_verify_provenance",
        "evidence_path": "",
        "evidence_url": "",
        "evidence_sha256": "",
        "error": ";".join(errors[:8]),
    }


def audit_licenses(curation_db: Path, guard: DiskGuard, workers: int = 8) -> dict[str, int]:
    guard.check("licence audit")
    connection = sqlite3.connect(curation_db)
    connection.row_factory = sqlite3.Row
    try:
        repositories = list(
            connection.execute(
                "SELECT r.repo_url, MIN(c.commit_hash) commit_hash FROM repositories r "
                "JOIN candidate_repositories cr USING(repo_url) "
                "JOIN candidates c USING(method_change_id) GROUP BY r.repo_url ORDER BY r.repo_url"
            )
        )
        results: dict[str, dict[str, str]] = {}
        with ThreadPoolExecutor(max_workers=workers) as executor:
            futures = {
                executor.submit(_fetch_license, row["repo_url"], row["commit_hash"]): row
                for row in repositories
            }
            for number, future in enumerate(as_completed(futures), start=1):
                row = futures[future]
                try:
                    results[row["repo_url"]] = future.result()
                except Exception as exc:  # inventory the failure; never silently approve
                    results[row["repo_url"]] = {
                        "license_id": "ERROR",
                        "category": "unable_to_verify_provenance",
                        "evidence_path": "",
                        "evidence_url": "",
                        "evidence_sha256": "",
                        "error": f"{type(exc).__name__}:{exc}",
                    }
                if number % 50 == 0:
                    guard.check(f"licence repository {number}")
                    print(f"licence: {number}/{len(repositories)}", flush=True)
        connection.execute("DELETE FROM licenses")
        today = date.today().isoformat()
        counts: Counter[str] = Counter()
        for row in repositories:
            result = results[row["repo_url"]]
            approved = result["category"] == "explicit_permissive"
            status = "approved_pilot" if approved else "quarantine_requires_review"
            reason = "clear permissive evidence at fix commit" if approved else result["category"]
            if result["error"]:
                reason += f"; {result['error']}"
            connection.execute(
                "INSERT INTO licenses VALUES(?,?,?,?,?,?,?,?,?,?)",
                (
                    row["repo_url"],
                    row["commit_hash"],
                    result["license_id"],
                    result["category"],
                    result["evidence_path"],
                    result["evidence_url"],
                    result["evidence_sha256"],
                    today,
                    status,
                    reason,
                ),
            )
            counts[result["category"]] += 1
        connection.commit()
        return dict(counts)
    finally:
        connection.close()


def build_components_and_split(curation_db: Path, guard: DiskGuard, seed: int = 42) -> dict[str, Any]:
    guard.check("component and split generation")
    connection = sqlite3.connect(curation_db)
    connection.row_factory = sqlite3.Row
    try:
        candidates = list(
            connection.execute(
                "SELECT method_change_id,file_change_id,signature,method_name,before_change,"
                "commit_hash,primary_repo,repo_ambiguous,cves_json,code_sha256,"
                "normalized_sha256,canonical_sha256 FROM candidates ORDER BY method_change_id"
            )
        )
        uf = UnionFind(row["method_change_id"] for row in candidates)

        def union_groups(key_function) -> None:
            seen: dict[Any, str] = {}
            for row in candidates:
                key = key_function(row)
                if not key:
                    continue
                if key in seen:
                    uf.union(seen[key], row["method_change_id"])
                else:
                    seen[key] = row["method_change_id"]

        union_groups(lambda row: ("repo", row["primary_repo"]) if row["primary_repo"] else None)
        union_groups(lambda row: ("commit", row["commit_hash"]))
        union_groups(lambda row: ("exact", row["code_sha256"]))
        union_groups(lambda row: ("normalized", row["normalized_sha256"]))
        union_groups(lambda row: ("canonical", row["canonical_sha256"]))
        union_groups(
            lambda row: (
                "pair",
                row["file_change_id"],
                _valid_key(row["signature"]) or _valid_key(row["method_name"]),
            )
            if (_valid_key(row["signature"]) or _valid_key(row["method_name"]))
            else None
        )
        cve_owner: dict[str, str] = {}
        for row in candidates:
            for cve in json.loads(row["cves_json"]):
                if cve in cve_owner:
                    uf.union(cve_owner[cve], row["method_change_id"])
                else:
                    cve_owner[cve] = row["method_change_id"]
        for row in connection.execute("SELECT left_method,right_method FROM clone_edges"):
            uf.union(row["left_method"], row["right_method"])

        repo_methods: dict[str, list[str]] = defaultdict(list)
        for row in candidates:
            if row["primary_repo"]:
                repo_methods[row["primary_repo"]].append(row["method_change_id"])
        for edge in connection.execute("SELECT left_repo,right_repo FROM repository_edges"):
            left = repo_methods.get(edge["left_repo"], [])
            right = repo_methods.get(edge["right_repo"], [])
            if left and right:
                uf.union(left[0], right[0])

        conflict_methods = {
            row[0]
            for row in connection.execute(
                "SELECT method_change_id FROM duplicate_members m JOIN duplicate_groups g USING(group_id) "
                "WHERE g.quarantine=1"
            )
        }
        license_status = {
            row["repo_url"]: row["inclusion_status"]
            for row in connection.execute("SELECT repo_url,inclusion_status FROM licenses")
        }
        reasons: dict[str, list[str]] = defaultdict(list)
        groups: dict[str, list[sqlite3.Row]] = defaultdict(list)
        for row in candidates:
            root = uf.find(row["method_change_id"])
            groups[root].append(row)
            if row["method_change_id"] in conflict_methods:
                reasons[root].append("conflicting_or_ambiguous_exact_duplicate")
            if row["repo_ambiguous"] or not row["primary_repo"]:
                reasons[root].append("ambiguous_repository_mapping")
            elif license_status.get(row["primary_repo"]) != "approved_pilot":
                reasons[root].append("repository_not_in_permissive_pilot_allowlist")
            if row["before_change"] not in {"True", "False"}:
                reasons[root].append("unsupported_label")

        connection.execute("DELETE FROM components")
        component_rows: list[dict[str, object]] = []
        root_to_component: dict[str, str] = {}
        for root, members in sorted(groups.items()):
            component_id = "component:" + hashlib.sha256(
                "\n".join(sorted(row["method_change_id"] for row in members)).encode()
            ).hexdigest()
            root_to_component[root] = component_id
            reason = ";".join(sorted(set(reasons[root]))) or None
            approved = int(reason is None)
            component_rows.append({"group_id": component_id, "size": len(members), "approved": approved})
            connection.executemany(
                "INSERT INTO components VALUES(?,?,?,?)",
                [(row["method_change_id"], component_id, approved, reason) for row in members],
            )
        approved_groups = [row for row in component_rows if row["approved"]]
        assignments = deterministic_group_split(approved_groups, seed=seed)
        connection.execute("DELETE FROM split_manifest")
        for row in connection.execute(
            "SELECT method_change_id,component_id FROM components WHERE approved=1 ORDER BY method_change_id"
        ):
            connection.execute(
                "INSERT INTO split_manifest VALUES(?,?,?,?)",
                (row["method_change_id"], row["component_id"], assignments[row["component_id"]], seed),
            )
        connection.commit()
        split_counts = {
            row["split"]: row["count"]
            for row in connection.execute("SELECT split,COUNT(*) count FROM split_manifest GROUP BY split")
        }
        largest = max((int(row["size"]) for row in component_rows), default=0)
        return {
            "components": len(component_rows),
            "approved_components": len(approved_groups),
            "largest_component": largest,
            "split_counts": split_counts,
            "approved_rows": sum(split_counts.values()),
            "quarantined_rows": len(candidates) - sum(split_counts.values()),
            "seed": seed,
        }
    finally:
        connection.close()


def export_evidence(curation_db: Path, output_dir: Path) -> dict[str, Path]:
    output_dir.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(curation_db)
    connection.row_factory = sqlite3.Row
    outputs: dict[str, Path] = {}

    def export(name: str, sql: str, json_name: str | None = None) -> None:
        rows = [dict(row) for row in connection.execute(sql)]
        csv_path = output_dir / f"{name}.csv"
        with csv_path.open("w", newline="", encoding="utf-8") as stream:
            writer = csv.DictWriter(stream, fieldnames=list(rows[0]) if rows else ["empty"])
            writer.writeheader()
            writer.writerows(rows)
        json_path = output_dir / (json_name or f"{name}.json")
        json_path.write_text(json.dumps(rows, indent=2, sort_keys=True), encoding="utf-8")
        outputs[csv_path.name] = csv_path
        outputs[json_path.name] = json_path

    try:
        export(
            "phase_2_6_conflicting_duplicates",
            """
            SELECT g.group_id,g.occurrences,g.repositories,g.labels,g.cves,g.commits,
                   g.categories_json,m.method_change_id,c.before_change,c.language,
                   c.commit_hash,c.primary_repo,c.cves_json,c.code_sha256,
                   c.normalized_sha256,c.canonical_sha256
            FROM duplicate_groups g JOIN duplicate_members m USING(group_id)
            JOIN candidates c USING(method_change_id)
            WHERE g.labels>1 ORDER BY g.group_id,m.method_change_id
            """,
        )
        export(
            "phase_2_6_repository_inventory",
            """
            SELECT r.*,l.checked_commit,l.license_id,l.category,l.evidence_path,
                   l.evidence_url,l.evidence_sha256,l.verification_date,
                   l.inclusion_status,l.reason
            FROM repositories r LEFT JOIN licenses l USING(repo_url)
            ORDER BY r.repo_url
            """,
        )
        export(
            "phase_2_6_repository_relationships",
            "SELECT * FROM repository_edges ORDER BY left_repo,right_repo,relationship",
        )
        export(
            "phase_2_6_split_manifest",
            """
            SELECT s.method_change_id,s.component_id,s.split,s.seed,
                   c.language,c.before_change,c.primary_repo,c.commit_hash,c.cves_json,
                   c.code_sha256,c.normalized_sha256,c.canonical_sha256
            FROM split_manifest s JOIN candidates c USING(method_change_id)
            ORDER BY s.split,s.component_id,s.method_change_id
            """,
        )
        export(
            "phase_2_6_quarantine",
            """
            SELECT x.method_change_id,x.component_id,x.quarantine_reason,
                   c.language,c.before_change,c.primary_repo,c.commit_hash,c.cves_json,
                   c.code_sha256,c.normalized_sha256,c.canonical_sha256
            FROM components x JOIN candidates c USING(method_change_id)
            WHERE x.approved=0 ORDER BY x.component_id,x.method_change_id
            """,
        )
    finally:
        connection.close()
    return outputs


def collect_summary(curation_db: Path) -> dict[str, Any]:
    connection = sqlite3.connect(curation_db)
    connection.row_factory = sqlite3.Row
    try:
        scalar = lambda sql: connection.execute(sql).fetchone()[0]
        return {
            "all_method_rows": scalar("SELECT COUNT(*) FROM all_methods"),
            "before_counts": {row["before_change"]: row["n"] for row in connection.execute("SELECT before_change,COUNT(*) n FROM all_methods GROUP BY before_change")},
            "logical_functions": scalar("SELECT COUNT(*) FROM pair_groups"),
            "pair_classifications": {
                row["classification"]: {
                    "groups": row["groups"],
                    "before_rows": row["before_rows"],
                    "after_rows": row["after_rows"],
                }
                for row in connection.execute(
                    "SELECT classification,COUNT(*) groups,SUM(before_count) before_rows,"
                    "SUM(after_count) after_rows FROM pair_groups GROUP BY classification"
                )
            },
            "candidate_rows": scalar("SELECT COUNT(*) FROM candidates"),
            "candidate_labels": {row["before_change"]: row["n"] for row in connection.execute("SELECT before_change,COUNT(*) n FROM candidates GROUP BY before_change")},
            "candidate_change_labels": [
                dict(row)
                for row in connection.execute(
                    "SELECT change_type,before_change,COUNT(*) rows FROM candidates "
                    "GROUP BY change_type,before_change ORDER BY change_type,before_change"
                )
            ],
            "empty_or_tiny_candidates": scalar(
                "SELECT COUNT(*) FROM candidates WHERE token_count<2 OR code_chars<5"
            ),
            "languages": {row["language"]: row["n"] for row in connection.execute("SELECT language,COUNT(*) n FROM candidates GROUP BY language")},
            "repositories": scalar("SELECT COUNT(*) FROM repositories"),
            "duplicates": dict(connection.execute("SELECT COUNT(*) groups,COALESCE(SUM(occurrences),0) rows,SUM(labels>1) conflicts,SUM(repositories>1) cross_repo FROM duplicate_groups").fetchone()),
            "clone_edges": {row["edge_type"]: row["n"] for row in connection.execute("SELECT edge_type,COUNT(*) n FROM clone_edges GROUP BY edge_type")},
            "repository_edges": {row["relationship"]: row["n"] for row in connection.execute("SELECT relationship,COUNT(*) n FROM repository_edges GROUP BY relationship")},
            "licenses": {row["category"]: row["n"] for row in connection.execute("SELECT category,COUNT(*) n FROM licenses GROUP BY category")},
            "approved_repositories": scalar("SELECT COUNT(*) FROM licenses WHERE inclusion_status='approved_pilot'"),
            "components": scalar("SELECT COUNT(DISTINCT component_id) FROM components"),
            "largest_component": scalar("SELECT COALESCE(MAX(n),0) FROM (SELECT COUNT(*) n FROM components GROUP BY component_id)"),
            "quarantined_rows": scalar("SELECT COUNT(*) FROM components WHERE approved=0"),
            "split_counts": {row["split"]: row["n"] for row in connection.execute("SELECT split,COUNT(*) n FROM split_manifest GROUP BY split")},
        }
    finally:
        connection.close()

