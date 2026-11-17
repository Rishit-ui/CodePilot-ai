"""Audit and evaluate the saved Phase 1 model on official PrimeVul v0.1."""

from __future__ import annotations

import argparse
import hashlib
import itertools
import json
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd
from sklearn.metrics import (
    accuracy_score, average_precision_score, balanced_accuracy_score, f1_score,
    matthews_corrcoef, precision_score, recall_score, roc_auc_score,
)

from .data import _TOKEN_RE, normalize_code, simhash64
from .evaluation import classification_metrics
from .leakage import _jaccard, _token_ngrams
from .predict import load_artifacts, sha256_file

OFFICIAL_REPOSITORY = "https://github.com/DLVulDet/PrimeVul"
OFFICIAL_REPOSITORY_REVISION = "6f54687c84947b1d17486495440b37030d147289"
OFFICIAL_RELEASE = "PrimeVul-v0.1"
OFFICIAL_DRIVE_FOLDER = "1cznxGme5o6A_9tT8T47JUh3MPEpRYiKK"


def _load_jsonl(path: Path) -> pd.DataFrame:
    with path.open(encoding="utf-8") as stream:
        return pd.DataFrame(json.loads(line) for line in stream if line.strip())


def _dataset_audit(data_dir: Path) -> dict[str, Any]:
    result: dict[str, Any] = {}
    standard_hash_owners: dict[str, set[str]] = defaultdict(set)
    for path in sorted(data_dir.glob("primevul_*.jsonl")):
        frame = _load_jsonl(path)
        labels = Counter(int(value) for value in frame["target"])
        missing = {column: int(frame[column].map(lambda value: value is None or value == "").sum()) for column in frame.columns}
        result[path.name] = {
            "sha256": sha256_file(path), "size_bytes": path.stat().st_size, "rows": len(frame),
            "label_counts": {str(key): value for key, value in sorted(labels.items())},
            "columns": list(frame.columns), "missing_or_blank": {key: value for key, value in missing.items() if value},
            "projects": int(frame["project"].nunique()), "cwes": int(frame["cwe"].map(str).nunique()),
        }
        if "paired" not in path.name:
            for code in frame["func"]:
                standard_hash_owners[hashlib.sha256(normalize_code(code).encode()).hexdigest()].add(path.name)
    cross_split = {digest: owners for digest, owners in standard_hash_owners.items() if len(owners) > 1}
    result["cross_standard_split_exact_normalized_duplicates"] = len(cross_split)
    return result


def _contamination_indices(train_codes: list[str], external_codes: list[str]) -> tuple[set[int], dict[str, Any]]:
    train_exact = {hashlib.sha256(normalize_code(code).encode()).hexdigest() for code in train_codes}
    external_exact = [hashlib.sha256(normalize_code(code).encode()).hexdigest() for code in external_codes]
    exact_indices = {index for index, digest in enumerate(external_exact) if digest in train_exact}

    all_codes = train_codes + external_codes
    boundary = len(train_codes)
    hashes = [simhash64(code) for code in all_codes]
    buckets: dict[tuple[int, int], list[int]] = defaultdict(list)
    for index, value in enumerate(hashes):
        for band in range(4):
            buckets[(band, (value >> (16 * band)) & 0xFFFF)].append(index)
    candidates: set[tuple[int, int]] = set()
    capped_buckets = 0
    for indices in buckets.values():
        left = [index for index in indices if index < boundary]
        right = [index for index in indices if index >= boundary]
        if len(left) > 500 or len(right) > 500:
            capped_buckets += 1
            left, right = left[:500], right[:500]
        candidates.update((a, b) for a in left for b in right)

    verified_near: set[int] = set()
    grams: dict[int, frozenset[str]] = {}
    token_counts = [len(_TOKEN_RE.findall(code)) for code in all_codes]
    inspected = 0
    for left, right in candidates:
        if (hashes[left] ^ hashes[right]).bit_count() > 3:
            continue
        inspected += 1
        grams.setdefault(left, _token_ngrams(all_codes[left]))
        grams.setdefault(right, _token_ngrams(all_codes[right]))
        similarity = _jaccard(grams[left], grams[right])
        ratio = min(token_counts[left], token_counts[right]) / max(token_counts[left], token_counts[right], 1)
        if min(token_counts[left], token_counts[right]) >= 20 and similarity >= 0.90 and ratio >= 0.85:
            verified_near.add(right - boundary)
    excluded = exact_indices | verified_near
    return excluded, {
        "phase1_training_rows_compared": len(train_codes), "primevul_test_rows_compared": len(external_codes),
        "exact_normalized_overlap_rows": len(exact_indices), "verified_high_confidence_near_overlap_rows": len(verified_near),
        "total_excluded_rows": len(excluded), "simhash_cross_candidates": len(candidates),
        "simhash_distance_le_3_pairs_inspected": inspected, "capped_lsh_buckets": capped_buckets,
        "metadata_overlap_assessment": "Unavailable: the Phase 1 source has no project/repository/commit/file identity.",
    }


