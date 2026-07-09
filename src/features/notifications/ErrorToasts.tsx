import { AlertTriangle, X } from 'lucide-react'
import type { ErrorCategory } from '../../domain/project/types'
import { useProjectStore } from '../../store/project-store'

const CATEGORY_LABELS: Record<ErrorCategory, string> = {
  comfy_connection: 'ComfyUI connection',
  comfy_execution: 'ComfyUI execution',
  cloud_network: 'Cloud network',
  cloud_auth: 'Cloud auth',
  cloud_quota: 'Cloud quota',
  asset_missing: 'Asset missing',
  asset_corrupt: 'Asset corrupt',
  render_failed: 'Render failed',
  disk_full: 'Disk full',
  memory_pressure: 'Memory pressure',
  gpu_oom: 'GPU out of memory',
  internal: 'Internal error',
}

const MAX_VISIBLE_TOASTS = 4

// Categories that represent a stopped/blocked or potentially destructive
// state get an assertive, role="alert" announcement. Everything else
// (transient connectivity blips, offline asset states, etc.) is announced
// politely so it doesn't interrupt whatever the screen reader is doing.
const HIGH_SEVERITY_CATEGORIES = new Set<ErrorCategory>([
  'gpu_oom',
  'disk_full',
  'memory_pressure',
  'asset_corrupt',
  'cloud_auth',
  'render_failed',
])

function getToastSeverity(category: ErrorCategory): 'high' | 'normal' {
  return HIGH_SEVERITY_CATEGORIES.has(category) ? 'high' : 'normal'
}

/**
 * Floating, accessible toast stack that surfaces recoverable `appErrors` from the
 * store. Each toast exposes the suggested recovery action (wired to
 * `performAppErrorAction`) and a dismiss control (`dismissAppError`).
 */
export function ErrorToasts() {
  const errors = useProjectStore((state) => state.appErrors)
  const dismissAppError = useProjectStore((state) => state.dismissAppError)
  const performAppErrorAction = useProjectStore((state) => state.performAppErrorAction)

  if (errors.length === 0) {
    return null
  }

  const visible = errors.slice(-MAX_VISIBLE_TOASTS).reverse()
  const hiddenCount = errors.length - visible.length

  return (
    <div
      aria-label="Error notifications"
      className="pointer-events-none fixed bottom-4 right-4 z-50 flex w-[min(24rem,calc(100vw-2rem))] flex-col gap-3"
    >
      {visible.map((error) => {
        const severity = getToastSeverity(error.category)

        return (
        <article
          key={error.id}
          role={severity === 'high' ? 'alert' : 'status'}
          aria-live={severity === 'high' ? 'assertive' : 'polite'}
          className="pointer-events-auto overflow-hidden rounded-2xl border border-red-400/20 bg-[#1c1c1e]/95 p-4 shadow-[0_18px_50px_rgba(0,0,0,0.45)] backdrop-blur-md"
        >
          <div className="flex items-start gap-3">
            <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-red-500/15 text-red-300">
              <AlertTriangle size={16} />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-red-300/80">
                {CATEGORY_LABELS[error.category] ?? error.category}
              </p>
              <p className="mt-1 text-sm font-medium leading-5 text-white">{error.userMessage}</p>
              {error.suggestedAction ? (
                <p className="mt-1 text-xs leading-5 text-[#9ca3af]">{error.suggestedAction}</p>
              ) : null}
              {error.actionLabel && error.actionCommand ? (
                <button
                  type="button"
                  onClick={() => void performAppErrorAction(error.id)}
                  className="mt-3 rounded-full bg-accent px-4 py-1.5 text-xs font-semibold text-black transition hover:brightness-95"
                >
                  {error.actionLabel}
                </button>
              ) : null}
            </div>
            <button
              type="button"
              onClick={() => dismissAppError(error.id)}
              aria-label="Dismiss notification"
              className="-mr-1 -mt-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[#9ca3af] transition hover:bg-white/10 hover:text-white"
            >
              <X size={15} />
            </button>
          </div>
        </article>
        )
      })}
      {hiddenCount > 0 ? (
        <p className="pointer-events-none pr-2 text-right text-[11px] text-[#7f8792]">
          +{hiddenCount} more notification{hiddenCount === 1 ? '' : 's'} in the status panel
        </p>
      ) : null}
    </div>
  )
}
