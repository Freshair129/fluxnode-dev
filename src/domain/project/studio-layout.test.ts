import { describe, expect, it } from 'vitest'
import {
  DEFAULT_STUDIO_LAYOUT,
  DEFAULT_STUDIO_TIMELINE_HEIGHT_PX,
  STUDIO_TIMELINE_MAX_HEIGHT_PX,
  STUDIO_TIMELINE_MIN_HEIGHT_PX,
  clampStudioTimelineHeight,
  normalizeStudioLayout,
} from './studio-layout'

describe('studio-layout: clampStudioTimelineHeight', () => {
  it('passes through in-range values, rounded', () => {
    expect(clampStudioTimelineHeight(300)).toBe(300)
    expect(clampStudioTimelineHeight(300.6)).toBe(301)
  })

  it('clamps to the sanity range', () => {
    expect(clampStudioTimelineHeight(1)).toBe(STUDIO_TIMELINE_MIN_HEIGHT_PX)
    expect(clampStudioTimelineHeight(99999)).toBe(STUDIO_TIMELINE_MAX_HEIGHT_PX)
  })

  it('falls back to the default for non-finite input', () => {
    expect(clampStudioTimelineHeight(Number.NaN)).toBe(DEFAULT_STUDIO_TIMELINE_HEIGHT_PX)
    expect(clampStudioTimelineHeight(Number.POSITIVE_INFINITY)).toBe(DEFAULT_STUDIO_TIMELINE_HEIGHT_PX)
  })
})

describe('studio-layout: normalizeStudioLayout', () => {
  it('returns defaults for missing/garbage values', () => {
    expect(normalizeStudioLayout(undefined)).toEqual(DEFAULT_STUDIO_LAYOUT)
    expect(normalizeStudioLayout(null)).toEqual(DEFAULT_STUDIO_LAYOUT)
    expect(normalizeStudioLayout('tall')).toEqual(DEFAULT_STUDIO_LAYOUT)
  })

  it('keeps valid persisted values and clamps out-of-range heights', () => {
    expect(normalizeStudioLayout({ timelineHeightPx: 420, mediaCollapsed: true })).toEqual({
      timelineHeightPx: 420,
      mediaCollapsed: true,
    })
    expect(normalizeStudioLayout({ timelineHeightPx: 5, mediaCollapsed: false }).timelineHeightPx).toBe(
      STUDIO_TIMELINE_MIN_HEIGHT_PX,
    )
  })

  it('treats non-boolean mediaCollapsed as expanded', () => {
    expect(normalizeStudioLayout({ timelineHeightPx: 300, mediaCollapsed: 'yes' }).mediaCollapsed).toBe(false)
  })
})
