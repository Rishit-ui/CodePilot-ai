# SecureScan Phase 2.6 Label Validation

## Status: PASS for encoded semantics; REQUIRES_REVIEW for unsupported examples

The official data dictionary defines `before_change=True` as the pre-fix,
vulnerable method version and `False` as the post-fix version. All
**20,060** C/C++ candidates use one of those two values. Change-type
evidence is preserved in the curation store so additions, deletions and renames
can be distinguished rather than paired blindly.

Change-type/label counts: `[{"before_change": "False", "change_type": "ModificationType.ADD", "rows": 518}, {"before_change": "False", "change_type": "ModificationType.MODIFY", "rows": 11229}, {"before_change": "True", "change_type": "ModificationType.MODIFY", "rows": 8284}, {"before_change": "False", "change_type": "ModificationType.RENAME", "rows": 14}, {"before_change": "True", "change_type": "ModificationType.RENAME", "rows": 15}]`.

C/C++ signature/name pair groups: `{"one_to_one": 6931, "unmatched_after": 4830, "unmatched_before": 1368}`.

Empty/tiny candidates: **0**. Exact
one-to-one pairs are supported by a shared file change and exact signature/name;
unmatched, ambiguous, conflicting-duplicate and repository-ambiguous records are
quarantined. Commit messages were not used to infer labels.
