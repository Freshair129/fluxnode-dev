import { describe, expect, it } from 'vitest'
import {
  DEFAULT_DENSITY_MODE,
  DENSITY_GUTTER_PX,
  DENSITY_ROW_HEIGHT_PX,
  DENSITY_STAGE_ROW_HEIGHT_PX,
  DENSITY_TRACK_HEIGHT_PX,
  MIN_HIT_TARGET_PX,
  isDensityMode,
  normalizeDensityMode,
  resolveStageRowHeightPx,
  toggleDensityMode,
} from './density'

describe('density: normalizeDensityMode / isDensityMode', () => {
  it('passes through valid modes', () => {
    expect(normalizeDensityMode('comfortable')).toBe('comfortable')
    expect(normalizeDensityMode('compact')).toBe('compact')
    expect(isDensityMode('comfortable')).toBe(true)
    expect(isDensityMode('compact')).toBe(true)
  })

  it('falls back to the default for corrupt/legacy values (undefined, null, wrong type, garbage string)', () => {
    expect(normalizeDensityMode(undefined)).toBe(DEFAULT_DENSITY_MODE)
    expect(normalizeDensityMode(null)).toBe(DEFAULT_DENSITY_MODE)
    expect(normalizeDensityMode(42)).toBe(DEFAULT_DENSITY_MODE)
    expect(normalizeDensityMode('roomy')).toBe(DEFAULT_DENSITY_MODE)
    expect(isDensityMode('roomy')).toBe(false)
  })

  it('default density is comfortable', () => {
    expect(DEFAULT_DENSITY_MODE).toBe('comfortable')
  })
})

describe('density: toggleDensityMode', () => {
  it('flips between the two modes', () => {
    expect(toggleDensityMode('comfortable')).toBe('compact')
    expect(toggleDensityMode('compact')).toBe('comfortable')
  })

  it('double-toggle returns to the start', () => {
    expect(toggleDensityMode(toggleDensityMode('comfortable'))).toBe('comfortable')
    expect(toggleDensityMode(toggleDensityMode('compact'))).toBe('compact')
  })
})

describe('density: spec G metrics table', () => {
  it('pins the exact comfortable/compact values spec G names', () => {
    expect(DENSITY_ROW_HEIGHT_PX).toEqual({ comfortable: 28, compact: 24 })
    expect(DENSITY_STAGE_ROW_HEIGHT_PX).toEqual({ comfortable: 248, compact: 204 })
    expect(DENSITY_GUTTER_PX).toEqual({ comfortable: 8, compact: 6 })
    expect(DENSITY_TRACK_HEIGHT_PX).toEqual({ comfortable: 56, compact: 44 })
  })

  it('compact is always smaller than comfortable for every spacing metric (density never grows spacing)', () => {
    for (const table of [DENSITY_ROW_HEIGHT_PX, DENSITY_STAGE_ROW_HEIGHT_PX, DENSITY_GUTTER_PX, DENSITY_TRACK_HEIGHT_PX]) {
      expect(table.compact).toBeLessThan(table.comfortable)
    }
  })

  it('the minimum hit target is a fixed floor, not part of the per-mode table (spec K.5)', () => {
    expect(MIN_HIT_TARGET_PX).toBe(24)
  })
})

describe('density: resolveStageRowHeightPx (density vs. the orthogonal short-window responsive rule)', () => {
  const COMPACT_HEIGHT_STAGE_ROW_PX = 96 // mirrors StrataShell's own constant

  it('picks the density-mode stage row height when the window is NOT short', () => {
    expect(resolveStageRowHeightPx('comfortable', false, COMPACT_HEIGHT_STAGE_ROW_PX)).toBe(248)
    expect(resolveStageRowHeightPx('compact', false, COMPACT_HEIGHT_STAGE_ROW_PX)).toBe(204)
  })

  it('the short-window responsive rule wins outright when the window IS short, regardless of density', () => {
    expect(resolveStageRowHeightPx('comfortable', true, COMPACT_HEIGHT_STAGE_ROW_PX)).toBe(96)
    expect(resolveStageRowHeightPx('compact', true, COMPACT_HEIGHT_STAGE_ROW_PX)).toBe(96)
  })
})
