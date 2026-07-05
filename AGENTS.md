# AGENTS.md

This file provides guidance to Codex (Codex.ai/code) when working with code in this repository.

## Project Overview

FluxNode is an AI-native video editing desktop application built with Tauri v2, combining timeline-oriented editing with node-based AI/VFX workflows. Documentation is primarily in Thai.

## Commands

```bash
npm run dev          # Vite dev server (frontend only, browser mode)
npm run build        # tsc -b && vite build
npm run lint         # oxlint (no eslint)
npm test             # vitest run
npm run test:watch   # vitest watch mode
npm run tauri:dev    # Full Tauri dev (launches desktop window + Vite)
npm run tauri:build  # Production Tauri build
```

Rust backend builds automatically via `tauri:dev` / `tauri:build`. To build Rust independently: `cd src-tauri && cargo build`.

Vitest is configured. Current automated tests cover workflow node-definition invariants and audio clip scheduling. The repo is not fully TDD end-to-end yet, but domain and state changes should prefer test-backed updates when practical.

## Architecture

### Dual Runtime

- **Tauri mode**: full desktop app with Rust backend for file I/O, system health, render jobs, asset watching, desktop shell integration, and detached windows
- **Browser mode**: `LocalProjectRepository` uses localStorage fallback for UI development without Rust

Detection: `isTauriRuntime()` checks `window.__TAURI_INTERNALS__`

### Frontend (React + Zustand)

- Single Zustand store (`src/store/project-store.ts`) is the central state authority
- All mutations go through `applyMutation()` -> clone, mutate, validate, push history, append WAL
- Undo/redo uses the command pattern under `src/domain/history/`
- Memory-pressure-aware cache eviction exists for preview frames, node previews, waveforms, and thumbnails
- `src/app/App.tsx` lazy-loads major panels and modals
- Workflow editing is implemented as custom React UI, not React Flow

### Backend (Rust / Tauri)

- Main backend lives in `src-tauri/src/lib.rs`
- Project persistence with WAL crash recovery
- Asset management: inspect, probe, thumbnail (SVG placeholder path), proxy, waveform
- File watching: background thread polls every 3s
- System health: CPU/RAM/disk/VRAM telemetry
- Render job lifecycle with status files
- Optional local ComfyUI integration is implemented via `src/services/ipc/comfy.ts` and `src-tauri/src/comfy.rs`

### AI Copilot / Agent Layer (`src-tauri/src/`)

An agent-native layer sits on top of the commands above (see `docs/AI Copilot and Media Adapter Design.md`):

- `action.rs` — Action registry (single source of truth); every capability is an `Action` with a JSON-Schema `params` and a `SideEffect` (ReadOnly / Mutating / LongJob)
- `actions/` — 30 wrappers over the existing commands + media actions (`generate_image`/`transcribe`/`synthesize`); exposes `action_invoke` / `action_list` Tauri commands
- `brain/` — `Brain` trait + agent loop (`run_agent`) with write-tool gating; `ollama.rs` backend (runtime-verified). `llama.rs` is an in-process stub behind `--features llama`
- `media/` — media adapter: `types`/`traits`/`gpu` (GPU arbiter that evicts the brain for heavy jobs) + `backends/` (comfy, sdcpp, whisper, piper); routed by `MediaBroker`
- `mcp.rs` — `rmcp` MCP server exposing the registry over stdio
- `services.rs` — shared `brain()` / `gpu_arbiter()` / `media_broker()` singletons
- Commands: `agent_chat`. CLI modes in `run()`: `--mcp` (MCP server), `--agent "<msg>"` (headless agent)

### Key Directories

- `src/domain/` - pure business logic (types, defaults, validators, node definitions, history)
- `src/services/ipc/` - Tauri command wrappers (one file per IPC concern)
- `src/services/persistence/` - repository pattern (Tauri vs localStorage)
- `src/features/` - UI panels (header, preview, timeline, workflow, settings, onboarding, inspector, status, shortcuts, workspace)
- `src/store/` - Zustand store

## Current Progress

- Core feature slices from `MASTERPLAN.md` are implemented across timeline editing, workflow editing, audio, export, resilience, shortcuts, onboarding, workspace sharing, and timeline-workflow sync.
- The main remaining repo-level gap is Section 11 proof breadth across more OS targets and hardware tiers, not missing product features.

## Conventions

- Linting: oxlint only (`.oxlintrc.json`)
- TypeScript 6.x strict mode
- Tailwind CSS v4
- Rust edition 2021
- Project files: `.fluxnode/` directory with `project.json` + `autosave/` + `thumbnails/` + `proxies/` + `cache/`
