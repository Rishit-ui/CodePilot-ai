"""SecureScan Phase 2.6 dataset curation primitives.

The raw CVEfixes database is opened read-only.  Derived stores contain only
metadata and cryptographic/fingerprint evidence, never source text.
"""

from __future__ import annotations

import hashlib
import json
import os
import re
import shutil
import sqlite3
import struct
from collections import defaultdict
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable, Iterator, Sequence
from urllib.parse import urlparse


TOKEN_RE = re.compile(
    r"[A-Za-z_$][A-Za-z0-9_$]*|0[xX][0-9A-Fa-f]+|\d+(?:\.\d+)?|"
    r"(?:==|!=|<=|>=|->|::|&&|\|\||<<|>>|\+\+|--) |[^\s]",
    re.VERBOSE,
)
IDENTIFIER_RE = re.compile(r"^[A-Za-z_$][A-Za-z0-9_$]*$")
NUMBER_RE = re.compile(r"^(?:0[xX][0-9A-Fa-f]+|\d+(?:\.\d+)?)$")
STRING_RE = re.compile(r"^(?:'|\")")
KEYWORDS = frozenset(
    "auto break case char const continue default do double else enum extern float "
    "for goto if inline int long register restrict return short signed sizeof static "
    "struct switch typedef union unsigned void volatile while alignas alignof bool "
    "class constexpr namespace new delete operator private protected public template "
    "this throw try catch typename using virtual wchar_t nullptr".split()
)


@dataclass(frozen=True)
class DiskGuard:
    path: Path
    minimum_free_gib: float = 85.0

    @property
    def minimum_bytes(self) -> int:
        return int(self.minimum_free_gib * 1024**3)

    def check(self, operation: str) -> int:
        free = shutil.disk_usage(self.path.anchor or self.path).free
        if free < self.minimum_bytes:
            raise RuntimeError(
                f"storage safety floor breached before {operation}: "
                f"free={free}, required={self.minimum_bytes}"
            )
        return free


def open_readonly(path: Path) -> sqlite3.Connection:
    """Open SQLite with URI read-only and query-only enforcement."""
    if not path.is_file():
        raise FileNotFoundError(path)
    connection = sqlite3.connect(path.resolve().as_uri() + "?mode=ro", uri=True)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA query_only=ON")
    if connection.execute("PRAGMA query_only").fetchone()[0] != 1:
        connection.close()
        raise RuntimeError("SQLite query_only enforcement failed")
    return connection


def normalize_repository_url(value: str) -> str:
    """Normalize common HTTPS/SSH Git remotes without guessing repository identity."""
    raw = (value or "").strip()
    if not raw:
        return ""
    if re.match(r"^[^/@\s]+@[^:/\s]+:[^\s]+$", raw):
        user_host, path = raw.split(":", 1)
        raw = f"ssh://{user_host}/{path}"
    elif raw.startswith("git://"):
        raw = "https://" + raw[len("git://") :]
    elif "://" not in raw:
        raw = "https://" + raw

    parsed = urlparse(raw)
    host = (parsed.hostname or "").lower()
    host = {
        "www.github.com": "github.com",
        "www.gitlab.com": "gitlab.com",
        "www.bitbucket.org": "bitbucket.org",
    }.get(host, host)
    path = re.sub(r"/+", "/", parsed.path).strip("/")
    if path.lower().endswith(".git"):
        path = path[:-4]
    if host in {"github.com", "gitlab.com", "bitbucket.org"}:
        path = path.lower()
    return f"https://{host}/{path}" if host and path else ""


def split_repository_url(url: str) -> tuple[str, str, str]:
    normalized = normalize_repository_url(url)
    parsed = urlparse(normalized)
    parts = parsed.path.strip("/").split("/", 1)
    owner = parts[0] if parts and parts[0] else ""
    name = parts[1] if len(parts) > 1 else ""
    return parsed.hostname or "", owner, name


def normalize_code(code: str) -> str:
    normalized = (code or "").replace("\r\n", "\n").replace("\r", "\n")
    return "\n".join(line.rstrip() for line in normalized.split("\n")).strip()


def canonical_tokens(code: str) -> list[str]:
    output: list[str] = []
    for token in TOKEN_RE.findall(code):
        if IDENTIFIER_RE.match(token) and token not in KEYWORDS:
            output.append("ID")
        elif NUMBER_RE.match(token):
            output.append("NUM")
        elif STRING_RE.match(token):
            output.append("STR")
        else:
            output.append(token)
    return output


def simhash64(tokens: Sequence[str]) -> int:
    if not tokens:
        return 0
    features = tokens if len(tokens) < 3 else ["\x1f".join(tokens[i : i + 3]) for i in range(len(tokens) - 2)]
    weights = [0] * 64
    for feature in features:
        value = int.from_bytes(hashlib.blake2b(feature.encode(), digest_size=8).digest(), "big")
        for bit in range(64):
            weights[bit] += 1 if value & (1 << bit) else -1
    result = 0
    for bit, weight in enumerate(weights):
        if weight >= 0:
            result |= 1 << bit
    return result


