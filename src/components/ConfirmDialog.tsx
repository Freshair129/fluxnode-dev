import { useEffect } from 'react'
import { AlertTriangle } from 'lucide-react'
import { useModalA11y } from '../features/settings/useModalA11y'

export interface ConfirmDialogProps {
  open: boolean
  title: string
  description?: string
  confirmLabel?: string
  cancelLabel?: string
  tone?: 'default' | 'danger'
  onConfirm: () => void
  onCancel: () => void
}

/**
 * Branded replacement for `window.confirm()`. Renders nothing when closed so
 * callers can mount it unconditionally and flip `open`.
 */
export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  tone = 'default',
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const dialogRef = useModalA11y<HTMLElement>(open)

  useEffect(() => {
    if (!open) {
      return
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.preventDefault()
        onCancel()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [open, onCancel])

  if (!open) {
    return null
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
      <section
        ref={dialogRef}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-dialog-title"
        aria-describedby={description ? 'confirm-dialog-description' : undefined}
        tabIndex={-1}
        className="w-full max-w-md rounded-[1.5rem] border border-white/10 bg-[#141416] p-6 shadow-[0_30px_120px_rgba(0,0,0,0.55)] outline-none"
      >
        <div className="flex items-start gap-3">
          {tone === 'danger' ? (
            <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-red-400/25 bg-red-500/10 text-red-300">
              <AlertTriangle size={16} aria-hidden="true" />
            </span>
          ) : null}
          <div className="min-w-0 flex-1">
            <h2 id="confirm-dialog-title" className="text-lg font-semibold text-white">
              {title}
            </h2>
            {description ? (
              <p id="confirm-dialog-description" className="mt-2 text-sm leading-6 text-[#9ca3af]">
                {description}
              </p>
            ) : null}
          </div>
        </div>
        <div className="mt-6 flex flex-wrap justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm text-white transition hover:border-white/25"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className={`rounded-full px-4 py-2 text-sm font-semibold transition ${
              tone === 'danger'
                ? 'bg-red-500 text-white hover:brightness-95'
                : 'bg-accent text-black hover:brightness-95'
            }`}
          >
            {confirmLabel}
          </button>
        </div>
      </section>
    </div>
  )
}