def _bootstrap_intervals(y: np.ndarray, pred: np.ndarray, scores: np.ndarray, seed: int = 42, samples: int = 500) -> dict[str, list[float]]:
    rng = np.random.default_rng(seed)
    by_class = [np.flatnonzero(y == label) for label in (0, 1)]
    values: dict[str, list[float]] = defaultdict(list)
    for _ in range(samples):
        indices = np.concatenate([rng.choice(group, len(group), replace=True) for group in by_class])
        yt, yp, ys = y[indices], pred[indices], scores[indices]
        metrics = {
            "accuracy": accuracy_score(yt, yp), "balanced_accuracy": balanced_accuracy_score(yt, yp),
            "precision_vulnerable": precision_score(yt, yp, zero_division=0), "recall_vulnerable": recall_score(yt, yp),
            "f1_vulnerable": f1_score(yt, yp), "roc_auc": roc_auc_score(yt, ys),
            "pr_auc": average_precision_score(yt, ys), "matthews_correlation_coefficient": matthews_corrcoef(yt, yp),
        }
        for name, value in metrics.items():
            values[name].append(float(value))
    return {name: [float(np.quantile(vals, 0.025)), float(np.quantile(vals, 0.975))] for name, vals in values.items()}


def _ranking_metrics(y: np.ndarray, scores: np.ndarray) -> dict[str, Any]:
    order = np.argsort(-scores)
    positives = int(y.sum())
    output = {}
    for k in sorted(set([100, 500, 1000, positives])):
        actual = min(k, len(y))
        found = int(y[order[:actual]].sum())
        output[str(k)] = {"k_used": actual, "vulnerable_found": found, "precision_at_k": found / actual, "recall_at_k": found / positives}
    return output


