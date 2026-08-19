# STATUS

Living source of truth for "what actually works today" in FluxNode. Everything else
(`MASTERPLAN.md`, the audit docs, `HANDOFF.md`, the PRD/SRS) is either a spec, a deeper design
doc, or a point-in-time audit — this file is the one meant to stay current and honest, and it
links out to those rather than duplicating them.

> Last reconciled: 2026-08-19, against the repo at `74866a1` (a read-only coherence audit of
> editor state / timeline<->graph parity / Action Registry / agent+MCP+CLI / media / render /
> proof). Supersedes the 2026-07-09 reconciliation against `HANDOFF.md` and
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
export/render queue, undo/redo, keyboard shortcuts, onboarding, and dual runtime (Tauri desktop
vs. browser/localStorage dev mode) are all implemented and covered by at least some Vitest
coverage and/or browser verification. Timeline export is real: `render_graph.rs` compiles the
multi-track timeline into one `-filter_complex` ffmpeg argv and runs it with real progress
streamed into a per-job status file.

Four things in this area were previously described here more strongly than the code supports.
Corrected:

- **The workflow graph does not affect the exported artifact.** `render_start` /
  `start_export_job` compile the timeline only (`render_graph.rs`). The graph has a separate
  compiler (`workflow_graph.rs`) reachable from exactly one caller — `workflow_render_node` —
  which renders to a temp file, decodes frame 0 as a node preview, and deletes it. No
  transform / color_correct / compositor / shader / AI node reaches the render.
- **"Render resilience (auto-retry, GPU-OOM fallback)" overstates the GPU path.** Auto-retry
  and the cloud-network backoff are real. The GPU-OOM fallback writes a reduced resolution into
  `job.config.resolution`, but the retry goes through `render_retry` ->
  `restart_render_from_manifest`, which rebuilds from the manifest's *original* preset — so the
  retry re-runs the same ffmpeg invocation. Treat GPU-OOM fallback as **Pending**.
- ~~**Render progress is not polled automatically.**~~ **Fixed.** The store now owns a 1 s
  poller (`startRenderStatusPolling` / `stopRenderStatusPolling`): idempotent, guarded against
  overlapping ticks, and it retires itself once no job is active, so an idle app holds no timer.
  The app shell keys it on whether anything is in flight, so it also re-arms for a project
  reopened with a job still running. `render.queue.refresh` moved onto a new
  `applySystemMutation` — patches, validation and WAL, but no history command — because a
  once-a-second poll on `applyMutation` would fill the 200-entry undo stack, let undo "revert" a
  status readback, and clear the redo stack on every tick. Note `asset.rescan` still has that
  problem and is untouched.
- **`timeline<->workflow sync` is one pointer pair, not semantic parity.** Only
  `Clip.workflowNodeId` <-> `media_source` `node.data.timelineClipId` is shared. Effects,
  tracks, and output settings are represented independently on each side and are never
  reconciled. `validateProject` reports a broken link as a *warning* and nothing blocks on it.
- **Workspace sharing is local-only.** `createWorkspaceShareLink` mints a
  `https://share.fluxnode.app/...` string; there is no server, upload, or receiver behind it,
  and collaborators/invites/roles are local project state. Treat as **Pending**, not
  Implemented.
- **Browser mode does not render.** Project persistence, autosave, and the WAL genuinely work
  against localStorage, but `pollRenderJobStatus` returns a hard-coded `completed` / 100% /
  1 MB result in browser mode, so the queue reports a successful export that never happened.
  Any "browser-verified" render evidence (including the Section 11 4K60 proof flow) is
  measuring that stub and must be re-taken on the desktop runtime.

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

**Whisper update (2026-07-19):** the Windows x64 whisper.cpp sidecar is now staged by
`scripts/fetch-whisper.ps1`, checksum-verified, and bundled with its runtime DLLs and English base
model as Tauri resources. The package contents were inspected in a Windows NSIS/MSI build; updater
signing still needs `TAURI_SIGNING_PRIVATE_KEY`. The detailed source/version contract is in
`docs/whisper-sidecar-installation-spec.md`. Piper and stable-diffusion.cpp remain unbundled.

> **Staging gap:** `src-tauri/binaries/` is gitignored and `scripts/fetch-whisper.ps1` is not
> invoked by `.github/workflows/ci.yml` or `release.yml` (only `fetch-ffmpeg.ps1` is). Since
> `tauri.conf.json` declares the seven `binaries/whisper/*` files as required `bundle.resources`,
> a tag build has no path to a correct bundle until that step is wired up. The paths are also
> Windows-specific (`.exe` / `.dll`), so the macOS and Linux legs of the release matrix cannot
> satisfy them at all.

Source of truth for this section is `HANDOFF.md` — read it in full before working
in `src-tauri/src/action.rs`, `brain/`, `media/`, or `mcp.rs`.

**Implemented and E2E-verified:**
- Action registry (**36 actions**) — single source of truth for the LLM tool schema, MCP tool
  list, and CLI. That is 27 wrappers over the 48 registered Tauri commands, plus 3 media actions
  (`generate_image` / `transcribe` / `synthesize`) and 6 `FrontendEdit` timeline ops
  (`timeline_remove_range` / `_split_clip` / `_trim_clip` / `_move_clip` / `_add_clip` /
  `_set_clip_property`). By side effect: 11 ReadOnly, 14 Mutating, 5 LongJob, 6 FrontendEdit.
  The other 21 commands have no Action wrapper — notably `workflow_render_node` and
  `render_retry`, so no agent/MCP/CLI caller can preview a node or retry a render.
