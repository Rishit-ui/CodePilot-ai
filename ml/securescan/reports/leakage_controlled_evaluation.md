# Leakage-Controlled Evaluation

This is a new group-separated experiment. The original Phase 1 reports and artifacts were preserved unchanged.

- Rows: {'train': 22069, 'validation': 2760, 'test': 2759}
- Clone-group overlap across partitions: {'train_validation': 0, 'train_test': 0, 'validation_test': 0}
- Selected model: `tfidf_logistic_regression`
- Selection rule: Highest validation vulnerable-class F1; ties use recall then accuracy.

## Validation

- `tfidf_logistic_regression`: accuracy=0.6435, balanced_accuracy=0.6440, precision=0.6146, recall=0.6533, F1=0.6334, ROC-AUC=0.7324, PR-AUC=0.7281, MCC=0.2876
- `tfidf_linear_svm`: accuracy=0.6380, balanced_accuracy=0.6382, precision=0.6104, recall=0.6418, F1=0.6257, ROC-AUC=0.7257, PR-AUC=0.7166, MCC=0.2761

## Untouched grouped test partition

- accuracy=0.6575, balanced_accuracy=0.6559, precision=0.6388, recall=0.6285, F1=0.6336, ROC-AUC=0.7356, PR-AUC=0.7246, MCC=0.3121
- Confusion matrix `[[TN, FP], [FN, TP]]`: `[[997, 462], [483, 817]]`

Accuracy is reported but is not sufficient for imbalanced vulnerability data; balanced accuracy, PR-AUC, MCC, vulnerable-class precision/recall/F1, and the confusion matrix provide the necessary context.

## Limitations

This grouping controls only verified lexical clone families. No project identifiers exist in the source data, and semantic clones can remain. The result is stronger than the original random/source split but is not a project-held-out benchmark.
