/**
 * Pure job-ledger logic shared between the JobChip component and the JobLedger region
 * (`features/status`). Kept dependency-free (no React, no Zustand) so queue-position math,
 * elapsed/ETA formatting, and the ledger's sort/visibility rules can be unit tested directly —
 * mirrors the split already used for horizon math in `domain/project/horizon.ts`.
 *
 * See docs/design/MERIDIAN-UI-SPEC.md section H (job-ledger state table) and M.5 (no
 * indeterminate-only spinners: queued chips must show a queue position, not a bare spinner).
 */
import type { ErrorCategory, RenderJob } from './types'

/** Spec H Success row: "landed" entry auto-clears 8s after completion unless hovered. */
export const JOB_LEDGER_AUTO_CLEAR_MS = 8000

/** Spec H Success row: one-shot accent flash on landing, capped at 400ms (M anti-generic #10). */
export const JOB_LEDGER_FLASH_MS = 400

/**
 * Ledger relevance priority — lower sorts first. "Most-relevant first: rendering > queued >
 * paused > recently-failed > recently-completed-not-yet-cleared" (item-4 brief).
 */
const STATUS_PRIORITY: Record<RenderJob['status'], number> = {
  rendering: 0,
  queued: 1,
  paused: 2,
  failed: 3,
  cancelled: 3,
  completed: 4,
}

/**
 * Sorts jobs by ledger relevance (spec H), preserving each tier's original relative order
 * (stable) so `computeQueuePosition`, which reads off the *unsorted* queue, always agrees with
 * what the sorted, on-screen queued chips display.
 */
export function sortLedgerJobs(jobs: readonly RenderJob[]): RenderJob[] {
  return jobs
    .map((job, index) => ({ job, index }))
    .sort((a, b) => {
      const priorityDelta = STATUS_PRIORITY[a.job.status] - STATUS_PRIORITY[b.job.status]
      return priorityDelta !== 0 ? priorityDelta : a.index - b.index
    })
    .map((entry) => entry.job)
}

/**
 * 1-based position of `jobId` among jobs still in `queued` status, in queue order (the same
 * order `moveRenderJob` reorders in the store). Returns `null` if the job isn't queued or isn't
 * found — a rendering/paused/completed/failed job has no queue position.
 */
export function computeQueuePosition(queue: readonly RenderJob[], jobId: string): number | null {
  const job = queue.find((entry) => entry.id === jobId)

  if (!job || job.status !== 'queued') {
    return null
  }

  let position = 0
  for (const entry of queue) {
    if (entry.status !== 'queued') {
      continue
    }
    position += 1
    if (entry.id === jobId) {
      return position
    }
  }

  return null
}

/** "1st", "2nd", "3rd", "4th", "11th"... (handles the 11-13 teen exception). */
export function formatOrdinal(n: number): string {
  const remainder100 = n % 100
  if (remainder100 >= 11 && remainder100 <= 13) {
    return `${n}th`
  }

  switch (n % 10) {
    case 1:
      return `${n}st`
    case 2:
      return `${n}nd`
    case 3:
      return `${n}rd`
    default:
      return `${n}th`
  }
}

/** Frame-derived progress ratio (0-1), falling back to `job.progress` when frame counts are unusable. */
export function computeJobProgressRatio(job: RenderJob): number {
  if (job.status === 'completed') {
    return 1
  }

  const frameRatio = job.totalFrames > 0 ? job.currentFrame / job.totalFrames : Number.NaN
  const ratio = Number.isFinite(frameRatio) ? frameRatio : job.progress / 100
  return Math.max(0, Math.min(1, Number.isFinite(ratio) ? ratio : 0))
}

/** `mm:ss` / `h:mm:ss` duration formatter shared by elapsed and ETA readouts. */
function formatClock(totalSeconds: number): string {
  const total = Math.max(0, Math.round(totalSeconds))
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const seconds = total % 60

  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
  }
  return `${minutes}:${String(seconds).padStart(2, '0')}`
}

/** Elapsed time between an ISO timestamp and `nowMs`, e.g. "2:14". Never negative. */
export function formatElapsedSince(sinceIso: string, nowMs: number): string {
  const since = Date.parse(sinceIso)
  if (!Number.isFinite(since)) {
    return '0:00'
  }
  return formatClock((nowMs - since) / 1000)
}

/** ETA readout, e.g. "~2:14 left". `null`/non-positive seconds reads as "ETA pending". */
export function formatEtaRemaining(seconds: number | null): string {
  if (seconds === null || !Number.isFinite(seconds) || seconds <= 0) {
    return 'ETA pending'
  }
  return `~${formatClock(seconds)} left`
}

const ERROR_CATEGORY_LABELS: Record<ErrorCategory, string> = {
  comfy_connection: 'Render engine connection lost',
  comfy_execution: 'Render engine execution error',
  cloud_network: 'Cloud network interrupted',
  cloud_auth: 'Cloud authentication failed',
  cloud_quota: 'Cloud quota exceeded',
  asset_missing: 'Source asset missing',
  asset_corrupt: 'Source asset corrupt',
  render_failed: 'Render failed',
  disk_full: 'Disk full',
  memory_pressure: 'System memory pressure',
  gpu_oom: 'GPU out of memory',
  internal: 'Internal error',
}

/** Short, human cause label for a job's `errorCategory` — the chip's inline failure headline. */
export function describeErrorCategory(category: ErrorCategory | null): string {
  return category !== null ? ERROR_CATEGORY_LABELS[category] : 'Render failed'
}

export interface LedgerVisibilityOptions {
  now: number
  hoveredJobIds: ReadonlySet<string>
  autoClearMs?: number
}

/**
 * Which jobs the ledger should render right now. Active jobs (queued/rendering/paused) and
 * failed/cancelled jobs stay until the user acts on them; completed jobs auto-clear
 * `autoClearMs` after `completedAt` unless hovered (spec H Success row: "auto-clear 8s, hover
 * pins"). Sorted by `sortLedgerJobs` relevance.
 */
export function selectVisibleLedgerJobs(
  queue: readonly RenderJob[],
  options: LedgerVisibilityOptions,
): RenderJob[] {
  const { now, hoveredJobIds, autoClearMs = JOB_LEDGER_AUTO_CLEAR_MS } = options

  const visible = queue.filter((job) => {
    if (job.status !== 'completed') {
      return true
    }

    if (hoveredJobIds.has(job.id)) {
      return true
    }

    const completedAt = job.completedAt !== null ? Date.parse(job.completedAt) : Number.NaN
    if (!Number.isFinite(completedAt)) {
      return true
    }

    return now - completedAt < autoClearMs
  })

  return sortLedgerJobs(visible)
}
