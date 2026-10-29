# Experiment Protocol & Benchmark Methodology

**Document Status:** Implementation Reference  
**Date:** 2026-10-29  
**Module:** `scripts/impact-engine/benchmark.js`  
**Purpose:** Standardized protocol for evaluating regression test selection recall, reduction ratios, and incremental update overhead.

---

## 1. Objectives & Metrics

The experiment framework evaluates three core properties:
1. **Regression Detection Recall ($R$):**
   $$R = \frac{|D_{\text{caught}}|}{|D_{\text{total}}|}$$
   Must equal $100\%$ for safety. Any regression detected by the full test suite that is omitted by an RTS strategy constitutes a *Regression Escape* (critical safety failure).
2. **Test Reduction Ratio ($\eta$):**
   $$\eta = 1 - \frac{|T_{\text{selected}}|}{|T_{\text{all}}|}$$
   Measures testing resource and duration savings.
3. **Graph Maintenance Overhead ($T_{\text{incr}}$ vs $T_{\text{full}}$):**
   Wall-clock latency required to produce an isomorphic graph across revision diffs.

---

## 2. Experimental Scenarios

| Scenario ID | Name | Perturbation Description | Expected Behavior |
| :--- | :--- | :--- | :--- |
| **S1** | Direct Modification | Local change in isolated mathematical utility (`math.js`). | Both `changed-file` and `evidence-aware` should achieve 75% reduction with 100% recall. |
| **S2** | Transitive Deep Dependency | Schema alteration in low-level database layer (`database.js`). | `changed-file` will miss transitively affected controller test (Regression Escape). `evidence-aware` must detect transitive cone and select test. |
| **S3** | Conflicted / Uncertain Evidence | Injected contradiction in dynamic dispatch record. | Conventional RTS ignores or discards edge. `evidence-aware` must trigger conservative uncertainty fallback to prevent regression escape. |

---

## 3. Execution Environment

- **Runner Script:** `node scripts/impact-engine/benchmark.js`
- **Output Artifacts:** `results/impact-engine/benchmark_results.json`
- **Repetition:** 10 timing iterations with high-resolution performance timers (`performance.now()`).
