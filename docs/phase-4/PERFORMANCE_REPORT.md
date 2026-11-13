# Phase 4 Performance Report

Environment: Node.js v24.21.0, Windows x64, 16 logical CPUs, approximately 16 GB RAM. Raw result: `results/phase4/performance_results.json`.

| Files | Parse/index | Parser throughput | Graph build | Graph serialization | Heap delta |
| ---: | ---: | ---: | ---: | ---: | ---: |
| 50 | 16.758 ms | 2,984 files/s | 9.393 ms | 1.448 ms | 0.64 MB |
| 200 | 20.721 ms | 9,652 files/s | 18.286 ms | 2.280 ms | 2.60 MB |
| 1,000 | 52.629 ms | 19,001 files/s | 54.998 ms | 8.577 ms | 10.61 MB |

SQLite persistence for 200 files took 13.354 ms; retrieval took 0.470 ms; the 15-section report took 2.210 ms. Twenty local `/api/health` samples averaged 1.019 ms (0.305–11.611 ms). Ten repeated 200-file analyses produced a coarse +574,416-byte heap delta; this neither proves nor disproves a memory leak.

The rising throughput with fixture size is consistent with warm-up/amortized overhead and must not be read as scaling superiority. No managed PostgreSQL, network, queue, storage, sandbox, external AI, large-graph browser-frame or multi-user load benchmark was performed.
