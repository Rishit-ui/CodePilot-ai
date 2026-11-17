"""Train, select, evaluate, and persist real SecureScan ML models."""

from __future__ import annotations

import argparse
import hashlib
import json
import platform
import random
import sys
import time
from pathlib import Path
from typing import Any

import joblib
import matplotlib
import numpy as np
import pandas as pd
import sklearn
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import ConfusionMatrixDisplay
from sklearn.svm import LinearSVC

from .audit import render_audit_markdown
from .data import (
    DEFAULT_REVISION,
    EXPECTED_SPLITS,
    MODEL_LABEL_TO_NAME,
    RAW_LABEL_TO_NAME,
    build_audit,
    load_dataset_bundle,
    save_processed_splits,
)
from .evaluation import classification_metrics, model_scores, per_language_metrics
from .features import build_vectorizer, canonicalize_vectorizer_for_persistence
from .predict import sha256_file

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402

RANDOM_SEED = 42


def _json_write(path: Path, value: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, indent=2, sort_keys=True), encoding="utf-8")


def _ensure_processed(root: Path, revision: str) -> tuple[dict[str, pd.DataFrame], dict[str, Any]]:
    processed_dir = root / "data" / "processed"
    reports_dir = root / "reports"
    audit_path = reports_dir / "dataset_audit.json"
    split_paths = {split: processed_dir / f"{split}.parquet" for split in EXPECTED_SPLITS}
    if audit_path.exists() and all(path.exists() for path in split_paths.values()):
        return (
            {split: pd.read_parquet(path) for split, path in split_paths.items()},
            json.loads(audit_path.read_text(encoding="utf-8")),
        )

    dataset, source = load_dataset_bundle(root / "data" / "cache", revision)
    audit, processed = build_audit(dataset, source)
    save_processed_splits(processed, processed_dir)
    _json_write(audit_path, audit)
    (reports_dir / "DATASET_AUDIT.md").write_text(render_audit_markdown(audit), encoding="utf-8")
    return processed, audit


def _candidate_models(seed: int) -> dict[str, Any]:
    return {
        "tfidf_logistic_regression": LogisticRegression(
            C=1.0,
            solver="liblinear",
            class_weight="balanced",
            max_iter=1_000,
            random_state=seed,
        ),
        "tfidf_linear_svm": LinearSVC(
            C=1.0,
            class_weight="balanced",
            dual="auto",
            max_iter=5_000,
            random_state=seed,
        ),
    }


