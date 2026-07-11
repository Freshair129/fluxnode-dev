import { describe, expect, it } from 'vitest'
import { activeViewForRatio, defaultRatioForView } from './horizon'
import {
  MAX_LINEAGE_THREADS,
  buildLineageThreadPath,
  buildStageRowExclusionBands,
  clampPointToRect,
  clipAnchorPoint,
  isPrimedHiddenDashoffset,
  isRectVisibleWithin,
  nodeAnchorPoint,
  rectFromDomRect,
  resolveHorizonRevealRatio,
  resolveLineagePairings,
  resolveOffscreenDirection,
  type Rect,
} from './lineageThread'

function rect(top: number, left: number, width: number, height: number): Rect {
  return { top, left, right: left + width, bottom: top + height, width, height }
}

describe('lineageThread: resolveLineagePairings', () => {
  const clips = [
    { id: 'c1', workflowNodeId: 'n1' },
    { id: 'c2', workflowNodeId: 'n1' },
    { id: 'c3', workflowNodeId: 'n2' },
    { id: 'c4', workflowNodeId: null },
  ]

  it('clip selected -> one thread up to its node', () => {
    const result = resolveLineagePairings(['c1'], [], clips)
    expect(result.pairings).toEqual([{ key: 'c1::n1', clipId: 'c1', nodeId: 'n1' }])
    expect(result.overflowCount).toBe(0)
  })

  it('clip selected with no linked node -> no thread (decision B: silence is correct)', () => {
    const result = resolveLineagePairings(['c4'], [], clips)
    expect(result.pairings).toEqual([])
    expect(result.overflowCount).toBe(0)
  })

  it('node selected -> threads down to every clip referencing it', () => {
    const result = resolveLineagePairings([], ['n1'], clips)
    expect(result.pairings).toEqual([
      { key: 'c1::n1', clipId: 'c1', nodeId: 'n1' },
      { key: 'c2::n1', clipId: 'c2', nodeId: 'n1' },
    ])
  })

  it('node with no clips -> no threads', () => {
    const result = resolveLineagePairings([], ['n3'], clips)
    expect(result.pairings).toEqual([])
  })

  it('multi-select clips draws one thread per clip that has a node', () => {
    const result = resolveLineagePairings(['c1', 'c3', 'c4'], [], clips)
    expect(result.pairings.map((p) => p.clipId)).toEqual(['c1', 'c3'])
  })

  it('clips take priority over nodes if both are somehow non-empty (defensive default)', () => {
    const result = resolveLineagePairings(['c1'], ['n2'], clips)
    expect(result.pairings).toEqual([{ key: 'c1::n1', clipId: 'c1', nodeId: 'n1' }])
  })

  it('empty selection -> no threads', () => {
    expect(resolveLineagePairings([], [], clips).pairings).toEqual([])
  })

  it('caps at MAX_LINEAGE_THREADS and reports overflow', () => {
    const manyClips = Array.from({ length: 20 }, (_, index) => ({ id: `c${index}`, workflowNodeId: 'nBig' }))
    const result = resolveLineagePairings([], ['nBig'], manyClips)
    expect(result.pairings).toHaveLength(MAX_LINEAGE_THREADS)
    expect(result.overflowCount).toBe(20 - MAX_LINEAGE_THREADS)
  })

  it('respects a custom cap', () => {
    const manyClips = Array.from({ length: 5 }, (_, index) => ({ id: `c${index}`, workflowNodeId: 'nBig' }))
    const result = resolveLineagePairings([], ['nBig'], manyClips, 2)
    expect(result.pairings).toHaveLength(2)
    expect(result.overflowCount).toBe(3)
  })
})

describe('lineageThread: anchors', () => {
  it('clip anchor is the top-edge center', () => {
    expect(clipAnchorPoint(rect(100, 50, 40, 20))).toEqual({ x: 70, y: 100 })
  })

  it('node anchor is the bottom-edge center', () => {
    expect(nodeAnchorPoint(rect(10, 200, 60, 30))).toEqual({ x: 230, y: 40 })
  })
})

describe('lineageThread: buildLineageThreadPath', () => {
  it('starts at `from` and ends at `to`', () => {
    const d = buildLineageThreadPath({ x: 100, y: 500 }, { x: 300, y: 100 })
    expect(d.startsWith('M 100 500')).toBe(true)
    expect(d.endsWith('300 100')).toBe(true)
  })

  it('floors the control-point pull so near-coincident endpoints still curve', () => {
    const d = buildLineageThreadPath({ x: 10, y: 10 }, { x: 10, y: 11 })
    // Control points should be pulled by at least THREAD_CONTROL_MIN_PX (24), not ~0.4px.
    expect(d).toContain('C 10 -14')
  })
})

describe('lineageThread: buildStageRowExclusionBands', () => {
  it('returns a sky band above and a ground band below the stage row', () => {
    const bands = buildStageRowExclusionBands(rect(400, 0, 1440, 248), 1440, 900)
    expect(bands.sky).toEqual({ top: 0, left: 0, right: 1440, bottom: 400, width: 1440, height: 400 })
    expect(bands.ground).toEqual({ top: 648, left: 0, right: 1440, bottom: 900, width: 1440, height: 252 })
  })

  it('omits the sky band entirely when the stage row starts at the viewport top', () => {
    const bands = buildStageRowExclusionBands(rect(0, 0, 1440, 248), 1440, 900)
    expect(bands.sky).toBeNull()
    expect(bands.ground?.top).toBe(248)
  })

  it('omits the ground band entirely when the stage row reaches the viewport bottom', () => {
    const bands = buildStageRowExclusionBands(rect(652, 0, 1440, 248), 1440, 900)
    expect(bands.ground).toBeNull()
    expect(bands.sky?.bottom).toBe(652)
  })
})