def minhash_signature(tokens: Sequence[str], limit: int = 64) -> tuple[int, ...]:
    grams = tokens if len(tokens) < 5 else ["\x1f".join(tokens[i : i + 5]) for i in range(len(tokens) - 4)]
    values = {
        int.from_bytes(hashlib.blake2b(gram.encode(), digest_size=8).digest(), "big")
        for gram in grams
    }
    return tuple(sorted(values)[:limit])


def pack_signature(values: Sequence[int]) -> bytes:
    return b"".join(struct.pack(">Q", value) for value in values)


def unpack_signature(value: bytes | None) -> tuple[int, ...]:
    if not value:
        return ()
    return tuple(item[0] for item in struct.iter_unpack(">Q", value))


def fingerprint_code(code: str) -> dict[str, object]:
    normalized = normalize_code(code)
    tokens = TOKEN_RE.findall(normalized)
    canonical = canonical_tokens(normalized)
    return {
        "code_sha256": hashlib.sha256((code or "").encode("utf-8")).hexdigest(),
        "normalized_sha256": hashlib.sha256(normalized.encode("utf-8")).hexdigest(),
        "canonical_sha256": hashlib.sha256("\x1f".join(canonical).encode()).hexdigest(),
        "simhash64": f"{simhash64(canonical):016x}",
        "minhash": pack_signature(minhash_signature(tokens)),
        "token_count": len(tokens),
        "code_chars": len(code or ""),
    }


class UnionFind:
    def __init__(self, items: Iterable[str] = ()) -> None:
        materialized = tuple(items)
        self.parent = {item: item for item in materialized}
        self.rank = {item: 0 for item in materialized}

    def add(self, item: str) -> None:
        if item not in self.parent:
            self.parent[item] = item
            self.rank[item] = 0

    def find(self, item: str) -> str:
        self.add(item)
        while self.parent[item] != item:
            self.parent[item] = self.parent[self.parent[item]]
            item = self.parent[item]
        return item

    def union(self, left: str, right: str) -> None:
        left_root, right_root = self.find(left), self.find(right)
        if left_root == right_root:
            return
        if self.rank[left_root] < self.rank[right_root]:
            left_root, right_root = right_root, left_root
        self.parent[right_root] = left_root
        if self.rank[left_root] == self.rank[right_root]:
            self.rank[left_root] += 1


PERMISSIVE_IDS = frozenset({"MIT", "Apache-2.0", "BSD-2-Clause", "BSD-3-Clause", "ISC", "0BSD", "Unlicense"})
COPYLEFT_MARKERS = ("GPL", "LGPL", "AGPL", "MPL", "EPL", "CDDL")


def classify_license_text(text: str) -> tuple[str, str]:
    """Return an SPDX-like identifier and technical inventory category."""
    sample = text[:1_000_000]
    spdx = re.search(r"SPDX-License-Identifier:\s*([^\s*]+)", sample, re.I)
    if spdx:
        identifier = spdx.group(1).strip()
    elif "Apache License" in sample and "Version 2.0" in sample:
        identifier = "Apache-2.0"
    elif "Permission is hereby granted, free of charge" in sample:
        identifier = "MIT"
    elif "Redistribution and use in source and binary forms" in sample:
        identifier = "BSD-3-Clause"
    elif "ISC License" in sample or "Permission to use, copy, modify, and/or distribute" in sample:
        identifier = "ISC"
    elif "GNU AFFERO GENERAL PUBLIC LICENSE" in sample.upper():
        identifier = "AGPL"
    elif "GNU LESSER GENERAL PUBLIC LICENSE" in sample.upper():
        identifier = "LGPL"
    elif "GNU GENERAL PUBLIC LICENSE" in sample.upper():
        identifier = "GPL"
    elif "MOZILLA PUBLIC LICENSE" in sample.upper():
        identifier = "MPL-2.0"
    elif "This is free and unencumbered software released into the public domain" in sample:
        identifier = "Unlicense"
    else:
        identifier = "UNKNOWN"
    if identifier in PERMISSIVE_IDS:
        category = "explicit_permissive"
    elif any(marker in identifier.upper() for marker in COPYLEFT_MARKERS):
        category = "copyleft"
    elif identifier == "UNKNOWN":
        category = "ambiguous_or_custom"
    else:
        category = "custom_or_nonstandard"
    return identifier, category


def deterministic_group_split(
    groups: Sequence[dict[str, object]], seed: int = 42
) -> dict[str, str]:
    """Greedily place whole connected groups near 70/15/15 deterministically."""
    targets = {"train": 0.70, "validation": 0.15, "test": 0.15}
    total = sum(int(group["size"]) for group in groups)
    counts = {name: 0 for name in targets}
    assignments: dict[str, str] = {}
    ordered = sorted(
        groups,
        key=lambda group: (
            -int(group["size"]),
            hashlib.sha256(f"{seed}:{group['group_id']}".encode()).hexdigest(),
        ),
    )
    for group in ordered:
        split = min(
            targets,
            key=lambda name: (
                counts[name] / max(targets[name] * total, 1),
                name,
            ),
        )
        assignments[str(group["group_id"])] = split
        counts[split] += int(group["size"])
    return assignments


