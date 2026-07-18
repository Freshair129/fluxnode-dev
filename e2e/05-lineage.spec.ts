import type { Page } from '@playwright/test'
import {
  DEMO_CLIP_ID,
  DEMO_NODE_ID,
  DEMO_THREAD_KEY,
  bootFreshWithClock,
  demoNodeLocator,
  dismissWelcomeModal,
  expect,
  freezeClock,
  horizonSplitterLocator,
  installFreshBootState,
  readComputedDashoffset,
  readThreadPathLength,
  selectDemoClip,
  stratumLocator,
  test,
  threadEdgeLocator,
} from './fixtures'

/**
 * MERIDIAN item 5 — lineage thread (spec E, L.3; LineageThread.tsx). Uses the demo project's
 * built-in linked pairing (`clip-video-01` -> `node-media-01`, src/domain/project/defaults.ts).
 *
 * On why the draw-in check reads `getComputedStyle(...).strokeDashoffset` and not
 * `pathEl.style.strokeDashoffset`: `primeThreadDrawIn` (LineageThread.tsx) sets the CSS
 * `transition` and then the *specified* inline `stroke-dashoffset` to `'0'` inside a
 * `requestAnimationFrame` callback — the specified value flips to 0 immediately, a full
 * `--dur-draw` (240ms) before the stroke visually finishes retracting. Only the *computed*
 * (used) value tracks the live, animating stroke — that's what "reaches 0 within the draw
 * window" has to mean for this assertion to be worth anything.
 *
 * On visibility: the phase-integration advisory in MERIDIAN-ORCHESTRATION.md notes that at the
 * default 62/38 stage-row ratio, a fresh selection's endpoints often land outside their strata's
 * visible bands (edge pills + a clamped stub, not a rising thread). Every test below explicitly
 * `scrollIntoViewIfNeeded()`s both endpoints before asserting on the drawn path, rather than
 * relying on the app's default scroll position — that's what the spec's underlying behavior (a
 * thread between two elements that are actually on screen) requires, independent of whatever the
 * demo project's initial scroll offsets happen to be today.
 */

async function bringBothEndpointsIntoView(page: Page) {
  await selectDemoClip(page)
  const node = demoNodeLocator(page)
  await node.scrollIntoViewIfNeeded()
  const clip = page.locator(`[data-meridian-clip-id="${DEMO_CLIP_ID}"]`)
  await clip.scrollIntoViewIfNeeded()
}

test.beforeEach(async ({ freshPage }) => {
  await dismissWelcomeModal(freshPage)
})

