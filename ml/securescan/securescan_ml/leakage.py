"""Conservative clone grouping and leakage-controlled partitioning."""

from __future__ import annotations

import hashlib
import itertools
from collections import defaultdict
from dataclasses import dataclass
from typing import Any

import numpy as np
import pandas as pd
from sklearn.model_selection import StratifiedGroupKFold

from .data import _canonical_tokens, _TOKEN_RE, simhash64


class UnionFind:
    def __init__(self, size: int) -> None:
        self.parent = list(range(size))
        self.rank = [0] * size

    def find(self, item: int) -> int:
        while self.parent[item] != item:
            self.parent[item] = self.parent[self.parent[item]]
            item = self.parent[item]
        return item

    def union(self, left: int, right: int) -> None:
        left, right = self.find(left), self.find(right)
        if left == right:
            return
        if self.rank[left] < self.rank[right]:
            left, right = right, left
        self.parent[right] = left
        if self.rank[left] == self.rank[right]:
            self.rank[left] += 1


def _token_ngrams(code: str, size: int = 5) -> frozenset[str]:
    tokens = _TOKEN_RE.findall(code)
    if len(tokens) < size:
        return frozenset(tokens)
    return frozenset("\x1f".join(tokens[i : i + size]) for i in range(len(tokens) - size + 1))


def _jaccard(left: frozenset[str], right: frozenset[str]) -> float:
    union = left | right
    return len(left & right) / len(union) if union else 1.0


@dataclass
class CloneAudit:
    frame: pd.DataFrame
    summary: dict[str, Any]
    examples: list[dict[str, Any]]


def investigate_and_group(records: pd.DataFrame, max_bucket_size: int = 500) -> CloneAudit:
    """Audit broad SimHash matches, but group only conservative verified clones."""
    records = records.reset_index(drop=True).copy()
    codes = records["code"].astype(str).tolist()
    hashes = [simhash64(code) for code in codes]
    buckets: dict[tuple[int, int], list[int]] = defaultdict(list)
    for index, value in enumerate(hashes):
        for band in range(4):
            buckets[(band, (value >> (band * 16)) & 0xFFFF)].append(index)
    candidates: set[tuple[int, int]] = set()
    capped = 0
    for indices in buckets.values():
        if len(indices) > max_bucket_size:
            capped += 1
            indices = indices[:max_bucket_size]
        if len(indices) > 1:
            candidates.update(itertools.combinations(indices, 2))

    token_counts = [len(_TOKEN_RE.findall(code)) for code in codes]
    canonical_digests = [
        hashlib.sha256("\x1f".join(_canonical_tokens(code)).encode()).hexdigest() for code in codes
    ]
    gram_cache: dict[int, frozenset[str]] = {}
    broad_pairs: list[tuple[int, int, int, float, bool]] = []
    union = UnionFind(len(records))
    cross_broad = 0
    verified = 0
    cross_verified = 0
    for left, right in candidates:
        distance = (hashes[left] ^ hashes[right]).bit_count()
        if distance > 3:
            continue
        if records.at[left, "code_sha256"] == records.at[right, "code_sha256"]:
            continue
        if records.at[left, "source_split"] != records.at[right, "source_split"]:
            cross_broad += 1
        gram_cache.setdefault(left, _token_ngrams(codes[left]))
        gram_cache.setdefault(right, _token_ngrams(codes[right]))
        similarity = _jaccard(gram_cache[left], gram_cache[right])
        length_ratio = min(token_counts[left], token_counts[right]) / max(token_counts[left], token_counts[right], 1)
        canonical_equal = canonical_digests[left] == canonical_digests[right]
        # High-confidence type-1/type-2 clones only. Broad SimHash matches are not
        # grouping evidence because identifier/literal erasure over-matches boilerplate.
        is_verified = min(token_counts[left], token_counts[right]) >= 20 and (
            (similarity >= 0.90 and length_ratio >= 0.85)
            or (canonical_equal and length_ratio >= 0.95)
        )
        broad_pairs.append((left, right, distance, similarity, is_verified))
        if is_verified:
            union.union(left, right)
            verified += 1
            if records.at[left, "source_split"] != records.at[right, "source_split"]:
                cross_verified += 1

    roots = [union.find(i) for i in range(len(records))]
    root_to_group = {root: number for number, root in enumerate(sorted(set(roots)))}
    records["clone_group"] = [root_to_group[root] for root in roots]
    group_sizes = records.groupby("clone_group").size()

    examples: list[dict[str, Any]] = []
    ordered = sorted(broad_pairs, key=lambda item: (not item[4], -item[3], item[2]))
    verified_examples = [pair for pair in ordered if pair[4]][:5]
    rejected_examples = sorted((pair for pair in broad_pairs if not pair[4]), key=lambda item: item[3])[:5]
    for left, right, distance, similarity, accepted in verified_examples + rejected_examples:
        examples.append({
            "classification": "verified_clone" if accepted else "heuristic_false_positive_or_unverified",
            "left": {"split": records.at[left, "source_split"], "index": int(records.at[left, "source_index"]), "language": records.at[left, "programming_language"]},
            "right": {"split": records.at[right, "source_split"], "index": int(records.at[right, "source_index"]), "language": records.at[right, "programming_language"]},
            "simhash_distance": distance,
            "token_5gram_jaccard": round(similarity, 6),
            "left_excerpt": codes[left][:300].replace("\n", " "),
            "right_excerpt": codes[right][:300].replace("\n", " "),
        })
    return CloneAudit(records, {
        "candidate_pairs": len(candidates),
        "broad_simhash_pairs": len(broad_pairs),
        "cross_split_broad_pairs": cross_broad,
        "verified_clone_edges": verified,
        "cross_split_verified_clone_edges": cross_verified,
        "connected_components": len(group_sizes),
        "multirow_components": int((group_sizes > 1).sum()),
        "largest_component": int(group_sizes.max()),
        "capped_lsh_buckets": capped,
    }, examples)


def grouped_partitions(records: pd.DataFrame, seed: int = 42) -> dict[str, pd.DataFrame]:
    """Create deterministic stratified partitions with clone groups kept intact."""
    strata = records["target"].astype(str) + ":" + records["programming_language"].astype(str)
    outer = StratifiedGroupKFold(n_splits=10, shuffle=True, random_state=seed)
    remaining_idx, test_idx = next(outer.split(records, strata, records["clone_group"]))
    remaining = records.iloc[remaining_idx].reset_index(drop=True)
    remaining_strata = remaining["target"].astype(str) + ":" + remaining["programming_language"].astype(str)
    inner = StratifiedGroupKFold(n_splits=9, shuffle=True, random_state=seed + 1)
    train_idx, validation_idx = next(inner.split(remaining, remaining_strata, remaining["clone_group"]))
    output = {
        "train": remaining.iloc[train_idx].reset_index(drop=True),
        "validation": remaining.iloc[validation_idx].reset_index(drop=True),
        "test": records.iloc[test_idx].reset_index(drop=True),
    }
    group_sets = {name: set(frame["clone_group"]) for name, frame in output.items()}
    assert group_sets["train"].isdisjoint(group_sets["validation"])
    assert group_sets["train"].isdisjoint(group_sets["test"])
    assert group_sets["validation"].isdisjoint(group_sets["test"])
    return output
