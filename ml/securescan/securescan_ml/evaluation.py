"""Truthful binary-classification evaluation utilities."""

from __future__ import annotations

from typing import Any

import numpy as np
import pandas as pd
from sklearn.metrics import (
    accuracy_score,
    average_precision_score,
    balanced_accuracy_score,
    classification_report,
    confusion_matrix,
    f1_score,
    matthews_corrcoef,
    precision_score,
    recall_score,
    roc_auc_score,
)

from .data import MODEL_LABEL_TO_NAME


def model_scores(model: Any, features: Any) -> np.ndarray | None:
    if hasattr(model, "predict_proba"):
        return np.asarray(model.predict_proba(features))[:, 1]
    if hasattr(model, "decision_function"):
        return np.asarray(model.decision_function(features))
    return None


def classification_metrics(y_true: Any, y_pred: Any, scores: Any | None = None) -> dict[str, Any]:
    metrics: dict[str, Any] = {
        "accuracy": float(accuracy_score(y_true, y_pred)),
        "balanced_accuracy": float(balanced_accuracy_score(y_true, y_pred)),
        "matthews_correlation_coefficient": float(matthews_corrcoef(y_true, y_pred)),
        "precision_vulnerable": float(precision_score(y_true, y_pred, pos_label=1, zero_division=0)),
        "recall_vulnerable": float(recall_score(y_true, y_pred, pos_label=1, zero_division=0)),
        "f1_vulnerable": float(f1_score(y_true, y_pred, pos_label=1, zero_division=0)),
        "confusion_matrix": confusion_matrix(y_true, y_pred, labels=[0, 1]).tolist(),
        "classification_report": classification_report(
            y_true,
            y_pred,
            labels=[0, 1],
            target_names=[MODEL_LABEL_TO_NAME[0], MODEL_LABEL_TO_NAME[1]],
            output_dict=True,
            zero_division=0,
        ),
    }
    has_both_classes = len(set(y_true)) == 2
    metrics["roc_auc"] = float(roc_auc_score(y_true, scores)) if scores is not None and has_both_classes else None
    metrics["pr_auc"] = float(average_precision_score(y_true, scores)) if scores is not None and has_both_classes else None
    return metrics


def per_language_metrics(frame: pd.DataFrame, predictions: np.ndarray, scores: np.ndarray | None, minimum_rows: int = 25) -> dict[str, Any]:
    results: dict[str, Any] = {}
    for language, indices in frame.groupby("programming_language").groups.items():
        index_array = np.asarray(list(indices), dtype=int)
        if len(index_array) < minimum_rows:
            continue
        language_scores = scores[index_array] if scores is not None else None
        results[str(language)] = {
            "rows": int(len(index_array)),
            **classification_metrics(
                frame.iloc[index_array]["target"].to_numpy(),
                predictions[index_array],
                language_scores,
            ),
        }
    return results