def _render_evaluation_report(
    comparison: dict[str, Any],
    test_metrics: dict[str, Any],
    per_language: dict[str, Any],
    audit: dict[str, Any],
) -> str:
    selected = comparison["selected_model"]
    lines = [
        "# SecureScan Model Evaluation",
        "",
        f"- Selected model: `{selected}`",
        f"- Selection rule: {comparison['selection_rule']}",
        f"- Training rows: {comparison['split_rows']['train']:,}",
        f"- Validation rows: {comparison['split_rows']['validation']:,}",
        f"- Untouched test rows: {comparison['split_rows']['test']:,}",
        f"- TF-IDF features: {comparison['feature_count']:,}",
        "",
        "## Validation comparison",
        "",
        "| Model | Accuracy | Precision (vulnerable) | Recall (vulnerable) | F1 (vulnerable) | ROC-AUC |",
        "| --- | ---: | ---: | ---: | ---: | ---: |",
    ]
    for name, candidate in comparison["models"].items():
        metrics = candidate["validation_metrics"]
        lines.append(
            f"| {name} | {metrics['accuracy']:.4f} | {metrics['precision_vulnerable']:.4f} | "
            f"{metrics['recall_vulnerable']:.4f} | {metrics['f1_vulnerable']:.4f} | {metrics['roc_auc']:.4f} |"
        )
    lines.extend(
        [
            "",
            "## Final test metrics",
            "",
            f"- Accuracy: {test_metrics['accuracy']:.4f}",
            f"- Precision (vulnerable): {test_metrics['precision_vulnerable']:.4f}",
            f"- Recall (vulnerable): {test_metrics['recall_vulnerable']:.4f}",
            f"- F1 (vulnerable): {test_metrics['f1_vulnerable']:.4f}",
            f"- ROC-AUC: {test_metrics['roc_auc']:.4f}",
            f"- Confusion matrix `[[TN, FP], [FN, TP]]`: `{test_metrics['confusion_matrix']}`",
            "",
            "## Per-language test performance",
            "",
            "Languages with at least 25 processed test rows are reported.",
            "",
            "| Language | Rows | Accuracy | Precision | Recall | F1 | ROC-AUC |",
            "| --- | ---: | ---: | ---: | ---: | ---: | ---: |",
        ]
    )
    for language, metrics in sorted(per_language.items()):
        roc_auc = "n/a" if metrics["roc_auc"] is None else f"{metrics['roc_auc']:.4f}"
        lines.append(
            f"| {language} | {metrics['rows']} | {metrics['accuracy']:.4f} | "
            f"{metrics['precision_vulnerable']:.4f} | {metrics['recall_vulnerable']:.4f} | "
            f"{metrics['f1_vulnerable']:.4f} | {roc_auc} |"
        )
    lines.extend(
        [
            "",
            "## Interpretation and limitations",
            "",
            "This is a statistical code-snippet classifier, not proof of security. It does not execute code, build data/control-flow graphs, "
            "or establish exploitability. The source dataset contains extensive duplicate and near-duplicate structure. Exact duplicates "
            "and conflicting exact duplicates were removed before fitting, but heuristic near duplicates remain and may inflate generalization metrics.",
            "",
            f"The evaluation covers {len(audit['languages'])} labeled languages from one curated dataset. Results should not be generalized "
            "to unseen languages, full repositories, dependency vulnerabilities, configuration errors, or production exploitability without external validation.",
        ]
    )
    return "\n".join(lines) + "\n"


