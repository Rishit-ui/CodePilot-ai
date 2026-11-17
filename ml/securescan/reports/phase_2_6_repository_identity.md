# SecureScan Phase 2.6 Repository Identity

## Status: REQUIRES_REVIEW

- Raw repository identities: **763**.
- Normalization covers HTTPS, SSH/scp remotes, `.git`, host aliases and case on
  GitHub/GitLab/Bitbucket.
- Relationship evidence: `{"canonical_url_alias": 4, "cross_repo_exact_code": 33}`.

Repositories are connected only by evidence: normalized canonical equality,
shared Git commit hashes, cross-repository exact code, licence URL redirects,
or candidate-level CVE/clone relationships. Similar names alone are never
merged. Full authoritative fork-parent, archive and rename metadata is blocked
where provider APIs require credentials or rate limits prevent exhaustive
verification; those identities remain separate or conservatively connected by
code/history evidence and require review.
