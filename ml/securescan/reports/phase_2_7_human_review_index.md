# Phase 2.7 Human Review Index

## Overall status: BLOCKED

| Decision gate | Status | Required reviewer | Effect if unresolved |
|---|---|---|---|
| source_revision_provenance | BLOCKED | data engineering owner | all 2225 proposed rows remain non-frozen |
| official_count_methodology | REQUIRES_REVIEW | CVEfixes maintainer or dataset methodologist | all 2225 rows retain dataset-methodology caveat |
| duplicate_conflict_review | BLOCKED | security dataset reviewer | conflicting groups remain quarantined; proposed cohort stays unchanged |
| repository_identity_coverage | REQUIRES_REVIEW | repository provenance reviewer | split is only provisionally leakage-safe |
| licence_and_legal_review | BLOCKED | qualified legal/licensing reviewer | none of the 2225 rows is represented as legally cleared |

Exact questions, evidence, neutral decision options, and empty reviewer fields
are in `phase_2_7_human_decisions.csv/json`. Automated checks do not constitute
human or legal approval.
