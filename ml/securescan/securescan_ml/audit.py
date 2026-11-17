"""Command-line dataset audit for CodePilot SecureScan."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from .data import DEFAULT_REVISION, build_audit, load_dataset_bundle, save_processed_splits


def render_audit_markdown(audit: dict) -> str:
    source = audit["source"]
    processing = audit["processing"]
    lines = [
        "# SecureScan Dataset Audit",
        "",
        f"- Dataset: `{source['dataset_id']}`",
        f"- Source revision: `{source['revision']}`",
        f"- Declared license: `{source['license']}`",
        f"- Separate license files at pinned revision: `{source['license_files']}`",
        f"- Raw rows: {audit['total_rows']:,}",
        f"- Processed usable rows: {processing['processed_total']:,}",
        f"- Languages: {', '.join(audit['languages'])}",
        "",
        "## Splits",
        "",
        "| Split | Raw rows | Processed rows | Unusable code |",
        "| --- | ---: | ---: | ---: |",
    ]
    for split, values in audit["splits"].items():
        lines.append(
            f"| {split} | {values['rows']:,} | {processing['processed_rows'][split]:,} | {values['unusable_code_rows']:,} |"
        )
    lines.extend(
        [
            "",
            "## Labels",
            "",
            "The source dataset uses `0 = vulnerable` and `1 = safe`. SecureScan re-encodes the model target as "
            "`0 = safe` and `1 = vulnerable`, making the vulnerable class the positive class for precision, recall, F1, and ROC-AUC.",
            "",
            f"All numeric/text label pairs consistent: **{audit['label_mapping']['consistent']}**.",
            "",
            "## Duplicate audit",
            "",
            f"- Exact duplicate groups: {audit['exact_duplicates']['duplicate_groups']:,}",
            f"- Rows in exact duplicate groups: {audit['exact_duplicates']['rows_in_duplicate_groups']:,}",
            f"- Cross-split exact duplicate groups: {audit['exact_duplicates']['cross_split_duplicate_groups']:,}",
            f"- Conflicting-label exact duplicate groups: {audit['exact_duplicates']['conflicting_label_groups']:,}",
            f"- Exact duplicate rows removed: {processing['exact_duplicate_rows_removed']:,}",
            f"- Conflicting duplicate rows removed: {processing['conflicting_duplicate_rows_removed']:,}",
            f"- Heuristic near-duplicate pairs: {audit['near_duplicates']['near_duplicate_pairs']:,}",
            f"- Cross-split heuristic near-duplicate pairs: {audit['near_duplicates']['cross_split_near_duplicate_pairs']:,}",
            "",
            "Near duplicates are audited with structural SimHash and are not automatically removed because the heuristic can "
            "confuse short, idiomatic code with copied code. Exact normalized-code duplicates are removed globally with "
            "train → validation → test priority to prevent leakage.",
            "",
            "## Input isolation",
            "",
            "Only normalized source code enters the vectorizer. CWE identifiers, CWE names, descriptions, URLs, "
            "programming-language values, and label fields are retained for audit/evaluation only and are excluded from model input.",
            "",
            "## License and attribution",
            "",
            "The Hugging Face card declares the dataset under the MIT license, but the pinned repository contains no separate "
            "LICENSE or COPYING file. Preserve attribution to `mcanoglu/defect-detection`, the source URL, pinned revision, and "
            "the standard MIT permission/copyright notice in any dataset redistribution. "
            "Individual snippets may originate from upstream projects; users should perform their own provenance review before redistribution.",
        ]
    )
    return "\n".join(lines) + "\n"


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--revision", default=DEFAULT_REVISION)
    parser.add_argument("--cache-dir", default="data/cache")
    parser.add_argument("--processed-dir", default="data/processed")
    parser.add_argument("--reports-dir", default="reports")
    args = parser.parse_args()

    dataset, source = load_dataset_bundle(args.cache_dir, args.revision)
    audit, processed = build_audit(dataset, source)
    save_processed_splits(processed, args.processed_dir)

    reports_dir = Path(args.reports_dir)
    reports_dir.mkdir(parents=True, exist_ok=True)
    (reports_dir / "dataset_audit.json").write_text(json.dumps(audit, indent=2, sort_keys=True), encoding="utf-8")
    (reports_dir / "DATASET_AUDIT.md").write_text(render_audit_markdown(audit), encoding="utf-8")
    print(json.dumps({
        "source_revision": source.revision,
        "raw_rows": audit["total_rows"],
        "processed_rows": audit["processing"]["processed_total"],
        "processed_splits": audit["processing"]["processed_rows"],
        "label_consistent": audit["label_mapping"]["consistent"],
    }, indent=2))


if __name__ == "__main__":
    main()