describe('lineageThread: isRectVisibleWithin', () => {
  const bounds = rect(0, 0, 1000, 500)

  it('null rect is never visible', () => {
    expect(isRectVisibleWithin(null, bounds)).toBe(false)
  })

  it('zero-area rect is never visible', () => {
    expect(isRectVisibleWithin(rect(10, 10, 0, 0), bounds)).toBe(false)
  })

  it('a rect fully inside bounds is visible', () => {
    expect(isRectVisibleWithin(rect(10, 10, 100, 50), bounds)).toBe(true)
  })

  it('a rect scrolled entirely above bounds is not visible', () => {
    expect(isRectVisibleWithin(rect(-200, 10, 100, 50), bounds)).toBe(false)
  })

  it('a rect straddling the bounds edge is (partially) visible', () => {
    expect(isRectVisibleWithin(rect(-10, 10, 100, 50), bounds)).toBe(true)
  })
})

describe('lineageThread: clampPointToRect', () => {
  it('passes through points already inside bounds', () => {
    expect(clampPointToRect({ x: 50, y: 50 }, rect(0, 0, 100, 100))).toEqual({ x: 50, y: 50 })
  })

  it('clamps a point above/left of bounds to the top-left corner', () => {
    expect(clampPointToRect({ x: -50, y: -50 }, rect(0, 0, 100, 100))).toEqual({ x: 0, y: 0 })
  })

  it('clamps a point below/right of bounds to the bottom-right corner', () => {
    expect(clampPointToRect({ x: 500, y: 500 }, rect(0, 0, 100, 100))).toEqual({ x: 100, y: 100 })
  })
})

describe('lineageThread: resolveOffscreenDirection', () => {
  const bounds = rect(0, 0, 100, 100)

  it('returns null for a point inside bounds', () => {
    expect(resolveOffscreenDirection({ x: 50, y: 50 }, bounds)).toBeNull()
  })

  it('detects up', () => {
    expect(resolveOffscreenDirection({ x: 50, y: -40 }, bounds)).toBe('up')
  })

  it('detects down', () => {
    expect(resolveOffscreenDirection({ x: 50, y: 140 }, bounds)).toBe('down')
  })

  it('detects left', () => {
    expect(resolveOffscreenDirection({ x: -40, y: 50 }, bounds)).toBe('left')
  })

  it('detects right', () => {
    expect(resolveOffscreenDirection({ x: 140, y: 50 }, bounds)).toBe('right')
  })

  it('picks the larger-overshoot axis on a corner case', () => {
    // 30px past the top edge vs 5px past the left edge -> vertical wins.
    expect(resolveOffscreenDirection({ x: -5, y: -30 }, bounds)).toBe('up')
  })
})

describe('lineageThread: resolveHorizonRevealRatio', () => {
  it('returns null when the target stratum is already emphasized', () => {
    expect(resolveHorizonRevealRatio(0.62, 'workflow', activeViewForRatio, defaultRatioForView)).toBeNull()
  })

  it('returns the default detent for the target view when the OTHER stratum is emphasized', () => {
    expect(resolveHorizonRevealRatio(0.62, 'timeline', activeViewForRatio, defaultRatioForView)).toBe(
      defaultRatioForView('timeline'),
    )
    expect(resolveHorizonRevealRatio(0.38, 'workflow', activeViewForRatio, defaultRatioForView)).toBe(
      defaultRatioForView('workflow'),
    )
  })
})

describe('lineageThread: rectFromDomRect', () => {
  it('copies the plain-object fields off a DOMRect-shaped value', () => {
    const domRect = { top: 1, left: 2, right: 3, bottom: 4, width: 1, height: 3, x: 2, y: 1, toJSON: () => ({}) }
    expect(rectFromDomRect(domRect)).toEqual({ top: 1, left: 2, right: 3, bottom: 4, width: 1, height: 3 })
  })
})

describe('lineageThread: isPrimedHiddenDashoffset (item 11 visibilitychange re-prime)', () => {
  it('is stuck-primed when dashoffset still equals dasharray (the priming rAF never ran)', () => {
    expect(isPrimedHiddenDashoffset('186.4', '186.4')).toBe(true)
  })

  it('is NOT stuck when dashoffset has already resolved to 0 (the normal drawn-in state)', () => {
    expect(isPrimedHiddenDashoffset('0', '186.4')).toBe(false)
  })

  it('is NOT stuck when dashoffset is mid-tween (differs from dasharray but is not 0 either)', () => {
    // The *specified* value flips straight from length -> '0' the instant the rAF runs (only the
    // *computed*/animating value passes through intermediate numbers) — but guard the general
    // case anyway: anything that isn't exactly equal to dasharray is not the stuck state.
    expect(isPrimedHiddenDashoffset('90', '186.4')).toBe(false)
  })

  it('is NOT stuck when either value is unset (path never primed at all)', () => {
    expect(isPrimedHiddenDashoffset('', '')).toBe(false)
    expect(isPrimedHiddenDashoffset('', '186.4')).toBe(false)
    expect(isPrimedHiddenDashoffset('186.4', '')).toBe(false)
  })

  it('treats a zero-length path (dashoffset === dasharray === "0") as not stuck', () => {
    expect(isPrimedHiddenDashoffset('0', '0')).toBe(false)
  })
})
