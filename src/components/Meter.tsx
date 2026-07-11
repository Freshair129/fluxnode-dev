export type MeterTone = 'accent' | 'danger' | 'neutral' | 'success'

const TRACK_CLASS = 'h-1.5 w-full overflow-hidden rounded-full bg-white/8'

const FILL_TONE_CLASSES: Record<MeterTone, string> = {
  accent: 'bg-accent',
  danger: 'bg-danger',
  neutral: 'bg-white/35',
  success: 'bg-success',
}

export interface MeterProps {
  /** Progress fraction, 0-1. Values outside the range are clamped. */
  value: number
  /** Accessible label for the progressbar (e.g. "Render progress"). */
  label?: string
  tone?: MeterTone
  /**
   * Subtle "alive" cue for a determinate meter that's actively advancing (spec H Job ledger
   * "Active" row: "chip pulse 1/s"). Purely visual — the meter is always determinate (M.5); this
   * never substitutes for the `value` fill. Global `prefers-reduced-motion` CSS
   * (src/styles/index.css) collapses the animation to static automatically.
   */
  pulse?: boolean
  className?: string
}

/**
 * Determinate progress bar primitive (spec G primitives list). Generic on purpose — JobChip is
 * its first consumer, but nothing here is job-specific. Never renders an indeterminate/bare
 * spinner state (spec M.5): callers without a real fraction should show queue position/elapsed
 * text instead of mounting this at all.
 */
export function Meter({ value, label, tone = 'accent', pulse = false, className }: MeterProps) {
  const clamped = Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0))
  const percent = Math.round(clamped * 100)

  return (
    <div
      className={`${TRACK_CLASS} ${className ?? ''}`}
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={percent}
      aria-label={label}
    >
      <div
        className={`h-full rounded-full transition-[width] duration-[var(--dur-base)] ease-[var(--ease-out-quart)] ${FILL_TONE_CLASSES[tone]} ${pulse ? 'animate-pulse' : ''}`}
        style={{ width: `${percent}%` }}
      />
    </div>
  )
}
