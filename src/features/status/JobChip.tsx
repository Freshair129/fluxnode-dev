import { useEffect, useState } from 'react'
import { AlertTriangle, Check, ChevronDown, ChevronUp, FolderOpen, Pause, Play, RefreshCcw, X } from 'lucide-react'
import type { RenderJob } from '../../domain/project/types'
import {
  computeJobProgressRatio,
  describeErrorCategory,
  formatElapsedSince,
  formatEtaRemaining,
  formatOrdinal,
  JOB_LEDGER_FLASH_MS,
} from '../../domain/project/jobLedger'
import { prefersReducedMotion } from '../../domain/project/horizon'
import { Meter } from '../../components/Meter'
import { IconButton } from '../../components/IconButton'

export interface JobChipProps {
  job: RenderJob
  /** Shared ticking clock from the ledger — avoids one `setInterval` per chip. */
  now: number
  /** 1-based position among queued jobs; `null` for non-queued statuses. */
  queuePosition: number | null
  /** Success row hover-pin (spec H): while hovered, a completed chip is exempt from auto-clear. */
  isHovered: boolean
  onHoverChange: (hovered: boolean) => void
  onCancel: () => void
  onPause: () => void
  onResume: () => void
  onRetry: () => void
  onReveal: () => void
  canReveal: boolean
}

const CHIP_BASE_CLASS = 'rounded-md border p-2.5 transition-colors duration-[var(--dur-fast)] ease-[var(--ease-out-quart)]'

const TONE_CHIP_CLASS: Record<'neutral' | 'accent' | 'danger' | 'success', string> = {
  neutral: 'border-white/8 bg-black/20',
  accent: 'border-accent/25 bg-accent/[0.06]',
  danger: 'border-danger/25 bg-danger/10',
  success: 'border-success/25 bg-success/10',
}

function JobName({ job }: { job: RenderJob }) {
  return (
    <p className="truncate text-xs font-medium text-white" title={job.name}>
      {job.name}
    </p>
  )
}

/**
 * One row in the job ledger, mapped from a single `RenderJob` onto spec-H's job-ledger states
 * (Empty is JobLedger's own concern; this covers Loading/Active/Error/Success/Long-running).
 * Accent is reserved for the actively-rendering meter and the one-shot landing flash (M.2) —
 * every other state uses neutral, danger, or success tokens.
 */
export function JobChip({
  job,
  now,
  queuePosition,
  isHovered,
  onHoverChange,
  onCancel,
  onPause,
  onResume,
  onRetry,
  onReveal,
  canReveal,
}: JobChipProps) {
  switch (job.status) {
    case 'queued':
      return <QueuedChip job={job} now={now} queuePosition={queuePosition} />
    case 'rendering':
      return <RenderingChip job={job} onCancel={onCancel} onPause={onPause} />
    case 'paused':
      return <PausedChip job={job} onResume={onResume} />
    case 'failed':
      return <FailedChip job={job} onRetry={onRetry} />
    case 'cancelled':
      return <CancelledChip job={job} onRetry={onRetry} />
    case 'completed':
      return (
        <CompletedChip
          job={job}
          isHovered={isHovered}
          onHoverChange={onHoverChange}
          onReveal={onReveal}
          canReveal={canReveal}
        />
      )
    default:
      return null
  }
}

/**
 * Spec H "Empty/Loading" for a not-yet-started job + M.5 (no indeterminate-only spinners):
 * queue position + elapsed replace a bare spinner entirely.
 */
function QueuedChip({ job, now, queuePosition }: { job: RenderJob; now: number; queuePosition: number | null }) {
  return (
    <li className={`${CHIP_BASE_CLASS} ${TONE_CHIP_CLASS.neutral}`} data-meridian-jobchip="queued">
      <JobName job={job} />
      {/* BLOCKING-2 (round-1 review): the ledger <aside> is aria-live="polite", so ANY descendant
          text change is announced. The per-second `now` tick makes the elapsed clock volatile —
          left un-hidden it produces a 1 Hz announcement backlog. Polite should fire on state
          TRANSITIONS (K.3), so the static part ("Queued · 2nd in line") stays announceable while
          the volatile elapsed span is aria-hidden. Same treatment on RenderingChip below. */}
      <p className="mt-1.5 text-[11px] tabular-nums text-text-secondary">
        Queued{queuePosition !== null ? ` · ${formatOrdinal(queuePosition)} in line` : ''}
        <span aria-hidden="true"> · {formatElapsedSince(job.createdAt, now)} elapsed</span>
      </p>
    </li>
  )
}

