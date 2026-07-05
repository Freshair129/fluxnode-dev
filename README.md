# FluxNode

FluxNode is a Tauri v2 desktop video editor that combines a timeline-oriented editing surface with a node-based AI/VFX workflow. The current repository is a functional app shell with real state management, persistence, validation, render orchestration, performance guardrails, and proof tooling.

## Current Status

- Core feature slices from `MASTERPLAN.md` are implemented across timeline editing, workflow graph editing, audio, export, error handling, keyboard shortcuts, onboarding, workspace sharing, and timeline-workflow sync.
- The main remaining repo-level gap is Section 11 proof breadth across additional OS targets and hardware tiers.
- Current validation baseline:
  - `npm run build`
  - `npm run lint`
  - `npm test`

## Run

```bash
npm run dev         # Browser mode with localStorage-backed persistence
npm run tauri:dev   # Full desktop app with the Rust/Tauri backend
npm run build       # Production frontend build
npm run preview     # Preview the built frontend
npm run tauri:build # Desktop production build
```

## Testing

Vitest is configured in this repo.

```bash
npm test
npm run test:watch
```

Current automated coverage is still targeted rather than exhaustive. The existing suite covers workflow node-definition invariants and audio clip scheduling logic. The repo is not yet a full TDD codebase, but the preferred direction is to add or update tests alongside domain and state changes.

## Architecture

### Dual runtime

- Tauri mode: full desktop runtime with Rust commands for file I/O, runtime health, render jobs, asset watching, and desktop-only integrations
- Browser mode: frontend-only development path using `LocalProjectRepository` and browser-safe fallbacks

Runtime selection happens in `src/services/persistence/create-project-repository.ts` via `isTauriRuntime()`.

### Frontend

- React 19 + TypeScript 6 + Tailwind CSS v4
- Zustand single-store architecture in `src/store/project-store.ts`
- Lazy-loaded workspace panels in `src/app/App.tsx`
- Feature surfaces under `src/features/` for header, preview, timeline, workflow, status, settings, onboarding, inspector, and workspace sharing

### Backend

- Rust/Tauri backend in `src-tauri/src/lib.rs`
- Asset inspection, thumbnail/proxy/waveform generation, render job lifecycle, system telemetry, detached windows, and project persistence
- Optional local ComfyUI integration through desktop-only commands in `src/services/ipc/comfy.ts` and `src-tauri/src/comfy.rs`

### AI Copilot (agent layer)

FluxNode is agent-native: a single **Action registry** (`src-tauri/src/action.rs`) exposes every capability as a typed tool, reachable four ways — the app UI (`action_invoke` command), an in-app **agent** (`brain/`, tool-calling loop over a local Ollama model), an **MCP server** for external agents (`fluxnode --mcp`), and a headless **CLI** (`fluxnode --agent "<message>"`). A pluggable **media adapter** (`media/`) routes image/audio generation across backends (stable-diffusion.cpp, ComfyUI, whisper, piper) with a GPU arbiter that shares VRAM between the model and diffusion jobs. See `docs/AI Copilot and Media Adapter Design.md`.

## Important Docs

- `MASTERPLAN.md` - primary technical specification
- `MASTERPLAN Completion Audit.md` - current implementation status by major section
- `MASTERPLAN Performance Evidence Audit.md` - Section 11 proof and guardrail status
- `MASTERPLAN Remaining Work Report.html` - concise summary of what still blocks a fully complete claim
- `Product Requirements Document.md` - product-level requirements
- `Software Requirements Specification.md` - system-level requirements
