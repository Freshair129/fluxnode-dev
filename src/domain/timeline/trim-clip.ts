import type { Clip, Track } from '../project/types'
import { r2, retimeKeyframes, type MakeId } from './remove-range'

/**
 * `timeline_trim_clip`: move one edge of a clip by a signed `delta` (seconds). Pure, shared by the
 * ghost preview and the store executor.
 *
 * - edge `'end'`: `delta > 0` extends the tail, `delta < 0` trims it (duration + delta, outPoint + delta).
 * - edge `'start'`: `delta > 0` trims the head (start moves later), `delta < 0` extends it
 *   (startTime + delta, inPoint + delta, duration − delta).
 *
 * Source-time maps 1:1 with timeline time (the `splitSelectedClip` convention; clip `speed` is not
 * applied). Any move that would drive duration ≤ 0, inPoint < 0, or startTime < 0 is a no-op — the
 * proposal simply doesn't apply. This op does not ripple neighbours (Slice 2 keeps it per-clip; a
 * resulting overlap is caught by the store's validation on execute).
 */
export interface TrimClipOp {
  clipId: string
  edge: 'start' | 'end'
  delta: number
}

export function trimClipInTracks(tracks: Track[], op: TrimClipOp, _makeId: MakeId): Track[] {
  if (op.delta === 0) {
    return tracks
  }
  const target = tracks.find((t) => t.clips.some((c) => c.id === op.clipId))
  if (!target) {
    return tracks
  }

  const clip = target.clips.find((c) => c.id === op.clipId)!
  const trimmed = op.edge === 'end' ? trimEnd(clip, op.delta) : trimStart(clip, op.delta)
  if (!trimmed) {
    return tracks // invalid trim — leave everything untouched (same reference)
  }

  return tracks.map((t) => {
    if (t !== target) {
      return t
    }
    return { ...t, clips: t.clips.map((c) => (c.id === op.clipId ? trimmed : c)) }
  })
}

function trimEnd(clip: Clip, delta: number): Clip | null {
  const duration = r2(clip.duration + delta)
  if (duration <= 0) {
    return null
  }
  return {
    ...clip,
    duration,
    outPoint: r2(clip.outPoint + delta),
    keyframes: retimeKeyframes(clip.keyframes, noId, { keepFrom: 0, keepTo: duration, shift: 0, fresh: false }),
  }
}

function trimStart(clip: Clip, delta: number): Clip | null {
  const startTime = r2(clip.startTime + delta)
  const inPoint = r2(clip.inPoint + delta)
  const duration = r2(clip.duration - delta)
  if (duration <= 0 || inPoint < 0 || startTime < 0) {
    return null
  }
  return {
    ...clip,
    startTime,
    inPoint,
    duration,
    // Keyframes are clip-relative: the head shifting by `delta` retimes them by −delta, dropping
    // any that fall before the new head.
    keyframes: retimeKeyframes(clip.keyframes, noId, { keepFrom: delta, keepTo: r2(clip.duration), shift: delta, fresh: false }),
  }
}

// Trims never mint keyframe ids (fresh: false), so this is never called.
const noId: MakeId = () => ''
