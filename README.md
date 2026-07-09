# FluxNode

FluxNode is a Tauri v2 desktop video editor that combines a timeline-oriented editing surface with a node-based AI/VFX workflow. The current repository is a functional app shell with real state management, persistence, validation, render orchestration, performance guardrails, and proof tooling.

> For the honest, up-to-date picture of what's implemented vs. pending, see **[STATUS.md](STATUS.md)**.

## Prerequisites

- **Node.js 20+** (see `.nvmrc`) and npm
- **Rust toolchain** (stable, edition 2021) — install via [rustup](https://rustup.rs/); required for `tauri:dev` / `tauri:build` and any `cargo` command
- **Tauri v2 system dependencies** for your OS (WebView2 on Windows is auto-installed by the Tauri CLI; see the [Tauri prerequisites guide](https://v2.tauri.app/start/prerequisites/) for macOS/Linux)
- **Ollama** running locally, for the AI Copilot / agent layer (`brain/ollama.rs` talks to Ollama's `/api/chat`; default model `qwen3.5:4b`)
- Optional: **CMake + LLVM/libclang** only if you plan to build with `--features llama` (in-process llama.cpp backend, currently a stub)

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

- `STATUS.md` - living source of truth: what's implemented vs. pending, links to everything below
- `MASTERPLAN.md` - primary technical specification
- `masterplan-completion-audit.md` - current implementation status by major section (author self-assessment, not externally verified)
- `masterplan-performance-evidence-audit.md` - Section 11 proof and guardrail status (author self-assessment, not externally verified)
- `masterplan-final-approval-packet.md` - record of an approved implementation slice (author self-assessment, not externally verified)
- `product-requirements-document.md` - product-level requirements
- `software-requirements-specification.md` - system-level requirements
- `HANDOFF.md` - current AI Copilot / agent-layer handoff notes for the next contributor

### Documentation language split

Engineering docs (this README, `CLAUDE.md`, `AGENTS.md`, `HANDOFF.md`, `STATUS.md`, the MASTERPLAN family, PRD/SRS, `docs/`) are written in **English**. Some product-direction and design notes were originally authored in **Thai** and may still contain Thai passages (for example parts of `fluxnode-design-guide.md` and historical planning notes) — this is intentional, not an inconsistency, and reflects the primary author's working language for product/design thinking versus engineering documentation.
