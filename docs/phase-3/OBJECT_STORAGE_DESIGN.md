# Object Storage Design

Status: ownership/hash workflow unit-tested; real private Blob integration `BLOCKED`.

The API authenticates the user and authorizes the project before generating an upload intent. Object keys are unique and owner-scoped. The intent records expected size, SHA-256, content type, expiry and project owner. The Vercel adapter uses official `@vercel/blob` 2.9.0 `issueSignedToken` and `presignUrl` for a private, single-path, PUT-only, short-lived authorization with an exact size ceiling and ZIP content type.

Completion does not trust token issuance. The adapter calls `head`/`get`, streams the private object through SHA-256 with a byte ceiling, and compares actual size/hash before marking `VERIFIED` and creating an ingestion job. Artifact downloads require artifact ownership and return a short-lived GET-only signed URL. Provider credentials never enter frontend code or queue payloads.

Existing ZIP inspection rejects traversal, absolute paths, symlinks, duplicates, unsupported compression, zip bombs and oversized extraction. Malware scanning is not integrated. Abandoned-object cleanup and real retention enforcement require a provider scheduler and remain `NOT TESTED`.

Private Blob and direct uploads are documented at https://vercel.com/docs/vercel-blob/private-storage and https://vercel.com/docs/vercel-blob/client-upload. No private store/OIDC credentials were supplied, so direct upload, private read, deletion and retention are `NOT TESTED` against Vercel.
