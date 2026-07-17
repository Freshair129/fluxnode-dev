# Scope — Copilot Approve-Gate UI & Timeline-Edit Actions

> Draft 2026-07-17. Grounds on the plan-benchmark result (`bench/plan-bench/STABLE.md`:
> qwen3.5:4b, stable 95% valid-plan, 0 hallucinated tools in 100 runs). The benchmark closed the
> "can the local 4B brain plan?" question — **yes for read-chains and single typed write proposals.**
> This scope turns that proven behavior into a shipping propose→approve→execute loop.

## 0. The one architectural decision everything hangs on

The agent brain and the action registry are **Rust-side**. Timeline state authority and every
mutation are **frontend-side** — all edits flow through `applyMutation` / `applyGroupedMutations`
in `src/store/project-store.ts`, which own Immer patches, undo/redo history, WAL, and validation.
Timeline editing does **not** go through Tauri commands today.

Therefore timeline-edit "actions" must **not** mutate `project.json` on disk from Rust (that would
bypass history/WAL/validation and force a jarring reload). Instead:

**The write-gate becomes the proposal channel.** A gated call (`allow_writes = false`) already
means "valid, but needs a human." Today `Registry::invoke` dead-ends it with an error string
(`action.rs:96`). We change it to return a structured *proposal* and record the op. The agent keeps
planning; `agent_chat` returns the collected proposals with the answer; the frontend renders them
as ghost edits, and on approval **materializes them through `applyGroupedMutations` (one undo entry
per approved plan).**

Why this is the right seam, not a workaround:
- The benchmark already proved the model *proposes then asks* on gated writes (T4: it calls the
  tool once, gets the gate result, and asks for approval — in Thai too). We are surfacing behavior
  the model already exhibits, not teaching it new tricks.
- `applyGroupedMutations` already gives atomic, single-undo multi-step edits — a rough-cut that
  removes 40 silences is **one** undo labeled "Copilot: remove 40 silences."
- Ghost preview needs no new engine: compute the after-state with the same op logic on a throwaway
  clone (what `produceWithPatches` does), diff against current, render the diff as overlays.

## 1. Two execution paths on approval, one approval UX

The review card is uniform; the dispatch under it differs by action class:

| Action class | Examples | On approve, execute by… |
|---|---|---|
| **Rust-backed** Mutating/LongJob | `asset_generate_proxy`, `render_start`, `save_project_state` | re-invoke the registry with `allow_writes = true` (the existing `run()`) |
| **Frontend-materialized** timeline ops | `timeline_split_clip`, `timeline_remove_range`, … | apply via `applyGroupedMutations` using shared TS op logic |

The user never sees the seam. Internally, timeline ops carry a marker (recommend a new
`SideEffect` treatment `Mutating { execution: Frontend }`, or a parallel `ExecutionSite` field on
`ActionDef`) so `invoke` knows an approved timeline op is dispatched to the frontend, never `run()`
in Rust. Rust owns only the **vocabulary** (name + JSON schema + description) for these — enough for
the model to call them and for `validate_args` to reject malformed calls.

## 2. Workstream A — Approve-gate loop (the plumbing + UI)

There is **no** frontend agent surface yet (`grep agent_chat src/` → nothing). This is greenfield.

**A1. Gate → structured proposal (Rust).** In `Registry::invoke`, when a gated Mutating/LongJob
(or frontend-timeline) action is refused, return `{ status: "proposed", action, args, summary }`
instead of an `Err`. Collect proposals for the turn (registry-side collector or an out-param on the
agent loop). Feed the model a short "queued for approval — continue" result so it keeps planning.
*Est: small, ~1 file. This is HANDOFF pending item #2.*

**A2. `agent_chat` return shape.** Change from `String` to
`{ answer: string, proposals: Proposal[] }`. Add `src/services/ipc/agent.ts` (missing today)
wrapping the `agent_chat` invoke. *Est: small.*

**A3. Copilot panel (`src/features/copilot/`).** Chat input, streamed tool-activity log
(reuse `AGENT_TRACE`-style events), and the **proposal review card**: each proposal in human terms
("Split clip 3 at 0:04; remove 0:04–0:06, ripple later clips left 2.0s"), per-op + bulk
Approve / Reject. Design-system dark glass, accent `#e0ff00`. *Est: medium — the bulk of the UI.*

**A4. Ghost preview on the timeline.** For frontend-timeline proposals, compute the after-state
(shared op logic, no commit) and render the delta as overlays on the existing timeline renderer:
new clips dashed, removed spans red-hatched, moved clips at target with a trail. *Est: medium.*

**A5. Execution dispatch.** On approve: Rust-backed proposals → re-invoke registry
(`allow_writes = true`); timeline proposals → `applyGroupedMutations` with label
`Copilot: <plan summary>`. Rejected proposals discarded; partial approval supported. *Est: small–medium.*

`allow_writes` stays **false** on the interactive agent loop — the gate *is* the UX. `allow_writes = true`
remains only for headless / power-user "just do it" (CLI, MCP).

## 3. Workstream B — Timeline-edit action vocabulary

