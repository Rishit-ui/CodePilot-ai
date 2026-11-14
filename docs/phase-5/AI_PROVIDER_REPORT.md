# AI Provider Report

Status: `PASS` for deterministic repository QA and local protocol validation; `BLOCKED` for real external-provider connectivity.

Phase 5 centralizes the OpenAI-compatible, Anthropic Messages and Gemini `generateContent` transports in `src/ai_provider.js`. It adds:

- explicit HTTP/HTTPS URL validation;
- configurable 250 ms–120 s timeout;
- response-size ceiling (1 MiB default, 4 MiB maximum);
- at most three retries, only for 429/500/502/503/504 and network/timeout failures;
- capped exponential backoff with bounded `Retry-After` handling;
- no retry for 401/403;
- strict provider-specific response-shape validation;
- sanitized errors that never include provider bodies or API keys;
- production startup failure when an external provider lacks an explicit key or model.

Local HTTP fixtures verified request routing, one 429 retry, no authentication retry, timeout, malformed JSON, response validation and secret-safe errors for all three shapes. Repository evidence retrieval, line citations, prompt-injection sanitization and truthful no-evidence fallback also passed.

No external API key was available. Authentication, model availability, account context limits, actual rate limits, actual token usage/cost and live answer quality remain `BLOCKED`. The conditional real-provider test was skipped. A local fixture is not reported as real connectivity.
