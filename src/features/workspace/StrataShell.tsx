import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import {
  HORIZON_RATIO_MAX,
  HORIZON_RATIO_MIN,
  activeViewForRatio,
  clampHorizonRatio,
  easeOutQuart,
  horizonTrackSize,
  nextHorizonDetent,
  prefersReducedMotion,
  snapToHorizonDetent,
  toggleHorizonDefaultRatio,
  HORIZON_ANIMATION_MS,
  HORIZON_NUDGE_STEP,
} from '../../domain/project/horizon'
import { useProjectStore } from '../../store/project-store'
import { ErrorBoundary } from '../../components/ErrorBoundary'
import { PanelFallback } from '../../app/App'
import { PreviewPanel } from '../preview/PreviewPanel'
import { JobLedger } from '../status/JobLedger'
import { StageInspector } from '../inspector/StageInspector'
import { LineageThread } from './LineageThread'
import { isEditableTarget, isOverlayOpen } from '../shortcuts/guardTargets'

const WorkflowView = lazy(() =>
  import('../workflow/WorkflowView').then((module) => ({ default: module.WorkflowView })),
)
const TimelineView = lazy(() =>
  import('../timeline/TimelineView').then((module) => ({ default: module.TimelineView })),
)

/** Spec J.2 (minimal): below this inner height, the non-emphasized stratum collapses to a peek strip. */
const COMPACT_HEIGHT_BREAKPOINT = 720
const COMPACT_PEEK_STRIP_PX = 32

/** Spec F.1: stage row height is fixed per density mode (comfortable 248px). Exposed as a CSS
 * var (`--meridian-stage-h`) rather than a bare literal so item 7 (density modes) has one place
 * to retarget it instead of hunting through the grid template string. */
const STAGE_ROW_HEIGHT_PX = 248
/**
 * Judgment call (item 3 brief: "in compact mode the stage row may shrink to transport-only
 * height — your judgment, note it"). Below COMPACT_HEIGHT_BREAKPOINT the stage row shrinks to
 * this much shorter band instead of staying at STAGE_ROW_HEIGHT_PX. There isn't a dedicated
 * "transport-only" sub-layout to switch to yet — PreviewPanel's actual transport controls
 * (play/pause/JKL) live in TimelineView's toolbar, not in PreviewPanel itself (see item-3
 * report) — so this just tightens the row and leans on the embedded PreviewPanel's own internal
 * scroll (`PreviewPanelProps.embedded`) to keep everything reachable. A real transport-only
 * compact layout is a reasonable follow-up once a standalone TransportBar exists.
 */
const COMPACT_HEIGHT_STAGE_ROW_PX = 96

/** Splitter's own focused-arrow-key resize steps (spec J.4), independent of the global Ctrl+arrow nudge. */
const SPLITTER_ARROW_STEP_PX = 8
const SPLITTER_SHIFT_ARROW_STEP_PX = 40

const NATIVELY_FOCUSABLE_TAGS = ['A', 'AREA', 'AUDIO', 'BUTTON', 'DETAILS', 'EMBED', 'IFRAME', 'INPUT', 'OBJECT', 'SELECT', 'SUMMARY', 'TEXTAREA', 'VIDEO']

/**
 * Reconciling spec F.2 (Tab flips the horizon) with J.4/K.1 (splitters and everything else
 * stay keyboard-reachable): the global Tab-flip fires ONLY when focus is "at rest" — the
 * keydown target is document.body/documentElement (nothing focused, so key events fall
 * through to the body) or a plain non-focusable stratum surface. The moment focus sits on
 * ANY focusable control — header buttons, the horizon separator itself (tabIndex=0), canvas
 * nodes with tabindex, form fields — Tab is left entirely to native focus traversal, so the
 * separator can be Tab-ed onto, operated (arrows/Enter), and Tab-ed off again (review
 * round-1 blocking item 2).
 */
function isTabFlipRestingTarget(target: EventTarget | null): boolean {
  if (target === document.body || target === document.documentElement) {
    return true
  }

  if (!(target instanceof HTMLElement)) {
    return false
  }

  // Keydown events target the focused element, so any element reaching here holds focus.
  // Treat every focusable/interactive element as native-traversal territory. A plain
  // element's tabIndex property is -1, so this only excludes explicit tabindex >= 0.
  if (target.tabIndex >= 0) {
    return false
  }

  if (NATIVELY_FOCUSABLE_TAGS.includes(target.tagName) || target.isContentEditable) {
    return false
  }

  // Programmatically-focused widgets (tabindex="-1" wrappers, role-bearing composites like
  // menus/listboxes) manage their own keyboard interaction — don't steal Tab from them.
  if (target.hasAttribute('tabindex') || target.getAttribute('role') !== null) {
    return false
  }

  return true
}

