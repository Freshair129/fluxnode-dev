import type { RenderJob } from '../../domain/project/types'

type RenderStatus = RenderJob['status']

const STATUS_STYLES: Record<RenderStatus, { label: string; badge: string; bar: string }> = {
  queued: {
    label: 'Queued',
    badge: 'border-white/15 bg-white/5 text-[#cbd2dc]',
    bar: 'bg-white/30',
  },
  rendering: {
    label: 'Rendering',
    badge: 'border-[#e0ff00]/40 bg-[#e0ff00]/10 text-[#e0ff00]',
    bar: 'bg-[#e0ff00]',
  },
  paused: {
    label: 'Paused',
    badge: 'border-amber-400/30 bg-amber-500/10 text-amber-200',
    bar: 'bg-amber-400',
  },
  completed: {
    label: 'Completed',
    badge: 'border-emerald-400/30 bg-emerald-500/10 text-emerald-200',
    bar: 'bg-emerald-400',
  },
  failed: {
    label: 'Failed',
    badge: 'border-red-400/30 bg-red-500/10 text-red-200',
    bar: 'bg-red-400',
  },
  cancelled: {
    label: 'Cancelled',
    badge: 'border-white/15 bg-white/5 text-[#9ca3af]',
    bar: 'bg-white/25',
  },
}

function formatEta(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) {
    return '0s'
  }

  const total = Math.round(seconds)
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const secs = total % 60

  if (hours > 0) {
    return `${hours}h ${minutes}m`
  }
  if (minutes > 0) {
    return `${minutes}m ${secs}s`
  }
  return `${secs}s`
}

/**
 * Live progress readout for a single render job: status badge, a frame-derived
 * progress bar, and an ETA. Values come straight from the backend
 * `render_get_status` contract surfaced on the queued `RenderJob`.
 */
export function RenderJobProgress({ job }: { job: RenderJob }) {
  const style = STATUS_STYLES[job.status] ?? STATUS_STYLES.queued
  const frameRatio = job.totalFrames > 0 ? job.currentFrame / job.totalFrames : 0
  const ratio = Math.max(
    0,
    Math.min(1, job.status === 'completed' ? 1 : Number.isFinite(frameRatio) ? frameRatio : job.progress / 100),
  )
  const percent = Math.round(ratio * 100)
  const isActive = job.status === 'rendering'

  const etaLabel =
    job.status === 'completed'
      ? 'Done'
      : job.status === 'failed' || job.status === 'cancelled'
        ? '—'
        : job.estimatedTimeRemaining !== null && job.estimatedTimeRemaining > 0
          ? `~${formatEta(job.estimatedTimeRemaining)} left`
          : 'ETA pending'

  return (
    <div className="mt-3">
      <div className="flex items-center justify-between gap-2">
        <span
          className={`rounded-full border px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.18em] ${style.badge}`}
        >
          {style.label}
        </span>
        <span className="text-[11px] tabular-nums text-[#9ca3af]">
          {percent}% · {job.currentFrame}/{job.totalFrames} frames
        </span>
      </div>
      <div
        className="mt-2 h-2 w-full overflow-hidden rounded-full bg-white/8"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
        aria-label={`${job.name} render progress`}
      >
        <div
          className={`h-full rounded-full transition-[width] duration-300 ease-out ${style.bar} ${isActive ? 'animate-pulse' : ''}`}
          style={{ width: `${percent}%` }}
        />
      </div>
      <p className="mt-1.5 text-[11px] tabular-nums text-[#7f8792]">{etaLabel}</p>
    </div>
  )
}
