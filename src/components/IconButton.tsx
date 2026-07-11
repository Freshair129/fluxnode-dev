import type { ReactNode } from 'react'

export interface IconButtonProps {
  children: ReactNode
  label: string
  onClick: () => void
  disabled?: boolean
  pressed?: boolean
  size?: 'sm' | 'md'
  /** Native tooltip text (spec G: "every icon button has a tooltip carrying its shortcut"). Falls back to `label`. */
  title?: string
  /** For buttons that toggle a collapsible region (spec F.3 rails) rather than a pressed state. */
  ariaExpanded?: boolean
}

/** Canonical circular icon-only button (previously duplicated as Header's local `IconButton`). */
export function IconButton({
  children,
  label,
  onClick,
  disabled = false,
  pressed,
  size = 'md',
  title,
  ariaExpanded,
}: IconButtonProps) {
  const sizeClass = size === 'sm' ? 'h-9 w-9' : 'h-10 w-10'

  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={pressed}
      aria-expanded={ariaExpanded}
      title={title ?? label}
      disabled={disabled}
      onClick={onClick}
      className={`inline-flex ${sizeClass} items-center justify-center rounded-full border border-white/10 bg-white/5 text-white transition hover:border-white/20 disabled:cursor-not-allowed disabled:opacity-40`}
    >
      {children}
    </button>
  )
}
