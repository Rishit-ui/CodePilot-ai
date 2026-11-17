"""Integrity-checked artifact loading and source-code prediction."""

from __future__ import annotations

import hashlib
import json
from pathlib import Path
from typing import Any

import joblib

from .data import MODEL_LABEL_TO_NAME, is_usable_code, normalize_code


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def load_artifacts(artifact_dir: str | Path) -> tuple[Any, Any, dict[str, Any]]:
    directory = Path(artifact_dir)
    metadata = json.loads((directory / "model_metadata.json").read_text(encoding="utf-8"))
    model_path = directory / metadata["selected_model_file"]
    vectorizer_path = directory / metadata["vectorizer_file"]
    for path in (model_path, vectorizer_path):
        expected = metadata["artifact_sha256"].get(path.name)
        if not expected or sha256_file(path) != expected:
            raise ValueError(f"Artifact integrity verification failed for {path.name}")
    return joblib.load(model_path), joblib.load(vectorizer_path), metadata


def predict_code(code: str, model: Any, vectorizer: Any, metadata: dict[str, Any]) -> dict[str, Any]:
    normalized = normalize_code(code)
    if not is_usable_code(normalized):
        raise ValueError("Source code input is empty or unusable")
    features = vectorizer.transform([normalized])
    target = int(model.predict(features)[0])
    if hasattr(model, "predict_proba"):
        score_kind = "vulnerable_probability"
        score = float(model.predict_proba(features)[0, 1])
    elif hasattr(model, "decision_function"):
        score_kind = "decision_function"
        score = float(model.decision_function(features)[0])
    else:
        score_kind = None
        score = None
    return {
        "label": MODEL_LABEL_TO_NAME[target],
        "target": target,
        "score_kind": score_kind,
        "score": score,
        "model": metadata["selected_model"],
        "warning": "Statistical screening result only; it does not prove that code is secure or vulnerable.",
    }
