import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { useProjectStore as UseProjectStoreType } from './project-store'

// This repo has no jsdom/happy-dom dependency (vitest runs in the default "node"
// environment), but project-store.ts touches window.localStorage / navigator at module
// init and inside several actions. Static `import` statements are hoisted above any
// `vi.stubGlobal` call in this file, so the stub has to be installed first and the store
// module imported dynamically afterwards (see loadStore() below) — otherwise the module's
// top-level `create<ProjectStoreState>(...)` factory would throw before stubbing runs.
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

describe('project-store: applyMutation (immer)', () => {
  let useProjectStore: typeof UseProjectStoreType

  beforeEach(async () => {
    useProjectStore = await loadStore()
  })

  it('produces a new top-level project reference but keeps unrelated branches referentially identical (structural sharing)', () => {
    const before = useProjectStore.getState().project
    useProjectStore.getState().setInPoint()
    const after = useProjectStore.getState().project

    expect(after).not.toBe(before)
    // Only timeline.inPoint changed — workflow/assets/output/audio subtrees must be
    // untouched references, proving applyMutation no longer does a full structuredClone.
    expect(after.workflow).toBe(before.workflow)
    expect(after.assets).toBe(before.assets)
    expect(after.output).toBe(before.output)
    expect(after.audio).toBe(before.audio)
    expect(after.timeline).not.toBe(before.timeline)
  })

  it('records a history command with patches/inversePatches instead of full project snapshots', () => {
    useProjectStore.getState().setOutPoint()
    const history = useProjectStore.getState().history
    expect(history.undoStack).toHaveLength(1)

    const command = history.undoStack[0]
    expect(Array.isArray(command.patches)).toBe(true)
    expect(Array.isArray(command.inversePatches)).toBe(true)
    expect(command.patches.length).toBeGreaterThan(0)
    // The old shape stored full `before`/`after` FluxNodeProject snapshots on every command;
    // that shape no longer exists.
    expect((command as unknown as { before?: unknown }).before).toBeUndefined()
    expect((command as unknown as { after?: unknown }).after).toBeUndefined()
  })
})

describe('project-store: playhead moves stay off the history/WAL path', () => {
  let useProjectStore: typeof UseProjectStoreType

  beforeEach(async () => {
    useProjectStore = await loadStore()
  })

  it('movePlayhead updates the timeline but does not push a history entry', () => {
    const initialPlayhead = useProjectStore.getState().project.timeline.playhead
    useProjectStore.getState().movePlayhead(0.5)

    expect(useProjectStore.getState().project.timeline.playhead).toBeCloseTo(initialPlayhead + 0.5, 2)
    expect(useProjectStore.getState().history.undoStack).toHaveLength(0)
  })

  it('setPlayhead updates the timeline but does not push a history entry', () => {
    useProjectStore.getState().setPlayhead(1.23)

    expect(useProjectStore.getState().project.timeline.playhead).toBeCloseTo(1.23, 2)
    expect(useProjectStore.getState().history.undoStack).toHaveLength(0)
  })

  it('many rapid movePlayhead calls (simulating a playback loop) never grow the undo stack', () => {
    for (let i = 0; i < 30; i += 1) {
      useProjectStore.getState().movePlayhead(0.1)
    }

    expect(useProjectStore.getState().history.undoStack).toHaveLength(0)
  })
})

describe('project-store: undo/redo round trip via patches', () => {
  let useProjectStore: typeof UseProjectStoreType

  beforeEach(async () => {
    useProjectStore = await loadStore()
  })

  it('undo restores the exact prior project state and redo restores the mutated state', () => {
    const original = useProjectStore.getState().project

    useProjectStore.getState().setInPoint()
    const mutated = useProjectStore.getState().project
    expect(mutated.timeline.inPoint).not.toBe(original.timeline.inPoint)

    useProjectStore.getState().undo()
    expect(useProjectStore.getState().project.timeline.inPoint).toBe(original.timeline.inPoint)
    expect(useProjectStore.getState().history.undoStack).toHaveLength(0)
    expect(useProjectStore.getState().history.redoStack).toHaveLength(1)

    useProjectStore.getState().redo()
    expect(useProjectStore.getState().project.timeline.inPoint).toBe(mutated.timeline.inPoint)
    expect(useProjectStore.getState().history.undoStack).toHaveLength(1)
    expect(useProjectStore.getState().history.redoStack).toHaveLength(0)
  })

  it('undoes multiple mutations back to the original state, in order', () => {
    const original = useProjectStore.getState().project.timeline.zoom

    useProjectStore.getState().adjustTimelineZoom(0.5)
    useProjectStore.getState().adjustTimelineZoom(0.5)
    expect(useProjectStore.getState().project.timeline.zoom).toBeCloseTo(original + 1, 2)

    useProjectStore.getState().undo()
    expect(useProjectStore.getState().project.timeline.zoom).toBeCloseTo(original + 0.5, 2)

    useProjectStore.getState().undo()
    expect(useProjectStore.getState().project.timeline.zoom).toBeCloseTo(original, 2)
  })
})

