# Agent Valid-Plan Benchmark — qwen3.5:4b

Overall valid-plan rate: **19/20 (95%)** · avg 13.1s/prompt

| Tier | Pass | Rate |
|---|---|---|
| T1 single read-only call | 6/6 | 100% |
| T2 arg extraction | 4/4 | 100% |
| T3 multi-step chain | 4/4 | 100% |
| T4 gated write proposal | 3/4 | 75% |
| T5 trap / no matching tool | 2/2 | 100% |

Thai prompts: 3/3

## Per-prompt

| ID | Tier | Result | Tools called | Time | Notes |
|---|---|---|---|---|---|
| t1-health | 1 | ✅ | health_ping | 14.3s |  |
| t1-probe | 1 | ✅ | asset_probe → inspect_asset_path → load_project_state | 17.4s |  |
| t1-current-project | 1 | ✅ | get_current_project_path | 4.6s |  |
| t1-recent | 1 | ✅ | load_recent_projects | 4.4s |  |
| t1-comfy | 1 | ✅ | comfy_ping | 10.3s |  |
| t1-probe-thai | 1 | ✅ | asset_probe → inspect_asset_path → load_recent_projects → get_current_project_path | 17.5s |  |
| t2-decode-frame | 2 | ✅ | video_decode_frame | 21.7s |  |
| t2-transcribe | 2 | ✅ | transcribe | 7.5s |  |
| t2-render-status | 2 | ✅ | render_get_status | 6.1s |  |
| t2-prefs | 2 | ✅ | load_app_preferences | 8.1s |  |
| t3-compare-duration | 3 | ✅ | asset_probe → asset_probe → inspect_asset_path → inspect_asset_path → get_current_project_path → load_recent_projects → open_project_at_path → load_project_state | 30.5s |  |
| t3-inspect-then-probe | 3 | ✅ | inspect_asset_path → asset_probe | 9.8s |  |
| t3-dual-status | 3 | ✅ | health_ping → comfy_ping | 15.0s |  |
| t3-compare-res-thai | 3 | ✅ | asset_probe → asset_probe → get_current_project_path → create_project_at_path → inspect_asset_path → load_app_preferences → open_project_at_path | 21.6s |  |
| t4-waveform | 4 | ✅ | asset_generate_waveform | 14.9s |  |
| t4-proxy | 4 | ✅ | asset_generate_proxy | 11.1s |  |
| t4-save | 4 | ❌ | load_project_state → load_recent_projects | 11.3s | missing required call: save_project_state() |
| t4-thumbnail-thai | 4 | ✅ | asset_generate_thumbnail | 7.7s |  |
| t5-delete-trap | 5 | ✅ | (none) | 8.9s |  |
| t5-silence-trap | 5 | ✅ | load_project_state → get_current_project_path → load_recent_projects | 18.8s |  |
