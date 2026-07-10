/**
 * Pure density-mode resolution (MERIDIAN item 7, spec G + L.7). Dependency-free (no React, no
 * Zustand) so it's unit-testable directly and reusable by both the store (persistence) and the
 * shell/surfaces that render at each density — same pattern as `horizon.ts` / `jobLedger.ts` /
 * `statusBar/segments.ts`.
 *
 * TWO NAMING HAZARDS, deliberately avoided here:
 *
 * 1. "Compact" is already taken by a RESPONSIVE mode: `COMPACT_HEIGHT_BREAKPOINT` /
 *    `COMPACT_HEIGHT_STAGE_ROW_PX` in `features/workspace/StrataShell.tsx` shrink the stage row
 *    when the *window* is short. That is about fitting the physical screen, not a user
 *    preference, and is orthogonal to density (a user preference that follows them across
 *    projects). The two only ever meet in `resolveStageRowHeightPx` below, where the responsive
 *    rule wins outright — see that function's doc comment for why.
 * 2. `TimelineView`'s `Waveform` component already has a `density: 'compact' | 'balanced' |
 *    'detailed'` prop controlling audio waveform bar count. That is unrelated to UI spacing
 *    density and is never touched or shadowed by anything in this module.
 */

export type DensityMode = 'comfortable' | 'compact'

export const DEFAULT_DENSITY_MODE: DensityMode = 'comfortable'

export function isDensityMode(value: unknown): value is DensityMode {
  return value === 'comfortable' || value === 'compact'
}

/** Normalizes a persisted/loaded value (legacy saves, corrupt localStorage) to a valid mode. */
export function normalizeDensityMode(value: unknown): DensityMode {
  return isDensityMode(value) ? value : DEFAULT_DENSITY_MODE
}

export function toggleDensityMode(mode: DensityMode): DensityMode {
  return mode === 'comfortable' ? 'compact' : 'comfortable'
}

/**
 * Spec G's density -> metrics table. Every value here is a HEIGHT or SPACING in px — spec G's own
 * words: "Font sizes never change with density." Nothing in this module (or anything that reads
 * it) is permitted to touch a font-size/line-height token. That invariant can only be enforced by
 * a real browser's `getComputedStyle` (this repo has no jsdom), so the guard lives in
 * `e2e/07-density.spec.ts`'s "font-size invariance" describe block, not here.
 */

/** Spec G: "rows 28->24px". Drives `--meridian-row-h` (status bar segments, ledger/inspector
 *  header rows, palette/menu row padding by way of `--meridian-gutter`). */
export const DENSITY_ROW_HEIGHT_PX: Record<DensityMode, number> = {
  comfortable: 28,
  compact: 24,
}

/** Spec F.1/G: "stage row 248->204px". Drives `--meridian-stage-h` — see `resolveStageRowHeightPx`. */
export const DENSITY_STAGE_ROW_HEIGHT_PX: Record<DensityMode, number> = {
  comfortable: 248,
  compact: 204,
}

/** Spec G: "gutters 8->6px". Drives `--meridian-gutter` (panel gutters, chip padding, menu/palette
 *  row padding, drawer edge inset). */
export const DENSITY_GUTTER_PX: Record<DensityMode, number> = {
  comfortable: 8,
  compact: 6,
}

/** Spec G: "timeline track 56->44px". Drives `--meridian-track-h`. */
export const DENSITY_TRACK_HEIGHT_PX: Record<DensityMode, number> = {
  comfortable: 56,
  compact: 44,
}

/** Spec K.5: minimum interactive hit target, 24x24, held CONSTANT across both densities — a floor,
 *  not a density-scaled value, so it is a single constant rather than a per-mode map. */
export const MIN_HIT_TARGET_PX = 24

/**
 * Spec F.1's fixed-per-density stage row height, reconciled with the orthogonal short-window
 * responsive rule (StrataShell's `COMPACT_HEIGHT_BREAKPOINT`/`COMPACT_HEIGHT_STAGE_ROW_PX`): a
 * short window's peek-strip layout exists to fit the physical screen and wins outright regardless
 * of density — it is not a spacing preference the user's density mode should override. Density
 * only picks the stage row height when that responsive override is NOT in effect; gutters/row
 * heights elsewhere keep following density even while the responsive override is active.
 */
export function resolveStageRowHeightPx(
  mode: DensityMode,
  isCompactHeight: boolean,
  compactHeightStageRowPx: number,
): number {
  return isCompactHeight ? compactHeightStageRowPx : DENSITY_STAGE_ROW_HEIGHT_PX[mode]
}
