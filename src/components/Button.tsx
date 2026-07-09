import type { ButtonHTMLAttributes, ReactNode } from 'react'

export type ButtonTone = 'default' | 'accent' | 'danger'
export type ButtonSize = 'sm' | 'md'

export interface ButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'className'> {
  tone?: ButtonTone
  size?: ButtonSize
  children: ReactNode
}

const TONE_CLASSES: Record<ButtonTone, string> = {
  default: 'border border-white/10 bg-white/5 font-medium text-white transition hover:border-white/20',
  accent: 'bg-accent font-semibold text-black transition hover:brightness-95',
  danger: 'border border-red-400/20 bg-red-500/10 font-medium text-red-100 transition hover:bg-red-500/15',
}

const SIZE_CLASSES: Record<ButtonSize, string> = {
  sm: 'gap-1 rounded-full px-3 py-2 text-xs',
  md: 'gap-2 rounded-full px-4 py-2 text-sm',
}

/**
 * Canonical pill button. Covers what used to be duplicated per-feature as
 * `ToolbarButton` / `MiniButton` (TimelineView) and `ActionPill` (WorkflowView).
 */
export function Button({ tone = 'default', size = 'md', disabled, children, ...rest }: ButtonProps) {
  return (
    <button
      type="button"
      disabled={disabled}
      className={`inline-flex items-center justify-center disabled:cursor-not-allowed disabled:opacity-45 ${TONE_CLASSES[tone]} ${SIZE_CLASSES[size]}`}
      {...rest}
    >
      {children}
    </button>
  )
}