def train(root: Path, revision: str, seed: int = RANDOM_SEED) -> dict[str, Any]:
    random.seed(seed)
    np.random.seed(seed)
    processed, audit = _ensure_processed(root, revision)
    train_frame = processed["train"]
    validation_frame = processed["validation"]
    test_frame = processed["test"]

    vectorizer = build_vectorizer()
    vectorizer_started = time.perf_counter()
    train_features = vectorizer.fit_transform(train_frame["code"])
    validation_features = vectorizer.transform(validation_frame["code"])
    vectorizer_seconds = time.perf_counter() - vectorizer_started

    models = _candidate_models(seed)
    comparison_models: dict[str, Any] = {}
    for name, model in models.items():
        started = time.perf_counter()
        model.fit(train_features, train_frame["target"])
        training_seconds = time.perf_counter() - started
        validation_predictions = model.predict(validation_features)
        validation_scores = model_scores(model, validation_features)
        comparison_models[name] = {
            "validation_metrics": classification_metrics(
                validation_frame["target"], validation_predictions, validation_scores
            ),
            "training_seconds": training_seconds,
            "configuration": model.get_params(deep=False),
        }

    selected_name = max(
        comparison_models,
        key=lambda name: (
            comparison_models[name]["validation_metrics"]["f1_vulnerable"],
            comparison_models[name]["validation_metrics"]["recall_vulnerable"],
            comparison_models[name]["validation_metrics"]["accuracy"],
        ),
    )
    selected_model = models[selected_name]

    # The test split is transformed and evaluated only after model selection.
    test_features = vectorizer.transform(test_frame["code"])
    test_predictions = selected_model.predict(test_features)
    test_scores = model_scores(selected_model, test_features)
    test_metrics = classification_metrics(test_frame["target"], test_predictions, test_scores)
    language_metrics = per_language_metrics(test_frame, test_predictions, test_scores)

    comparison = {
        "dataset_revision": audit["source"]["revision"],
        "random_seed": seed,
        "split_rows": {split: len(processed[split]) for split in EXPECTED_SPLITS},
        "feature_count": int(train_features.shape[1]),
        "vectorizer_fit_seconds": vectorizer_seconds,
        "selection_rule": "Highest validation vulnerable-class F1; ties use recall then accuracy. Test metrics are excluded from selection.",
        "selected_model": selected_name,
        "models": comparison_models,
        "test_metrics": test_metrics,
        "per_language_test_metrics": language_metrics,
    }

    artifacts_dir = root / "artifacts"
    reports_dir = root / "reports"
    artifacts_dir.mkdir(parents=True, exist_ok=True)
    reports_dir.mkdir(parents=True, exist_ok=True)
    vectorizer_file = "tfidf_vectorizer.joblib"
    canonicalize_vectorizer_for_persistence(vectorizer)
    joblib.dump(vectorizer, artifacts_dir / vectorizer_file, compress=0)
    model_files: dict[str, str] = {}
    for name, model in models.items():
        filename = f"{name}.joblib"
        joblib.dump(model, artifacts_dir / filename, compress=0)
        model_files[name] = filename

    artifact_paths = [artifacts_dir / vectorizer_file] + [artifacts_dir / name for name in model_files.values()]
    artifact_sha256 = {path.name: sha256_file(path) for path in artifact_paths}
    artifact_sizes = {path.name: path.stat().st_size for path in artifact_paths}
    metadata = {
        "format_version": 1,
        "selected_model": selected_name,
        "selected_model_file": model_files[selected_name],
        "candidate_model_files": model_files,
        "vectorizer_file": vectorizer_file,
        "artifact_sha256": artifact_sha256,
        "artifact_sizes_bytes": artifact_sizes,
        "dataset": audit["source"],
        "training_configuration": {
            "random_seed": seed,
            "fit_split": "train",
            "selection_split": "validation",
            "evaluation_split": "test",
            "vectorizer": "FeatureUnion(word TF-IDF 1-2 grams, char_wb TF-IDF 3-5 grams)",
            "feature_count": int(train_features.shape[1]),
        },
        "raw_label_mapping": {str(key): value for key, value in RAW_LABEL_TO_NAME.items()},
        "model_label_mapping": {str(key): value for key, value in MODEL_LABEL_TO_NAME.items()},
        "validation_metrics": comparison_models[selected_name]["validation_metrics"],
        "test_metrics": test_metrics,
        "runtime": {
            "python": sys.version,
            "platform": platform.platform(),
            "numpy": np.__version__,
            "pandas": pd.__version__,
            "scikit_learn": sklearn.__version__,
            "joblib": joblib.__version__,
        },
        "limitations": [
            "Statistical snippet classification cannot prove security or exploitability.",
            "Dataset near duplicates remain after exact duplicate removal and may inflate metrics.",
            "Model has not yet been validated on an independently sourced external corpus.",
            "Predictions do not replace static analysis, review, testing, or threat modeling.",
        ],
    }

    _json_write(reports_dir / "model_comparison.json", comparison)
    _json_write(artifacts_dir / "model_metadata.json", metadata)
    (reports_dir / "evaluation_report.md").write_text(
        _render_evaluation_report(comparison, test_metrics, language_metrics, audit), encoding="utf-8"
    )

    display = ConfusionMatrixDisplay(
        confusion_matrix=np.asarray(test_metrics["confusion_matrix"]),
        display_labels=[MODEL_LABEL_TO_NAME[0], MODEL_LABEL_TO_NAME[1]],
    )
    display.plot(cmap="Blues", values_format="d")
    plt.title(f"SecureScan test confusion matrix — {selected_name}")
    plt.tight_layout()
    plt.savefig(reports_dir / "confusion_matrix.png", dpi=180)
    plt.close()
    return {"comparison": comparison, "metadata": metadata}


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", default=".")
    parser.add_argument("--revision", default=DEFAULT_REVISION)
    parser.add_argument("--seed", type=int, default=RANDOM_SEED)
    args = parser.parse_args()
    result = train(Path(args.root).resolve(), args.revision, args.seed)
    print(json.dumps({
        "selected_model": result["comparison"]["selected_model"],
        "validation_metrics": result["metadata"]["validation_metrics"],
        "test_metrics": result["metadata"]["test_metrics"],
        "artifact_sizes_bytes": result["metadata"]["artifact_sizes_bytes"],
    }, indent=2))


if __name__ == "__main__":
    main()