/**
 * Spec H "Active"/"Long-running": determinate meter + percent + ETA + frame counter + cancel.
 * The meter pulses ~once/second while live (M.5 requires the meter itself to stay determinate —
 * pulse is a purely decorative overlay, never a substitute for real progress). Reduced motion
 * collapses the pulse to static via the global `prefers-reduced-motion` rule in
 * src/styles/index.css — nothing extra needed here.
 */
function RenderingChip({ job, onCancel, onPause }: { job: RenderJob; onCancel: () => void; onPause: () => void }) {
  const ratio = computeJobProgressRatio(job)
  const percent = Math.round(ratio * 100)

  return (
    <li className={`${CHIP_BASE_CLASS} ${TONE_CHIP_CLASS.accent}`} data-meridian-jobchip="rendering">
      <div className="flex items-center justify-between gap-2">
        <JobName job={job} />
        {/* Volatile per-tick spans are aria-hidden — see BLOCKING-2 note on QueuedChip. The Meter
            (role=progressbar) carries the determinate progress; its aria-valuenow is an attribute,
            not churning text, so it isn't part of the polite backlog. */}
        <span aria-hidden="true" className="shrink-0 text-[11px] tabular-nums text-accent">{percent}%</span>
      </div>
      <Meter value={ratio} tone="accent" pulse label={`${job.name} render progress`} className="mt-2" />
      <div className="mt-1.5 flex items-center justify-between gap-2">
        {/* Advisory 1: min-w-0 + truncate lets this flex child shrink instead of overflowing the
            216px chip if the frame/ETA string ever runs long (belt-and-suspenders). */}
        <span aria-hidden="true" className="min-w-0 truncate text-[11px] tabular-nums text-text-secondary">
          {job.currentFrame}/{job.totalFrames} frames · {formatEtaRemaining(job.estimatedTimeRemaining)}
        </span>
        <div className="flex shrink-0 items-center gap-1">
          <IconButton label="Pause render" title="Pause render" size="sm" onClick={onPause}>
            <Pause size={13} aria-hidden="true" />
          </IconButton>
          <IconButton label="Cancel render" title="Cancel render" size="sm" onClick={onCancel}>
            <X size={13} aria-hidden="true" />
          </IconButton>
        </div>
      </div>
    </li>
  )
}

/** Spec H: paused preserves progress but is not "live" — neutral tone, static meter, resume action. */
function PausedChip({ job, onResume }: { job: RenderJob; onResume: () => void }) {
  const ratio = computeJobProgressRatio(job)
  const percent = Math.round(ratio * 100)

  return (
    <li className={`${CHIP_BASE_CLASS} ${TONE_CHIP_CLASS.neutral}`} data-meridian-jobchip="paused">
      <div className="flex items-center justify-between gap-2">
        <JobName job={job} />
        <span className="shrink-0 text-[11px] tabular-nums text-text-secondary">{percent}% · paused</span>
      </div>
      <Meter value={ratio} tone="neutral" label={`${job.name} render progress, paused`} className="mt-2" />
      <div className="mt-1.5 flex items-center justify-between gap-2">
        <span className="text-[11px] tabular-nums text-text-secondary">
          {job.currentFrame}/{job.totalFrames} frames held
        </span>
        <IconButton label="Resume render" title="Resume render" size="sm" onClick={onResume}>
          <Play size={13} aria-hidden="true" />
        </IconButton>
      </div>
    </li>
  )
}

/**
 * Spec H Error row: danger treatment, inline (never modal) expandable detail, Retry/Logs.
 * `aria-live="assertive"` on the cause line — the ledger region itself is only "polite" (K.3
 * calls errors out specifically as the assertive exception).
 */
function FailedChip({ job, onRetry }: { job: RenderJob; onRetry: () => void }) {
  const [expanded, setExpanded] = useState(false)
  const cause = describeErrorCategory(job.errorCategory)

  return (
    <li className={`${CHIP_BASE_CLASS} ${TONE_CHIP_CLASS.danger}`} data-meridian-jobchip="failed">
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-1.5">
          <AlertTriangle size={13} className="shrink-0 text-danger" aria-hidden="true" />
          <JobName job={job} />
        </div>
      </div>
      <p aria-live="assertive" className="mt-1.5 text-[11px] leading-4 text-danger">
        {cause}
      </p>
      {job.lastError ? (
        <button
          type="button"
          onClick={() => setExpanded((value) => !value)}
          aria-expanded={expanded}
          className="mt-1 flex items-center gap-1 text-[11px] text-text-secondary transition hover:text-white"
        >
          {expanded ? <ChevronUp size={12} aria-hidden="true" /> : <ChevronDown size={12} aria-hidden="true" />}
          {expanded ? 'Hide log' : 'Show log'}
        </button>
      ) : null}
      {expanded && job.lastError ? (
        <p className="mt-1.5 max-h-24 overflow-y-auto break-words rounded-sm bg-black/30 p-1.5 font-mono text-[10.5px] leading-4 text-text-data">
          {job.lastError}
        </p>
      ) : null}
      <div className="mt-2 flex items-center gap-2">
        <button
          type="button"
          onClick={onRetry}
          className="inline-flex items-center gap-1 rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-[11px] font-medium text-white transition hover:border-white/20"
        >
          <RefreshCcw size={11} aria-hidden="true" />
          Retry
        </button>
      </div>
    </li>
  )
}

