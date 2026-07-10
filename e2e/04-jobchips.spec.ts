import { bootFreshWithClock, dismissWelcomeModal, expect, freezeClock, openExportSheet, test } from './fixtures'

/**
 * MERIDIAN item 4 — JobChip (spec H job-ledger states, M.5, M.10; src/features/status/JobChip.tsx
 * + JobLedger.tsx). Drives the REAL export-queue UI, relocated by item 9 into the `Ctrl+E` export
 * sheet (src/features/status/export/ExportSheet.tsx, same `aria-label="Export queue"` the pre-item-9
 * SystemPanels.tsx used) — "Queue Render", "Refresh Status", "Simulate Failure", etc. — no store
 * stubbing. Each test opens the sheet first via the status bar's "jobs" segment (`openExportSheet`
 * fixture helper) since, unlike the pre-item-9 SystemPanels layout, it is not visible by default.
 *
 * IMPORTANT — read before touching this file: one of the six spec-H job-ledger states this item
 * is supposed to cover (the `rendering` row: determinate meter + ETA + cancel) is IMPOSSIBLE to
 * reach from a real browser tab with no Tauri backend, and this is a fact about the app's code,
 * not a limitation of this harness. Traced end to end:
 *
 *   - `enqueueRender` (project-store.ts) always pushes a NEW job with `status: 'queued'`.
 *   - "Refresh Status" calls `refreshRenderStatuses`, which calls `pollRenderJobStatus` per queued
 *     job (src/services/ipc/render-job.ts). That function's `!isTauriRuntime()` branch — the only
 *     branch reachable in a plain Chromium tab — unconditionally returns
 *     `{ status: 'completed', progress: 100, ... }`. There is no intermediate `'rendering'` status
 *     anywhere in the browser-fallback path; a queued job goes straight to completed the moment
 *     you click Refresh.
 *   - Grepping the whole `src/` tree for `status: 'rendering'` / `status = 'rendering'` turns up
 *     ONLY test fixtures (`jobLedger.test.ts`, `JobChip.test.tsx`) that construct a `RenderJob`
 *     object directly — never a real code path.
 *
 * So: `RenderingChip`'s determinate `role="progressbar"` meter, and `PausedChip` (which requires
 * an already-`rendering` job to pause), are asserted ONLY as "not producible in this browser
 * context" below, per the task brief's instruction not to stub the store to fake it. Everything
 * else in spec H's table — queued (no bare spinner, M.5), failed (danger + inline non-modal log),
 * and completed (accent flash -> success settle, 8s auto-clear, hover-pin) — IS reachable through
 * the real UI and is asserted for real.
 */

const EXPORT_QUEUE = () => 'section[aria-label="Export queue"]'

test.beforeEach(async ({ freshPage }) => {
  await dismissWelcomeModal(freshPage)
  await openExportSheet(freshPage)
})

