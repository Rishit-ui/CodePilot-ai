# Repository Ingestion Validation

ZIP validation covers valid, empty, nested, hidden, Unicode, unsupported, oversized, duplicate, malformed, traversal, absolute-path and symlink entries. Every retained entry now receives an inventory record. Supported parser inputs are `processed` or `partially-processed`; unknown extensions are `unsupported`; oversized/generated inputs are `excluded`; parser failures are explicitly reported.

Each non-oversized file receives a SHA-256 digest. The archive receives its own SHA-256 content hash and revision deduplication remains enforced by `(project_id, content_hash)`. Ownership and persistence are covered by the authenticated API lifecycle and tenant-isolation suites.

Limitations: ZIP64 and encrypted archives are rejected; files over the configured per-file limit are inventoried but not decompressed; GitHub network downloads were not exercised in Phase 4 because the phase was designed not to depend on external provisioning or mutable network state.