def chunks(cursor: sqlite3.Cursor, size: int = 500) -> Iterator[list[sqlite3.Row]]:
    while True:
        batch = cursor.fetchmany(size)
        if not batch:
            return
        yield batch


def create_schema(connection: sqlite3.Connection) -> None:
    connection.executescript(
        """
        PRAGMA foreign_keys=ON;
        CREATE TABLE metadata(key TEXT PRIMARY KEY, value TEXT NOT NULL);
        CREATE TABLE repositories(
          repo_url TEXT PRIMARY KEY, canonical_url TEXT NOT NULL, host TEXT,
          owner TEXT, repo_name TEXT, commit_count INTEGER NOT NULL DEFAULT 0
        );
        CREATE TABLE all_methods(
          method_change_id TEXT PRIMARY KEY, file_change_id TEXT NOT NULL,
          method_name TEXT, signature TEXT, before_change TEXT,
          logical_key TEXT, has_pair_key INTEGER NOT NULL
        );
        CREATE INDEX all_methods_pair_idx ON all_methods(file_change_id, logical_key);
        CREATE TABLE candidates(
          method_change_id TEXT PRIMARY KEY, file_change_id TEXT NOT NULL,
          method_name TEXT, signature TEXT, before_change TEXT NOT NULL,
          language TEXT NOT NULL, commit_hash TEXT NOT NULL,
          change_type TEXT, old_path TEXT, new_path TEXT,
          primary_repo TEXT, repo_ambiguous INTEGER NOT NULL,
          cves_json TEXT NOT NULL, code_sha256 TEXT NOT NULL,
          normalized_sha256 TEXT NOT NULL, canonical_sha256 TEXT NOT NULL,
          simhash64 TEXT NOT NULL, minhash BLOB NOT NULL,
          token_count INTEGER NOT NULL, code_chars INTEGER NOT NULL,
          FOREIGN KEY(method_change_id) REFERENCES all_methods(method_change_id)
        );
        CREATE INDEX candidates_exact_idx ON candidates(code_sha256);
        CREATE INDEX candidates_normalized_idx ON candidates(normalized_sha256);
        CREATE INDEX candidates_canonical_idx ON candidates(canonical_sha256);
        CREATE INDEX candidates_repo_idx ON candidates(primary_repo);
        CREATE TABLE candidate_repositories(
          method_change_id TEXT NOT NULL, repo_url TEXT NOT NULL,
          PRIMARY KEY(method_change_id, repo_url)
        );
        CREATE TABLE pair_groups(
          pair_group_id TEXT PRIMARY KEY, file_change_id TEXT NOT NULL,
          logical_key TEXT, before_count INTEGER NOT NULL, after_count INTEGER NOT NULL,
          classification TEXT NOT NULL, member_count INTEGER NOT NULL
        );
        CREATE TABLE duplicate_groups(
          group_id TEXT PRIMARY KEY, code_sha256 TEXT NOT NULL,
          occurrences INTEGER NOT NULL, repositories INTEGER NOT NULL,
          labels INTEGER NOT NULL, cves INTEGER NOT NULL, commits INTEGER NOT NULL,
          normalized_hashes INTEGER NOT NULL, categories_json TEXT NOT NULL,
          quarantine INTEGER NOT NULL
        );
        CREATE TABLE duplicate_members(
          group_id TEXT NOT NULL, method_change_id TEXT NOT NULL,
          PRIMARY KEY(group_id, method_change_id)
        );
        CREATE TABLE clone_edges(
          left_method TEXT NOT NULL, right_method TEXT NOT NULL,
          edge_type TEXT NOT NULL, confidence TEXT NOT NULL,
          evidence_json TEXT NOT NULL,
          PRIMARY KEY(left_method, right_method, edge_type)
        );
        CREATE TABLE repository_edges(
          left_repo TEXT NOT NULL, right_repo TEXT NOT NULL,
          relationship TEXT NOT NULL, confidence TEXT NOT NULL,
          evidence_json TEXT NOT NULL,
          PRIMARY KEY(left_repo, right_repo, relationship)
        );
        CREATE TABLE licenses(
          repo_url TEXT PRIMARY KEY, checked_commit TEXT,
          license_id TEXT, category TEXT NOT NULL, evidence_path TEXT,
          evidence_url TEXT, evidence_sha256 TEXT, verification_date TEXT NOT NULL,
          inclusion_status TEXT NOT NULL, reason TEXT NOT NULL
        );
        CREATE TABLE components(
          method_change_id TEXT PRIMARY KEY, component_id TEXT NOT NULL,
          approved INTEGER NOT NULL, quarantine_reason TEXT
        );
        CREATE TABLE split_manifest(
          method_change_id TEXT PRIMARY KEY, component_id TEXT NOT NULL,
          split TEXT NOT NULL, seed INTEGER NOT NULL
        );
        """
    )


def json_list(values: Iterable[str]) -> str:
    return json.dumps(sorted({value for value in values if value}), separators=(",", ":"))

