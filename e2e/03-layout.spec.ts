import {
  dismissWelcomeModal,
  expect,
  horizonSplitterLocator,
  shellLocator,
  stageRowLocator,
  stratumLocator,
  test,
} from './fixtures'

/**
 * MERIDIAN item 3 — strata shell layout (spec F rules 1-3, L.1). Viewport is 1440x900 (spec F's
 * own reference size), which keeps `isCompactHeight` false in StrataShell.tsx (the 720px
 * breakpoint) so the plain 5-row grid template applies and the stage row is pinned at its
 * comfortable-density 248px (`STAGE_ROW_HEIGHT_PX`), not the compact-height 96px fallback.
 */

const STAGE_ROW_HEIGHT_PX = 248
const RATIO_TOLERANCE = 0.03

test.beforeEach(async ({ freshPage }) => {
  await dismissWelcomeModal(freshPage)
})

test.describe('strata shell layout (item 3)', () => {
  test('shell has real, positive-area geometry', async ({ freshPage: page }) => {
    const shellBox = await shellLocator(page).boundingBox()
    expect(shellBox, 'shell must have a layout box at all').not.toBeNull()
    expect(shellBox!.height).toBeGreaterThan(0)
    expect(shellBox!.width).toBeGreaterThan(0)
  })

  test('stage row is pinned at 248px regardless of horizon ratio', async ({ freshPage: page }) => {
    const stageBox = await stageRowLocator(page).boundingBox()
    expect(stageBox).not.toBeNull()
    expect(stageBox!.height).toBe(STAGE_ROW_HEIGHT_PX)
  })

  test('sky/ground track sizes are proportional to the horizon ratio (62/38 default, flips to 38/62)', async ({
    freshPage: page,
  }) => {
    const sky = stratumLocator(page, 'workflow')
    const ground = stratumLocator(page, 'timeline')

    async function skyFraction(): Promise<number> {
      const skyBox = await sky.boundingBox()
      const groundBox = await ground.boundingBox()
      expect(skyBox).not.toBeNull()
      expect(groundBox).not.toBeNull()
      const total = skyBox!.height + groundBox!.height
      return skyBox!.height / total
    }

    // Default detent is spec F.2's "default generate" — 62/38 sky/ground.
    await expect
      .poll(skyFraction, { message: 'sky fraction should settle at ~0.62 by default' })
      .toBeGreaterThan(0.62 - RATIO_TOLERANCE)
    const initialFraction = await skyFraction()
    expect(initialFraction).toBeLessThan(0.62 + RATIO_TOLERANCE)

    // Tab flips between the two default detents (spec F.2/H). Focus must be "at rest" for the
    // shell's global Tab handler to fire (StrataShell.isTabFlipRestingTarget) — click a plain,
    // non-focusable surface inside the sky first. Position (10,10) used to be the old workflow
    // header card's padding; the studio-chrome toolbar now puts the Add Node button there, so
    // target the status dock's plain header label instead.
    await sky.getByText('Workflow Status').click()
    await page.keyboard.press('Tab')

    // 200ms ease-out-quart tween (HORIZON_ANIMATION_MS) — poll past it with margin.
    await expect
      .poll(skyFraction, { timeout: 2000, message: 'sky fraction should settle at ~0.38 after Tab flip' })
      .toBeLessThan(0.38 + RATIO_TOLERANCE)
    const flippedFraction = await skyFraction()
    expect(flippedFraction).toBeGreaterThan(0.38 - RATIO_TOLERANCE)
  })

  test('stage row height never changes while dragging the horizon splitter', async ({ freshPage: page }) => {
    const splitter = horizonSplitterLocator(page)
    const splitterBox = await splitter.boundingBox()
    expect(splitterBox).not.toBeNull()

    const stageRow = stageRowLocator(page)
    const before = await stageRow.boundingBox()
    expect(before!.height).toBe(STAGE_ROW_HEIGHT_PX)

    const centerX = splitterBox!.x + splitterBox!.width / 2
    const centerY = splitterBox!.y + splitterBox!.height / 2

    await page.mouse.move(centerX, centerY)
    await page.mouse.down()

    const sampledHeights: number[] = []
    for (const offset of [-120, -60, 40, 90, -20]) {
      await page.mouse.move(centerX, centerY + offset, { steps: 5 })
      const box = await stageRow.boundingBox()
      sampledHeights.push(box!.height)
    }

    await page.mouse.up()

    for (const height of sampledHeights) {
      expect(height, 'stage row height must stay fixed while the splitter is being dragged').toBe(
        STAGE_ROW_HEIGHT_PX,
      )
    }

    const after = await stageRow.boundingBox()
    expect(after!.height).toBe(STAGE_ROW_HEIGHT_PX)
  })
})
