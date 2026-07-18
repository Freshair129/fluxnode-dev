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

export const DEFAULT_STUDIO_LAYOUT: StudioLayoutState = {
  timelineHeightPx: DEFAULT_STUDIO_TIMELINE_HEIGHT_PX,
  mediaCollapsed: false,
}

export function clampStudioTimelineHeight(heightPx: number): number {
  if (!Number.isFinite(heightPx)) {
    return DEFAULT_STUDIO_TIMELINE_HEIGHT_PX
  }

  return Math.min(STUDIO_TIMELINE_MAX_HEIGHT_PX, Math.max(STUDIO_TIMELINE_MIN_HEIGHT_PX, Math.round(heightPx)))
}

/** Load-time normalization: hand back a valid state from any missing/malformed persisted value. */
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
  }
}
