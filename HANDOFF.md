# FluxNode — Session Handoff: AI Copilot / Agent Layer

> **Date:** 2026-07-06 · **Branch:** `master` (local only — this repo has **no git remote**; nothing pushed)
> **HEAD:** `a3be0a2` · This handoff is for the next agent picking up the AI-copilot work.

## TL;DR

An **agent-native AI copilot layer** was added to the Rust backend (`src-tauri/src/`) on top of the
existing 43 Tauri commands. Core is **implemented, compiles, and is E2E-verified** via a local
Ollama model. Not yet done: in-app chat UI, in-process llama.cpp, bundled sidecar binaries,
`--mcp` runtime test, and richer media-gen UI exposure. Full design in
`docs/AI Copilot and Media Adapter Design.md`; sidecar/toolchain setup in
`docs/AI Copilot Binary Setup.md`.

## What was built (new modules under `src-tauri/src/`)

- **`action.rs`** — Action registry (single source of truth). Every capability is an `Action`
  (name + JSON-Schema `params` + `SideEffect` = ReadOnly / Mutating / LongJob). LLM tool schemas,
  MCP tools, and CLI subcommands all derive from it.
- **`actions/`** — **30 actions**: wrappers over the existing commands + 3 media actions
  (`generate_image` / `transcribe` / `synthesize`). Exposes Tauri commands `action_invoke`,
  `action_list`, and a process-global `registry()`.
- **`brain/`** — `Brain` trait + `run_agent()` tool-calling loop with **write-gating** (Mutating /
  LongJob tools do **not** run unless `allow_writes = true`; ReadOnly always runs).
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

Env vars to register the native sidecar backends (binaries not bundled yet):
`FLUXNODE_SD_BIN`+`FLUXNODE_SD_MODEL`, `FLUXNODE_WHISPER_BIN`+`FLUXNODE_WHISPER_MODEL`,
`FLUXNODE_PIPER_BIN`+`FLUXNODE_PIPER_VOICE` (each must point at an existing file).

## Verified vs NOT verified (be honest)

**Verified**
- `cargo check` passes — **default** and `--features llama`.
- **E2E `--agent`**: agent → `asset_probe` → real ffprobe → natural-language answer
  (returned h264 / 1280x720 / 50.1s on the test clip). Evidence: `bench/wave3/`.
- Ollama tool-calling against the registry schema (qwen3.5:4b emits correct tool calls).
- Codex-vs-Ollama codegen benchmark for the action wrappers: `bench/wave1a/` (`run.sh`, `LOG.md`).

**NOT verified / not done**
- `cargo test`, clippy, `npm` gates were **not** run this session.
- The full **GUI app** driving `agent_chat` end-to-end (only the headless `--agent` path was run).
- `--mcp` has **never been driven by a real MCP client** (compile-verified only; may need window
  suppression — `Builder::build()` may create the configured window in headless mode).
- Sidecar backends (whisper/piper/sd) — CLI flags are **assumptions cross-checked against docs**,
  not run against real binaries (binaries not present; only ffmpeg/ffprobe are bundled).
- In-process llama.cpp — stub only.

## Pending work (ranked — highest leverage first)

1. **In-app chat/voice UI panel** in `src/features/` that calls `agent_chat` and renders tool
   activity + answers. The brain is reachable but has no UI surface.
2. **Real-confirm flow for write tools** — today gating is deny-by-default (`allow_writes`);
   a proper UI confirm would let the agent propose then execute Mutating/LongJob actions.
3. **`--mcp` runtime test** with an MCP client + fix window suppression for headless mode.
4. **Media-gen UI exposure** — `generate_image`/`transcribe`/`synthesize` are registered but need
   UI + real backends; ComfyUI works if a server is running.
5. **Sidecar binaries** — bundle whisper/piper/sd into `src-tauri/binaries/` and verify flags per
   `docs/AI Copilot Binary Setup.md`; wire the whisper 16kHz ffmpeg pre-convert TODO.
6. **In-process llama.cpp** (`brain/llama.rs`) — only if single-binary embedding is needed; Ollama
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
- **No git remote** — all 9 commits are local on `master`.

## Commit trail (master, local)

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
