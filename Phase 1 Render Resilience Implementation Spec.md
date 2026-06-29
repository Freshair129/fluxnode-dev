# Phase 1 Render Resilience Implementation Spec

## Purpose

This document proposes the next implementation slice required to move FluxNode closer to complete `MASTERPLAN.md` coverage without widening scope into unrelated systems.

It focuses on the highest-confidence remaining gap cluster verified in the current codebase:

- render failure recovery behavior
- automatic retry policy for transient cloud failures
- GPU out-of-memory render fallback behavior
- queue-visible retry state and failure context

## Current Repo Truth

The current application already contains a substantial export foundation:

- render queue UI exists
- render preset selection exists
- render start, status polling, pause, resume, cancel, reorder, and manual retry exist
- quota failure state and quota messaging exist
- runtime health, VRAM pressure, and cache pressure safeguards exist
- export validation blocks invalid renders before queueing

However, the current implementation still falls short of the explicit resilience behavior described in `MASTERPLAN.md`:

- `cloud_network` recovery is tracked at app-health level, but render jobs do not yet auto-retry with queue-visible backoff behavior
- `gpu_oom` is guarded for preview/proxy work, but render jobs do not yet perform the specified "reduce resolution and retry once" fallback
- render jobs do not yet expose structured retry metadata needed to explain auto-recovery attempts in the queue

## Complexity Classification

- Level: `C-2`
- Reason: this slice changes runtime behavior and queue state contracts, but does not require architecture restructuring or new subsystem introduction

## Change Risk Assessment

- Risk: `MEDIUM`
- Why:
  - touches central store behavior for export jobs
  - changes how failures transition between `queued`, `rendering`, and `failed`
  - affects user-facing reliability expectations during export

## Parent-Layer Alignment

### MASTERPLAN

This slice directly targets the gaps in:

- Section 6: `Export & Output`
- Section 7: `Error Handling & Resilience`

Specifically:

- render queue retry behavior
- cloud network auto-retry with backoff
- quota-aware failure handling
- GPU OOM fallback response during render

### Software Requirements Specification

This slice supports operational resilience and recoverability during export without changing the product surface area.

### Product Requirements Document

This slice improves creator trust during long-running exports by reducing avoidable failures and making recovery state understandable.

## Peer-Layer Alignment

The following current modules are the implementation anchors for this slice:

- `src/store/project-store.ts`
- `src/services/ipc/render-job.ts`
- `src/features/status/SystemPanels.tsx`
- `src/domain/project/types.ts`

The slice must stay surgical:

- no export architecture rewrite
- no media pipeline redesign
- no new settings surface unless required by existing queue UX

## Root-Cause Analysis For The Verified Gap

### Symptom

The repository includes export queue controls and error states, but some `MASTERPLAN.md` resilience requirements are only partially implemented.

### Evidence

- render jobs can be manually retried, but there is no structured per-job auto-retry counter or backoff state in the queue model
- `cloud_network` backoff exists in resilience state handling, but not as a render-job retry loop
- `gpu_oom` handling currently pauses or degrades preview/proxy work, but queued render jobs do not reduce resolution and retry once
- queue cards show failure detail, but not whether a failure is still being auto-recovered

### Root Cause

The export system was implemented with strong manual controls first, but the queue contract was not extended to carry the transient recovery state needed for the full resilience behavior in the master plan.

### Why The Issue Escaped Detection

The current queue looks feature-complete at the UI level because pause, resume, retry, quota, and failure inspection are already present. The remaining gap is behavioral rather than structural.

### Proposed Prevention

- extend `RenderJob` with explicit retry metadata
- keep transient recovery state inside the queue model instead of only in general app errors
- align render failure transitions with explicit category-based recovery rules

## Proposed Scope: Render Resilience Slice

### In Scope

