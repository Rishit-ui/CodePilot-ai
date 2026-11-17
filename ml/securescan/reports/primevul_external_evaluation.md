# PrimeVul v0.1 External Evaluation

- Official source: https://github.com/DLVulDet/PrimeVul
- Repository revision: `6f54687c84947b1d17486495440b37030d147289`
- Release: `PrimeVul-v0.1` from the official linked Drive folder
- Repository license: MIT
- Labels: `0=benign`, `1=vulnerable`
- Model: original Phase 1 selected Logistic Regression and original saved vectorizer
- Fixed threshold: 0.5 (no PrimeVul tuning)

## Provenance and split audit

- `primevul_test.jsonl`: 24,788 rows; labels {'0': 24239, '1': 549}; SHA-256 `c9dcab5ee897da36eccf0dbb3b510de2dab66a7dec681af29a7a28c8a53331c4`
- `primevul_test_paired.jsonl`: 870 rows; labels {'0': 435, '1': 435}; SHA-256 `384758c25142b640f1768bb0d334c43f315c580022ae94973c66e77128fb3821`
- `primevul_train.jsonl`: 175,797 rows; labels {'0': 170935, '1': 4862}; SHA-256 `5cadee7f3383124cc26ef6e67c8dd76c321e5461c94bef399a2f03a28767e6f5`
- `primevul_train_paired.jsonl`: 7,578 rows; labels {'0': 3789, '1': 3789}; SHA-256 `1b2853c09ac10b5b60d8e995cbf4461b65414dcf90e0cc5086b788caeae1aaaa`
- `primevul_valid.jsonl`: 23,948 rows; labels {'0': 23355, '1': 593}; SHA-256 `7f0b4d05b063c20d5cf57478128538b8c0c36354e8def7f2d4febe6773b9dc7c`
- `primevul_valid_paired.jsonl`: 960 rows; labels {'0': 480, '1': 480}; SHA-256 `14516b7168e8d158e1e9fbeb163b655dd704eafd82c734e86cddc84c564b4285`

The standard test distribution is extremely imbalanced. Accuracy alone can be high for a useless all-benign classifier, so the security-relevant metrics below are primary.

## Contamination audit

- Phase 1 C/C++ training rows compared: 6,817
- Exact normalized overlap rows: 187
- Verified high-confidence near-overlap rows: 234
- Total test rows excluded: 238
- Metadata assessment: Unavailable: the Phase 1 source has no project/repository/commit/file identity.

This is an external-corpus evaluation with detected-overlap exclusions, not a claim that PrimeVul remains a fully independent benchmark for this model. Phase 1 lacks project provenance and capped LSH buckets can undercount repetitive near-clones, so unresolved contamination risk remains.

## Fixed-threshold results

- Evaluated rows: 24,550; classes {'0': 24087, '1': 463}
- Accuracy: 0.462892 (95% CI [0.4574124236252546, 0.4695763747454175])
- Balanced accuracy: 0.433957 (95% CI [0.4126472546288961, 0.45702176756485957])
- Vulnerable precision: 0.014278 (95% CI [0.012779414185028147, 0.01587929305525782])
- Vulnerable recall: 0.403888 (95% CI [0.36069114470842334, 0.45037796976241895])
- Vulnerable F1: 0.027581 (95% CI [0.024686345108432206, 0.03067168807668417])
- ROC-AUC: 0.415546 (95% CI [0.38321373111922125, 0.44412523545631605])
- PR-AUC: 0.016952 (95% CI [0.015467502075692911, 0.019168748782285375])
- MCC: -0.036016 (95% CI [-0.04761648684253643, -0.023445516071565246])
- Confusion matrix `[[TN, FP], [FN, TP]]`: `[[11177, 12910], [276, 187]]`
- Ranking metrics: `{'100': {'k_used': 100, 'vulnerable_found': 1, 'precision_at_k': 0.01, 'recall_at_k': 0.0021598272138228943}, '463': {'k_used': 463, 'vulnerable_found': 11, 'precision_at_k': 0.023758099352051837, 'recall_at_k': 0.023758099352051837}, '500': {'k_used': 500, 'vulnerable_found': 12, 'precision_at_k': 0.024, 'recall_at_k': 0.02591792656587473}, '1000': {'k_used': 1000, 'vulnerable_found': 19, 'precision_at_k': 0.019, 'recall_at_k': 0.04103671706263499}}`

## Paired vulnerable/patched evaluation

- {'eligible_pairs': 342, 'vulnerable_above_safe_rate': 0.6549707602339181, 'both_classified_correctly_rate': 0.014619883040935672, 'vulnerable_detected_rate': 0.4444444444444444, 'patched_benign_rate': 0.564327485380117}

## Limitations

PrimeVul contains C/C++ only and cannot validate the other seven Phase 1 languages. Repository-level MIT licensing is clear, but the functions originate in many upstream projects and redistribution may retain upstream attribution/license obligations. This local evaluation does not establish exploitability or prove code secure.
