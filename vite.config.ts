import { defineConfig, configDefaults } from 'vitest/config'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  cacheDir: '.tmp/vite',
  plugins: [react(), tailwindcss()],
  build: {
    outDir: '.dist',
    emptyOutDir: true,
  },
  test: {
    // Never discover tests inside transient agent worktrees or build dirs. `e2e/**` is
    // Playwright's real-browser suite (item 10, `npm run test:e2e`) — vitest runs in Node, not a
    // browser, so it must never try to collect those specs (they use `@playwright/test`'s `test`/
    // `expect`, not vitest's, and rely on a live browser window that vitest's `node` environment
    // can't provide).
    exclude: [...configDefaults.exclude, '**/.claude/**', '**/.tmp/**', '**/.dist/**', '**/e2e/**'],
  },
})