test.describe('JobChip (item 4)', () => {
  test('Queue Render produces a real queued RenderJob chip (no bare spinner)', async ({ freshPage: page }) => {
    const ledger = page.locator('[data-meridian-ledger]')
    await expect(ledger.getByText('No jobs. G regenerates the selected node.')).toBeVisible()

    await page.locator(`${EXPORT_QUEUE()} button`, { hasText: 'Queue Render' }).click()

    const queuedChip = ledger.locator('[data-meridian-jobchip="queued"]')
    await expect(queuedChip).toBeVisible()
    // M.5: queued state must show queue position/elapsed text, never a bare/indeterminate spinner
    // — and in particular must NOT render a Meter (role=progressbar) at all.
    await expect(queuedChip.getByText(/queued/i)).toBeVisible()
    await expect(queuedChip.locator('[role="progressbar"]')).toHaveCount(0)
  })

  test('confirms the browser-mode ceiling: a queued job never reaches "rendering"', async ({
    freshPage: page,
  }) => {
    const ledger = page.locator('[data-meridian-ledger]')
    await page.locator(`${EXPORT_QUEUE()} button`, { hasText: 'Queue Render' }).click()
    await expect(ledger.locator('[data-meridian-jobchip="queued"]')).toBeVisible()

    // "Refresh Status" is the only UI path that advances a queued job's status in this app. In a
    // real Tauri build it would poll toward incremental `rendering` progress; in this plain
    // browser tab (see file header) `pollRenderJobStatus`'s browser-fallback branch always
    // returns `completed` immediately. This is the sanctioned way to reach a completed chip
    // below, AND documents the exact ceiling: a determinate `rendering` meter can't be produced
        // here without stubbing the store, which the task brief forbids.
    await page.locator(`${EXPORT_QUEUE()} button`, { hasText: 'Refresh Status' }).click()

    await expect(ledger.locator('[data-meridian-jobchip="rendering"]')).toHaveCount(0)
    await expect(ledger.locator('[data-meridian-jobchip="completed"]')).toBeVisible()
  })

  test('Simulate Failure produces a danger-tone chip with an inline (non-modal) expandable log', async ({
    freshPage: page,
  }) => {
    const ledger = page.locator('[data-meridian-ledger]')
    await page.locator(`${EXPORT_QUEUE()} button`, { hasText: 'Queue Render' }).click()
    await expect(ledger.locator('[data-meridian-jobchip="queued"]')).toBeVisible()

    await page.locator(`${EXPORT_QUEUE()} button`, { hasText: 'Simulate Failure' }).click()

    const failedChip = ledger.locator('[data-meridian-jobchip="failed"]')
    await expect(failedChip).toBeVisible()
    // Danger tone (TONE_CHIP_CLASS.danger in JobChip.tsx) applied, not the neutral/accent/success ones.
    await expect(failedChip).toHaveClass(/border-danger/)

    // Inline, never modal (spec H Error row) — the JobChip's own log lives directly inside the
    // ledger `<aside>`, not behind any dialog/alertdialog wrapper. This is the regression guard for
    // the `FailureInspectorModal` auto-open bug this spec's authoring found (SystemPanels.tsx used
    // to derive its open state from "the last job with an errorCategory", so any failure modal-
    // locked the app in violation of spec J.7). 06-modals.spec.ts covers the inspector's own
    // open/close contract directly.
    //
    // This test's `beforeEach` opens the item-9 export sheet, which IS itself `role="dialog"`/
    // `aria-modal="true"` (round-2 fix — trap and declaration agree, spec J.7 clarification). So the
    // guard is that a failing job raises NO ADDITIONAL modal on top of it: exactly one
    // `[aria-modal="true"]` (the sheet) and specifically no failure-inspector dialog. A regression
    // that auto-opened the inspector on failure would make the aria-modal count 2 — red.
    await expect(page.locator('[aria-modal="true"]')).toHaveCount(1)
    await expect(page.getByRole('dialog', { name: /inspector/i })).toHaveCount(0)
    await expect(ledger.locator('[role="dialog"], [role="alertdialog"]')).toHaveCount(0)

    // Matches both "Show log" and "Hide log" (JobChip.tsx toggles the button's own accessible
    // name on expand/collapse) — a name filter pinned to "show log" would stop resolving the
    // instant the click below flips it to "Hide log".
    const showLogButton = failedChip.getByRole('button', { name: /log/i })
    await expect(showLogButton).toBeVisible()
    await expect(showLogButton).toHaveAttribute('aria-expanded', 'false')
    // A real, coordinate-dispatched pointer click: with no modal backdrop over the shell, the
    // browser's own hit-testing now delivers it to the button itself. (It previously had to be
    // dispatched via the DOM node directly to get under the inspector modal's z-40 backdrop.)
    await showLogButton.click()
    await expect(showLogButton).toHaveAttribute('aria-expanded', 'true')
    await expect(failedChip.getByText(/failed while encoding output frames/i)).toBeVisible()

    // Still inline, still not modal, even expanded.
    await expect(ledger.locator('[role="dialog"], [role="alertdialog"]')).toHaveCount(0)
  })

  test('a completed chip auto-clears after ~8s, but stays pinned while hovered', async ({ freshPage: page }) => {
    test.setTimeout(25_000)
    const ledger = page.locator('[data-meridian-ledger]')

    // Job A: will be left alone and must auto-clear.
    await page.locator(`${EXPORT_QUEUE()} button`, { hasText: 'Queue Render' }).click()
    await page.locator(`${EXPORT_QUEUE()} button`, { hasText: 'Refresh Status' }).click()
    const chipA = ledger.locator('[data-meridian-jobchip="completed"]').first()
    await expect(chipA).toBeVisible()

    // JOB_LEDGER_AUTO_CLEAR_MS is 8000ms, measured from `completedAt` (set by the browser-fallback
    // poll response), not from when this test happens to observe the chip — poll with margin
    // above 8s to absorb scheduling jitter without masking a real regression (e.g. clearing at 2s
    // or never clearing at all).
    await expect
      .poll(async () => (await ledger.locator('[data-meridian-jobchip="completed"]').count()) === 0, {
        timeout: 11_000,
        intervals: [250],
        message: 'completed chip should auto-clear ~8s after landing',
      })
      .toBe(true)
  })

  test('hovering a completed chip pins it past the 8s auto-clear window', async ({ freshPage: page }) => {
    test.setTimeout(25_000)
    const ledger = page.locator('[data-meridian-ledger]')

    await page.locator(`${EXPORT_QUEUE()} button`, { hasText: 'Queue Render' }).click()
    await page.locator(`${EXPORT_QUEUE()} button`, { hasText: 'Refresh Status' }).click()
    const chip = ledger.locator('[data-meridian-jobchip="completed"]').first()
    await expect(chip).toBeVisible()

    await chip.hover()
    await expect(chip.getByText(/pinned/i)).toBeVisible()

    // Hold the hover well past the 8s auto-clear boundary; the chip must still be present the
    // whole time because `selectVisibleLedgerJobs` exempts hovered jobs from the clear filter.
    await page.waitForTimeout(9_000)
    await expect(chip).toBeVisible()

    // Now release hover and confirm it clears promptly afterward (the 1Hz ledger tick re-checks
    // visibility on its next tick, at most ~1s later).
    await page.mouse.move(0, 0)
    await expect
      .poll(async () => (await ledger.locator('[data-meridian-jobchip="completed"]').count()) === 0, {
        timeout: 3_000,
        message: 'un-hovering a stale completed chip should let it clear on the next ledger tick',
      })
      .toBe(true)
  })
})

