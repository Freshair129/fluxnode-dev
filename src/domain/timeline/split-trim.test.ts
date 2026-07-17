import { describe, expect, it } from 'vitest'
import type { Clip, Keyframe, Track } from '../project/types'
import type { MakeId } from './remove-range'
import { splitClipInTracks } from './split-clip'
import { trimClipInTracks } from './trim-clip'

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

function track(clips: Clip[]): Track {
  return { id: 'track-1', name: 'V1', type: 'video', locked: false, visible: true, muted: false, solo: false, volume: 1, pan: 0, height: 80, clips }
}

describe('splitClipInTracks', () => {
  it('splits a clip at an interior time, keeping id+link on the left and minting the right', () => {
    const c = clip({ id: 'a', startTime: 0, duration: 6, inPoint: 0, outPoint: 6, workflowNodeId: 'node-1' })
    const out = splitClipInTracks([track([c])], { clipId: 'a', time: 2 }, makeIdFactory())
    expect(out[0].clips).toHaveLength(2)
    const [left, right] = out[0].clips
    expect(left).toMatchObject({ id: 'a', startTime: 0, duration: 2, inPoint: 0, outPoint: 2, workflowNodeId: 'node-1' })
    expect(right).toMatchObject({ id: 'clip-new-1', startTime: 2, duration: 4, inPoint: 2, outPoint: 6, workflowNodeId: null })
  })

  it('is a no-op when the split time is at or outside the clip bounds', () => {
    const tracks = [track([clip({ id: 'a', startTime: 1, duration: 3 })])]
    expect(splitClipInTracks(tracks, { clipId: 'a', time: 1 }, makeIdFactory())).toBe(tracks)
    expect(splitClipInTracks(tracks, { clipId: 'a', time: 4 }, makeIdFactory())).toBe(tracks)
    expect(splitClipInTracks(tracks, { clipId: 'a', time: 9 }, makeIdFactory())).toBe(tracks)
  })

  it('partitions keyframes across the split, retiming the right fragment', () => {
    const kfs: Keyframe[] = [
      { id: 'k1', time: 1, property: 'opacity', value: 0.2, easing: 'linear' },
      { id: 'k2', time: 4, property: 'opacity', value: 0.9, easing: 'linear' },
    ]
    const c = clip({ id: 'a', startTime: 0, duration: 6, keyframes: kfs })
    const [left, right] = splitClipInTracks([track([c])], { clipId: 'a', time: 2 }, makeIdFactory())[0].clips
    expect(left.keyframes).toEqual([{ id: 'k1', time: 1, property: 'opacity', value: 0.2, easing: 'linear' }])
    expect(right.keyframes).toEqual([{ id: 'keyframe-new-1', time: 2, property: 'opacity', value: 0.9, easing: 'linear' }])
  })

  it('returns the same reference for an unknown clip', () => {
    const tracks = [track([clip({ id: 'a', startTime: 0, duration: 4 })])]
    expect(splitClipInTracks(tracks, { clipId: 'nope', time: 2 }, makeIdFactory())).toBe(tracks)
  })
})

describe('trimClipInTracks', () => {
  const id = makeIdFactory()

  it('trims the tail shorter (negative end delta)', () => {
    const c = clip({ id: 'a', startTime: 0, duration: 4, inPoint: 0, outPoint: 4 })
    const out = trimClipInTracks([track([c])], { clipId: 'a', edge: 'end', delta: -1 }, id)
    expect(out[0].clips[0]).toMatchObject({ startTime: 0, duration: 3, inPoint: 0, outPoint: 3 })
  })

  it('extends the tail (positive end delta)', () => {
    const c = clip({ id: 'a', startTime: 0, duration: 4, inPoint: 0, outPoint: 4 })
    const out = trimClipInTracks([track([c])], { clipId: 'a', edge: 'end', delta: 1 }, id)
    expect(out[0].clips[0]).toMatchObject({ duration: 5, outPoint: 5 })
  })

  it('trims the head inward (positive start delta)', () => {
    const c = clip({ id: 'a', startTime: 3, duration: 4, inPoint: 2, outPoint: 6 })
    const out = trimClipInTracks([track([c])], { clipId: 'a', edge: 'start', delta: 1 }, id)
    expect(out[0].clips[0]).toMatchObject({ startTime: 4, inPoint: 3, duration: 3, outPoint: 6 })
  })

  it('extends the head (negative start delta) when source is available', () => {
    const c = clip({ id: 'a', startTime: 3, duration: 4, inPoint: 2, outPoint: 6 })
    const out = trimClipInTracks([track([c])], { clipId: 'a', edge: 'start', delta: -1 }, id)
    expect(out[0].clips[0]).toMatchObject({ startTime: 2, inPoint: 1, duration: 5 })
  })

  it('drops keyframes that fall outside the trimmed tail', () => {
    const kfs: Keyframe[] = [
      { id: 'k1', time: 1, property: 'opacity', value: 0.3, easing: 'linear' },
      { id: 'k2', time: 3.5, property: 'opacity', value: 1, easing: 'linear' },
    ]
    const c = clip({ id: 'a', startTime: 0, duration: 4, keyframes: kfs })
    const out = trimClipInTracks([track([c])], { clipId: 'a', edge: 'end', delta: -2 }, id)
    expect(out[0].clips[0].keyframes).toEqual([{ id: 'k1', time: 1, property: 'opacity', value: 0.3, easing: 'linear' }])
  })

  it('is a no-op when the trim would collapse the clip or run before the source start', () => {
    const tracks = [track([clip({ id: 'a', startTime: 0, duration: 2, inPoint: 1, outPoint: 3 })])]
    expect(trimClipInTracks(tracks, { clipId: 'a', edge: 'end', delta: -2 }, id)).toBe(tracks) // duration -> 0
    expect(trimClipInTracks(tracks, { clipId: 'a', edge: 'start', delta: -2 }, id)).toBe(tracks) // inPoint -> -1
    expect(trimClipInTracks(tracks, { clipId: 'a', edge: 'end', delta: 0 }, id)).toBe(tracks) // no move
    expect(trimClipInTracks(tracks, { clipId: 'nope', edge: 'end', delta: 1 }, id)).toBe(tracks) // unknown clip
  })
})
