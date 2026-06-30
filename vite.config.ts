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
    // Never discover tests inside transient agent worktrees or build dirs.
    exclude: [...configDefaults.exclude, '**/.claude/**', '**/.tmp/**', '**/.dist/**'],
  },
})
