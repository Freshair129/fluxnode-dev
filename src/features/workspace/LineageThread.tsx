import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { prefersReducedMotion } from '../../domain/project/horizon'
import {
  MAX_LINEAGE_THREADS,
  buildLineageThreadPath,
  buildStageRowExclusionBands,
  clampPointToRect,
  clipAnchorPoint,
  isPrimedHiddenDashoffset,
  isRectVisibleWithin,
  nodeAnchorPoint,
  resolveLineagePairings,
  type LineagePairing,
  type Point,
  type Rect,
} from '../../domain/project/lineageThread'
import { getCommandBinding, keybindingMatchesEvent, type ShortcutCommand } from '../../services/shortcuts/shortcut-config'
import { useProjectStore } from '../../store/project-store'
import { revealLineageEndpoint } from './followLineageThread'
import { resolveEndpointRect, resolveShellElement, resolveStageRowRect, resolveStratumRect } from './rect-registry'

const CLIP_PATH_ID = 'meridian-thread-stage-row-clip'
const EMPTY_ANIMATE_KEYS: ReadonlySet<string> = new Set()

/**
 * Item 11: the narrowed capture-phase `keydown` catch-all. These are the ONLY keyboard shortcuts
 * that can move a clip/node endpoint WITHOUT also firing a scroll/wheel/resize event or writing
 * to `[data-meridian-shell]`'s `style` attribute — the horizon's own shortcuts (Tab flip, `
 * backtick peek, Ctrl+Arrow nudge) are deliberately EXCLUDED here because StrataShell's drag/
 * animate-tween rAF already writes CSS vars to the shell's `style` every frame for those three,
 * which the MutationObserver below already catches. Timeline zoom/fit and workflow fit change
 * clip/node pixel positions purely through Zustand state that LineageThread doesn't otherwise
 * observe; density toggle changes spacing tokens the same way.
 *
 * Keyed off the item-6 command registry's ids + the user's LIVE (possibly remapped)
 * `preferences.keybindings` — read fresh via `useProjectStore.getState()` inside the handler, not
 * as a hook dependency, so this mount-once effect never has to re-subscribe when the user remaps
 * a shortcut in Settings — rather than a hardcoded key list, so a remapped binding is still caught.
 */
const LAYOUT_AFFECTING_SHORTCUT_COMMANDS: readonly ShortcutCommand[] = [
  'timeline.zoomIn',
  'timeline.zoomOut',
  'timeline.fitView',
  'workflow.fitView',
  'global.toggleDensity',
]

