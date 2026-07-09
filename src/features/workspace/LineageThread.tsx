import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { prefersReducedMotion } from '../../domain/project/horizon'
import {
  MAX_LINEAGE_THREADS,
  buildLineageThreadPath,
  buildStageRowExclusionBands,
  clampPointToRect,
  clipAnchorPoint,
  isRectVisibleWithin,
  nodeAnchorPoint,
  resolveLineagePairings,
  type LineagePairing,
  type Point,
  type Rect,
} from '../../domain/project/lineageThread'
import { useProjectStore } from '../../store/project-store'
import { revealLineageEndpoint } from './followLineageThread'
import { resolveEndpointRect, resolveShellElement, resolveStageRowRect, resolveStratumRect } from './rect-registry'

const CLIP_PATH_ID = 'meridian-thread-stage-row-clip'
const EMPTY_ANIMATE_KEYS: ReadonlySet<string> = new Set()

interface PairingRefs {
  path: SVGPathElement | null
  clipPill: HTMLButtonElement | null
  nodePill: HTMLButtonElement | null
}

function writeBandRect(el: SVGRectElement, band: Rect | null): void {
  el.setAttribute('x', String(band?.left ?? 0))
  el.setAttribute('y', String(band?.top ?? 0))
  el.setAttribute('width', String(band?.width ?? 0))
  el.setAttribute('height', String(band?.height ?? 0))
}

/**
 * Draws a thread in tip-to-tail over `--dur-draw` via `stroke-dashoffset` (spec H motion
 * tokens), fired ONCE per newly-appeared pairing (M.10: "one motion event per selection
 * change") — never re-triggered by the per-frame geometry recomputes below. Under
 * prefers-reduced-motion the thread appears instantly at full length (spec H).
 */
function primeThreadDrawIn(pathEl: SVGPathElement, length: number, reduced: boolean): void {
  if (reduced) {
    pathEl.style.transition = 'none'
    pathEl.style.strokeDasharray = `${length}`
    pathEl.style.strokeDashoffset = '0'
    return
  }

  pathEl.style.transition = 'none'
  pathEl.style.strokeDasharray = `${length}`
  pathEl.style.strokeDashoffset = `${length}`
  // Force a style flush so the browser commits the fully-hidden starting state before the
  // transition is enabled next frame — otherwise both writes can coalesce into one frame and
  // the draw-in never animates.
  void pathEl.getBoundingClientRect()

  requestAnimationFrame(() => {
    pathEl.style.transition = 'stroke-dashoffset var(--dur-draw) var(--ease-out-quart)'
    pathEl.style.strokeDashoffset = '0'
  })
}

function writePill(pillEl: HTMLButtonElement | null, visible: boolean, point: Point): void {
  if (!pillEl) {
    return
  }

  pillEl.hidden = !visible

  if (!visible) {
    return
  }

  pillEl.style.transform = `translate(${Math.round(point.x)}px, ${Math.round(point.y)}px) translate(-50%, -50%)`
}

const pillClassName =
  'fixed left-0 top-0 z-[var(--z-thread)] cursor-pointer whitespace-nowrap rounded-full border border-phosphor/50 bg-black/80 px-2.5 py-1 text-[10px] font-medium uppercase tracking-[0.14em] text-phosphor shadow-overlay backdrop-blur'

/**
 * MERIDIAN item 5 (spec E, L.3): the lineage thread overlay. One full-viewport SVG mounted
 * inside `StrataShell` at `--z-thread`, `pointer-events: none`. Renders EXACTLY the relation
 * that exists in this codebase today — `Clip.workflowNodeId` (orchestrator scope decision A) —
 * not the spec's Take-chain, which this codebase has no model for.
 *
 * Perf discipline (item-5 brief, hard part): React re-renders here ONLY when the selection (or
 * the underlying clip/node lineage data) changes — see the `useProjectStore` selectors below.
 * Endpoint MOVEMENT (graph pan/zoom, timeline scroll/zoom, horizon drag/animate, window resize)
 * is handled entirely outside React: a single long-lived effect subscribes to
 * scroll/wheel/pointermove/mousemove/resize/keydown on `window` (capture phase, so it catches
 * events on any descendant regardless of whether they bubble) PLUS a `MutationObserver` on
 * `[data-meridian-shell]`'s `style` attribute (the horizon's drag-rAF and animate-tween paths —
 * Tab flip, backtick peek, Ctrl+arrow nudge — both write CSS vars there every frame with no
 * corresponding DOM event). Every trigger funnels through one `requestAnimationFrame`-coalesced
 * `scheduleRecompute` (one rAF per frame regardless of how many events fired), which re-reads
 * rects via the rect registry and writes `d`/pill-transform attributes straight to refs — no
 * `setState`, so no React re-render on the hot path.
 */
