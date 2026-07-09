#!/usr/bin/env node
/**
 * Guards against `vite.config.ts` (`build.outDir`) and `src-tauri/tauri.conf.json`
 * (`build.frontendDist`) drifting apart. Run this after `npm run build`.
 *
 * It does NOT read `tauri.conf.json` (that file is owned by the backend team and is being
 * actively realigned to point `frontendDist` at `.dist`); it only asserts that the directory
 * Vite actually wrote to exists and contains a built `index.html`. If Vite's output dir ever
 * changes, update EXPECTED_OUT_DIR below to match `vite.config.ts`.
 */

import { existsSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = resolve(fileURLToPath(new URL('.', import.meta.url)), '..')

// Keep in sync with `build.outDir` in vite.config.ts.
const EXPECTED_OUT_DIR = '.dist'

const outDir = resolve(repoRoot, EXPECTED_OUT_DIR)
const indexHtml = resolve(outDir, 'index.html')

function fail(message) {
  console.error(`\n[check-build-output] FAILED: ${message}\n`)
  process.exitCode = 1
}

if (!existsSync(outDir)) {
  fail(
    `Expected build output directory "${EXPECTED_OUT_DIR}" does not exist at ${outDir}.\n` +
      `Did "npm run build" run? Did vite.config.ts's build.outDir change without updating ` +
      `this script (and src-tauri/tauri.conf.json's build.frontendDist)?`,
  )
} else if (!existsSync(indexHtml)) {
  const contents = readdirSync(outDir)
  fail(
    `"${EXPECTED_OUT_DIR}/index.html" is missing. Directory contents: ` +
      `${contents.length ? contents.join(', ') : '(empty)'}`,
  )
} else {
  console.log(`[check-build-output] OK: ${EXPECTED_OUT_DIR}/index.html exists.`)
}
