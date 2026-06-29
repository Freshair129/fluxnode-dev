# AGENTS.md

This file provides guidance to Codex (Codex.ai/code) when working with code in this repository.

## Project Overview

FluxNode is an AI-native video editing desktop application built with Tauri v2, combining timeline-based editing with node-based AI/VFX workflows. Documentation is in Thai.

## Commands

```bash
npm run dev          # Vite dev server (frontend only, browser mode)
npm run build        # tsc -b && vite build
npm run lint         # oxlint (no eslint)
npm run tauri:dev    # Full Tauri dev (launches desktop window + Vite)
npm run tauri:build  # Production Tauri build
```

Rust backend builds automatically via `tauri:dev` / `tauri:build`. To build Rust independently: `cd src-tauri && cargo build`.

No test framework is configured yet.

## Architecture

### Dual Runtime

- **Tauri mode**: full desktop app with Rust backend for file I/O, system health, render jobs, asset watching
- **Browser mode**: `LocalProjectRepository` uses localStorage fallback for UI development without Rust

Detection: `isTauriRuntime()` checks `window.__TAURI_INTERNALS__`

### Frontend (React + Zustand)

- Single Zustand store (`src/store/project-store.ts`, ~3700 lines) — central state authority
- All mutations go through `applyMutation()` → clone, mutate, validate, push history, append WAL
- Undo/redo via command pattern (`src/domain/history/`)
- Memory-pressure-aware cache eviction for preview frames, waveforms, thumbnails

### Backend (Rust / Tauri)

- Single file: `src-tauri/src/lib.rs` (~1745 lines)
- Project persistence with WAL crash recovery
- Asset management: inspect, probe, thumbnail (SVG), proxy, waveform
- File watching: background thread polls every 3s
- System health: CPU/RAM/disk/VRAM telemetry
- Render job lifecycle with status files
- Multi-window: detachable panels via Tauri multi-window API

### Key Directories

- `src/domain/` — Pure business logic (types, defaults, validators, node definitions, history)
- `src/services/ipc/` — Tauri command wrappers (one file per IPC concern)
- `src/services/persistence/` — Repository pattern (Tauri vs localStorage)
- `src/features/` — UI panels (header, preview, timeline, workflow, settings, etc.)
- `src/store/` — Zustand store

## Conventions

- Linting: oxlint only (`.oxlintrc.json`)
- TypeScript 6.x strict mode
- Tailwind CSS v4
- Rust edition 2021
- Project files: `.fluxnode/` directory with `project.json` + `autosave/` + `thumbnails/` + `proxies/` + `cache/`
