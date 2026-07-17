import type { Clip, Track } from '../project/types'
import { r2, type MakeId } from './remove-range'

/**
 * P1 timeline ops — simple single-clip edits, pure and shared by the ghost preview and the store
 * executor. Same conventions as the P0 ops (remove/split/trim): return the input `tracks`
 * reference unchanged on a no-op so structural sharing holds.
 */

export interface MoveClipOp {
  clipId: string
  startTime: number
  /** Optional destination track for a cross-track move; defaults to the clip's current track. */
  trackId?: string
}

export function moveClipInTracks(tracks: Track[], op: MoveClipOp, _makeId: MakeId): Track[] {
  const source = tracks.find((t) => t.clips.some((c) => c.id === op.clipId))
  if (!source) {
    return tracks
  }
  const clip = source.clips.find((c) => c.id === op.clipId)!
  const destId = op.trackId ?? source.id
  const dest = tracks.find((t) => t.id === destId)
  if (!dest) {
    return tracks
  }
  const startTime = r2(op.startTime)
  if (destId === source.id && startTime === clip.startTime) {
    return tracks // no move
  }

  const moved: Clip = { ...clip, startTime, trackId: destId }
  const byStart = (a: Clip, b: Clip) => a.startTime - b.startTime

  if (destId === source.id) {
    return tracks.map((t) =>
      t === source ? { ...t, clips: [...t.clips.filter((c) => c.id !== op.clipId), moved].sort(byStart) } : t,
    )
  }
  return tracks.map((t) => {
    if (t === source) {
      return { ...t, clips: t.clips.filter((c) => c.id !== op.clipId) }
    }
    if (t === dest) {
      return { ...t, clips: [...t.clips, moved].sort(byStart) }
    }
    return t
  })
}

export interface AddClipOp {
  trackId: string
  assetId: string
  startTime: number
  duration: number
  inPoint?: number
  outPoint?: number
}

export function addClipInTracks(tracks: Track[], op: AddClipOp, makeId: MakeId): Track[] {
  const dest = tracks.find((t) => t.id === op.trackId)
  if (!dest || op.duration <= 0) {
    return tracks
  }
  const inPoint = r2(op.inPoint ?? 0)
  const clip: Clip = {
    id: makeId('clip'),
    assetId: op.assetId,
    trackId: op.trackId,
    startTime: r2(op.startTime),
    duration: r2(op.duration),
    inPoint,
    outPoint: r2(op.outPoint ?? inPoint + op.duration),
    speed: 1,
    volume: 1,
    opacity: 1,
    transform: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0, anchorX: 0.5, anchorY: 0.5 },
    keyframes: [],
    linkedClipId: null,
    workflowNodeId: null,
  }
  return tracks.map((t) => (t === dest ? { ...t, clips: [...t.clips, clip].sort((a, b) => a.startTime - b.startTime) } : t))
}

export type ClipProperty = 'volume' | 'opacity' | 'speed'
export interface SetClipPropertyOp {
  clipId: string
  property: ClipProperty
  value: number
}

const CLIP_PROPERTIES = new Set<ClipProperty>(['volume', 'opacity', 'speed'])

export function setClipPropertyInTracks(tracks: Track[], op: SetClipPropertyOp, _makeId: MakeId): Track[] {
  if (!CLIP_PROPERTIES.has(op.property)) {
    return tracks
  }
  const target = tracks.find((t) => t.clips.some((c) => c.id === op.clipId))
  if (!target) {
    return tracks
  }
  const value = clampClipProperty(op.property, op.value)
  if (value === null) {
    return tracks
  }
  const clip = target.clips.find((c) => c.id === op.clipId)!
  if (clip[op.property] === value) {
    return tracks // unchanged
  }
  return tracks.map((t) =>
    t === target ? { ...t, clips: t.clips.map((c) => (c.id === op.clipId ? { ...c, [op.property]: value } : c)) } : t,
  )
}

/** Clamp to each property's valid range; returns null for an invalid value (op becomes a no-op). */
function clampClipProperty(property: ClipProperty, value: number): number | null {
  if (!Number.isFinite(value)) {
    return null
  }
  if (property === 'opacity') {
    return Math.min(1, Math.max(0, value))
  }
  if (property === 'volume') {
    return Math.max(0, value)
  }
  // speed must be positive
  return value > 0 ? value : null
}