function isLayoutAffectingShortcut(event: KeyboardEvent): boolean {
  const keybindings = useProjectStore.getState().preferences.keybindings
  return LAYOUT_AFFECTING_SHORTCUT_COMMANDS.some((command) => {
    const binding = getCommandBinding(keybindings, command)
    return binding !== undefined && keybindingMatchesEvent(event, binding)
  })
}

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
 * Perf discipline (item-5 brief, hard part; item 11 hardened it further): React re-renders here
 * ONLY when the selection (or the underlying clip/node lineage data) changes — see the
 * `useProjectStore` selectors below. Endpoint MOVEMENT (graph pan/zoom, timeline scroll/zoom,
 * horizon drag/animate, window resize) is handled entirely outside React, by a single long-lived
 * effect subscribing to exactly the DOM signals that can actually move an endpoint:
 *   - `scroll` on the two `[data-meridian-stratum]` wrapper elements (capture phase — `scroll`
 *     doesn't bubble, but a capture listener on an ANCESTOR still sees it as the event descends
 *     toward its real target, e.g. the graph canvas's `overflow-auto` div). Scoped here instead of
 *     `window` (item 5's original design) because `window` also recomputed for scrolls inside a
 *     drawer/modal/palette list that can never move a clip or node.
 *   - `wheel` and `resize` on `window` (zoom/pan gestures and viewport changes reach every
 *     descendant regardless of scroll-container boundaries).
 *   - `pointermove` on `window`, but ONLY while a drag is in flight (subscribed on `pointerdown`,
 *     unsubscribed on `pointerup`/`pointercancel`) — hover alone cannot move a clip or a node, so
 *     item 11 stopped paying for a coalesced rAF + full rect-registry re-read on every mouse
 *     twitch. The redundant `mousemove` listener (item 5 originally kept both `pointermove` AND
 *     `mousemove` for the same physical motion) is gone entirely.
 *   - `keydown` on `window` (capture phase), narrowed to exactly the layout-affecting shortcuts in
 *     `LAYOUT_AFFECTING_SHORTCUT_COMMANDS` above — the horizon's own shortcuts (Tab/backtick/
 *     Ctrl+Arrow) don't need a keydown listener at all; see that constant's doc comment.
 *   - a `MutationObserver` on `[data-meridian-shell]`'s `style` attribute (the horizon's drag-rAF
 *     and animate-tween paths — Tab flip, backtick peek, Ctrl+arrow nudge — write CSS vars there
 *     every frame with no corresponding DOM event).
 *   - `visibilitychange`/`pageshow` on `document`/`window` (item 11): self-heals a thread that got
 *     primed (drawn fully hidden) while `document.hidden`, whose one-shot draw-in `rAF` may never
 *     have fired — see `isPrimedHiddenDashoffset` in `lineageThread.ts` and
 *     `resolvePrimedHiddenThreads` below for the mechanism.
 * Every movement trigger funnels through one `requestAnimationFrame`-coalesced
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
      if (import.meta.env.DEV) {
        // Dev-only instrumentation (dead-code-eliminated from production builds — `import.meta
        // .env.DEV` is a Vite build-time constant, not a runtime branch). Exists solely so the
        // item-11 e2e suite can PROVE "hover schedules zero recomputes" with a real, breakable
        // assertion instead of comparing the thread's `d` attribute, which doesn't change on its
        // own from a recompute that finds nothing moved — see e2e/05-lineage.spec.ts.
        const win = window as typeof window & { meridianLineageRecomputeCount?: number }
        win.meridianLineageRecomputeCount = (win.meridianLineageRecomputeCount ?? 0) + 1
      }
      recomputeRef.current(EMPTY_ANIMATE_KEYS)
    })
  }).current

  // Mount-once: movement listeners. Kept stable (via the ref indirection above) so this never
  // re-subscribes on selection changes — see the component doc comment for the full list of
  // what's covered and why each one is here.
  useEffect(() => {
    const listenerOptionsCapture: AddEventListenerOptions = { capture: true, passive: true }

    window.addEventListener('wheel', scheduleRecompute, listenerOptionsCapture)
    window.addEventListener('resize', scheduleRecompute)

    // Item 11: scroll is scoped to the two strata wrappers instead of `window` — a capture-phase
    // listener on an ancestor still sees a descendant's non-bubbling `scroll` event (it fires
    // during the capture phase, which travels from `window` down through this element toward the
    // real scroll container — the graph canvas's `overflow-auto` div, whatever element the
    // timeline scrolls in — regardless of whether the event goes on to bubble). Queried once at
    // mount: both `[data-meridian-stratum]` wrappers are rendered as permanent siblings by
    // `StrataShell` (only their CHILDREN, e.g. `WorkflowView`, swap on collapse/expand), so this
    // stays valid for the component's whole lifetime without a MutationObserver to re-discover it.
    const strata = Array.from(document.querySelectorAll<HTMLElement>('[data-meridian-stratum]'))
    for (const stratum of strata) {
      stratum.addEventListener('scroll', scheduleRecompute, listenerOptionsCapture)
    }

    // Item 11: narrowed from a blanket capture-phase keydown catch-all to exactly the shortcuts
    // that change layout without their own scroll/wheel/resize/style-mutation signal — see
    // `LAYOUT_AFFECTING_SHORTCUT_COMMANDS`'s doc comment above.
    function handleLayoutKeydown(event: KeyboardEvent) {
      if (isLayoutAffectingShortcut(event)) {
        scheduleRecompute()
      }
    }
    window.addEventListener('keydown', handleLayoutKeydown, { capture: true })

    // Item 11: pointermove only moves an endpoint while an actual drag (pointerdown -> up/cancel)
    // is in flight — hover alone cannot move a clip or a node. Toggling the subscription on/off
    // (rather than an always-on listener that checks a flag) means a hover pays ZERO
    // listener-invocation cost, not just zero recompute cost. The formerly-redundant `mousemove`
    // listener (item 5 kept both `pointermove` and `mousemove` for the same physical mouse
    // motion) is dropped entirely, not just gated.
    let pointerMoveActive = false
    function activatePointerMove() {
      if (pointerMoveActive) {
        return
      }
      pointerMoveActive = true
      window.addEventListener('pointermove', scheduleRecompute, listenerOptionsCapture)
    }
    function deactivatePointerMove() {
      if (!pointerMoveActive) {
        return
      }
      pointerMoveActive = false
      window.removeEventListener('pointermove', scheduleRecompute, true)
    }
    window.addEventListener('pointerdown', activatePointerMove, listenerOptionsCapture)
    window.addEventListener('pointerup', deactivatePointerMove, listenerOptionsCapture)
    window.addEventListener('pointercancel', deactivatePointerMove, listenerOptionsCapture)

    const shellEl = resolveShellElement()
    let observer: MutationObserver | null = null
    if (shellEl) {
      // The horizon's drag-rAF and animate-tween paths (StrataShell) write `--meridian-sky`/
      // `--meridian-ground` via `style.setProperty` every frame with no corresponding DOM
      // event — observing the `style` attribute is the only non-polling way to catch those.
      observer = new MutationObserver(scheduleRecompute)
      observer.observe(shellEl, { attributes: true, attributeFilter: ['style'] })
    }

    // Item 11: visibilitychange re-prime. A thread primed (drawn fully hidden, see
    // `primeThreadDrawIn`) while `document.hidden` can have its one-shot draw-in `rAF` suspended
    // indefinitely by the browser's background-tab throttling — nothing else ever revisits
    // `strokeDashoffset` for it (recompute's non-animate branch deliberately never touches it).
    // Self-heal on the transition back to visible; `pageshow` additionally covers a bfcache
    // restore, which doesn't reliably fire `visibilitychange`.
    function resolvePrimedHiddenThreads() {
      for (const refs of refsByKeyRef.current.values()) {
        const pathEl = refs.path
        if (!pathEl) {
          continue
        }
        if (isPrimedHiddenDashoffset(pathEl.style.strokeDashoffset, pathEl.style.strokeDasharray)) {
          // Snap, don't re-tween: becoming visible again is not a fresh selection/user action —
          // the pairing already logically drew in the moment it appeared. Re-arming a fresh
          // 240ms tween now would be a second, unearned motion event for the same selection
          // (spec M.10: "one motion event per user action"). Mirrors the prefers-reduced-motion
          // branch's own synchronous zero-set in `primeThreadDrawIn` exactly — this reuses an
          // already-shipped, already-verified visual state, not new motion language.
          pathEl.style.transition = 'none'
          pathEl.style.strokeDashoffset = '0'
        }
      }
    }
    function handleVisibilityChange() {
      if (document.hidden) {
        return
      }
      resolvePrimedHiddenThreads()
      // Geometry may also be stale (e.g. the window was resized while the tab was hidden, or
      // fonts/images finished loading) — piggyback a normal recompute on the same transition.
      scheduleRecompute()
    }
    document.addEventListener('visibilitychange', handleVisibilityChange)
    window.addEventListener('pageshow', handleVisibilityChange)

    return () => {
      window.removeEventListener('wheel', scheduleRecompute, true)
      window.removeEventListener('resize', scheduleRecompute)
      for (const stratum of strata) {
        stratum.removeEventListener('scroll', scheduleRecompute, true)
      }
      window.removeEventListener('keydown', handleLayoutKeydown, true)
      deactivatePointerMove()
      window.removeEventListener('pointerdown', activatePointerMove, true)
      window.removeEventListener('pointerup', deactivatePointerMove, true)
      window.removeEventListener('pointercancel', deactivatePointerMove, true)
      observer?.disconnect()
      document.removeEventListener('visibilitychange', handleVisibilityChange)
      window.removeEventListener('pageshow', handleVisibilityChange)
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

  // Item 11 (review round 1, BLOCKING-1): endpoint-DATA changes must recompute too. `pairings`
  // above is derived from `tracks` only (via `clipRefsForPairing`), NOT from `nodes` — so a node
  // `position` change (a real drag's commit, or an undo/redo of one via `moveWorkflowNodes` ->
  // `applyMutation('node.move')`) re-renders this component (it selects `nodes`) but changes no
  // `pairings` identity and fires no DOM movement event, leaving the imperatively-written `d`
  // pointing at the node's OLD location until an unrelated scroll/drag/resize happens to heal it.
  // Item 5's blanket capture-phase keydown listener covered keyboard undo/redo by accident; item
  // 11 correctly dropped that blanket, so the coverage is restored HERE, at the data layer — which
  // also catches undo/redo from the Header button and the command palette (no keydown at all) and
  // any programmatic reposition, none of which a keydown/shortcut list could ever reach. Fires a
  // geometry-only recompute (no draw-in re-arm — EMPTY_ANIMATE_KEYS via scheduleRecompute), so it
  // does not replay the thread's motion; `tracks` is included so a clip reposition heals the same
  // way (and it's already `pairings`' own source, so this adds no extra churn there).
  useEffect(() => {
    scheduleRecompute()
  }, [nodes, tracks, scheduleRecompute])

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
