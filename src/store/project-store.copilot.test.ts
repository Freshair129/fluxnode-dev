import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { useProjectStore as UseProjectStoreType } from './project-store'
import type { Proposal } from '../domain/copilot/proposals'

// Same dynamic-import + stubbed-globals dance as project-store.test.ts: the store touches
// window.localStorage at module init, and static imports hoist above vi.stubGlobal.
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

const removeRange = (trackId: string, start: number, end: number, ripple = true): Proposal => ({
  action: 'timeline_remove_range',
  args: { trackId, start, end, ripple },
  site: 'frontend',
  summary: 'test',
})

describe('project-store: applyCopilotProposals', () => {
  let useProjectStore: typeof UseProjectStoreType

  beforeEach(async () => {
    useProjectStore = await loadStore()
  })

  const trackWithClips = () =>
    useProjectStore.getState().project.timeline.tracks.find((t) => t.clips.length > 0)!

  it('materializes an approved remove_range as exactly one undoable edit, and undo restores it', () => {
    useProjectStore.getState().addDemoClip()
    const track = trackWithClips()
    const clip0 = track.clips[0]
    const beforeCount = track.clips.length
    const undoBefore = useProjectStore.getState().history.undoStack.length

    // Cut a 1s window strictly inside clip0 (duration 4) -> splits it into two.
    const start = Number((clip0.startTime + 1).toFixed(2))
    const end = Number((clip0.startTime + 2).toFixed(2))
    useProjectStore.getState().applyCopilotProposals([removeRange(track.id, start, end)])

    expect(trackWithClips().clips).toHaveLength(beforeCount + 1)
    const history = useProjectStore.getState().history
    expect(history.undoStack.length).toBe(undoBefore + 1) // one plan == one undo entry
    expect(history.undoStack.at(-1)!.type).toBe('copilot.timeline.edit')

    useProjectStore.getState().undo()
    expect(trackWithClips().clips).toHaveLength(beforeCount)
  })

  it('collapses a multi-op plan into a single undo entry', () => {
    useProjectStore.getState().addDemoClip()
    const track = trackWithClips()
    const clip0 = track.clips[0]
    const undoBefore = useProjectStore.getState().history.undoStack.length

    // Two non-overlapping cuts inside clip0, approved together.
    useProjectStore.getState().applyCopilotProposals([
      removeRange(track.id, Number((clip0.startTime + 0.5).toFixed(2)), Number((clip0.startTime + 1).toFixed(2))),
      removeRange(track.id, Number((clip0.startTime + 2).toFixed(2)), Number((clip0.startTime + 2.5).toFixed(2))),
    ])

    expect(useProjectStore.getState().history.undoStack.length).toBe(undoBefore + 1)
  })

  it('is a no-op with no history entry when no supported proposal applies', () => {
    useProjectStore.getState().addDemoClip()
    const undoBefore = useProjectStore.getState().history.undoStack.length
    useProjectStore.getState().applyCopilotProposals([removeRange('no-such-track', 1, 2)])
    expect(useProjectStore.getState().history.undoStack.length).toBe(undoBefore)
  })
})
