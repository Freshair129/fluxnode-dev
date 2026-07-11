import { useEffect, useRef, useState, type ReactNode } from 'react'
import { MoreHorizontal } from 'lucide-react'

export interface MenuProps {
  label: string
  icon?: ReactNode
  children: ReactNode
  align?: 'left' | 'right'
}

/**
 * Click-to-toggle dropdown menu anchored under its trigger button (as
 * opposed to `ContextMenu`, which is positioned at a right-click point).
 * Closes on outside click or Escape.
 */
export function Menu({ label, icon, children, align = 'right' }: MenuProps) {
  const [open, setOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!open) {
      return
    }

    function handlePointerDown(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false)
      }
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setOpen(false)
      }
    }

    window.addEventListener('mousedown', handlePointerDown)
    window.addEventListener('keydown', handleKeyDown)

    return () => {
      window.removeEventListener('mousedown', handlePointerDown)
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [open])

  return (
    <div ref={containerRef} className="relative inline-block">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={label}
        onClick={() => setOpen((current) => !current)}
        className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-white/10 bg-white/5 text-white transition hover:border-white/20"
      >
        {icon ?? <MoreHorizontal size={16} aria-hidden="true" />}
      </button>
      {open ? (
        <div
          role="menu"
          aria-label={label}
          className={`absolute z-40 mt-2 min-w-64 rounded-[1rem] border border-white/10 bg-[#101113]/95 p-2 shadow-[0_20px_60px_rgba(0,0,0,0.45)] backdrop-blur-xl ${
            align === 'right' ? 'right-0' : 'left-0'
          }`}
          onClick={() => setOpen(false)}
        >
          {children}
        </div>
      ) : null}
    </div>
  )
}

export function MenuItem({
  label,
  onClick,
  pressed,
}: {
  label: string
  onClick: () => void
  pressed?: boolean
}) {
  return (
    <button
      type="button"
      role="menuitemcheckbox"
      aria-checked={pressed}
      onClick={onClick}
      // Item 7 (density modes): row vertical padding follows --meridian-gutter (spec G 8px/6px),
      // same treatment as ContextMenuItem/PaletteResultRow.
      className={`flex w-full items-center justify-between rounded-xl px-3 py-[var(--meridian-gutter)] text-left text-sm transition ${
        pressed ? 'bg-accent/10 text-accent-soft' : 'text-white hover:bg-white/5'
      }`}
    >
      {label}
      {pressed !== undefined ? (
        <span className="text-[10px] uppercase tracking-[0.18em] text-text-secondary">
          {pressed ? 'On' : 'Off'}
        </span>
      ) : null}
    </button>
  )
}