test.describe('lineage thread (item 5)', () => {
  test('selecting the linked clip draws a thread edge to its node', async ({ freshPage: page }) => {
    await expect(threadEdgeLocator(page)).toHaveCount(0)

    await bringBothEndpointsIntoView(page)

    await expect(threadEdgeLocator(page)).toHaveCount(1)
    await expect(threadEdgeLocator(page)).toHaveAttribute('data-meridian-thread-edge', DEMO_THREAD_KEY)
  })

  test('the draw-in tween completes: stroke-dashoffset reaches 0 within the draw window', async ({
    freshPage: page,
  }) => {
    await bringBothEndpointsIntoView(page)
    await expect(threadEdgeLocator(page)).toHaveCount(1)

    // dur-draw is 240ms; allow generous margin for the pre-animation rAF flush plus CI/headed
    // scheduling jitter without allowing a stalled/never-animating thread to pass.
    await expect
      .poll(() => readComputedDashoffset(page, '[data-meridian-thread-edge]'), {
        timeout: 700,
        message: 'thread should fully draw in (dashoffset -> 0) within ~500ms of appearing',
      })
      .toBeCloseTo(0, 0)
  })

  test('thread path endpoints track their articles after a scroll/pan', async ({ freshPage: page }) => {
    await bringBothEndpointsIntoView(page)
    const edge = threadEdgeLocator(page)
    await expect(edge).toHaveCount(1)
    await expect.poll(() => readComputedDashoffset(page, '[data-meridian-thread-edge]')).toBeCloseTo(0, 0)

    const dBefore = await edge.getAttribute('d')
    expect(dBefore).not.toBeNull()

    // Pan the ground (timeline) stratum's own scroll container — a plain scroll on any descendant
    // is caught by LineageThread's capture-phase `window` scroll listener regardless of bubbling.
    const groundScrollDelta = await stratumLocator(page, 'timeline').evaluate((el) => {
      const before = el.scrollTop
      el.scrollTop = before + 40
      el.dispatchEvent(new Event('scroll', { bubbles: false }))
      return el.scrollTop - before
    })

    if (groundScrollDelta === 0) {
      // The ground stratum isn't independently scrollable at this viewport/content size (nothing
      // to pan) — fall back to a window resize, which the same recompute path also listens for
      // (StrataShell/LineageThread), to still exercise "geometry changed -> path recomputes".
      await page.setViewportSize({ width: 1440, height: 940 })
      await page.setViewportSize({ width: 1440, height: 900 })
    }

    await expect
      .poll(async () => edge.getAttribute('d'), { message: 'path d should be recomputed after the pan/resize' })
      .not.toBe(dBefore)
  })

  /**
   * Item 11: the sky/workflow side of the re-scoped scroll guard — the CORE item-11 change on this
   * side. It must exercise the actual capture-phase `scroll` listener, so it scrolls the REAL inner
   * scroll container (WorkflowView's `relative h-full overflow-auto` div, ~line 887), NOT the
   * `[data-meridian-stratum="workflow"]` WRAPPER — the wrapper is `overflow-hidden` and cannot
   * scroll, which would silently no-op and let a resize fallback pass the assertion for the wrong
   * listener (round-1 review BLOCKING-2). There is deliberately NO resize fallback here: if the
   * scroll doesn't move geometry, this test must FAIL, not paper over it. Red-proof: deleting the
   * per-stratum `scroll` subscription in LineageThread.tsx makes `d` stay identical -> red.
   */
  test('thread path endpoints track their articles after a real scroll of the graph (workflow) inner container', async ({
    freshPage: page,
  }) => {
    await bringBothEndpointsIntoView(page)
    const edge = threadEdgeLocator(page)
    await expect(edge).toHaveCount(1)
    await expect.poll(() => readComputedDashoffset(page, '[data-meridian-thread-edge]')).toBeCloseTo(0, 0)

    const dBefore = await edge.getAttribute('d')
    expect(dBefore).not.toBeNull()

    // The WorkflowView canvas's own scroll container (fixed 720x980 inner content inside a shorter/
    // narrower viewport, so it genuinely overflows on at least one axis). Scroll whichever axis has
    // room; assert the scroll actually moved, so a non-scrolling container fails loudly instead of
    // masquerading as a passing scroll test.
    const scrollContainer = page.locator('[data-meridian-stratum="workflow"] .overflow-auto').first()
    const moved = await scrollContainer.evaluate((el) => {
      const beforeTop = el.scrollTop
      const beforeLeft = el.scrollLeft
      el.scrollTop = beforeTop + 60
      el.scrollLeft = beforeLeft + 60
      el.dispatchEvent(new Event('scroll', { bubbles: false }))
      return Math.abs(el.scrollTop - beforeTop) + Math.abs(el.scrollLeft - beforeLeft)
    })
    expect(moved, 'the graph inner container must actually scroll for this test to mean anything').toBeGreaterThan(0)

    await expect
      .poll(async () => edge.getAttribute('d'), {
        message: 'path d should be recomputed after scrolling the graph inner container',
      })
      .not.toBe(dBefore)
  })

  /** Item 11 hardening guard: a real node drag in the graph must keep the thread's node endpoint live. */
  test('thread path endpoint tracks a real node drag in the graph', async ({ freshPage: page }) => {
    await bringBothEndpointsIntoView(page)
    const edge = threadEdgeLocator(page)
    await expect(edge).toHaveCount(1)
    await expect.poll(() => readComputedDashoffset(page, '[data-meridian-thread-edge]')).toBeCloseTo(0, 0)

    const dBefore = await edge.getAttribute('d')
    expect(dBefore).not.toBeNull()

    const node = demoNodeLocator(page)
    const nodeBox = await node.boundingBox()
    expect(nodeBox).not.toBeNull()
    const startX = nodeBox!.x + nodeBox!.width / 2
    const startY = nodeBox!.y + nodeBox!.height / 2

    await page.mouse.move(startX, startY)
    await page.mouse.down()
    try {
      await page.mouse.move(startX + 140, startY + 90, { steps: 8 })

      await expect
        .poll(async () => edge.getAttribute('d'), { message: 'thread must track the node while it is being dragged' })
        .not.toBe(dBefore)
    } finally {
      await page.mouse.up()
    }
  })

  /**
   * Item 11 (review round 1, BLOCKING-1): a node-POSITION change must recompute the thread even
   * with NO scroll/drag/resize/keydown movement event and no `pairings` identity change — the
   * data-layer `useEffect([nodes, tracks])` in LineageThread.tsx is what covers it. `Ctrl+Z` on a
   * committed node move is the canonical failing case: `moveWorkflowNodes` -> `applyMutation
   * ('node.move')` is undoable, and item 5's blanket keydown listener used to catch the keyboard
   * undo by accident; item 11 narrowed that away, so without the data-layer effect the thread's
   * node endpoint would stay pointing at the moved-to location after the node snaps back. Red-proof:
   * remove that effect and the post-undo `d` stays equal to the moved `d`.
   */
  test('thread node endpoint follows the node back after Ctrl+Z undoes a node move', async ({ freshPage: page }) => {
    await bringBothEndpointsIntoView(page)
    const edge = threadEdgeLocator(page)
    await expect(edge).toHaveCount(1)
    await expect.poll(() => readComputedDashoffset(page, '[data-meridian-thread-edge]')).toBeCloseTo(0, 0)

    const dInitial = await edge.getAttribute('d')
    expect(dInitial).not.toBeNull()

    // Commit a real node move (drag, release). getDragDelta only commits past a small threshold, so
    // move well clear of it.
    const node = demoNodeLocator(page)
    const nodeBox = await node.boundingBox()
    expect(nodeBox).not.toBeNull()
    const startX = nodeBox!.x + nodeBox!.width / 2
    const startY = nodeBox!.y + nodeBox!.height / 2

    await page.mouse.move(startX, startY)
    await page.mouse.down()
    await page.mouse.move(startX + 160, startY + 110, { steps: 10 })
    await page.mouse.up()

    // After the committed move, `d` reflects the node's new location. (Dragging the node selects
    // the node and clears the clip selection, but `resolveLineagePairings` yields the identical
    // `clip::node` pairing key from the node side, so the same thread edge persists throughout.)
    await expect
      .poll(async () => edge.getAttribute('d'), { message: 'd should reflect the moved node' })
      .not.toBe(dInitial)
    const dMoved = await edge.getAttribute('d')
    expect(dMoved).not.toBeNull()

    // Undo via the keyboard. Do NOT click the canvas first — `selectNode(null)` from an empty-canvas
    // click would clear the selection and drop the thread. `global.undo` (Ctrl+Z) is a global
    // shortcut that fires regardless of DOM focus as long as focus isn't in an INPUT/TEXTAREA/SELECT
    // (it isn't after a node drag), so press it straight away.
    await page.keyboard.press('Control+z')

    // The node snaps back to its original position; the thread's node endpoint MUST follow — with
    // no scroll/drag/resize to heal it, only the data-layer [nodes, tracks] recompute can. Assert
    // the path returns to (essentially) its pre-move geometry, i.e. changes away from dMoved.
    await expect
      .poll(async () => edge.getAttribute('d'), {
        message: 'thread node endpoint must follow the node back after undo (data-layer recompute)',
      })
      .not.toBe(dMoved)
  })

  /** Item 11 hardening guard: dragging the horizon splitter (StrataShell's style-attribute rAF writes, caught by the MutationObserver) must keep the thread live too, not just resize/scroll. */
  test('thread path recomputes while dragging the horizon splitter', async ({ freshPage: page }) => {
    await bringBothEndpointsIntoView(page)
    const edge = threadEdgeLocator(page)
    await expect(edge).toHaveCount(1)
    await expect.poll(() => readComputedDashoffset(page, '[data-meridian-thread-edge]')).toBeCloseTo(0, 0)

    const dBefore = await edge.getAttribute('d')
    expect(dBefore).not.toBeNull()

    const splitter = horizonSplitterLocator(page)
    const splitterBox = await splitter.boundingBox()
    expect(splitterBox).not.toBeNull()
    const centerX = splitterBox!.x + splitterBox!.width / 2
    const centerY = splitterBox!.y + splitterBox!.height / 2

    await page.mouse.move(centerX, centerY)
    await page.mouse.down()
    try {
      await page.mouse.move(centerX, centerY - 80, { steps: 6 })

      await expect
        .poll(async () => edge.getAttribute('d'), {
          message: 'thread must track endpoints while the horizon is being dragged',
        })
        .not.toBe(dBefore)
    } finally {
      await page.mouse.up()
    }
  })

  /**
   * Item 11's core perf guard: pointermove recompute is now scoped to an active drag
   * (pointerdown -> up/cancel), not every hover. The thread's `d` attribute is a bad proxy for
   * "did a recompute run" here — recompute doesn't change the path's VALUE just because it ran
   * with nothing having moved, so a byte-identical `d` after hovering would pass even with the
   * old always-on listener. Instead this reads the dev-only counter LineageThread increments
   * inside its rAF-coalesced recompute (`window.meridianLineageRecomputeCount`,
   * `import.meta.env.DEV`-gated, see LineageThread.tsx) — a direct, breakable measurement of how
   * many times the expensive rect-registry re-read actually ran. The positive-control drag at the
   * end proves the counter itself is wired (isn't just permanently stuck at 0).
   */
  test('hovering the mouse with no button pressed schedules zero recomputes; an active drag schedules at least one', async ({
    freshPage: page,
  }) => {
    await bringBothEndpointsIntoView(page)
    await expect(threadEdgeLocator(page)).toHaveCount(1)
    await expect.poll(() => readComputedDashoffset(page, '[data-meridian-thread-edge]')).toBeCloseTo(0, 0)

    async function recomputeCount(): Promise<number> {
      return page.evaluate(() => (window as { meridianLineageRecomputeCount?: number }).meridianLineageRecomputeCount ?? 0)
    }

    const before = await recomputeCount()

    for (let i = 0; i < 10; i += 1) {
      await page.mouse.move(150 + i * 25, 200 + i * 10)
    }
    // No polling condition to wait on here by design (the assertion IS "nothing happened") — give
    // any (incorrectly) scheduled rAF a generous window past a single frame to actually run before
    // sampling.
    await page.waitForTimeout(100)
    expect(await recomputeCount(), 'hover-only pointermove must not schedule a recompute (item 11)').toBe(before)

    // Positive control, same test: a real drag DOES schedule recomputes -- proves the counter is
    // live and the assertion above isn't vacuously true because nothing could ever increment it.
    const splitter = horizonSplitterLocator(page)
    const splitterBox = await splitter.boundingBox()
    expect(splitterBox).not.toBeNull()
    const centerX = splitterBox!.x + splitterBox!.width / 2
    const centerY = splitterBox!.y + splitterBox!.height / 2

    await page.mouse.move(centerX, centerY)
    await page.mouse.down()
    try {
      await page.mouse.move(centerX, centerY + 30, { steps: 4 })
      await expect
        .poll(recomputeCount, { message: 'an active drag must schedule at least one recompute' })
        .toBeGreaterThan(before)
    } finally {
      await page.mouse.up()
    }
  })

  /**
   * Item 11 visibilitychange re-prime — HONEST LIMITATION, read before touching this test.
   *
   * A thread primed while the tab is genuinely backgrounded (`document.hidden`) should self-heal
   * once the tab is visible again, because browsers suspend `requestAnimationFrame` in background
   * tabs and `primeThreadDrawIn`'s one-shot tween-arming rAF may simply never fire. Real
   * `document.hidden` could NOT be driven in this harness — tried and confirmed unusable, not
   * skipped for convenience:
   *   1. `page.bringToFront()` on a second same-context page (Playwright's documented mechanism
   *      for this): probed in isolation (`page.evaluate(() => document.hidden)` before/after) —
   *      the original page's `document.hidden` stayed `false` the entire time. This
   *      `chromium-headed` project appears to give each Playwright `page` its own top-level OS
   *      window rather than tabs sharing one window, so there is no real tab-switch for the Page
   *      Visibility API to react to.
   *   2. CDP `Emulation.setVisibilityOverride`: the method does not exist on this Chromium's CDP
   *      surface (`'Emulation.setVisibilityOverride' wasn't found`).
   *   3. CDP `Page.setWebLifecycleState({state: 'frozen'})`: sends the page into a different
   *      lifecycle state (page freezing) that does not flip `document.hidden` either.
   * Per the task brief's own instruction for exactly this situation, this does NOT get faked with
   * a stubbed `document.hidden` getter. Two real things get tested instead:
   *   - The PURE detection logic (`isPrimedHiddenDashoffset`) is unit tested directly in
   *     `src/domain/project/lineageThread.test.ts` — no DOM, no visibility API, fully covered.
   *   - The listener WIRING is proven below, in the deterministic-clock describe block: the fake
   *     clock creates the exact "primed but the tween-arming rAF never ran" DOM state a real
   *     hidden-tab prime would leave behind (same mechanism the "primed fully-hidden" test above
   *     already uses), then a genuine `visibilitychange` DOM event is dispatched — the actual
   *     event LineageThread's production handler listens for — and the test asserts the handler
   *     unsticks it. What this does NOT prove is that a real backgrounded tab reliably sets
   *     `document.hidden`/suspends `rAF` in the first place — that's a browser platform contract,
   *     not this codebase's to verify, and it was exactly the piece this harness couldn't drive.
   */

  test('edge pills toggle hidden<->shown as an endpoint crosses its stratum band', async ({ freshPage: page }) => {
    await bringBothEndpointsIntoView(page)
    await expect(threadEdgeLocator(page)).toHaveCount(1)

    const nodePill = page.locator(
      `[data-meridian-thread-pill][data-meridian-endpoint-kind="node"][data-meridian-endpoint-id="${DEMO_NODE_ID}"]`,
    )

    // Both endpoints are on screen right now (bringBothEndpointsIntoView scrolled them there) ->
    // the node pill should be hidden (writePill sets `hidden = !visible`).
    await expect(nodePill).toBeHidden()

    // Scroll the sky (workflow) stratum so the node article moves out of its visible band.
    await stratumLocator(page, 'workflow').evaluate((el) => {
      el.scrollTop = el.scrollHeight
      el.dispatchEvent(new Event('scroll', { bubbles: false }))
    })

    await expect(nodePill).toBeVisible()

    // Scroll back — the pill should hide again once the node re-enters its band.
    await stratumLocator(page, 'workflow').evaluate((el) => {
      el.scrollTop = 0
      el.dispatchEvent(new Event('scroll', { bubbles: false }))
    })
    const node = demoNodeLocator(page)
    await node.scrollIntoViewIfNeeded()

    await expect(nodePill).toBeHidden()
  })

  test('prefers-reduced-motion: thread is fully drawn immediately, no tween', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await installFreshBootState(page)
    await page.goto('/')
    await dismissWelcomeModal(page)
    await bringBothEndpointsIntoView(page)

    await expect(threadEdgeLocator(page)).toHaveCount(1)

    // No tween expected at all — should already read 0 essentially immediately, well inside the
    // normal draw window (this is a tight bound specifically to prove there is NO animation, not
    // just a fast one).
    await expect
      .poll(() => readComputedDashoffset(page, '[data-meridian-thread-edge]'), { timeout: 150 })
      .toBeCloseTo(0, 0)

    const transition = await page.$eval(
      '[data-meridian-thread-edge]',
      (el) => (el as SVGPathElement).style.transition,
    )
    expect(transition).toBe('none')
  })
})

