import { useEffect, useMemo } from 'react'
import { Keyboard, X } from 'lucide-react'
import { useProjectStore } from '../../store/project-store'
import { useModalA11y } from '../settings/useModalA11y'
import {
  DEFAULT_KEYBINDINGS,
  SHORTCUT_DEFINITIONS,
  formatKeybinding,
  getCommandBinding,
} from '../../services/shortcuts/shortcut-config'
import type { ShortcutScope } from '../../domain/project/types'

const SCOPE_ORDER: ShortcutScope[] = ['global', 'timeline', 'workflow']
const SCOPE_LABELS: Record<ShortcutScope, string> = {
  global: 'Global',
  timeline: 'Timeline',
  workflow: 'Workflow',
}

export interface ShortcutsCheatSheetProps {
  open: boolean
  onClose: () => void
}

/**
 * `?` / F1 discoverability overlay for the 50+ keybindings that otherwise
 * only surface buried in Settings. Read-only — use Settings to rebind.
 */
export function ShortcutsCheatSheet({ open, onClose }: ShortcutsCheatSheetProps) {
  const keybindings = useProjectStore((state) => state.preferences.keybindings)
  const dialogRef = useModalA11y<HTMLElement>(open)

  useEffect(() => {
    if (!open) {
      return
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.preventDefault()
        onClose()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [open, onClose])

  const groupedByScope = useMemo(() => {
    const bindings = keybindings.length > 0 ? keybindings : DEFAULT_KEYBINDINGS

    return SCOPE_ORDER.map((scope) => ({
      scope,
      entries: SHORTCUT_DEFINITIONS.filter((definition) => definition.when === scope).map((definition) => ({
        definition,
        binding: getCommandBinding(bindings, definition.command),
      })),
    })).filter((group) => group.entries.length > 0)
  }, [keybindings])

  if (!open) {
    return null
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
      <section
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="shortcuts-cheat-sheet-title"
        tabIndex={-1}
        className="flex max-h-[85vh] w-full max-w-3xl flex-col overflow-hidden rounded-[1.75rem] border border-white/10 bg-[#111214] shadow-[0_30px_120px_rgba(0,0,0,0.55)] outline-none"
      >
        <div className="flex items-start justify-between gap-4 border-b border-white/8 p-5">
          <div className="flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-full border border-accent/25 bg-accent/10 text-accent">
              <Keyboard size={18} aria-hidden="true" />
            </span>
            <div>
              <p className="text-[11px] uppercase tracking-[0.28em] text-text-secondary">Keyboard Shortcuts</p>
              <h2 id="shortcuts-cheat-sheet-title" className="mt-1 text-xl font-semibold text-white">
                Everything bound in FluxNode
              </h2>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close shortcuts overlay"
            className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-white/10 bg-white/5 text-white transition hover:border-white/25"
          >
            <X size={16} />
          </button>
        </div>
        <div className="grid gap-5 overflow-y-auto p-5 md:grid-cols-3">
          {groupedByScope.map((group) => (
            <div key={group.scope}>
              <p className="text-[11px] uppercase tracking-[0.25em] text-accent">{SCOPE_LABELS[group.scope]}</p>
              <ul className="mt-3 space-y-2">
                {group.entries.map(({ definition, binding }) => (
                  <li
                    key={definition.command}
                    className="flex items-center justify-between gap-3 rounded-xl border border-white/8 bg-black/20 px-3 py-2"
                  >
                    <span className="text-sm text-white">{definition.label}</span>
                    <kbd className="whitespace-nowrap rounded-md border border-white/15 bg-white/5 px-2 py-1 font-mono text-[11px] uppercase tracking-wide text-text-secondary">
                      {binding ? formatKeybinding(binding) : 'Unbound'}
                    </kbd>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <div className="border-t border-white/8 p-4 text-center text-xs text-text-secondary">
          Press <kbd className="rounded border border-white/15 px-1.5 py-0.5 font-mono">Esc</kbd> to close · rebind
          shortcuts from Settings
        </div>
      </section>
    </div>
  )
}
