import { expect, test } from '@playwright/test'

/**
 * MERIDIAN item 10 — the guard spec. Runs FIRST (file name sorts before every other spec) and
 * fails LOUDLY if the harness ever regresses into the same trap that made items 3/4/5 partially
 * unverifiable: the CDP preview tab this team otherwise uses for live checks reports
 * `document.hidden === true` and `requestAnimationFrame` never fires (0 callbacks measured in
 * 1.4s). Every rAF-driven behavior in this app — the horizon tween (StrataShell), the JobChip
 * landing flash (JobChip's mount-timer, itself not rAF but gated behind real timers that a hidden
 * tab can also throttle), and the lineage thread draw-in + live endpoint tracking (LineageThread)
 * — is unverifiable in an environment where this fails. If this spec goes red, every other spec's
 * results in this suite are meaningless and must not be trusted until it's green again.
 */

test.describe('browser harness guard', () => {
  test('the page is visible (not a hidden/background tab)', async ({ page }) => {
    await page.goto('/')

    const hidden = await page.evaluate(() => document.hidden)
    expect(hidden, 'document.hidden must be false — a hidden tab throttles/stops rAF and timers').toBe(false)

    const visibilityState = await page.evaluate(() => document.visibilityState)
    expect(visibilityState).toBe('visible')
  })

  test('requestAnimationFrame actually fires (>=3 callbacks in 500ms)', async ({ page }) => {
    await page.goto('/')

    const callbackCount = await page.evaluate(() => {
      return new Promise<number>((resolve) => {
        let count = 0
        const deadline = performance.now() + 500

        function tick(now: number) {
          count += 1
          if (now < deadline) {
            requestAnimationFrame(tick)
          } else {
            resolve(count)
          }
        }

        requestAnimationFrame(tick)
      })
    })

    // A real painting window comfortably clears 3 callbacks in 500ms at any reasonable refresh
    // rate (30 already gives ~15). The measured failure mode (CDP preview tab) is 0 callbacks in
    // 1.4s — the bar here is intentionally far below a healthy frame rate and far above the
    // observed-broken value, so this can't pass by accident in either direction.
    expect(callbackCount).toBeGreaterThanOrEqual(3)
  })
})
