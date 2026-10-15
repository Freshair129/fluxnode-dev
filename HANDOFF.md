# FluxNode — Session Handoff: AI Copilot / Agent Layer

> **Written:** 2026-07-06 · **Last reconciled against the code:** 2026-10-15
> **Branch:** `codex/readiness-fixes-20261015` · **Base HEAD:** `ffa9071b0558bda10e676366f3af1475eba2af31`
> This handoff is for the next agent picking up the AI-copilot work.

## Current readiness reconciliation (2026-10-15)

This worktree contains the fixes below; no commit, PR, or release has been produced. Frontend
checks, Rust tests, format and clippy, a normal-resource Windows debug build, native MCP acceptance,
and a bounded native desktop/FFmpeg fixture run have passed. The detailed evidence is in issue #16,
`docs/standalone-acceptance.md`, and
`G:\AI-Studio\verification\2026-10-15-readiness-fixes\fluxnode`.

- Final native MCP and desktop checks used acceptance executable SHA-256
  `7b70b866fd66d9446ec40ea8d815a9df804f6ee2863e0490ace15518c7ad736e`. MCP passed 8 checks and
  desktop/export passed 11. Full receipts, logs, cleanup, and source/artifact provenance are under
  `G:\AI-Studio\verification\2026-10-15-readiness-fixes\fluxnode\native-clippyfix-20261015`.
  MCP initialize, tool listing, read-only health, default write denial, direct frontend-action
  unavailability, and `--allow-writes` preference/project writes passed. It listed 30 backend
  tools and no frontend timeline tools. Window inspection found no app window and one small
  16x16 Tao event helper window.
- An AI Generate ComfyUI response carries the Comfy prompt ID and source filename. The desktop
  materialize action validates and saves its PNG, then records a project asset, timeline clip,
  and media-source node. Deduplication is per (workflow node, Comfy prompt ID), so a repeated
  click stays idempotent and a later generation can also be added. Native UI acceptance used a
  deterministic local HTTP fixture: two distinct results were added, repeat-add was disabled,
  saved PNG bytes/filenames and lineage survived app reload and project reopen, and the reopened
  timeline rendered through production FFmpeg. The decoded pixel at 0.5s was RGB [251,1,0].
  This proves the local integration path, not ComfyUI inference.
- The GPU arbiter starts without a managed model, so media-only use does not require the optional
  Ollama daemon. Successful agent inference registers the selected Ollama model while holding a
  light lease. Model identities are scoped by endpoint and normalized model tag. Heavy leases
  unload only registered models observed resident in /api/ps, require acknowledgement and
  disappearance, and restore only models FluxNode evicted; a failed handoff aborts the job and
  releases the gate. Deterministic fixture/unit tests cover identity and failure paths. No live
  Ollama request or GPU handoff ran because the GPU remained reserved. CPU FFmpeg paths do not
  request the GPU lease; NVENC plans do. Remote ComfyUI endpoints do not take this machine's lease.
- The final native acceptance executable was built with normal Windows Tauri resource mapping,
  after scripts/fetch-whisper.ps1 staged checksum-verified pinned whisper.cpp v1.8.6 files and
  ggml-base.en.bin. whisper-cli --help passed. No Whisper inference was run, and no MSI/NSIS
  installer or signed release was built. This is a debug acceptance build, not package proof.
- Lalin, ACE-Step, Blender, and a cross-app workflow controller are deferred until FluxNode's
  standalone MCP, project persistence, media export, and runtime packaging acceptance is complete.

### Current validation evidence (2026-10-15)

- Frontend lint, typecheck, all 355 Vitest tests, and Vite build passed. The final build log is
  `G:\AI-Studio\verification\2026-10-15-readiness-fixes\fluxnode\npm-build-final-20261015.log`;
  the other frontend logs are in the same verification folder.
- `cargo fmt --check` passed (empty output, explicit exit code 0 in
  `cargo-fmt-check-final-20261015.json`). `cargo clippy --all-targets -- -D warnings` passed with
  normal Windows resources in `cargo-clippy-final-normal-resources-20261015.log`. Rust tests
  passed 99, failed 0, with one Whisper-inference test filtered under the GPU hold; see
  `cargo-test-final-no-whisper-inference-20261015.log`.
