# SecureScan Phase 1.5 Summary

## Outcome

Phase 1.5 completed the leakage investigation, constructed a conservative clone-group-separated internal benchmark, and evaluated the unchanged Phase 1 Logistic Regression pipeline on official PrimeVul v0.1. The external result fails the reliability bar. API/frontend integration should not begin.

## Git reconciliation

- Branch: `feature/securescan-ml`
- Pre-rebase local Phase 1 commit observed during this run: `f56f23e1fc54bfb14bbbe5eb99b1420f702e06dd`
- Fetched `origin/main` and `origin/feature/securescan-ml`: `f629c25c29b33e5adf427d0e91bd919f13363253`
- Rebased cleanly onto `origin/main`; no conflicts and no stash was needed.
- Current local HEAD after rebase: `7ecfb2ad7b9886636abbdba80409a49d7dac24a7`
- Phase 1.5 changes are uncommitted. Nothing was pushed.

## 1. Why the near-duplicate count was so high

The Phase 1 heuristic replaces every identifier, numeric literal, and string literal before computing 64-bit SimHash over token trigrams. This deliberately detects renamed structural clones, but it also collapses unrelated short boilerplate into similar representations. Four 16-bit LSH bands generate candidates and Hamming distance <=3 labels broad matches. Two high-frequency buckets were capped at 500 rows, so even the broad count is an estimate rather than an exhaustive clone count.

Re-running the audit on the 27,588 exact-deduplicated rows found:

- 1,878,290 candidate pairs.
- 114,609 broad SimHash pairs.
- 36,723 broad pairs crossing the original splits.
- 11,213 conservatively verified clone edges.
- 3,356 verified edges crossing the original splits.
- 3,571 multi-row connected components; largest component 42 rows.

Representative accepted and rejected pairs are recorded in `near_duplicate_investigation.md`. The broad SimHash count was therefore not interpreted as 114,609 proven copies.

## 2. Leakage-control strategy

The source schema contains only code, labels, language, CWE metadata, description, and a CWE URL. It has no repository, project, commit, file path, or source revision. A defensible project-separated split is impossible.

The replacement benchmark groups only high-confidence lexical/type-2 clones: both snippets must contain at least 20 tokens and either have raw token-5-gram Jaccard >=0.90 with token-length ratio >=0.85, or have an identical canonical token sequence with length ratio >=0.95. Connected components are atomic split groups. Deterministic stratified group folds create train/validation/test partitions of 22,069 / 2,760 / 2,759 rows with zero clone-group overlap.

This controls detected clone families but cannot eliminate same-project or semantic leakage.

## 3. Internal metrics before and after leakage control

The original Phase 1 test reported accuracy 0.6020, vulnerable precision 0.5422, recall 0.5669, F1 0.5543, and ROC-AUC 0.6790 on 2,259 rows.

The new group-separated experiment selected Logistic Regression on validation data. Its untouched grouped test partition reported:

- Accuracy: 0.657485.
- Balanced accuracy: 0.655903.
- Vulnerable precision: 0.638780.
- Vulnerable recall: 0.628462.
- Vulnerable F1: 0.633579.
- ROC-AUC: 0.735593.
- PR-AUC: 0.724590.
- MCC: 0.312117.
- Confusion matrix: `[[997, 462], [483, 817]]`.

The higher grouped score does not prove the original result was conservative or leakage-free: the new partition has a different composition and is still not project-held-out.

## 4. PrimeVul provenance and composition

- Official repository: `https://github.com/DLVulDet/PrimeVul`
- Pinned repository revision: `6f54687c84947b1d17486495440b37030d147289`
- Release: PrimeVul v0.1 from the official repository-linked Google Drive folder.
- Repository license: MIT. Upstream code-snippet attribution/license obligations can still apply when redistributing samples.
- Label mapping verified from the release and paper convention: `0=benign`, `1=vulnerable`.
- Standard train/validation/test rows: 175,797 / 23,948 / 24,788.
- Standard class counts: train 170,935/4,862; validation 23,355/593; test 24,239/549 (benign/vulnerable).
- Paired train/validation/test rows: 7,578 / 960 / 870, each balanced within its split.
- C/C++ scope, 631 train projects, and 123 distinct serialized CWE sets in train.
- No exact normalized-code hashes cross the three standard PrimeVul splits.

