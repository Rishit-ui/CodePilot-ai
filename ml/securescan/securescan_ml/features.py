"""Feature extraction that consumes source code and no label metadata."""

from __future__ import annotations

import numpy as np
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.pipeline import FeatureUnion


def build_vectorizer() -> FeatureUnion:
    """Combine lexical and character TF-IDF signals for multi-language code."""
    return FeatureUnion(
        [
            (
                "word",
                TfidfVectorizer(
                    analyzer="word",
                    token_pattern=r"(?u)\b\w+\b|[^\s\w]",
                    ngram_range=(1, 2),
                    min_df=2,
                    max_df=0.995,
                    max_features=60_000,
                    sublinear_tf=True,
                    strip_accents=None,
                    lowercase=False,
                    dtype=np.float32,
                ),
            ),
            (
                "character",
                TfidfVectorizer(
                    analyzer="char_wb",
                    ngram_range=(3, 5),
                    min_df=2,
                    max_df=0.995,
                    max_features=90_000,
                    sublinear_tf=True,
                    strip_accents=None,
                    lowercase=False,
                    dtype=np.float32,
                ),
            ),
        ],
        n_jobs=1,
    )


def canonicalize_vectorizer_for_persistence(vectorizer: FeatureUnion) -> FeatureUnion:
    """Remove diagnostic sets and stabilize vocabulary ordering before Joblib serialization."""
    for _, transformer in vectorizer.transformer_list:
        if hasattr(transformer, "vocabulary_"):
            transformer.vocabulary_ = dict(sorted(transformer.vocabulary_.items()))
        # stop_words_ is diagnostic only after fitting and can be large and hash-order dependent.
        if hasattr(transformer, "stop_words_"):
            delattr(transformer, "stop_words_")
    return vectorizer
