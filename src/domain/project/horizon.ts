/**
 * Pure horizon-ratio math shared between the project store (persistence,
 * `setActiveView`/`setHorizonRatio`) and the MERIDIAN strata shell
 * (`features/workspace`). Kept dependency-free (no React, no Zustand) so it
 * can be unit tested directly and reused by both layers without a cycle.
 *
 * "Ratio" always means the sky (workflow/graph stratum) fraction of the
 * shell's height, in the range [HORIZON_RATIO_MIN, HORIZON_RATIO_MAX]. The
 * ground (timeline) stratum is always `1 - ratio`.
 */

/** Spec F.2: horizon detents are 80/20, 62/38, 38/62, 20/80 (sky/ground). */
export const HORIZON_RATIO_DETENTS = [0.8, 0.62, 0.38, 0.2] as const

export const HORIZON_RATIO_MIN = 0.2
export const HORIZON_RATIO_MAX = 0.8

/** Default detent when the workflow (sky) stratum is emphasized — spec F.2 "default generate". */
export const HORIZON_RATIO_WORKFLOW_DEFAULT = 0.62
/** Default detent when the timeline (ground) stratum is emphasized — spec F.2 "default edit". */
export const HORIZON_RATIO_TIMELINE_DEFAULT = 0.38

/** Fallback used for legacy saves / corrupt values. Matches the workflow-emphasis default. */
export const DEFAULT_HORIZON_RATIO = HORIZON_RATIO_WORKFLOW_DEFAULT

/** Drag-release snap tolerance (orchestration brief: "snap when within +/-3%"). */
export const HORIZON_DETENT_SNAP_TOLERANCE = 0.03

/** Motion token mirrors --dur-base (200ms) from src/styles/index.css. */
export const HORIZON_ANIMATION_MS = 200

/** Global Ctrl+ArrowUp/ArrowDown nudge amount (spec H: "Ctrl+up/down nudge 10%"). */
export const HORIZON_NUDGE_STEP = 0.1

/**
 * CSS grid track size for a stratum, in **fr units — never percentages** (item-3 review
 * BLOCKING-2). The strata shell's 5-row template mixes these flexible sky/ground tracks with
 * ~257px of fixed rows (splitter, stage row, hairline). Percentage tracks resolve against the
 * shell's FULL height, so below ~1071px of shell height the `minmax(0, N%)` caps exceed the
 * free space and become unreachable — grid then equal-splits the remainder and every ratio
 * change from Tab/drag is a visual no-op while aria-valuenow keeps reporting the store value.
 * `fr` tracks instead share only the free space left AFTER the fixed rows, so sky:ground is
 * exactly `ratio : 1-ratio` at any shell height. Both writers of the CSS vars (the rAF drag
 * path and the React style object in StrataShell) MUST go through this helper —
 * horizon.test.ts pins the 'fr' suffix as the contract.
 */
export function horizonTrackSize(fraction: number): string {
  // 0.38 * 100 === 38.000000000000004 under IEEE754; round to keep the CSS value clean.
  return `${Math.round(fraction * 10000) / 100}fr`
}

export function clampHorizonRatio(ratio: number): number {
  if (!Number.isFinite(ratio)) {
    return DEFAULT_HORIZON_RATIO
  }

  return Math.min(HORIZON_RATIO_MAX, Math.max(HORIZON_RATIO_MIN, ratio))
}

/** Does this ratio represent the workflow (sky) stratum being emphasized? */
export function isWorkflowEmphasis(ratio: number): boolean {
  return ratio >= 0.5
}

export function activeViewForRatio(ratio: number): 'workflow' | 'timeline' {
  return isWorkflowEmphasis(ratio) ? 'workflow' : 'timeline'
}

/** The default detent ratio for a given emphasized view. */
export function defaultRatioForView(view: 'workflow' | 'timeline'): number {
  return view === 'workflow' ? HORIZON_RATIO_WORKFLOW_DEFAULT : HORIZON_RATIO_TIMELINE_DEFAULT
}

/** Tab / Shift+Tab: flip between the two default detents (0.62 <-> 0.38). */
export function toggleHorizonDefaultRatio(ratio: number): number {
  return isWorkflowEmphasis(ratio) ? HORIZON_RATIO_TIMELINE_DEFAULT : HORIZON_RATIO_WORKFLOW_DEFAULT
}

export function findNearestHorizonDetent(ratio: number): number {
  return HORIZON_RATIO_DETENTS.reduce((closest, detent) =>
    Math.abs(detent - ratio) < Math.abs(closest - ratio) ? detent : closest,
  )
}

/** Returns the nearest detent if `ratio` is within the snap tolerance of it, else null. */
export function snapToHorizonDetent(
  ratio: number,
  tolerance: number = HORIZON_DETENT_SNAP_TOLERANCE,
): number | null {
  const nearest = findNearestHorizonDetent(ratio)
  // Epsilon keeps the boundary inclusive under IEEE754 (e.g. 0.65 - 0.62 is 0.0300…027).
  return Math.abs(ratio - nearest) <= tolerance + 1e-9 ? nearest : null
}

/** Enter on the focused splitter: cycle forward through the four detents in spec order. */
export function nextHorizonDetent(ratio: number): number {
  const nearestIndex = HORIZON_RATIO_DETENTS.reduce((closestIndex, detent, index) => {
    const closest = HORIZON_RATIO_DETENTS[closestIndex]
    return Math.abs(detent - ratio) < Math.abs(closest - ratio) ? index : closestIndex
  }, 0)

  return HORIZON_RATIO_DETENTS[(nearestIndex + 1) % HORIZON_RATIO_DETENTS.length]
}

/**
 * cubic-bezier(0.165, 0.84, 0.44, 1) (the --ease-out-quart token) approximated
 * with the standard analytic "ease out quart" curve. Close enough for a
 * layout-splitter transition and avoids shipping a bezier solver for a
 * 200ms UI nicety.
 */
export function easeOutQuart(t: number): number {
  const clamped = Math.min(1, Math.max(0, t))
  return 1 - (1 - clamped) ** 4
}

export function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true
}