Typed ops, one concept per action (the benchmark shows the 4B model is strong at small typed calls,
weaker at big nested JSON — so decompose, don't hand it one mega-plan tool). Grounded in the real
`Clip` / `Track` shape (`src/domain/project/types.ts`): a clip is
`{ id, assetId, trackId, startTime, duration, inPoint, outPoint, speed, volume, opacity, workflowNodeId, … }`.

**P0 — the money ops (unlock the rough-cut concierge demo):**
- `timeline_split_clip(clipId, time)` — razor at an absolute timeline time.
- `timeline_remove_range(trackId, start, end, ripple)` — delete a span; `ripple` shifts later clips
  left to close the gap. This + transcribe is "cut the silences."
- `timeline_trim_clip(clipId, edge, delta)` — adjust head/tail (`inPoint`/`outPoint` + `startTime`/`duration`).

**P1 — round out basic editing:**
- `timeline_move_clip(clipId, trackId, newStartTime)`
- `timeline_add_clip(assetId, trackId, startTime, inPoint?, outPoint?)`
- `timeline_set_clip_property(clipId, prop, value)` — `volume` / `opacity` / `speed`.

**P2 — track-level (map onto existing store mutations):** mute / solo / volume / add / rename.

**Cross-cutting rules for every op:**
- **Preserve `workflowNodeId` links.** Splitting a clip that has a linked workflow node must keep the
  timeline↔workflow sync intact (decide: both halves link, or the node re-anchors to the head).
- **Validation is free** — execution runs through `applyMutation`, so `getValidationState` already
  guards the result; a proposal that would produce an invalid timeline is rejected at execute time
  and surfaced, not silently applied.
- Op semantics (ripple math, in/out rewrite) live in **TS** in the store, called by both the ghost
  preview and the executor — one implementation, no drift.

## 4. Sequence — prove the seam before fanning out

**Slice 1 (vertical, end-to-end): one op through the whole loop. — BUILT 2026-07-17.**
`timeline_remove_range` + A1–A5. Demo: *"remove the gap between 2 and 4 seconds"* → ghost overlay →
Approve → span gone, later clips rippled, **one** undo entry. This exercises every seam (gate→proposal,
return shape, panel, ghost, group-execute).

Delivered & verified:
- Rust gate returns `__fluxnode_proposal__` values instead of erroring; `run_agent` collects them;
  `agent_chat` returns `{answer, proposals}` (`AgentOutcome`). New `SideEffect::FrontendEdit`.
- `timeline_remove_range` action registered (FrontendEdit). CLI-verified: the model extracts
  `{trackId,start,end,ripple}` from natural language, the gate proposes it, and the model asks for
  approval instead of assuming success.
- Pure op `removeRangeFromTracks` (`src/domain/timeline/remove-range.ts`) — 11 vitest cases green
  (before/after/inside/split/tail/head trims, ripple, workflowNodeId, keyframes).
- `applyCopilotProposals` store action executes approved proposals via one `applyMutation` — 3
  vitest cases green (one plan = one undo entry; multi-op collapses to one undo; undo restores).
- IPC wrapper `src/services/ipc/agent.ts`; `CopilotPanel` (`src/features/copilot/`) with textual
  ghost preview (clip-count delta via the shared op) + approve/reject, mounted in the app shell.
- Gates: `tsc -b`, `oxlint`, and the full vitest suite (241 tests) all green.

Not yet verified (needs `tauri:dev`, opens a window): the literal click-through in the running
desktop GUI. Deferred to Slice-2 polish: the on-canvas translucent ghost overlay (Slice 1 ships a
textual ghost in the review card).

**Slice 2:** fan out the P0 vocabulary + partial/bulk approval polish.

**Slice 3 (the demo):** rough-cut concierge — `transcribe` (already registered) → detect silences →
propose N `remove_range` ops → one ghost plan → one approval → one undo. This is the
"Palmier structurally can't do this offline for zero credits" moment.

## 5. Risks & how we retire them

- **RISK (highest): multi-op plan coherence is unproven.** The benchmark proves the model *calls*
  `remove_range` with plausible args once. It does **not** prove it can propose 40 *valid* removals
  from a real transcript (every `clipId` exists, every time in range, ripple math right). Cheapest
  test: **extend the harness with a Tier-6** that loads a real project + transcript and scores the
  proposed op plan for structural validity.
- **RISK: the CLI harness cannot verify frontend-executed ops.** `fluxnode --agent` can see the model
  *called* a timeline op, but the resulting timeline is computed in the frontend. Op semantics need
  their **own vitest suite** against the store (split/ripple/trim correctness) — separate from the
  Rust plan-benchmark. Name this as Workstream B's DoD.
- **RISK: ghost-preview drift.** If preview and executor use different code paths they will disagree.
  Mitigation is structural: single shared TS op module, used by both.
- **OPEN: streaming.** `agent_chat` is one blocking call today. Acceptable for v1 (spinner + tool
  log on completion). Token/'event streaming is a fast-follow, not a blocker.

## 6. Non-goals (v1)

Voice input; in-process llama.cpp; multi-track auto-balancing / smart-reframe; editing the workflow
graph via the agent (timeline only first); collaborative/multi-user proposal review; streaming tokens.

## 7. Definition of done

- Gate returns structured proposals; `agent_chat` returns `{ answer, proposals }`; CLI path unchanged.
- Copilot panel: chat → tool log → proposal card with per-op & bulk approve/reject.
- P0 timeline ops proposable, ghost-previewable, and executable as one grouped, undoable, validated edit.
- Rust plan-benchmark green on the P0 op prompts; **new** frontend vitest suite green on op semantics.
- Rough-cut concierge demo runs offline end-to-end: transcript → ghost plan → one approval → one undo.
```
