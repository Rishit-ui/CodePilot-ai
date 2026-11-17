"""Dataset loading, validation, auditing, and leakage-safe preprocessing."""

from __future__ import annotations

import hashlib
import itertools
import re
from collections import Counter, defaultdict
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Mapping

import pandas as pd
from datasets import DatasetDict, load_dataset
from huggingface_hub import HfApi

DATASET_ID = "mcanoglu/defect-detection"
DEFAULT_REVISION = "6a433bbc30bea2d1053484c4bdfb75673044561a"
EXPECTED_SPLITS = ("train", "validation", "test")
EXPECTED_COLUMNS = (
    "code",
    "label",
    "programming_language",
    "cwe_id",
    "cwe_name",
    "description",
    "url",
    "label_name",
)
RAW_LABEL_TO_NAME = {0: "vulnerable", 1: "safe"}
MODEL_LABEL_TO_NAME = {0: "safe", 1: "vulnerable"}
LABEL_NAME_TO_MODEL = {name: label for label, name in MODEL_LABEL_TO_NAME.items()}
MIN_CODE_CHARACTERS = 5


@dataclass(frozen=True)
class DatasetSource:
    dataset_id: str
    revision: str
    license: str | None
    license_files: tuple[str, ...]
    fingerprints: dict[str, str]


def load_dataset_bundle(
    cache_dir: str | Path | None = None,
    revision: str = DEFAULT_REVISION,
) -> tuple[DatasetDict, DatasetSource]:
    """Load the pinned public dataset and authoritative Hub metadata."""
    dataset = load_dataset(DATASET_ID, revision=revision, cache_dir=str(cache_dir) if cache_dir else None)
    missing_splits = sorted(set(EXPECTED_SPLITS) - set(dataset.keys()))
    if missing_splits:
        raise ValueError(f"Dataset is missing required splits: {missing_splits}")

    for split in EXPECTED_SPLITS:
        missing_columns = sorted(set(EXPECTED_COLUMNS) - set(dataset[split].column_names))
        if missing_columns:
            raise ValueError(f"Split {split!r} is missing required columns: {missing_columns}")

    hub = HfApi()
    info = hub.dataset_info(DATASET_ID, revision=revision)
    repository_files = hub.list_repo_files(DATASET_ID, repo_type="dataset", revision=revision)
    license_files = tuple(
        filename for filename in repository_files if "license" in filename.lower() or "copying" in filename.lower()
    )
    license_name = getattr(info.card_data, "license", None) if info.card_data else None
    return dataset, DatasetSource(
        dataset_id=DATASET_ID,
        revision=str(info.sha or revision),
        license=str(license_name) if license_name else None,
        license_files=license_files,
        fingerprints={split: str(dataset[split]._fingerprint) for split in EXPECTED_SPLITS},
    )


def normalize_code(value: Any) -> str:
    """Apply only loss-minimizing whitespace normalization to source code."""
    if not isinstance(value, str):
        return ""
    normalized = value.replace("\r\n", "\n").replace("\r", "\n")
    normalized = "\n".join(line.rstrip() for line in normalized.split("\n"))
    return normalized.strip()


def is_usable_code(code: str) -> bool:
    return len(re.sub(r"\s+", "", code)) >= MIN_CODE_CHARACTERS


def encode_label(raw_label: Any, label_name: Any) -> int:
    """Validate the dataset's inverse raw labels and encode vulnerable as 1."""
    try:
        numeric_label = int(raw_label)
    except (TypeError, ValueError) as error:
        raise ValueError(f"Invalid numeric label: {raw_label!r}") from error
    normalized_name = str(label_name).strip().lower()
    expected_name = RAW_LABEL_TO_NAME.get(numeric_label)
    if expected_name is None:
        raise ValueError(f"Unsupported numeric label: {numeric_label!r}")
    if normalized_name != expected_name:
        raise ValueError(
            f"Inconsistent label pair: numeric {numeric_label} expects {expected_name!r}, got {normalized_name!r}"
        )
    return LABEL_NAME_TO_MODEL[normalized_name]


def _frame_for_split(dataset: DatasetDict, split: str) -> pd.DataFrame:
    frame = dataset[split].to_pandas()
    frame["source_split"] = split
    frame["source_index"] = range(len(frame))
    frame["code_normalized"] = frame["code"].map(normalize_code)
    frame["usable"] = frame["code_normalized"].map(is_usable_code)
    frame["code_sha256"] = frame["code_normalized"].map(
        lambda code: hashlib.sha256(code.encode("utf-8")).hexdigest() if code else None
    )
    return frame


def raw_frames(dataset: DatasetDict) -> dict[str, pd.DataFrame]:
    return {split: _frame_for_split(dataset, split) for split in EXPECTED_SPLITS}


