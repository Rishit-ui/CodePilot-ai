# SecureScan Phase 2.6 Count Reconciliation

## Status: REQUIRES_REVIEW — physical factor-of-two observed; semantic convention unresolved

The restored database contains **277,948 method-version rows**: `True`=126,599
and `False`=151,349. Grouping by
`(file_change_id, exact signature-or-name)` while treating each unkeyed row as
its own logical record yields **198,985 logical groups**.

| Pair cardinality | Groups | Before rows | After rows |
|---|---:|---:|---:|
| `one_to_one` | 78,963 | 78,963 | 78,963 |
| `unmatched_after` | 72,386 | 0 | 72,386 |
| `unmatched_before` | 47,636 | 47,636 | 0 |

- Complete one-to-one groups: **78,963**.
- Unmatched before groups: **47,636**.
- Unmatched after groups: **72,386**.
- One/many, many/one, many/many or unkeyed groups: **0**.
- Rows without a usable signature or name: **0**.

The published 138,974 value equals exactly half of 277,948, but actual
before/after cardinalities are not globally one-to-one and the observed logical
group count is 198,985. The database therefore explains the arithmetic
factor of two, but does **not** reproduce the published semantic counting
method. It cannot be reproduced simply by selecting one `before_change` value
or by treating every row as a complete pair. Author methodology clarification
is required; the evidence does not justify forcing unmatched or ambiguous rows
into one-to-one pairs.