describe('project-store: horizon ratio (MERIDIAN strata shell)', () => {
  let useProjectStore: typeof UseProjectStoreType

  beforeEach(async () => {
    useProjectStore = await loadStore()
  })

  it('a ratio-driven emphasis flip preserves timeline selection (review round-1 regression: select c14 → Tab must not deselect)', () => {
    // Default project ships with clip-video-01 on track-video-01.
    useProjectStore.getState().selectClip('clip-video-01')
    const before = useProjectStore.getState().ui
    expect(before.selectedClipId).toBe('clip-video-01')

    // Simulate a Tab flip: workflow default (0.62) → timeline default (0.38), crossing 0.5.
    useProjectStore.getState().setHorizonRatio(0.38)

    const after = useProjectStore.getState().ui
    expect(after.activeView).toBe('timeline')
    expect(after.selectedClipId).toBe('clip-video-01')
    expect(after.selectedClipIds).toEqual(before.selectedClipIds)
    expect(after.selectedTrackId).toBe(before.selectedTrackId)
    // No "Switched to ... view" toast on a ratio-driven flip.
    expect(after.statusMessage).toBe(before.statusMessage)

    // Flip back: still selected.
    useProjectStore.getState().setHorizonRatio(0.62)
    expect(useProjectStore.getState().ui.activeView).toBe('workflow')
    expect(useProjectStore.getState().ui.selectedClipId).toBe('clip-video-01')
  })

  it('a ratio-driven emphasis flip preserves workflow selection and node-picker state', () => {
    const nodeId = useProjectStore.getState().project.workflow.nodes[0]!.id
    useProjectStore.getState().selectNode(nodeId)
    useProjectStore.getState().openNodePicker()
    expect(useProjectStore.getState().ui.selectedNodeId).toBe(nodeId)

    // Flip emphasis to the timeline stratum (which used to force-close the picker and clear nodes).
    useProjectStore.getState().setHorizonRatio(0.38)

    const after = useProjectStore.getState().ui
    expect(after.activeView).toBe('timeline')
    expect(after.selectedNodeId).toBe(nodeId)
    expect(after.selectedNodeIds).toEqual([nodeId])
    expect(after.showNodePicker).toBe(true)
  })

  it('setHorizonRatio clamps and persists the ratio in project.meta without touching history', () => {
    useProjectStore.getState().setHorizonRatio(0.95)
    expect(useProjectStore.getState().project.meta.horizonRatio).toBe(0.8)

    useProjectStore.getState().setHorizonRatio(0.05)
    expect(useProjectStore.getState().project.meta.horizonRatio).toBe(0.2)

    expect(useProjectStore.getState().history.undoStack).toHaveLength(0)
  })

  it('a ratio change that stays on the same side of the midpoint leaves ui untouched', () => {
    // The app now boots timeline-first (studio layout) while the demo project's horizonRatio
    // default stays on the sky side (0.62), so align emphasis with the sky side first — the
    // same-side move below is then a true no-op for ui state.
    useProjectStore.getState().setActiveView('workflow')
    const uiBefore = useProjectStore.getState().ui
    useProjectStore.getState().setHorizonRatio(0.7)

    expect(useProjectStore.getState().project.meta.horizonRatio).toBe(0.7)
    expect(useProjectStore.getState().ui).toBe(uiBefore)
  })

  it('explicit setActiveView still snaps the horizon to the view default detent', () => {
    useProjectStore.getState().setActiveView('timeline')
    expect(useProjectStore.getState().project.meta.horizonRatio).toBe(0.38)
    expect(useProjectStore.getState().ui.activeView).toBe('timeline')

    useProjectStore.getState().setActiveView('workflow')
    expect(useProjectStore.getState().project.meta.horizonRatio).toBe(0.62)
    expect(useProjectStore.getState().ui.activeView).toBe('workflow')
  })

  it('setStudioTimelineHeight clamps and persists in project.meta without touching history', () => {
    useProjectStore.getState().setStudioTimelineHeight(420)
    expect(useProjectStore.getState().project.meta.studioLayout.timelineHeightPx).toBe(420)

    useProjectStore.getState().setStudioTimelineHeight(1)
    expect(useProjectStore.getState().project.meta.studioLayout.timelineHeightPx).toBe(160)

    expect(useProjectStore.getState().history.undoStack).toHaveLength(0)
  })

  it('setStudioMediaWidth / setStudioInspectorWidth clamp and persist without touching history', () => {
    useProjectStore.getState().setStudioMediaWidth(320)
    expect(useProjectStore.getState().project.meta.studioLayout.mediaWidthPx).toBe(320)

    useProjectStore.getState().setStudioMediaWidth(1)
    expect(useProjectStore.getState().project.meta.studioLayout.mediaWidthPx).toBe(200)

    useProjectStore.getState().setStudioInspectorWidth(360)
    expect(useProjectStore.getState().project.meta.studioLayout.inspectorWidthPx).toBe(360)

    useProjectStore.getState().setStudioInspectorWidth(9999)
    expect(useProjectStore.getState().project.meta.studioLayout.inspectorWidthPx).toBe(520)

    expect(useProjectStore.getState().history.undoStack).toHaveLength(0)
  })

  it('setTimelineScrollX persists into project.timeline outside undo history', () => {
    useProjectStore.getState().setTimelineScrollX(742.4)
    expect(useProjectStore.getState().project.timeline.scrollX).toBe(742)

    useProjectStore.getState().setTimelineScrollX(-50)
    expect(useProjectStore.getState().project.timeline.scrollX).toBe(0)

    expect(useProjectStore.getState().history.undoStack).toHaveLength(0)
  })

  it('toggleStudioMediaCollapse flips the persisted media rail flag without touching history', () => {
    expect(useProjectStore.getState().project.meta.studioLayout.mediaCollapsed).toBe(false)

    useProjectStore.getState().toggleStudioMediaCollapse()
    expect(useProjectStore.getState().project.meta.studioLayout.mediaCollapsed).toBe(true)

    useProjectStore.getState().toggleStudioMediaCollapse()
    expect(useProjectStore.getState().project.meta.studioLayout.mediaCollapsed).toBe(false)

    expect(useProjectStore.getState().history.undoStack).toHaveLength(0)
  })

  it('toggleStageRowCollapse flips only the targeted rail and persists without touching history', () => {
    expect(useProjectStore.getState().project.meta.stageRowCollapse).toEqual({ ledger: false, inspector: false })

    useProjectStore.getState().toggleStageRowCollapse('ledger')
    expect(useProjectStore.getState().project.meta.stageRowCollapse).toEqual({ ledger: true, inspector: false })

    useProjectStore.getState().toggleStageRowCollapse('inspector')
    expect(useProjectStore.getState().project.meta.stageRowCollapse).toEqual({ ledger: true, inspector: true })

    useProjectStore.getState().toggleStageRowCollapse('ledger')
    expect(useProjectStore.getState().project.meta.stageRowCollapse).toEqual({ ledger: false, inspector: true })

    expect(useProjectStore.getState().history.undoStack).toHaveLength(0)
  })
})

