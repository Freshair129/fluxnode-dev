import type { KeyBinding } from '../domain/project/types'
import { formatKeybinding } from '../services/shortcuts/shortcut-config'

export interface KbdProps {
  /** A resolved keybinding (preferred — renders each modifier/key as its own badge), or a
   *  pre-formatted label string (e.g. for the palette's raw verb hints, which have no KeyBinding). */
  binding?: KeyBinding | null
  label?: string
  className?: string
}

/**
 * Spec G primitive: "new: … Kbd …" — inline keyboard-shortcut hint, used by the command palette
 * (spec H "inline Kbd hints") and any registry-driven context menu row (spec H "Context menu:
 * … shortcut shown on every row").
 */
export function Kbd({ binding, label, className = '' }: KbdProps) {
  const text = binding ? formatKeybinding(binding) : label

  if (!text) {
    return null
  }

  const keys = text.split('+')

  return (
    <span className={`inline-flex items-center gap-0.5 ${className}`} aria-hidden="true" title={text}>
      {keys.map((key, index) => (
        <kbd
          key={`${key}-${index}`}
          className="rounded-md border border-white/15 bg-white/5 px-1.5 py-0.5 font-mono text-[10px] uppercase leading-none tracking-wide text-text-secondary"
        >
          {key}
        </kbd>
      ))}
    </span>
  )
}
