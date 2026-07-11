import { useEffect, useState } from 'react'
import { useModalA11y } from '../features/settings/useModalA11y'

export interface PromptDialogProps {
  open: boolean
  title: string
  description?: string
  label: string
  defaultValue?: string
  placeholder?: string
  confirmLabel?: string
  cancelLabel?: string
  /** Return an error message to block submission, or null when the value is valid. */
  validate?: (value: string) => string | null
  onConfirm: (value: string) => void
  onCancel: () => void
}

/**
 * Branded replacement for `window.prompt()`. Renders nothing when closed;
 * resets its internal draft value each time it re-opens.
 */
export function PromptDialog({
  open,
  title,
  description,
  label,
  defaultValue = '',
  placeholder,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  validate,
  onConfirm,
  onCancel,
}: PromptDialogProps) {
  const dialogRef = useModalA11y<HTMLElement>(open)
  const [value, setValue] = useState(defaultValue)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (open) {
      setValue(defaultValue)
      setError(null)
    }
    // Only reseed the draft when the dialog transitions open; edits while open
    // should not be clobbered by an unrelated defaultValue re-render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

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

  function submit() {
    const problem = validate?.(value) ?? null

    if (problem) {
      setError(problem)
      return
    }

    onConfirm(value)
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-center overflow-y-auto bg-black/60 p-4 backdrop-blur-sm">
      <section
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="prompt-dialog-title"
        tabIndex={-1}
        className="my-auto h-fit w-full max-w-md rounded-[1.5rem] border border-white/10 bg-[#141416] p-6 shadow-[0_30px_120px_rgba(0,0,0,0.55)] outline-none"
      >
        <h2 id="prompt-dialog-title" className="text-lg font-semibold text-white">
          {title}
        </h2>
        {description ? <p className="mt-2 text-sm leading-6 text-[#9ca3af]">{description}</p> : null}
        <form
          className="mt-4"
          onSubmit={(event) => {
            event.preventDefault()
            submit()
          }}
        >
          <label className="block text-[11px] uppercase tracking-[0.22em] text-text-secondary">{label}</label>
          <input
            autoFocus
            value={value}
            placeholder={placeholder}
            onChange={(event) => {
              setValue(event.target.value)
              if (error) {
                setError(null)
              }
            }}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? 'prompt-dialog-error' : undefined}
            className="mt-2 w-full rounded-xl border border-white/10 bg-black/25 px-3 py-2 text-sm text-white outline-none focus:border-accent/50"
          />
          {error ? (
            <p id="prompt-dialog-error" role="alert" className="mt-2 text-xs text-red-300">
              {error}
            </p>
          ) : null}
          <div className="mt-6 flex flex-wrap justify-end gap-2">
            <button
              type="button"
              onClick={onCancel}
              className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm text-white transition hover:border-white/25"
            >
              {cancelLabel}
            </button>
            <button
              type="submit"
              className="rounded-full bg-accent px-4 py-2 text-sm font-semibold text-black transition hover:brightness-95"
            >
              {confirmLabel}
            </button>
          </div>
        </form>
      </section>
    </div>
  )
}
