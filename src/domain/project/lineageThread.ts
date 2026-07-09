/**
 * Pure lineage-thread math shared between the rect registry, the `LineageThread` SVG overlay,
 * and the `F` follow-thread jump (`features/workspace`). Kept dependency-free (no React, no
 * Zustand, no DOM) so the pairing/capping/clipping/path math can be unit tested directly —
 * mirrors the split already used for horizon math in `domain/project/horizon.ts` and ledger math
 * in `domain/project/jobLedger.ts`.
 *
 * Orchestrator scope decision A (binding): the lineage relation rendered here is `Clip -> Node`
 * via the EXISTING `Clip.workflowNodeId` field — NOT the spec's `Clip -> Take -> Output -> Node`
 * chain, which assumes a Take model this codebase doesn't have. See
 * docs/design/MERIDIAN-UI-SPEC.md section E and L.3.
 */

/** Spec L.3 / item-5 brief: cap simultaneous threads at a sane number; summarize the rest. */
export const MAX_LINEAGE_THREADS = 12

/** Minimum vertical pull of a thread's bezier control points, so very-close endpoints still read as a curve. */
const THREAD_CONTROL_MIN_PX = 24

/** Fraction of the endpoint span used as the bezier control-point offset. */
const THREAD_CONTROL_RATIO = 0.4

export interface Point {
  x: number
  y: number
}

/** Viewport-space rect, same shape as `DOMRect` but a plain object (no DOM dependency). */
export interface Rect {
  top: number
  left: number
  right: number
  bottom: number
  width: number
  height: number
}

export function rectFromDomRect(domRect: {
  top: number
  left: number
  right: number
  bottom: number
  width: number
  height: number
}): Rect {
  return {
    top: domRect.top,
    left: domRect.left,
    right: domRect.right,
    bottom: domRect.bottom,
    width: domRect.width,
    height: domRect.height,
  }
}

// ---------------------------------------------------------------------------------------------
// Pairing resolution (which clip<->node edges does the current selection light up)
// ---------------------------------------------------------------------------------------------

export interface LineageClipRef {
  id: string
  workflowNodeId: string | null
}

export interface LineagePairing {
  /** Stable React key + DOM lookup key. */
  key: string
  clipId: string
  nodeId: string
}

export interface LineagePairingResult {
  pairings: LineagePairing[]
  /** How many additional clip<->node edges exist beyond the cap (0 if none). */
  overflowCount: number
}

/**
 * Bidirectional per spec L.3: a selected clip (with a linked node) draws ONE thread up; a
 * selected node draws threads down to EVERY clip that references it. The project store enforces
 * mutual exclusivity between clip and node selection (`selectClip`/`selectNode` each clear the
 * other), so in practice exactly one of `selectedClipIds`/`selectedNodeIds` is non-empty — clips
 * win ties defensively if that ever changes.
 */
export function resolveLineagePairings(
  selectedClipIds: readonly string[],
  selectedNodeIds: readonly string[],
  clips: readonly LineageClipRef[],
  cap: number = MAX_LINEAGE_THREADS,
): LineagePairingResult {
  const found: LineagePairing[] = []

  if (selectedClipIds.length > 0) {
    for (const clipId of selectedClipIds) {
      const clip = clips.find((candidate) => candidate.id === clipId)
      if (clip?.workflowNodeId) {
        found.push({ key: `${clipId}::${clip.workflowNodeId}`, clipId, nodeId: clip.workflowNodeId })
      }
    }
  } else if (selectedNodeIds.length > 0) {
    for (const nodeId of selectedNodeIds) {
      for (const clip of clips) {
        if (clip.workflowNodeId === nodeId) {
          found.push({ key: `${clip.id}::${nodeId}`, clipId: clip.id, nodeId })
        }
      }
    }
  }

  return {
    pairings: found.slice(0, cap),
    overflowCount: Math.max(0, found.length - cap),
  }
}

// ---------------------------------------------------------------------------------------------
// Geometry: anchors, bezier path, band clipping, off-screen projection
// ---------------------------------------------------------------------------------------------

/** The clip's thread anchor: top-edge center — the thread rises from here toward the node. */
export function clipAnchorPoint(rect: Rect): Point {
  return { x: rect.left + rect.width / 2, y: rect.top }
}

/** The node's thread anchor: bottom-edge center — the thread arrives here from below. */
export function nodeAnchorPoint(rect: Rect): Point {
  return { x: rect.left + rect.width / 2, y: rect.bottom }
}

/**
 * A vertically-routed cubic bezier from `from` to `to` (spec L.3: "cubic path through the stage
 * row edge"). Control points pull each endpoint straight up/down before curving toward the
 * other, which reads correctly whether the two points are far apart (long pull through the
 * stage row) or close together (still visibly a curve, floored at THREAD_CONTROL_MIN_PX).
 */