- The exact-base GitHub CI run was green while Clippy failed with 23 test-target and 21 library
  diagnostics because the step used `continue-on-error`. The backlog was fixed locally and that
  step is now mandatory in `.github/workflows/ci.yml`. No post-change remote CI run exists because
  this worktree has not been pushed. Exact-base evidence:
  `ci-clippy-base-failure.log` and
  [the Rust job log](https://github.com/Freshair129/fluxnode-dev/actions/runs/32285402094/job/96173616764).
- Final native receipts are
  `native-clippyfix-20261015/mcp/receipt.json` and
  `native-clippyfix-20261015/desktop/receipt.json`. The latter verifies two distinct synthetic
  generated PNG results, same-result idempotency, persistence/reopen, production FFmpeg export,
  ffprobe metadata, and a decoded red fixture pixel.
- The earlier broad visible-window check was a harness false positive: both the pre-change and
  final executable show the same small Tao helper and no application window.

### Remaining acceptance gates

- After the GPU reservation ends, test only FluxNode-owned Ollama models and one real Comfy GPU
  handoff; do not unload unrelated Ollama models.
- Run live ComfyUI generation and Whisper inference when the service/device is available. The
  passed desktop flow used a deterministic local fixture; Whisper only passed checksum staging
  and --help.
- Run the mandatory Clippy step on remote Linux CI after publishing the changes. The local
  Windows Clippy pass does not establish Linux dependency/build success.
- Build and inspect MSI/NSIS packages and release signing when release validation is authorized.
  The local debug app used normal Windows resource mapping but is not an installer.
- Keep Lalin, ACE-Step, Blender, and cross-app controller integration deferred until these
  standalone gates are resolved.


> **Repo status correction (2026-08-19):** the original header said this repo has *no git
> remote* and that nothing was pushed. That is no longer true — there is a GitHub remote and
> work now lands through PRs (12 merged as of `74866a1`, e.g. `#12 perf/workflow-dock-rerender`).
> The "9 local commits" trail at the bottom of this file is the original AI-copilot series only.

## Historical TL;DR snapshot (2026-08-19; superseded by the readiness reconciliation above)

> **Whisper update (2026-07-19):** Windows x64 whisper.cpp is now staged with
> `scripts/fetch-whisper.ps1`, checksum-verified, and bundled with its required DLLs/model as
> Tauri resources. The Windows NSIS/MSI package contents were inspected; updater signing remains
> pending `TAURI_SIGNING_PRIVATE_KEY`. See `docs/whisper-sidecar-installation-spec.md`. Older
> sidecar wording in this handoff predates this update; it still applies to Piper and
> stable-diffusion.cpp.

An **agent-native AI copilot layer** was added to the Rust backend (`src-tauri/src/`) on top of the
existing Tauri commands (43 when this was written; **48** as of `74866a1`). Core is
**implemented, compiles, and is E2E-verified** via a local Ollama model.

Still not done as of 2026-08-19: **backend-proposal approval** (the copilot panel now exists and
can approve timeline edits, but not Mutating/LongJob actions — see "Pending work" #2),
in-process llama.cpp, Piper/sd.cpp binaries, `--mcp` runtime test, and media-gen UI exposure.
Full design in `docs/AI Copilot and Media Adapter Design.md`; sidecar/toolchain setup in
`docs/AI Copilot Binary Setup.md`; approve-gate scope in
`docs/copilot-approve-gate-and-timeline-edits-scope.md`.

## What was built (new modules under `src-tauri/src/`)

- **`action.rs`** — Action registry (single source of truth). Every capability is an `Action`
  (name + JSON-Schema `params` + `SideEffect` = ReadOnly / Mutating / LongJob / **FrontendEdit**).
  LLM tool schemas, MCP tools, and CLI subcommands all derive from it. `Registry::invoke` also
  does light required-param / JSON-type validation before any I/O.
- **`actions/`** — **36 actions** (was 30 when this was written): 27 wrappers over the 48
  commands + 3 media actions (`generate_image` / `transcribe` / `synthesize`) + **6
  `FrontendEdit` timeline ops** (`timeline_remove_range` / `_split_clip` / `_trim_clip` /
  `_move_clip` / `_add_clip` / `_set_clip_property`), whose `run()` deliberately errors — they
  are materialized by the frontend store after approval. By side effect: 11 ReadOnly,
  14 Mutating, 5 LongJob, 6 FrontendEdit. Exposes Tauri commands `action_invoke`, `action_list`,
  and a process-global `registry()`. The other 21 commands still have no wrapper, notably
  `workflow_render_node` and `render_retry`.
- **`brain/`** — `Brain` trait + `run_agent()` tool-calling loop with **write-gating** (Mutating /
  LongJob tools do **not** run unless `allow_writes = true`; ReadOnly always runs). Since the
  approve-gate landed, a gated call no longer hard-fails: `Registry::invoke` returns a
  `__fluxnode_proposal__` value, the loop collects it into `AgentOutcome.proposals`, and the
  model is told it is queued for approval.
  - `ollama.rs` — default backend, talks to local Ollama `/api/chat`, also `impl BrainVram`.
  - `llama.rs` — in-process llama.cpp **stub** behind `--features llama` (not implemented — see gotchas).
- **`media/`** — media adapter: `types` / `traits` (per-modality) / `gpu.rs` (`GpuArbiter` that
  evicts the brain from VRAM for heavy jobs) / `mod.rs` (`MediaBroker` routing) + `backends/`
  (comfy, sdcpp, whisper, piper).
- **`mcp.rs`** — `rmcp` MCP server exposing the registry over stdio.
- **`services.rs`** — shared singletons: `brain()`, `gpu_arbiter()` (wired to the brain's
  `BrainVram`), `media_broker()` (ComfyUI always registered; sd/whisper/piper opt-in via env vars).

## How to run / test it

```sh
# In-app: the frontend calls the `agent_chat` command; or headless from the CLI:
cargo run -- --agent "Probe the media file at D:/dota/clip.mp4 and tell me its codec."
cargo run -- --agent "<msg>" --allow-writes     # allow Mutating/LongJob tools
cargo run -- --mcp                              # serve the registry over stdio (MCP)

# Default brain model = qwen3.5:4b via local Ollama (must be running).
```

Env vars to register the native sidecar backends (each must point at an existing file):
`FLUXNODE_SD_BIN`+`FLUXNODE_SD_MODEL`, `FLUXNODE_PIPER_BIN`+`FLUXNODE_PIPER_VOICE`.
Whisper no longer needs env vars — `services::bundled_whisper` auto-registers it from
`binaries/whisper/` (dev) or the app's `whisper/` resource dir; `FLUXNODE_WHISPER_BIN`+
`FLUXNODE_WHISPER_MODEL` still override each path individually.

## Historical verification snapshot (2026-08-19; superseded by the readiness reconciliation above)

**Verified**
- `cargo check` passes — **default** and `--features llama`.
- **E2E `--agent`**: agent → `asset_probe` → real ffprobe → natural-language answer
  (returned h264 / 1280x720 / 50.1s on the test clip). Evidence: `bench/wave3/`.
- Ollama tool-calling against the registry schema (qwen3.5:4b emits correct tool calls).
- Codex-vs-Ollama codegen benchmark for the action wrappers: `bench/wave1a/` (`run.sh`, `LOG.md`).

**NOT verified / not done** (reconciled 2026-08-19)
- `cargo test`, clippy, `npm` gates were not run in the original session. CI now runs them, but
  `cargo clippy` and `npm run format:check` are still `continue-on-error`, and the Playwright
  e2e suite is not wired into CI at all.
- The full **GUI app** driving `agent_chat` end-to-end (only the headless `--agent` path was run).
- `--mcp` has **never been driven by a real MCP client** (compile-verified only). Window
  suppression is still unresolved: `run_mcp` calls `Builder::default().build(generate_context!())`
  and `tauri.conf.json` still declares a 1440x920 `main` window.
- Piper / sd.cpp CLI flags are **assumptions cross-checked against docs**, not run against real
  binaries. Whisper is now bundled on Windows x64 but has not been exercised end-to-end.
- In-process llama.cpp — stub only.
- **New (not previously listed):** GPU arbitration covers the media path only. `spawn_ffmpeg_render`,
  `transcode_proxy`, `decode_preview_frame`, and `workflow_render_node` all spawn ffmpeg without
  taking a `GpuLease`, so a render never evicts the brain and can contend for VRAM with a
  diffusion job.
- **New:** `asset_generate_waveform`, `asset_generate_proxy`, `video_decode_frame`/`video_seek`,
  and the `transcribe` media action do **not** call `security::ensure_allowed_path` on their
  caller-supplied path, unlike `inspect_asset_path` / `asset_probe` / `asset_copy_into_project`.
  Two of those are `ReadOnly`, so they run ungated on every surface — including unauthenticated
  MCP stdio.

## Historical pending work snapshot (2026-08-19; recheck against current status above)

1. ~~**In-app chat/voice UI panel**~~ — **DONE (partial).** `src/features/copilot/CopilotPanel.tsx`
   calls `agent_chat`, shows proposals as a ghost preview, and approves timeline edits as one
   undo step. Remaining: no streaming, no tool-activity trace, no conversation history, no
   cancel (a hung Ollama blocks for up to 180s behind a "Thinking…" label), no reachability
   check, and it is reachable only from a floating button — not the command palette, the
   shortcut registry, or the header menus.
2. ~~**Backend-proposal executor**~~ — **DONE.** Approving a `site: 'backend'` proposal now
   re-invokes the registry with `allow_writes = true` (approve-gate step A5). New pieces:
   `services/ipc/action-invoke.ts` (`invokeAction`), `domain/copilot/proposals.ts`
   (`partitionProposals`, `ProposalOutcome`), store `approveCopilotProposals` /
   `copilotOutcomes` / `resetCopilotSession`, and `features/copilot/ProposalReview.tsx` (pure,
   props-driven so it is testable under SSR — same split as JobChip / JobLedger).
   Approval is **per action** for backend proposals and per batch for timeline edits; there is
   no session-wide writes toggle, and backend execution is kept out of undo history on purpose.
   Covered by `project-store.copilot.test.ts` (15 tests), `ProposalReview.test.tsx` (6), and
   `domain/copilot/proposals.test.ts` (4).
3. **Reconcile the timeline<->workflow link in `applyCopilotProposals`** — the shared ops take
   `Track[]` and cannot clear a vanished clip's `node.data.timelineClipId`, so an agent-approved
   removal breaks an invariant the mouse path maintains.
4. **`--mcp` runtime test** with an MCP client + fix window suppression for headless mode. Also
   fix the proposal semantics: a gated call currently returns `CallToolResult::success` carrying
   a proposal an MCP client has no way to approve.
5. **Media-gen UI exposure + artifact registration** — `generate_image`/`synthesize` are
   registered but have no UI entry point, and their outputs land in the OS temp dir and are
   never registered as project assets, so nothing can reach the timeline. `transcribe` is the
   one complete lane (it feeds `planSilenceCuts` -> proposals). ComfyUI works if a server is
   running.
6. **Sidecar binaries** — whisper (Windows x64) is bundled; wire `scripts/fetch-whisper.ps1` into
   CI/release so tagged builds can satisfy the declared `bundle.resources`, and make those
   Windows-only entries platform-conditional so the macOS/Linux legs can build. Piper and sd.cpp
   still need bundling and real flag verification per `docs/AI Copilot Binary Setup.md`. (The
   whisper 16kHz ffmpeg pre-convert TODO is now implemented in `media/backends/whisper.rs`.)
7. **In-process llama.cpp** (`brain/llama.rs`) — only if single-binary embedding is needed; Ollama
   already runs llama.cpp out-of-process and works.

## Gotchas / landmines

- **`llama-cpp-2` won't build here:** missing **cmake** and **libclang** (bindgen). MSVC `cl.exe`
  IS present (VS 2022 Build Tools), so that's not the blocker. Install CMake + LLVM (set
  `LIBCLANG_PATH`) — details in `docs/AI Copilot Binary Setup.md`.
- **Sync-first design:** actions/brain/media are synchronous + thread + status-file (matching the
  existing render pipeline). Only `mcp.rs` is async (tokio) — it calls the sync registry via
  `spawn_blocking`. Keep new backends sync.
- **Windows spawns must set `CREATE_NO_WINDOW` (0x08000000)** — the sidecar backends have a local
  `no_window()` helper; reuse it for any new `Command`.
- **Doc commit `df498d3` bundled pre-existing uncommitted doc WIP** (e.g. the README rewrite) that
  couldn't be separated from the AI-copilot additions. `bench/wave1a/PROMPT2.md` +
  `gen_actions.raw` are still **untracked**.
- ~~**No git remote** — all 9 commits are local on `master`.~~ **Superseded:** a GitHub remote
  exists and work lands via PRs (see the correction at the top of this file).

## Commit trail — the original AI-copilot series

> Point-in-time record of the 9 commits this handoff was written about. `master` has moved on
> well past `a3be0a2`; use `git log` for current history.

```
a3be0a2 docs: §13 AI Copilot in MASTERPLAN remaining-work HTML reports
df498d3 docs: AI copilot layer across 8 docs (bundles pre-existing doc WIP)
1408e86 feat: wire MediaBroker into command layer (generate_image/transcribe/synthesize)
250820b feat: safety gate + brain/arbiter wiring + headless --agent + llama stub
c7217bb feat: Wave 3 brain — Brain trait + agent loop + Ollama backend
e5f9fbb feat: make registry live + --mcp launcher; document sidecar binary setup
33fad1f feat: wire MCP server + expand Action registry to 27 commands
e80999e feat: AI copilot + media engine adapter scaffolding (Wave 0/1)
```

## Reference

- Design: `docs/AI Copilot and Media Adapter Design.md`
- Binary/toolchain setup: `docs/AI Copilot Binary Setup.md`
- MASTERPLAN §13 + `masterplan-completion-audit.md` (Section 13, Partial)
- Benchmarks/evidence: `bench/wave1a/`, `bench/wave3/`
