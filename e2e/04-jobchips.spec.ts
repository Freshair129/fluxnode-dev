import { bootFreshWithClock, dismissWelcomeModal, expect, freezeClock, openExportSheet, test } from './fixtures'

/**
 * MERIDIAN item 4 — JobChip (spec H job-ledger states, M.5, M.10; src/features/status/JobChip.tsx
 * + JobLedger.tsx). Drives the REAL export-queue UI, relocated by item 9 into the `Ctrl+E` export
 * sheet (src/features/status/export/ExportSheet.tsx, same `aria-label="Export queue"` the pre-item-9
 * SystemPanels.tsx used) — "Queue Render", "Refresh Status", "Simulate Failure", etc. — no store
 * stubbing. Each test opens the sheet first via the status bar's "jobs" segment (`openExportSheet`
 * fixture helper) since, unlike the pre-item-9 SystemPanels layout, it is not visible by default.
 *
 * IMPORTANT — read before touching this file: as of the G-03 fix (project-store.ts `enqueueRender`,
 * services/ipc/render-job.ts, services/ipc/export-job.ts), "Queue Render" in a plain browser tab
 * with no Tauri backend no longer creates a job at all — it pushes an accurate error instead. That
 * closed a real correctness bug (browser mode used to silently fabricate `status: 'completed'` on
 * every queued job the moment "Refresh Status" was clicked — see the git history around G-03 for the
 * full trace — which was actively misleading and, per the project's own performance-evidence audit,
 * had been cited as if it were real render proof). The consequence for THIS spec is large: FIVE of
 * spec H's six job-ledger states — `queued`, `rendering`, `paused`, `failed`, `completed` — are now
 * ALL unreachable from a real browser tab with no Tauri backend, not just `rendering`/`paused` as
 * this file used to document. `getActiveRenderJob` (the target of "Simulate Failure" / "Simulate GPU
 * OOM" / "Simulate Quota") requires an existing `queued` or `rendering` job in `project.output.queue`
 * — with `enqueueRender` refusing outright in browser mode, that queue never gets a first entry, so
 * none of the "Simulate *" debug buttons have anything to act on either.
 *
 * Per the task brief this suite was authored under, it does not stub the store to fake these states
 * (see fixtures.ts's header comment) — so, correctly, none of them can be exercised here any more.
 * The tests below that verify them are `test.skip`, not deleted or rewritten to fake it, so a) the
 * intended coverage stays visible and re-enablable, and b) nothing in this file quietly asserts
 * behavior that no longer exists. Closing this for real needs a Tauri-backed e2e variant (drive the
 * actual Rust render queue so a job genuinely reaches every state) — out of this item's scope, same
 * conclusion the file already reached for `rendering`/`paused` before this fix widened it.
 *
 * What DOES still have real coverage here: that clicking "Queue Render" in this environment tells
 * the user the truth (no job appears; a clear "desktop app required" error does) rather than lying.
 */

const EXPORT_QUEUE = () => 'section[aria-label="Export queue"]'

test.beforeEach(async ({ freshPage }) => {
  await dismissWelcomeModal(freshPage)
  await openExportSheet(freshPage)
})

test.describe('JobChip (item 4)', () => {
  test('Queue Render in browser mode reports the truth: no job, a clear desktop-required error', async ({
    freshPage: page,
  }) => {
    const ledger = page.locator('[data-meridian-ledger]')
    await expect(ledger.getByText('No jobs. G regenerates the selected node.')).toBeVisible()

    await page.locator(`${EXPORT_QUEUE()} button`, { hasText: 'Queue Render' }).click()

    // The bug this guards against: browser mode used to push a `status: 'queued'` job that then
    // silently fabricated `'completed'` on refresh. Now nothing is queued at all.
    await expect(ledger.locator('[data-meridian-jobchip]')).toHaveCount(0)
    // ErrorToasts.tsx — the floating toast stack, not a form control, hence a raw selector rather
    // than getByLabel (which targets labelled form controls).
    await expect(page.locator('[aria-label="Error notifications"]')).toContainText(/desktop app/i)
  })

  test('Simulate Failure produces a danger-tone chip with an inline (non-modal) expandable log', async ({
    freshPage: page,
  }) => {
    test.skip(
      true,
      'Requires an existing queued job in project.output.queue. As of the G-03 fix, "Queue Render" ' +
        'never creates one in browser mode (see this file\'s header comment) — needs a Tauri-backed ' +
        'e2e variant to seed a real job.',
    )
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
    test.skip(
      true,
      'Requires a real completed job. As of the G-03 fix, "Refresh Status" no longer fabricates ' +
        '`completed` in browser mode (that fabrication was the bug) — needs a Tauri-backed e2e variant.',
    )
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
    test.skip(
      true,
      'Requires a real completed job. As of the G-03 fix, "Refresh Status" no longer fabricates ' +
        '`completed` in browser mode (that fabrication was the bug) — needs a Tauri-backed e2e variant.',
    )
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
    test.skip(
      true,
      'Requires a real completed job. As of the G-03 fix, "Refresh Status" no longer fabricates ' +
        '`completed` in browser mode (that fabrication was the bug) — needs a Tauri-backed e2e variant.',
    )
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