- Agent loop (`brain/`) with write-gating (`allow_writes`) against a local Ollama backend
  (default model `qwen3.5:4b`).
- Headless `--agent "<message>"` CLI path, verified end-to-end (agent -> `asset_probe` -> real
  `ffprobe` -> natural-language answer; evidence in `bench/wave3/`).
- `MediaBroker` wired into the command layer (`generate_image` / `transcribe` / `synthesize`);
  ComfyUI backend works if a local ComfyUI server is running.

**Partial / not verified:**
- **In-app copilot panel — both proposal kinds are now approvable.** `CopilotPanel.tsx`
  (lazy-loaded from `App.tsx`) calls `agent_chat` and hands the returned proposals to
  `ProposalReview`, which splits them with `partitionProposals`:
  - **timeline edits** — ghost preview (clip-count delta per track, computed with the same ops
    the executor runs), then one "Approve & apply" that lands as a single undo step;
  - **backend actions** — one **Run** control per action, each re-invoking the registry with
    `allow_writes = true` (approve-gate step A5). Deliberately per-action: these are real,
    non-undoable side effects, so there is no bulk approve and **no session-wide writes
    toggle**. Executed sequentially; a failure is recorded and does not stop the rest;
  - **unsupported** — a malformed or unknown frontend proposal is shown and never run.

  Results appear as `copilotOutcomes` (applied / failed / unsupported, one per proposal). Backend
  execution deliberately does **not** go through `applyMutation`: a backend effect is not
  undoable, and putting it in history would let undo hide a job that is still running.

  Remaining gaps: no streaming, no tool-activity trace, no conversation history, no cancel (a
  hung Ollama blocks for up to 180s behind a "Thinking…" label), no reachability check, and the
  panel is reachable only from a floating button — not the command palette, the shortcut
  registry, or the header menus. There is also still no UI entry point for `generate_image` /
  `synthesize` outside a copilot proposal, and their artifacts are still not registered as
  project assets.
- **Copilot timeline ops cannot maintain the workflow link.** The shared pure ops have the
  signature `(tracks: Track[], op, makeId) => Track[]` and have no access to `project.workflow`,
  so an approved `timeline_remove_range` that deletes a linked clip leaves
  `node.data.timelineClipId` dangling — whereas the store's own `selection.delete` clears it.
  The same user-visible operation keeps the invariant via the mouse and breaks it via the agent.
- In-process llama.cpp (`brain/llama.rs`, behind `--features llama`) is a **stub**, not a real
  implementation. Building it locally also needs CMake + libclang, which are not guaranteed to
  be present (see `docs/AI Copilot Binary Setup.md`).
- `--mcp` (the MCP stdio server) is compile-verified only — it has never been driven by a real
  MCP client end-to-end. Note also that since the approve-gate landed, a gated call returns a
  **success** result carrying a `__fluxnode_proposal__` value rather than an error, and MCP has
  no approval channel — so 25 of the 36 advertised tools (every Mutating/LongJob/FrontendEdit
  one) can only ever return a proposal an MCP client cannot act on; just the 11 ReadOnly tools
  actually do work over that transport. `run_mcp` also still builds the full Tauri context, and
  `tauri.conf.json` declares a `main` window, so headless window suppression is unresolved.
- Sidecar binaries: **ffmpeg/ffprobe and whisper.cpp (Windows x64) are bundled** — see the
  whisper update above, including its CI staging gap. Piper and stable-diffusion.cpp are **not
  bundled**: those backends are wired but registered opt-in via env vars
  (`FLUXNODE_SD_BIN`+`_MODEL`, `FLUXNODE_PIPER_BIN`+`_VOICE`) pointing at binaries the operator
  supplies. Their CLI flags were cross-checked against upstream docs but never run.
- CI (`.github/workflows/ci.yml`) now runs lint, typecheck, vitest, build, `cargo fmt --check`,
  `cargo clippy` and `cargo test` on every push/PR — but **`cargo clippy` and
  `npm run format:check` are `continue-on-error`**, so neither is a real gate yet, and the
  Playwright e2e suite is not run in CI at all. The e2e suite also pins `workspaceLayout:
  'strata'`, so the **default Studio layout has no e2e coverage**.

## Repository / infra hardening (this pass)

- CI (`.github/workflows/ci.yml`) and a tag-triggered release workflow
  (`.github/workflows/release.yml`, Windows/macOS/Linux matrix via `tauri-apps/tauri-action`)
  now exist. Only the Windows path has actually been proven by a real build; macOS/Linux
  bundle targets and a `fetch-ffmpeg.sh` equivalent for those OSes are still needed before the
  release workflow can be trusted end-to-end there — and the Windows-only whisper
  `bundle.resources` entries now block those legs outright until they are made
  platform-conditional. Neither workflow stages whisper (see the staging gap above).
- Two CI steps are deliberately non-blocking today (`continue-on-error`): `cargo clippy` and
  `npm run format:check`. The Playwright suite (`npm run test:e2e`) is not wired into CI.
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
