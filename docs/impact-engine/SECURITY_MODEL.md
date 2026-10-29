# Security Model & Threat Assessment for Test Execution

**Document Status:** Implementation Reference  
**Date:** 2026-10-29  
**Module:** `src/impact/runner.js`  
**Purpose:** Defense-in-depth isolation for executing arbitrary user-supplied and repository test suites.

---

## 1. Threat Landscape

Regression tests execute arbitrary code by design. When analyzing third-party repositories, automated test execution presents severe security threats:
1. **Host Secret Exfiltration:** Tests reading `process.env` to steal AWS, GitHub, Vercel, or database credentials.
2. **Denial of Service (DoS):** Infinite loops or fork-bombs exhausting server CPU and memory.
3. **Buffer Flooding:** Generating gigabytes of stdout to crash Node.js heap memory.
4. **Command Injection:** Manipulating test file names with shell metacharacters (`test; rm -rf /; .js`).

---

## 2. Implemented Defense Controls

### 2.1 Command Allowlist & Injection Prevention
- The runner enforces strict allowlists: only approved test runners (`node --test`, `npm test`, `pytest`) are permitted.
- Shell metacharacters (`" ' ; & | < > ^ $ \``) in test file names are stripped prior to subprocess invocation.

### 2.2 Environment Sanitization (Secret Stripping)
- Subprocess environments are completely stripped of all host environment variables.
- Sensitive credentials (`CODEPILOT_SESSION_SECRET`, `AWS_*`, `GITHUB_*`, `VERCEL_*`, `RENDER_*`, `POSTGRES_URL`, `DATABASE_URL`) are omitted.
- The subprocess receives only minimal runtime flags:
  ```json
  {
    "PATH": "<system-path>",
    "NODE_ENV": "test",
    "CI": "true",
    "TMPDIR": "/tmp"
  }
  ```

### 2.3 Subprocess Timeouts & Stream Throttling
- Hard wall-clock timeout (default 30 seconds) enforced via Node's `spawn` timeout monitor.
- Standard output and standard error streams are capped at 64 KB, preventing memory exhaustion attacks.

---

## 3. Residual Limitations & Production Recommendations

1. **Process Isolation vs Virtualization:** Standard OS process isolation (`child_process.spawn`) does not prevent a malicious test from reading world-readable files on the local filesystem outside the workspace.
2. **Production Containerization:** In multi-tenant cloud deployments, test execution should be delegated to ephemeral, non-root microVMs (e.g. Firecracker, Docker with `gVisor` runtime, or isolated GitHub Actions runners) with network isolation enabled.
