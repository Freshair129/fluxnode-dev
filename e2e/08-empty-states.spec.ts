import { dismissWelcomeModal, expect, openExportSheet, selectDemoClip, test } from './fixtures'

/**
 * MERIDIAN item 8 — empty/error state copy pass (spec H "Empty"/"Error" rows, M.6: "Every empty
 * state names the key that fixes it"). Covers a representative sample of the surfaces whose copy
 * this item changed, spanning four different components (stage-row monitor, a modal picker, a
 * status-bar sheet, and the workflow validation list is covered separately by
 * `src/domain/project/validators.test.ts` since it's a pure function, not layout-dependent).
 *
 * Each assertion below matches the EXACT new copy (not just "some text exists"), so reverting any
 * of item 8's copy changes turns the matching test red — proven by hand for the preview-monitor
 * and node-picker cases in the item-8 report.
 */

test.beforeEach(async ({ freshPage }) => {
  await dismissWelcomeModal(freshPage)
})

test.describe('Preview monitor empty state (item 8)', () => {
  test('names the fix ("select a clip") when the Timeline view has no selection, and clears once one is made', async ({
    freshPage: page,
  }) => {
    const monitor = page.locator('section[aria-label="Preview monitor"]')

    // The default demo project boots into the Workflow view; switch to Timeline via the Header's
    // real mode toggle (not a store poke) — Timeline starts with no clip selected.
    await page.getByRole('button', { name: 'Timeline view' }).click()

    await expect(monitor.getByText('No frame under playhead')).toBeVisible()
    await expect(monitor.getByText('Select a clip on the timeline to preview it here.')).toBeVisible()
    await expect(monitor.getByText('Nothing selected')).toBeVisible()

    // Selecting the demo clip is the named fix — the empty copy must disappear once it's applied.
    await selectDemoClip(page)
    await expect(monitor.getByText('No frame under playhead')).toHaveCount(0)
    await expect(monitor.getByText('Select a clip on the timeline to preview it here.')).toHaveCount(0)
  })

  test('names the fix ("select or connect a node") when the Workflow view has no node selected and nothing routed', async ({
    freshPage: page,
  }) => {
    const monitor = page.locator('section[aria-label="Preview monitor"]')
    const canvas = page.getByRole('region', { name: 'Workflow canvas' })

    // The default demo template already routes a node to Output, so the monitor isn't empty yet
    // even with no explicit selection — reach the true empty state via real UI actions: select
    // the Output node, disconnect its edges (both real "Node Actions" buttons), then deselect via
    // the canvas's own Escape handler (never poking the store directly).
    await page.getByRole('button', { name: 'Select Output' }).click()
    await page.getByRole('button', { name: 'Disconnect Edges' }).click()
    await canvas.focus()
    await page.keyboard.press('Escape')

    await expect(monitor.getByText('No frame under playhead')).toBeVisible()
    await expect(monitor.getByText('Select a node, or connect one to Output, to preview it here.')).toBeVisible()
    await expect(monitor.getByText('Nothing selected')).toBeVisible()
  })
})

test.describe('Workflow node picker empty search state (item 8)', () => {
  test('names the fix ("clear the search") when no node type matches, and clears once the search is cleared', async ({
    freshPage: page,
  }) => {
    await page.getByRole('button', { name: 'Add Node' }).click()
    const picker = page.getByRole('dialog', { name: 'Search and add a workflow node' })
    await expect(picker).toBeVisible()

    const search = picker.getByRole('textbox', { name: 'Search workflow node types' })
    await search.fill('zzz-not-a-real-node-type')

    await expect(
      picker.getByText('No node types matched “zzz-not-a-real-node-type”. Clear the search to see every node type again.'),
    ).toBeVisible()

    await search.fill('')
    await expect(picker.getByText('Clear the search to see every node type again.')).toHaveCount(0)
    // Clearing the search is the named fix: node type cards are back.
    await expect(picker.getByText('Node Type').first()).toBeVisible()
  })
})

test.describe('Export sheet empty queue state (item 8)', () => {
  test('names the fix ("Queue Render") when no render jobs are tracked, and clears once one is queued', async ({
    freshPage: page,
  }) => {
    await openExportSheet(page)
    const queueSection = page.locator('section[aria-label="Export queue"]')

    await expect(queueSection.getByText('No render jobs yet. Use Queue Render below.')).toBeVisible()

    await queueSection.getByRole('button', { name: 'Queue Render' }).click()
    await expect(queueSection.getByText('No render jobs yet. Use Queue Render below.')).toHaveCount(0)
    await expect(queueSection.getByText(/render job\(s\) tracked in the project queue\./)).toBeVisible()
  })
})
