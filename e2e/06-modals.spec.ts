import { WELCOME_DIALOG_NAME, dismissWelcomeModal, expect, openExportSheet, test } from './fixtures'

/**
 * Regression guards for the two real defects uncovered while authoring this suite (both were
 * originally documented in e2e/README.md as found-but-not-fixed, then fixed):
 *
 *  A. `useModalA11y` (src/features/settings/useModalA11y.ts) focused the dialog's first focusable
 *     element on mount with the browser default `preventScroll: false`. WelcomeModal's card is
 *     taller than this suite's 900px viewport and was centered with `items-center` inside an
 *     `overflow-hidden` ancestor, so the native focus-scroll dragged the document down and left
 *     the card's own "Close welcome modal" button at y ≈ -157 — permanently unreachable by a real
 *     click, with nothing able to scroll it back.
 *
 *  B. `FailureInspectorModal` (relocated by item 9 to src/features/status/FailureInspectorModal.tsx,
 *     was in SystemPanels.tsx at the time this bug was found) derived its open state from
 *     `[...queue].reverse().find(job => job.errorCategory !== null)` whenever `activeInspectorJobId`
 *     was null. So it auto-opened on ANY failed job (spec J.7: exports never modal-lock), and its
 *     own close button — which only sets that id back to null — could never close it, because the
 *     fallback re-derived the same job on the very next render.
 *
 * Both are invisible to vitest (`renderToStaticMarkup` runs no effects and has no layout) — they
 * only exist once a real browser does real focus, scroll, and hit-testing.
 */

const EXPORT_QUEUE = 'section[aria-label="Export queue"]'

test.describe('WelcomeModal focus/scroll (bug A)', () => {
  test('mounting the modal does not scroll its own close button out of the viewport', async ({
    freshPage: page,
  }) => {
    const dialog = page.getByRole('dialog', { name: WELCOME_DIALOG_NAME })
    await expect(dialog).toBeVisible()

    const closeButton = page.getByRole('button', { name: 'Close welcome modal' })

    // The precise shape of the old bug: the button's own rect sat above the viewport's top edge.
    const box = await closeButton.boundingBox()
    expect(box, 'close button should have a layout box').not.toBeNull()
    expect(box!.y, 'close button must not be scrolled above the viewport top').toBeGreaterThanOrEqual(0)
    await expect(closeButton).toBeInViewport()

    // Initial focus still lands inside the dialog (the a11y behavior preventScroll must not break).
    await expect(closeButton).toBeFocused()

    // ...and that focus moved nothing. The document is independently scrollable by ~56px here
    // (ambient `min-h-screen` overflow, nothing to do with the modal), which is exactly the slack
    // the old default-`preventScroll:false` focus consumed on mount.
    expect(await page.evaluate(() => window.scrollY), 'mount focus must not scroll the document').toBe(0)

    // And a real, coordinate-dispatched click — the thing that used to fail actionability forever
    // with "element is outside of the viewport" — now dismisses the modal.
    await closeButton.click()
    await expect(dialog).toBeHidden()
  })

  test('the modal card stays fully reachable by scrolling its backdrop', async ({ freshPage: page }) => {
    const dialog = page.getByRole('dialog', { name: WELCOME_DIALOG_NAME })
    await expect(dialog).toBeVisible()

    // Precondition: the card really is taller than its backdrop, so this test is exercising the
    // overflow path rather than passing vacuously on a card that happens to fit. (Measured at this
    // suite's 1440x900 viewport: 1319px of card in a 956px backdrop.)
    const backdrop = dialog.locator('xpath=..')
    const { cardHeight, backdropHeight } = await dialog.evaluate((card) => ({
      cardHeight: card.getBoundingClientRect().height,
      backdropHeight: (card.parentElement as HTMLElement).clientHeight,
    }))
    expect(cardHeight, 'this test is meaningless unless the card overflows').toBeGreaterThan(backdropHeight)
    await expect(backdrop).toHaveCSS('overflow-y', 'auto')

    // The bottom-most control is reachable by scrolling the backdrop...
    const continueButton = page.getByRole('button', { name: 'Continue Current Project' })
    await continueButton.scrollIntoViewIfNeeded()
    await expect(continueButton).toBeInViewport()
    expect(
      await backdrop.evaluate((el) => el.scrollTop),
      'the backdrop, not the document, is the scroll container',
    ).toBeGreaterThan(0)

    // ...and so is the top. `items-center` centering pushed overflow above the scroll origin,
    // where scrollTop can never reach it; `my-auto` keeps the whole card inside the scroll range.
    const closeButton = page.getByRole('button', { name: 'Close welcome modal' })
    await closeButton.scrollIntoViewIfNeeded()
    await expect(closeButton).toBeInViewport()
    expect((await closeButton.boundingBox())!.y).toBeGreaterThanOrEqual(0)
  })
})

