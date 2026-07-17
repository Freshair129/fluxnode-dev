import { describe, expect, it } from 'vitest'
import type { Clip, Track } from '../project/types'
import type { MakeId } from '../timeline/remove-range'
import { applyProposalToTracks } from './proposals'
import { detectSilences, planSilenceCuts, type Transcript } from './rough-cut'

function makeIdFactory(): MakeId {
  const counters = { clip: 0, keyframe: 0 }
  return (prefix) => `${prefix}-${++counters[prefix]}`
}

function clip(over: Partial<Clip> & Pick<Clip, 'id' | 'startTime' | 'duration'>): Clip {
  const inPoint = over.inPoint ?? 0
  return {
    assetId: 'a', trackId: 'track-1', inPoint, outPoint: over.outPoint ?? inPoint + over.duration,
    speed: 1, volume: 1, opacity: 1,
    transform: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0, anchorX: 0.5, anchorY: 0.5 },
    keyframes: [], linkedClipId: null, workflowNodeId: null, ...over,
  }
}

function track(clips: Clip[]): Track {
  return { id: 'track-1', name: 'V1', type: 'video', locked: false, visible: true, muted: false, solo: false, volume: 1, pan: 0, height: 80, clips }
}

// Speech at [0,2] and [5,7]; a 3s gap between and a 3s tail (clip runs to 10s).
const transcript: Transcript = {
  text: 'hello world',
  segments: [
    { start: 0, end: 2, text: 'hello' },
    { start: 5, end: 7, text: 'world' },
  ],
}

describe('detectSilences', () => {
  it('finds the between-word gap and the trailing silence, padded toward speech', () => {
    const cuts = detectSilences(transcript.segments, {
      minSilenceSec: 0.8, paddingSec: 0.15, ripple: true, includeLeading: true, includeTrailing: true,
    })
    expect(cuts).toEqual([
      { start: 2.15, end: 4.85 }, // gap [2,5] padded both sides
      { start: 7.15, end: Infinity }, // trailing [7,∞), padded on the speech side only
    ])
  })

  it('ignores gaps shorter than minSilenceSec', () => {
    const segs = [
      { start: 0, end: 2, text: 'a' },
      { start: 2.3, end: 4, text: 'b' }, // 0.3s gap
    ]
    const cuts = detectSilences(segs, { minSilenceSec: 0.8, paddingSec: 0, ripple: true, includeLeading: false, includeTrailing: false })
    expect(cuts).toEqual([])
  })

  it('adds a leading silence when speech does not start at 0', () => {
    const segs = [{ start: 3, end: 5, text: 'a' }]
    const cuts = detectSilences(segs, { minSilenceSec: 0.8, paddingSec: 0.15, ripple: true, includeLeading: true, includeTrailing: false })
    expect(cuts).toEqual([{ start: 0, end: 2.85 }]) // [0,3] padded on the speech side only
  })
})

describe('planSilenceCuts', () => {
  const oneClipTrack = track([clip({ id: 'c1', startTime: 0, duration: 10, inPoint: 0, outPoint: 10 })])

  it('emits remove_range proposals latest-first so ripple composes correctly', () => {
    const plan = planSilenceCuts(oneClipTrack, transcript)
    expect(plan.map((p) => p.action)).toEqual(['timeline_remove_range', 'timeline_remove_range'])
    expect(plan.map((p) => (p.args as { start: number }).start)).toEqual([7.15, 2.15]) // descending
    expect(plan[1].args).toMatchObject({ trackId: 'track-1', start: 2.15, end: 4.85, ripple: true })
    expect(plan[0].args).toMatchObject({ start: 7.15, end: 10 }) // trailing clipped to the clip's outPoint
  })

  it('composes into the right total when applied through the shared executor (proves ordering)', () => {
    const plan = planSilenceCuts(oneClipTrack, transcript)
    const id = makeIdFactory()
    const after = plan.reduce((tracks, p) => applyProposalToTracks(tracks, p, id), [oneClipTrack])
    const totalAfter = after[0].clips.reduce((sum, c) => sum + c.duration, 0)
    // 10s of clip minus the two cuts (2.7s + 2.85s) = 4.45s. Only true if cuts apply latest-first.
    expect(totalAfter).toBeCloseTo(4.45, 2)
    // ripple closed the gaps: nothing extends past the new end.
    const maxEnd = Math.max(...after[0].clips.map((c) => c.startTime + c.duration))
    expect(maxEnd).toBeCloseTo(4.45, 2)
  })

  it('returns no proposals when there is no qualifying silence', () => {
    const wall: Transcript = { text: 'x', segments: [{ start: 0, end: 10, text: 'x' }] }
    expect(planSilenceCuts(oneClipTrack, wall, { includeTrailing: false })).toEqual([])
  })
})
