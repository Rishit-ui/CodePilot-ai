# CodePilot Impact Engine — Prior Art Matrix

> **Scope**: This matrix surveys publicly documented tools and research that address change-impact analysis, dependency graph construction, evidence reconciliation, and regression test selection. It is intended to inform patent-agent assessment, not to establish novelty claims.

---

## 1. Change-Impact Analysis Tools

| System | Organization | Published | Core Technique | Overlap with Impact Engine |
|--------|-------------|-----------|----------------|---------------------------|
| [Bazel](https://bazel.build/) | Google | 2015 (open-sourced) | BUILD-file dependency graph; action graph; incremental build | Dependency graph, selective test execution |
| [Buck2](https://buck2.build/) | Meta | 2022 | Starlark dependency rules; action graph | Similar to Bazel |
| [Turborepo](https://turbo.build/) | Vercel | 2021 | Package-level dependency graph; affected-packages detection | Transitive impact cone |
| [Nx Affected](https://nx.dev/nx-api/nx/documents/affected) | Nrwl | 2018 | Git-diff + project-graph traversal; `--affected` flag | Changed-file + transitive strategies |
| [JDepend](https://github.com/clarkware/jdepend) | Clarkware | 1997 | Java package dependency metrics | Static dependency extraction |
| [ArchUnit](https://www.archunit.org/) | TNG Technology | 2017 | Rule-based architecture constraint checking | Dependency graph validation |

---

## 2. Regression Test Selection

| System | Organization | Published | Core Technique | Overlap |
|--------|-------------|-----------|----------------|---------|
| [Launchable](https://www.launchableinc.com/) | Launchable Inc. | 2020 | ML-based test selection from build/test history | Evidence-aware selection |
| [pytest-testmon](https://github.com/tarpas/pytest-testmon) | Open source | 2015 | Coverage-based test selection for Python | Test-to-file mapping, selective execution |
| [Jest --changedSince](https://jestjs.io/docs/cli#--changedsince) | Meta | 2018 | Git-diff based test selection | Changed-file strategy |
| [Vitest related](https://vitest.dev/guide/filtering.html) | Vitest | 2022 | Import graph-based related file detection | Static import traversal |
| [Microsoft COSMOS](https://dl.acm.org/doi/10.1145/3338906.3338919) | Microsoft | 2019 (ESEC/FSE) | Dynamic call-graph based test selection at scale | Transitive impact with dynamic evidence |
| [Google TAP](https://dl.acm.org/doi/10.1145/2756549.2756553) | Google | 2015 (ICSE) | Continuous integration with selective test execution | Evidence-aware strategy conceptually |

---

## 3. Dependency Graph Construction

| System | Organization | Published | Core Technique | Overlap |
|--------|-------------|-----------|----------------|---------|
| [depends](https://github.com/multilang-depends/depends) | Open source | 2018 | Multi-language static dependency extraction | Analyzer module |
| [Sourcetrail](https://github.com/CoatiSoftware/Sourcetrail) | Coati | 2016 | Cross-language code navigation graph | Graph construction |
| [CodeCharta](https://maibornwolff.github.io/CodeCharta/) | MaibornWolff | 2017 | Dependency metrics visualization | Graph + visualization |
| [Semgrep](https://semgrep.dev/) | r2c / Semgrep Inc. | 2021 | AST-based pattern matching across languages | AST extraction |
| [tree-sitter](https://tree-sitter.github.io/) | GitHub | 2018 | Incremental parsing; concrete syntax trees | AST parsing (the Impact Engine uses `acorn`) |

---

## 4. Evidence Reconciliation and Uncertainty

| Concept | Source | Relevance |
|---------|--------|-----------|
| Belief Revision (AGM framework) | Alchourrón, Gärdenfors, Makinson (1985) | Theoretical basis for evidence conflict resolution |
| Dempster-Shafer Evidence Theory | Dempster (1967), Shafer (1976) | Probabilistic evidence combination |
| Provenance tracking in databases | Buneman et al. (2001) | Evidence source annotation |
| Diagnosis in model-based reasoning | Reiter (1987) | Conflict detection in belief sets |

> **Note**: The Impact Engine uses a **deterministic 9-rule precedence ordering** rather than probabilistic combination, which is simpler and more auditable than Dempster-Shafer.

---

## 5. Incremental Graph Update

| System | Published | Technique | Overlap |
|--------|-----------|-----------|---------|
| [Incremental dataflow analysis](https://dl.acm.org/doi/10.1145/357062.357071) | Ryder & Paull (1988) | Incremental update of dataflow facts | Theoretical basis |
| Bazel's incremental action graph | Google (2015) | Hash-based node invalidation | computeRevisionDiff |
| [Gradle incremental compilation](https://docs.gradle.org/current/userguide/incremental_compilation.html) | Gradle Inc. (2014) | Dependency-set invalidation | Invalidation cone |

---

## Summary Assessment

The specific **combination** of:
1. Multi-source evidence annotation on typed dependency graph edges
2. Deterministic 9-rule precedence reconciliation of conflicting evidence
3. Incremental graph invalidation with full-rebuild fallback
4. Three-strategy test selection with reduction metrics and recall guarantee

...represents a design choice, not a fundamentally novel algorithm. Each individual component has documented prior art. The combination may constitute a **novel arrangement** but patent eligibility requires professional legal assessment.

See `PATENT_AGENT_BRIEF.md` for guidance on next steps.
