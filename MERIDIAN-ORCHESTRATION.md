# MERIDIAN Orchestration Protocol

> Governs all work on `feat/meridian-ui` (worktree: `D:\fluxnode-worktrees\meridian-ui`).
> Acceptance criteria source: [docs/design/MERIDIAN-UI-SPEC.md](docs/design/MERIDIAN-UI-SPEC.md).

## Roles

| Role | Model / system | Responsibility |
|---|---|---|
| **Orchestrator + Final Gate + Assembler** | **Fable 5** (this pipeline's top level) | Decomposes the spec into work items, routes each item to a worker, integrates finished pieces, resolves conflicts, runs the final gate (build + lint + spec conformance + cross-item coherence) before anything merges toward `master`. |
| **Main worker A** | **Sonnet 5** (cloud subagent) | Implementation of C-2/C-3 items: new components, state logic, canvas work, anything touching more than one file or requiring design judgment. |
| **Main worker B** | **Local LLM** (Ollama, RTX 3060 12GB) | Implementation of C-1 items: mechanical edits, token/CSS application, test scaffolds, doc updates, repetitive refactors with a clear pattern. |
| **Local-LLM supervisor** | **RWANG** (`D:\rwang\RWANG`) | Owns every local dispatch: model selection per `config.json` role chains, VRAM serialization (unload before dispatch), prompt packaging, retry/abort on low-quality output, and returning a normalized diff + self-report to the orchestrator. Local output never reaches review unsupervised. |
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
3. **Local LLM boundaries:** never touches `src-tauri/` (Rust), Zustand store contracts, or the command registry schema. RWANG rejects items outside these boundaries back to the orchestrator instead of attempting them.
4. **Opus AC discipline:** reviews cite spec rule numbers (e.g. "violates H pointer-states: hover uses accent"). Style opinions without a spec/convention anchor are advisory, not blocking.
5. **Final gate checklist (Fable 5, before every push):** `npm run build` clean · lint clean · no `--color-accent` usage outside the allowed component list (spec M.2) · all six required states present for any new surface (spec H) · reduced-motion path exists for any new animation.
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
| 7 | Density modes (`data-density`, CSS vars) | G, L.7 | C-1 | local (RWANG) |
| 8 | Empty/error state copy pass across surfaces | H, M.6 | C-1 | local (RWANG) |

Reviewed by Opus per item; assembled and gated by Fable 5 per phase.
