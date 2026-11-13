# CodePilot AI — Known System Limitations & Technical Boundaries

**Document Purpose:** Transparently record current technical limitations, architectural trade-offs, and external blockers.  
**Audience:** Engineering leads, security reviewers, and platform operators.  

---

## 1. Static Source Analysis Boundaries

1. **AST vs. Lexical Parsing:**
   - **JavaScript / TypeScript:** Parsed using `acorn` for true Abstract Syntax Tree (AST) symbol, import, export, and Express route extraction.
   - **Python:** Analyzed via pattern matching and regex heuristics for class definitions, functions, and FastAPI decorators. Full Python AST parsing is not yet implemented in the Node.js runtime.
   - **Other Languages (Go, Rust, Java, C++):** Detected via file extension classification and basic file metrics; deep AST call-graph construction is not yet supported for these languages.
2. **Dynamic Invocations:**
   - Dynamic imports (`import(variable)`), computed module identifiers, `eval()`, and runtime reflection cannot be resolved statically.
   - The Change-Impact Engine flags unresolved or conflicting dynamic dependencies within an **Uncertainty Cone**, conservatively selecting affected tests to prevent missed regressions.

---

## 2. Change-Impact Engine Scalability Trade-offs

1. **Small vs. Large Repository Latency:**
   - On micro-fixtures (< 10 files), full graph rebuild (avg ~0.40 ms) is faster than computing incremental diffs and invalidating reachability cones (avg ~0.54 ms).
   - An adaptive threshold (70% invalidation for small repositories, 40% for larger repositories) automatically falls back to full rebuild when incremental updates would introduce diffing overhead.
2. **In-Memory Graph Capacity:**
   - The `TypedDependencyGraph` maintains nodes and edges in memory. For massive monorepos exceeding 50,000 source files, external persistent graph engines (such as Neo4j or SQLite graph tables) would be required.

---

## 3. Subprocess Execution & Test Runner Isolation

1. **Host Boundary:**
   - The `IsolatedTestRunner` restricts commands to an allowlist, scrubs environment secrets, and passes arguments safely with `shell: false`.
   - However, subprocesses execute under the operating system permissions of the parent Node.js process. In an untrusted public multi-tenant SaaS environment, test execution must be delegated to sandboxed Docker containers or microVMs (e.g. AWS Firecracker / gVisor).

---

## 4. Cloud Deployments & External AI Providers

1. **Third-Party Credentials:**
   - Real cloud deployments to Vercel, Render, or Railway require valid API tokens configured in the host environment. When unconfigured, the deployer operates in readiness evaluation and configuration generation mode.
   - External LLM completions (OpenAI, Anthropic, Gemini) require corresponding API keys. In their absence, the assistant gracefully falls back to deterministic in-memory contextual explanations grounded in the indexed AST evidence.
