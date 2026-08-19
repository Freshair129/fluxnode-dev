import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { useProjectStore as UseProjectStoreType } from './project-store'

/**
 * No IPC mock: these tests run outside a Tauri runtime by construction (see
 * installBrowserGlobals — `window` never gets `__TAURI_INTERNALS__`), so `enqueueRender` exercises
 * the REAL browser-mode path through `startExportJob` / `startRenderJob` end to end. That is
 * deliberate — this is exactly the path G-03 found lying about success, so the fix is proven by
 * the real IPC functions refusing to fabricate a result, not by a mock standing in for them.
 */
function installBrowserGlobals() {
  const localStorageData = new Map<string, string>()
  vi.stubGlobal('window', {
    localStorage: {
      getItem: (key: string) => (localStorageData.has(key) ? localStorageData.get(key)! : null),
      setItem: (key: string, value: string) => {
        localStorageData.set(key, value)
      },
      removeItem: (key: string) => {
        localStorageData.delete(key)
      },
    },
    setTimeout: (...args: Parameters<typeof setTimeout>) => setTimeout(...args),
    clearTimeout: (handle: ReturnType<typeof setTimeout>) => clearTimeout(handle),
    addEventListener: () => {},
    removeEventListener: () => {},
  })
  vi.stubGlobal('navigator', { onLine: true })
}

async function loadStore() {
  vi.resetModules()
  installBrowserGlobals()
  const mod = (await import('./project-store')) as { useProjectStore: typeof UseProjectStoreType }
  return mod.useProjectStore
}

describe('enqueueRender in browser preview mode', () => {
  let useProjectStore: typeof UseProjectStoreType

  beforeEach(async () => {
    useProjectStore = await loadStore()
  })

  it('never queues a render job, so nothing can later report a fabricated completion', async () => {
    const queueBefore = useProjectStore.getState().project.output.queue.length

    await useProjectStore.getState().enqueueRender()

    expect(useProjectStore.getState().project.output.queue.length).toBe(queueBefore)
  })

  it('surfaces a clear, accurate error instead of pretending the export started', async () => {
    await useProjectStore.getState().enqueueRender()

    const errors = useProjectStore.getState().appErrors
    expect(errors).toHaveLength(1)
    // Must actually say WHY — not the generic "check your export directory" wording, which would
    // send a browser-preview user chasing a permissions problem that does not exist.
    expect(errors[0].userMessage.toLowerCase()).toContain('desktop')
    expect(errors[0].category).toBe('render_failed')
  })

  it('does not push a new error every time the button is pressed again', async () => {
    await useProjectStore.getState().enqueueRender()
    await useProjectStore.getState().enqueueRender()

    // pushAppError already de-dupes on (category, message, contextId); this just confirms the
    // browser-mode error message is stable rather than embedding something like a timestamp or
    // job id that would defeat that de-dupe.
    expect(useProjectStore.getState().appErrors).toHaveLength(1)
  })
})
