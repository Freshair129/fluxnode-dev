import { describe, expect, it } from 'vitest'
import {
  effectivePlaybackRate,
  hasAnySolo,
  isClipActiveAtTime,
  resolveActivePlayback,
  resolveClipGain,
  sourceTimeForClip,
  timelineDuration,
  timelineRange,
} from './clip-scheduling'
import type { TimelineAudioClip } from './types'

function makeClip(overrides: Partial<TimelineAudioClip> = {}): TimelineAudioClip {
  return {
    id: 'c1',
    sourcePath: 'C:/media/a.wav',
    startTime: 10,
    inPoint: 2,
    outPoint: 6,
    volume: 1,
    ...overrides,
  }
}

describe('timelineDuration / timelineRange', () => {
  it('uses trimmed source span at 1x speed', () => {
    const clip = makeClip()
    expect(timelineDuration(clip)).toBe(4)
    expect(timelineRange(clip)).toEqual({ start: 10, end: 14 })
  })

  it('compresses duration by speed', () => {
    const clip = makeClip({ speed: 2 })
    expect(timelineDuration(clip)).toBe(2)
    expect(timelineRange(clip)).toEqual({ start: 10, end: 12 })
  })

  it('treats invalid speed as 1x', () => {
    expect(timelineDuration(makeClip({ speed: 0 }))).toBe(4)
    expect(timelineDuration(makeClip({ speed: -3 }))).toBe(4)
  })
})

describe('isClipActiveAtTime', () => {
  const clip = makeClip() // timeline [10, 14)

  it('is active at the start (inclusive)', () => {
    expect(isClipActiveAtTime(clip, 10)).toBe(true)
  })

  it('is active mid-range', () => {
    expect(isClipActiveAtTime(clip, 12.5)).toBe(true)
  })

  it('is inactive before start', () => {
    expect(isClipActiveAtTime(clip, 9.99)).toBe(false)
  })

  it('is inactive at the end (exclusive)', () => {
    expect(isClipActiveAtTime(clip, 14)).toBe(false)
  })
})

describe('sourceTimeForClip', () => {
  it('maps timeline time to source time at 1x', () => {
    const clip = makeClip() // start 10, in 2
    expect(sourceTimeForClip(clip, 10)).toBe(2)
    expect(sourceTimeForClip(clip, 12)).toBe(4)
  })

  it('accounts for speed', () => {
    const clip = makeClip({ speed: 2 }) // 1s timeline -> 2s source
    expect(sourceTimeForClip(clip, 11)).toBe(4)
  })

  it('clamps to inPoint before the clip and outPoint after', () => {
    const clip = makeClip()
    expect(sourceTimeForClip(clip, 5)).toBe(2) // before -> inPoint
    expect(sourceTimeForClip(clip, 100)).toBe(6) // after -> outPoint
  })
})

describe('effectivePlaybackRate', () => {
  it('multiplies clip speed and timeline rate', () => {
    expect(effectivePlaybackRate(makeClip({ speed: 1.5 }), 2)).toBe(3)
  })

  it('falls back to 1 for invalid rates', () => {
    expect(effectivePlaybackRate(makeClip({ speed: 0 }), 1)).toBe(1)
    expect(effectivePlaybackRate(makeClip(), 0)).toBe(1)
  })
})

describe('resolveClipGain / mute / solo', () => {
  it('combines clip, track and master volume', () => {
    const clip = makeClip({ volume: 0.5, trackVolume: 0.5 })
    expect(resolveClipGain(clip, 0.8, false)).toBeCloseTo(0.2)
  })

  it('silences muted tracks', () => {
    const clip = makeClip({ trackMuted: true })
    expect(resolveClipGain(clip, 1, false)).toBe(0)
  })

  it('silences non-soloed clips when a solo exists', () => {
    const clip = makeClip({ trackSolo: false })
    expect(resolveClipGain(clip, 1, true)).toBe(0)
  })

  it('keeps soloed clips audible', () => {
    const clip = makeClip({ trackSolo: true })
    expect(resolveClipGain(clip, 1, true)).toBe(1)
  })

  it('clamps out-of-range volumes', () => {
    const clip = makeClip({ volume: 5, trackVolume: 5 })
    expect(resolveClipGain(clip, 5, false)).toBe(1)
  })
})

describe('hasAnySolo', () => {
  it('detects a soloed clip', () => {
    expect(hasAnySolo([makeClip(), makeClip({ id: 'c2', trackSolo: true })])).toBe(true)
  })

  it('is false with no solos', () => {
    expect(hasAnySolo([makeClip(), makeClip({ id: 'c2' })])).toBe(false)
  })
})

describe('resolveActivePlayback', () => {
  it('returns only active, audible clips with resolved state', () => {
    const a = makeClip({ id: 'a', startTime: 0, inPoint: 0, outPoint: 4, volume: 1 })
    const b = makeClip({ id: 'b', startTime: 10, inPoint: 0, outPoint: 4, volume: 1 })
    const muted = makeClip({ id: 'm', startTime: 0, inPoint: 0, outPoint: 4, trackMuted: true })

    const result = resolveActivePlayback([a, b, muted], 2, 1)
    expect(result).toHaveLength(1)
    expect(result[0].clip.id).toBe('a')
    expect(result[0].sourceTime).toBe(2)
    expect(result[0].gain).toBe(1)
    expect(result[0].playbackRate).toBe(1)
  })

  it('respects solo across the active set', () => {
    const a = makeClip({ id: 'a', startTime: 0, inPoint: 0, outPoint: 4 })
    const soloed = makeClip({ id: 's', startTime: 0, inPoint: 0, outPoint: 4, trackSolo: true })
    const result = resolveActivePlayback([a, soloed], 1, 1)
    expect(result.map((r) => r.clip.id)).toEqual(['s'])
  })

  it('applies timeline rate to playbackRate', () => {
    const a = makeClip({ id: 'a', startTime: 0, inPoint: 0, outPoint: 8, speed: 1 })
    const result = resolveActivePlayback([a], 1, 1, 2)
    expect(result[0].playbackRate).toBe(2)
  })
})
