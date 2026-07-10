import { test as base, expect, type Page } from '@playwright/test'

/**
 * Shared Playwright fixtures/helpers for the MERIDIAN item-10 smoke suite. Kept deliberately thin
 * — real interactions live in the specs themselves so each assertion's provenance stays visible
 * in its own file (per the task brief: don't stub/fabricate, drive the real UI).
 */

/**
 * `LocalProjectRepository` (src/services/persistence/local-project-repository.ts) persists the
 * project to `localStorage` under `fluxnode.currentProjectPath` in browser-fallback mode (no
 * Tauri runtime). Left alone, a project created/mutated by one test (e.g. queueing a render) would
 * carry over into the next test's fresh `page.goto` via that persisted path, breaking the
 * "app.\+/ is always the fresh ai-workflow demo project" assumption every other spec relies on.
 * `addInitScript` runs before ANY page script (including the store's own `loadPersistedProject`
 * call on mount), so clearing storage here — not just after load — is what actually guarantees a
 * clean `createDefaultProject()` boot every time.
 */
export const test = base.extend<{ freshPage: Page }>({
  freshPage: async ({ page }, use) => {
    await page.addInitScript(() => {
      window.localStorage.clear()
      window.sessionStorage.clear()
    })
    await page.goto('/')
    await use(page)
  },
})

export { expect }

/** The demo project's default linked pairing (src/domain/project/defaults.ts). */
export const DEMO_CLIP_ID = 'clip-video-01'
export const DEMO_NODE_ID = 'node-media-01'
export const DEMO_THREAD_KEY = `${DEMO_CLIP_ID}::${DEMO_NODE_ID}`

/**
 * Dismisses the welcome modal (shown on every fresh boot — src/features/onboarding/WelcomeModal.tsx
 * has no persisted "seen" flag) via `Escape`, WITHOUT calling `applyTemplate` — dismissal keeps
 * the `createDefaultProject()` (ai-workflow template) state that `loadPersistedProject` already
 * seeded, including the `clip-video-01` -> `node-media-01` lineage pairing every item-5 spec
 * depends on.
 *
 * Uses `Escape` (a plain `window` keydown listener in WelcomeModal) rather than the close button
 * simply because it's the cheapest dismissal for the ~dozen specs that just need the modal gone.
 * The close button IS clickable — 06-modals.spec.ts asserts exactly that, as the regression guard
 * for the focus-scroll bug this suite's authoring found, where `useModalA11y`'s initial `.focus()`
 * scrolled the modal's own header off the top of the viewport for good.
 */
export const WELCOME_DIALOG_NAME = /timeline speed, workflow depth/i

export async function dismissWelcomeModal(page: Page): Promise<void> {
  // The dialog's accessible name comes from `aria-labelledby="welcome-modal-title"`, whose text
  // is the h2 ("Timeline speed, workflow depth..."), not the "Welcome to FluxNode" eyebrow above
  // it — match on the h2's own text so this doesn't silently start matching zero elements if
  // copy above the heading changes.
  const dialog = page.getByRole('dialog', { name: WELCOME_DIALOG_NAME })
  await dialog.waitFor({ state: 'visible' })
  await page.keyboard.press('Escape')
  await expect(dialog).toBeHidden()
}

/**
 * Boots a fresh app page with Playwright's fake clock INSTALLED BEFORE navigation, then dismisses
 * the welcome modal. Used by the timing-sensitive specs (the completed-chip flash; the thread
 * draw-in prime/re-arm) that must freeze time to observe a transient state deterministically
 * instead of racing a real 240ms/400ms animation. `clock.install()` must run before `page.goto`
 * to take effect on the page's own scripts, so these specs can't use the `freshPage` fixture
 * (which navigates internally); they call this instead.
 *
 * Note `install()` alone does NOT freeze time — it installs fake timers that still tick at the
 * real rate until `freezeClock()` (below) pauses them. That's intentional: the app boots and
 * settles under normal-flowing (if fake) time, and each spec freezes only around the exact moment
 * it needs to inspect.
 */
export async function bootFreshWithClock(page: Page): Promise<void> {
  await page.addInitScript(() => {
    window.localStorage.clear()
    window.sessionStorage.clear()
  })
  await page.clock.install()
  await page.goto('/')
  await dismissWelcomeModal(page)
}

/**
 * Freezes the (already-installed) fake clock at ~now, so no timer or `requestAnimationFrame`
 * callback fires until the spec explicitly advances it with `page.clock.runFor(...)` or releases
 * it with `page.clock.resume()`. Pauses at `now + 2s` rather than exactly `now` because reading
 * the page clock and applying `pauseAt` aren't atomic — the real-rate clock advances slightly in
 * between, and `pauseAt` rejects a target in the past ("Cannot fast-forward to the past"). The 2s
 * cushion is harmless: at the points these specs freeze (right before a selection or a queue
 * action) nothing time-dependent is scheduled in that window, so fast-forwarding across it fires
 * no stray timers.
 */
export async function freezeClock(page: Page): Promise<void> {
  const now = await page.evaluate(() => Date.now())
  await page.clock.pauseAt(new Date(now + 2000))
}

/** The demo thread's full path length, read live — the primed (fully-hidden) dashoffset equals it. */
export async function readThreadPathLength(page: Page, selector: string): Promise<number> {
  return page.$eval(selector, (el) => (el as SVGPathElement).getTotalLength())
}

/** Shell/stage-row/stratum locators shared by the layout + lineage specs. */
export function shellLocator(page: Page) {
  return page.locator('[data-meridian-shell]')
}

export function stageRowLocator(page: Page) {
  return page.locator('[data-meridian-stage-row]')
}

export function stratumLocator(page: Page, stratum: 'workflow' | 'timeline') {
  return page.locator(`[data-meridian-stratum="${stratum}"]`)
}

export function horizonSplitterLocator(page: Page) {
  return page.locator('[role="separator"][aria-label^="Horizon"]')
}

/** Selects the demo project's linked video clip in the ground (timeline) stratum. */
export async function selectDemoClip(page: Page) {
  const clip = page.locator(`[data-meridian-clip-id="${DEMO_CLIP_ID}"]`)
  await clip.scrollIntoViewIfNeeded()
  await clip.click()
  return clip
}

export function demoNodeLocator(page: Page) {
  return page.locator(`[data-meridian-node-id="${DEMO_NODE_ID}"]`)
}

export function threadEdgeLocator(page: Page) {
  return page.locator(`[data-meridian-thread-edge="${DEMO_THREAD_KEY}"]`)
}

/** Reads the LIVE (animated/computed) stroke-dashoffset of an SVG path — see 05-lineage.spec.ts's
 * header comment for why this must read computed style, not the inline `style` property. */
export async function readComputedDashoffset(page: Page, selector: string): Promise<number> {
  const value = await page.$eval(selector, (el) => getComputedStyle(el as SVGPathElement).strokeDashoffset)
  const parsed = Number.parseFloat(value)
  return Number.isFinite(parsed) ? parsed : Number.NaN
}
