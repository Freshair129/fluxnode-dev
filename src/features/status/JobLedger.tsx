import { useCallback, useEffect, useMemo, useState } from 'react'
import { ChevronLeft, ChevronRight, ListTree } from 'lucide-react'
import { IconButton } from '../../components/IconButton'
import { Meter } from '../../components/Meter'
import { useProjectStore } from '../../store/project-store'
import { canOpenPathInShell } from '../../services/ipc/app-shell'
import { computeJobProgressRatio, computeQueuePosition, selectVisibleLedgerJobs } from '../../domain/project/jobLedger'
import { JobChip } from './JobChip'

const LEDGER_WIDTH_PX = 216
const RAIL_WIDTH_PX = 40
/** Shared ticking clock for elapsed/ETA readouts and the completed-chip auto-clear check. */
const LEDGER_TICK_MS = 1000

/** Statuses that count toward the collapsed rail's badge — everything still needing attention. */
const RAIL_ACTIVE_STATUSES = new Set<string>(['queued', 'rendering', 'paused', 'failed'])

/**
 * Statuses whose display or lifecycle depends on wall-clock time, so the 1 Hz `now` tick is only
 * worth running while one is visible (advisory 2): `queued` (elapsed-since-created counter),
 * `rendering` (frame/ETA refresh cadence), and `completed` (the 8s auto-clear countdown in
 * `selectVisibleLedgerJobs` needs `now` to advance to fire). `paused`/`failed`/`cancelled` are
 * static, so a ledger showing only those — or an empty/collapsed one — never re-renders on a timer.
 */
const TIME_DEPENDENT_STATUSES = new Set<string>(['queued', 'rendering', 'completed'])

/**
 * MERIDIAN stage row (item 3 shell, item 4 states), left organ (spec F/M.4: "job ledger").
 * Docked, fixed-width (216px), collapsible to a 40px icon rail (spec F.3).
 *
 * Item 4 turns the plain rows item 3 shipped into real JobChips covering every job-ledger state
 * from spec section H: Empty (this component's own empty copy), Loading/Active/Long-running
 * (queued position+elapsed, rendering meter+ETA+cancel), Error (inline expandable failure +
 * retry), and Success (landed row, auto-clear 8s unless hovered). The collapsed rail keeps a
 * live active-job count plus a determinate aggregate meter so state survives collapse (spec F.3
 * + H "ledger is source of truth").
 */
