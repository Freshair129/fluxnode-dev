import type { Clip, Keyframe, Track } from '../project/types'

/**
 * Timeline op vocabulary — pure, side-effect-free geometry shared by the copilot ghost preview
 * and the store executor (`applyGroupedMutations`). Keeping one implementation for both is what
 * prevents preview/executor drift (see docs/copilot-approve-gate-and-timeline-edits-scope.md §3).
 *
 * `timeline_remove_range`: delete the timeline window [start, end) on one track. When `ripple`,
 * later clips slide left by the removed width so the gap closes; otherwise the gap is left open.
 *
 * Source-time mapping follows the existing `splitSelectedClip` convention (1 timeline-second == 1
 * source-second; clip `speed` is not applied to in/out here). Clips are assumed sorted and
 * non-overlapping on a track, as the store maintains them.
 */
export interface RemoveRangeOp {
  trackId: string
  start: number
  end: number
  ripple: boolean
}

/** Factory for fresh, unique ids — injected so the op stays pure and deterministic under test. */
export type MakeId = (prefix: 'clip' | 'keyframe') => string

const r2 = (n: number): number => Number(n.toFixed(2))

function retimeKeyframes(
  keyframes: Keyframe[],
  makeId: MakeId,
  { keepFrom, keepTo, shift, fresh }: { keepFrom: number; keepTo: number; shift: number; fresh: boolean },
): Keyframe[] {
  return keyframes
    .filter((kf) => kf.time >= keepFrom - 1e-9 && kf.time <= keepTo + 1e-9)
    .map((kf) => ({
      ...kf,
      id: fresh ? makeId('keyframe') : kf.id,
      time: Math.max(0, r2(kf.time - shift)),
    }))
    .sort((a, b) => a.time - b.time)
}

/**
 * Apply a remove-range op to a track list, returning a new list. Unaffected tracks are returned
 * by reference (structural sharing). Returns the input unchanged if `trackId` is unknown or the
 * range is empty/inverted.
 */
export function removeRangeFromTracks(tracks: Track[], op: RemoveRangeOp, makeId: MakeId): Track[] {
  const start = Math.min(op.start, op.end)
  const end = Math.max(op.start, op.end)
  const gap = r2(end - start)
  if (gap <= 0 || !tracks.some((track) => track.id === op.trackId)) {
    return tracks
  }

  return tracks.map((track) => {
    if (track.id !== op.trackId) {
      return track
    }

    const next: Clip[] = []
    for (const clip of track.clips) {
      const s = clip.startTime
      const e = r2(s + clip.duration)

      // 1. Entirely before the range — untouched.
      if (e <= start) {
        next.push(clip)
        continue
      }
      // 2. Entirely after the range — slide left on ripple, otherwise untouched.
      if (s >= end) {
        next.push(op.ripple ? { ...clip, startTime: r2(s - gap) } : clip)
        continue
      }
      // 3. Fully covered by the range — dropped.
      if (s >= start && e <= end) {
        continue
      }
      // 4. Range strictly inside the clip — split into a left remainder + a fresh right remainder.
      if (s < start && e > end) {
        const leftDur = r2(start - s)
        next.push({
          ...clip,
          duration: leftDur,
          outPoint: r2(clip.inPoint + leftDur),
          keyframes: retimeKeyframes(clip.keyframes, makeId, { keepFrom: 0, keepTo: leftDur, shift: 0, fresh: false }),
        })
        const rightConsumedFromClipStart = r2(end - s)
        next.push({
          ...clip,
          id: makeId('clip'),
          startTime: op.ripple ? start : end,
          inPoint: r2(clip.inPoint + rightConsumedFromClipStart),
          duration: r2(e - end),
          outPoint: clip.outPoint,
          workflowNodeId: null,
          linkedClipId: null,
          keyframes: retimeKeyframes(clip.keyframes, makeId, {
            keepFrom: rightConsumedFromClipStart,
            keepTo: r2(e - s),
            shift: rightConsumedFromClipStart,
            fresh: true,
          }),
        })
        continue
      }
      // 5a. Tail of the clip overlaps the range — trim the tail.
      if (s < start && e <= end) {
        const leftDur = r2(start - s)
        next.push({
          ...clip,
          duration: leftDur,
          outPoint: r2(clip.inPoint + leftDur),
          keyframes: retimeKeyframes(clip.keyframes, makeId, { keepFrom: 0, keepTo: leftDur, shift: 0, fresh: false }),
        })
        continue
      }
      // 5b. Head of the clip overlaps the range — trim the head (and reposition on ripple).
      const consumed = r2(end - s)
      next.push({
        ...clip,
        startTime: op.ripple ? start : end,
        inPoint: r2(clip.inPoint + consumed),
        duration: r2(e - end),
        outPoint: clip.outPoint,
        keyframes: retimeKeyframes(clip.keyframes, makeId, { keepFrom: consumed, keepTo: r2(e - s), shift: consumed, fresh: false }),
      })
    }

    next.sort((a, b) => a.startTime - b.startTime)
    return { ...track, clips: next }
  })
}
