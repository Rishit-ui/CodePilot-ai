# DRAFT — NOT SENT

Subject: Clarification request for CVEfixes v1.0.8 function-count methodology

Dear CVEfixes maintainers,

We are reviewing the v1.0.8 SQLite release from Zenodo record 13118970. The
release description reports 138,974 functions. Our read-only restoration has:

- 277,948 physical `method_change` rows;
- 198,985 groups using `(file_change_id, exact signature-or-name)`;
- pair cardinalities: `[{"after_rows":78963,"before_rows":78963,"classification":"one_to_one","groups":78963},{"after_rows":72386,"before_rows":0,"classification":"unmatched_after","groups":72386},{"after_rows":0,"before_rows":47636,"classification":"unmatched_before","groups":47636}]`.

The exact queries and assumptions are attached in
`phase_2_8_count_methodology_evidence.json`.

Could you clarify:

1. What exact SQL/query or collection-stage counter produced 138,974?
2. Does that count represent changed logical functions, before/after method
   versions, or another collection abstraction?
3. How are additions, deletions, renames, repeated signatures, duplicate method
   text, multiple CVEs, and repeated repository/commit records counted?
4. Is there a release-specific mapping between a published function and its
   `method_change_id` rows?
5. Are any post-collection filters applied before publishing the aggregate?

We are not assuming that the exact arithmetic factor of two proves paired
versions, because the observed pair cardinalities do not support that globally.

Regards,
[sender name and role]
