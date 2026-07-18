# STATUS

Living source of truth for "what actually works today" in FluxNode. Everything else
(`MASTERPLAN.md`, the audit docs, `HANDOFF.md`, the PRD/SRS) is either a spec, a deeper design
doc, or a point-in-time audit — this file is the one meant to stay current and honest, and it
links out to those rather than duplicating them.

> Last reconciled: 2026-07-09, against `HANDOFF.md` (updated 2026-07-06) and
> `masterplan-completion-audit.md`.

## How to read this

- **Implemented** — real code exists and has been exercised (tests, manual run, or browser/CLI
  verification); may still have gaps in breadth (e.g. platform coverage).
- **Partial** — the core exists but a meaningful piece is stubbed, unverified, or missing a
  surface (e.g. no UI yet).
- **Pending** — not built.

This file **does not** re-grade every MASTERPLAN section — see
`masterplan-completion-audit.md` for that (and note its self-assessment caveat). This file
focuses on the areas most likely to surprise a new contributor.

## Core application

**Implemented.** Timeline editing, node-based workflow graph editing, audio scheduling,
export/render queue with resilience (auto-retry, GPU-OOM fallback), undo/redo, keyboard
shortcuts, onboarding, workspace sharing, and timeline<->workflow sync are all implemented and
covered by at least some Vitest coverage and/or browser verification. Dual runtime (Tauri
desktop vs. browser/localStorage dev mode) both work.

## Workspace layouts (2026-07-18 UX redesign)

**Implemented.** The app now defaults to the **Studio layout** — the familiar CapCut/Premiere
arrangement: slim 48px top bar (File/View menus, Edit|Nodes tabs, accent Export), media bin
(import, search, drag/double-click to timeline) left, bare preview monitor + transport bar
center, inspector right, and a **time-proportional timeline** (adaptive ruler, spanning
playhead, drag-to-move / edge-trim with snapping, per-track M/S/lock/visibility toggles,
Ctrl+wheel zoom) below a draggable splitter. Key files:
`src/features/workspace/StudioShell.tsx`, `src/features/timeline/StudioTimeline.tsx`,
`src/features/media/MediaPanel.tsx`, `src/features/preview/TransportBar.tsx`. New store actions
`addClipFromAsset` and `setWorkspaceLayout`; new `AppPreferences.workspaceLayout`
(`studio` default | `strata`).

The MERIDIAN **Strata layout** (sky/horizon/ground) remains fully available via the header's
View menu; the Playwright e2e suite pins `workspaceLayout: 'strata'` in `e2e/fixtures.ts`
because specs 03/05/07/09 assert strata-shell geometry. The old stacked-card `TimelineView`
still serves the strata shell and detached timeline windows.

## Auto-updates (2026-07-18)

**Implemented (desktop).** Signed auto-updates via `tauri-plugin-updater`: silent check ~8s
after launch + Check Now in the status bar's Updates drawer → one-click Download & Install
(signature-verified against the compiled-in minisign public key, streamed progress) → Restart
FluxNode (`tauri-plugin-process`). Endpoint:
`https://github.com/Freshair129/fluxnode-dev/releases/latest/download/latest.json`, produced by
`tauri-action` (`createUpdaterArtifacts` + `includeUpdaterJson`) on every tag build. The legacy
sha256 manifest flow remains as the browser-mode / custom-manifest fallback. Release steps:
`RELEASING.md`. Signing key management and SmartScreen caveats: `SIGNING.md`. **Not yet proven
end-to-end** — needs the first published (non-draft) release with the `TAURI_SIGNING_PRIVATE_KEY`
secret set, then an install of vN updating to vN+1.

**Known gap:** Section 11 (performance/system requirements) proof breadth across OS targets
and hardware tiers beyond what's been directly benchmarked. See
`masterplan-performance-evidence-audit.md`.

## AI Copilot / agent layer

Source of truth for this section is `HANDOFF.md` (2026-07-06) — read it in full before working
in `src-tauri/src/action.rs`, `brain/`, `media/`, or `mcp.rs`.

**Implemented and E2E-verified:**
- Action registry (30 actions) — single source of truth for the LLM tool schema, MCP tool
  list, and CLI.
- Agent loop (`brain/`) with write-gating (`allow_writes`) against a local Ollama backend
  (default model `qwen3.5:4b`).
- Headless `--agent "<message>"` CLI path, verified end-to-end (agent -> `asset_probe` -> real
  `ffprobe` -> natural-language answer; evidence in `bench/wave3/`).
- `MediaBroker` wired into the command layer (`generate_image` / `transcribe` / `synthesize`);
  ComfyUI backend works if a local ComfyUI server is running.

**Partial / not verified:**
- No in-app chat/voice UI panel yet — the brain is reachable only via command, CLI, or MCP,
  with no UI surface in `src/features/`.
- In-process llama.cpp (`brain/llama.rs`, behind `--features llama`) is a **stub**, not a real
  implementation. Building it locally also needs CMake + libclang, which are not guaranteed to
  be present (see `docs/AI Copilot Binary Setup.md`).
- `--mcp` (the MCP stdio server) is compile-verified only — it has never been driven by a real
  MCP client end-to-end.
- Sidecar binaries for whisper / piper / stable-diffusion.cpp are **not bundled**;
  `src-tauri/binaries/` currently only ships ffmpeg/ffprobe. The sidecar backends are wired but
  registered opt-in via env vars pointing at binaries the operator supplies themselves.
- `cargo test` / `cargo clippy` / the full `npm` gate had not been run against the agent-layer
  changes as of the last handoff — the new CI workflow (`.github/workflows/ci.yml`) now runs
  these on every push/PR, which will surface any regressions here going forward.

## Repository / infra hardening (this pass)

- CI (`.github/workflows/ci.yml`) and a tag-triggered release workflow
  (`.github/workflows/release.yml`, Windows/macOS/Linux matrix via `tauri-apps/tauri-action`)
  now exist. Only the Windows path has actually been proven by a real build; macOS/Linux
  bundle targets and a `fetch-ffmpeg.sh` equivalent for those OSes are still needed before the
  release workflow can be trusted end-to-end there.
- `LICENSE` is **provisional** — proprietary/all-rights-reserved for now, pending an explicit
  business decision on final licensing (see the note at the top of `LICENSE`).
- Root spec/audit docs with spaces in their filenames were renamed to kebab-case; see
  `CHANGELOG.md` for the full rename map.

## Where to go next

- New to the codebase: `README.md` -> `CLAUDE.md` / `AGENTS.md` -> `MASTERPLAN.md`.
- Working on the agent/AI layer: `HANDOFF.md` first, then
  `docs/AI Copilot and Media Adapter Design.md`.
- Deciding what to build next: `masterplan-completion-audit.md` (Partial/Pending items) and
  `masterplan-performance-evidence-audit.md` (Section 11 gaps) — both are self-assessments, so
  treat them as a checklist to verify, not a finished grade.
