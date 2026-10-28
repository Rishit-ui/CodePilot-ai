# CodePilot AI — Security Policy & Threat Model

## 1. Core Security Tenets

1. **Untrusted Code as Inert Data**: Imported repository archives and files are treated strictly as untrusted data. The primary application process NEVER executes, evals, or dynamically imports repository code.
2. **Deterministic Fallbacks**: AI model predictions are strictly validated against verified source code lines.
3. **No Unredacted Secrets**: Credential material is identified and masked at ingestion time before saving to explorer outputs.
4. **Deny-by-Default Outbound Networking**: All external URL fetches are checked against the SSRF shield before initiating network sockets.

## 2. Threat Vectors & Implemented Controls

| Threat Vector | Risk Description | Implemented Mitigation | Verification Test |
| :--- | :--- | :--- | :--- |
| **Zip Slip** | Archive entries containing `../` or absolute paths targeting system files. | Strict path validation rejecting separators, root indicators, and null bytes (`src/archive.js`). | `tests/archive.test.js` |
| **Zip Bomb** | Highly compressed malicious archives exhausting memory and disk. | Per-file size limits (2MB), max extracted size (30MB), max file count (1,500), and max 100:1 compression ratio check. | `tests/archive.test.js` |
| **Symlink Traversal** | Archive containing symlinks pointing outside sandbox directory. | Explicit rejection of POSIX symlink attribute `0o120000` during central directory parsing. | `tests/archive.test.js` |
| **SSRF** | Remote archive import targeting internal services, AWS metadata (`169.254.169.254`), or loopback. | Pre-fetch DNS resolution checking all resolved IPs against private IPv4/IPv6 ranges and blocking metadata endpoints (`src/importer.js`). | `tests/ssrf.test.js` |
| **Credential Exposure** | Repository files containing AWS keys, GitHub PATs, private keys, database passwords. | Multi-pattern regex detection and automatic redaction before storage; high/critical findings surfaced with suppression tracking. | `tests/analyzers.test.js` |
| **Prompt Injection** | Repository content attempting to override system prompts or grant tool permissions. | Context sanitization stripping delimiter tokens (`<|im_start|>`, `[SYSTEM_PROMPT]`); model permissions are static and enforced outside LLM context. | `tests/ai.test.js` |
| **Command Injection in Test Runner** | Malicious shell commands injected through test execution API. | Strict command allowlist (`npm test`, `node --test`, `pytest`, `go test`) with process timeouts and clean environment. | `tests/test_runner.js` |
| **Fake Deployment Success** | Reporting deployment succeeded when target service failed to boot. | Live HTTP GET check against health probe URL verifying HTTP 200 and JSON payload before marking `verified`. | `tests/api.test.js` |
| **Session Hijacking / Insecure Auth** | Weak password hashes, timing attacks, or unauthenticated production deployment. | Password hashing with `crypto.scryptSync`, constant-time comparison `crypto.timingSafeEqual`, 64-character tokens, and production session secret requirement. | `tests/auth.test.js` |