def prepare_splits(dataset: DatasetDict) -> tuple[dict[str, pd.DataFrame], dict[str, Any]]:
    """Remove unusable/conflicting/exact duplicate rows without consulting test outcomes."""
    frames = raw_frames(dataset)
    combined = pd.concat([frames[split] for split in EXPECTED_SPLITS], ignore_index=True)

    label_errors: list[dict[str, Any]] = []
    targets: list[int | None] = []
    for row in combined.itertuples(index=False):
        try:
            targets.append(encode_label(row.label, row.label_name))
        except ValueError as error:
            targets.append(None)
            label_errors.append(
                {"split": row.source_split, "index": int(row.source_index), "error": str(error)}
            )
    combined["target"] = targets

    usable = combined[combined["usable"] & combined["target"].notna()].copy()
    usable["target"] = usable["target"].astype(int)

    conflicting_hashes = set(
        usable.groupby("code_sha256")["target"].nunique().loc[lambda counts: counts > 1].index
    )
    without_conflicts = usable[~usable["code_sha256"].isin(conflicting_hashes)].copy()
    without_conflicts["split_priority"] = without_conflicts["source_split"].map(
        {"train": 0, "validation": 1, "test": 2}
    )
    without_conflicts = without_conflicts.sort_values(["split_priority", "source_index"])
    deduplicated = without_conflicts.drop_duplicates(subset=["code_sha256"], keep="first")

    output_columns = [
        "code_normalized",
        "programming_language",
        "target",
        "label",
        "label_name",
        "source_index",
        "code_sha256",
    ]
    processed: dict[str, pd.DataFrame] = {}
    for split in EXPECTED_SPLITS:
        split_frame = deduplicated[deduplicated["source_split"] == split][output_columns].copy()
        split_frame = split_frame.rename(
            columns={
                "code_normalized": "code",
                "label": "raw_label",
                "label_name": "raw_label_name",
            }
        )
        split_frame["target_name"] = split_frame["target"].map(MODEL_LABEL_TO_NAME)
        split_frame = split_frame.reset_index(drop=True)
        processed[split] = split_frame

    stats = {
        "label_errors": label_errors,
        "unusable_rows": int((~combined["usable"]).sum()),
        "conflicting_duplicate_groups_removed": len(conflicting_hashes),
        "conflicting_duplicate_rows_removed": int(usable["code_sha256"].isin(conflicting_hashes).sum()),
        "exact_duplicate_rows_removed": int(len(without_conflicts) - len(deduplicated)),
        "processed_rows": {split: len(processed[split]) for split in EXPECTED_SPLITS},
        "processed_total": sum(len(processed[split]) for split in EXPECTED_SPLITS),
    }
    return processed, stats


_TOKEN_RE = re.compile(
    r"[A-Za-z_$][A-Za-z0-9_$]*|0[xX][0-9A-Fa-f]+|\d+(?:\.\d+)?|(?:\"(?:\\.|[^\"\\])*\"|'(?:\\.|[^'\\])*')|[^\s]"
)


def _canonical_tokens(code: str) -> list[str]:
    tokens: list[str] = []
    for token in _TOKEN_RE.findall(code):
        if token[0].isalpha() or token[0] in "_$":
            tokens.append("ID")
        elif token[0].isdigit():
            tokens.append("NUM")
        elif token[0] in "\"'":
            tokens.append("STR")
        else:
            tokens.append(token)
    return tokens


def simhash64(code: str) -> int:
    """Deterministic structural SimHash over canonical token trigrams."""
    tokens = _canonical_tokens(code)
    if len(tokens) < 3:
        features = tokens or [code]
    else:
        features = ["\x1f".join(tokens[index : index + 3]) for index in range(len(tokens) - 2)]
    counts = Counter(features)
    weights = [0] * 64
    for feature, frequency in counts.items():
        digest = hashlib.blake2b(feature.encode("utf-8"), digest_size=8).digest()
        value = int.from_bytes(digest, "big")
        for bit in range(64):
            weights[bit] += frequency if value & (1 << bit) else -frequency
    result = 0
    for bit, weight in enumerate(weights):
        if weight >= 0:
            result |= 1 << bit
    return result


def audit_near_duplicates(
    records: pd.DataFrame,
    max_hamming_distance: int = 3,
    max_bucket_size: int = 500,
) -> dict[str, Any]:
    """Estimate structural near duplicates with four-band SimHash LSH."""
    code_hashes = records["code_sha256"].tolist()
    source_splits = records["source_split"].tolist()
    hashes = [simhash64(code) for code in records["code_normalized"].tolist()]
    buckets: dict[tuple[int, int], list[int]] = defaultdict(list)
    for index, value in enumerate(hashes):
        for band in range(4):
            buckets[(band, (value >> (band * 16)) & 0xFFFF)].append(index)

    candidates: set[tuple[int, int]] = set()
    capped_buckets = 0
    for indices in buckets.values():
        if len(indices) < 2:
            continue
        if len(indices) > max_bucket_size:
            capped_buckets += 1
            indices = indices[:max_bucket_size]
        candidates.update(itertools.combinations(indices, 2))

    near_pairs = 0
    cross_split_pairs = 0
    for left, right in candidates:
        if code_hashes[left] == code_hashes[right]:
            continue
        if (hashes[left] ^ hashes[right]).bit_count() <= max_hamming_distance:
            near_pairs += 1
            if source_splits[left] != source_splits[right]:
                cross_split_pairs += 1
    return {
        "method": "64-bit structural SimHash over canonical token trigrams; four 16-bit LSH bands",
        "max_hamming_distance": max_hamming_distance,
        "candidate_pairs_examined": len(candidates),
        "near_duplicate_pairs": near_pairs,
        "cross_split_near_duplicate_pairs": cross_split_pairs,
        "capped_buckets": capped_buckets,
        "max_bucket_size": max_bucket_size,
        "limitations": "Heuristic, not an exhaustive semantic clone detector; capped buckets can undercount highly repetitive snippets.",
    }


