# Phase 1 Foundation Implementation Spec

## Purpose

This document records the originally approved foundation slice that translated the early design-only repository into an implementation-ready architecture aligned with `MASTERPLAN.md`, the PRD, and the SRS.

It is intentionally limited to the minimum architecture needed to start building FluxNode without locking the project into premature Phase 2 or Phase 3 decisions.

## Current Repo Truth

- Historical context when this spec was written:
  - The repository had no runnable app scaffold.
  - There was no package manager config, TypeScript config, Tailwind config, or Tauri shell.
  - There was no project state implementation, persistence layer, or node/timeline engine.
  - `fluxnode_mockup.tsx` was a static proof of concept, not an integrated application.
- Current status:
  - This foundation slice has since been implemented.
  - For current repo-backed status, see `masterplan-completion-audit.md` and `STATUS.md`.

## Complexity Classification

- Level: `C-3`
- Reason: the first implementation step must establish application architecture, shared state boundaries, and the data contracts that later systems depend on.

## Change Risk Assessment

- Risk: `HIGH`
- Why:
  - Introduces the first real application structure for the repository.
  - Establishes source-of-truth data contracts that later timeline/workflow features will consume.
  - A wrong foundation here would create expensive rework across most of `MASTERPLAN.md`.

## Parent-Layer Alignment

### Product Requirements Document

- Must support the dual-view interface: Timeline and Workflow.
- Must preserve project state when switching views.
- Must prepare for hybrid compute without requiring full compute integration in the first slice.

### Software Requirements Specification

- Must keep view switching under the MVP architecture boundary.
- Must support synchronized project state shared across Timeline and Workflow.
- Must prepare drag/drop and node editing surfaces without claiming advanced processing is complete.

### MASTERPLAN

This foundation slice directly supports the MVP-priority systems:

- Section 1: Data Model and Schema
- Section 2: Project and File Management
- Section 3: Undo/Redo System
- Section 9: Keyboard Shortcuts
- Section 10.1: Onboarding and Empty State
- Section 12: Timeline to Workflow Sync Protocol

## Peer-Layer Alignment

The following files remain authoritative and should not be contradicted:

- `fluxnode-design-guide.md`
- `stack.txt` (now describes the actual shipped stack — Tauri + Rust + Zustand + a custom SVG canvas — not the original React Flow/FastAPI proposal)

> `fluxnode_mockup.tsx` (the original static proof of concept referenced above) has since been deleted; the foundation slice it sketched is now the real implemented app.

This implementation spec preserves the existing visual direction:

- dark-first surface model
- neon accent for active state
- local/cloud compute status in the header
- instant Timeline/Workflow switching

## Root-Cause Analysis For Current Blocker

### Symptom

The active goal is "build all feature in MASTERPLAN.md complete", but the repository cannot begin real feature delivery because it has no executable application foundation.

### Evidence

- No `package.json`
- No `src/`
- No `tauri.conf.json`
- No state/store implementation
- No build toolchain
- Only one standalone mockup component exists

### Root Cause

The repository is still in design/specification phase, so every feature in `MASTERPLAN.md` is blocked by the absence of a shared frontend application scaffold and canonical project state model.

### Why The Issue Escaped Detection

The design documents are detailed enough to look implementation-ready, but they do not yet define the actual source layout, state module boundaries, or the first-run development bootstrapping sequence.

### Proposed Prevention

- Build from a documented foundation slice instead of ad hoc feature-by-feature coding.
- Keep the first code phase constrained to core project schema, shared store, view shells, and project lifecycle primitives.

## Proposed Scope: Foundation Slice

### In Scope

1. Create the initial frontend application scaffold using React + TypeScript + Tailwind.
2. Create a source layout that separates app shell, shared state, domain models, and feature views.
3. Convert the mockup into a routed or state-driven app shell with Timeline and Workflow views.
4. Implement the canonical TypeScript data model for:
   - project root
   - asset registry
   - timeline state
   - workflow state
   - node data
5. Implement a Zustand project store as the shared source of truth.
6. Seed the app with a demo project that exercises the schema.
7. Implement view switching with preserved shared state.
8. Add empty-state UX for Timeline and Workflow.
9. Add the first layer of keyboard shortcut handling for:
   - `Tab`
   - `Ctrl+S`
   - `Ctrl+Z`
   - `Ctrl+Shift+Z`
10. Add a command-history foundation for undo/redo, even if only a small set of actions is initially wired.
11. Prepare project persistence adapters behind an interface, even if the first pass uses browser-local persistence instead of real Tauri file APIs.

### Out Of Scope

- Real Tauri integration
- Real file system import/export dialogs
- Real ComfyUI or cloud compute calls
- Real media decode/playback
- Audio waveform generation
- Final render/export pipeline
- Multi-window support
- Full accessibility audit
- Production-grade performance optimization

## Proposed Architecture

### Initial Source Layout

```text
src/
  app/
    App.tsx
    providers/
    layout/
  domain/
    project/
      types.ts
      defaults.ts
      validators.ts
    history/
      command.ts
      history-manager.ts
    workflow/
      node-definitions.ts
  features/
    header/
    timeline/
    workflow/
    onboarding/
    shortcuts/
  store/
    project-store.ts
    selectors.ts
    actions/
  services/
    persistence/
      project-repository.ts
      local-project-repository.ts
  styles/
  lib/
```

### State Ownership

- Zustand store is the runtime source of truth.
- Domain model types mirror `MASTERPLAN.md` section 1.
- Timeline and Workflow views both read from the same project store.
- Undo/redo wraps store mutations through command execution where feasible.

### Persistence Strategy For This Slice

- Use a repository interface now.
- Use browser-local persistence for the first runnable version.
- Keep file-system and Tauri-specific behavior behind service boundaries so it can be swapped later without rewriting the UI layer.

## Deliverables For The First Code Phase

1. A runnable frontend app.
2. A reusable app shell based on the existing FluxNode visual direction.
3. Strongly typed project models aligned to the master plan.
4. A shared Zustand store with seeded demo data.
5. Working Timeline and Workflow shells backed by the same state.
6. Basic undo/redo plumbing for selected mutations.
7. A documented gap list for the next slice.

## Acceptance Criteria

1. The repository can install and run locally with a documented dev command.
2. The app opens to a FluxNode shell rather than a standalone mockup component.
3. The user can switch between Timeline and Workflow without losing state.
4. Demo project data is rendered in both views from the same store.
5. At least one Timeline mutation and one Workflow mutation are undoable and redoable.
6. The foundation code uses the master-plan data model names consistently.
7. The new source layout leaves clear extension points for Tauri persistence and compute integration.

## Verification Plan

1. Bootstrap app and verify the dev server starts successfully.
2. Validate TypeScript compilation.
3. Verify view switching keeps the same project state instance.
4. Verify undo/redo updates visible UI state.
5. Verify seeded workflow/timeline links honor the sync-reference fields.

## Proposed Next Execution Order

1. Bootstrap the React + TypeScript + Tailwind application shell.
2. Implement the domain types and default seeded project.
3. Implement the Zustand store and history manager.
4. Replace the static mockup with a real app shell backed by the store.
5. Add the first Timeline and Workflow interactive primitives.

## Decision Needed Before Code

Approve this foundation slice as the first implementation target for the repository.

Once approved, code generation should begin in this exact slice before attempting export, audio, IPC, or advanced rendering systems.