All six local file hashes, schemas, missing values, project counts, and CWE counts are recorded in `primevul_external_evaluation.json`.

## 5. Contamination findings

The 6,817 C/C++ rows used to train the Phase 1 model were compared with all 24,788 PrimeVul test rows:

- 187 PrimeVul rows exactly overlap after loss-minimizing normalization.
- 234 rows have verified high-confidence near overlap.
- The union is 238 excluded rows (0.96% of the test set).
- The exclusions remove 86 of 549 vulnerable rows (15.66%), which is meaningful.
- 1,308,304 cross-corpus LSH candidates were generated and 88,638 distance-<=3 pairs were inspected.
- Four repetitive LSH buckets were capped.

Project-name overlap cannot be measured because the Phase 1 source has no project identity. Consequently this is not described as a contamination-proof independent benchmark. It is an external-corpus evaluation after detected-overlap exclusions.

## 6. PrimeVul fixed-threshold results

The unchanged saved Phase 1 Logistic Regression and vectorizer evaluated 24,550 remaining rows at the fixed 0.5 threshold; no PrimeVul tuning was performed. The remaining distribution was 24,087 benign and 463 vulnerable.

- Accuracy: 0.462892 (95% stratified bootstrap CI 0.457412–0.469576).
- Balanced accuracy: 0.433957 (0.412647–0.457022).
- Vulnerable precision: 0.014278 (0.012779–0.015879).
- Vulnerable recall: 0.403888 (0.360691–0.450378).
- Vulnerable F1: 0.027581 (0.024686–0.030672).
- ROC-AUC: 0.415546 (0.383214–0.444125).
- PR-AUC: 0.016952 (0.015468–0.019169).
- MCC: -0.036016 (-0.047616–-0.023446).
- Confusion matrix: `[[11177, 12910], [276, 187]]`.
- Precision@100 / recall@100: 0.0100 / 0.00216.
- At K=463 (the vulnerable count), precision and recall are both 0.02376.

Accuracy is especially misleading here: an all-benign classifier would score approximately 98.1% accuracy. The model produces 12,910 false positives for 187 true positives.

## 7. Paired evaluation

After excluding every pair containing an overlap-detected row, 342 complete vulnerable/patched pairs remain:

- Vulnerable score above patched score: 65.50%.
- Both sides correctly classified at threshold 0.5: 1.46%.
- Vulnerable side detected: 44.44%.
- Patched side classified benign: 56.43%.

The modest ordering signal does not translate into a usable decision threshold.

## 8. Reproducibility and artifact integrity

The leakage-controlled pipeline was run twice with seed 42. Split sizes, clone counts, model selection, validation metrics, and test metrics matched exactly. Current generated artifact hashes are:

- `tfidf_vectorizer.joblib`: `d134dbfb4cd301672918cf20263ef1bc005604538e3ded72ebe93381c3a60af4`
- `tfidf_logistic_regression.joblib`: `3bfe9b781cb4a8e8d0d078161344939bd3a973cf5788d130a599355276194422`

Generated datasets, PrimeVul files, virtual environments, and model binaries remain ignored by Git.

## Verification executed

- `python -m compileall -q securescan_ml`: PASS.
- `python -m pytest tests -q`: PASS, 12 passed in 6.39 seconds (10 preserved Phase 1 tests plus 2 leakage/imbalanced-metric regressions).
- `npm run check`: PASS.
- First sandboxed `npm test`: 91 passed, 9 failed, 5 skipped; all nine failures were localhost `EACCES` denials from the managed execution sandbox.
- Authorized localhost-only `npm test` rerun: PASS, 100 passed, 0 failed, 5 skipped, 105 total in 5.20 seconds.
- `git diff --check`: PASS.

The five Node skips require explicit real-provider or PostgreSQL authorization and were not reported as passes.

## 9. Decision and next step

Phase 1.5 is complete as an investigation, but model readiness is **FAIL**. The external precision, PR-AUC, MCC, false-positive volume, and paired correctness are incompatible with production vulnerability detection. Do not start API/frontend integration.

Recommended Phase 2 is research-only: obtain a provenance-rich, project-separated training corpus; train/calibrate C/C++ separately under realistic prevalence; use nested project-held-out validation; compare against simple static-analysis and all-benign baselines; and require materially improved external PR-AUC, precision at an operational alert budget, and paired correctness before any integration gate is reconsidered.