/** Cancellation isn't an error (M.2: danger is reserved for real failures) — neutral tone, no log. */
function CancelledChip({ job, onRetry }: { job: RenderJob; onRetry: () => void }) {
  return (
    <li className={`${CHIP_BASE_CLASS} ${TONE_CHIP_CLASS.neutral}`} data-meridian-jobchip="cancelled">
      <JobName job={job} />
      <p className="mt-1.5 text-[11px] text-text-secondary">Cancelled</p>
      <div className="mt-2 flex items-center gap-2">
        <button
          type="button"
          onClick={onRetry}
          className="inline-flex items-center gap-1 rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-[11px] font-medium text-white transition hover:border-white/20"
        >
          <RefreshCcw size={11} aria-hidden="true" />
          Retry
        </button>
      </div>
    </li>
  )
}

/**
 * Spec H Success row: 400ms one-shot accent flash on landing (reduced motion: skipped entirely,
 * never partially played), then settles into a compact "landed" row using the success token —
 * accent stays reserved for the live moment, not the resting completed state. Auto-clear/hover-pin
 * is owned by the ledger's visibility filter (`selectVisibleLedgerJobs`); this component only
 * reports hover state up so that filter can pin it.
 */
function CompletedChip({
  job,
  isHovered,
  onHoverChange,
  onReveal,
  canReveal,
}: {
  job: RenderJob
  isHovered: boolean
  onHoverChange: (hovered: boolean) => void
  onReveal: () => void
  canReveal: boolean
}) {
  // BLOCKING-1 (round-1 review): JobChip renders a DISTINCT sub-component per status, so a
  // rendering→completed transition unmounts RenderingChip and mounts a FRESH CompletedChip whose
  // job.status is already 'completed'. The previous `prevStatusRef`-guarded approach therefore
  // made the flash dead code — `wasAlreadyCompleted` was always true on the sole effect run, so
  // setFlashing(true) never fired and the chip rendered straight into the settled success tone.
  // Fresh-mount-per-completion is itself the one-shot guarantee (spec M.10), so we flash on MOUNT
  // instead of guarding against it: start in the flashing tone unless reduced motion (in which
  // case we start settled and never flash — spec H "reduced-motion: none"), then settle once
  // after JOB_LEDGER_FLASH_MS.
  const [flashing, setFlashing] = useState(() => !prefersReducedMotion())

  useEffect(() => {
    if (!flashing) {
      return
    }

    const timer = setTimeout(() => setFlashing(false), JOB_LEDGER_FLASH_MS)
    return () => clearTimeout(timer)
    // Mount-only one-shot: `flashing`'s mount value is captured intentionally; re-running on its
    // change would re-arm the timer after it settles.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <li
      className={`${CHIP_BASE_CLASS} ${flashing ? TONE_CHIP_CLASS.accent : TONE_CHIP_CLASS.success}`}
      data-meridian-jobchip="completed"
      data-meridian-jobchip-flashing={flashing || undefined}
      onMouseEnter={() => onHoverChange(true)}
      onMouseLeave={() => onHoverChange(false)}
      onFocus={() => onHoverChange(true)}
      onBlur={() => onHoverChange(false)}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-1.5">
          <Check size={13} className={`shrink-0 ${flashing ? 'text-accent' : 'text-success'}`} aria-hidden="true" />
          <JobName job={job} />
        </div>
        {canReveal ? (
          <IconButton label="Reveal output" title="Reveal output" size="sm" onClick={onReveal}>
            <FolderOpen size={13} aria-hidden="true" />
          </IconButton>
        ) : null}
      </div>
      <p className="mt-1 text-[11px] text-text-secondary">Landed{isHovered ? ' · pinned' : ''}</p>
    </li>
  )
}
