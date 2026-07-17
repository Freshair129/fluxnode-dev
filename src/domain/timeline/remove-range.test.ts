import { describe, expect, it } from 'vitest'
import type { Clip, Keyframe, Track } from '../project/types'
import { removeRangeFromTracks, type MakeId } from './remove-range'

function makeIdFactory(): MakeId {
  const counters = { clip: 0, keyframe: 0 }
  return (prefix) => `${prefix}-new-${++counters[prefix]}`
}

function clip(over: Partial<Clip> & Pick<Clip, 'id' | 'startTime' | 'duration'>): Clip {
  const inPoint = over.inPoint ?? 0
  return {
    assetId: 'asset-1',
    trackId: 'track-1',
    inPoint,
    outPoint: over.outPoint ?? inPoint + over.duration,
    speed: 1,
    volume: 1,
    opacity: 1,
    transform: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0, anchorX: 0.5, anchorY: 0.5 },
    keyframes: [],
    linkedClipId: null,
    workflowNodeId: null,
    ...over,
  }
}

function track(clips: Clip[], id = 'track-1'): Track {
  return {
    id,
    name: 'V1',
    type: 'video',
    locked: false,
    visible: true,
    muted: false,
    solo: false,
    volume: 1,
    pan: 0,
    height: 80,
    clips,
  }
}

const op = (over: Partial<Parameters<typeof removeRangeFromTracks>[1]> = {}) => ({
  trackId: 'track-1',
  start: 2,
  end: 4,
  ripple: true,
  ...over,
})

describe('removeRangeFromTracks', () => {
  it('leaves a clip entirely before the range untouched', () => {
    const c = clip({ id: 'a', startTime: 0, duration: 2 }) // [0,2), range [2,4)
    const out = removeRangeFromTracks([track([c])], op(), makeIdFactory())
    expect(out[0].clips).toHaveLength(1)
    expect(out[0].clips[0]).toMatchObject({ id: 'a', startTime: 0, duration: 2 })
  })

  it('slides a later clip left by the gap when ripple is on', () => {
    const c = clip({ id: 'a', startTime: 4, duration: 3 }) // starts at range end
    const out = removeRangeFromTracks([track([c])], op({ ripple: true }), makeIdFactory())
    expect(out[0].clips[0]).toMatchObject({ id: 'a', startTime: 2, duration: 3 })
  })

  it('leaves a later clip in place when ripple is off', () => {
    const c = clip({ id: 'a', startTime: 4, duration: 3 })
    const out = removeRangeFromTracks([track([c])], op({ ripple: false }), makeIdFactory())
    expect(out[0].clips[0]).toMatchObject({ id: 'a', startTime: 4, duration: 3 })
  })

  it('drops a clip fully inside the range', () => {
    const c = clip({ id: 'a', startTime: 2, duration: 2 }) // [2,4) == range
    const out = removeRangeFromTracks([track([c])], op(), makeIdFactory())
    expect(out[0].clips).toHaveLength(0)
  })

  it('trims the tail of a clip that overlaps the range start', () => {
    const c = clip({ id: 'a', startTime: 1, duration: 2, inPoint: 10 }) // [1,3), range [2,4)
    const out = removeRangeFromTracks([track([c])], op(), makeIdFactory())
    expect(out[0].clips[0]).toMatchObject({ id: 'a', startTime: 1, duration: 1, inPoint: 10, outPoint: 11 })
  })

  it('trims the head of a clip that overlaps the range end, repositioning on ripple', () => {
    const c = clip({ id: 'a', startTime: 3, duration: 3, inPoint: 0 }) // [3,6), range [2,4)
    const out = removeRangeFromTracks([track([c])], op({ ripple: true }), makeIdFactory())
    // 1s of the clip (3->4) is consumed; remaining 2s, source in-point advances by 1.
    expect(out[0].clips[0]).toMatchObject({ id: 'a', startTime: 2, duration: 2, inPoint: 1, outPoint: 3 })
  })

  it('splits a clip when the range sits strictly inside it, closing the gap on ripple', () => {
    const c = clip({ id: 'a', startTime: 0, duration: 6, inPoint: 0, outPoint: 6, workflowNodeId: 'node-1' })
    const out = removeRangeFromTracks([track([c])], op({ start: 2, end: 4, ripple: true }), makeIdFactory())
    expect(out[0].clips).toHaveLength(2)
    const [left, right] = out[0].clips
    // left keeps [0,2) source [0,2), retains the workflow link
    expect(left).toMatchObject({ id: 'a', startTime: 0, duration: 2, inPoint: 0, outPoint: 2, workflowNodeId: 'node-1' })
    // right butts against left at t=2, source resumes at 4, fresh id, link cleared
    expect(right).toMatchObject({ id: 'clip-new-1', startTime: 2, duration: 2, inPoint: 4, outPoint: 6, workflowNodeId: null })
  })

  it('leaves the gap open on a mid-clip split when ripple is off', () => {
    const c = clip({ id: 'a', startTime: 0, duration: 6 })
    const out = removeRangeFromTracks([track([c])], op({ start: 2, end: 4, ripple: false }), makeIdFactory())
    expect(out[0].clips[1]).toMatchObject({ startTime: 4, duration: 2 })
  })

  it('ripples multiple later clips without introducing overlap', () => {
    const a = clip({ id: 'a', startTime: 0, duration: 2 })
    const b = clip({ id: 'b', startTime: 4, duration: 2 })
    const d = clip({ id: 'd', startTime: 6, duration: 2 })
    const out = removeRangeFromTracks([track([a, b, d])], op({ start: 2, end: 4, ripple: true }), makeIdFactory())
    const byId = Object.fromEntries(out[0].clips.map((c) => [c.id, c]))
    expect(byId.a).toMatchObject({ startTime: 0, duration: 2 }) // ends at 2
    expect(byId.b).toMatchObject({ startTime: 2, duration: 2 }) // butts at 2, ends at 4
    expect(byId.d).toMatchObject({ startTime: 4, duration: 2 }) // no overlap
  })

  it('partitions and retimes keyframes across a split', () => {
    const kfs: Keyframe[] = [
      { id: 'k1', time: 1, property: 'opacity', value: 0.5, easing: 'linear' },
      { id: 'k2', time: 5, property: 'opacity', value: 1, easing: 'linear' },
    ]
    const c = clip({ id: 'a', startTime: 0, duration: 6, keyframes: kfs })
    const out = removeRangeFromTracks([track([c])], op({ start: 2, end: 4, ripple: true }), makeIdFactory())
    const [left, right] = out[0].clips
    expect(left.keyframes).toEqual([{ id: 'k1', time: 1, property: 'opacity', value: 0.5, easing: 'linear' }])
    // k2 at t=5 sits 1s into the right fragment (source 4->5) -> retimed to t=1, fresh id
    expect(right.keyframes).toEqual([{ id: 'keyframe-new-1', time: 1, property: 'opacity', value: 1, easing: 'linear' }])
  })

  it('returns the same array reference for an unknown track or empty range', () => {
    const tracks = [track([clip({ id: 'a', startTime: 0, duration: 2 })])]
    expect(removeRangeFromTracks(tracks, op({ trackId: 'nope' }), makeIdFactory())).toBe(tracks)
    expect(removeRangeFromTracks(tracks, op({ start: 3, end: 3 }), makeIdFactory())).toBe(tracks)
  })
})
