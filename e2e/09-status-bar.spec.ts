import {
  demoNodeLocator,
  dismissWelcomeModal,
  expect,
  openExportSheet,
  selectDemoClip,
  shellLocator,
  statusBarLocator,
  stratumLocator,
  test,
  threadEdgeLocator,
} from './fixtures'

/**
 * MERIDIAN item 9 — dissolving `SystemPanels.tsx` into the 28px status bar (spec F wireframe) +
 * drawers/export sheet. Things this suite exists to prove, none of which vitest's
 * `renderToStaticMarkup` (no layout, no effects) can catch:
 *
 *  1. The bar really is 28px tall at the bottom of the workspace column, and each segment really
 *     opens the drawer/sheet it claims to (spec F: "each segment is a real <button> that opens the
 *     drawer that owns it").
 *  2. The drawers and export sheet are `aria-modal="true"` and, while open, the horizon Tab-flip
 *     and the `F` lineage jump are SUPPRESSED — trap and ARIA declaration must agree (spec J.7
 *     clarification, added after the item-9 review). `aria-modal` is the single rule
 *     `isOverlayOpen()` reads to suppress those shell interactions; this is what makes the whole
 *     scheme honest. (Round 1 wrongly shipped these as non-`aria-modal` and asserted the OPPOSITE
 *     — that Tab-flip "worked underneath" — a test that only passed because it escaped the focus
 *     trap by clicking with the pointer first.)
 *  3. The item-3 "SystemPanels capped to its own scrolling box" stopgap is really gone: the
 *     workspace column no longer has an oversized sibling stealing StrataShell's height.
 */

test.beforeEach(async ({ freshPage }) => {
  await dismissWelcomeModal(freshPage)
})

test.describe('status bar (item 9)', () => {
  test('renders at the spec F 28px height, at the bottom of the workspace column', async ({ freshPage: page }) => {
    const statusBar = statusBarLocator(page)
    await expect(statusBar).toBeVisible()

    const box = await statusBar.boundingBox()
    expect(box, 'status bar must have a layout box').not.toBeNull()
    expect(box!.height).toBe(28)

    const shellBox = await shellLocator(page).boundingBox()
    expect(shellBox).not.toBeNull()
    // Status bar sits below the shell in the workspace column.
    expect(box!.y).toBeGreaterThan(shellBox!.y + shellBox!.height - 1)
  })

  test('every segment is a real, keyboard-reachable button with an accessible name', async ({ freshPage: page }) => {
    const statusBar = statusBarLocator(page)
    const segmentIds = ['compute', 'connectivity', 'autosave', 'zoom', 'jobs', 'appUpdates', 'workspace', 'audio']

    for (const id of segmentIds) {
      const segment = statusBar.locator(`[data-meridian-statusbar-segment="${id}"]`)
      await expect(segment).toBeVisible()
      expect(await segment.getAttribute('type')).toBe('button')
      expect((await segment.getAttribute('aria-label'))?.length ?? 0).toBeGreaterThan(0)
    }
  })

  test('the connectivity drawer is aria-modal and closes via its own button and Escape', async ({
    freshPage: page,
  }) => {
    await page.locator('[data-meridian-statusbar-segment="connectivity"]').click()

    const drawer = page.getByRole('dialog', { name: 'Connectivity' })
    await expect(drawer).toBeVisible()
    // Round-2 fix: trap and declaration agree — the drawer IS aria-modal (spec J.7 clarification).
    expect(await drawer.getAttribute('aria-modal')).toBe('true')

    await page.getByRole('button', { name: 'Close Connectivity' }).click()
    await expect(drawer).toBeHidden()

    await page.locator('[data-meridian-statusbar-segment="connectivity"]').click()
    await expect(drawer).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(drawer).toBeHidden()
  })

  test('closing a drawer with Escape returns focus to the segment that opened it', async ({ freshPage: page }) => {
    const segment = page.locator('[data-meridian-statusbar-segment="audio"]')
    await segment.click()

    const drawer = page.getByRole('dialog', { name: 'Audio + Errors' })
    await expect(drawer).toBeVisible()
    // Focus is trapped inside the drawer while open (useModalA11y).
    expect(await drawer.evaluate((el) => el.contains(document.activeElement))).toBe(true)

    await page.keyboard.press('Escape')
    await expect(drawer).toBeHidden()

    // useModalA11y restores focus to the previously-focused element on unmount — a keyboard user
    // lands back on the segment they opened it from, not adrift on <body>.
    await expect(segment).toBeFocused()
  })

  test('the appUpdates, workspace, and audio segments open their own distinct drawers', async ({ freshPage: page }) => {
    await page.locator('[data-meridian-statusbar-segment="appUpdates"]').click()
    await expect(page.getByRole('dialog', { name: 'App Updates' })).toBeVisible()

    // Opening a different segment swaps the open drawer (single active secondary surface) rather
    // than stacking a second one.
    await page.locator('[data-meridian-statusbar-segment="workspace"]').click()
    await expect(page.getByRole('dialog', { name: 'App Updates' })).toBeHidden()
    await expect(page.getByRole('dialog', { name: 'Workspace Sync' })).toBeVisible()

    await page.locator('[data-meridian-statusbar-segment="audio"]').click()
    await expect(page.getByRole('dialog', { name: 'Workspace Sync' })).toBeHidden()
    await expect(page.getByRole('dialog', { name: 'Audio + Errors' })).toBeVisible()
  })

  test('clicking an open drawer\'s own segment again closes it (toggle)', async ({ freshPage: page }) => {
    const segment = page.locator('[data-meridian-statusbar-segment="connectivity"]')
    const drawer = page.getByRole('dialog', { name: 'Connectivity' })

    await segment.click()
    await expect(drawer).toBeVisible()
    await segment.click()
    await expect(drawer).toBeHidden()
  })
})

