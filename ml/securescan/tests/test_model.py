import json
from pathlib import Path

import joblib
import numpy as np
import pytest
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.linear_model import LogisticRegression

from securescan_ml.predict import load_artifacts, predict_code, sha256_file
from securescan_ml.evaluation import classification_metrics
from securescan_ml.train import _candidate_models


TRAIN_CODE = [
    "return escape(user_input);",
    "return sanitize(request.value);",
    "query = 'SELECT * FROM users WHERE id=' + user_input;",
    "eval(request.body);",
    "execute_prepared(statement, [user_id]);",
    "render(escape_html(value));",
]
TRAIN_TARGET = np.asarray([0, 0, 1, 1, 0, 0])


def build_fixture_artifacts(tmp_path):
    vectorizer = TfidfVectorizer(analyzer="char", ngram_range=(2, 4))
    features = vectorizer.fit_transform(TRAIN_CODE)
    model = LogisticRegression(random_state=42, solver="liblinear").fit(features, TRAIN_TARGET)
    model_path = tmp_path / "fixture_model.joblib"
    vectorizer_path = tmp_path / "fixture_vectorizer.joblib"
    joblib.dump(model, model_path)
    joblib.dump(vectorizer, vectorizer_path)
    metadata = {
        "selected_model": "fixture_logistic_regression",
        "selected_model_file": model_path.name,
        "vectorizer_file": vectorizer_path.name,
        "artifact_sha256": {
            model_path.name: sha256_file(model_path),
            vectorizer_path.name: sha256_file(vectorizer_path),
        },
    }
    (tmp_path / "model_metadata.json").write_text(json.dumps(metadata), encoding="utf-8")
    return model, vectorizer, metadata


def test_model_loading_verifies_integrity_and_prediction_shape(tmp_path):
    build_fixture_artifacts(tmp_path)
    model, vectorizer, metadata = load_artifacts(tmp_path)
    prediction = predict_code("eval(request.body);", model, vectorizer, metadata)
    assert prediction["label"] in {"safe", "vulnerable"}
    assert prediction["target"] in {0, 1}
    assert prediction["score_kind"] == "vulnerable_probability"
    assert 0.0 <= prediction["score"] <= 1.0
    assert "does not prove" in prediction["warning"]


def test_model_loading_rejects_tampered_artifact(tmp_path):
    _, _, metadata = build_fixture_artifacts(tmp_path)
    model_path = tmp_path / metadata["selected_model_file"]
    model_path.write_bytes(model_path.read_bytes() + b"tamper")
    with pytest.raises(ValueError, match="integrity verification failed"):
        load_artifacts(tmp_path)


def test_prediction_rejects_empty_input(tmp_path):
    model, vectorizer, metadata = build_fixture_artifacts(tmp_path)
    with pytest.raises(ValueError, match="empty or unusable"):
        predict_code("  \n ", model, vectorizer, metadata)


def test_candidate_models_are_reproducible_for_fixed_seed():
    vectorizer = TfidfVectorizer(analyzer="char", ngram_range=(2, 4))
    features = vectorizer.fit_transform(TRAIN_CODE)
    for name in _candidate_models(42):
        first = _candidate_models(42)[name].fit(features, TRAIN_TARGET)
        second = _candidate_models(42)[name].fit(features, TRAIN_TARGET)
        assert np.array_equal(first.predict(features), second.predict(features))
        if hasattr(first, "coef_"):
            assert np.allclose(first.coef_, second.coef_)


def test_trained_phase1_artifacts_load_and_predict_when_present():
    artifact_dir = Path(__file__).resolve().parents[1] / "artifacts"
    if not (artifact_dir / "model_metadata.json").exists():
        pytest.skip("Run python -m securescan_ml.train to create Phase 1 artifacts")
    model, vectorizer, metadata = load_artifacts(artifact_dir)
    prediction = predict_code("query = 'SELECT * FROM users WHERE id=' + user_input;", model, vectorizer, metadata)
    assert prediction["model"] == metadata["selected_model"]
    assert prediction["label"] in {"safe", "vulnerable"}


def test_extended_imbalanced_metrics_are_truthful():
    metrics = classification_metrics([0, 0, 0, 1], [0, 0, 0, 0], [0.1, 0.2, 0.3, 0.4])
    assert metrics["accuracy"] == 0.75
    assert metrics["balanced_accuracy"] == 0.5
    assert metrics["matthews_correlation_coefficient"] == 0.0
    assert metrics["pr_auc"] == 1.0
