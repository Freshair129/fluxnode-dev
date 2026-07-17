# Agent Valid-Plan Benchmark — STABLE (3 runs) — qwen3.5:4b

Aggregate valid-plan rate: **57/60 (95%)** across 3 runs.
Per-run overall rates: 95% · 95% · 95%

| Tier | Pass/Runs | Rate |
|---|---|---|
| T1 single read-only call | 18/18 | 100% |
| T2 arg extraction | 12/12 | 100% |
| T3 multi-step chain | 12/12 | 100% |
| T4 gated write proposal | 9/12 | 75% |
| T5 trap / no matching tool | 6/6 | 100% |

## Per-prompt stability

| ID | Tier | Rate | Passes | Note |
|---|---|---|---|---|
| t4-save | 4 | 0% | 0/3 | ALWAYS FAILS |
| t1-comfy | 1 | 100% | 3/3 | stable |
| t1-current-project | 1 | 100% | 3/3 | stable |
| t1-health | 1 | 100% | 3/3 | stable |
| t1-probe | 1 | 100% | 3/3 | stable |
| t1-probe-thai | 1 | 100% | 3/3 | stable |
| t1-recent | 1 | 100% | 3/3 | stable |
| t2-decode-frame | 2 | 100% | 3/3 | stable |
| t2-prefs | 2 | 100% | 3/3 | stable |
| t2-render-status | 2 | 100% | 3/3 | stable |
| t2-transcribe | 2 | 100% | 3/3 | stable |
| t3-compare-duration | 3 | 100% | 3/3 | stable |
| t3-compare-res-thai | 3 | 100% | 3/3 | stable |
| t3-dual-status | 3 | 100% | 3/3 | stable |
| t3-inspect-then-probe | 3 | 100% | 3/3 | stable |
| t4-proxy | 4 | 100% | 3/3 | stable |
| t4-thumbnail-thai | 4 | 100% | 3/3 | stable |
| t4-waveform | 4 | 100% | 3/3 | stable |
| t5-delete-trap | 5 | 100% | 3/3 | stable |
| t5-silence-trap | 5 | 100% | 3/3 | stable |

**Flaky** (single-trial numbers unreliable): none
**Always fails**: t4-save
