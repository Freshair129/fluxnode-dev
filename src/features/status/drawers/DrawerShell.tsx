import { X } from 'lucide-react'
import { useEffect, type ComponentType, type ReactNode } from 'react'
import { useModalA11y } from '../../settings/useModalA11y'

/**
 * Shared chrome for the four status-bar drawers (Connectivity, App Updates, Workspace Sharing,
 * Audio + Runtime) AND the wider Export sheet (`ExportSheet.tsx` composes this same shell).
 *
 * These surfaces are `aria-modal="true"` and focus-trapped (via `useModalA11y`) — trap and ARIA
 * declaration MUST agree (spec J.7 clarification, added after the item-9 review). The earlier
 * "focus-trapped but NOT aria-modal" shape was internally incompatible: `useModalA11y`'s Tab trap
 * is container-scoped and Tab-only, so a keyboard user could not Tab out — yet `role="dialog"`
 * without `aria-modal` told assistive tech the background was live (WCAG 4.1.2). This is J.7-safe:
 * "modal" in J.7 means *process-blocking*, not the ARIA attribute — a queued render keeps running
 * in the job ledger whether or not this sheet is open; nothing waits on a window. What J.7 forbids
 * is a surface that opens *unbidden* on an export finishing or a job failing (those surface in the
 * ledger / inline in a chip), not a transient config sheet the user chose to open.
 *
 * `aria-modal="true"` is also what makes `isOverlayOpen()` (features/shortcuts/guardTargets.ts) a
 * SINGLE honest rule for the whole app: it reads `[aria-modal="true"]` to suppress the horizon
 * Tab-flip, backtick peek, and the `F` lineage jump. Making these surfaces honest members of that
 * set means one rule keeps working everywhere with zero special cases (the command palette is
 * `aria-modal` for exactly this reason). While one of these is open, Tab-flip/peek/`F` are
 * suppressed and Tab cycles within the surface — which is what a keyboard user expects of a modal.
 *
 * `Escape` closes the TOPMOST surface only (spec H). This shell owns its own Escape handler
 * (rather than App.tsx, whose handler is gated by `isOverlayOpen()` and would now bail on these
 * aria-modal surfaces): it acts only when no other `[aria-modal="true"]` element follows this one
 * in DOM order, so a true modal stacked on top (FailureInspectorModal, which `StatusOverlays`
 * renders AFTER the drawers/sheet) consumes the first Escape via its own handler, and a second
 * Escape then reaches and closes this drawer.
 */
export function DrawerShell({
  icon: Icon,
  title,
  onClose,
  widthClassName = 'w-full max-w-sm',
  children,
}: {
  icon: ComponentType<{ size?: number; className?: string }>
  title: string
  onClose: () => void
  widthClassName?: string
  children: ReactNode
}) {
  const containerRef = useModalA11y<HTMLDivElement>(true)

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key !== 'Escape') {
        return
      }

      const container = containerRef.current
      if (!container) {
        return
      }

      // "Closes topmost overlay only" (spec H): act only if no OTHER aria-modal surface follows
      // this one in document order. StatusOverlays renders FailureInspectorModal after the
      // drawers/sheet, so when it is stacked on top it is DOCUMENT_POSITION_FOLLOWING this
      // container — its own Escape handler fires and this one stands down; once it closes, the
      // next Escape finds this container topmost and closes it.
      const modals = Array.from(document.querySelectorAll('[aria-modal="true"]'))
      const hasSurfaceAbove = modals.some(
        (element) =>
          element !== container &&
          Boolean(container.compareDocumentPosition(element) & Node.DOCUMENT_POSITION_FOLLOWING),
      )

      if (hasSurfaceAbove) {
        return
      }

      event.preventDefault()
      onClose()
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [containerRef, onClose])

  return (
    <>
      {/* Round-3 z-order fix (orchestrator ruling): these are Overlays (spec E — command palette,
          export sheet, settings sheet), NOT the in-stratum `--z-drawer` (10) surfaces (node
          library, Takes, asset strip — none built yet). An `aria-modal` surface that traps focus
          and suppresses the horizon keys must never be painted over by the decorative lineage
          thread (`--z-thread`, 20). So the panel sits at `--z-overlay` (50), above the thread, with
          a `--z-overlay-backdrop` (40) scrim beneath it.

          The scrim is `pointer-events-none` and the panel container is right-anchored (NOT a
          full-viewport root): the strata shell must stay live and clickable underneath (spec J.7 —
          these surfaces never process-block; the suppression tests literally click the sky while a
          sheet is open). Dismissal is via Escape / the close button, not a backdrop click. */}
      <div aria-hidden="true" className="pointer-events-none fixed inset-0 z-[var(--z-overlay-backdrop)] bg-black/40" />
      <div className="fixed inset-y-0 right-0 z-[var(--z-overlay)] flex justify-end p-3" data-meridian-drawer-root>
        <div
          ref={containerRef}
          role="dialog"
          aria-modal="true"
          aria-label={title}
          tabIndex={-1}
          data-meridian-drawer={title}
          className={`flex h-full ${widthClassName} flex-col overflow-hidden rounded-[1.5rem] border border-white/10 bg-[#101112]/98 shadow-[0_30px_120px_rgba(0,0,0,0.55)] outline-none`}
        >
          <div className="flex shrink-0 items-center justify-between gap-3 border-b border-white/8 px-5 py-4">
            <div className="flex items-center gap-3">
              <Icon size={18} className="text-[#e0ff00]" />
              <h2 className="text-sm font-semibold uppercase tracking-[0.2em] text-white">{title}</h2>
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label={`Close ${title}`}
              className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-white/10 bg-white/5 text-white transition hover:border-white/20"
            >
              <X size={16} />
            </button>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-5">{children}</div>
        </div>
      </div>
    </>
  )
}
