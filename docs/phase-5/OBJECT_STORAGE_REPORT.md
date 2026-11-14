# Private Object Storage Report

Status: `PASS` for local ownership/metadata/lifecycle logic; `BLOCKED` for a real private Blob store.

The adapter creates short-lived, pathname-scoped private upload and download authorizations. Upload intents record owner, project, exact expected size, SHA-256, content type and expiry. Completion streams the private object through the provider SDK, enforces the byte ceiling, computes SHA-256 and rejects mismatches. Database endpoints re-check the authenticated owner before authorization, completion or artifact access.

Phase 5 adds provider-side deletion for expired authorized uploads and expired artifacts. Cleanup is idempotent at the database boundary: records are changed/deleted only after the provider deletion succeeds; failures remain eligible for retry and create sanitized operational events. Active uploads/artifacts are preserved.

The application directs large archives to Blob instead of forwarding them through the 4.5 MB Vercel Function request limit. `BLOB_READ_WRITE_TOKEN` remains server-only. Safe keys are restricted to `codepilot/<owner>/<name>` and reject traversal.

The browser now uses this path for ZIPs over 4.5 MB when private Blob is configured: it computes SHA-256 locally, requests scoped authorization, performs the direct PUT with actual progress, and asks the server to stream-verify the stored object. With storage disabled it blocks the oversized direct upload and explains the requirement; it does not display success.

Local tests passed for cross-user access, unsafe keys, size/hash verification, abandoned-upload cleanup and retention cleanup. The conditional real private-object verification test was skipped because no private store token or test object was authorized. Real direct upload, CORS, private delivery, retention scheduling and provider deletion are `BLOCKED`.
