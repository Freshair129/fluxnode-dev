# Browser-mode smoke tests (MERIDIAN item 10)

`npm run test:e2e` — headed Playwright specs that drive a real, visible, painting Chromium window
against the real Vite dev server (`npm run dev -- --port 5210 --strictPort`). This is a separate
suite from `npm run test` (vitest): vitest runs component/domain logic in Node and never opens a
browser; this suite only exercises things that need a real window.

## Why this exists — and why it must be headed

Items 3 (strata shell layout), 4 (JobChip states), and 5 (lineage thread) all shipped behavior
that the project's existing verification tools could not actually prove:

- **jsdom is not installed in this repo at all.** vitest's specs use `renderToStaticMarkup` (SSR),
  which runs `useState` initializers but **never runs `useEffect`** and has **no layout** (every
  `getBoundingClientRect()` is zero). Anything gated behind an effect or driven by real geometry —
  the horizon's rAF-driven drag/tween, the lineage thread's draw-in and endpoint tracking, the
  JobChip flash-then-settle timer — is invisible to those tests.
- **The CDP preview tab this team otherwise uses for live checks reports `document.hidden ===
  true`, and `requestAnimationFrame` never fires there** — measured: 0 callbacks in 1.4 seconds.
  Every rAF-driven behavior in this app is therefore unverifiable in that tab specifically, not
  because of any code defect but because the tab itself never paints.

So this suite runs **headed** (`headless: false` in `playwright.config.ts`) against a real OS
window. `00-guard.spec.ts` is the very first spec (file names sort it first) and asserts
`document.hidden === false` and that `requestAnimationFrame` actually fires (>=3 callbacks in
500ms). **If the guard spec goes red, every other result in this run is meaningless** — it means
the harness itself has regressed into the same hidden-tab trap, and nothing downstream should be
trusted until it's green again.

## Running it

```
npm run test:e2e        # headed, list reporter, single worker
npm run test:e2e:ui     # Playwright's interactive UI mode, for authoring/debugging
CI=1 npm run test:e2e   # certification run — see below
```

The `webServer` block in `playwright.config.ts` starts `vite --port 5210 --strictPort` itself and
waits for it to answer before running specs; you don't need (and must not rely on) a dev server
already running. `reuseExistingServer` is set to **`false`** unconditionally: Playwright always
starts its own fresh server and stops it at the end, so a stale bundle can never silently serve a
run (see the flakiness note below for the failure this prevents). Port 5210 was picked because
5199/5201 are in use elsewhere in this environment and 5173 is both an unrelated project's dev port
AND this repo's own `src-tauri/tauri.conf.json` `devUrl`.

**Certification runs must use `CI=1`.** It flips `forbidOnly` on (a stray `test.only` fails the
run instead of silently skipping the rest) and is the switch the review gate uses for a clean-room
run. Server reuse is already off regardless of `CI`, so `CI=1` is about `forbidOnly` and matching
the gate's invocation exactly. If a previous run was killed and left a process on 5210, this run
fails loudly at server start (`vite --strictPort` → port in use) rather than adopting it — kill
that process and re-run.

Traces/the HTML report are written to the OS temp directory (`playwright.config.ts`'s
`ARTIFACTS_DIR`), **not** anywhere inside this repo — see that file's header comment for why (Vite
watches the whole project root for HMR, and artifacts written inside the tree caused spurious
page-reload mid-test, which is exactly the kind of app-state-wiping event these tests exist to
guard against). On a failure, the printed trace path is a `.zip` you can open with
`npx playwright show-trace <path>`.

## What each spec guards

- **`00-guard.spec.ts`** — the harness itself. `document.hidden === false`; `requestAnimationFrame`
  fires at least 3 times in 500ms. Must pass before trusting anything else in this suite.
- **`03-layout.spec.ts`** (item 3, spec F rules 1-3) — the strata shell has real positive-area
  geometry; the stage row is pinned at exactly 248px regardless of horizon ratio; sky/ground track
  sizes are proportional to the horizon ratio (62/38 default, mirrors to 38/62 after `Tab`); the
  stage row's height never changes while the horizon splitter is actively being dragged.
