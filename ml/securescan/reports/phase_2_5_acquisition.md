# SecureScan Phase 2.5 Acquisition

## Result

**PASS.** CVEfixes v1.0.8 was downloaded only from the official Zenodo record,
assembled on D:, and verified before extraction. No dataset file was placed in
the repository or OneDrive.

## Provenance and checksums

| Field | Verified value |
|---|---|
| Official record | `https://zenodo.org/records/13118970` |
| Official object | `https://zenodo.org/records/13118970/files/CVEfixes_v1.0.8.zip?download=1` |
| Zenodo record | `13118970` |
| Release | `CVEfixes v1.0.8` |
| Download completed (UTC) | `2026-11-17T09:16:50Z` |
| Archive path | `D:\CodePilotData\CVEfixes\downloads\CVEfixes_v1.0.8.zip` |
| Archive bytes | `12,708,711,268` |
| Official MD5 | `4586a358977acfa4c60b1a2cdd096221` |
| Measured MD5 | `4586a358977acfa4c60b1a2cdd096221` |
| Measured SHA-256 | `6acd55aaeb7ffcfc20fdcebf7df88d206f9892ef64b0f2a2e06864d5b44b3a83` |

The resumable acquisition used 95 non-overlapping 128 MiB HTTP range chunks
(the final chunk was 92,244,836 bytes), eight workers initially and then four
main workers plus at most two non-overlapping tail workers after a Zenodo HTTP
503 cooldown, with exact per-range length checks. Completed chunks
were never overwritten. The assembly order was `chunk_000.bin` through
`chunk_094.bin`. The effective request pattern was:

```powershell
curl.exe --location --fail --range <start>-<end> --retry 8 `
  --retry-all-errors --retry-delay 30 --output <D:-chunk> `
  'https://zenodo.org/records/13118970/files/CVEfixes_v1.0.8.zip?download=1'
```

## Safe archive inspection

- ZIP64 entries: **15**.
- Path-traversal or absolute-path entries: **0**.
- Sum of member compressed sizes: **12,708,708,174 bytes**.
- Sum of member uncompressed sizes: **12,776,181,655 bytes**.
- Required dump member: `CVEfixes_v1.0.8/Data/CVEfixes_v1.0.8.sql.gz`.
- Dump member size: **12,660,640,828 bytes**.
- Supporting files extracted: `INSTALL.md`, `README.md`,
  `Doc/DataDictionary.md`, and `LICENSE.txt`.
- The collection log, NVD archive, paper, image, notebook, and CWE XML were not
  extracted because restoration and aggregate validation did not require them.

## Storage gate

| Checkpoint | D: free |
|---|---:|
| Initial measured free | 241,935,560,704 bytes (225.32 GiB) |
| Before final assembly | 225,937,268,736 bytes (210.42 GiB) |
| After assembly | 213,223,862,272 bytes (198.58 GiB) |
| Before extraction | 213,223,862,272 bytes (198.58 GiB) |
| After extraction | approximately 200.56 billion bytes (186.79 GiB) |
| Final measured free | 148,855,459,840 bytes (138.63 GiB) |
| Net free-space change | 93,080,100,864 bytes (86.69 GiB) |

The 85 GiB floor was maintained. Download chunks and interrupted fragments are
retained on D: for recovery; they were not deleted.
