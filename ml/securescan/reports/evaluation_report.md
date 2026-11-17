# SecureScan Model Evaluation

- Selected model: `tfidf_logistic_regression`
- Selection rule: Highest validation vulnerable-class F1; ties use recall then accuracy. Test metrics are excluded from selection.
- Training rows: 22,960
- Validation rows: 2,369
- Untouched test rows: 2,259
- TF-IDF features: 150,000

## Validation comparison

| Model | Accuracy | Precision (vulnerable) | Recall (vulnerable) | F1 (vulnerable) | ROC-AUC |
| --- | ---: | ---: | ---: | ---: | ---: |
| tfidf_logistic_regression | 0.6057 | 0.5802 | 0.5844 | 0.5823 | 0.6967 |
| tfidf_linear_svm | 0.5977 | 0.5717 | 0.5763 | 0.5740 | 0.6718 |

## Final test metrics

- Accuracy: 0.6020
- Precision (vulnerable): 0.5422
- Recall (vulnerable): 0.5669
- F1 (vulnerable): 0.5543
- ROC-AUC: 0.6790
- Confusion matrix `[[TN, FP], [FN, TP]]`: `[[801, 472], [427, 559]]`

## Per-language test performance

Languages with at least 25 processed test rows are reported.

| Language | Rows | Accuracy | Precision | Recall | F1 | ROC-AUC |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| C | 557 | 0.4417 | 0.4048 | 0.3878 | 0.3961 | 0.4434 |
| C++ | 143 | 0.5874 | 0.5682 | 0.7042 | 0.6289 | 0.6944 |
| Go | 97 | 0.7526 | 0.7500 | 0.7500 | 0.7500 | 0.8720 |
| Java | 205 | 0.6244 | 0.6667 | 0.6372 | 0.6516 | 0.7007 |
| JavaScript | 476 | 0.6029 | 0.4516 | 0.4023 | 0.4255 | 0.6512 |
| PHP | 401 | 0.7057 | 0.6053 | 0.7278 | 0.6609 | 0.8112 |
| Python | 184 | 0.7174 | 0.6316 | 0.7792 | 0.6977 | 0.8045 |
| Ruby | 129 | 0.6899 | 0.6452 | 0.6897 | 0.6667 | 0.7627 |
| TypeScript | 67 | 0.5672 | 0.4242 | 0.5833 | 0.4912 | 0.6589 |

## Interpretation and limitations

This is a statistical code-snippet classifier, not proof of security. It does not execute code, build data/control-flow graphs, or establish exploitability. The source dataset contains extensive duplicate and near-duplicate structure. Exact duplicates and conflicting exact duplicates were removed before fitting, but heuristic near duplicates remain and may inflate generalization metrics.

The evaluation covers 9 labeled languages from one curated dataset. Results should not be generalized to unseen languages, full repositories, dependency vulnerabilities, configuration errors, or production exploitability without external validation.
