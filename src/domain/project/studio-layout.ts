import type { StudioLayoutState } from './types'

/**
 * Studio shell workspace geometry — persisted per-project in `project.meta.studioLayout`
 * (same lifecycle as `horizonRatio`/`stageRowCollapse`: written outside undo history, saved by
 * the normal project save/autosave path, restored on load). The shell additionally clamps the
 * timeline height responsively to 70% of its own live height at render time; these bounds are
 * the persistence-layer sanity range, not the live layout rule.
 */
export const STUDIO_TIMELINE_MIN_HEIGHT_PX = 160
export const STUDIO_TIMELINE_MAX_HEIGHT_PX = 1600
export const DEFAULT_STUDIO_TIMELINE_HEIGHT_PX = 300

export const STUDIO_MEDIA_MIN_WIDTH_PX = 200
export const STUDIO_MEDIA_MAX_WIDTH_PX = 480
export const DEFAULT_STUDIO_MEDIA_WIDTH_PX = 264

export const STUDIO_INSPECTOR_MIN_WIDTH_PX = 240
export const STUDIO_INSPECTOR_MAX_WIDTH_PX = 520
export const DEFAULT_STUDIO_INSPECTOR_WIDTH_PX = 300

export const DEFAULT_STUDIO_LAYOUT: StudioLayoutState = {
  timelineHeightPx: DEFAULT_STUDIO_TIMELINE_HEIGHT_PX,
  mediaCollapsed: false,
  mediaWidthPx: DEFAULT_STUDIO_MEDIA_WIDTH_PX,
  inspectorWidthPx: DEFAULT_STUDIO_INSPECTOR_WIDTH_PX,
}

function clampDimension(value: number, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(value)) {
    return fallback
  }

  return Math.min(max, Math.max(min, Math.round(value)))
}

export function clampStudioTimelineHeight(heightPx: number): number {
  return clampDimension(heightPx, STUDIO_TIMELINE_MIN_HEIGHT_PX, STUDIO_TIMELINE_MAX_HEIGHT_PX, DEFAULT_STUDIO_TIMELINE_HEIGHT_PX)
}

export function clampStudioMediaWidth(widthPx: number): number {
  return clampDimension(widthPx, STUDIO_MEDIA_MIN_WIDTH_PX, STUDIO_MEDIA_MAX_WIDTH_PX, DEFAULT_STUDIO_MEDIA_WIDTH_PX)
}

export function clampStudioInspectorWidth(widthPx: number): number {
  return clampDimension(widthPx, STUDIO_INSPECTOR_MIN_WIDTH_PX, STUDIO_INSPECTOR_MAX_WIDTH_PX, DEFAULT_STUDIO_INSPECTOR_WIDTH_PX)
}

/** Load-time normalization: hand back a valid state from any missing/malformed persisted value.
 *  Also fills the panel-width fields absent from saves written by the first studioLayout schema. */
export function normalizeStudioLayout(value: unknown): StudioLayoutState {
  if (value === null || typeof value !== 'object') {
    return { ...DEFAULT_STUDIO_LAYOUT }
  }

  const candidate = value as Partial<StudioLayoutState>

  return {
    timelineHeightPx:
      typeof candidate.timelineHeightPx === 'number'
        ? clampStudioTimelineHeight(candidate.timelineHeightPx)
        : DEFAULT_STUDIO_TIMELINE_HEIGHT_PX,
    mediaCollapsed: candidate.mediaCollapsed === true,
    mediaWidthPx:
      typeof candidate.mediaWidthPx === 'number' ? clampStudioMediaWidth(candidate.mediaWidthPx) : DEFAULT_STUDIO_MEDIA_WIDTH_PX,
    inspectorWidthPx:
      typeof candidate.inspectorWidthPx === 'number'
        ? clampStudioInspectorWidth(candidate.inspectorWidthPx)
        : DEFAULT_STUDIO_INSPECTOR_WIDTH_PX,
  }
}
