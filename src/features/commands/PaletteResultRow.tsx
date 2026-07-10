import { Kbd } from '../../components/Kbd'
import type { PaletteResult } from '../../services/commands/paletteResults'

const KIND_LABEL: Record<PaletteResult['kind'], string> = {
  command: 'Command',
  object: 'Object',
  verb: 'Verb',
}

export interface PaletteResultRowProps {
  id: string
  result: PaletteResult
  active: boolean
  onSelect: () => void
  onPointerMove: () => void
}

/**
 * One row of the command palette's result list (spec H: one ranked list mixing commands,
 * addressed objects, and verbs). Purely props-driven — no store access, no effects — so it's
 * unit-testable via `renderToStaticMarkup` the same way `JobChip` is (see
 * `PaletteResultRow.test.tsx`), independent of the store-wired `CommandPalette` container.
 * `result.shortcut` is already a formatted string (e.g. "Ctrl+K") — the container resolves it
 * against the user's LIVE keybindings before building the result, so this component never needs
 * a `KeyBinding` object or the store.
 */
export function PaletteResultRow({ id, result, active, onSelect, onPointerMove }: PaletteResultRowProps) {
  return (
    <li
      id={id}
      role="option"
      aria-selected={active}
      aria-disabled={result.disabled ? true : undefined}
      data-meridian-palette-item
      data-meridian-palette-item-kind={result.kind}
      onPointerMove={onPointerMove}
      onClick={() => {
        if (!result.disabled) {
          onSelect()
        }
      }}
      className={`flex cursor-pointer items-center justify-between gap-3 rounded-xl px-3 py-2 text-sm transition ${
        result.disabled ? 'cursor-not-allowed opacity-45' : ''
      } ${active && !result.disabled ? 'bg-accent/10 text-accent-soft' : 'text-white'}`}
    >
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="shrink-0 rounded-full border border-white/10 px-1.5 py-0.5 text-[9px] uppercase tracking-[0.18em] text-text-secondary">
            {KIND_LABEL[result.kind]}
          </span>
          <span className="truncate">{result.title}</span>
        </div>
        {result.subtitle ? <p className="mt-0.5 truncate text-xs text-text-secondary">{result.subtitle}</p> : null}
        {result.disabled && result.disabledReason ? (
          <p className="mt-0.5 truncate text-xs text-danger">{result.disabledReason}</p>
        ) : null}
      </div>
      {result.shortcut ? <Kbd label={result.shortcut} /> : null}
    </li>
  )
}