export function buildLineageThreadPath(from: Point, to: Point): string {
  const span = Math.max(THREAD_CONTROL_MIN_PX, Math.abs(from.y - to.y) * THREAD_CONTROL_RATIO)
  const control1: Point = { x: from.x, y: from.y - span }
  const control2: Point = { x: to.x, y: to.y + span }
  const round = (value: number) => Math.round(value * 100) / 100

  return `M ${round(from.x)} ${round(from.y)} C ${round(control1.x)} ${round(control1.y)}, ${round(control2.x)} ${round(control2.y)}, ${round(to.x)} ${round(to.y)}`
}

export interface StageRowExclusionBands {
  /** Above the stage row (sky side). `null` when the stage row starts at/above the viewport top. */
  sky: Rect | null
  /** Below the stage row (ground side). `null` when the stage row reaches/exceeds the viewport bottom. */
  ground: Rect | null
}

/**
 * Rects to feed an SVG `<clipPath>` so the thread visibly passes BEHIND the opaque stage row
 * (spec D "threads run through the horizon" + item-5 brief: "do not draw over the stage row").
 * Returns the sky-side band (above the stage row) and the ground-side band (below it) — the
 * stage row's own vertical span is excluded, so a path clipped to these rects appears to enter
 * the stage row's top edge and re-emerge at its bottom edge.
 */
export function buildStageRowExclusionBands(
  stageRowRect: Rect,
  viewportWidth: number,
  viewportHeight: number,
): StageRowExclusionBands {
  const top = Math.max(0, Math.min(stageRowRect.top, viewportHeight))
  const bottom = Math.max(0, Math.min(stageRowRect.bottom, viewportHeight))

  return {
    sky: top > 0 ? { top: 0, left: 0, right: viewportWidth, bottom: top, width: viewportWidth, height: top } : null,
    ground:
      bottom < viewportHeight
        ? {
            top: bottom,
            left: 0,
            right: viewportWidth,
            bottom: viewportHeight,
            width: viewportWidth,
            height: viewportHeight - bottom,
          }
        : null,
  }
}

/** Is `rect` at least partially inside `bounds`? Null/zero-area rects are never visible. */
export function isRectVisibleWithin(rect: Rect | null, bounds: Rect): boolean {
  if (!rect || rect.width <= 0 || rect.height <= 0) {
    return false
  }

  return rect.bottom > bounds.top && rect.top < bounds.bottom && rect.right > bounds.left && rect.left < bounds.right
}

/** Clamps a point into `bounds` on both axes — used to pin an off-screen endpoint's edge pill/thread terminus at the boundary it fell outside of. */
export function clampPointToRect(point: Point, bounds: Rect): Point {
  return {
    x: Math.min(Math.max(point.x, bounds.left), bounds.right),
    y: Math.min(Math.max(point.y, bounds.top), bounds.bottom),
  }
}

export type OffscreenDirection = 'up' | 'down' | 'left' | 'right'

/**
 * Which direction did `point` fall outside `bounds` in (for the edge pill's directional glyph,
 * e.g. "n7 (up arrow)" per spec L.3)? Picks the axis with the larger overshoot when both are out of bounds
 * (corner case). Returns null if the point is already inside bounds.
 */
export function resolveOffscreenDirection(point: Point, bounds: Rect): OffscreenDirection | null {
  const overshootUp = bounds.top - point.y
  const overshootDown = point.y - bounds.bottom
  const overshootLeft = bounds.left - point.x
  const overshootRight = point.x - bounds.right

  const verticalOvershoot = Math.max(overshootUp, overshootDown)
  const horizontalOvershoot = Math.max(overshootLeft, overshootRight)

  if (verticalOvershoot <= 0 && horizontalOvershoot <= 0) {
    return null
  }

  if (verticalOvershoot >= horizontalOvershoot) {
    return overshootUp >= overshootDown ? 'up' : 'down'
  }

  return overshootLeft >= overshootRight ? 'left' : 'right'
}

export const OFFSCREEN_DIRECTION_GLYPH: Record<OffscreenDirection, string> = {
  up: '▲',
  down: '▼',
  left: '◀',
  right: '▶',
}

// ---------------------------------------------------------------------------------------------
// Horizon reveal (F jump / edge-pill click sliding the horizon so the target stratum is visible)
// ---------------------------------------------------------------------------------------------

/**
 * Item-5 brief: "if the sky stratum is collapsed/small, slide the horizon to a detent that
 * reveals it... reuse the item-2 horizon actions; do not reimplement." `activeViewForRatio`
 * already answers "which stratum is emphasized" for both normal AND compact-height mode (the
 * strata shell derives its compact peek-strip emphasis from the very same ratio via the same
 * function — see StrataShell's `compactEmphasis`), so checking it here needs no separate
 * compact-mode branch. Returns the ratio to commit via `setHorizonRatio`, or `null` if
 * `targetView` is already the emphasized stratum (no reveal needed).
 */
export function resolveHorizonRevealRatio(
  currentRatio: number,
  targetView: 'workflow' | 'timeline',
  activeViewForRatio: (ratio: number) => 'workflow' | 'timeline',
  defaultRatioForView: (view: 'workflow' | 'timeline') => number,
): number | null {
  return activeViewForRatio(currentRatio) === targetView ? null : defaultRatioForView(targetView)
}
