import { describe, expect, it } from 'vitest'
import {
  DEFAULT_HORIZON_RATIO,
  HORIZON_RATIO_DETENTS,
  HORIZON_RATIO_MAX,
  HORIZON_RATIO_MIN,
  HORIZON_RATIO_TIMELINE_DEFAULT,
  HORIZON_RATIO_WORKFLOW_DEFAULT,
  clampHorizonRatio,
  nextHorizonDetent,
  snapToHorizonDetent,
  toggleHorizonDefaultRatio,
} from './horizon'

describe('horizon: clampHorizonRatio', () => {
  it('passes through values already inside the allowed range', () => {
    expect(clampHorizonRatio(0.5)).toBe(0.5)
    expect(clampHorizonRatio(HORIZON_RATIO_MIN)).toBe(HORIZON_RATIO_MIN)
    expect(clampHorizonRatio(HORIZON_RATIO_MAX)).toBe(HORIZON_RATIO_MAX)
  })

  it('clamps values outside the range to the nearest bound', () => {
    expect(clampHorizonRatio(0)).toBe(HORIZON_RATIO_MIN)
    expect(clampHorizonRatio(-1)).toBe(HORIZON_RATIO_MIN)
    expect(clampHorizonRatio(1)).toBe(HORIZON_RATIO_MAX)
    expect(clampHorizonRatio(42)).toBe(HORIZON_RATIO_MAX)
  })

  it('falls back to the default ratio for non-finite input (corrupt saves)', () => {
    expect(clampHorizonRatio(Number.NaN)).toBe(DEFAULT_HORIZON_RATIO)
    expect(clampHorizonRatio(Number.POSITIVE_INFINITY)).toBe(DEFAULT_HORIZON_RATIO)
    expect(clampHorizonRatio(Number.NEGATIVE_INFINITY)).toBe(DEFAULT_HORIZON_RATIO)
  })
})

describe('horizon: snapToHorizonDetent', () => {
  it('snaps to a detent when within the ±3% tolerance', () => {
    expect(snapToHorizonDetent(0.6)).toBe(0.62)
    expect(snapToHorizonDetent(0.64)).toBe(0.62)
    expect(snapToHorizonDetent(0.79)).toBe(0.8)
    expect(snapToHorizonDetent(0.4)).toBe(0.38)
    expect(snapToHorizonDetent(0.22)).toBe(0.2)
  })

  it('snaps exactly at the tolerance boundary', () => {
    expect(snapToHorizonDetent(0.65)).toBe(0.62)
    expect(snapToHorizonDetent(0.59)).toBe(0.62)
  })

  it('returns null when no detent is within tolerance (free position kept)', () => {
    expect(snapToHorizonDetent(0.5)).toBeNull()
    expect(snapToHorizonDetent(0.71)).toBeNull()
    expect(snapToHorizonDetent(0.29)).toBeNull()
  })

  it('returns the detent itself when the ratio already sits on one', () => {
    for (const detent of HORIZON_RATIO_DETENTS) {
      expect(snapToHorizonDetent(detent)).toBe(detent)
    }
  })
})

describe('horizon: toggleHorizonDefaultRatio (Tab flip)', () => {
  it('flips between the two default detents', () => {
    expect(toggleHorizonDefaultRatio(HORIZON_RATIO_WORKFLOW_DEFAULT)).toBe(HORIZON_RATIO_TIMELINE_DEFAULT)
    expect(toggleHorizonDefaultRatio(HORIZON_RATIO_TIMELINE_DEFAULT)).toBe(HORIZON_RATIO_WORKFLOW_DEFAULT)
  })

  it('sends any sky-emphasized ratio to the timeline default and vice versa', () => {
    expect(toggleHorizonDefaultRatio(0.8)).toBe(HORIZON_RATIO_TIMELINE_DEFAULT)
    expect(toggleHorizonDefaultRatio(0.55)).toBe(HORIZON_RATIO_TIMELINE_DEFAULT)
    expect(toggleHorizonDefaultRatio(0.2)).toBe(HORIZON_RATIO_WORKFLOW_DEFAULT)
    expect(toggleHorizonDefaultRatio(0.45)).toBe(HORIZON_RATIO_WORKFLOW_DEFAULT)
  })

  it('double-flip returns to the starting default', () => {
    expect(toggleHorizonDefaultRatio(toggleHorizonDefaultRatio(0.62))).toBe(0.62)
    expect(toggleHorizonDefaultRatio(toggleHorizonDefaultRatio(0.38))).toBe(0.38)
  })
})

describe('horizon: nextHorizonDetent (Enter cycle on the focused splitter)', () => {
  it('cycles through all four detents in spec order and wraps around', () => {
    expect(nextHorizonDetent(0.8)).toBe(0.62)
    expect(nextHorizonDetent(0.62)).toBe(0.38)
    expect(nextHorizonDetent(0.38)).toBe(0.2)
    expect(nextHorizonDetent(0.2)).toBe(0.8)
  })

  it('starts the cycle from the detent nearest to a free-dragged ratio', () => {
    expect(nextHorizonDetent(0.75)).toBe(0.62) // nearest is 0.8 → next is 0.62
    expect(nextHorizonDetent(0.55)).toBe(0.38) // nearest is 0.62 → next is 0.38
    expect(nextHorizonDetent(0.3)).toBe(0.2) // nearest is 0.38 → next is 0.2
  })
})
