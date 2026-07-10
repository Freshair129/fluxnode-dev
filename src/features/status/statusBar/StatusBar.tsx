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
      style={{ '--meridian-statusbar-h': '28px', height: 'var(--meridian-statusbar-h)' } as React.CSSProperties}
      className={`flex items-stretch gap-px overflow-hidden rounded-full border border-hairline bg-surface-2 px-1 ${className}`}
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
