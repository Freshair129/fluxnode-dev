# Contributing to FluxNode

Thanks for taking a look at FluxNode. This is currently a small/solo-maintained project — see
`LICENSE` for the (provisional) licensing terms before you contribute any code.

## Prerequisites

- **Node.js 20+** (see `.nvmrc`; run `nvm use` if you use nvm) and npm
- **Rust toolchain**, stable, edition 2021 — install via [rustup](https://rustup.rs/)
- **Tauri v2 system dependencies** for your OS — see the
  [Tauri prerequisites guide](https://v2.tauri.app/start/prerequisites/) (WebView2 on Windows
  is installed automatically by the Tauri CLI)
- **Ollama** running locally if you're touching the AI Copilot / agent layer
  (`src-tauri/src/brain/`, `action.rs`, `mcp.rs`) — default model is `qwen3.5:4b`
- Optional: **CMake + LLVM/libclang** only if you're building with `--features llama`

## Setup

```bash
npm ci
npm run tauri:dev   # full desktop app (Rust backend + Vite frontend)
# or, frontend-only:
npm run dev          # browser mode, localStorage-backed persistence
```

## Before you open a PR

Run the same checks CI runs:

```bash
npm run lint          # oxlint
npx tsc -b            # typecheck
npm test              # vitest
npm run format:check  # prettier

cd src-tauri
cargo fmt --check
cargo clippy
cargo test
```

`npm run build` should also succeed; CI additionally runs
`scripts/check-build-output.mjs` after the build to catch drift between `vite.config.ts`'s
`build.outDir` and `src-tauri/tauri.conf.json`'s `build.frontendDist`.

## Git hooks (optional, no extra dependency)

This repo intentionally does not add Husky or any git-hook dependency to `package.json`. If
you want a local pre-commit check, point git at the versioned hooks directory instead:

```bash
git config core.hooksPath .githooks
```

and create `.githooks/pre-commit` (not committed, since hook needs vary per contributor) with
whatever subset of the checks above you want to run locally, e.g.:

```bash
#!/bin/sh
npm run lint && npm run format:check
```

Make it executable (`chmod +x .githooks/pre-commit` on macOS/Linux; on Windows, Git for
Windows runs it via its bundled shell regardless of the executable bit).

## Conventions

- **Linting:** oxlint only — no eslint. Config in `.oxlintrc.json`.
- **Formatting:** Prettier — 2-space indent, single quotes, no semicolons, trailing commas.
  Run `npm run format` to apply, `npm run format:check` to verify without writing.
- **TypeScript:** strict mode, 6.x.
- **Rust:** edition 2021, format with `cargo fmt`, keep `cargo clippy` clean (or explain new
  warnings in the PR description — clippy is not yet a hard CI gate).
- **Tests:** Vitest is available (`npm test` / `npm run test:watch`). The repo is not
  exhaustively TDD, but prefer adding/updating tests alongside domain (`src/domain/`) and store
  (`src/store/`) changes.

## Where things live

See `CLAUDE.md` / `AGENTS.md` for the full architecture tour, and `STATUS.md` for current
implementation status before you start something that might already be (partially) done.

## Reporting issues / proposing features

Use the GitHub issue templates under `.github/ISSUE_TEMPLATE/`. For anything touching the AI
Copilot / agent layer, read `HANDOFF.md` first — it lists known-not-yet-verified areas so you
don't duplicate investigation.
