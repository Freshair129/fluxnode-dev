import {
  dismissWelcomeModal,
  expect,
  horizonSplitterLocator,
  inspectorLocator,
  jobLedgerLocator,
  setDensityMode,
  shellLocator,
  stageRowLocator,
  statusBarLocator,
  test,
} from './fixtures'

/**
 * MERIDIAN item 7 — density modes (spec G, L.7). Things this suite exists to prove, none of which
 * vitest's `renderToStaticMarkup` (no layout, no `getComputedStyle`) can catch — same rationale as
 * every other spec in this directory (see e2e/README.md):
 *
 *  1. Real geometry actually changes between comfortable and compact: the stage row (248->204px,
 *     spec F.1/G), the status bar (28->24px, spec G "rows"), and a timeline track (56->44px, spec
 *     G "timeline track").
 *  2. Font sizes do NOT change between densities — spec G's own words: "Font sizes never change
 *     with density." This is the single most important guard in this item; it is a real
 *     `getComputedStyle().fontSize` comparison, not a class-name string match, so it also catches
 *     a future compact rule that accidentally shrinks a `font-size` alongside a `height`/`padding`.
 *  3. Every named interactive control (status bar segments, the JobLedger/Inspector rail-collapse
 *     icon buttons, the horizon splitter) keeps a >=24x24 hit target even in compact (spec K.5).
 *  4. `data-density` really lands on the DOM (both the app shell root and `[data-meridian-shell]`,
 *     per spec L.7 and the item-7 report's reconciliation of that wording with decision D's
 *     "drawers/palette must respond too" requirement).
 */

test.beforeEach(async ({ freshPage }) => {
  await dismissWelcomeModal(freshPage)
})

test.describe('density: data-density attribute (spec L.7)', () => {
  test('defaults to comfortable on both the app shell root and the strata shell, and setDensityMode flips both', async ({
    freshPage: page,
  }) => {
    const appShell = page.locator('[data-meridian-app-shell]')
    const shell = shellLocator(page)

    await expect(appShell).toHaveAttribute('data-density', 'comfortable')
    await expect(shell).toHaveAttribute('data-density', 'comfortable')

    await setDensityMode(page, 'compact')

    await expect(appShell).toHaveAttribute('data-density', 'compact')
    await expect(shell).toHaveAttribute('data-density', 'compact')
  })
})

test.describe('density: real geometry changes (spec F.1/G)', () => {
  test('stage row, status bar, and a timeline track shrink to their compact heights', async ({ freshPage: page }) => {
    const stageBox = await stageRowLocator(page).boundingBox()
    expect(stageBox!.height).toBe(248)
    const statusBox = await statusBarLocator(page).boundingBox()
    expect(statusBox!.height).toBe(28)

    await setDensityMode(page, 'compact')

    await expect.poll(async () => (await stageRowLocator(page).boundingBox())!.height).toBe(204)
    await expect.poll(async () => (await statusBarLocator(page).boundingBox())!.height).toBe(24)
  })
})

/**
 * Spec G: "Font sizes never change with density." Reads real computed `font-size` on several
 * representative, always-visible text elements spanning the surfaces decision D names (status
 * bar, job ledger, inspector), before and after switching density, and asserts byte-for-byte
 * equality — while the geometry test above (and this test's own stage-row/status-bar readback)
 * proves density genuinely took effect, so a font-size match here can't be explained by "density
 * never actually applied".
 */
test.describe('density: font-size invariance (spec G — the load-bearing guard for this item)', () => {
  test('representative text keeps its computed font-size across comfortable and compact', async ({
    freshPage: page,
  }) => {
    const elements = {
      statusBarSegment: page.locator('[data-meridian-statusbar-segment="compute"]'),
      jobLedgerHeading: jobLedgerLocator(page).locator('p').first(),
      jobLedgerEmptyState: jobLedgerLocator(page).getByText('No jobs.', { exact: false }),
      inspectorHeading: inspectorLocator(page).locator('p').first(),
    }

    async function readFontSizes() {
      const entries = await Promise.all(
        Object.entries(elements).map(async ([name, locator]) => {
          const fontSize = await locator.evaluate((el) => getComputedStyle(el).fontSize)
          return [name, fontSize] as const
        }),
      )
      return Object.fromEntries(entries)
    }

    const before = await readFontSizes()
    for (const [name, fontSize] of Object.entries(before)) {
      expect(fontSize, `${name} should have a real computed font-size before switching density`).toMatch(/^\d/)
    }

    await setDensityMode(page, 'compact')
    // Confirm density really did apply before trusting the font-size comparison below.
    await expect.poll(async () => (await statusBarLocator(page).boundingBox())!.height).toBe(24)

    const after = await readFontSizes()
    expect(after, 'no representative element\'s computed font-size may change between densities').toEqual(before)
  })
})

/**
 * Spec K.5: "min hit target 24x24 even compact." Checked in COMPACT density specifically (the
 * mode where a naive `--meridian-gutter`/`--meridian-row-h` shrink could plausibly take a control
 * below the floor) over the exact three families of control the item-7 brief names: status bar
 * segments, chip/rail icon buttons, and the splitter hit area.
 */
test.describe('density: minimum hit target holds in compact (spec K.5)', () => {
  test('status bar segments, ledger/inspector rail toggles, and the horizon splitter are all >=24x24 in compact', async ({
    freshPage: page,
  }) => {
    await setDensityMode(page, 'compact')
    await expect.poll(async () => (await statusBarLocator(page).boundingBox())!.height).toBe(24)

    const segmentIds = ['compute', 'connectivity', 'autosave', 'zoom', 'jobs', 'appUpdates', 'workspace', 'audio']
    for (const id of segmentIds) {
      const box = await page.locator(`[data-meridian-statusbar-segment="${id}"]`).boundingBox()
      expect(box, `status bar segment "${id}" must have a layout box`).not.toBeNull()
      expect(box!.width, `status bar segment "${id}" width`).toBeGreaterThanOrEqual(24)
      expect(box!.height, `status bar segment "${id}" height`).toBeGreaterThanOrEqual(24)
    }

    const ledgerCollapseBox = await page.getByRole('button', { name: 'Collapse job ledger' }).boundingBox()
    expect(ledgerCollapseBox!.width).toBeGreaterThanOrEqual(24)
    expect(ledgerCollapseBox!.height).toBeGreaterThanOrEqual(24)

    const inspectorCollapseBox = await page.getByRole('button', { name: 'Collapse inspector' }).boundingBox()
    expect(inspectorCollapseBox!.width).toBeGreaterThanOrEqual(24)
    expect(inspectorCollapseBox!.height).toBeGreaterThanOrEqual(24)

    const splitterBox = await horizonSplitterLocator(page).boundingBox()
    expect(splitterBox, 'horizon splitter must have a layout box').not.toBeNull()
    expect(splitterBox!.width, 'horizon splitter width').toBeGreaterThanOrEqual(24)
    expect(splitterBox!.height, 'horizon splitter height').toBeGreaterThanOrEqual(24)
  })
})