function applyHorizonRatioToDom(
  shellEl: HTMLDivElement | null,
  splitterEl: HTMLDivElement | null,
  ratio: number,
) {
  // fr units, NOT percentages — see horizonTrackSize's doc comment (item-3 review BLOCKING-2:
  // percentage caps inside minmax() become unreachable once the fixed stage-row/splitter rows
  // are subtracted, and grid silently equal-splits sky/ground).
  if (shellEl) {
    shellEl.style.setProperty('--meridian-sky', horizonTrackSize(ratio))
    shellEl.style.setProperty('--meridian-ground', horizonTrackSize(1 - ratio))
  }

  if (splitterEl) {
    splitterEl.setAttribute('aria-valuenow', String(Math.round(ratio * 100)))
  }
}

interface StrataShellProps {
  className?: string
}

/**
 * MERIDIAN strata shell (Phase 1 item 2). Replaces the old either/or
 * `activeView === 'timeline' ? <TimelineView /> : <WorkflowView />` switch with a CSS grid of
 * three rows — sky (WorkflowView), the horizon splitter, ground (TimelineView) — so both
 * strata render simultaneously and the user slides the boundary between them instead of
 * navigating away. See docs/design/MERIDIAN-UI-SPEC.md sections D, F, H, J.2, J.4.
 */
