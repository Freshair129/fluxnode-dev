import type { Clip, Track } from '../project/types'
import { r2, retimeKeyframes, type MakeId } from './remove-range'

/**
 * `timeline_split_clip`: razor a clip into two at an absolute timeline time. Pure, shared by the
 * copilot ghost preview and the store executor. Mirrors the store's `splitSelectedClip`: the left
 * remainder keeps the clip id and its workflow link; the right fragment gets a fresh id with its
 * link cleared. A `time` at or outside the clip's bounds is a no-op.
 */
export interface SplitClipOp {
  clipId: string
  time: number
}

export function splitClipInTracks(tracks: Track[], op: SplitClipOp, makeId: MakeId): Track[] {
  const target = tracks.find((t) => t.clips.some((c) => c.id === op.clipId))
  if (!target) {
    return tracks
  }

  const clip = target.clips.find((c) => c.id === op.clipId)!
  const end = r2(clip.startTime + clip.duration)
  if (op.time <= clip.startTime || op.time >= end) {
    return tracks // split point at or outside the clip bounds — nothing to do
  }

  const leftDur = r2(op.time - clip.startTime)
  const left: Clip = {
    ...clip,
    duration: leftDur,
    outPoint: r2(clip.inPoint + leftDur),
    keyframes: retimeKeyframes(clip.keyframes, makeId, { keepFrom: 0, keepTo: leftDur, shift: 0, fresh: false }),
  }
  const right: Clip = {
    ...clip,
    id: makeId('clip'),
    startTime: op.time,
    duration: r2(end - op.time),
    inPoint: r2(clip.inPoint + leftDur),
    outPoint: clip.outPoint,
    workflowNodeId: null,
    linkedClipId: null,
    keyframes: retimeKeyframes(clip.keyframes, makeId, {
      keepFrom: leftDur,
      keepTo: r2(clip.duration),
      shift: leftDur,
      fresh: true,
    }),
  }

  return tracks.map((t) => {
    if (t !== target) {
      return t
    }
    const index = t.clips.findIndex((c) => c.id === op.clipId)
    const clips = [...t.clips]
    clips.splice(index, 1, left, right)
    return { ...t, clips }
  })
}
