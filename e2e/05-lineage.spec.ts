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
    await page.addInitScript(() => {
      window.localStorage.clear()
      window.sessionStorage.clear()
    })
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
    // then fire several geometry-recompute triggers. Each `mouse.move` dispatches a pointermove/
    // mousemove that LineageThread's capture-phase listener funnels into its rAF-coalesced
    // `scheduleRecompute`; `runFor(20)` releases exactly that one frozen rAF so the recompute
    // actually runs. A recompute for a persisting (non-newly-appeared) pairing only rewrites
    // `strokeDasharray`, never `strokeDashoffset`, so a correctly-behaving thread stays pinned at
    // 0. (The earlier version of this test claimed "resize + a synthetic scroll" but only moved
    // the mouse — corrected here; mousemove alone exercises the same capture-phase path.)
    await freezeClock(page)
    for (let i = 0; i < 6; i += 1) {
      await page.mouse.move(200 + i * 10, 200)
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
