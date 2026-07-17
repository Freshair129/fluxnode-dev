import { describe, expect, it } from 'vitest'
import type { Clip, Track } from '../project/types'
import type { MakeId } from './remove-range'
import { addClipInTracks, moveClipInTracks, setClipPropertyInTracks } from './clip-edits'

function makeIdFactory(): MakeId {
  const counters = { clip: 0, keyframe: 0 }
  return (prefix) => `${prefix}-new-${++counters[prefix]}`
}
const id = makeIdFactory()

function clip(over: Partial<Clip> & Pick<Clip, 'id' | 'startTime' | 'duration'>): Clip {
  const inPoint = over.inPoint ?? 0
  return {
    assetId: 'a', trackId: over.trackId ?? 'track-1', inPoint, outPoint: over.outPoint ?? inPoint + over.duration,
    speed: 1, volume: 1, opacity: 1,
    transform: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0, anchorX: 0.5, anchorY: 0.5 },
    keyframes: [], linkedClipId: null, workflowNodeId: null, ...over,
  }
}
function track(trackId: string, clips: Clip[]): Track {
  return { id: trackId, name: trackId, type: 'video', locked: false, visible: true, muted: false, solo: false, volume: 1, pan: 0, height: 80, clips }
}

describe('moveClipInTracks', () => {
  it('repositions a clip on the same track and re-sorts', () => {
    const t = track('track-1', [clip({ id: 'a', startTime: 0, duration: 2 }), clip({ id: 'b', startTime: 3, duration: 2 })])
    const out = moveClipInTracks([t], { clipId: 'a', startTime: 5 }, id)
    expect(out[0].clips.map((c) => c.id)).toEqual(['b', 'a']) // re-sorted by startTime
    expect(out[0].clips.find((c) => c.id === 'a')!.startTime).toBe(5)
  })

  it('moves a clip across tracks, updating trackId', () => {
    const t1 = track('track-1', [clip({ id: 'a', startTime: 0, duration: 2 })])
    const t2 = track('track-2', [])
    const out = moveClipInTracks([t1, t2], { clipId: 'a', startTime: 1, trackId: 'track-2' }, id)
    expect(out[0].clips).toHaveLength(0)
    expect(out[1].clips).toHaveLength(1)
    expect(out[1].clips[0]).toMatchObject({ id: 'a', trackId: 'track-2', startTime: 1 })
  })

  it('is a no-op (same reference) for an unknown clip or unchanged position', () => {
    const tracks = [track('track-1', [clip({ id: 'a', startTime: 2, duration: 2 })])]
    expect(moveClipInTracks(tracks, { clipId: 'nope', startTime: 5 }, id)).toBe(tracks)
    expect(moveClipInTracks(tracks, { clipId: 'a', startTime: 2 }, id)).toBe(tracks)
  })
})

describe('addClipInTracks', () => {
  it('appends a new clip with a fresh id and sane defaults, sorted by start', () => {
    const t = track('track-1', [clip({ id: 'a', startTime: 0, duration: 2 })])
    const out = addClipInTracks([t], { trackId: 'track-1', assetId: 'asset-9', startTime: 1, duration: 3 }, id)
    expect(out[0].clips.map((c) => c.id)).toEqual(['a', 'clip-new-1'])
    expect(out[0].clips[1]).toMatchObject({ assetId: 'asset-9', startTime: 1, duration: 3, inPoint: 0, outPoint: 3, speed: 1 })
  })

  it('is a no-op for an unknown track or non-positive duration', () => {
    const tracks = [track('track-1', [])]
    expect(addClipInTracks(tracks, { trackId: 'nope', assetId: 'x', startTime: 0, duration: 2 }, id)).toBe(tracks)
    expect(addClipInTracks(tracks, { trackId: 'track-1', assetId: 'x', startTime: 0, duration: 0 }, id)).toBe(tracks)
  })
})

describe('setClipPropertyInTracks', () => {
  it('sets an allowed property', () => {
    const t = track('track-1', [clip({ id: 'a', startTime: 0, duration: 2, volume: 1 })])
    const out = setClipPropertyInTracks([t], { clipId: 'a', property: 'volume', value: 0.5 }, id)
    expect(out[0].clips[0].volume).toBe(0.5)
  })

  it('clamps opacity to [0,1]', () => {
    const t = track('track-1', [clip({ id: 'a', startTime: 0, duration: 2 })])
    expect(setClipPropertyInTracks([t], { clipId: 'a', property: 'opacity', value: 2 }, id)[0].clips[0].opacity).toBe(1)
    expect(setClipPropertyInTracks([t], { clipId: 'a', property: 'opacity', value: -1 }, id)[0].clips[0].opacity).toBe(0)
  })

  it('is a no-op (same reference) for unknown clip, unchanged value, or invalid speed', () => {
    const tracks = [track('track-1', [clip({ id: 'a', startTime: 0, duration: 2, volume: 1, speed: 1 })])]
    expect(setClipPropertyInTracks(tracks, { clipId: 'nope', property: 'volume', value: 0.5 }, id)).toBe(tracks)
    expect(setClipPropertyInTracks(tracks, { clipId: 'a', property: 'volume', value: 1 }, id)).toBe(tracks)
    expect(setClipPropertyInTracks(tracks, { clipId: 'a', property: 'speed', value: -1 }, id)).toBe(tracks)
  })
})
