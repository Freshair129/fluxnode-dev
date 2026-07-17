import { describe, expect, it } from 'vitest'
import type { Clip, FluxNodeProject, Track } from '../project/types'
import { computeClipGhosts } from './ghost'
import type { Proposal } from './proposals'

function clip(over: Partial<Clip> & Pick<Clip, 'id' | 'startTime' | 'duration'>): Clip {
  const inPoint = over.inPoint ?? 0
  return {
    assetId: 'a', trackId: 'track-1', inPoint, outPoint: over.outPoint ?? inPoint + over.duration,
    speed: 1, volume: 1, opacity: 1,
    transform: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0, anchorX: 0.5, anchorY: 0.5 },
    keyframes: [], linkedClipId: null, workflowNodeId: null, ...over,
  }
}
function project(clips: Clip[]): FluxNodeProject {
  const track: Track = { id: 'track-1', name: 'V1', type: 'video', locked: false, visible: true, muted: false, solo: false, volume: 1, pan: 0, height: 80, clips }
  return { timeline: { tracks: [track], playhead: 0, inPoint: null, outPoint: null, zoom: 1, scrollX: 0 } } as FluxNodeProject
}

const p = (action: string, args: Record<string, unknown>): Proposal => ({ action, args, site: 'frontend', summary: '' })

describe('computeClipGhosts', () => {
  it('marks a mid-clip removal as a trim on the left plus one new (split-off) clip', () => {
    const g = computeClipGhosts(project([clip({ id: 'a', startTime: 0, duration: 6, outPoint: 6 })]), [
      p('timeline_remove_range', { trackId: 'track-1', start: 2, end: 4, ripple: true }),
    ])
    expect(g.clips.get('a')).toEqual({ kind: 'trimmed', detail: '6s → 2s' })
    expect(g.newClips).toHaveLength(1)
    expect(g.newClips[0]).toMatchObject({ trackId: 'track-1', startTime: 2 })
  })

  it('marks a fully-covered clip as removed', () => {
    const g = computeClipGhosts(project([clip({ id: 'a', startTime: 2, duration: 2 })]), [
      p('timeline_remove_range', { trackId: 'track-1', start: 2, end: 4, ripple: true }),
    ])
    expect(g.clips.get('a')).toEqual({ kind: 'removed', detail: 'will be cut' })
    expect(g.removedCount).toBe(1)
  })

  it('marks a trim', () => {
    const g = computeClipGhosts(project([clip({ id: 'a', startTime: 0, duration: 4, outPoint: 4 })]), [
      p('timeline_trim_clip', { clipId: 'a', edge: 'end', delta: -1 }),
    ])
    expect(g.clips.get('a')).toEqual({ kind: 'trimmed', detail: '4s → 3s' })
  })

  it('marks a move', () => {
    const g = computeClipGhosts(project([clip({ id: 'a', startTime: 0, duration: 2 })]), [
      p('timeline_move_clip', { clipId: 'a', startTime: 5 }),
    ])
    expect(g.clips.get('a')).toEqual({ kind: 'moved', detail: '→ 5s' })
  })

  it('marks a property change', () => {
    const g = computeClipGhosts(project([clip({ id: 'a', startTime: 0, duration: 2, volume: 1 })]), [
      p('timeline_set_clip_property', { clipId: 'a', property: 'volume', value: 0.5 }),
    ])
    expect(g.clips.get('a')).toEqual({ kind: 'changed', detail: 'volume 1 → 0.5' })
  })

  it('returns an empty preview for no supported/effective proposals', () => {
    const g = computeClipGhosts(project([clip({ id: 'a', startTime: 0, duration: 2 })]), [])
    expect(g.clips.size).toBe(0)
    expect(g.newClips).toHaveLength(0)
    expect(g.removedCount).toBe(0)
  })
})
