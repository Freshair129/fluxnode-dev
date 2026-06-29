# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

FluxNode is an AI-native video editing desktop application built with Tauri v2, combining timeline-based editing with node-based AI/VFX workflows. Documentation is in Thai. The app is functional with a React frontend and Rust backend — no longer design-only.

## Commands

```bash
npm run dev          # Vite dev server (frontend only, browser mode)
npm run build        # tsc -b && vite build
npm run lint         # oxlint (no eslint)
npm run tauri:dev    # Full Tauri dev (launches desktop window + Vite)
npm run tauri:build  # Production Tauri build
```

Rust backend builds automatically via `tauri:dev` / `tauri:build`. To build Rust independently: `cd src-tauri && cargo build`.

No test framework is configured yet — there are no test commands or test files.

## Architecture

### Dual Runtime

The app runs in two modes detected at startup via `isTauriRuntime()` (checks `window.__TAURI_INTERNALS__`):
- **Tauri mode**: full desktop app with Rust backend for file I/O, system health, render jobs, asset watching
- **Browser mode**: `LocalProjectRepository` uses localStorage fallback — useful for UI development without Rust

The persistence layer uses a strategy pattern (`createProjectRepository()` in `src/services/persistence/`) that returns the appropriate implementation.

### Frontend (React + Zustand)

Single Zustand store (`src/store/project-store.ts`, ~3700 lines) is the central state authority. It owns:
- Full `FluxNodeProject` state (timeline, workflow, assets, output, audio)
- UI state (active view, selections, playback, modals)
- Runtime caches (preview frames, waveforms, thumbnails) with memory-pressure-aware eviction
- Undo/redo via command pattern (`src/domain/history/`)

All mutations go through `applyMutation()` which: clones project state, applies the change, updates timestamps, runs validation, pushes to history, and appends to WAL.

### Key Frontend Directories

- `src/app/` — App root with view routing and lifecycle effects
- `src/features/` — UI panels: header, preview, timeline, workflow, settings, onboarding, inspector, status, shortcuts
- `src/store/` — Zustand store (single file, project-store.ts)
- `src/domain/` — Pure business logic: project types/defaults/validators, workflow node definitions/validation, history manager
- `src/services/ipc/` — Tauri command wrappers (each file wraps one IPC concern: asset-probe, thumbnail, waveform, render-job, export-job, video-preview, proxy, file-dialog, etc.)
- `src/services/persistence/` — Project repository interface + Tauri and localStorage implementations
- `src/services/shortcuts/` — Keyboard shortcut definitions and config

### Backend (Rust / Tauri)

Single-file Rust backend at `src-tauri/src/lib.rs` (~1745 lines). All Tauri commands are registered in the `run()` function. Key capabilities:
- Project persistence: save/load/autosave with WAL (write-ahead log) crash recovery
- Asset management: file inspection, probe (metadata extraction by extension heuristic), thumbnail generation (SVG placeholders), proxy generation, waveform peaks
- File watching: background thread polls asset paths every 3s, emits change events
- System health: CPU/RAM/disk/VRAM telemetry (Windows VRAM via PowerShell `Get-CimInstance`/`Get-Counter`)
- Render job lifecycle: start/pause/resume/cancel/retry with status files
- Multi-window: detachable preview/timeline/inspector panels via Tauri's multi-window API

Dependencies: `tauri 2.1`, `serde/serde_json`, `rfd` (native file dialogs), `sysinfo`

### Timeline ↔ Workflow Sync

Bidirectional linking via `clip.workflowNodeId` ↔ `node.data.timelineClipId`. Adding media to timeline auto-creates a `media_source` node. Deletions prompt whether to remove the linked counterpart.

### Node Graph

10 node types defined in `src/domain/workflow/node-definitions.ts` with typed port definitions. Validation in `src/domain/workflow/validation.ts` enforces: port type compatibility, no self-connections, DAG constraint (cycle detection), single-connection on non-multiple ports. Topological sort determines execution order.

## Design System

- Dark-first: background `#0d0d0d`, surface `#1c1c1e`
- Accent neon: `#e0ff00` (active states)
- Cloud blue: `#3b82f6`
- Typography: Inter / Geist
- Glassmorphism with `backdrop-blur`
- Tailwind CSS v4 (via `@tailwindcss/vite`)
- Icons: lucide-react

## Spec Documents

- `MASTERPLAN.md` — detailed technical specification: data model schemas, IPC contracts, undo/redo, audio system, export formats, error handling, keyboard shortcuts, performance targets (Thai)
- `Phase 1 Foundation Implementation Spec.md` — implementation priorities for MVP slice
- `Product Requirements Document.md` — PRD (Thai)
- `Software Requirements Specification.md` — SRS (Thai)
- `FluxNode Design Guide.md` — visual identity guide

## Conventions

- Linting: oxlint only (no eslint). Config in `.oxlintrc.json` — enforces React hooks rules
- TypeScript 6.x with strict mode
- No testing framework yet
- Rust edition 2021
- Project files use `.fluxnode/` directory format with `project.json` + `autosave/` + `thumbnails/` + `proxies/` + `cache/`
