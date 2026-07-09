# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

FluxNode is an AI-native video editing desktop application built with Tauri v2, combining timeline-oriented editing with node-based AI/VFX workflows. Documentation is primarily in Thai. The app is functional with a React frontend and Rust backend.

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

Vitest is configured and currently covers workflow node-definition invariants plus audio clip scheduling logic. The repo is not fully TDD across every feature, but test-backed changes are preferred for domain and store logic.

## Architecture

### Dual Runtime

The app runs in two modes detected at startup via `isTauriRuntime()`:

- **Tauri mode**: full desktop app with Rust backend for file I/O, system health, render jobs, asset watching, ComfyUI integration, and detached panels
- **Browser mode**: `LocalProjectRepository` uses localStorage fallback for frontend-only development

The persistence layer uses `createProjectRepository()` in `src/services/persistence/`.

### Frontend (React + Zustand)

Single Zustand store (`src/store/project-store.ts`) is the central state authority. It owns:

- full `FluxNodeProject` state (timeline, workflow, assets, output, audio)
- UI state (active view, selections, playback, modals)
- runtime caches (preview frames, waveforms, thumbnails) with memory-pressure-aware eviction
- undo/redo via the command pattern in `src/domain/history/`

All mutations go through `applyMutation()` which clones project state, applies the change, updates timestamps, runs validation, pushes to history, and appends to WAL.

### Key Frontend Directories

- `src/app/` - app root with lifecycle effects, view orchestration, and lazy loading
- `src/features/` - UI panels: header, preview, timeline, workflow, settings, onboarding, inspector, status, shortcuts, workspace sharing
- `src/store/` - Zustand store
- `src/domain/` - pure business logic: project types/defaults/validators, workflow node definitions/validation, history manager
- `src/services/ipc/` - Tauri command wrappers for asset probing, thumbnails, waveforms, render jobs, preview decode, proxying, app shell, ComfyUI, and more
- `src/services/persistence/` - project repository interface plus Tauri and localStorage implementations
- `src/services/shortcuts/` - keyboard shortcut definitions and config

### Backend (Rust / Tauri)

Main Rust backend lives in `src-tauri/src/lib.rs`. Key capabilities:

- project persistence: save/load/autosave with WAL crash recovery
- asset management: inspection, metadata probing, thumbnail generation, proxy generation, waveform peaks
- file watching: background polling every 3 seconds with emitted change events
- system health: CPU/RAM/disk/VRAM telemetry
- render job lifecycle: start/pause/resume/cancel/retry with status files
- multi-window support for detached preview/timeline/inspector panels
- optional local ComfyUI integration in `src-tauri/src/comfy.rs`

### AI Copilot / Agent Layer

> **Handoff:** see `HANDOFF.md` for current status (what's verified, pending work, gotchas) — last updated 2026-07-06. Core implemented + E2E-verified; UI panel, in-process llama.cpp, and sidecar binaries still pending.

An agent-native layer wraps every command behind one registry (see `docs/AI Copilot and Media Adapter Design.md`):

- `action.rs` — Action registry (SSOT): each capability is an `Action` (name + JSON-Schema params + `SideEffect`). The LLM tool schema, MCP tool list, and CLI all derive from it.
- `actions/` — 30 wrappers over existing commands + media actions (`generate_image`/`transcribe`/`synthesize`), plus `action_invoke` / `action_list` commands
- `brain/` — `Brain` trait + agent loop (`run_agent`, gates write/long tools unless `allow_writes`); `ollama.rs` backend (default, `qwen3.5:4b`), `llama.rs` in-process stub behind `--features llama`
- `media/` — pluggable media backends behind per-modality traits + a `GpuArbiter` that unloads the brain from VRAM during heavy media jobs; `MediaBroker` routes requests (sd.cpp fast path vs ComfyUI power path)
- `mcp.rs` — `rmcp` MCP server; `services.rs` — shared `brain()`/`gpu_arbiter()`/`media_broker()` singletons
- Command `agent_chat`; CLI modes `--mcp` and `--agent "<msg>"`

### Timeline <-> Workflow Sync

Bidirectional linking uses `clip.workflowNodeId` <-> `node.data.timelineClipId`. Timeline and workflow edits are kept in one shared project state.

### Node Graph

10 node types are defined in `src/domain/workflow/node-definitions.ts` with typed port definitions. Validation in `src/domain/workflow/validation.ts` enforces port compatibility, no self-connections, DAG constraints, required inputs, and execution ordering.

## Design System

- dark-first: background `#0d0d0d`, surface `#1c1c1e`
- accent neon: `#e0ff00`
- cloud blue: `#3b82f6`
- typography: Inter / Geist
- glassmorphism with `backdrop-blur`
- Tailwind CSS v4
- icons: lucide-react

## Spec Documents

- `MASTERPLAN.md` - detailed technical specification
- `STATUS.md` - living source of truth for what's implemented vs pending
- `phase-1-foundation-implementation-spec.md` - implementation priorities for the initial foundation slice
- `product-requirements-document.md` - PRD
- `software-requirements-specification.md` - SRS
- `fluxnode-design-guide.md` - visual identity guide

## Current Progress

- The repo is no longer design-only; it contains a functional React/Tauri app.
- Most `MASTERPLAN.md` feature slices are implemented and backed by repo evidence.
- The main remaining gap is Section 11 proof breadth across additional OS targets and hardware tiers.

## Conventions

- Linting: oxlint only (no eslint). Config in `.oxlintrc.json`
- TypeScript 6.x with strict mode
- Testing: Vitest is available via `npm test` / `npm run test:watch`
- Rust edition 2021
- Project files use the `.fluxnode/` directory format with `project.json` + `autosave/` + `thumbnails/` + `proxies/` + `cache/`
