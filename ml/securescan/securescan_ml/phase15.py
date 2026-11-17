"""Run the Phase 1.5 leakage investigation and leakage-controlled retraining."""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any

import joblib
import pandas as pd

from .evaluation import classification_metrics, model_scores, per_language_metrics
from .features import build_vectorizer, canonicalize_vectorizer_for_persistence
from .leakage import grouped_partitions, investigate_and_group
from .predict import sha256_file
from .train import RANDOM_SEED, _candidate_models


def _write_json(path: Path, value: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, indent=2, sort_keys=True), encoding="utf-8")


def _metric_line(metrics: dict[str, Any]) -> str:
    return (
        f"accuracy={metrics['accuracy']:.4f}, balanced_accuracy={metrics['balanced_accuracy']:.4f}, "
        f"precision={metrics['precision_vulnerable']:.4f}, recall={metrics['recall_vulnerable']:.4f}, "
        f"F1={metrics['f1_vulnerable']:.4f}, ROC-AUC={metrics['roc_auc']:.4f}, PR-AUC={metrics['pr_auc']:.4f}, "
        f"MCC={metrics['matthews_correlation_coefficient']:.4f}"
    )


def run(root: Path, seed: int = RANDOM_SEED) -> dict[str, Any]:
    processed_dir = root / "data" / "processed"
    frames = {name: pd.read_parquet(processed_dir / f"{name}.parquet") for name in ("train", "validation", "test")}
    combined_parts = []
    for source_split, frame in frames.items():
        part = frame.copy()
        part["source_split"] = source_split
        combined_parts.append(part)
    combined = pd.concat(combined_parts, ignore_index=True)

    clone_audit = investigate_and_group(combined)
    partitions = grouped_partitions(clone_audit.frame, seed)
    output_dir = root / "data" / "leakage_controlled"
    output_dir.mkdir(parents=True, exist_ok=True)
    for name, frame in partitions.items():
        frame.to_parquet(output_dir / f"{name}.parquet", index=False)

    vectorizer = build_vectorizer()
    train_features = vectorizer.fit_transform(partitions["train"]["code"])
    validation_features = vectorizer.transform(partitions["validation"]["code"])
    models = _candidate_models(seed)
    validation: dict[str, Any] = {}
    for name, model in models.items():
        model.fit(train_features, partitions["train"]["target"])
        pred = model.predict(validation_features)
        validation[name] = classification_metrics(
            partitions["validation"]["target"], pred, model_scores(model, validation_features)
        )
    selected = max(
        validation,
        key=lambda name: (
            validation[name]["f1_vulnerable"], validation[name]["recall_vulnerable"], validation[name]["accuracy"]
        ),
    )
    test_features = vectorizer.transform(partitions["test"]["code"])
    test_pred = models[selected].predict(test_features)
    test_scores = model_scores(models[selected], test_features)
    test_metrics = classification_metrics(partitions["test"]["target"], test_pred, test_scores)
    language_metrics = per_language_metrics(partitions["test"], test_pred, test_scores)

    group_overlap = {}
    for left, right in (("train", "validation"), ("train", "test"), ("validation", "test")):
        group_overlap[f"{left}_{right}"] = len(set(partitions[left]["clone_group"]) & set(partitions[right]["clone_group"]))
    result = {
        "random_seed": seed,
        "grouping_method": "Connected components of high-confidence clone edges: >=20 tokens and either raw token-5-gram Jaccard >=0.90 with length ratio >=0.85, or identical canonical token sequence with length ratio >=0.95.",
        "source_has_project_metadata": False,
        "clone_audit": clone_audit.summary,
        "partition_rows": {name: len(frame) for name, frame in partitions.items()},
        "partition_class_counts": {name: {str(k): int(v) for k, v in frame["target"].value_counts().sort_index().items()} for name, frame in partitions.items()},
        "clone_group_overlap": group_overlap,
        "feature_count": int(train_features.shape[1]),
        "selection_rule": "Highest validation vulnerable-class F1; ties use recall then accuracy.",
        "selected_model": selected,
        "validation_metrics": validation,
        "test_metrics": test_metrics,
        "per_language_test_metrics": language_metrics,
    }
    reports = root / "reports"
    _write_json(reports / "leakage_controlled_evaluation.json", result)

    artifact_dir = root / "artifacts" / "leakage_controlled"
    artifact_dir.mkdir(parents=True, exist_ok=True)
    canonicalize_vectorizer_for_persistence(vectorizer)
    vectorizer_path = artifact_dir / "tfidf_vectorizer.joblib"
    model_path = artifact_dir / f"{selected}.joblib"
    joblib.dump(vectorizer, vectorizer_path, compress=0)
    joblib.dump(models[selected], model_path, compress=0)
    result["artifact_sha256"] = {
        vectorizer_path.name: sha256_file(vectorizer_path),
        model_path.name: sha256_file(model_path),
    }
    _write_json(reports / "leakage_controlled_evaluation.json", result)

    near_lines = [
        "# Near-Duplicate Investigation", "",
        "The Phase 1 SimHash count is a broad candidate signal, not a verified clone count. Its canonicalization replaces every identifier, number, and string, so short boilerplate and common control-flow shapes can collide.", "",
        f"- Candidate pairs examined: {clone_audit.summary['candidate_pairs']:,}",
        f"- Broad SimHash pairs (Hamming distance <=3): {clone_audit.summary['broad_simhash_pairs']:,}",
        f"- Cross-original-split broad pairs: {clone_audit.summary['cross_split_broad_pairs']:,}",
        f"- Verified clone edges: {clone_audit.summary['verified_clone_edges']:,}",
        f"- Cross-original-split verified edges: {clone_audit.summary['cross_split_verified_clone_edges']:,}",
        f"- Multi-row connected components: {clone_audit.summary['multirow_components']:,}",
        f"- Largest component: {clone_audit.summary['largest_component']:,}", "", "## Representative pairs", "",
    ]
    for example in clone_audit.examples:
        left_excerpt = example["left_excerpt"].replace("`", "'")
        right_excerpt = example["right_excerpt"].replace("`", "'")
        near_lines.extend([
            f"### {example['classification']}", "", f"- Left: {example['left']}", f"- Right: {example['right']}",
            f"- SimHash distance: {example['simhash_distance']}", f"- Raw token 5-gram Jaccard: {example['token_5gram_jaccard']}",
            f"- Left excerpt: `{left_excerpt}`", f"- Right excerpt: `{right_excerpt}`", "",
        ])
    near_lines.extend(["## Interpretation", "", "Project-level separation was not possible because the source schema has no repository, project, commit, or file identity. The leakage-controlled split therefore uses conservative verified-clone components. This prevents those detected clone families from crossing partitions but cannot prove absence of same-project or semantic leakage."])
    (reports / "near_duplicate_investigation.md").write_text("\n".join(near_lines) + "\n", encoding="utf-8")

    eval_lines = [
        "# Leakage-Controlled Evaluation", "", "This is a new group-separated experiment. The original Phase 1 reports and artifacts were preserved unchanged.", "",
        f"- Rows: {result['partition_rows']}", f"- Clone-group overlap across partitions: {group_overlap}", f"- Selected model: `{selected}`", f"- Selection rule: {result['selection_rule']}", "", "## Validation", "",
    ]
    for name, metrics in validation.items():
        eval_lines.append(f"- `{name}`: {_metric_line(metrics)}")
    eval_lines.extend(["", "## Untouched grouped test partition", "", f"- {_metric_line(test_metrics)}", f"- Confusion matrix `[[TN, FP], [FN, TP]]`: `{test_metrics['confusion_matrix']}`", "", "Accuracy is reported but is not sufficient for imbalanced vulnerability data; balanced accuracy, PR-AUC, MCC, vulnerable-class precision/recall/F1, and the confusion matrix provide the necessary context.", "", "## Limitations", "", "This grouping controls only verified lexical clone families. No project identifiers exist in the source data, and semantic clones can remain. The result is stronger than the original random/source split but is not a project-held-out benchmark."])
    (reports / "leakage_controlled_evaluation.md").write_text("\n".join(eval_lines) + "\n", encoding="utf-8")
    return result


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", default=".")
    parser.add_argument("--seed", type=int, default=RANDOM_SEED)
    args = parser.parse_args()
    print(json.dumps(run(Path(args.root).resolve(), args.seed), indent=2))


if __name__ == "__main__":
    main()
