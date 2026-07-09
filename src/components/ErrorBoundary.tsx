import { Component, type ErrorInfo, type ReactNode } from 'react'
import { AlertOctagon, RefreshCcw } from 'lucide-react'

interface ErrorBoundaryProps {
  children: ReactNode
  /** Short label identifying which panel this boundary wraps, e.g. "Timeline". Shown in the recovery panel and used for scoped resets. */
  label?: string
  /** Optional compact rendering for small embedded surfaces (status bar, etc). */
  compact?: boolean
}

interface ErrorBoundaryState {
  error: Error | null
}

/**
 * Branded crash barrier for a subtree. Deliberately does NOT touch the Zustand
 * store (no reset/rehydrate) — the project state living in memory is exactly
 * what we want to preserve so the user can save/export after reloading.
 * "Reload" reloads the whole window, which is the only safe way to recover a
 * render that has thrown, since React itself can leave the tree in an
 * inconsistent state after an uncaught error.
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error }
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    // eslint-disable-next-line no-console
    console.error(`[ErrorBoundary${this.props.label ? `:${this.props.label}` : ''}]`, error, errorInfo.componentStack)
  }

  private handleRetry = () => {
    this.setState({ error: null })
  }

  private handleReload = () => {
    window.location.reload()
  }

  render() {
    const { error } = this.state

    if (!error) {
      return this.props.children
    }

    const { label, compact = false } = this.props

    return (
      <section
        role="alert"
        aria-label={label ? `${label} crashed` : 'A panel crashed'}
        className={`overflow-hidden rounded-[1.75rem] border border-red-400/25 bg-[#161113]/95 text-white shadow-[0_18px_60px_rgba(0,0,0,0.4)] backdrop-blur-xl ${
          compact ? 'p-4' : 'p-6'
        }`}
      >
        <div className="flex items-start gap-4">
          <span className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-red-400/25 bg-red-500/10 text-red-300">
            <AlertOctagon size={18} aria-hidden="true" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-[11px] uppercase tracking-[0.28em] text-red-300/80">
              {label ? `${label} crashed` : 'Something went wrong'}
            </p>
            <h3 className="mt-2 text-lg font-semibold text-white">
              This panel hit an unexpected error and stopped rendering.
            </h3>
            <p className="mt-2 max-w-xl text-sm leading-6 text-[#c8ccd2]">
              Your project stays open in memory and autosave keeps running elsewhere in the app — reloading is the
              safest way to recover this view.
            </p>
            <pre className="mt-3 max-h-32 overflow-auto rounded-xl border border-white/10 bg-black/30 p-3 text-xs leading-5 text-[#d8b4b4]">
              {error.message}
            </pre>
            <div className="mt-4 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={this.handleReload}
                className="inline-flex items-center gap-2 rounded-full bg-accent px-4 py-2 text-sm font-semibold text-black transition hover:brightness-95"
              >
                <RefreshCcw size={15} aria-hidden="true" />
                Reload FluxNode
              </button>
              <button
                type="button"
                onClick={this.handleRetry}
                className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/5 px-4 py-2 text-sm text-white transition hover:border-white/25"
              >
                Try rendering again
              </button>
            </div>
          </div>
        </div>
      </section>
    )
  }
}
