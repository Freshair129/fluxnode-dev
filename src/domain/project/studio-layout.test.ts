import { describe, expect, it } from 'vitest'
import {
  DEFAULT_STUDIO_INSPECTOR_WIDTH_PX,
  DEFAULT_STUDIO_LAYOUT,
  DEFAULT_STUDIO_MEDIA_WIDTH_PX,
  DEFAULT_STUDIO_TIMELINE_HEIGHT_PX,
  STUDIO_INSPECTOR_MAX_WIDTH_PX,
  STUDIO_INSPECTOR_MIN_WIDTH_PX,
  STUDIO_MEDIA_MAX_WIDTH_PX,
  STUDIO_MEDIA_MIN_WIDTH_PX,
  STUDIO_TIMELINE_MAX_HEIGHT_PX,
  STUDIO_TIMELINE_MIN_HEIGHT_PX,
  clampStudioInspectorWidth,
  clampStudioMediaWidth,
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
    expect(
      normalizeStudioLayout({ timelineHeightPx: 420, mediaCollapsed: true, mediaWidthPx: 320, inspectorWidthPx: 360 }),
    ).toEqual({
      timelineHeightPx: 420,
      mediaCollapsed: true,
      mediaWidthPx: 320,
      inspectorWidthPx: 360,
    })
    expect(normalizeStudioLayout({ timelineHeightPx: 5, mediaCollapsed: false }).timelineHeightPx).toBe(
      STUDIO_TIMELINE_MIN_HEIGHT_PX,
    )
  })

  it('fills default panel widths for v1-schema saves that predate them', () => {
    const normalized = normalizeStudioLayout({ timelineHeightPx: 420, mediaCollapsed: true })
    expect(normalized.mediaWidthPx).toBe(DEFAULT_STUDIO_MEDIA_WIDTH_PX)
    expect(normalized.inspectorWidthPx).toBe(DEFAULT_STUDIO_INSPECTOR_WIDTH_PX)
  })

  it('treats non-boolean mediaCollapsed as expanded', () => {
    expect(normalizeStudioLayout({ timelineHeightPx: 300, mediaCollapsed: 'yes' }).mediaCollapsed).toBe(false)
  })
})

describe('studio-layout: panel width clamps', () => {
  it('clamps media width to its range and falls back on garbage', () => {
    expect(clampStudioMediaWidth(320)).toBe(320)
    expect(clampStudioMediaWidth(1)).toBe(STUDIO_MEDIA_MIN_WIDTH_PX)
    expect(clampStudioMediaWidth(9999)).toBe(STUDIO_MEDIA_MAX_WIDTH_PX)
    expect(clampStudioMediaWidth(Number.NaN)).toBe(DEFAULT_STUDIO_MEDIA_WIDTH_PX)
  })

  it('clamps inspector width to its range and falls back on garbage', () => {
    expect(clampStudioInspectorWidth(360)).toBe(360)
    expect(clampStudioInspectorWidth(1)).toBe(STUDIO_INSPECTOR_MIN_WIDTH_PX)
    expect(clampStudioInspectorWidth(9999)).toBe(STUDIO_INSPECTOR_MAX_WIDTH_PX)
    expect(clampStudioInspectorWidth(Number.NaN)).toBe(DEFAULT_STUDIO_INSPECTOR_WIDTH_PX)
  })
})