- **`04-jobchips.spec.ts`** (item 4, spec H job-ledger states) — drives the real "Export Queue"
  panel (`SystemPanels.tsx`): Queue Render produces a real queued `RenderJob` with no bare
  spinner; Simulate Failure produces a danger-tone chip with an inline, non-modal, expandable log;
  completed chips auto-clear ~8s after landing unless hovered, in which case they're pinned. A
  separate describe — **`JobChip completed-chip flash (deterministic via page.clock)`** — proves
  the 400ms accent-flash-then-settle one-shot (spec H Success / M.10): it **freezes time**
  (`page.clock`) at the queued→completed transition and HARD-asserts the chip is in the accent
  flash tone (`data-meridian-jobchip-flashing="true"` + accent icon + `border-accent`) at that
  frozen instant, then steps the clock 400ms and asserts the settle to success. This is deliberate:
  the item-4 review's own defect was a *dead flash* (a chip that never flashed, straight into the
  settled success tone), and a test that only checks the settled end-state passes identically on
  that bug — so the flash presence must be asserted red-or-green at a frozen point where the timer
  provably hasn't fired. **Read the file's header comment** for why the `rendering` state's
  determinate meter cannot be produced through any real browser-only user action in this app (a
  traced, code-level fact — see the Tauri-only gap section below), and the bugs this spec's
  authoring uncovered (see "Bugs found" below).
