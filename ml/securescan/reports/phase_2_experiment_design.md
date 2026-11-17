# SecureScan Phase 2 Experiment Design

## Purpose

This is a pre-registered research design. No model was trained and no final test results were examined. All release gates below must be frozen before training begins.

## 1. Acquisition and incremental audit

Use CVEfixes v1.0.8 as the primary candidate after provisioning at least 85 GB free storage. Verify the Zenodo MD5 and record a SHA-256 locally. Restore the SQLite database by streaming the nested SQL gzip; do not materialize the SQL text and do not load whole tables into Pandas.

Create indexes only if absent on:

- `repository(repo_url)`
- `commits(repo_url, hash)` and `commits(hash)`
- `fixes(repo_url, hash, cve_id)`
- `file_change(hash, file_change_id, programming_language)`
- `method_change(file_change_id, before_change)`
- `cwe_classification(cve_id, cwe_id)`

Run SQL aggregate queries first for C/C++ row counts, projects, CVEs, commits, nulls, label values and duplicate hashes. Stream code in bounded cursor batches for normalization and clone analysis.

## 2. Label verification and pair construction

Do not trust the documented boolean without evidence. Before corpus construction:

1. Randomly sample at least 100 C/C++ `before_change=True/False` candidates, stratified by project and CWE.
2. Inspect repository commit diffs against `file_change.code_before/code_after`.
3. Verify that `True` is pre-fix and `False` post-fix, recording counterexamples.
4. Require zero mapping inversions in the audit sample and at least 95% correct function-level vulnerability relevance before proceeding; otherwise stop for relabeling/manual adjudication.

Pair only rows with the same `file_change_id` and an unambiguous signature/name mapping supported by the diff. Store an explicit generated `pair_id`. Do not pair overloaded, renamed, added, deleted, parser-failed or many-to-many candidates automatically. Measure pairing precision on a stratified manual sample; require at least 95% precision.

## 3. Representative benign functions

Patched functions alone are not representative negatives. Build separately labeled negative strata:

- `patched_safe`: verified post-fix counterpart of a vulnerable function.
- `unchanged_same_file`: a function whose normalized body is unchanged between the before/after file snapshots.
- `snapshot_unmodified`: functions from a bounded, time-matched repository snapshot outside vulnerability-fixing files/commits.
- `uncertain`: anything lacking sufficient evidence; exclude from supervised training.

For `unchanged_same_file`, parse `code_before` and `code_after`, match functions by signature plus normalized body hash and exclude any function intersecting changed lines. For snapshot negatives, begin with a stratified pilot of selected repositories; do not clone thousands of repositories. Record snapshot commit, file path and parser version.

Negative strata must remain identifiable through evaluation. Never describe patched or sampled negatives as natural production prevalence.

## 4. Deduplication and grouping

Compute:

- Raw and whitespace-normalized SHA-256.
- Conservative token/type-2 fingerprints.
- High-confidence token n-gram/AST clone edges.
- Conflicting-label groups.

Exact or verified clone groups with conflicting labels are excluded pending adjudication. Build a graph whose nodes are canonical repositories and whose edges represent cross-repository verified clones. Connected repository/clone components—not individual rows—are the split units. This prevents copied code or forks from crossing partitions.

Normalize repository URLs, resolve moved repositories and treat forks as linked when shared history or clone evidence warrants it. Every excluded/unresolved row receives a reason code.

## 5. Nested project-held-out validation

Freeze one deterministic split manifest before feature extraction:

- 70% development-training project/clone components.
- 15% validation project/clone components.
- 15% final outer-test project/clone components.

Balance assignment by total functions, vulnerable functions, CWE coverage and project size without splitting a component. Publish aggregate manifest statistics but not raw code.

Within development-training projects only, use five-fold grouped cross-validation for feature/model/hyperparameter selection. Validation projects may be used once for final model-family selection, calibration and threshold/alert-budget selection. After freezing every choice, refit using development-training data as predeclared and evaluate final test projects exactly once.

Never move projects after observing test metrics. Never tune features, hyperparameters, calibration or thresholds on test projects.

## 6. Prevalence and sampling

Report three distinct quantities:

- Dataset prevalence: retained vulnerable fraction before sampling.
- Sampled prevalence: fraction actually supplied to a training procedure.
- Estimated real-world prevalence: only when supported by a defined repository population and sampling frame.

Preserve natural retained prevalence in validation and test. Training may use class weights or bounded sampling, but sampled ratios and weights must be recorded. Do not balance validation/test sets.

## 7. Evaluation and alert budgets

Primary evaluation unit is the repository. For each held-out repository, rank all eligible functions and evaluate top 1%, 5% and 10% alert budgets. Report:

- Precision@K and recall@K.
- Alerts and false positives per repository.
- Vulnerable functions missed.
- PR-AUC, ROC-AUC, MCC and balanced accuracy.
- Paired vulnerable/patched ordering and both-correct rate where verified pairs exist.
- Per-project values, macro project averages and size-weighted micro values.

Confidence intervals use a project-level bootstrap: resample held-out repositories with replacement at least 2,000 times, preserving every function within the sampled project. Do not bootstrap individual functions as independent observations.

Compare against predeclared baselines: all-benign, random ranking at observed prevalence, function-length/complexity ranking, Phase 1 TF-IDF, and an established static-analysis baseline where its supported CWE/language scope is clear.

## 8. Gates frozen before training

### Dataset gate

- At least 100,000 usable C/C++ functions across at least 200 canonical projects.
- At least 5,000 verified vulnerable functions.
- 100% final-test and >=99% development provenance coverage.
- 100% retained-project license status recorded.
- Zero exact or verified clone-component overlap across partitions.
- Zero unresolved conflicting-label groups in retained data.
- At least 95% pair-link precision and at least 95% audited function-level label relevance. If label relevance misses this gate, stop and design adjudication rather than train.

### Research model gate

All must hold on the untouched outer test with project-bootstrap confidence intervals:

- PR-AUC point estimate >=5 times test prevalence and lower 95% bound >2 times prevalence.
- MCC >=0.20 with lower 95% bound >0.
- Balanced accuracy >=0.65 with lower 95% bound >0.55.
- Top-1% precision >=0.20 and recall >=0.20.
- Top-5% precision >=0.10 and recall >=0.50.
- Top-10% recall >=0.70.
- Median false positives per repository at the selected operational budget <=5 and 95th percentile <=20.
- Verified paired both-correct rate >=0.50 and vulnerable-above-patched ordering >=0.75.

These are research progression gates, not a production safety certification. Failure of any gate keeps API/frontend integration disabled.

## 9. Reproducibility

Record source revisions, checksums, SQL queries, parser versions, exclusion manifests, repository identity map, split manifest, seed, environment lock, artifact SHA-256 values and all failed/aborted runs. Re-running preprocessing from the same SQLite database must reproduce sample IDs and split assignments exactly.
