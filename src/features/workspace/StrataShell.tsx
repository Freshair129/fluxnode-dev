import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import {
  HORIZON_RATIO_MAX,
  HORIZON_RATIO_MIN,
  activeViewForRatio,
  clampHorizonRatio,
  easeOutQuart,
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

const WorkflowView = lazy(() =>
  import('../workflow/WorkflowView').then((module) => ({ default: module.WorkflowView })),
)
const TimelineView = lazy(() =>
  import('../timeline/TimelineView').then((module) => ({ default: module.TimelineView })),
)

/** Spec J.2 (minimal): below this inner height, the non-emphasized stratum collapses to a peek strip. */
const COMPACT_HEIGHT_BREAKPOINT = 720
const COMPACT_PEEK_STRIP_PX = 32

/** Splitter's own focused-arrow-key resize steps (spec J.4), independent of the global Ctrl+arrow nudge. */
const SPLITTER_ARROW_STEP_PX = 8
const SPLITTER_SHIFT_ARROW_STEP_PX = 40

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false
  }

  if (['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) {
    return true
  }

  if (target.isContentEditable) {
    return true
  }

  return target.closest('[role="combobox"]') !== null
}

/**
 * Every dialog/overlay in this app (ConfirmDialog, PromptDialog, WelcomeModal, SettingsModal,
 * WorkspaceSharingModal, ShortcutsCheatSheet) renders `aria-modal="true"`. Checking for that
 * attribute avoids threading a global "is a dialog open" flag through the store just for this
 * guard — see the CRITICAL a11y rule in the item-2 brief (mirrors spec J.4 / K.1).
 */
function isOverlayOpen(): boolean {
  return document.querySelector('[aria-modal="true"]') !== null
}

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
  const skyPct = ratio * 100
  const groundPct = (1 - ratio) * 100

  if (shellEl) {
    shellEl.style.setProperty('--meridian-sky', `${skyPct}%`)
    shellEl.style.setProperty('--meridian-ground', `${groundPct}%`)
  }

  if (splitterEl) {
    splitterEl.setAttribute('aria-valuenow', String(Math.round(skyPct)))
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

  const gridTemplateRows = useMemo(() => {
    if (isCompactHeight) {
      return compactEmphasis === 'workflow'
        ? `minmax(0, 1fr) auto ${COMPACT_PEEK_STRIP_PX}px`
        : `${COMPACT_PEEK_STRIP_PX}px auto minmax(0, 1fr)`
    }

    return 'minmax(0, var(--meridian-sky)) auto minmax(0, var(--meridian-ground))'
  }, [compactEmphasis, isCompactHeight])

  const shellStyle = {
    gridTemplateRows,
    '--meridian-sky': `${skyRatio * 100}%`,
    '--meridian-ground': `${(1 - skyRatio) * 100}%`,
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
      <div className="min-h-0 overflow-hidden">
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

      <div className="min-h-0 overflow-hidden">
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