- **`05-lineage.spec.ts`** (item 5, spec L.3) — selecting the demo project's linked clip
  (`clip-video-01` -> `node-media-01`) draws a `path[data-meridian-thread-edge]`; its
  `stroke-dashoffset` animates from full length to 0 within the draw window (asserted against
  `getComputedStyle`, not the inline `style` property — see the file header for why that
  distinction matters); the path's `d` endpoints recompute after a scroll/pan; an endpoint's edge
  pill toggles hidden/shown as it crosses its stratum's visible band; under
  `prefers-reduced-motion: reduce` the thread is fully drawn with no tween at all. A separate
  describe — **`lineage draw-in timing (deterministic via page.clock)`** — carries the two proofs
  that must not race the 240ms tween: (a) on the FIRST selection, with time frozen, the thread is
  *primed fully hidden* — computed `stroke-dashoffset === getTotalLength()` — BEFORE the tween runs
  (a thread that skipped priming and sat statically at 0 fails this, which the real-clock "reaches
  0" test alone cannot catch); and (b) the draw-in fires once per selection change — negatively,
  recomputes (`mousemove` → the capture-phase listener) with no selection change leave the frozen
  dashoffset pinned at 0; positively, deselect+reselect the same clip re-primes it to the full
  path length, asserted while frozen so it never depends on catching a value mid-tween.
- **`06-modals.spec.ts`** — regression guards for the two real defects this suite's authoring
  uncovered (see "Bugs found" below): the welcome modal's close button stays inside the viewport
  on mount and a real click dismisses it, and the whole card remains reachable by scrolling its
  backdrop; a failed render job raises no modal at all, while "Inspect Failure" opens the failure
  inspector and its close button (and `Escape`) genuinely close it, with a still-failed job left
  in the queue.

## `fixtures.ts`

Shared helpers, kept deliberately thin so each spec's assertions stay self-contained:

- `freshApp` fixture — clears `localStorage`/`sessionStorage` via `page.addInitScript` (runs
  before any page script, including the store's own boot-time `loadPersistedProject`) before
  navigating. This matters because in this app's browser-fallback mode (no Tauri runtime),
  `LocalProjectRepository` (`src/services/persistence/local-project-repository.ts`) really does
  persist the project to `localStorage` — without clearing it, one test queueing/failing a render
  would leak into the next test's "fresh ai-workflow demo project" assumption.
- `dismissWelcomeModal` — dismisses via `Escape` simply because that's the cheapest dismissal for
  the specs that just need the modal gone. The close button is clickable; `06-modals.spec.ts`
  asserts that directly, as the regression guard for the focus-scroll defect below.
- `bootFreshWithClock` / `freezeClock` — used by the timing-sensitive specs (the completed-chip
  flash; the thread prime/re-arm). `page.clock.install()` must run *before* `page.goto`, so those
  specs can't use the `freshPage` fixture (which navigates internally); `bootFreshWithClock` does
  the addInitScript + install + goto + dismiss in the right order. `install()` alone does NOT
  freeze time — it installs fake timers that keep ticking at the real rate — so `freezeClock`
  pauses them (`pauseAt(now + 2s)`, the 2s cushion covering the non-atomic read-then-pause) at the
  exact moment a spec needs to inspect a transient state. Advance with `page.clock.runFor(ms)` to
  fire a specific timer, or `page.clock.resume()` to release to real time. Note CSS-transition
  *completion* is verified after `resume()` under real time, not by stepping the fake clock —
  Chromium's transition timeline doesn't advance cleanly under `runFor`, but the JS-set primed
  state (dashoffset = length) and the JS `setTimeout` flash DO freeze/step deterministically, and
  those are what these specs assert.

## Bugs found while building this suite (all fixed)

These were found by actually driving the UI in a real window — none of them are visible to
`renderToStaticMarkup` SSR tests (no effects, no layout) or to a hidden/non-painting tab (no
scroll, no focus-driven layout). They were reported-but-not-fixed when this suite first landed
(item 10 was scoped to verification infra); they have since been fixed, and **`06-modals.spec.ts`
is the regression guard for all three**.

1. **Welcome modal auto-scrolled the whole page off-screen on mount**
   (`src/features/onboarding/WelcomeModal.tsx` + `src/features/settings/useModalA11y.ts`).
   `useModalA11y` called `.focus()` (default `preventScroll: false`) on the modal's first focusable
   element — the "Close welcome modal" button — on mount. The modal's card is taller than a 900px
   viewport (measured: 1319px of card) and was vertically centered with `items-center` inside an
   `overflow-hidden` ancestor, so the browser's native focus-scroll scrolled the outer **document**
   down to chase the focused button. Empirically the close button's own `getBoundingClientRect()`
   landed at `y ≈ -157` — genuinely unreachable by a normal click, with nothing able to scroll the
   page back.

   Fixed in two parts, because either alone is insufficient: `useModalA11y` now passes
   `{ preventScroll: true }` on its *initial* focus only (the Tab trap keeps default scrolling,
   where the scroll follows a keypress the user just made); and the modal's backdrop became the
   scroll container (`overflow-y-auto`) with the card centered via `my-auto` instead of
   `items-center`. Align-items centering pushes overflow out of **both** ends of a scroll
   container, so the card's header sat above the scroll origin where `scrollTop` can never reach
   it — auto margins collapse to 0 once the card overflows, keeping all of it reachable.

2. **`FailureInspectorModal` auto-opened on ANY failed render job, with no explicit "inspect"
   click** (`src/features/status/SystemPanels.tsx`). The render gate was
   `quotaErrors.length > 0 || inspectorJob`, and `inspectorJob` was derived as
   `queue.find(j => j.id === activeInspectorJobId) ?? [...queue].reverse().find(j =>
   j.errorCategory !== null) ?? null` — the second half of that fallback ignored
   `activeInspectorJobId` entirely, so as long as *any* job in `project.output.queue` had a
   non-null `errorCategory`, this `role="dialog" aria-modal="true"` panel rendered, unprompted.
   Conflicted with spec J.7 ("export/generation never modal-lock; only modals are destructive
   confirms + first-run onboarding") and spec H's own "never modal" callout for the job-ledger
   error row.

3. **That same modal's "Close failure inspector" button didn't close it**, for the same reason:
   its `onClick` only does `setActiveInspectorJobId(null)`, but the gate's fallback ignored that
   state once null and re-derived the same job from the queue on the very next render. Once any
   job had failed, the modal was effectively permanently open for the rest of the session.

   Both (2) and (3) are fixed by the same change: `activeInspectorJobId` is now the inspector's
   *only* open signal, with no fallback — it opens solely from the existing "Inspect Failure" /
   "Inspect" buttons, and closing it clears that id for good. Quota app-errors carry the failing
   job's id as `contextId` (`project-store.ts`), so the same id addresses both halves of the
   dialog and the quota-resolve action is still reachable from the "Inspect" button on a quota
   error row.

### The `items-center` modal-overflow class of bug

(1)'s second half was never specific to the welcome modal — every modal in this app centered its
card with `items-center` inside a non-scrolling backdrop, so any card that outgrew the viewport
became partly unreachable. The whole class is now fixed the same way (`overflow-y-auto` on the
backdrop, `my-auto h-fit` on the card): `WelcomeModal`, `SettingsModal`, `FailureInspectorModal`,
`WorkspaceSharingModal`, `ConfirmDialog`, and `PromptDialog`. `ShortcutsCheatSheet`,
`CommandPalette`, and `DrawerShell` were already safe — they cap the card with `max-h` and scroll
an inner region. The pattern is behavior-identical when the card fits, so it's safe to apply
uniformly.

Note the class has **two distinct symptoms**, and which one a given modal shows depends on its
ancestors — worth knowing before writing a guard for one:
- *header stranded above y=0* (WelcomeModal): needs a scrollable document plus the default
  focus-scroll to drag it. That half is what `preventScroll: true` addresses.
- *footer below the fold, nothing scrolls* (FailureInspectorModal): the backdrop's `scrollTop` is
  pinned at 0 because an overflowing `align-items: center` item spills outside the scroll range
  entirely. `06-modals.spec.ts` asserts this one on `scrollTop`, not on the header's `y`, since
  measured at a 420px viewport the inspector's close button sits harmlessly at y≈15.

**Still open — not this class, don't "fix" it with the same patch:** `WorkflowView`'s node picker
(`workflow-node-picker-title`) has a backdrop of `absolute inset-0` scoped to the *workflow
stratum*, so it dims only the graph area. Measured at 1440x900: a 548px card in a 295px backdrop,
spilling outside the dimmed region rather than being clipped (the backdrop is `overflow: visible`).
Making that backdrop a scroll container would confine the card to 295px and make it visibly worse.
The real fix is to decide whether that picker should cover the viewport (`fixed inset-0`, like the
inspector) — a stacking/visual-design call, not a mechanical one.

## Flakiness notes

- **This suite must not be run while other agents are actively editing files in the same shared
  worktree.** During authoring, a batch of failures was traced directly to `vite`'s dev-server HMR
  doing a **full page reload** mid-run in response to a concurrent worker's edits elsewhere in
  `src/` (observed: `[vite] (client) page reload src/features/commands/PaletteEmptyState.tsx`) —
  a reload at the wrong moment wipes the in-page app state (the welcome modal reappears, any
  queued/failed job vanishes) out from under a test that's mid-flight. This is not a defect in the
  harness or the app; it's an inherent hazard of multiple workers live-editing one shared worktree
  while a dev server watches it. A **partial** (non-full-reload) HMR update — observed as `[vite]
  (client) hmr update /src/app/App.tsx, /src/styles/index.css` from the same concurrent editing —
  did NOT reproduce this; only full reloads did. Re-running after the collision window passed
  produced a clean, repeatable full-suite pass (run back to back). **Corollary:** trust a
  certification run only if the `[WebServer]` logs show Playwright's OWN `vite` starting for that
  run (with `reuseExistingServer: false` it always should) and no `page reload src/...` lines
  appear mid-run.
- A related, easily-misread variant that USED to bite (now prevented by `reuseExistingServer:
  false`, review advisory 7): if a **stale `vite` from an earlier run was still listening on
  5210**, the old `reuseExistingServer` default silently reused it and served whatever bundle that
  process had — and it would restart itself (dropping every in-flight connection) whenever a
  concurrent worker touched `vite.config.ts` or `package.json`, scattering failures across
  unrelated specs. That is exactly what made some earlier "green" runs meaningless. Symptom, if you
  ever see it again: failures whose error is inside `fixtures.ts`'s `page.goto('/')` rather than in
  any assertion, plus a suspiciously *fast* pass on the 8s auto-clear test (a mid-test reload wipes
  the chip, so "the chip is gone" succeeds for the wrong reason — always sanity-check that test's
  duration is >8s). With reuse off, a leftover 5210 listener now fails the run loudly at server
  start instead; kill it and re-run.
- Playwright's own artifacts (traces, HTML report) are intentionally routed to the OS temp
  directory rather than anywhere inside the repo — see `playwright.config.ts`'s header comment.
  Early in authoring, routing them to a `.gitignore`d-but-in-tree path (`.tmp/playwright-results`)
  caused the *exact same* full-reload symptom as above, self-inflicted by this suite's own trace
  writes landing inside Vite's watched project root.
- Two specs are deliberately slow (~10s each): the completed-chip auto-clear (`JOB_LEDGER_AUTO_
  CLEAR_MS` = 8000ms) and hover-pin tests in `04-jobchips.spec.ts` poll past the 8s boundary with
  margin (up to 11s) rather than asserting at exactly 8s, to absorb scheduling jitter without
  masking a real regression (clearing far too early, or never clearing at all). These two use REAL
  time on purpose (they're about the ledger's real 1Hz tick + 8s wall-clock window); the flash and
  thread-timing specs instead freeze the clock precisely because racing real time there was the
  original flakiness/blind-spot (see below).
- **Why the flash and draw-in-timing specs freeze the clock instead of polling real time.** An
  earlier version of the flash test only `console.warn`ed if it missed the 400ms flash window and
  hard-asserted just the settled end-state — which a *dead-flash* regression satisfies identically
  (a chip that never flashes is already settled). And the earlier fires-once test read the
  re-armed dashoffset synchronously and asserted `> 1`, which raced the 240ms tween: under
  full-suite load the read landed after the tween finished and dashoffset was ~0 (this was the
  review's BLOCKING-1 — passed in isolation, failed at position 17 under load). Both are now
  frozen-clock, hard, red-or-green. Do NOT "fix" a future flake in these by loosening a bound or
  downgrading to a warning — freeze the relevant moment instead.

## Known Tauri-only gap (item 4 `rendering`/`paused`; spec M.5 anti-spinner rule has ZERO real-browser coverage)

Spec H's job-ledger table has six rows; this suite covers five of them for real
(empty/queued/failed/completed via the visibility rules, "no bare spinner" for queued). The sixth
— `rendering` (determinate meter + ETA + cancel) and, by extension, `paused` (which requires an
already-`rendering` job) — **cannot be produced by any real user action in a plain browser tab
with no Tauri runtime**, traced end to end in `04-jobchips.spec.ts`'s header comment:
`pollRenderJobStatus`'s browser-fallback branch (`src/services/ipc/render-job.ts`) unconditionally
returns `status: 'completed'`, and `pauseRenderJob`/`resumeRenderJob` are no-ops in that branch —
there is no code path, anywhere, that puts a job into `'rendering'` outside of a real Tauri backend
or a unit-test fixture that constructs a `RenderJob` object directly.

**The load-bearing consequence, called out explicitly:** spec **M.5** ("No indeterminate-only
spinners: JobChip must show determinate progress or queue position + elapsed") is verified in this
suite ONLY for the queued state (which shows position/elapsed and mounts no `role="progressbar"`).
Its harder half — that the *live rendering* chip shows a **determinate** meter with a real
`aria-valuenow` and never an indeterminate-only spinner — has **no real-browser coverage here**,
because that chip can't be reached in-browser. `RenderingChip`'s determinate `Meter`
(`role="progressbar"` + real `aria-valuenow`) is exercised only by the vitest component test
(`JobChip.test.tsx`, which hand-builds a `status:'rendering'` job) — SSR, no layout, no live
progress. Closing this gap for real needs a **Tauri-backed e2e variant** (drive the actual Rust
render queue so a job genuinely transitions queued→rendering→completed with incremental
`aria-valuenow`), which is out of item 10's scope.

Per the task brief, this suite does not stub the store to fake `rendering`; `04-jobchips.spec.ts`
instead asserts the ceiling itself (a queued job, refreshed, goes straight to `completed`, never
`rendering`) so a future regression toward "browser mode CAN now reach rendering" is caught and
that Tauri-backed variant can be added at the right layer.

## Known harness-only gap (item 9 command palette: `Ctrl+K` cannot be exercised in headed Chrome)

The command palette's ONLY keyboard entry point is `Ctrl+K` (spec H). In this suite's headed
Chromium, `Ctrl+K` is consumed by the browser chrome (the omnibox owns that chord) before it ever
reaches the page — so no spec here can open the palette by key, and in fact **no e2e in this repo
drives the palette at all** for this reason. This is a property of the *browser harness*, not the
app: the shipping target is a Tauri window with `decorations: false` and no omnibox, where `Ctrl+K`
reaches the page normally and the palette opens.

**The load-bearing consequence:** item 9 (round 2, advisory 5) added four palette verbs — `status.
openConnectivityDrawer` / `openAppUpdatesDrawer` / `openWorkspaceDrawer` / `openAudioDrawer` — so the
four status-bar drawers are Ctrl+K–discoverable like the export sheet. Because the palette can't be
opened in headed Chrome, these verbs' registration and their wiring to `openStatusDrawer` are proven
instead at the unit layer — red-and-green — in `src/services/commands/command-registry.test.ts` (the
"status.open*Drawer verbs" test asserts each command dispatches `openStatusDrawer` with its own
drawer id, plus the reach-classification count lock). Per the orchestrator's ruling, NO fake keyboard
workaround was added (dispatching a synthetic event that bypasses the browser-chrome interception
would test nothing real). Closing this gap end-to-end needs a **Tauri-backed e2e variant** (a real
window where `Ctrl+K` reaches the page), the same layer already noted for the M.5 rendering gap
above.
