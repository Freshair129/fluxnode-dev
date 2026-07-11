import { useEffect } from 'react'
import { X } from 'lucide-react'
import { useModalA11y } from '../settings/useModalA11y'
import { useProjectStore } from '../../store/project-store'
import { InspectorCard } from './shared/PanelPrimitives'

/**
 * MERIDIAN item 9: relocated verbatim from `SystemPanels.tsx` — behavior UNCHANGED per the item-9
 * brief ("already fixed (items 12/13) so it only opens from an explicit id. Leave its behavior
 * as-is; just make sure it still opens from wherever the failed-job Inspect affordance ends up
 * living."). The two trigger points ("Inspect Failure" in the export sheet's queue rows, "Inspect"
 * next to a cloud-quota/render-failed app error in the Audio + Runtime drawer) now live in
 * different surfaces, so the `activeInspectorJobId` open-signal that used to be local SystemPanels
 * state is lifted to `StatusOverlays` (the common ancestor of both) and passed in here as props.
 */
export function FailureInspectorModal({
  job,
  quotaError,
  onClose,
  onRetry,
  onResolveQuota,
}: {
  job: ReturnType<typeof useProjectStore.getState>['project']['output']['queue'][number] | null
  quotaError: ReturnType<typeof useProjectStore.getState>['appErrors'][number] | null
  onClose: () => void
  onRetry: (jobId: string) => void
  onResolveQuota: (errorId: string) => void
}) {
  const isOpen = Boolean(job || quotaError)
  const dialogRef = useModalA11y<HTMLElement>(isOpen)

  useEffect(() => {
    if (!isOpen) {
      return
    }

    function handleEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.preventDefault()
        onClose()
      }
    }

    window.addEventListener('keydown', handleEscape)
    return () => window.removeEventListener('keydown', handleEscape)
  }, [isOpen, onClose])

  if (!isOpen) {
    return null
  }

  // Round-3 z-order (item 9): the export sheet + drawers moved up to `--z-overlay` (50), and this
  // inspector opens FROM the sheet's "Inspect Failure" — so it must stack ABOVE it, not under. It's
  // the same overlay tier, sitting topmost: `--z-overlay` + `fixed inset-0` (root stacking context,
  // matching the sheet), and `StatusOverlays` renders this LAST, so at equal z-index CSS source-order
  // paints it over the sheet. Was a verbatim `absolute inset-0 z-40` (fine in round 2 when drawers
  // were `--z-drawer` 10; below the sheet after the round-3 move).
  return (
    <div className="fixed inset-0 z-[var(--z-overlay)] flex justify-center overflow-y-auto bg-black/60 p-4 backdrop-blur-sm">
      <section
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="failure-inspector-title"
        tabIndex={-1}
        className="my-auto h-fit w-full max-w-2xl rounded-[1.75rem] border border-white/10 bg-[#111214] p-5 shadow-[0_30px_120px_rgba(0,0,0,0.55)] outline-none"
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-[11px] uppercase tracking-[0.28em] text-[#7f8691]">
              {job?.errorCategory === 'cloud_quota' || quotaError ? 'Cloud Quota' : 'Render Failure'}
            </p>
            <h3 id="failure-inspector-title" className="mt-2 text-2xl font-semibold text-white">
              {job?.name ?? 'Render issue'} inspector
            </h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close failure inspector"
            className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-white/10 bg-white/5 text-white"
          >
            <X size={16} />
          </button>
        </div>
        {job ? (
          <div className="mt-4 grid gap-3 md:grid-cols-2">
            <InspectorCard label="Status" value={`${job.status} / ${job.errorCategory ?? 'n/a'}`} />
            <InspectorCard label="Frames" value={`${job.currentFrame}/${job.totalFrames}`} />
            <InspectorCard label="Failed Frame" value={job.failedFrame !== null ? String(job.failedFrame) : 'n/a'} />
            <InspectorCard label="Resume From" value={job.resumeFromFrame !== null ? String(job.resumeFromFrame) : 'n/a'} />
          </div>
        ) : null}
        {job?.lastError ? (
          <div className="mt-4 rounded-[1.25rem] border border-amber-300/20 bg-amber-500/10 p-4 text-sm text-amber-50">
            {job.lastError}
          </div>
        ) : null}
        {job?.quotaUsageSummary || quotaError ? (
          <div className="mt-4 rounded-[1.25rem] border border-blue-400/20 bg-blue-500/10 p-4 text-sm text-blue-50">
            <p>{job?.quotaUsageSummary ?? quotaError?.suggestedAction ?? 'Quota summary unavailable.'}</p>
            <p className="mt-2 text-xs opacity-80">
              Reset time:{' '}
              {job?.quotaResetAt
                ? new Date(job.quotaResetAt).toLocaleString()
                : quotaError?.resetAt
                  ? new Date(quotaError.resetAt).toLocaleString()
                  : 'pending'}
            </p>
          </div>
        ) : null}
        <div className="mt-5 flex flex-wrap gap-2">
          {job && job.errorCategory !== 'cloud_quota' ? (
            <button
              type="button"
              onClick={() => onRetry(job.id)}
              className="rounded-full bg-[#e0ff00] px-4 py-2 text-sm font-semibold text-black"
            >
              Retry from failed frame
            </button>
          ) : null}
          {quotaError ? (
            <button
              type="button"
              onClick={() => onResolveQuota(quotaError.id)}
              className="rounded-full bg-[#3b82f6] px-4 py-2 text-sm font-semibold text-white"
            >
              {quotaError.actionLabel ?? 'Resolve quota'}
            </button>
          ) : null}
          <button
            type="button"
            onClick={onClose}
            className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm text-white"
          >
            Close
          </button>
        </div>
      </section>
    </div>
  )
}
