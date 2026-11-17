# CodePilot SecureScan ML — Phase 1

This workspace trains a real classical machine-learning code-snippet classifier without changing CodePilot's Node.js runtime, API, frontend, Docker image, deployment configuration, or existing security scanner. Phase 1 is offline research and artifact generation only.

## Dataset

- Source: [mcanoglu/defect-detection](https://huggingface.co/datasets/mcanoglu/defect-detection)
- Pinned revision: `6a433bbc30bea2d1053484c4bdfb75673044561a`
- Dataset-card license: MIT
- Raw splits: 31,882 train, 3,984 validation, 3,984 test; 39,850 total
- Languages: C, C++, Go, Java, JavaScript, PHP, Python, Ruby, TypeScript

The source uses the unusual mapping `0 = vulnerable`, `1 = safe`. Every numeric/text pair was checked; all 39,850 are consistent. SecureScan re-encodes the learning target as `0 = safe`, `1 = vulnerable` so vulnerability is the positive class.

The dataset card declares MIT, but the pinned repository contains no separate `LICENSE` or `COPYING` file. Preserve the dataset name, URL, pinned revision, and the standard MIT permission/copyright notice when redistributing dataset material. Because snippets can originate in upstream projects, independently review provenance and upstream licensing before redistributing raw code.

## Audit and preprocessing

Only the `code` field enters TF-IDF. CWE identifiers/names, descriptions, URLs, language values, and labels are excluded from model input. Programming language remains available for stratified reporting.

Processing normalizes line endings and trailing whitespace but preserves identifiers, punctuation, operators, strings, comments, casing, and security-relevant syntax. It removes empty/unusable rows, exact normalized-code duplicates, and every exact-duplicate group with conflicting labels. Global exact deduplication uses train → validation → test priority to prevent exact split leakage.

Measured audit results:

| Item | Count |
| --- | ---: |
| Raw rows | 39,850 |
| Unusable code rows | 0 |
| Exact duplicate groups | 5,664 |
| Rows in exact duplicate groups | 17,285 |
| Cross-split exact duplicate groups | 2,403 |
| Conflicting-label duplicate groups | 641 |
| Conflicting duplicate rows removed | 3,443 |
| Additional exact duplicate rows removed | 8,819 |
| Processed train / validation / test | 22,960 / 2,369 / 2,259 |
| Processed total | 27,588 |

Structural SimHash found 117,777 heuristic near-duplicate pairs, including 37,310 cross-split pairs. These are reported but not removed automatically because short idiomatic snippets can look structurally identical without being copied. This unresolved near-duplicate structure is a material limitation and may inflate measured generalization.

See [reports/DATASET_AUDIT.md](reports/DATASET_AUDIT.md) and `reports/dataset_audit.json` for the complete audit. Processed Parquet files are reproducible outputs under ignored `data/processed/`.

## Models

The shared 150,000-feature representation is a union of:

- Word TF-IDF with 1–2 grams, preserving case and code punctuation.
- Character-boundary TF-IDF with 3–5 grams.

Two models are fitted only on the processed training split:

1. Balanced Logistic Regression.
2. Balanced Linear SVM (`LinearSVC`).

The best model is selected by vulnerable-class F1 on validation data, with recall and accuracy as tie-breakers. The test split is transformed and evaluated only after selection. Random seed: `42`.

## Actual results

Logistic Regression won model selection.

| Split/model | Accuracy | Precision vulnerable | Recall vulnerable | F1 vulnerable | ROC-AUC |
| --- | ---: | ---: | ---: | ---: | ---: |
| Validation — Logistic Regression | 0.6057 | 0.5802 | 0.5844 | 0.5823 | 0.6967 |
| Validation — Linear SVM | 0.5977 | 0.5717 | 0.5763 | 0.5740 | 0.6718 |
| Test — selected Logistic Regression | 0.6020 | 0.5422 | 0.5669 | 0.5543 | 0.6790 |

Test confusion matrix (`[[TN, FP], [FN, TP]]`): `[[801, 472], [427, 559]]`.

Per-language performance varies sharply: test vulnerable-class F1 ranges from 0.3961 for C to 0.7500 for Go. These results are not strong enough for autonomous security decisions. See [reports/evaluation_report.md](reports/evaluation_report.md), `reports/model_comparison.json`, and [reports/confusion_matrix.png](reports/confusion_matrix.png).

## Reproduce

From `ml/securescan/` with Python 3.12:

```powershell
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
.\.venv\Scripts\python.exe -m securescan_ml.audit
.\.venv\Scripts\python.exe -m securescan_ml.train
.\.venv\Scripts\python.exe -m pytest
```

On POSIX systems, use `.venv/bin/python` instead. The audit and training commands pin the dataset revision in source. Model binaries, downloaded data, caches, and the virtual environment are ignored by Git.

Generated local artifacts:

- `artifacts/tfidf_vectorizer.joblib` — 4,786,133 bytes
- `artifacts/tfidf_logistic_regression.joblib` — 1,200,891 bytes
- `artifacts/tfidf_linear_svm.joblib` — 1,200,747 bytes
- `artifacts/model_metadata.json` — selected model, hashes, versions, mappings, configuration, metrics, and limitations

Artifact loading verifies SHA-256 before deserialization. These binary artifacts are not committed in Phase 1.

The complete training command was run twice after serialization canonicalization. Validation/test metrics and all three artifact SHA-256 values matched across runs; the evidence is recorded in `reports/reproducibility.json`.

## Known limitations

- This is snippet classification, not proof that code is secure or exploitable.
- Exact duplicates were removed, but substantial heuristic near-duplicate contamination remains.
- No independently sourced external vulnerability corpus has been evaluated.
- Performance is weak and uneven by language, especially C and JavaScript.
- TF-IDF cannot reason about control flow, data flow, build configuration, dependencies, or runtime context.
- Predictions must complement—not replace—CodePilot's existing static analysis, review, tests, and threat modeling.
- The dataset is balanced and curated; real repository prevalence and error costs will differ.

Recommended next step: independently validate on a project-separated, provenance-reviewed external corpus and establish per-language thresholds/calibration before considering Phase 2 API integration.

## Phase 1.5 leakage and external validation

Phase 1.5 preserves the original results above and adds a conservative clone-grouped experiment plus an official PrimeVul v0.1 external-corpus evaluation. The source dataset has no repository, project, commit, or file identity, so a true project-held-out split cannot be constructed. Verified lexical/type-2 clone connected components are kept entirely within one partition instead.

Run the local leakage-controlled experiment after the Phase 1 processed data exists:

```powershell
.\.venv\Scripts\python.exe -m securescan_ml.phase15 --root .
```

PrimeVul is acquired only from the v0.1 Google Drive folder linked by the [official repository](https://github.com/DLVulDet/PrimeVul). Its six JSONL files belong under ignored `data/external/primevul-v0.1/`. With those files present, run:

```powershell
.\.venv\Scripts\python.exe -m securescan_ml.external --root .
```

The external evaluator verifies every local release file by SHA-256, uses the original Phase 1 Logistic Regression and vectorizer, fixes the decision threshold at 0.5, excludes detected exact/high-confidence near overlaps, and never tunes on PrimeVul. See `reports/near_duplicate_investigation.md`, `reports/leakage_controlled_evaluation.md`, `reports/primevul_external_evaluation.md`, and `reports/phase_1_5_summary.md`.

The PrimeVul result is poor: after detected-overlap exclusions, vulnerable-class F1 is 0.0276 and PR-AUC is 0.0170. The model is not suitable for API integration or security enforcement. Because the Phase 1 corpus lacks project provenance, the PrimeVul result is described as an external-corpus evaluation—not a contamination-proof independent benchmark.
