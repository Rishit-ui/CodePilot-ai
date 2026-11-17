"""Run read-only CVEfixes Phase 2.5 validation and C/C++ feasibility queries."""

from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import sqlite3
import sys


EXPECTED_TABLES = (
    "cve",
    "fixes",
    "repository",
    "commits",
    "file_change",
    "method_change",
    "cwe_classification",
    "cwe",
)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--database", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--temp-dir", type=Path, required=True)
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    os.environ["TEMP"] = str(args.temp_dir)
    os.environ["TMP"] = str(args.temp_dir)
    uri = args.database.resolve().as_uri() + "?mode=ro"
    connection = sqlite3.connect(uri, uri=True)
    connection.row_factory = sqlite3.Row

    def rows(sql: str) -> list[dict[str, object]]:
        return [dict(row) for row in connection.execute(sql)]

    def one(sql: str) -> object:
        return connection.execute(sql).fetchone()[0]

    result: dict[str, object] = {
        "database": str(args.database.resolve()),
        "sqlite_version": sqlite3.sqlite_version,
        "database_bytes": args.database.stat().st_size,
    }
    try:
        connection.execute("PRAGMA temp_store=FILE")
        print("audit: schema and counts", file=sys.stderr, flush=True)
        tables = rows(
            "SELECT name, sql FROM sqlite_schema WHERE type='table' ORDER BY name"
        )
        result["tables"] = [row["name"] for row in tables]
        result["expected_tables_present"] = all(
            name in result["tables"] for name in EXPECTED_TABLES
        )
        result["table_counts"] = {
            table: one(f'SELECT COUNT(*) FROM "{table}"') for table in EXPECTED_TABLES
        }
        result["declared_primary_key_columns"] = {
            table: [row["name"] for row in rows(f'PRAGMA table_info("{table}")') if row["pk"]]
            for table in EXPECTED_TABLES
        }
        result["declared_foreign_keys"] = {
            table: rows(f'PRAGMA foreign_key_list("{table}")') for table in EXPECTED_TABLES
        }
        result["indexes"] = rows(
            "SELECT name, tbl_name, sql FROM sqlite_schema WHERE type='index' ORDER BY name"
        )

        print("audit: logical keys and relationships", file=sys.stderr, flush=True)
        result["logical_key_quality"] = rows(
            """
            SELECT 'cve.cve_id' AS logical_key, COUNT(*) AS rows,
                   SUM(cve_id IS NULL OR cve_id='') AS missing,
                   COUNT(*)-COUNT(DISTINCT cve_id) AS duplicate_rows FROM cve
            UNION ALL SELECT 'repository.repo_url', COUNT(*),
                   SUM(repo_url IS NULL OR repo_url=''),
                   COUNT(*)-COUNT(DISTINCT repo_url) FROM repository
            UNION ALL SELECT 'commits.hash', COUNT(*),
                   SUM(hash IS NULL OR hash=''),
                   COUNT(*)-COUNT(DISTINCT hash) FROM commits
            UNION ALL SELECT 'file_change.file_change_id', COUNT(*),
                   SUM(file_change_id IS NULL OR file_change_id=''),
                   COUNT(*)-COUNT(DISTINCT file_change_id) FROM file_change
            UNION ALL SELECT 'method_change.method_change_id', COUNT(*),
                   SUM(method_change_id IS NULL OR method_change_id=''),
                   COUNT(*)-COUNT(DISTINCT method_change_id) FROM method_change
            """
        )
        result["relationship_orphans"] = rows(
            """
            WITH
              cve_keys AS MATERIALIZED (SELECT DISTINCT cve_id FROM cve),
              commit_keys AS MATERIALIZED (SELECT DISTINCT repo_url, hash FROM commits),
              commit_hashes AS MATERIALIZED (SELECT DISTINCT hash FROM commits),
              repo_keys AS MATERIALIZED (SELECT DISTINCT repo_url FROM repository),
              file_keys AS MATERIALIZED (SELECT DISTINCT file_change_id FROM file_change),
              cwe_keys AS MATERIALIZED (SELECT DISTINCT cwe_id FROM cwe)
            SELECT 'fixes->cve' AS relationship, COUNT(*) AS orphan_rows
              FROM fixes x LEFT JOIN cve_keys v USING(cve_id) WHERE v.cve_id IS NULL
            UNION ALL SELECT 'fixes->commits(repo_url,hash)', COUNT(*)
              FROM fixes x LEFT JOIN commit_keys c USING(repo_url,hash) WHERE c.hash IS NULL
            UNION ALL SELECT 'commits->repository', COUNT(*)
              FROM commits c LEFT JOIN repo_keys r USING(repo_url) WHERE r.repo_url IS NULL
            UNION ALL SELECT 'file_change->commits(hash)', COUNT(*)
              FROM file_change f LEFT JOIN commit_hashes c USING(hash) WHERE c.hash IS NULL
            UNION ALL SELECT 'method_change->file_change', COUNT(*)
              FROM method_change m LEFT JOIN file_keys f USING(file_change_id)
              WHERE f.file_change_id IS NULL
            UNION ALL SELECT 'cwe_classification->cve', COUNT(*)
              FROM cwe_classification x LEFT JOIN cve_keys v USING(cve_id)
              WHERE v.cve_id IS NULL
            UNION ALL SELECT 'cwe_classification->cwe', COUNT(*)
              FROM cwe_classification x LEFT JOIN cwe_keys w USING(cwe_id)
              WHERE w.cwe_id IS NULL
            """
        )

        print("audit: C/C++ coverage and labels", file=sys.stderr, flush=True)
        result["file_language_distribution"] = rows(
            "SELECT programming_language, COUNT(*) AS file_changes "
            "FROM file_change GROUP BY programming_language ORDER BY file_changes DESC"
        )
        result["c_cpp_method_counts"] = rows(
            """
            SELECT f.programming_language, m.before_change, COUNT(*) AS methods
            FROM method_change m JOIN file_change f USING(file_change_id)
            WHERE f.programming_language IN ('C','C++')
            GROUP BY f.programming_language, m.before_change
            ORDER BY f.programming_language, m.before_change
            """
        )
        result["c_cpp_coverage"] = dict(
            connection.execute(
                """
                WITH cc AS (
                  SELECT m.method_change_id, m.file_change_id, f.hash
                  FROM method_change m JOIN file_change f USING(file_change_id)
                  WHERE f.programming_language IN ('C','C++')
                )
                SELECT
                  (SELECT COUNT(*) FROM cc) AS methods,
                  (SELECT COUNT(DISTINCT file_change_id) FROM cc) AS file_changes,
                  (SELECT COUNT(DISTINCT hash) FROM cc) AS commit_hashes,
                  (SELECT COUNT(DISTINCT c.repo_url) FROM cc
                     JOIN commits c USING(hash)) AS repositories,
                  (SELECT COUNT(DISTINCT method_change_id) FROM cc
                     JOIN commits c USING(hash)) AS methods_with_commit,
                  (SELECT COUNT(DISTINCT method_change_id) FROM cc
                     JOIN commits c USING(hash)
                     JOIN repository r ON r.repo_url=c.repo_url) AS methods_with_repository,
                  (SELECT COUNT(DISTINCT method_change_id) FROM cc
                     JOIN commits c USING(hash)
                     JOIN fixes x ON x.hash=c.hash AND x.repo_url=c.repo_url) AS methods_with_fix,
                  (SELECT COUNT(DISTINCT method_change_id) FROM cc
                     JOIN commits c USING(hash)
                     JOIN fixes x ON x.hash=c.hash AND x.repo_url=c.repo_url
                     JOIN cve v ON v.cve_id=x.cve_id) AS methods_with_cve
                """
            ).fetchone()
        )
        result["c_cpp_missing_mappings"] = dict(
            connection.execute(
                """
                WITH cc AS (
                  SELECT m.method_change_id, f.hash
                  FROM method_change m JOIN file_change f USING(file_change_id)
                  WHERE f.programming_language IN ('C','C++')
                ), commit_hashes AS MATERIALIZED (
                  SELECT DISTINCT hash FROM commits
                ), mapped_hashes AS MATERIALIZED (
                  SELECT DISTINCT c.hash FROM commits c
                  JOIN repository r ON r.repo_url=c.repo_url
                )
                SELECT
                  SUM(c.hash IS NULL) AS methods_missing_commit,
                  SUM(c.hash IS NOT NULL AND r.hash IS NULL) AS methods_missing_repository
                FROM cc
                LEFT JOIN commit_hashes c USING(hash)
                LEFT JOIN mapped_hashes r USING(hash)
                """
            ).fetchone()
        )

        print("audit: exact duplicate/conflict aggregates", file=sys.stderr, flush=True)
        result["c_cpp_exact_duplicates"] = dict(
            connection.execute(
                """
                WITH cc AS (
                  SELECT m.code, m.before_change, c.repo_url
                  FROM method_change m
                  JOIN file_change f USING(file_change_id)
                  LEFT JOIN commits c USING(hash)
                  WHERE f.programming_language IN ('C','C++')
                    AND m.code IS NOT NULL AND m.code<>'' AND m.code<>'nan'
                ), grouped AS (
                  SELECT code, COUNT(*) AS row_count,
                         COUNT(DISTINCT before_change) AS labels,
                         COUNT(DISTINCT COALESCE(repo_url,'')) AS repositories
                  FROM cc GROUP BY code HAVING COUNT(*)>1
                )
                SELECT COUNT(*) AS duplicate_groups,
                       COALESCE(SUM(row_count),0) AS duplicate_rows,
                       COALESCE(SUM(labels>1),0) AS conflicting_label_groups,
                       COALESCE(SUM(repositories>1),0) AS cross_repository_groups
                FROM grouped
                """
            ).fetchone()
        )

        print("audit: strict before/after pairing", file=sys.stderr, flush=True)
        result["c_cpp_pairing"] = dict(
            connection.execute(
                """
                WITH cc AS (
                  SELECT m.file_change_id, m.signature, m.before_change
                  FROM method_change m JOIN file_change f USING(file_change_id)
                  WHERE f.programming_language IN ('C','C++')
                ), groups AS (
                  SELECT file_change_id, signature,
                         SUM(before_change='True') AS vulnerable_rows,
                         SUM(before_change='False') AS benign_rows
                  FROM cc
                  WHERE signature IS NOT NULL AND signature<>'' AND signature<>'nan'
                  GROUP BY file_change_id, signature
                )
                SELECT
                  (SELECT COUNT(*) FROM cc WHERE before_change='True') AS vulnerable_methods,
                  (SELECT COUNT(*) FROM cc WHERE before_change='False') AS benign_methods,
                  SUM(vulnerable_rows>0 AND benign_rows>0) AS signature_pair_groups,
                  SUM(vulnerable_rows=1 AND benign_rows=1) AS one_to_one_pair_groups,
                  SUM(vulnerable_rows>0 AND benign_rows>0
                      AND NOT(vulnerable_rows=1 AND benign_rows=1)) AS ambiguous_pair_groups
                FROM groups
                """
            ).fetchone()
        )
    finally:
        connection.close()

    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, indent=2, sort_keys=True), encoding="utf-8")
    print(f"WROTE {args.output}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
