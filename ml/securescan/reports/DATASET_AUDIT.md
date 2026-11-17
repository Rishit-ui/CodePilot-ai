# SecureScan Dataset Audit

- Dataset: `mcanoglu/defect-detection`
- Source revision: `6a433bbc30bea2d1053484c4bdfb75673044561a`
- Declared license: `mit`
- Separate license files at pinned revision: `[]`
- Raw rows: 39,850
- Processed usable rows: 27,588
- Languages: C, C++, Go, Java, JavaScript, PHP, Python, Ruby, TypeScript

## Splits

| Split | Raw rows | Processed rows | Unusable code |
| --- | ---: | ---: | ---: |
| train | 31,882 | 22,960 | 0 |
| validation | 3,984 | 2,369 | 0 |
| test | 3,984 | 2,259 | 0 |

## Labels

The source dataset uses `0 = vulnerable` and `1 = safe`. SecureScan re-encodes the model target as `0 = safe` and `1 = vulnerable`, making the vulnerable class the positive class for precision, recall, F1, and ROC-AUC.

All numeric/text label pairs consistent: **True**.

## Duplicate audit

- Exact duplicate groups: 5,664
- Rows in exact duplicate groups: 17,285
- Cross-split exact duplicate groups: 2,403
- Conflicting-label exact duplicate groups: 641
- Exact duplicate rows removed: 8,819
- Conflicting duplicate rows removed: 3,443
- Heuristic near-duplicate pairs: 117,777
- Cross-split heuristic near-duplicate pairs: 37,310

Near duplicates are audited with structural SimHash and are not automatically removed because the heuristic can confuse short, idiomatic code with copied code. Exact normalized-code duplicates are removed globally with train → validation → test priority to prevent leakage.

## Input isolation

Only normalized source code enters the vectorizer. CWE identifiers, CWE names, descriptions, URLs, programming-language values, and label fields are retained for audit/evaluation only and are excluded from model input.

## License and attribution

The Hugging Face card declares the dataset under the MIT license, but the pinned repository contains no separate LICENSE or COPYING file. Preserve attribution to `mcanoglu/defect-detection`, the source URL, pinned revision, and the standard MIT permission/copyright notice in any dataset redistribution. Individual snippets may originate from upstream projects; users should perform their own provenance review before redistribution.
