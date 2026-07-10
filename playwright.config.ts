import { defineConfig, devices } from '@playwright/test'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/**
 * MERIDIAN item 10 (browser-mode smoke-test infra). See e2e/README.md for the full "why" — short
 * version: jsdom isn't installed in this repo at all (vitest can't do layout or run effects), and
 * the CDP preview tab used for other live checks reports `document.hidden === true` with
 * `requestAnimationFrame` never firing (0 callbacks measured in 1.4s). Every rAF-driven behavior
 * in this app (horizon tween, JobChip landing flash, lineage thread draw-in + live endpoint
 * tracking) is unverifiable there. This suite MUST run headed against a real, visible, painting
 * browser window — see e2e/00-guard.spec.ts, which fails loudly first if that ever regresses.
 *
 * Port 5210 (strict): 5199/5201 are in use elsewhere in this environment and 5173 is both an
 * unrelated project's port AND this repo's own `src-tauri/tauri.conf.json` `devUrl` — picking a
 * distinct port keeps this suite from ever fighting either of those dev servers for the port.
 */
const PORT = 5210
// Match Vite's own printed "Local:" host exactly (`localhost`, not `127.0.0.1`) — on this
// environment the two resolve differently enough that Playwright's webServer readiness poll
// against 127.0.0.1 times out even though `vite --port 5210 --strictPort` is already listening.
const BASE_URL = `http://localhost:${PORT}`

// Playwright's own artifacts (traces, the HTML report) MUST live outside this repo's working
// tree, not just outside git tracking. `vite --port 5210` (this same webServer) watches the
// whole project root for HMR — verified empirically: pointing `outputDir` at `.tmp/playwright-
// results` (which IS already `.gitignore`d, same convention as vite's own `.tmp/vite` cacheDir)
// still made Vite log `page reload .tmp/playwright-results/.../traces/...` mid-run, because
// `.tmp/vite` is excluded from Vite's watcher specifically as its configured `cacheDir`, but nothing
// else under `.tmp/` is. A trace-driven HMR reload firing between specs would wipe the app's
// in-page state exactly like the concurrent-worker HMR churn documented in e2e/README.md's
// flakiness notes — so artifacts are routed to the OS temp dir instead, which Vite never watches.
const ARTIFACTS_DIR = join(tmpdir(), 'fluxnode-playwright')

export default defineConfig({
  testDir: './e2e',
  outputDir: join(ARTIFACTS_DIR, 'test-results'),
  reporter: [['list'], ['html', { outputFolder: join(ARTIFACTS_DIR, 'report'), open: 'never' }]],
  // Some specs (item 4's 8s auto-clear) are intentionally long-running; give every test room
  // without forcing every other spec to inherit that budget via a shared slow default.
  timeout: 30_000,
  // Deterministic over fast: several specs share app/browser state assumptions (fresh
  // localStorage per test via the `freshApp` fixture) and drive real timers (400ms flash, 8s
  // auto-clear) — running workers in parallel doesn't help here and only adds flakiness surface.
  fullyParallel: false,
  workers: 1,
  retries: 0,
  forbidOnly: Boolean(process.env.CI),
  use: {
    baseURL: BASE_URL,
    trace: 'retain-on-failure',
    video: 'off',
    actionTimeout: 10_000,
  },
  // Headed on purpose (item 10's whole point) — see the guard spec, which proves this every run.
  webServer: {
    command: `npm run dev -- --port ${PORT} --strictPort`,
    url: BASE_URL,
    // NEVER reuse an already-running server (review advisory 7). The prior default
    // (`!process.env.CI` — reuse when running locally) let a stale HMR dev server, left listening
    // on 5210 by an earlier or crashed run, silently serve OLD bundle code to a fresh run, which
    // is exactly what made some earlier "green" runs meaningless. With reuse off, Playwright
    // always starts its own server and stops it at the end; a leftover process on 5210 instead
    // makes `vite --strictPort` fail LOUDLY (port in use) rather than being silently adopted.
    // `strictPort` guarantees the same: no silent hop to a different port either.
    reuseExistingServer: false,
    timeout: 60_000,
    stdout: 'pipe',
    stderr: 'pipe',
  },
  projects: [
    {
      name: 'chromium-headed',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1440, height: 900 },
        headless: false,
      },
    },
  ],
})
