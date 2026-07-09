# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- CI workflow (`.github/workflows/ci.yml`): lint (oxlint), typecheck (`tsc -b`), Vitest, a
  build-output smoke check, and a Rust job (`cargo fmt --check`, `cargo clippy`, `cargo test`).
- Release workflow (`.github/workflows/release.yml`): tag-triggered (`v*`) cross-platform
  build via `tauri-apps/tauri-action` (Windows/macOS/Linux matrix; only Windows is currently
  proven end-to-end).
- `scripts/check-build-output.mjs`: asserts the Vite build output directory contains
  `index.html`, to catch `frontendDist`/`outDir` drift between `vite.config.ts` and
  `src-tauri/tauri.conf.json`.
- `LICENSE` (provisional proprietary notice — final licensing choice still pending),
  `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md` (Contributor Covenant), GitHub issue templates
  (bug report / feature request), and a pull request template.
- `.prettierrc`, `.prettierignore`, `.editorconfig`, `.nvmrc` (Node 20) for consistent
  formatting/tooling across contributors.
- `STATUS.md`: single living source of truth for implementation status, linking out to the
  MASTERPLAN family, PRD/SRS, and `HANDOFF.md`.

### Changed

- Expanded `.oxlintrc.json` to enable the `correctness` and `suspicious` rule categories
  (previously only 2 individual rules were configured); disabled the `react-in-jsx-scope`
  false positive (not applicable under the automatic JSX runtime) and left a small number of
  genuine `no-shadow` / `no-unused-vars` warnings for follow-up cleanup.
- Rewrote `stack.txt` to describe the actual shipped stack (Tauri + Rust + Zustand + a custom
  SVG workflow canvas + bundled ffmpeg) — it previously described an unimplemented early
  proposal (React Flow + FastAPI + Socket.IO + ffmpeg-next).
- Renamed root spec/audit docs with spaces in their filenames to kebab-case (`git mv`), and
  updated all cross-references in `README.md`, `CLAUDE.md`, `HANDOFF.md`, and the docs
  themselves:
  - `Product Requirements Document.md` -> `product-requirements-document.md`
  - `Software Requirements Specification.md` -> `software-requirements-specification.md`
  - `FluxNode Design Guide.md` -> `fluxnode-design-guide.md`
  - `Phase 1 Foundation Implementation Spec.md` -> `phase-1-foundation-implementation-spec.md`
  - `Phase 1 Audio Scrubbing and Validation Feedback Spec.md` ->
    `phase-1-audio-scrubbing-and-validation-feedback-spec.md`
  - `Phase 1 Render Resilience Implementation Spec.md` ->
    `phase-1-render-resilience-implementation-spec.md`
  - `MASTERPLAN Completion Audit.md` -> `masterplan-completion-audit.md`
  - `MASTERPLAN Final Approval Packet.md` -> `masterplan-final-approval-packet.md`
  - `MASTERPLAN Performance Evidence Audit.md` -> `masterplan-performance-evidence-audit.md`
- Marked the self-graded audit/approval docs (`masterplan-completion-audit.md`,
  `masterplan-final-approval-packet.md`, `masterplan-performance-evidence-audit.md`) with an
  "author self-assessment, not externally verified" banner.
- `README.md`: added a Prerequisites section (Rust toolchain, Node 20, Ollama for the agent,
  optional CMake/LLVM for `--features llama`), pointed the docs list at `STATUS.md`, and
  explicitly documented the Thai (product/design) vs. English (engineering) documentation
  language split.

### Removed

- `fluxnode_mockup.tsx` — dead 80-line throwaway prototype from before the app was
  implemented; no longer referenced by the build or lint scripts.
- Committed generated reports `MASTERPLAN Remaining Work Report.html` and
  `MASTERPLAN Remaining Work Checklist.html` — untracked and gitignored; regenerate locally
  if needed, source of truth is now `STATUS.md`.

## [0.1.0] - 2026-07-06

- Initial versioned baseline: functional Tauri v2 + React 19 desktop app with timeline
  editing, node-based workflow graph, audio, export/render pipeline, persistence with WAL
  crash recovery, and a first-pass AI Copilot / agent layer (action registry, Ollama-backed
  agent loop, MCP server, media broker). See `masterplan-completion-audit.md` and
  `HANDOFF.md` for full status detail.

<!-- No git remote exists yet (all history is local to `master`); add compare-link
     references here once the repository has a public/shared remote. -->
