import type { Clip, FluxNodeProject } from '../project/types'
import { r2 } from '../timeline/remove-range'
import { applyProposalsToProject, isSupportedFrontendProposal, type Proposal } from './proposals'

/**
 * On-timeline ghost preview: diff the current project against the one the pending proposals would
 * produce (via the SAME shared op logic as the executor) and describe, per clip, what would change.
 * The FluxNode timeline renders clips as cards, not a proportional time ruler, so the "ghost" is a
 * per-card annotation (removed / trimmed / moved / changed) plus the clips that would newly appear.
 */
export type ClipGhostKind = 'removed' | 'trimmed' | 'moved' | 'changed'
export interface ClipGhost {
  kind: ClipGhostKind
  detail: string
}
export interface NewClipGhost {
  trackId: string
  startTime: number
  duration: number
}
export interface GhostPreview {
  /** Existing clip id → how it would change. */
  clips: Map<string, ClipGhost>
  /** Clips that would newly appear (split fragments, added clips). */
  newClips: NewClipGhost[]
  removedCount: number
}

const EMPTY: GhostPreview = { clips: new Map(), newClips: [], removedCount: 0 }

export function computeClipGhosts(project: FluxNodeProject, proposals: Proposal[]): GhostPreview {
  const supported = proposals.filter(isSupportedFrontendProposal)
  if (supported.length === 0) {
    return EMPTY
  }

  const after = applyProposalsToProject(project, supported)
  if (after === project) {
    return EMPTY
  }

  const beforeById = indexClips(project)
  const afterById = indexClips(after)

  const clips = new Map<string, ClipGhost>()
  let removedCount = 0

  for (const [id, before] of beforeById) {
    const found = afterById.get(id)
    if (!found) {
      clips.set(id, { kind: 'removed', detail: 'will be cut' })
      removedCount++
      continue
    }
    const ghost = describeChange(before.clip, found.clip, before.trackId, found.trackId)
    if (ghost) {
      clips.set(id, ghost)
    }
  }

  const newClips: NewClipGhost[] = []
  for (const [id, entry] of afterById) {
    if (!beforeById.has(id)) {
      newClips.push({ trackId: entry.trackId, startTime: entry.clip.startTime, duration: entry.clip.duration })
    }
  }

  return { clips, newClips, removedCount }
}

function indexClips(project: FluxNodeProject): Map<string, { clip: Clip; trackId: string }> {
  const map = new Map<string, { clip: Clip; trackId: string }>()
  for (const track of project.timeline.tracks) {
    for (const clip of track.clips) {
      map.set(clip.id, { clip, trackId: track.id })
    }
  }
  return map
}

function describeChange(before: Clip, after: Clip, beforeTrack: string, afterTrack: string): ClipGhost | null {
  const startMoved = r2(before.startTime) !== r2(after.startTime)
  const durationChanged = r2(before.duration) !== r2(after.duration)

  if (beforeTrack !== afterTrack) {
    return { kind: 'moved', detail: `→ ${after.startTime}s on another track` }
  }
  if (durationChanged) {
    return { kind: 'trimmed', detail: `${before.duration}s → ${after.duration}s` }
  }
  if (startMoved) {
    return { kind: 'moved', detail: `→ ${after.startTime}s` }
  }
  for (const prop of ['volume', 'opacity', 'speed'] as const) {
    if (before[prop] !== after[prop]) {
      return { kind: 'changed', detail: `${prop} ${before[prop]} → ${after[prop]}` }
    }
  }
  return null
}