export function JobLedger() {
  const collapsed = useProjectStore((state) => state.project.meta.stageRowCollapse.ledger)
  const toggleStageRowCollapse = useProjectStore((state) => state.toggleStageRowCollapse)
  const queue = useProjectStore((state) => state.project.output.queue)
  const pauseActiveRender = useProjectStore((state) => state.pauseActiveRender)
  const resumePausedRender = useProjectStore((state) => state.resumePausedRender)
  const cancelActiveRender = useProjectStore((state) => state.cancelActiveRender)
  const retryFailedRender = useProjectStore((state) => state.retryFailedRender)
  const openRenderOutput = useProjectStore((state) => state.openRenderOutput)

  const [now, setNow] = useState(() => Date.now())
  const [hoveredJobIds, setHoveredJobIds] = useState<Set<string>>(() => new Set())

  // Advisory 2: only run the 1 Hz clock when it can actually change something on screen — the
  // ledger is expanded AND at least one visible job is time-dependent. An empty, collapsed, or
  // all-static (paused/failed) ledger imposes no per-second re-render.
  const needsTick = !collapsed && queue.some((job) => TIME_DEPENDENT_STATUSES.has(job.status))

  useEffect(() => {
    if (!needsTick) {
      return
    }

    // Re-sync immediately on (re)arming so a job that just appeared doesn't show a stale `now`
    // for up to a full second before the first interval fire.
    setNow(Date.now())
    const id = window.setInterval(() => setNow(Date.now()), LEDGER_TICK_MS)
    return () => window.clearInterval(id)
  }, [needsTick])

  const setJobHovered = useCallback((jobId: string, hovered: boolean) => {
    setHoveredJobIds((previous) => {
      const isMember = previous.has(jobId)
      if (hovered === isMember) {
        return previous
      }
      const next = new Set(previous)
      if (hovered) {
        next.add(jobId)
      } else {
        next.delete(jobId)
      }
      return next
    })
  }, [])

  const visibleJobs = useMemo(
    () => selectVisibleLedgerJobs(queue, { now, hoveredJobIds }),
    [queue, now, hoveredJobIds],
  )

  const renderingJob = queue.find((job) => job.status === 'rendering') ?? null
  const railJobs = queue.filter((job) => RAIL_ACTIVE_STATUSES.has(job.status))
  const railHasFailure = railJobs.some((job) => job.status === 'failed')
  const railRatio = renderingJob ? computeJobProgressRatio(renderingJob) : 0

  if (collapsed) {
    return (
      <div
        aria-label="Job ledger, collapsed"
        data-meridian-ledger-rail
        style={{ width: RAIL_WIDTH_PX }}
        className="flex h-full shrink-0 flex-col items-center gap-3 border-r border-hairline bg-surface-2 py-3"
      >
        <IconButton
          label="Expand job ledger"
          title="Expand job ledger"
          ariaExpanded={false}
          size="sm"
          onClick={() => toggleStageRowCollapse('ledger')}
        >
          <ChevronRight size={14} aria-hidden="true" />
        </IconButton>
        {railJobs.length > 0 ? (
          <>
            <span
              aria-hidden="true"
              className={`flex h-5 min-w-5 items-center justify-center rounded-full border px-1 text-[10px] font-semibold tabular-nums ${
                railHasFailure
                  ? 'border-danger/40 bg-danger/10 text-danger'
                  : renderingJob
                    ? 'animate-pulse border-accent/40 bg-accent/10 text-accent'
                    : 'border-white/15 bg-white/5 text-text-secondary'
              }`}
            >
              {railJobs.length}
            </span>
            <Meter
              value={railRatio}
              tone={railHasFailure ? 'danger' : renderingJob ? 'accent' : 'neutral'}
              pulse={renderingJob !== null}
              label="Aggregate render progress"
              className="w-6"
            />
          </>
        ) : (
          <ListTree size={16} aria-hidden="true" className="text-text-secondary" />
        )}
      </div>
    )
  }

  return (
    <aside
      aria-label="Job ledger"
      aria-live="polite"
      data-meridian-ledger
      style={{ width: LEDGER_WIDTH_PX }}
      className="flex h-full shrink-0 flex-col border-r border-hairline bg-surface-2"
    >
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-hairline px-3 py-2">
        <p className="text-[11px] uppercase tracking-[0.22em] text-text-secondary">Job Ledger</p>
        <IconButton
          label="Collapse job ledger"
          title="Collapse job ledger"
          ariaExpanded
          size="sm"
          onClick={() => toggleStageRowCollapse('ledger')}
        >
          <ChevronLeft size={14} aria-hidden="true" />
        </IconButton>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        {visibleJobs.length === 0 ? (
          <p className="text-xs leading-5 text-text-secondary">No jobs. G regenerates the selected node.</p>
        ) : (
          <ul className="space-y-2">
            {visibleJobs.map((job) => (
              <JobChip
                key={job.id}
                job={job}
                now={now}
                queuePosition={computeQueuePosition(queue, job.id)}
                isHovered={hoveredJobIds.has(job.id)}
                onHoverChange={(hovered) => setJobHovered(job.id, hovered)}
                onCancel={() => void cancelActiveRender()}
                onPause={() => void pauseActiveRender()}
                onResume={() => void resumePausedRender(job.id)}
                onRetry={() => void retryFailedRender(job.id)}
                onReveal={() => void openRenderOutput(job.id)}
                canReveal={job.status === 'completed' && canOpenPathInShell(job.outputPath)}
              />
            ))}
          </ul>
        )}
      </div>
    </aside>
  )
}