/**
 * Draw-in timing proofs that must not race the 240ms tween — own describe so they can boot with
 * the fake clock installed before navigation (bootFreshWithClock), which the freshPage-based
 * beforeEach above can't provide.
 *
 * The mechanism both tests exploit: `primeThreadDrawIn` (LineageThread.tsx) sets
 * `strokeDashoffset = <path length>` SYNCHRONOUSLY (fully hidden), then schedules the
 * transition-to-0 in a `requestAnimationFrame`. With the clock frozen, that rAF never fires, so
 * the primed, fully-hidden state (computed dashoffset === getTotalLength()) is held indefinitely
 * and can be asserted deterministically — no catching a value mid-tween. Empirically the frozen
 * ratio is 1.0000. (Driving the CSS transition itself to completion via the fake clock is NOT
 * reliable — Chromium's transition timeline doesn't advance cleanly under runFor — so completion
 * is verified by `resume()`-ing to real time and polling to 0, exactly as the real-clock
 * `draw-in tween completes` test above already does.)
 */
test.describe('lineage draw-in timing (item 5, deterministic via page.clock)', () => {
  test('the thread is primed fully-hidden (dashoffset === path length) BEFORE it draws in', async ({
    page,
  }) => {
    await bootFreshWithClock(page)

    // Freeze BEFORE the selection so the priming rAF is registered against a paused clock. The
    // React selection effect that primes the thread runs on microtasks/MessageChannel, not the
    // faked timers, so it still fires while the clock is frozen — only the follow-up rAF that
    // starts the tween is held.
    await freezeClock(page)
    await bringBothEndpointsIntoView(page)
    await expect(threadEdgeLocator(page)).toHaveCount(1)

    const pathLength = await readThreadPathLength(page, '[data-meridian-thread-edge]')
    const primedOffset = await readComputedDashoffset(page, '[data-meridian-thread-edge]')
    // Advisory 4: the FIRST selection must present the thread fully hidden (offset === length)
    // before any tween. A thread that skipped priming and sat statically at 0 would fail this,
    // which the weaker real-clock "reaches 0" test alone cannot distinguish.
    expect(pathLength).toBeGreaterThan(1)
    expect(primedOffset, 'primed thread must be fully hidden: dashoffset === path length').toBeCloseTo(
      pathLength,
      0,
    )

    // Release time and confirm it genuinely draws in to 0 (the tween runs on the real compositor
    // clock once resumed).
    await page.clock.resume()
    await expect
      .poll(() => readComputedDashoffset(page, '[data-meridian-thread-edge]'), { timeout: 1500 })
      .toBeCloseTo(0, 0)
  })

  /**
   * Item 11 visibilitychange re-prime, listener-wiring proof — see the long comment above the
   * (removed) real-visibility test in the describe block above for why genuine `document.hidden`
   * could not be driven in this harness. This reuses the exact same frozen-clock technique as the
   * "primed fully-hidden" test right above (freeze BEFORE selecting so the priming rAF that would
   * flip dashoffset -> 0 is registered but never runs) to produce the identical DOM state a real
   * hidden-tab prime would leave behind, then dispatches the actual `visibilitychange` event
   * LineageThread's production handler listens for, and asserts that handler unsticks it.
   */
  test('a genuine visibilitychange event resolves a stuck-primed thread to fully drawn', async ({ page }) => {
    await bootFreshWithClock(page)
    await freezeClock(page)
    await bringBothEndpointsIntoView(page)
    await expect(threadEdgeLocator(page)).toHaveCount(1)

    const pathLength = await readThreadPathLength(page, '[data-meridian-thread-edge]')
    const primedOffset = await readComputedDashoffset(page, '[data-meridian-thread-edge]')
    expect(pathLength).toBeGreaterThan(1)
    // Confirms the thread is genuinely stuck primed-hidden BEFORE the fix under test runs —
    // without this, a passing assertion below wouldn't distinguish "the handler unstuck it" from
    // "it was never stuck in the first place".
    expect(primedOffset, 'thread must start out stuck primed-hidden for this proof to mean anything').toBeCloseTo(
      pathLength,
      0,
    )

    await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')))

    const offsetAfter = await readComputedDashoffset(page, '[data-meridian-thread-edge]')
    expect(
      offsetAfter,
      'a visibilitychange event must resolve a stuck-primed thread to fully drawn (item 11)',
    ).toBeCloseTo(0, 0)
  })

  test('draw-in fires once per selection change, not on every geometry recompute', async ({ page }) => {
    await bootFreshWithClock(page)
    // Clock is installed but ticking at real rate here (bootFreshWithClock doesn't freeze), so the
    // initial draw-in completes normally.
    await bringBothEndpointsIntoView(page)
    await expect(threadEdgeLocator(page)).toHaveCount(1)
    await expect
      .poll(() => readComputedDashoffset(page, '[data-meridian-thread-edge]'))
      .toBeCloseTo(0, 0)

    // NEGATIVE proof — recomputes with NO selection change must not re-arm the draw-in. Freeze,
    // then fire several geometry-recompute triggers, each released by `runFor(20)` (exactly one
    // frozen rAF per iteration). A recompute for a persisting (non-newly-appeared) pairing only
    // rewrites `strokeDasharray`, never `strokeDashoffset`, so a correctly-behaving thread stays
    // pinned at 0.
    //
    // TRAP (item 11 carried note): this loop used to trigger recompute with bare
    // `page.mouse.move(...)`, relying on LineageThread's capture-phase `mousemove` listener.
    // Item 11 removes that listener AND scopes `pointermove` recompute to an active drag
    // (pointerdown -> up/cancel) — a bare mouse move with no button pressed is now a complete
    // no-op for LineageThread. Left as `mouse.move`, this loop would still pass, but for the
    // wrong reason: it would assert "nothing changed" while genuinely triggering nothing, the
    // same not-actually-testing-anything failure item 10's flash test hit. Rewritten to trigger
    // recompute via a genuine surviving source instead — a real `scroll` dispatched on the ground
    // (timeline) stratum, which item 11 explicitly keeps (scoped to the two
    // `[data-meridian-stratum]` wrappers instead of `window` — see LineageThread.tsx).
    await freezeClock(page)
    const ground = stratumLocator(page, 'timeline')
    for (let i = 0; i < 6; i += 1) {
      const delta = i % 2 === 0 ? 5 : -5
      await ground.evaluate((el, d) => {
        el.scrollTop += d
        el.dispatchEvent(new Event('scroll', { bubbles: false }))
      }, delta)
      await page.clock.runFor(20)
      const sample = await readComputedDashoffset(page, '[data-meridian-thread-edge]')
      expect(sample, 'dashoffset must stay settled at 0 across recomputes with no selection change').toBeCloseTo(
        0,
        0,
      )
    }

    // POSITIVE proof — a genuine selection change DOES re-arm. Deselect via ctrl+click on the
    // already-selected clip (TimelineView's additive-toggle removes an already-selected id from
    // `selectedClipIds`, which `resolveLineagePairings` reads; `Escape` wouldn't — spec J.7 has it
    // only close overlays, not clear selection), then reselect. `previousKeysRef` dropped the
    // pairing on deselect, so the reselect is a legitimately "newly appeared" pairing and must
    // re-prime from full length. Asserted while still frozen, so this is the primed value — not a
    // mid-tween sample that a fast machine could read as ~0 under load (the original BLOCKING-1
    // flake).
    const clip = page.locator(`[data-meridian-clip-id="${DEMO_CLIP_ID}"]`)
    await clip.click({ modifiers: ['Control'] })
    await expect(threadEdgeLocator(page)).toHaveCount(0)

    await clip.click()
    await expect(threadEdgeLocator(page)).toHaveCount(1)

    const pathLength = await readThreadPathLength(page, '[data-meridian-thread-edge]')
    const reArmedOffset = await readComputedDashoffset(page, '[data-meridian-thread-edge]')
    expect(reArmedOffset, 're-selecting must re-arm the draw-in from the full (fully-hidden) path length').toBeCloseTo(
      pathLength,
      0,
    )

    // Release and confirm the re-armed thread also completes its draw-in.
    await page.clock.resume()
    await expect
      .poll(() => readComputedDashoffset(page, '[data-meridian-thread-edge]'), { timeout: 1500 })
      .toBeCloseTo(0, 0)
  })
})