1. Add structured retry metadata to `RenderJob`
2. Auto-retry render jobs that fail with `cloud_network`
3. Use exponential backoff `2s / 4s / 8s` for render auto-retry
4. Mark jobs as failed only after retry budget is exhausted
5. Add one-time GPU OOM fallback for render jobs by reducing resolution and retrying once
6. Surface retry state in the export queue UI
7. Distinguish between:
   - auto-retrying failure
   - exhausted auto-retry
   - manual retry eligibility

### Out Of Scope

- audio scrubbing playback behavior
- new waveform rendering logic
- node graph port animation or shake feedback
- cloud billing screens beyond existing quota summary
- batch render parallelism
- export preset editor redesign

## Proposed Data Contract Changes

### Render Job Metadata

Add the following fields to `RenderJob`:

```typescript
retryCount: number
maxAutoRetries: number
lastRetryAt: string | null
autoRetryReason: "cloud_network" | "gpu_oom" | null
autoRetryScheduledFor: string | null
didFallbackResolution: boolean
originalResolution: { width: number; height: number } | null
```

### Behavioral Meaning

- `retryCount` counts automatic recovery attempts already started
- `maxAutoRetries` is category-specific
- `autoRetryReason` records why the queue is retrying the job
- `autoRetryScheduledFor` lets the queue explain a pending backoff timer
- `didFallbackResolution` records whether the GPU OOM fallback was already consumed
- `originalResolution` preserves the original preset resolution for failure context

## Proposed Recovery Rules

### Cloud Network Failure

When render polling or render status indicates `cloud_network`:

1. If `retryCount < 3`
2. Schedule retry using backoff sequence `2s`, `4s`, `8s`
3. Keep the job in queue-visible recovery state
4. Re-arm the render via existing retry command path
5. If all attempts fail, mark the job `failed`

### Cloud Quota Failure

When category is `cloud_quota`:

- no auto-retry
- keep current quota summary behavior
- preserve manual recovery path and switch-to-local guidance

### GPU OOM Failure

When category is `gpu_oom` during render:

1. If fallback has not yet been used
2. reduce render resolution by one bounded step
3. record fallback usage on the job
4. retry once automatically
5. if it fails again, mark the job `failed`

Resolution reduction must remain bounded and predictable:

- project/custom resolution -> 75% of width and height, rounded to even integers
- never reduce below `640x360`

### Render Failed

For generic `render_failed`:

- no auto-retry
- retain current failed-frame and manual retry flow

## Proposed UI Behavior

### Export Queue Card

Each render job card should show:

- retry count summary
- pending auto-retry countdown or scheduled state
- GPU fallback note when lower resolution retry is active
- final reason when auto-retry budget is exhausted

### Failure Inspector

Failure detail should distinguish:

- `Auto-retrying after cloud network interruption`
- `Retried 3/3 times and failed`
- `Retried once with reduced resolution and failed`

## Acceptance Criteria

1. A render job with `cloud_network` failure auto-retries up to 3 times with visible backoff state
2. A render job with `cloud_quota` does not auto-retry
3. A render job with `gpu_oom` retries once with reduced resolution before final failure
4. A generic render failure still requires manual retry
5. Queue UI exposes enough state to explain what recovery path is active
6. Existing manual pause, resume, cancel, reorder, and open-output behavior remain intact

## Verification Plan

1. Simulate cloud network failure and verify queue-visible retries at `2s`, `4s`, `8s`
2. Verify the job only becomes `failed` after the retry budget is exhausted
3. Simulate quota failure and verify no auto-retry is scheduled
4. Simulate GPU OOM failure and verify one reduced-resolution retry occurs
5. Validate that manual retry still works after exhausted auto-retry
6. Run:
   - `npm run lint`
   - `npm run build`
   - `cargo check`

## Proposed Next Execution Order

1. Extend render job types with retry metadata
2. Add store-level retry scheduling for render failures
3. Add GPU OOM resolution fallback logic for queued renders
4. Surface retry and fallback state in `SystemPanels`
5. Validate failure categories against current polling and retry paths

## Decision Needed Before Code

Approve this render resilience slice as the next implementation target.

Once approved, code generation should begin in this exact slice before moving to audio scrubbing or deeper workflow validation polish.
