# Known Limitations

Updated: 2026-11-14

- Arbitrary repository test execution is disabled in production. The local runner is for trusted development only; there is no verified gVisor/microVM worker.
- Worker isolation, network denial, resource exhaustion, timeout enforcement, cleanup, and production-secret non-disclosure attack tests are `NOT TESTED` because no worker was deployed.
- `execution_jobs`, a transactional outbox, Vercel Queue adapter and idempotent consumer logic are implemented, but no real queue topic/callback was provisioned. Provider delivery remains `NOT TESTED`.
- A private Blob signed-upload adapter, size/SHA-256 verification and owned artifacts are implemented, but no private store was provisioned. Direct upload and secure download remain `NOT TESTED` against Vercel.
- The 30-second Vercel function configuration is appropriate only for bounded API work. Long analysis belongs in a worker.
- Managed PostgreSQL provider TLS, connection proxy, failover, scaling, PITR, and cross-region recovery are `NOT TESTED`; only a local PostgreSQL 17 container was verified.
- PostgreSQL migrations are startup transactions, not a standalone reviewed migration CLI. Always snapshot and stage before production rollout.
- The fixed-window limiter can allow traffic near a window boundary. It is shared and atomic, but not a sliding-window algorithm.
- External AI providers and real cloud deployment adapters require credentials and were not exercised.
- Static dependency analysis remains incomplete for reflection, generated code, runtime-only imports, and languages without dedicated analyzers.
- Sandbox process-count and disk ceilings are not exposed as explicit controls in the implemented adapter; provider behavior must be established adversarially before release.
- Malware scanning, abandoned-object cleanup, non-execution asynchronous handlers and external observability export remain incomplete.
- Phase 4 Impact Engine accuracy uses a nine-scenario synthetic CommonJS dataset. It is not an independent real-repository corpus and establishes neither general accuracy nor novelty/patentability.
- JavaScript/TypeScript and Python have syntax-tree parsers, but semantic type resolution, runtime dispatch, reflection, generated code, path-alias configuration and cross-language calls remain incomplete.
- Recognized extensions for Java, C/C++, C#, Go, Rust, Ruby, PHP and others are inventory labels, not claims of AST or semantic support.
- The final browser run is a workflow/accessibility smoke test, not pixel-diff visual regression or assistive-hardware certification.
- External AI provider timeouts/credentials/rate limits were not exercised against real providers; deterministic local fallback and source retrieval were tested.
- Performance figures are synthetic single-workstation measurements and must not be extrapolated to managed production workloads.
