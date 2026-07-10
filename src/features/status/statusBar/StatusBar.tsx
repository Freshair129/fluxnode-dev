import { useProjectStore } from '../../../store/project-store'
import { buildStatusBarSegments, type StatusBarAction, type StatusBarTone } from './segments'

const TONE_CLASS: Record<StatusBarTone, string> = {
  neutral: 'text-text-secondary',
  ok: 'text-success',
  warn: 'text-warn',
  danger: 'text-danger',
  accent: 'text-accent',
}

/**
 * MERIDIAN item 9: the 28px status bar (spec F wireframe's bottom row), always visible at the
 * bottom of the workspace column. Segment content/tone/routing come from the pure
 * `buildStatusBarSegments` — this component only reads the live store into a snapshot and renders.
 *
 * Height is driven by a local `--meridian-statusbar-h` CSS var (default 28px = spec F's
 * "status bar 28px") rather than a hardcoded Tailwind height, per the item-9 brief ("use a CSS var
 * for its height, like `--meridian-stage-h`") so item 7 (density modes) can retarget it later
 * without touching this component's markup.
 *
 * Item 7: that retarget is `--meridian-statusbar-h: var(--meridian-row-h)` — spec G's row height
 * (28px comfortable / 24px compact) IS the status bar height, so this component no longer hardcodes
 * a literal at all; it just aliases onto the shared density-driven row-height variable set in
 * `src/styles/index.css`'s `[data-density]` rules.
 *
 * Item 7 K.5 fix: the hairline used to be a real `border`, which is INCLUDED in the border-box
 * height and ate 2px (1px top + 1px bottom) off the segments' available height via `items-stretch`
 * — invisible at 28px (26px remaining, still >=24) but pushed segments to 22px at the 24px compact
 * row height, under spec K.5's 24x24 floor (caught by this item's own hit-target e2e guard). Fixed
 * by painting the hairline as an inset box-shadow instead of a `border` — visually identical, but
 * a shadow is purely decorative and never subtracts from the layout box, so segments now stretch
 * to the FULL --meridian-statusbar-h in both densities.
 */
export function StatusBar({ onActivate, className = '' }: { onActivate: (action: StatusBarAction) => void; className?: string }) {
  const computeMode = useProjectStore((state) => state.project.workflow.computeMode)
  const networkStatus = useProjectStore((state) => state.ui.networkStatus)
  const runtimeBackendOk = useProjectStore((state) => state.runtimeHealth.status === 'ok')
  const timelineZoom = useProjectStore((state) => state.project.timeline.zoom)
  const lastSavedAt = useProjectStore((state) => state.ui.lastSavedAt)
  const lastAutoSavedAt = useProjectStore((state) => state.ui.lastAutoSavedAt)
  const projectUpdatedAt = useProjectStore((state) => state.project.meta.updatedAt)
  const queue = useProjectStore((state) => state.project.output.queue)
  const appUpdateStatus = useProjectStore((state) => state.appUpdateState.status)
  const sharingConflictCount = useProjectStore((state) => state.workspaceSyncConflicts.length)
  const hasUnrecoverableError = useProjectStore((state) => state.appErrors.some((error) => !error.recoverable))
  const hasRecoverableError = useProjectStore((state) => state.appErrors.some((error) => error.recoverable))

  const segments = buildStatusBarSegments({
    computeMode,
    networkStatus,
    runtimeBackendOk,
    timelineZoom,
    lastSavedAt,
    lastAutoSavedAt,
    projectUpdatedAt,
    queue,
    appUpdateStatus,
    sharingConflictCount,
    hasUnrecoverableError,
    hasRecoverableError,
  })

  return (
    <footer
      aria-label="Status bar"
      data-meridian-statusbar
      style={{ '--meridian-statusbar-h': 'var(--meridian-row-h)', height: 'var(--meridian-statusbar-h)' } as React.CSSProperties}
      className={`flex items-stretch gap-px overflow-hidden rounded-full bg-surface-2 px-1 shadow-[inset_0_0_0_1px_var(--color-hairline)] ${className}`}
    >
      {segments.map((segment) => (
        <button
          key={segment.id}
          type="button"
          data-meridian-statusbar-segment={segment.id}
          onClick={() => onActivate(segment.action)}
          aria-label={segment.ariaLabel}
          title={segment.ariaLabel}
          className={`flex items-center whitespace-nowrap rounded-full px-2.5 text-[11px] font-medium tabular-nums transition-colors duration-[var(--dur-fast)] ease-[var(--ease-out-quart)] hover:bg-white/5 ${TONE_CLASS[segment.tone]} ${segment.tone === 'accent' ? 'animate-pulse' : ''}`}
        >
          {segment.label}
        </button>
      ))}
    </footer>
  )
}
