import { ChevronLeft, ChevronRight, ListTree } from 'lucide-react'
import { IconButton } from '../../components/IconButton'
import { useProjectStore } from '../../store/project-store'
import { RenderJobProgress } from './RenderJobProgress'

const LEDGER_WIDTH_PX = 216
const RAIL_WIDTH_PX = 40

const ACTIVE_STATUSES = new Set(['queued', 'rendering', 'paused'])

/**
 * MERIDIAN stage row (item 3), left organ (spec F/M.4: "job ledger"). Docked, fixed-width
 * (216px), collapsible to a 40px icon rail (spec F.3).
 *
 * This item ships the region shell (header, empty state, collapse rail) plus a minimal
 * read-only list sourced straight from `project.output.queue` — no chip styling, no
 * determinate-progress internals beyond what `RenderJobProgress` already renders. Item 4
 * ("JobChip + job ledger states") owns turning these rows into real JobChips (meter, ETA,
 * cancel, landed/auto-clear).
 */
export function JobLedger() {
  const collapsed = useProjectStore((state) => state.project.meta.stageRowCollapse.ledger)
  const toggleStageRowCollapse = useProjectStore((state) => state.toggleStageRowCollapse)
  const queue = useProjectStore((state) => state.project.output.queue)

  const activeJobs = queue.filter((job) => ACTIVE_STATUSES.has(job.status))
  const isRendering = activeJobs.some((job) => job.status === 'rendering')

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
        {activeJobs.length > 0 ? (
          <span
            aria-hidden="true"
            className={`flex h-5 min-w-5 items-center justify-center rounded-full border px-1 text-[10px] font-semibold tabular-nums ${
              isRendering ? 'animate-pulse border-accent/40 bg-accent/10 text-accent' : 'border-white/15 bg-white/5 text-text-secondary'
            }`}
          >
            {activeJobs.length}
          </span>
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
        {activeJobs.length === 0 ? (
          <p className="text-xs leading-5 text-text-secondary">No jobs. G regenerates the selected node.</p>
        ) : (
          <ul className="space-y-3">
            {activeJobs.map((job) => (
              <li key={job.id} className="rounded-md border border-white/8 bg-black/20 p-2">
                <p className="truncate text-xs font-medium text-white" title={job.name}>
                  {job.name}
                </p>
                <RenderJobProgress job={job} />
              </li>
            ))}
          </ul>
        )}
      </div>
    </aside>
  )
}