test.describe('FailureInspectorModal open/close contract (bug B)', () => {
  test.beforeEach(async ({ freshPage }) => {
    await dismissWelcomeModal(freshPage)
    await openExportSheet(freshPage)
  })

  test('a failed job never auto-opens the inspector, and Inspect/Close actually toggle it', async ({
    freshPage: page,
  }) => {
    const ledger = page.locator('[data-meridian-ledger]')

    await page.locator(`${EXPORT_QUEUE} button`, { hasText: 'Queue Render' }).click()
    await page.locator(`${EXPORT_QUEUE} button`, { hasText: 'Simulate Failure' }).click()
    await expect(ledger.locator('[data-meridian-jobchip="failed"]')).toBeVisible()

    // Spec J.7: a failure reports itself inline in the ledger; it never modal-locks the app.
    const inspector = page.getByRole('dialog', { name: /inspector/i })
    await expect(inspector).toHaveCount(0)

    // It opens only from an explicit click...
    await page.locator(`${EXPORT_QUEUE} button`, { hasText: 'Inspect Failure' }).click()
    await expect(inspector).toBeVisible()

    // ...and its own close button really closes it.
    await page.getByRole('button', { name: 'Close failure inspector' }).click()
    await expect(inspector).toBeHidden()

    // The load-bearing half of the old bug: the job is STILL in the queue, still failed. Under the
    // old fallback this is exactly the state that re-derived the job and reopened the modal on the
    // next render. Give React several frames to prove it stays shut.
    await expect(ledger.locator('[data-meridian-jobchip="failed"]')).toBeVisible()
    await page.waitForTimeout(500)
    await expect(inspector).toHaveCount(0)

    // Reopening still works after a close (the open signal wasn't left in a wedged state).
    await page.locator(`${EXPORT_QUEUE} button`, { hasText: 'Inspect Failure' }).click()
    await expect(inspector).toBeVisible()

    // Escape closes it too, and it stays closed.
    await page.keyboard.press('Escape')
    await expect(inspector).toBeHidden()
    await page.waitForTimeout(500)
    await expect(inspector).toHaveCount(0)
  })

  // The inspector shared WelcomeModal's old backdrop shape (`items-center`, no scroll container),
  // so it carried the same latent defect — though it strands a DIFFERENT element. Measured under
  // the old markup at this viewport: the close button sits fine at y≈15 (unlike WelcomeModal's
  // y≈-157, which came from the document focus-scroll that `preventScroll: true` now prevents).
  // What breaks here is the other end: the card's card grows with the failure's error text and
  // frame table, and once it outgrows the viewport its FOOTER actions ("Retry from failed frame")
  // fall below the fold with nothing able to scroll to them. So the load-bearing assertion below
  // is bottom-of-card reachability, not the header's y. A short viewport forces the overflow
  // deterministically, without needing a pathologically long error string.
  test('stays fully reachable at a viewport too short to hold its card', async ({ freshPage: page }) => {
    await page.setViewportSize({ width: 1440, height: 420 })

    await page.locator(`${EXPORT_QUEUE} button`, { hasText: 'Queue Render' }).click()
    await page.locator(`${EXPORT_QUEUE} button`, { hasText: 'Simulate Failure' }).click()
    await page.locator(`${EXPORT_QUEUE} button`, { hasText: 'Inspect Failure' }).click()

    const inspector = page.getByRole('dialog', { name: /inspector/i })
    await expect(inspector).toBeVisible()

    // Precondition: the card really does overflow at this height, so this isn't a vacuous pass.
    const backdrop = inspector.locator('xpath=..')
    const { cardHeight, backdropHeight } = await inspector.evaluate((card) => ({
      cardHeight: card.getBoundingClientRect().height,
      backdropHeight: (card.parentElement as HTMLElement).clientHeight,
    }))
    expect(cardHeight, 'this test is meaningless unless the card overflows').toBeGreaterThan(backdropHeight)

    // THE regression assertion: the footer action below the fold must be reachable, and reaching it
    // must scroll the BACKDROP — the modal's own scroll container. Under the old `items-center`
    // markup the backdrop's scrollTop stays pinned at 0 (verified: it's what fails first there),
    // because an overflowing `align-items: center` item spills outside the scroll range entirely.
    // Anything that appears to "reach" the footer then does so by scrolling the document out from
    // under a `fixed` modal — the same class of pathology as bug A, not a working scroll.
    const retryButton = page.getByRole('button', { name: /Retry from failed frame/i })
    await retryButton.scrollIntoViewIfNeeded()
    await expect(retryButton).toBeInViewport()
    expect(
      await backdrop.evaluate((el) => el.scrollTop),
      'the backdrop, not the document, is the scroll container',
    ).toBeGreaterThan(0)

    // And the header end stays reachable after scrolling back down-to-up, so the card is navigable
    // in both directions rather than trading one clipped end for the other.
    const closeButton = page.getByRole('button', { name: 'Close failure inspector' })
    await closeButton.scrollIntoViewIfNeeded()
    await expect(closeButton).toBeInViewport()
    expect((await closeButton.boundingBox())!.y).toBeGreaterThanOrEqual(0)

    await closeButton.click()
    await expect(inspector).toBeHidden()
  })
})
