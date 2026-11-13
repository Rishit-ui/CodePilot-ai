# Job Lifecycle

1. Authenticated owner submits a supported job with an idempotency key.
2. API checks project permission and per-user hourly/concurrent quotas.
3. PostgreSQL atomically inserts `QUEUED` job and `PENDING` outbox.
4. Publisher sends only IDs and marks job `DISPATCHED`; failure remains retryable.
5. Consumer validates envelope/outbox and atomically leases job as `RUNNING`.
6. Handler persists progress. Test execution additionally requires the source-controlled release gate.
7. Actual work/output persistence precedes `SUCCEEDED`.
8. Retryable failure returns to `QUEUED`; exhaustion becomes `FAILED` and poisoned.
9. Expired leases recover; maximum lifetime becomes `EXPIRED`; actual command timeout becomes `TIMED_OUT`.
10. Owner cancellation becomes `CANCELLED` before dispatch or `CANCEL_REQUESTED` while active.

Authorized endpoints: create project job, list own jobs, retrieve own job, cancel, retry, authorize/complete project upload, and retrieve owned artifact. Queue acceptance is never presented as job success.

Only execution orchestration is implemented. Provider consumers for the remaining long-running static workflows need staging integration and are `BLOCKED`; their jobs must not be advertised as completed merely because they were queued.