def run(root: Path) -> dict[str, Any]:
    data_dir = root / "data" / "external" / "primevul-v0.1"
    required = [data_dir / f"primevul_{split}.jsonl" for split in ("train", "valid", "test", "train_paired", "valid_paired", "test_paired")]
    missing = [str(path) for path in required if not path.exists()]
    if missing:
        raise FileNotFoundError(f"Missing official PrimeVul files: {missing}")
    dataset_audit = _dataset_audit(data_dir)

    phase_train = pd.read_parquet(root / "data" / "processed" / "train.parquet")
    phase_train = phase_train[phase_train["programming_language"].isin(["C", "C++"])]
    test = _load_jsonl(data_dir / "primevul_test.jsonl")
    excluded, contamination = _contamination_indices(phase_train["code"].tolist(), test["func"].tolist())
    keep = np.asarray([index not in excluded for index in range(len(test))])
    evaluated = test.loc[keep].reset_index(drop=True)

    model, vectorizer, metadata = load_artifacts(root / "artifacts")
    if metadata["selected_model"] != "tfidf_logistic_regression":
        raise ValueError("Phase 1 selected artifact is not the documented Logistic Regression model")
    features = vectorizer.transform(evaluated["func"])
    scores = np.asarray(model.predict_proba(features))[:, 1]
    predictions = (scores >= 0.5).astype(int)
    y = evaluated["target"].to_numpy(dtype=int)
    metrics = classification_metrics(y, predictions, scores)
    metrics["confidence_intervals_95_percent_stratified_bootstrap_500"] = _bootstrap_intervals(y, predictions, scores)
    metrics["ranking"] = _ranking_metrics(y, scores)

    paired = _load_jsonl(data_dir / "primevul_test_paired.jsonl")
    excluded_ids = set(test.loc[list(excluded), "idx"])
    eligible_pair_frames = []
    for index in range(0, len(paired) - 1, 2):
        pair = paired.iloc[index : index + 2]
        if set(pair["target"].astype(int)) != {0, 1} or pair["commit_id"].nunique() != 1:
            continue
        if any(value in excluded_ids for value in pair["idx"]):
            continue
        eligible_pair_frames.append(pair)
    paired = pd.concat(eligible_pair_frames, ignore_index=True) if eligible_pair_frames else paired.iloc[0:0]
    paired_scores = np.asarray(model.predict_proba(vectorizer.transform(paired["func"])))[:, 1]
    pairs = []
    for index in range(0, len(paired), 2):
        first, second = paired.iloc[index], paired.iloc[index + 1]
        vulnerable_index, safe_index = (index, index + 1) if int(first.target) == 1 else (index + 1, index)
        pairs.append((paired_scores[vulnerable_index], paired_scores[safe_index]))
    paired_result = {
        "eligible_pairs": len(pairs),
        "vulnerable_above_safe_rate": float(np.mean([v > s for v, s in pairs])) if pairs else None,
        "both_classified_correctly_rate": float(np.mean([v >= 0.5 and s < 0.5 for v, s in pairs])) if pairs else None,
        "vulnerable_detected_rate": float(np.mean([v >= 0.5 for v, _ in pairs])) if pairs else None,
        "patched_benign_rate": float(np.mean([s < 0.5 for _, s in pairs])) if pairs else None,
    }
    result = {
        "provenance": {"official_repository": OFFICIAL_REPOSITORY, "repository_revision": OFFICIAL_REPOSITORY_REVISION, "release": OFFICIAL_RELEASE, "official_drive_folder_id": OFFICIAL_DRIVE_FOLDER, "repository_license": "MIT"},
        "label_mapping": {"0": "benign", "1": "vulnerable"}, "language_scope": "C/C++ as defined by PrimeVul",
        "dataset_audit": dataset_audit, "contamination": contamination,
        "evaluation": {"fixed_threshold": 0.5, "rows_after_overlap_exclusion": len(evaluated), "class_counts": {str(k): int(v) for k, v in evaluated["target"].value_counts().sort_index().items()}, "metrics": metrics, "paired": paired_result},
    }
    report_dir = root / "reports"
    (report_dir / "primevul_external_evaluation.json").write_text(json.dumps(result, indent=2, sort_keys=True), encoding="utf-8")
    ci = metrics["confidence_intervals_95_percent_stratified_bootstrap_500"]
    lines = [
        "# PrimeVul v0.1 External Evaluation", "",
        f"- Official source: {OFFICIAL_REPOSITORY}", f"- Repository revision: `{OFFICIAL_REPOSITORY_REVISION}`",
        f"- Release: `{OFFICIAL_RELEASE}` from the official linked Drive folder", "- Repository license: MIT", "- Labels: `0=benign`, `1=vulnerable`", "- Model: original Phase 1 selected Logistic Regression and original saved vectorizer", "- Fixed threshold: 0.5 (no PrimeVul tuning)", "",
        "## Provenance and split audit", "",
    ]
    for name, audit in dataset_audit.items():
        if isinstance(audit, dict):
            lines.append(f"- `{name}`: {audit['rows']:,} rows; labels {audit['label_counts']}; SHA-256 `{audit['sha256']}`")
    lines.extend(["", "The standard test distribution is extremely imbalanced. Accuracy alone can be high for a useless all-benign classifier, so the security-relevant metrics below are primary.", "", "## Contamination audit", "", f"- Phase 1 C/C++ training rows compared: {contamination['phase1_training_rows_compared']:,}", f"- Exact normalized overlap rows: {contamination['exact_normalized_overlap_rows']:,}", f"- Verified high-confidence near-overlap rows: {contamination['verified_high_confidence_near_overlap_rows']:,}", f"- Total test rows excluded: {contamination['total_excluded_rows']:,}", f"- Metadata assessment: {contamination['metadata_overlap_assessment']}", "", "This is an external-corpus evaluation with detected-overlap exclusions, not a claim that PrimeVul remains a fully independent benchmark for this model. Phase 1 lacks project provenance and capped LSH buckets can undercount repetitive near-clones, so unresolved contamination risk remains.", "", "## Fixed-threshold results", "", f"- Evaluated rows: {len(evaluated):,}; classes {result['evaluation']['class_counts']}", f"- Accuracy: {metrics['accuracy']:.6f} (95% CI {ci['accuracy']})", f"- Balanced accuracy: {metrics['balanced_accuracy']:.6f} (95% CI {ci['balanced_accuracy']})", f"- Vulnerable precision: {metrics['precision_vulnerable']:.6f} (95% CI {ci['precision_vulnerable']})", f"- Vulnerable recall: {metrics['recall_vulnerable']:.6f} (95% CI {ci['recall_vulnerable']})", f"- Vulnerable F1: {metrics['f1_vulnerable']:.6f} (95% CI {ci['f1_vulnerable']})", f"- ROC-AUC: {metrics['roc_auc']:.6f} (95% CI {ci['roc_auc']})", f"- PR-AUC: {metrics['pr_auc']:.6f} (95% CI {ci['pr_auc']})", f"- MCC: {metrics['matthews_correlation_coefficient']:.6f} (95% CI {ci['matthews_correlation_coefficient']})", f"- Confusion matrix `[[TN, FP], [FN, TP]]`: `{metrics['confusion_matrix']}`", f"- Ranking metrics: `{metrics['ranking']}`", "", "## Paired vulnerable/patched evaluation", "", f"- {paired_result}", "", "## Limitations", "", "PrimeVul contains C/C++ only and cannot validate the other seven Phase 1 languages. Repository-level MIT licensing is clear, but the functions originate in many upstream projects and redistribution may retain upstream attribution/license obligations. This local evaluation does not establish exploitability or prove code secure."])
    (report_dir / "primevul_external_evaluation.md").write_text("\n".join(lines) + "\n", encoding="utf-8")
    return result


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", default=".")
    args = parser.parse_args()
    result = run(Path(args.root).resolve())
    print(json.dumps({"contamination": result["contamination"], "evaluation": result["evaluation"]}, indent=2))


if __name__ == "__main__":
    main()