test.describe('export sheet (Ctrl+E, item 9)', () => {
  test('Ctrl+E opens the export sheet, it is aria-modal, and Escape closes it', async ({ freshPage: page }) => {
    await page.keyboard.press('Control+e')
    const sheet = page.getByRole('dialog', { name: 'Export' })
    await expect(sheet).toBeVisible()
    await expect(page.locator('section[aria-label="Export queue"]')).toBeVisible()
    await expect(page.locator('section[aria-label="Export preset"]')).toBeVisible()
    // Round-2 fix: the sheet declares itself modal (trap + declaration agree).
    expect(await sheet.getAttribute('aria-modal')).toBe('true')

    // Consistent with the command palette (Ctrl+K opens, Escape closes): a SECOND Ctrl+E is
    // correctly suppressed while the sheet is open — the same `!isOverlayOpen()` guard that now
    // sees the aria-modal sheet also gates the Ctrl+E shortcut — so the sheet closes via Escape
    // (owned by DrawerShell's topmost-only handler) or its own close button, not a re-press.
    await page.keyboard.press('Escape')
    await expect(sheet).toBeHidden()
  })

  test('the jobs status bar segment opens the same export sheet as Ctrl+E', async ({ freshPage: page }) => {
    await openExportSheet(page)
    await expect(page.getByRole('dialog', { name: 'Export' })).toBeVisible()
  })

  test('while the export sheet is open, the horizon Tab-flip is SUPPRESSED', async ({ freshPage: page }) => {
    const sky = stratumLocator(page, 'workflow')
    const ground = stratumLocator(page, 'timeline')

    async function skyFraction(): Promise<number> {
      const skyBox = await sky.boundingBox()
      const groundBox = await ground.boundingBox()
      return skyBox!.height / (skyBox!.height + groundBox!.height)
    }

    // Pristine sky (no prior selection) so the click below lands on a genuine Tab-flip *resting
    // target* (empty canvas → focus rests on body). This is the exact mechanic 03-layout's Tab-flip
    // test and the round-1 "works underneath" test both used to make the horizon FLIP — so any
    // failure to flip here is caused by suppression, not by the click missing a resting target.
    const beforeFraction = await skyFraction()

    await openExportSheet(page)
    const sheet = page.getByRole('dialog', { name: 'Export' })
    await expect(sheet).toBeVisible()

    // Escape the sheet's focus trap by pointer (the sheet has no backdrop-dismiss, so it stays
    // open), landing focus on the resting sky surface. Now the ONLY thing that can stop Tab from
    // flipping the horizon is `isOverlayOpen()` reading the sheet's `aria-modal="true"`. Round 1
    // asserted the OPPOSITE here (that the flip still worked) and was wrong; the red/green proof in
    // the round-2 report drops `aria-modal` and shows this assertion go red (the horizon flips).
    await sky.click({ position: { x: 10, y: 10 } })
    await expect(sheet).toBeVisible()

    await page.keyboard.press('Tab')
    // A horizon flip is a 200ms tween — wait well past it, then confirm the ratio never moved.
    await page.waitForTimeout(500)
    expect(await skyFraction(), 'Tab-flip must be suppressed while the aria-modal sheet is open').toBeCloseTo(
      beforeFraction,
      2,
    )
  })

  test('while a drawer is open, the F lineage jump is SUPPRESSED', async ({ freshPage: page }) => {
    // Select the demo CLIP (its linked node is not selected — the node's badge still shows its id,
    // not "selected"). An un-suppressed `F` follows the thread and calls selectNode on the linked
    // node, flipping that badge to "selected" (see followLineageThread → revealLineageEndpoint).
    await selectDemoClip(page)
    await expect(threadEdgeLocator(page)).toBeVisible()
    await expect(demoNodeLocator(page)).not.toContainText('selected')

    await page.locator('[data-meridian-statusbar-segment="audio"]').click()
    const drawer = page.getByRole('dialog', { name: 'Audio + Errors' })
    await expect(drawer).toBeVisible()

    // `F` fires from the drawer's own (trapped) focus straight to the window-level shortcut handler,
    // which gates `lineage.followThread` on `!isOverlayOpen()`. With the drawer `aria-modal`, F is
    // suppressed — the linked node is NOT selected. Dropping `aria-modal` lets F reach
    // followLineageThread, which selects the node and flips its badge to "selected": red. (The
    // demo node stays partially visible to the left of the right-anchored drawer, so its badge text
    // is readable throughout.)
    await page.keyboard.press('f')
    await page.waitForTimeout(400)
    await expect(demoNodeLocator(page)).not.toContainText('selected')
    await expect(threadEdgeLocator(page)).toHaveCount(1)
    await expect(drawer).toBeVisible()
  })
})

