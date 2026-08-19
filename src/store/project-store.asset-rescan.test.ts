import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { useProjectStore as UseProjectStoreType } from './project-store'

/**
 * No IPC mock needed: these tests run outside a Tauri runtime, so `inspectAssetPath` takes its
 * documented browser-mode fallback and returns `exists: false` deterministically for every path
 * (see services/ipc/asset-inspection.ts). The two demo assets in `createDefaultProject()` start
 * `status: 'linked'`, so a rescan flips them to `missing` — a real state change, which is what
 * these tests need to prove the mutation actually applied.
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

describe('rescanAssetStatuses', () => {
  let useProjectStore: typeof UseProjectStoreType

  beforeEach(async () => {
    useProjectStore = await loadStore()
  })

  it('applies a rescan without adding an undo entry', async () => {
    const [assetId] = Object.keys(useProjectStore.getState().project.assets.assets)
    expect(useProjectStore.getState().project.assets.assets[assetId].status).toBe('linked')
    const undoBefore = useProjectStore.getState().history.undoStack.length

    await useProjectStore.getState().rescanAssetStatuses()

    // Proof it actually applied: the browser-mode probe reports the file missing.
    expect(useProjectStore.getState().project.assets.assets[assetId].status).toBe('missing')
    // A background/manual filesystem re-check is a fact, not a user edit — reverting it with
    // undo would restore a false belief that the file still exists, and letting it accumulate
    // (e.g. every asset-watch tick) would evict the user's real edits from the bounded history.
    expect(useProjectStore.getState().history.undoStack.length).toBe(undoBefore)
  })

  it('leaves the redo stack intact so a rescan cannot cancel a pending redo', async () => {
    useProjectStore.getState().addDemoClip()
    useProjectStore.getState().undo()
    expect(useProjectStore.getState().history.redoStack.length).toBe(1)

    await useProjectStore.getState().rescanAssetStatuses()

    expect(useProjectStore.getState().history.redoStack.length).toBe(1)
  })
})
