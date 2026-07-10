import type { ReactNode } from 'react'

export interface ContextMenuProps {
  x: number
  y: number
  label: string
  children: ReactNode
  minWidthClassName?: string
}

/**
 * Canonical right-click context menu shell. Covers what used to be
 * duplicated verbatim in TimelineView and WorkflowView as an inline
 * `<div role="menu">` plus local `ContextAction` / `ContextDivider` helpers.
 */
export function ContextMenu({ x, y, label, children, minWidthClassName = 'min-w-52' }: ContextMenuProps) {
  return (
    <div
      role="menu"
      aria-label={label}
      className={`fixed z-30 ${minWidthClassName} rounded-[1rem] border border-white/10 bg-[#101113]/95 p-2 shadow-[0_20px_60px_rgba(0,0,0,0.45)] backdrop-blur-xl`}
      style={{ left: x, top: y }}
      onClick={(event) => event.stopPropagation()}
    >
      {children}
    </div>
  )
}

export function ContextMenuItem({
  label,
  onClick,
  tone = 'default',
  disabled = false,
}: {
  /** Usually plain text; `services/commands`' `CommandMenuItem` passes a title+`Kbd` fragment instead so every registry-backed row can show its shortcut inline (spec H). */
  label: ReactNode
  onClick: () => void
  tone?: 'default' | 'danger'
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      disabled={disabled}
      className={`block w-full rounded-xl px-3 py-2 text-left text-sm ${
        tone === 'danger' ? 'bg-red-500/10 text-red-100 hover:bg-red-500/15' : 'text-white hover:bg-white/5'
      } ${disabled ? 'cursor-not-allowed opacity-45 hover:bg-transparent' : ''}`}
    >
      {label}
    </button>
  )
}

export function ContextMenuDivider() {
  return <div role="separator" className="my-1 border-t border-white/8" />
}
