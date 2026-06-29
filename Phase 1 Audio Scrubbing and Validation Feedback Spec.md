# Phase 1 Audio Scrubbing and Validation Feedback Spec

## Purpose

This document proposes the next implementation slice required to close another verified gap cluster between the current FluxNode codebase and `MASTERPLAN.md`.

It focuses on two remaining interaction-level behaviors that are partially scaffolded but not yet implemented to spec:

- audio scrubbing behavior in Timeline mode
- richer workflow connection validation feedback during edge creation

## Current Repo Truth

The current application already contains strong groundwork in both areas:

- audio tracks, volume, pan, mute, solo, waveform density, and waveform caching exist
- timeline transport and shuttle controls exist
- a `scrubEnabled` preference exists
- workflow connection validation logic exists
- compatible and incompatible ports are visually differentiated during edge creation
- connection failure reasons are already returned by validation logic

However, the current implementation still falls short of the explicit interaction behavior described in `MASTERPLAN.md`:

- `scrubEnabled` currently behaves as a stored toggle, not as actual scrubbing playback logic
- no explicit distinction exists between slow scrub, fast scrub burst, and J/K/L shuttle audio behavior
- workflow validation feedback dims and highlights ports, but invalid connection attempts do not yet present the specified snapback/shake/tooltip feedback path

## Complexity Classification

- Level: `C-2`
- Reason: this slice adds interaction behavior and feedback rules on top of existing systems without requiring subsystem replacement

## Change Risk Assessment

- Risk: `MEDIUM`
- Why:
  - touches timeline transport interaction
  - touches workflow port interaction and edge-creation UX
  - changes user feedback timing rather than only static data

## Parent-Layer Alignment

### MASTERPLAN

This slice directly targets:

- Section 5.4: `Audio Scrubbing`
- Section 8.2: `Validation Timing`
- Section 8.3: `Visual Feedback`

### Software Requirements Specification

This slice supports editor responsiveness and clearer error prevention during authoring.

### Product Requirements Document

This slice improves the feel of editing and the clarity of workflow graph authoring without broadening functional scope.

## Peer-Layer Alignment

The following current modules are the anchors for this slice:

- `src/features/timeline/TimelineView.tsx`
- `src/features/workflow/WorkflowView.tsx`
- `src/domain/workflow/validation.ts`
- `src/store/project-store.ts`

This slice must stay surgical:

- no real audio engine integration beyond the existing mock/runtime adapter boundary
- no redesign of waveform rendering
- no node graph layout rewrite
- no keyboard shortcut remapping work unless directly needed by scrub behavior

## Root-Cause Analysis For The Verified Gap

### Symptom

The repository already exposes controls and preference state for audio scrubbing and connection validation, but key authoring behaviors from `MASTERPLAN.md` are still missing in runtime interaction.

### Evidence

- `scrubEnabled` is toggled in store state, but there is no verified implementation of speed-based scrub playback behavior
- waveform generation is active, but not tied to real scrubbing playback rules
- workflow connection attempts already classify ports as compatible/incompatible
- invalid connection reasons are available through `validateConnectionAttempt`
- invalid connection attempts do not yet produce explicit interaction feedback such as shake or inline tooltip messaging

### Root Cause

The current implementation prioritized structural validation and editor state before adding the higher-fidelity interaction layer that turns those states into author-facing editing feedback.

### Why The Issue Escaped Detection

The UI already looks capable because the toggles, waveforms, and connection highlighting exist. The missing work is mainly in behavior timing and feedback choreography.

### Proposed Prevention

- treat interaction states as explicit store/UI state rather than incidental component logic
- expose temporary feedback state for invalid connections and scrub mode
- keep timing-sensitive editor behavior documented before implementation

## Proposed Scope: Audio + Validation Feedback Slice

### In Scope

1. Add runtime scrub interaction state
2. Differentiate:
   - slow drag scrub
   - fast drag burst scrub
   - shuttle scrub via `J/K/L`
3. Surface scrub mode in UI state so behavior is visible and testable
4. Add invalid connection feedback state for workflow edge creation
5. Show inline invalid connection reason near the attempted target
6. Add a short shake/snapback feedback path for rejected connections