export function LineageThread() {
  const selectedClipId = useProjectStore((state) => state.ui.selectedClipId)
  const selectedClipIds = useProjectStore((state) => state.ui.selectedClipIds)
  const selectedNodeId = useProjectStore((state) => state.ui.selectedNodeId)
  const selectedNodeIds = useProjectStore((state) => state.ui.selectedNodeIds)
  const tracks = useProjectStore((state) => state.project.timeline.tracks)
  const nodes = useProjectStore((state) => state.project.workflow.nodes)
  const assets = useProjectStore((state) => state.project.assets.assets)

  const [isWindowFocused, setIsWindowFocused] = useState(() =>
    typeof document === 'undefined' ? true : document.hasFocus(),
  )

  useEffect(() => {
    function handleFocus() {
      setIsWindowFocused(true)
    }
    function handleBlur() {
      setIsWindowFocused(false)
    }

    window.addEventListener('focus', handleFocus)
    window.addEventListener('blur', handleBlur)
    return () => {
      window.removeEventListener('focus', handleFocus)
      window.removeEventListener('blur', handleBlur)
    }
  }, [])

  const clipRefsForPairing = useMemo(
    () => tracks.flatMap((track) => track.clips.map((clip) => ({ id: clip.id, workflowNodeId: clip.workflowNodeId }))),
    [tracks],
  )

  const { pairings, overflowCount } = useMemo(
    () => resolveLineagePairings(selectedClipIds, selectedNodeIds, clipRefsForPairing, MAX_LINEAGE_THREADS),
    [selectedClipIds, selectedNodeIds, clipRefsForPairing],
  )

  const nodeLabelById = useMemo(() => {
    const map = new Map<string, string>()
    for (const node of nodes) {
      map.set(node.id, node.label ?? node.id)
    }
    return map
  }, [nodes])

  const clipLabelById = useMemo(() => {
    const map = new Map<string, string>()
    for (const track of tracks) {
      for (const clip of track.clips) {
        map.set(clip.id, assets[clip.assetId]?.name ?? clip.id)
      }
    }
    return map
  }, [tracks, assets])

  const refsByKeyRef = useRef<Map<string, PairingRefs>>(new Map())
  const previousKeysRef = useRef<Set<string>>(new Set())
  const rafPendingRef = useRef(false)
  const skyBandRectRef = useRef<SVGRectElement | null>(null)
  const groundBandRectRef = useRef<SVGRectElement | null>(null)
  const overflowBadgeRef = useRef<HTMLDivElement | null>(null)

  const getRefs = useCallback((key: string): PairingRefs => {
    let refs = refsByKeyRef.current.get(key)
    if (!refs) {
      refs = { path: null, clipPill: null, nodePill: null }
      refsByKeyRef.current.set(key, refs)
    }
    return refs
  }, [])

  const recompute = useCallback(
    (animateKeys: ReadonlySet<string>) => {
      if (pairings.length === 0) {
        return
      }

      const reduced = prefersReducedMotion()
      const viewportWidth = window.innerWidth
      const viewportHeight = window.innerHeight
      const viewportRect: Rect = {
        top: 0,
        left: 0,
        right: viewportWidth,
        bottom: viewportHeight,
        width: viewportWidth,
        height: viewportHeight,
      }
      const groundBounds = resolveStratumRect('timeline') ?? viewportRect
      const skyBounds = resolveStratumRect('workflow') ?? viewportRect
      const stageRowRect = resolveStageRowRect()

      if (stageRowRect && skyBandRectRef.current && groundBandRectRef.current) {
        const bands = buildStageRowExclusionBands(stageRowRect, viewportWidth, viewportHeight)
        writeBandRect(skyBandRectRef.current, bands.sky)
        writeBandRect(groundBandRectRef.current, bands.ground)
      }

      let overflowAnchor: Point | null = null

      for (const pairing of pairings) {
        const refs = refsByKeyRef.current.get(pairing.key)
        if (!refs?.path) {
          continue
        }

        const clipRect = resolveEndpointRect('clip', pairing.clipId)
        const nodeRect = resolveEndpointRect('node', pairing.nodeId)
        const clipVisible = isRectVisibleWithin(clipRect, groundBounds)
        const nodeVisible = isRectVisibleWithin(nodeRect, skyBounds)

        const clipAnchor = clipRect ? clipAnchorPoint(clipRect) : null
        const nodeAnchor = nodeRect ? nodeAnchorPoint(nodeRect) : null

        // When an endpoint's own element is entirely gone from the DOM (unmounted/virtualized),
        // project a plausible point (aligned with the other endpoint) into its stratum's bounds
        // so the thread still terminates at a sensible edge instead of collapsing to (0,0).
        const clipFallback = clipAnchor ?? nodeAnchor ?? { x: (groundBounds.left + groundBounds.right) / 2, y: groundBounds.top }
        const nodeFallback = nodeAnchor ?? clipAnchor ?? { x: (skyBounds.left + skyBounds.right) / 2, y: skyBounds.bottom }

        const clipPoint = clipVisible && clipAnchor ? clipAnchor : clampPointToRect(clipFallback, groundBounds)
        const nodePoint = nodeVisible && nodeAnchor ? nodeAnchor : clampPointToRect(nodeFallback, skyBounds)

        refs.path.setAttribute('d', buildLineageThreadPath(clipPoint, nodePoint))
        const length = refs.path.getTotalLength()

        if (animateKeys.has(pairing.key)) {
          primeThreadDrawIn(refs.path, length, reduced)
        } else {
          // Keep dasharray in sync with the (possibly changed) path length every tick so a
          // fully-drawn thread (dashoffset 0) never shows a gap after its geometry changes —
          // dashoffset itself is left untouched here; only the initial draw-in ever moves it.
          refs.path.style.strokeDasharray = `${length}`
        }

        writePill(refs.clipPill, !clipVisible, clipPoint)
        writePill(refs.nodePill, !nodeVisible, nodePoint)

        if (selectedNodeId && pairing.nodeId === selectedNodeId) {
          overflowAnchor = nodeVisible ? nodeAnchor : clampPointToRect(nodeFallback, skyBounds)
        }
      }

      if (overflowBadgeRef.current) {
        if (overflowCount > 0 && overflowAnchor) {
          overflowBadgeRef.current.hidden = false
          overflowBadgeRef.current.style.transform = `translate(${Math.round(overflowAnchor.x + 14)}px, ${Math.round(overflowAnchor.y - 14)}px)`
        } else {
          overflowBadgeRef.current.hidden = true
        }
      }
    },
    [pairings, overflowCount, selectedNodeId],
  )

  const recomputeRef = useRef(recompute)
  useEffect(() => {
    recomputeRef.current = recompute
  }, [recompute])

  const scheduleRecompute = useRef(() => {
    if (rafPendingRef.current) {
      return
    }
    rafPendingRef.current = true
    requestAnimationFrame(() => {
      rafPendingRef.current = false
      recomputeRef.current(EMPTY_ANIMATE_KEYS)
    })
  }).current

  // Mount-once: movement listeners. Kept stable (via the ref indirection above) so this never
  // re-subscribes on selection changes — see the component doc comment for the full list of
  // what's covered and why each one is here.
  useEffect(() => {
    const listenerOptionsCapture: AddEventListenerOptions = { capture: true, passive: true }
    window.addEventListener('scroll', scheduleRecompute, listenerOptionsCapture)
    window.addEventListener('wheel', scheduleRecompute, listenerOptionsCapture)
    window.addEventListener('pointermove', scheduleRecompute, listenerOptionsCapture)
    window.addEventListener('mousemove', scheduleRecompute, listenerOptionsCapture)
    window.addEventListener('resize', scheduleRecompute)
    // Keyboard-driven layout changes (timeline zoom +/-, future shortcuts) have no dedicated
    // event of their own — a capture-phase keydown catch-all keeps this in sync with them too.
    window.addEventListener('keydown', scheduleRecompute, { capture: true })

    const shellEl = resolveShellElement()
    let observer: MutationObserver | null = null
    if (shellEl) {
      // The horizon's drag-rAF and animate-tween paths (StrataShell) write `--meridian-sky`/
      // `--meridian-ground` via `style.setProperty` every frame with no corresponding DOM
      // event — observing the `style` attribute is the only non-polling way to catch those.
      observer = new MutationObserver(scheduleRecompute)
      observer.observe(shellEl, { attributes: true, attributeFilter: ['style'] })
    }

    return () => {
      window.removeEventListener('scroll', scheduleRecompute, true)
      window.removeEventListener('wheel', scheduleRecompute, true)
      window.removeEventListener('pointermove', scheduleRecompute, true)
      window.removeEventListener('mousemove', scheduleRecompute, true)
      window.removeEventListener('resize', scheduleRecompute)
      window.removeEventListener('keydown', scheduleRecompute, true)
      observer?.disconnect()
    }
  }, [scheduleRecompute])

  // Selection changed: figure out which pairings are NEW (vs. persisting across an additive
  // multi-select change) so only those draw in — spec M.10 "one motion event per selection
  // change," not a re-animate on every render.
  useEffect(() => {
    const currentKeys = new Set(pairings.map((pairing) => pairing.key))
    const newlyAppeared = new Set(pairings.filter((pairing) => !previousKeysRef.current.has(pairing.key)).map((pairing) => pairing.key))
    previousKeysRef.current = currentKeys

    for (const key of refsByKeyRef.current.keys()) {
      if (!currentKeys.has(key)) {
        refsByKeyRef.current.delete(key)
      }
    }

    recompute(newlyAppeared)
  }, [pairings, recompute])

  function strokeForPairing(pairing: LineagePairing): string {
    const isPrimary = (selectedClipId !== null && pairing.clipId === selectedClipId) || (selectedNodeId !== null && pairing.nodeId === selectedNodeId)
    return isWindowFocused && isPrimary ? 'var(--color-phosphor)' : 'var(--color-phosphor-dim)'
  }

  return (
    <>
      <svg
        data-meridian-thread
        aria-hidden="true"
        style={{ position: 'fixed', inset: 0, width: '100%', height: '100%', pointerEvents: 'none', zIndex: 'var(--z-thread)' }}
      >
        <defs>
          <clipPath id={CLIP_PATH_ID}>
            <rect ref={skyBandRectRef} x={0} y={0} width={0} height={0} />
            <rect ref={groundBandRectRef} x={0} y={0} width={0} height={0} />
          </clipPath>
        </defs>
        {pairings.map((pairing) => (
          <path
            key={pairing.key}
            ref={(el) => {
              getRefs(pairing.key).path = el
            }}
            data-meridian-thread-edge={pairing.key}
            clipPath={`url(#${CLIP_PATH_ID})`}
            fill="none"
            strokeWidth={2}
            strokeLinecap="round"
            // `style` (not the `stroke` attribute) so the `var(--color-phosphor...)` custom
            // property always resolves — matches how every other CSS-var color in this codebase
            // is consumed (existing SVG edges in WorkflowView use hardcoded hex, not CSS vars).
            style={{ stroke: strokeForPairing(pairing) }}
          />
        ))}
      </svg>

      {pairings.map((pairing) => (
        <Fragment key={pairing.key}>
          <button
            type="button"
            ref={(el) => {
              getRefs(pairing.key).clipPill = el
            }}
            hidden
            data-meridian-thread-pill
            data-meridian-endpoint-kind="clip"
            data-meridian-endpoint-id={pairing.clipId}
            className={pillClassName}
            onClick={() => revealLineageEndpoint('clip', pairing.clipId)}
            aria-label={`Reveal clip ${clipLabelById.get(pairing.clipId) ?? pairing.clipId} in the timeline`}
          >
            {clipLabelById.get(pairing.clipId) ?? pairing.clipId}
          </button>
          <button
            type="button"
            ref={(el) => {
              getRefs(pairing.key).nodePill = el
            }}
            hidden
            data-meridian-thread-pill
            data-meridian-endpoint-kind="node"
            data-meridian-endpoint-id={pairing.nodeId}
            className={pillClassName}
            onClick={() => revealLineageEndpoint('node', pairing.nodeId)}
            aria-label={`Reveal node ${nodeLabelById.get(pairing.nodeId) ?? pairing.nodeId} in the graph`}
          >
            {nodeLabelById.get(pairing.nodeId) ?? pairing.nodeId}
          </button>
        </Fragment>
      ))}

      {overflowCount > 0 ? (
        <div
          ref={overflowBadgeRef}
          hidden
          data-meridian-thread-overflow
          aria-live="polite"
          className="fixed left-0 top-0 z-[var(--z-thread)] whitespace-nowrap rounded-full border border-phosphor-dim/60 bg-black/80 px-2 py-0.5 text-[10px] font-medium text-phosphor-dim"
        >
          +{overflowCount} more
        </div>
      ) : null}
    </>
  )
}
