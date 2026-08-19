import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { useProjectStore as UseProjectStoreType } from './project-store'
import type { Proposal } from '../domain/copilot/proposals'
import { planSilenceCuts, type Transcript } from '../domain/copilot/rough-cut'

// The one unavoidable mock: executing a backend proposal crosses the Tauri IPC boundary, which
// does not exist under vitest. Everything either side of that boundary is the real code.
const { invokeActionMock } = vi.hoisted(() => ({ invokeActionMock: vi.fn() }))
vi.mock('../services/ipc/action-invoke', () => ({ invokeAction: invokeActionMock }))

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

const splitClip = (clipId: string, time: number): Proposal => ({
  action: 'timeline_split_clip',
  args: { clipId, time },
  site: 'frontend',
  summary: 'test',
})

const trimClip = (clipId: string, edge: 'start' | 'end', delta: number): Proposal => ({
  action: 'timeline_trim_clip',
  args: { clipId, edge, delta },
  site: 'frontend',
  summary: 'test',
})

describe('project-store: applyCopilotProposals', () => {
  let useProjectStore: typeof UseProjectStoreType

  beforeEach(async () => {
    invokeActionMock.mockReset()
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

  it('routes a P1 set-clip-property proposal through the store as one undoable edit', () => {
    useProjectStore.getState().addDemoClip()
    const clip0 = trackWithClips().clips[0]
    const undoBefore = useProjectStore.getState().history.undoStack.length

    useProjectStore.getState().applyCopilotProposals([
      { action: 'timeline_set_clip_property', args: { clipId: clip0.id, property: 'volume', value: 0.5 }, site: 'frontend', summary: 't' },
    ])

    expect(trackWithClips().clips.find((c) => c.id === clip0.id)!.volume).toBe(0.5)
    expect(useProjectStore.getState().history.undoStack.length).toBe(undoBefore + 1)
    useProjectStore.getState().undo()
    expect(trackWithClips().clips.find((c) => c.id === clip0.id)!.volume).toBe(clip0.volume)
  })

  it('is a no-op with no history entry when no supported proposal applies', () => {
    useProjectStore.getState().addDemoClip()
    const undoBefore = useProjectStore.getState().history.undoStack.length
    useProjectStore.getState().applyCopilotProposals([removeRange('no-such-track', 1, 2)])
    expect(useProjectStore.getState().history.undoStack.length).toBe(undoBefore)
  })

  it('applies an approved split as one undoable edit, and undo restores it', () => {
    useProjectStore.getState().addDemoClip()
    const track = trackWithClips()
    const clip0 = track.clips[0]
    const beforeCount = track.clips.length
    const undoBefore = useProjectStore.getState().history.undoStack.length

    useProjectStore.getState().applyCopilotProposals([splitClip(clip0.id, Number((clip0.startTime + 2).toFixed(2)))])

    expect(trackWithClips().clips).toHaveLength(beforeCount + 1)
    expect(useProjectStore.getState().history.undoStack.length).toBe(undoBefore + 1)
    useProjectStore.getState().undo()
    expect(trackWithClips().clips).toHaveLength(beforeCount)
  })

  it('rough-cut concierge: plans silence cuts from a transcript and applies them as one undo', () => {
    useProjectStore.getState().addDemoClip()
    const track = trackWithClips()
    const totalBefore = track.clips.reduce((sum, c) => sum + c.duration, 0)
    const undoBefore = useProjectStore.getState().history.undoStack.length

    // Speech at [0,1] and [3,3.5]; a ~2s silent gap between (inside the 4s demo clip).
    const transcript: Transcript = {
      text: 'a b',
      segments: [
        { start: 0, end: 1, text: 'a' },
        { start: 3, end: 3.5, text: 'b' },
      ],
    }
    const plan = planSilenceCuts(track, transcript)
    expect(plan.length).toBeGreaterThan(0)

    useProjectStore.getState().applyCopilotProposals(plan)
    const totalAfter = trackWithClips().clips.reduce((sum, c) => sum + c.duration, 0)
    expect(totalAfter).toBeLessThan(totalBefore) // silence removed
    expect(useProjectStore.getState().history.undoStack.length).toBe(undoBefore + 1) // one undo for the whole cut

    useProjectStore.getState().undo()
    expect(trackWithClips().clips.reduce((sum, c) => sum + c.duration, 0)).toBeCloseTo(totalBefore, 5)
  })

  it('executes an approved backend proposal against the registry with writes allowed', async () => {
    invokeActionMock.mockResolvedValue({ ok: true })

    await useProjectStore.getState().approveCopilotProposals([
      { action: 'save_project_state', args: { project_json: '{}' }, site: 'backend', summary: 'save' },
    ])

    expect(invokeActionMock).toHaveBeenCalledTimes(1)
    expect(invokeActionMock).toHaveBeenCalledWith('save_project_state', { project_json: '{}' }, { allowWrites: true })
  })

  it('records an executed backend proposal without adding an undo entry', async () => {
    invokeActionMock.mockResolvedValue({ ok: true })
    const undoBefore = useProjectStore.getState().history.undoStack.length

    await useProjectStore.getState().approveCopilotProposals([
      { action: 'render_start', args: { job_id: 'j1' }, site: 'backend', summary: 'render' },
    ])

    // A backend side effect is not undoable — reverting the row would leave the real job running.
    expect(useProjectStore.getState().history.undoStack.length).toBe(undoBefore)
    expect(useProjectStore.getState().copilotOutcomes).toEqual([
      { action: 'render_start', site: 'backend', status: 'applied', detail: expect.any(String) },
    ])
  })

  it('records a failed backend proposal and still runs the ones after it', async () => {
    invokeActionMock
      .mockRejectedValueOnce(new Error('No active project directory is available'))
      .mockResolvedValueOnce({ ok: true })

    await useProjectStore.getState().approveCopilotProposals([
      { action: 'render_start', args: {}, site: 'backend', summary: 'a' },
      { action: 'save_project_state', args: {}, site: 'backend', summary: 'b' },
    ])

    expect(invokeActionMock).toHaveBeenCalledTimes(2)
    const outcomes = useProjectStore.getState().copilotOutcomes
    expect(outcomes.map((o) => o.status)).toEqual(['failed', 'applied'])
    expect(outcomes[0].detail).toContain('No active project directory')
  })

  it('accumulates outcomes across approvals so running actions one at a time keeps the history', async () => {
    invokeActionMock.mockResolvedValue({ ok: true })

    await useProjectStore.getState().approveCopilotProposals([
      { action: 'save_project_state', args: {}, site: 'backend', summary: 'a' },
    ])
    await useProjectStore.getState().approveCopilotProposals([
      { action: 'render_start', args: {}, site: 'backend', summary: 'b' },
    ])

    expect(useProjectStore.getState().copilotOutcomes.map((o) => o.action)).toEqual([
      'save_project_state',
      'render_start',
    ])
  })

  it('keeps outcomes when the pending list is narrowed to the proposals still awaiting approval', async () => {
    invokeActionMock.mockResolvedValue({ ok: true })
    const stillPending: Proposal = { action: 'render_start', args: {}, site: 'backend', summary: 'b' }
    useProjectStore.getState().setCopilotProposals([
      { action: 'save_project_state', args: {}, site: 'backend', summary: 'a' },
      stillPending,
    ])

    await useProjectStore.getState().approveCopilotProposals([
      { action: 'save_project_state', args: {}, site: 'backend', summary: 'a' },
    ])
    useProjectStore.getState().setCopilotProposals([stillPending])

    // Running one action must not erase the record of the one before it.
    expect(useProjectStore.getState().copilotOutcomes).toHaveLength(1)
    expect(useProjectStore.getState().copilotProposals).toEqual([stillPending])
  })

  it('resetCopilotSession clears both the pending proposals and the outcomes', async () => {
    invokeActionMock.mockResolvedValue({ ok: true })
    useProjectStore.getState().setCopilotProposals([
      { action: 'render_start', args: {}, site: 'backend', summary: 'b' },
    ])
    await useProjectStore.getState().approveCopilotProposals([
      { action: 'save_project_state', args: {}, site: 'backend', summary: 'a' },
    ])

    useProjectStore.getState().resetCopilotSession()

    expect(useProjectStore.getState().copilotProposals).toEqual([])
    expect(useProjectStore.getState().copilotOutcomes).toEqual([])
  })

  it('never invokes the registry for an unsupported frontend proposal', async () => {
    await useProjectStore.getState().approveCopilotProposals([
      { action: 'timeline_teleport', args: {}, site: 'frontend', summary: '?' },
    ])

    expect(invokeActionMock).not.toHaveBeenCalled()
    expect(useProjectStore.getState().copilotOutcomes.map((o) => o.status)).toEqual(['unsupported'])
  })

  it('applies frontend ops as one undo entry and executes backend ops in the same approval', async () => {
    invokeActionMock.mockResolvedValue({ ok: true })
    useProjectStore.getState().addDemoClip()
    const track = trackWithClips()
    const clip0 = track.clips[0]
    const beforeCount = track.clips.length
    const undoBefore = useProjectStore.getState().history.undoStack.length

    await useProjectStore.getState().approveCopilotProposals([
      removeRange(track.id, Number((clip0.startTime + 1).toFixed(2)), Number((clip0.startTime + 2).toFixed(2))),
      { action: 'save_project_state', args: {}, site: 'backend', summary: 'save' },
    ])

    expect(trackWithClips().clips).toHaveLength(beforeCount + 1)
    expect(useProjectStore.getState().history.undoStack.length).toBe(undoBefore + 1)
    expect(invokeActionMock).toHaveBeenCalledTimes(1)
    expect(useProjectStore.getState().copilotOutcomes.map((o) => o.site)).toEqual(['frontend', 'backend'])
  })

  it('applies an approved trim, changing the clip duration as one undoable edit', () => {
    useProjectStore.getState().addDemoClip()
    const track = trackWithClips()
    const clip0 = track.clips[0]
    const beforeDuration = clip0.duration
    const undoBefore = useProjectStore.getState().history.undoStack.length

    useProjectStore.getState().applyCopilotProposals([trimClip(clip0.id, 'end', -1)])

    const after = trackWithClips().clips.find((c) => c.id === clip0.id)!
    expect(after.duration).toBeCloseTo(beforeDuration - 1, 5)
    expect(useProjectStore.getState().history.undoStack.length).toBe(undoBefore + 1)
    useProjectStore.getState().undo()
    expect(trackWithClips().clips.find((c) => c.id === clip0.id)!.duration).toBeCloseTo(beforeDuration, 5)
  })
})