### Out Of Scope

- full low-latency audio DSP implementation
- real pitch-shifting engine in Rust
- waveform cache format changes
- custom validation rule editor
- graph execution engine changes beyond current validation rules

## Proposed Data and UI Contract Changes

### Audio Scrub State

Add lightweight UI state for active scrub feedback:

```typescript
scrubPreviewState: {
  active: boolean
  mode: "slow_drag" | "fast_drag" | "shuttle" | null
  speed: number
  sourceTime: number | null
  startedAt: string | null
}
```

Behavioral meaning:

- `slow_drag` for sub-2x scrubbing
- `fast_drag` for burst-preview style feedback when drag speed is high
- `shuttle` for `J/K/L` transport feedback

### Workflow Validation Feedback State

Add temporary UI feedback state for invalid connection attempts:

```typescript
workflowConnectionFeedback: {
  targetNodeId: string | null
  targetHandle: string | null
  reason: string | null
  tone: "warning" | "error" | null
  visibleUntil: string | null
  shakeKey: number
}
```

Behavioral meaning:

- `reason` is sourced from `validateConnectionAttempt`
- `visibleUntil` drives short-lived inline tooltip state
- `shakeKey` lets the target port or node replay a short shake animation for each rejected attempt

## Proposed Audio Scrubbing Behavior

### Dragging The Playhead

When `scrubEnabled` is on:

1. detect playhead drag speed from pointer delta over time
2. if estimated speed is below `2x`
   - enter `slow_drag`
   - surface pitch-shifted scrub preview intent through UI state
3. if estimated speed is above `2x`
   - enter `fast_drag`
   - surface short burst preview intent at the current playhead/source position
4. when drag ends
   - clear scrub preview state

### Shuttle Playback

When transport is driven by `J/K/L`:

- if playback rate is not `1x`
- and `scrubEnabled` is on
- surface `shuttle` scrub preview state tied to the active shuttle speed

### Implementation Boundary

For this phase, the goal is not a production audio engine.

The goal is:

- encode the behavior modes correctly
- surface them to the UI
- route them through a clear adapter boundary so real playback implementation can be swapped later

## Proposed Workflow Validation Feedback Behavior

### During Edge Draft

Keep the current behavior:

- compatible ports highlight
- incompatible ports dim
- draft preview line remains visible

### On Invalid Connect Attempt

When the user attempts to complete an invalid connection:

1. reject the connection as today
2. set `workflowConnectionFeedback` with the validation reason
3. replay a short shake on the attempted target port or node
4. show a short-lived inline tooltip such as:
   - `Cannot connect audio to video`
   - `A node cannot connect to itself`
   - `This connection would create a cycle`

### On Valid Connect Attempt

- clear any prior connection feedback
- preserve current replace-single-input behavior

## Acceptance Criteria

1. `scrubEnabled` affects real interaction state instead of only stored preference state
2. timeline playhead drag distinguishes slow and fast scrub modes
3. `J/K/L` shuttle updates scrub preview state when scrubbing is enabled
4. invalid workflow connections show a visible reason near the attempted target
5. invalid workflow connections trigger a short shake/snapback feedback path
6. current compatible/incompatible port highlighting remains intact

## Verification Plan

1. drag the playhead slowly and verify `slow_drag` scrub feedback activates
2. drag the playhead quickly and verify `fast_drag` scrub feedback activates
3. use shuttle playback and verify `shuttle` feedback activates
4. attempt invalid connections for:
   - incompatible data type
   - self-connection
   - cycle creation
5. verify each invalid attempt surfaces the correct reason and temporary shake feedback
6. run:
   - `npm run lint`
   - `npm run build`
   - `cargo check`

## Proposed Next Execution Order

1. extend UI/store state for scrub preview and connection feedback
2. wire timeline transport interactions to scrub-mode transitions
3. wire workflow invalid connect attempts to feedback state
4. add short-lived tooltip and shake presentation in `WorkflowView`
5. validate the behavior against the current port compatibility rules

## Decision Needed Before Code

Approve this audio scrubbing and validation feedback slice as the next implementation target after render resilience.

Once approved, code generation should begin in this exact slice before moving into deeper architecture work or unrelated UX polish.
