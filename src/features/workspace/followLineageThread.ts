import { activeViewForRatio, defaultRatioForView, prefersReducedMotion } from '../../domain/project/horizon'
import { resolveHorizonRevealRatio } from '../../domain/project/lineageThread'
import { useProjectStore } from '../../store/project-store'
import { scrollEndpointIntoView, type LineageEndpointKind } from './rect-registry'

type StoreState = ReturnType<typeof useProjectStore.getState>

/**
 * Item-5 orchestrator scope decision B (binding): the thread and the `F` jump are STRICTLY
 * OBSERVATIONAL. They may select, focus, scroll-into-view, and slide the horizon — they must
 * never create a node, mutate the project, or push undo history. This file therefore never
 * calls `showSelectedClipInWorkflow` (it creates a workflow node when the clip has none) and
 * never goes through `applyMutation`/the undo stack — every write below is a plain `set()` UI
 * write via the store's existing `selectClip`/`selectNode`/`setHorizonRatio` actions, or a
 * `statusMessage`-only patch matching the pattern already used by `selectAllTimelineClips` etc.
 */

function setStatusHint(message: string): void {
  useProjectStore.setState((current) => ({ ui: { ...current.ui, statusMessage: message } }))
}

function revealStratum(state: StoreState, targetView: 'workflow' | 'timeline'): void {
  const nextRatio = resolveHorizonRevealRatio(
    state.project.meta.horizonRatio,
    targetView,
    activeViewForRatio,
    defaultRatioForView,
  )

  if (nextRatio !== null) {
    state.setHorizonRatio(nextRatio)
  }
}

/**
 * Selects one specific lineage endpoint, reveals its stratum if the horizon has it
 * collapsed/small, and scrolls it into view. Shared by the `F` shortcut (whole-selection jump)
 * and an individual edge pill's click (item-5 brief: "activating it performs the same jump as
 * F").
 */
export function revealLineageEndpoint(kind: LineageEndpointKind, id: string): void {
  const state = useProjectStore.getState()

  if (kind === 'node') {
    state.selectNode(id)
    revealStratum(state, 'workflow')
  } else {
    state.selectClip(id)
    revealStratum(state, 'timeline')
  }

  scrollEndpointIntoView(kind, id, !prefersReducedMotion())
}

/**
 * Spec H "Lineage: `F` follow thread from selection". Decision B/C: bidirectional (clip <-> its
 * one node; node -> its clips), no Takes drawer (Shift+F, out of scope). Reads the CURRENT
 * selection and jumps to the other end — never creates data, per decision B: "When a selected
 * clip has workflowNodeId === null, there is simply no thread — show nothing (and F does
 * nothing except, at most, a status hint)."
 */
export function followLineageThread(): void {
  const state = useProjectStore.getState()
  const { selectedClipId, selectedNodeId } = state.ui

  if (selectedClipId) {
    const clip = state.project.timeline.tracks.flatMap((track) => track.clips).find((candidate) => candidate.id === selectedClipId)

    if (!clip?.workflowNodeId) {
      setStatusHint('Selected clip has no linked workflow node')
      return
    }

    revealLineageEndpoint('node', clip.workflowNodeId)
    return
  }

  if (selectedNodeId) {
    const linkedClips = state.project.timeline.tracks
      .flatMap((track) => track.clips)
      .filter((clip) => clip.workflowNodeId === selectedNodeId)

    if (linkedClips.length === 0) {
      setStatusHint('Selected node has no linked timeline clips')
      return
    }

    if (linkedClips.length === 1) {
      revealLineageEndpoint('clip', linkedClips[0].id)
      return
    }

    // Several clips reference this node: select all of them (spec: "if several, select all and
    // scroll the first into view"), via the existing additive `selectClip` action — no new store
    // surface needed.
    state.selectClip(linkedClips[0].id, false)
    for (const clip of linkedClips.slice(1)) {
      useProjectStore.getState().selectClip(clip.id, true)
    }

    revealStratum(useProjectStore.getState(), 'timeline')
    scrollEndpointIntoView('clip', linkedClips[0].id, !prefersReducedMotion())
    return
  }

  setStatusHint('No selection to follow')
}