def build_audit(dataset: DatasetDict, source: DatasetSource) -> tuple[dict[str, Any], dict[str, pd.DataFrame]]:
    frames = raw_frames(dataset)
    combined = pd.concat([frames[split] for split in EXPECTED_SPLITS], ignore_index=True)
    processed, processing_stats = prepare_splits(dataset)

    duplicate_groups = combined[combined["code_sha256"].notna()].groupby("code_sha256", dropna=True)
    duplicate_sizes = duplicate_groups.size()
    duplicate_hashes = set(duplicate_sizes[duplicate_sizes > 1].index)
    cross_split_duplicate_groups = sum(
        1
        for code_hash, group in duplicate_groups
        if code_hash in duplicate_hashes and group["source_split"].nunique() > 1
    )
    conflicting_groups = sum(
        1
        for code_hash, group in duplicate_groups
        if code_hash in duplicate_hashes and group["label_name"].astype(str).str.lower().nunique() > 1
    )

    exact_unique = combined[
        combined["usable"] & combined["code_sha256"].notna()
    ].drop_duplicates("code_sha256", keep="first").reset_index(drop=True)
    near_duplicates = audit_near_duplicates(exact_unique)

    split_audits: dict[str, Any] = {}
    for split, frame in frames.items():
        missing = {
            column: int(frame[column].isna().sum())
            for column in EXPECTED_COLUMNS
        }
        blank_strings = {
            column: int(frame[column].map(lambda value: isinstance(value, str) and not value.strip()).sum())
            for column in EXPECTED_COLUMNS
            if frame[column].dtype == object
        }
        split_audits[split] = {
            "rows": len(frame),
            "missing_values": missing,
            "blank_string_values": blank_strings,
            "numeric_label_distribution": {
                str(key): int(value) for key, value in frame["label"].value_counts(dropna=False).sort_index().items()
            },
            "label_name_distribution": {
                str(key): int(value) for key, value in frame["label_name"].value_counts(dropna=False).sort_index().items()
            },
            "programming_language_distribution": {
                str(key): int(value)
                for key, value in frame["programming_language"].value_counts(dropna=False).sort_index().items()
            },
            "unusable_code_rows": int((~frame["usable"]).sum()),
        }

    label_cross_tab = pd.crosstab(combined["label"], combined["label_name"], dropna=False)
    audit = {
        "source": {
            "dataset_id": source.dataset_id,
            "revision": source.revision,
            "license": source.license,
            "license_files": list(source.license_files),
            "url": f"https://huggingface.co/datasets/{source.dataset_id}",
            "fingerprints": source.fingerprints,
        },
        "schema": {column: str(dataset["train"].features[column]) for column in EXPECTED_COLUMNS},
        "splits": split_audits,
        "total_rows": len(combined),
        "languages": sorted(str(value) for value in combined["programming_language"].dropna().unique()),
        "label_mapping": {
            "raw": {str(key): value for key, value in RAW_LABEL_TO_NAME.items()},
            "model": {str(key): value for key, value in MODEL_LABEL_TO_NAME.items()},
            "cross_tab": {
                str(index): {str(column): int(label_cross_tab.loc[index, column]) for column in label_cross_tab.columns}
                for index in label_cross_tab.index
            },
            "consistent": not processing_stats["label_errors"],
            "inconsistent_rows": processing_stats["label_errors"],
        },
        "exact_duplicates": {
            "duplicate_groups": len(duplicate_hashes),
            "rows_in_duplicate_groups": int(combined["code_sha256"].isin(duplicate_hashes).sum()),
            "cross_split_duplicate_groups": int(cross_split_duplicate_groups),
            "conflicting_label_groups": int(conflicting_groups),
        },
        "near_duplicates": near_duplicates,
        "processing": processing_stats,
    }
    return audit, processed


def save_processed_splits(processed: Mapping[str, pd.DataFrame], output_dir: str | Path) -> None:
    destination = Path(output_dir)
    destination.mkdir(parents=True, exist_ok=True)
    for split, frame in processed.items():
        frame.to_parquet(destination / f"{split}.parquet", index=False)