export function StrataShell({ className }: StrataShellProps) {
  const skyRatio = useProjectStore((state) => state.project.meta.horizonRatio)
  const setHorizonRatio = useProjectStore((state) => state.setHorizonRatio)

  const shellRef = useRef<HTMLDivElement | null>(null)
  const splitterRef = useRef<HTMLDivElement | null>(null)

  // Authoritative "what's on screen right now" ratio. Updated imperatively (refs + direct DOM
  // writes) during drag/animation so none of that work triggers a React re-render — the store
  // (and therefore React) is only touched on commit (pointer-up, Tab/Enter/nudge landing).
  const liveRatioRef = useRef(skyRatio)
  const draggingRef = useRef(false)
  const dragRectRef = useRef<DOMRect | null>(null)
  const pendingDragRatioRef = useRef(skyRatio)
  const animationHandleRef = useRef<number | null>(null)
  const peekOriginRef = useRef<number | null>(null)
  const dragRafPendingRef = useRef(false)

  const [innerHeight, setInnerHeight] = useState(() => window.innerHeight)

  useEffect(() => {
    function handleResize() {
      setInnerHeight(window.innerHeight)
    }

    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [])

  useEffect(() => {
    return () => {
      if (animationHandleRef.current !== null) {
        cancelAnimationFrame(animationHandleRef.current)
      }
    }
  }, [])

  const isCompactHeight = innerHeight < COMPACT_HEIGHT_BREAKPOINT
  // In compact mode the emphasized stratum is whichever the last committed ratio favors —
  // Tab still flips this (via the normal commit path), it just can't be free-dragged.
  const compactEmphasis = activeViewForRatio(skyRatio)

  const cancelAnimation = useCallback(() => {
    if (animationHandleRef.current !== null) {
      cancelAnimationFrame(animationHandleRef.current)
      animationHandleRef.current = null
    }
  }, [])

  /**
   * Animates the live (visual-only) ratio from its current value to `target`, optionally
   * committing to the store on completion. Instant under prefers-reduced-motion, and also in
   * compact-height mode — there the grid uses fixed peek-strip rows that ignore the animated
   * CSS variables, so running the 200ms tween would only delay the committed flip.
   */
  const animateRatioTo = useCallback(
    (target: number, commitOnFinish: boolean) => {
      cancelAnimation()
      const clampedTarget = clampHorizonRatio(target)
      const startRatio = liveRatioRef.current

      if (prefersReducedMotion() || isCompactHeight) {
        liveRatioRef.current = clampedTarget
        applyHorizonRatioToDom(shellRef.current, splitterRef.current, clampedTarget)
        if (commitOnFinish) {
          setHorizonRatio(clampedTarget)
        }
        return
      }

      const startedAt = performance.now()

      function tick(now: number) {
        const elapsed = now - startedAt
        const t = Math.min(1, elapsed / HORIZON_ANIMATION_MS)
        const eased = easeOutQuart(t)
        const value = startRatio + (clampedTarget - startRatio) * eased
        liveRatioRef.current = value
        applyHorizonRatioToDom(shellRef.current, splitterRef.current, value)

        if (t < 1) {
          animationHandleRef.current = requestAnimationFrame(tick)
        } else {
          animationHandleRef.current = null
          if (commitOnFinish) {
            setHorizonRatio(clampedTarget)
          }
        }
      }

      animationHandleRef.current = requestAnimationFrame(tick)
    },
    [cancelAnimation, isCompactHeight, setHorizonRatio],
  )

  /**
   * Ends an active backtick peek and returns the horizon to its pre-peek ratio. Shared by
   * keyup AND by window blur / tab-hide: if the user holds ` and Alt+Tabs away, the keyup
   * never arrives, so without these fallbacks the shell would stay stuck peeked with the
   * external-sync effect frozen (review round-1 blocking item 3). `instant` skips the tween —
   * used on blur/hide, where rAF is throttled or paused and a tween could stall half-done.
   */
  const restorePeek = useCallback(
    (instant: boolean) => {
      const origin = peekOriginRef.current

      if (origin === null) {
        return
      }

      peekOriginRef.current = null

      if (instant) {
        cancelAnimation()
        liveRatioRef.current = origin
        applyHorizonRatioToDom(shellRef.current, splitterRef.current, origin)
        return
      }

      animateRatioTo(origin, false)
    },
    [animateRatioTo, cancelAnimation],
  )

  useEffect(() => {
    function handleWindowBlur() {
      restorePeek(true)
    }

    function handleVisibilityChange() {
      if (document.hidden) {
        restorePeek(true)
      }
    }

    window.addEventListener('blur', handleWindowBlur)
    document.addEventListener('visibilitychange', handleVisibilityChange)
    return () => {
      window.removeEventListener('blur', handleWindowBlur)
      document.removeEventListener('visibilitychange', handleVisibilityChange)
    }
  }, [restorePeek])

  // Sync the imperative ratio to whatever the store says whenever it changes from *outside*
  // this component (Header's mode buttons, the legacy toggleView shortcut, project load) and
  // nothing is currently mid-drag/animation/peek — those paths own the live value until they
  // finish.
  useEffect(() => {
    if (draggingRef.current || animationHandleRef.current !== null || peekOriginRef.current !== null) {
      return
    }

    liveRatioRef.current = skyRatio
    applyHorizonRatioToDom(shellRef.current, splitterRef.current, skyRatio)
  }, [skyRatio])

  const handlePointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (isCompactHeight || event.button !== 0) {
        return
      }

      event.preventDefault()
      event.currentTarget.setPointerCapture(event.pointerId)
      cancelAnimation()
      peekOriginRef.current = null
      draggingRef.current = true
      dragRectRef.current = shellRef.current?.getBoundingClientRect() ?? null
      pendingDragRatioRef.current = liveRatioRef.current
    },
    [cancelAnimation, isCompactHeight],
  )

  const handlePointerMove = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (!draggingRef.current || !dragRectRef.current) {
      return
    }

    const relativeY = event.clientY - dragRectRef.current.top
    const nextRatio = clampHorizonRatio(relativeY / dragRectRef.current.height)
    pendingDragRatioRef.current = nextRatio

    // rAF-throttled, direct-to-DOM write — raw drag is 1:1 with the pointer and never eased.
    // Coalesced to at most one write per frame even if multiple pointermove events land first.
    if (dragRafPendingRef.current) {
      return
    }

    dragRafPendingRef.current = true
    requestAnimationFrame(() => {
      dragRafPendingRef.current = false
      if (!draggingRef.current) {
        return
      }
      liveRatioRef.current = pendingDragRatioRef.current
      applyHorizonRatioToDom(shellRef.current, splitterRef.current, pendingDragRatioRef.current)
    })
  }, [])

  const handlePointerUp = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (!draggingRef.current) {
        return
      }

      draggingRef.current = false
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId)
      }

      const finalRatio = pendingDragRatioRef.current
      const snapped = snapToHorizonDetent(finalRatio)

      if (snapped !== null) {
        animateRatioTo(snapped, true)
      } else {
        liveRatioRef.current = finalRatio
        setHorizonRatio(finalRatio)
      }
    },
    [animateRatioTo, setHorizonRatio],
  )

  const handleSplitterKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (isCompactHeight) {
        return
      }

      if ((event.key === 'ArrowUp' || event.key === 'ArrowDown') && !event.ctrlKey && !event.metaKey) {
        event.preventDefault()
        event.stopPropagation()
        const rect = shellRef.current?.getBoundingClientRect()
        const shellHeight = rect && rect.height > 0 ? rect.height : 1
        const stepPx = event.shiftKey ? SPLITTER_SHIFT_ARROW_STEP_PX : SPLITTER_ARROW_STEP_PX
        const stepRatio = stepPx / shellHeight
        // ArrowUp moves the horizon line up (sky shrinks); ArrowDown moves it down (sky grows).
        const signedStep = event.key === 'ArrowUp' ? -stepRatio : stepRatio
        const target = clampHorizonRatio(liveRatioRef.current + signedStep)
        cancelAnimation()
        liveRatioRef.current = target
        applyHorizonRatioToDom(shellRef.current, splitterRef.current, target)
        setHorizonRatio(target)
        return
      }

      if (event.key === 'Enter') {
        event.preventDefault()
        event.stopPropagation()
        animateRatioTo(nextHorizonDetent(liveRatioRef.current), true)
      }
    },
    [animateRatioTo, cancelAnimation, isCompactHeight, setHorizonRatio],
  )

  // Global horizon shortcuts (spec H): Tab flip, ` peek-hold, Ctrl+Up/Down nudge. All of them
  // stand down while a dialog is open or focus is in an editable control; the Tab flip is
  // additionally restricted to "resting" focus (body / plain stratum surface) so it can never
  // shadow native focus traversal — see isTabFlipRestingTarget.
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      // Carried advisory (item-2 review, advisory 2): an active pointer-drag already owns
      // liveRatioRef/the DOM writes every frame via rAF. Without this guard, Ctrl+Arrow/`
      // firing mid-drag would race those writes with animateRatioTo's own rAF loop and could
      // leave the shell in a torn state (drag resumes from a ratio the nudge/peek already
      // stomped, or vice versa). Simplest fix: while a pointer-drag is live, every horizon
      // shortcut stands down and lets the drag finish.
      if (draggingRef.current) {
        return
      }

      if (isEditableTarget(event.target) || isOverlayOpen()) {
        return
      }

      // Tab and Shift+Tab both flip the horizon between its two default detents (spec F.2 —
      // with exactly two "default" states, cycling forward/backward is the same swap).
      if (event.key === 'Tab' && !event.ctrlKey && !event.altKey && !event.metaKey) {
        if (!isTabFlipRestingTarget(event.target)) {
          return
        }

        event.preventDefault()
        animateRatioTo(toggleHorizonDefaultRatio(liveRatioRef.current), true)
        return
      }

      // Peek and nudge both free-move the horizon, so — like drag — they're disabled while the
      // window is short enough to have locked to the last-emphasized stratum (spec J.2). Tab
      // above stays active since it's what un-locks/re-locks which stratum that is.
      if (isCompactHeight) {
        return
      }

      if (event.key === '`' && !event.repeat && !event.ctrlKey && !event.altKey && !event.metaKey) {
        event.preventDefault()
        if (peekOriginRef.current === null) {
          peekOriginRef.current = liveRatioRef.current
          animateRatioTo(toggleHorizonDefaultRatio(liveRatioRef.current), false)
        }
        return
      }

      if (event.ctrlKey && !event.altKey && !event.metaKey && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) {
        event.preventDefault()
        const delta = event.key === 'ArrowUp' ? -HORIZON_NUDGE_STEP : HORIZON_NUDGE_STEP
        animateRatioTo(clampHorizonRatio(liveRatioRef.current + delta), true)
      }
    }

    function handleKeyUp(event: KeyboardEvent) {
      if (event.key === '`') {
        restorePeek(false)
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    window.addEventListener('keyup', handleKeyUp)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
      window.removeEventListener('keyup', handleKeyUp)
    }
  }, [animateRatioTo, isCompactHeight, restorePeek])

  // MERIDIAN item 3 (spec L.1's 5-row template, folding the stage row onto the horizon —
  // carried review note from item 2): sky / top hairline+splitter / stage row (fixed height) /
  // bottom hairline / ground. The two new "auto" rows sandwich the fixed-height stage row
  // between sky and ground; only the sky/ground tracks are driven by --meridian-sky/-ground, so
  // dragging the splitter moves sky and ground space around the stage row without ever
  // resizing it (AC F.1). The splitter itself is unchanged from item 2 — same element, same
  // pointer/keyboard handlers, same ref — it's just relocated to sit directly above the stage
  // row instead of between two flex rows.
  const gridTemplateRows = useMemo(() => {
    if (isCompactHeight) {
      return compactEmphasis === 'workflow'
        ? `minmax(0, 1fr) auto var(--meridian-stage-h) auto ${COMPACT_PEEK_STRIP_PX}px`
        : `${COMPACT_PEEK_STRIP_PX}px auto var(--meridian-stage-h) auto minmax(0, 1fr)`
    }

    return 'minmax(0, var(--meridian-sky)) auto var(--meridian-stage-h) auto minmax(0, var(--meridian-ground))'
  }, [compactEmphasis, isCompactHeight])

  const shellStyle = {
    gridTemplateRows,
    // fr units, NOT percentages — same contract as applyHorizonRatioToDom (review BLOCKING-2).
    '--meridian-sky': horizonTrackSize(skyRatio),
    '--meridian-ground': horizonTrackSize(1 - skyRatio),
    '--meridian-stage-h': `${isCompactHeight ? COMPACT_HEIGHT_STAGE_ROW_PX : STAGE_ROW_HEIGHT_PX}px`,
  } as CSSProperties

  const skyCollapsed = isCompactHeight && compactEmphasis === 'timeline'
  const groundCollapsed = isCompactHeight && compactEmphasis === 'workflow'

  return (
    <div
      ref={shellRef}
      data-meridian-shell
      className={`grid ${className ?? ''}`}
      style={shellStyle}
    >
      <div data-meridian-stratum="workflow" className="min-h-0 overflow-hidden">
        {skyCollapsed ? (
          <CollapsedStratumStrip label="Sky · Workflow" />
        ) : (
          <ErrorBoundary label="Workflow">
            <Suspense fallback={<PanelFallback label="Loading workflow workspace" />}>
              <WorkflowView />
            </Suspense>
          </ErrorBoundary>
        )}
      </div>

      <div
        ref={splitterRef}
        role="separator"
        aria-orientation="horizontal"
        aria-label="Horizon: drag to resize the workflow and timeline strata"
        aria-valuenow={Math.round(skyRatio * 100)}
        aria-valuemin={Math.round(HORIZON_RATIO_MIN * 100)}
        aria-valuemax={Math.round(HORIZON_RATIO_MAX * 100)}
        tabIndex={0}
        className={`group relative z-[var(--z-sticky)] flex h-2 shrink-0 items-center justify-center ${
          isCompactHeight ? 'cursor-not-allowed' : 'cursor-row-resize'
        }`}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onKeyDown={handleSplitterKeyDown}
      >
        <div className="pointer-events-none h-px w-full bg-hairline transition-colors duration-[var(--dur-fast)] ease-[var(--ease-out-quart)] group-hover:bg-white/25" />
      </div>

      {/* Stage row (spec F/M.4): exactly three organs — job ledger (left, 216px), preview
          stage (center, absorbs remaining width), inspector (right, 288px). Height is fixed via
          the --meridian-stage-h var set above; this div only ever gets taller/shorter across a
          density-mode or compact-height change, never during a horizon drag. */}
      <div
        data-meridian-stage-row
        className="flex min-h-0 min-w-0 overflow-hidden bg-surface-2"
      >
        <ErrorBoundary label="Job ledger" compact>
          <JobLedger />
        </ErrorBoundary>
        <div className="min-h-0 min-w-0 flex-1 overflow-hidden">
          <ErrorBoundary label="Preview stage" compact>
            <PreviewPanel embedded />
          </ErrorBoundary>
        </div>
        <ErrorBoundary label="Inspector" compact>
          <StageInspector />
        </ErrorBoundary>
      </div>

      <div aria-hidden="true" className="h-px w-full shrink-0 bg-hairline" />

      <div data-meridian-stratum="timeline" className="min-h-0 overflow-hidden">
        {groundCollapsed ? (
          <CollapsedStratumStrip label="Ground · Timeline" />
        ) : (
          <ErrorBoundary label="Timeline">
            <Suspense fallback={<PanelFallback label="Loading timeline workspace" />}>
              <TimelineView />
            </Suspense>
          </ErrorBoundary>
        )}
      </div>

      {/* MERIDIAN item 5: full-viewport lineage thread overlay. Fixed-positioned (escapes the
          grid flow entirely), so its placement here in the child order only matters for paint
          order (last = on top, honoring --z-thread regardless). */}
      <LineageThread />
    </div>
  )
}

function CollapsedStratumStrip({ label }: { label: string }) {
  return (
    <div className="flex h-8 items-center justify-center rounded-[1.25rem] border border-white/10 bg-black/30 px-3 text-[10px] uppercase tracking-[0.25em] text-text-secondary">
      {label} · Tab to expand
    </div>
  )
}
