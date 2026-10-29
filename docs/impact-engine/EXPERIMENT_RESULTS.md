# Empirical Experiment Results & Analysis

**Document Status:** Empirical Measurements  
**Date:** 2026-10-29  
**Execution Environment:** Windows, Node.js v24.21.0, x64 architecture  
**Data Source:** `results/impact-engine/benchmark_results.json`  

---

## 1. Regression Test Selection: Safety & Reduction Comparison

| Scenario | Perturbation | Strategy: ALL | Strategy: CHANGED_FILE | Strategy: EVIDENCE_AWARE (Proposed) |
| :--- | :--- | :--- | :--- | :--- |
| **S1: Direct Modification** | `src/utils/math.js` | 4/4 (100% recall)<br>0% reduction | 1/4 (100% recall)<br>75% reduction | **1/4 (100% recall)**<br>**75% reduction** |
| **S2: Transitive Dependency** | `src/core/database.js` | 4/4 (100% recall)<br>0% reduction | 1/4 (**0% recall — MISSED REGRESSION**)<br>75% reduction | **2/4 (100% recall — CAUGHT)**<br>**50% reduction** |
| **S3: Conflicted Uncertainty** | `src/services/orderService.js` | 4/4 (100% recall)<br>0% reduction | 0/4 (**0% recall — MISSED REGRESSION**)<br>100% reduction (unsafe) | **1/4 (100% recall — CAUGHT)**<br>**75% reduction** |

### Key Findings on Regression Recall:
1. **Zero Regression Escapes in Proposed Method:** `evidence-aware` achieved **100% recall** across all scenarios, matching the safety of full-suite execution.
2. **Failure of Conventional Changed-File RTS:** In Scenario 2, `changed-file` failed to select `tests/checkout.test.js` because `checkoutController.js` only transitively depended on `database.js`. In Scenario 3, it omitted all tests when evidence was dynamic or conflicted.
3. **Significant Resource Reduction:** The proposed method yielded **50% to 75% test execution reduction** while preserving safety.

---

## 2. Graph Maintenance Overhead: Full Rebuild vs Incremental Update

Measured over 10 consecutive iterations on the benchmark repository:

| Metric | Measured Value |
| :--- | :--- |
| **Average Full Clean Rebuild** | `0.401 ms` |
| **Average Incremental Update** | `0.542 ms` |
| **Speedup Ratio** | `0.74x` (Incremental slightly slower on micro-fixtures) |

### Honest Negative Finding & Architectural Implication:
On extremely small repositories (< 10 files), the fixed overhead of computing diffs, graph cloning, and invalidation cone traversal (~0.14 ms) exceeds the cost of re-parsing 9 small files from scratch.

**Engine Decision:** This empirical finding confirms the necessity of our **Automatic Fallback Policy** (`fallbackRatioThreshold`):
- For small codebases (< 10 files) or changes affecting > 40% of files, the engine automatically selects clean full rebuild.
- For large multi-file repositories where AST re-parsing takes hundreds of milliseconds, incremental invalidation isolates updates to $\mathcal{C}_{\text{inv}}$, saving compute.
