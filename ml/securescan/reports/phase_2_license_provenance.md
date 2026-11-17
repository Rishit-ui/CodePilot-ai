# SecureScan Phase 2 License and Provenance Review

## CVEfixes

The [official CVEfixes README](https://github.com/secureIT-project/CVEfixes/blob/main/README.md) explicitly distinguishes:

- Collection software: MIT License.
- Dataset compilation: Creative Commons Attribution 4.0 International (CC BY 4.0).

The source revision inspected was `9283b50b3f04e3c5b0a17fc419ab0feea23fc438`; its `LICENSE.txt` is the MIT software license. The Zenodo record is DOI `10.5281/zenodo.13118970`, release v1.0.8.

CC BY 4.0 requires attribution, a license link, and indication of modifications. It does not imply that CVEfixes’ compilation license extinguishes copyrights or license obligations attached to code copied from thousands of upstream projects. Raw code must not be redistributed from SecureScan without an upstream-license review.

Required provenance manifest per retained sample:

- CVEfixes release and file checksum.
- `repository.repo_url` and normalized repository identity.
- Commit hash and commit URL.
- CVE and CWE identifiers.
- File path, `file_change_id`, method identifier/signature and before/after status.
- Upstream repository license at the sampled revision, evidence URL and retrieval date.
- Extraction transform version, normalized hash, clone-component ID and exclusion reason where applicable.

License metadata is not a documented CVEfixes table. Upstream licenses therefore require a separate bounded audit. Do not clone or query all 4,249 repositories automatically; begin with the projects selected for a pilot and cache license evidence.

## DiverseVul

The [authors’ repository](https://github.com/wagner-group/diversevul) contains only a README and does not publish a repository `LICENSE` file or dataset-specific terms. The RAID paper text is CC BY 4.0, but that license applies to the paper and cannot be assumed to license the separate Google Drive dataset.

The metadata contains repository and commit URLs but no upstream-license fields. The measured metadata also has one blank repository URL and fails to map 484 dataset project/commit keys exactly. Source repositories have heterogeneous licenses.

Consequences:

- Local research inspection is documented, but SecureScan must not redistribute the raw JSON or derived raw-code subsets.
- DiverseVul should not be used for distributable model artifacts or a production dataset pipeline until the authors clarify dataset licensing and unresolved provenance is excluded.
- A future manifest must record the same repository/commit/license evidence described for CVEfixes.

## NIST Juliet

[NIST SARD suite 112](https://samate.nist.gov/SARD/test-suites/112) states that Juliet C/C++ 1.3 is not subject to U.S. copyright and is offered under CC0 1.0 for any foreign rights NIST may claim. It can be redistributed under those terms with provenance and checksum retained.

Juliet remains synthetic and must be labeled as such. Its clean licensing does not make it representative of production prevalence.

## Provenance release gate

Before any training corpus is accepted:

1. 100% of test rows and at least 99% of training/validation rows must resolve to a canonical repository and immutable commit.
2. 100% of retained projects must have a recorded upstream license status; unknown or incompatible projects are excluded.
3. Raw code remains local and ignored by Git.
4. Reports may contain aggregate statistics and short necessary examples only; no bulk code redistribution.
5. Attribution, license links and transformation notices must accompany any permitted derived release.

This is an engineering provenance review, not legal advice.
