# Comprehensive Application Security Audit & Threat Model

**Application:** CodePilot AI  
**Version:** 0.2.0  
**Audit Date:** 2026-11-13  
**Status:** HARDENED & VERIFIED  

---

## 1. Executive Summary

CodePilot AI functions as a developer intelligence platform that ingests untrusted codebases (via ZIP archives, remote URLs, and GitHub links), parses source structures, analyzes dependencies, and runs selective regression tests. This architectural posture makes ingestion safety, command isolation, and SSRF prevention primary security boundaries.

All security controls were audited and verified using automated test suites.

---

## 2. Threat Analysis & Implemented Defenses

### A. Repository Ingestion & ZIP Slip Protection
* **Threat:** Malicious ZIP archives containing relative paths (`../../etc/passwd`) or symlinks targeting sensitive host files.
* **Mitigation (`src/archive.js`):**
  - Strict path resolution asserting that all extracted targets reside strictly within the intended destination directory.
  - Rejection of entries beginning with `/` or containing `..`.
  - Detection and rejection of symbolic links (`entry.isSymbolicLink` / entry mode checks).
  - Enforcement of archive size boundaries: maximum file count (10,000 files) and maximum uncompressed size limits.
  - Content hashing via SHA-256 for integrity verification.
* **Verification:** `tests/archive.test.js` (Passing: rejection of zip slip, absolute paths, symlinks, oversized files).

### B. Remote Ingestion & SSRF Mitigation
* **Threat:** Attackers providing remote archive URLs targeting internal infrastructure (`169.254.169.254` AWS metadata, `127.0.0.1`, `10.0.0.0/8`, `192.168.0.0/16`, `::1`).
* **Mitigation (`src/importer.js`):**
  - Protocol whitelist: strictly `http:` and `https:`.
  - DNS resolution validation before making outbound HTTP requests.
  - Verification that target IP does not belong to loopback, link-local, private RFC 1918 CIDRs, or IPv6 equivalents (`isPrivateIp`).
  - Redirect safety: all HTTP 3xx redirect destinations are re-evaluated against SSRF rules before following.
* **Verification:** `tests/ssrf.test.js` (Passing: loopback, private ranges, metadata IP rejection).

### C. Authentication & Access Control
* **Threat:** Brute-force attacks, weak passwords, privilege escalation, credential sniffing.
* **Mitigation (`src/auth.js`):**
  - Password hashing utilizing Node.js native `crypto.scryptSync` with unique 16-byte random salts.
  - High-entropy cryptographic bearer session tokens generated via `crypto.randomBytes(32)`.
  - Timing-safe comparison (`crypto.timingSafeEqual`) on password hashes to prevent timing attacks.
  - Strict input validation on registration: RFC-compliant email formatting and password strength enforcement (minimum 10 characters, requiring uppercase, lowercase, digit, and special characters).
  - Role-Based Access Control (RBAC) with defined permission boundaries (`owner` > `admin` > `editor` > `viewer`).
* **Verification:** `tests/auth.test.js` (Passing: password hashing, timing-safe equality, token entropy, RBAC hierarchy, email and password validation).

### D. Subprocess Test Runner Isolation
* **Threat:** Remote Code Execution (RCE) via untrusted test commands or malicious scripts attempting to leak host environment variables.
* **Mitigation (`src/impact/runner.js`):**
  - Strict command allowlist: only approved test runners (`npm test`, `npx jest`, `node --test`, `pytest`, `python -m unittest`) are permitted.
  - Command line arguments are validated and sanitized without invoking shell interpreters (`shell: false`).
  - Secret stripping: environment variables containing sensitive keywords (`TOKEN`, `KEY`, `SECRET`, `PASSWORD`, `AUTH`, `CREDENTIAL`) are scrubbed before passing `process.env` to the child process.
  - Execution timeouts and maximum buffer output limits to mitigate Denial of Service (DoS).
* **Verification:** `tests/impact_selection.test.js` (Passing: allowlist enforcement, secret scrubbing).

### E. AI Input & Context Grounding
* **Threat:** Prompt injection from analyzed repository files attempting to hijack the AI assistant's system instructions.
* **Mitigation (`src/ai.js`):**
  - Repository content is explicitly encapsulated inside isolated context blocks labeled as untrusted input.
  - Fixed system prompts assert that code files are observational data only and cannot alter the assistant's operational persona.
  - Offline deterministic fallback ensures no external data leaks occur when API keys are absent.

---

## 3. Residual Security Findings & Recommendations

1. **Test Runner Sandboxing:** While the `IsolatedTestRunner` restricts command synthesis and scrubs secrets, test processes still run under the host OS permissions of the application process. For enterprise multi-tenant deployments, executing tests inside ephemeral microVMs (e.g., Firecracker or Docker-in-Docker) is recommended.
2. **Rate Limiting:** Production deployments behind reverse proxies (Nginx / Cloudflare / Vercel Edge) should enforce per-IP rate limiting on `/api/auth/login` and `/api/auth/register` to mitigate distributed credential stuffing.
