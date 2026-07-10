# MERIDIAN Orchestration Protocol

> Governs all work on `feat/meridian-ui` (worktree: `D:\fluxnode-worktrees\meridian-ui`).
> Acceptance criteria source: [docs/design/MERIDIAN-UI-SPEC.md](docs/design/MERIDIAN-UI-SPEC.md).

## Roles

| Role | Model / system | Responsibility |
|---|---|---|
| **Orchestrator + Final Gate + Assembler** | **Fable 5** (this pipeline's top level) | Decomposes the spec into work items, routes each item to a worker, integrates finished pieces, resolves conflicts, runs the final gate (build + lint + spec conformance + cross-item coherence) before anything merges toward `master`. |
| **Main worker A** | **Sonnet 5** (cloud subagent) | Implementation of C-2/C-3 items: new components, state logic, canvas work, anything touching more than one file or requiring design judgment. |
| **Main worker B** | **Local LLM** (Ollama, RTX 3060 12GB) | Only micro-tasks that pass the eligibility checklist E1–E6 of `G:\Rwang\docs\SPEC--LOCAL-LLM-DISPATCH-V2.md`: pure, single-file, deterministic-verifiable pieces carved out of C-1 items. Anything that fails one E-rule routes to Sonnet 5 instead. |
| **Local-LLM supervisor** | **RWANG** (`G:\Rwang`, spec + ledger in `G:\Rwang\docs` and `D:\G-Music\docs\LOCAL_MODEL_LEDGER.md`) | Owns every local dispatch per Dispatch v2: model from the measured pool (1. `sushirl:latest` default, 2. `Mellum2-12B` latency-sensitive, 3. `Ornith-1.0-9B` agentic/tool-calling; all installed), v-plain prompt template (no bracket headers), per-model options (default temp 0.1 / ctx 8192 / predict 2500 / keep_alive 30m; Qwythos temp 0.6), extractor v2, VRAM pre-warm/serialization, maxRework = 1 then escalate up the pool → Sonnet. Local output never reaches review unsupervised. |
| **Review Gate + AC owner** | **Opus** (review subagent) | Holds the AC derived from MERIDIAN-UI-SPEC.md (numbered rules in sections F–M). Reviews every work item's diff against AC + correctness + the repo's existing conventions. Verdicts: `PASS`, `FIX (list)`, `REJECT (reason)`. Nothing is assembled without a PASS. |

## Work item lifecycle

```
spec section → [Fable 5] decompose into item + AC refs + complexity (C-1/C-2/C-3)
            → route: C-1 → RWANG(local LLM) · C-2/C-3 → Sonnet 5
            → worker implements in this worktree (one item = one commit)
            → [Opus] review vs AC  ──FIX──▶ back to same worker (max 2 loops,
            → PASS                          then escalate to Sonnet 5 / Fable 5)
            → [Fable 5] assemble: integrate, verify build + interplay, final gate
            → push to feat/meridian-ui
```

## Rules

1. **One item, one commit.** Commit message: `meridian(<area>): <what>` + trailer `AC: <spec section refs>` + `Worker: sonnet-5 | local/<model> | fable-5`.
2. **Complexity routing (RWANG:Core C-scale):** C-1 = single-file, pattern-following → local. C-2 = multi-file, bounded design decisions → Sonnet 5. C-3 = architectural (horizon shell, thread overlay, command registry) → Sonnet 5 with a Fable 5 written brief; Fable 5 may implement directly when integration risk is high.
3. **Local LLM boundaries:** never touches `src-tauri/` (Rust), Zustand store contracts, or the command registry schema. On top of that, every local dispatch must satisfy Dispatch v2 eligibility E1–E6 (pure, single-file, computable acceptance, prompt < ~500 tokens, no security/money/API-contract scope). C-1 items that are not decomposable into eligible micro-tasks route to Sonnet 5; the orchestrator (not the local model) does the decomposition.
4. **Opus AC discipline:** reviews cite spec rule numbers (e.g. "violates H pointer-states: hover uses accent"). Style opinions without a spec/convention anchor are advisory, not blocking.
5. **Final gate checklist (Fable 5, before every push):** `npm run build` clean · lint clean · no `--color-accent` usage outside the allowed component list (spec M.2) · all six required states present for any new surface (spec H) · reduced-motion path exists for any new animation · **live-render check for any shell/layout-touching item** (dev server via `run-meridian.bat`, DOM-measure the affected geometry — jsdom tests cannot catch 0-height/track-collapse bugs; learned from item 3).
6. **Merge to `master`** only via PR from `feat/meridian-ui`, opened by Fable 5 after the phase's items all hold PASS.

## Phase 1 work breakdown (initial)

| # | Item | Spec AC | Complexity | Worker |
|---|---|---|---|---|
| 1 | Token extension in `src/styles/index.css` (phosphor ramp, hairline, motion, radii, z-scale) | I | C-1 | local (RWANG) |
| 2 | Strata shell + horizon splitter in `features/workspace` (CSS-var drag, detents, Tab/peek) | D, F, J.2, J.4 | C-3 | Sonnet 5 (Fable brief) |
| 3 | Stage row: fixed-height layout, ledger/inspector collapse rails | F.1, F.3 | C-2 | Sonnet 5 |
| 4 | JobChip + job ledger states (determinate meter, ETA, cancel, landed) | H states, M.5 | C-2 | Sonnet 5 |
| 5 | Rect registry + lineage Thread SVG overlay + `F` jump | E, L.3 | C-3 | Sonnet 5 (Fable brief) |
| 6 | Command registry unification (palette + context menu + shortcuts) | H, L.4 | C-3 | Sonnet 5 |
| 7 | Density modes (`data-density`, CSS vars) | G, L.7 | C-1 | Sonnet 5 (multi-file → fails E3; local only for any carved-out pure helpers) |
| 8 | Empty/error state copy pass across surfaces | H, M.6 | C-1 | Sonnet 5 (multi-file → fails E3) |
| 9 | Dissolve SystemPanels into the 28px status bar + drawers (its 8000px+ boundary content fights every stratum item) | E, F, J | C-2 | Sonnet 5 |
| 10 | **Browser-mode smoke-test infra — MUST use a real visible browser (headed Playwright, or vitest browser mode with a real window), NOT the CDP preview tab** (that tab reports `document.hidden===true` and rAF never fires: 0 callbacks in 1.4s, measured). Assert: shell height>0 + sky/ground proportional to ratio (item 3); JobChip timed flash-settle + accent→success + 8s auto-clear/hover-pin from a real job in a throwaway project (item 4); thread `d` endpoints track their articles after scroll/pan, primed thread reaches dashoffset 0 within the draw window, pills toggle hidden⇄shown as endpoints cross their band, draw-in fires once per selection change and is instant under reduced motion (item 5). Stand up before phase sign-off. | J (verify) | C-2 | Sonnet 5 |
| 11 | Lineage hardening (deferred from item-5 review; item 10 now exists to verify it): `visibilitychange` re-prime so a thread stuck primed-hidden self-heals; drop the redundant `mousemove` listener; scope pointer-move recompute to active drags (pointerdown→up) and to the graph/timeline scroll containers; narrow the capture-phase `keydown` catch-all to the layout-changing shortcuts. | L.3, M.10 | C-2 | Sonnet 5 |
| 12 | **Bug (found by item 10's e2e suite):** `FailureInspectorModal` (SystemPanels.tsx) auto-opens on any failed job and its Close button does not close it (fallback logic ignores the "closed" state). Violates spec H (error detail is an inline log excerpt, never modal) and J.7 (nothing blocks; the only modals are destructive confirms + first-run onboarding). Fold the failure detail into the JobChip's existing inline expandable log. | H, J.7, M.4 | C-2 | Sonnet 5 |
| 13 | **Bug (found by item 10's e2e suite):** `WelcomeModal` / `useModalA11y` focus-scrolls the whole document, so the modal's own close button lands at `y ≈ -157` and cannot be clicked. | K.1, K.2 | C-1 | Sonnet 5 |

Reviewed by Opus per item; assembled and gated by Fable 5 per phase.

**Status (2026-07-10):** items 1, 2, 3, 4, 5, 6, 10, 12, 13 = PASS + pushed. Remaining: 7 (density), 8 (empty/error copy), 9 (dissolve SystemPanels — do before 7), 11 (lineage hardening).

**Certification posture (learned the hard way, item-10 review):** e2e runs MUST use `CI=1` (`reuseExistingServer` is now `false` unconditionally). A stale HMR dev server was silently serving earlier "green" runs. A test that only `console.warn`s is not a gate: the original completed-chip flash test stayed green against the very dead-flash regression it existed to guard. Timing-sensitive proofs use `page.clock`, never a race against a real tween. Prove a new guard by breaking the code it guards and watching it go red.

**Known coverage gap (Tauri-only):** spec M.5's determinate-meter / anti-spinner rule for the live `rendering` job state has zero real-browser coverage — `pollRenderJobStatus`'s browser branch returns `completed` immediately and pause/resume are no-ops. Needs a Tauri-backed e2e variant.

**Phase-integration watch (item-5 review, advisory 4):** with the 248px stage row at the default 62/38 ratio, the visible sky/ground bands are only ~180px / ~111px, so on a fresh selection both lineage endpoints are usually *outside* their bands — the signature interaction then reads as "two edge pills + a clamped stub" rather than a thread rising through the horizon. Not a defect of any single item (item-3 layout + demo scroll state), but the phase must not sign off until a default selection shows a real thread. Candidate levers: a smaller default stage row, an auto-scroll-into-view on selection, or a different default detent.

## Carried review notes (from closed items — bind on the items named)

- **DONE — Item 3 (stage row):** folded PreviewPanel onto the horizon (5-row grid, fr-unit tracks). Closed.
- **DONE — Item 4:** activeView command-scoping resolved via `resolveStratumScope` (scope follows DOM focus, not horizon emphasis) — M.1 tension closed. The "Focus horizon splitter" / focus-region palette verb is **re-deferred to item 6** (no palette exists yet). draggingRef guard also landed in item 3.
- **Item 6 (command registry):** ship the "Focus horizon splitter" / focus-region palette verb (K.1 alternative for keyboard entry when focus rests on body). Rebind here.
- **Item 5 (lineage thread):** selection survives horizon flips (regression-tested); shell now has real geometry (item 3 landed). Use `[data-meridian-stage-row]` as the horizon-crossing reference and `[data-meridian-stratum]` tags (added in item 4) for endpoint resolution.
- **Open advisory, fold into any later shell-touching item:** global keydown doesn't check `draggingRef` — Ctrl+Arrow/backtick during a pointer-drag races the drag's DOM writes; minimal fix is an early-return when dragging. (item-2 review, advisory 2)
- **Accepted deviations (do not re-flag):** analytic easeOutQuart instead of the bezier token; two CSS vars (--meridian-sky/--meridian-ground); ArrowUp shrinks sky (spatial, not WAI-ARIA value convention); duplicate lazy(TimelineView) wrappers; `animate-pulse` 2s cadence vs spec H "1/s"; **lineage is `Clip → Node` via the existing `Clip.workflowNodeId`, not the spec's `Clip → Take → Output → Node`** — no Take model exists in the codebase and item 5 does not invent one (orchestrator decision, item-5 brief).

## Standing invariants for the lineage work (item 5+)

- The thread and `F` jump are **strictly observational**: they may select, focus, scroll-into-view, and slide the horizon. They must never create a node, mutate the project, or push undo history. In particular `showSelectedClipInWorkflow` **creates a workflow node when the clip has none** — never reuse it for the passive thread. A clip with `workflowNodeId === null` has no thread; silence is the correct answer.
- `Shift+F` (Takes drawer) is out of scope until a Take model exists.