// NOTE (advisory 5 — palette discoverability of the four `status.open*Drawer` verbs): this is NOT
// covered here because the command palette can only be opened with Ctrl+K, and headed Chrome
// consumes Ctrl+K at the browser-chrome level before it reaches the page (verified empirically —
// which is also why no e2e in this repo exercises the palette at all; item 6's palette logic is
// unit-tested). The verbs' registration and wiring to `openStatusDrawer` are instead proven, red-
// and-green, in src/services/commands/command-registry.test.ts ("status.open*Drawer verbs").

test.describe('drawer z-order (item 9 round-3)', () => {
  test('an open drawer paints ABOVE a live lineage thread', async ({ freshPage: page }) => {
    // Make a lineage thread live (its full-viewport SVG overlay sits at `--z-thread`).
    await selectDemoClip(page)
    await expect(threadEdgeLocator(page)).toBeVisible()
    const threadSvg = page.locator('[data-meridian-thread]')
    await expect(threadSvg).toHaveCount(1)

    // Open a drawer (its root is at `--z-overlay`).
    await page.locator('[data-meridian-statusbar-segment="connectivity"]').click()
    const drawerRoot = page.locator('[data-meridian-drawer-root]')
    await expect(drawerRoot).toBeVisible()

    // Both are `position: fixed` in the root stacking context (the round-2 defect — the thread
    // painting OVER the drawer — is only possible because they compare by z-index there). An
    // `aria-modal`, focus-trapping surface must never be occluded by the decorative thread, so the
    // drawer's resolved z-index must be strictly greater. Returning DrawerShell to `--z-drawer`
    // (10 < the thread's 20) makes this go red — the red/green proof in the round-3 report.
    const drawerZ = await drawerRoot.evaluate((el) => Number(getComputedStyle(el).zIndex))
    const threadZ = await threadSvg.evaluate((el) => Number(getComputedStyle(el).zIndex))
    expect(Number.isFinite(drawerZ), 'drawer root must have a numeric z-index').toBe(true)
    expect(Number.isFinite(threadZ), 'thread overlay must have a numeric z-index').toBe(true)
    expect(drawerZ, 'the drawer must stack above the live lineage thread').toBeGreaterThan(threadZ)
  })
})

test.describe('workspace column geometry (item 9: no oversized scroll sibling)', () => {
  test('StrataShell owns the large majority of the workspace column height', async ({ freshPage: page }) => {
    const shellBox = await shellLocator(page).boundingBox()
    expect(shellBox).not.toBeNull()

    // 900px viewport minus header/status-bar chrome leaves roughly ~780-800px for the shell; the
    // old `max-h-56` (224px) SystemPanels sibling this item removed would have made this closer to
    // ~500-600px. A generous 700px floor catches that regression without pinning an exact number.
    expect(shellBox!.height).toBeGreaterThan(700)

    // The old 8000px+ SystemPanels content made the whole page scrollable by thousands of pixels;
    // with it gone the document should be within the same ballpark as the viewport. A generous
    // +100px tolerance absorbs the app's pre-existing ambient `min-h-screen` slack (documented in
    // 06-modals.spec.ts: "the document is independently scrollable by ~56px here, nothing to do
    // with the modal") without masking a real regression back toward thousands of pixels.
    const { scrollHeight, viewportHeight } = await page.evaluate(() => ({
      scrollHeight: document.documentElement.scrollHeight,
      viewportHeight: window.innerHeight,
    }))
    expect(scrollHeight).toBeLessThanOrEqual(viewportHeight + 100)
  })
})