describe('project-store: split-clip id uniqueness', () => {
  let useProjectStore: typeof UseProjectStoreType

  beforeEach(async () => {
    useProjectStore = await loadStore()
  })

  it('splitting a clip twice never produces duplicate clip or keyframe ids', () => {
    // Default project ships with clip-video-01 (startTime 0, duration 8) on track-video-01,
    // and a default playhead of 2.8 — inside the clip, so the first split is valid.
    useProjectStore.getState().selectClip('clip-video-01')
    useProjectStore.getState().splitSelectedClip()

    const track = useProjectStore.getState().project.timeline.tracks.find((t) => t.id === 'track-video-01')!
    expect(track.clips).toHaveLength(2)

    const [left, right] = track.clips
    expect(left.id).not.toBe(right.id)
    expect(right.id).not.toMatch(/-split$/)

    // Split the right half again (its startTime is the old playhead, so move the playhead
    // partway into it and split once more).
    useProjectStore.getState().selectClip(right.id)
    useProjectStore.getState().setPlayhead(right.startTime + right.duration / 2)
    useProjectStore.getState().splitSelectedClip()

    const allClips = useProjectStore
      .getState()
      .project.timeline.tracks.flatMap((t) => t.clips)
    const ids = allClips.map((clip) => clip.id)
    expect(new Set(ids).size).toBe(ids.length)

    const allKeyframeIds = allClips.flatMap((clip) => clip.keyframes.map((kf) => kf.id))
    expect(new Set(allKeyframeIds).size).toBe(allKeyframeIds.length)
  })
})