/**
 * The completed-chip flash (spec H Success row: "400ms accent flash ... settles"; M.10: one-shot
 * ≤400ms) gets its OWN describe so it can boot with the fake clock installed before navigation
 * (see bootFreshWithClock) — it can't share the freshPage-based beforeEach above, which navigates
 * without the clock.
 *
 * Why this must freeze time and HARD-assert the flash present: the item-4 review's own BLOCKING-1
 * was a dead flash — `CompletedChip` guarded the flash behind a `prevStatusRef` check that, because
 * the chip fresh-MOUNTS on the queued->completed transition, was always already 'completed' on its
 * sole effect run, so it never flashed and rendered straight into the settled success tone. A test
 * that only asserts the SETTLED end-state (flashing attribute absent, success icon shown, no accent
 * icon) is satisfied *identically* by that dead-flash bug — it cannot tell "flashed then settled"
 * from "never flashed". So the flash presence itself must be asserted, red-or-green, at a frozen
 * instant where the 400ms timer provably hasn't fired yet.
 */
test.describe('JobChip completed-chip flash (item 4, deterministic via page.clock)', () => {
  test('mounts in the accent flash tone, then settles to success after 400ms', async ({ page }) => {
    await bootFreshWithClock(page)
    await openExportSheet(page)
    const ledger = page.locator('[data-meridian-ledger]')

    // Freeze BEFORE producing the completion, so the CompletedChip's mount-time setTimeout(400ms)
    // is registered against a paused clock and cannot fire until we step it forward ourselves.
    await freezeClock(page)

    await page.locator(`${EXPORT_QUEUE()} button`, { hasText: 'Queue Render' }).click()
    await expect(ledger.locator('[data-meridian-jobchip="queued"]')).toBeVisible()
    await page.locator(`${EXPORT_QUEUE()} button`, { hasText: 'Refresh Status' }).click()

    const completedChip = ledger.locator('[data-meridian-jobchip="completed"]')
    await expect(completedChip).toBeVisible()

    // HARD assertion (the whole point): at this frozen instant the flash timer has NOT fired, so
    // the chip MUST be in the flashing/accent tone. A dead-flash regression makes all three of
    // these false from the start, turning the test red.
    await expect(completedChip).toHaveAttribute('data-meridian-jobchip-flashing', 'true')
    await expect(completedChip).toHaveClass(/border-accent/)
    await expect(completedChip.locator('svg.text-accent')).toHaveCount(1)
    await expect(completedChip.locator('svg.text-success')).toHaveCount(0)

    // Advance exactly past JOB_LEDGER_FLASH_MS (400) — one motion event, one-shot (M.10). The
    // ledger's own 1Hz tick (1000ms) does NOT fire inside this 400ms step, so the chip can't
    // auto-clear here; only the flash timer fires.
    await page.clock.runFor(400)

    // Settled: the app REMOVES the attribute when not flashing (`flashing || undefined` in
    // CompletedChip), so assert it's absent (any-value regex under `.not`), plus the success tone
    // in and the accent tone out.
    await expect(completedChip).not.toHaveAttribute('data-meridian-jobchip-flashing', /.*/)
    await expect(completedChip.locator('svg.text-success')).toHaveCount(1)
    await expect(completedChip.locator('svg.text-accent')).toHaveCount(0)
  })
})
