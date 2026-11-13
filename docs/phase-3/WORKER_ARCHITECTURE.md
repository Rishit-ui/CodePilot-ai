# Worker Architecture

Status: implemented locally and unit-tested; real Vercel Sandbox integration `BLOCKED`.

## Boundary

The main API never calls imported repository code. It creates an owned PostgreSQL job plus transactional outbox record. A queue consumer must re-read that record, atomically acquire a lease, load the immutable revision, and invoke `ExecutionOrchestrator` with an `ExecutionProvider`.

`VercelSandboxProvider` uses the official `@vercel/sandbox` 4.0.0 API: `Sandbox.create`, `mkDir`, `writeFiles`, `runCommand`, `stop`, and `delete`. Creation requests `vercel/sandbox/universal:latest`, `persistent:false`, no ports or mounts, one vCPU, a finite session timeout, and `networkPolicy:'deny-all'`. Only `CI` and the non-secret job ID enter the sandbox environment. Production database, session, AI, queue, and Blob credentials are never passed.

Commands are selected from predefined profiles (`node-test`, `node-test-no-scripts`, `python-pytest`); browser-supplied shell commands are rejected. Workspace paths, file count, per-file size, aggregate size, execution duration, and collected output are bounded. `finally` always stops and deletes the sandbox.

## Hard release gate

`EXECUTION_RELEASE_VERIFIED` is source-controlled as `false`. Production rejects any execution mode other than `disabled`, even if environment variables request Vercel Sandbox. Changing an environment variable cannot release execution.

This architecture is not a verified sandbox claim. Provider credentials were unavailable, so Firecracker isolation, egress enforcement, resource containment and termination were not exercised. Official reference: https://vercel.com/docs/sandbox/sdk-reference.
