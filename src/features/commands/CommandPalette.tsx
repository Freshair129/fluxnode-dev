import { useEffect, useMemo, useRef, useState } from 'react'
import type { ShortcutCommand } from '../../services/shortcuts/shortcut-config'
import { useModalA11y } from '../settings/useModalA11y'
import { useProjectStore } from '../../store/project-store'
import {
  buildCommandContext,
  COMMAND_REGISTRY,
  getRecentCommandIds,
  isCommandEnabled,
  resolveLiveShortcut,
  runCommand,
} from '../../services/commands/command-registry'
import { bestFuzzyScore, fuzzyScore } from '../../services/commands/fuzzy'
import { indexClipAddresses, indexNodeAddresses, resolveAddressedObjects } from '../../services/commands/objectAddress'
import { mergePaletteResults, type PaletteResult } from '../../services/commands/paletteResults'
import { isExactVerb, matchKnownVerbs, parseVerbInput } from '../../services/commands/verbs'
import { VERB_COMMANDS } from '../../services/commands/verbCommands'
import { revealLineageEndpoint } from '../workspace/followLineageThread'
import { PaletteEmptyState } from './PaletteEmptyState'
import { PaletteResultRow } from './PaletteResultRow'

export interface CommandPaletteProps {
  onClose: () => void
  onOpenShortcutsHelp: () => void
  onOpenExportSheet: () => void
  onOpenStatusDrawer: (drawer: 'connectivity' | 'appUpdates' | 'workspace' | 'audio') => void
}

/** Cheap, hand-written reasons for the small set of commands with an `enabled()` gate — spec H: "disabled ones may show, greyed, with the reason if cheap." */
const DISABLED_REASONS: Partial<Record<ShortcutCommand, string>> = {
  'selection.delete': 'Nothing selected',
  'selection.duplicate': 'Nothing selected',
  'timeline.copy': 'No clip selected',
  'timeline.paste': 'Timeline clipboard is empty',
  'workflow.copy': 'No node selected',
  'workflow.paste': 'Workflow clipboard is empty',
  'global.undo': 'Nothing to undo',
  'global.redo': 'Nothing to redo',
  'global.redoAlt': 'Nothing to redo',
  'lineage.followThread': 'Nothing selected',
}

interface ResultEntry {
  result: PaletteResult
  execute: () => void
}

/**
 * MERIDIAN item 6 command palette (spec H, `Ctrl+K`). Rendered via a native `<dialog>` (spec
 * L.6 — avoids the stacking-context clipping a manually-`position:fixed` overlay can hit), with
 * `aria-modal="true"` set explicitly so `features/shortcuts/guardTargets.ts`'s `isOverlayOpen()`
 * sees it (that guard already gates Tab-flip/peek/`F`/etc. — see this component's usage of that
 * fact in its own doc comment in `useKeyboardShortcuts.ts`).
 *
 * Only mounted while open (see `App.tsx`) — mirrors `ShortcutsCheatSheet`'s conditional-mount
 * pattern rather than `ConfirmDialog`'s always-mounted/`open`-prop pattern, since a native
 * `<dialog>`'s imperative `showModal()`/`close()` lifecycle maps naturally onto mount/unmount.
 *
 * All ranking/matching logic (fuzzy scoring, address resolution, verb parsing, result merging)
 * lives in the dependency-free `services/commands/*` modules and is unit tested there; this
 * component is the thin, store-wired glue that feeds those modules live data and wires their
 * output to `runCommand`/`revealLineageEndpoint`. Not itself unit tested (no test file exists in
 * this repo for ANY store-wired feature component — Header, TimelineView, WorkflowView,
 * StrataShell are all in the same boat), but `PaletteResultRow`/`PaletteEmptyState` — the
 * presentational pieces this component composes — are, via `renderToStaticMarkup`.
 */
export function CommandPalette({ onClose, onOpenShortcutsHelp, onOpenExportSheet, onOpenStatusDrawer }: CommandPaletteProps) {
  const dialogRef = useModalA11y<HTMLDialogElement>(true)
  const inputRef = useRef<HTMLInputElement | null>(null)

  const [query, setQuery] = useState('')
  const [selectedIndex, setSelectedIndex] = useState(0)

  const tracks = useProjectStore((state) => state.project.timeline.tracks)
  const assets = useProjectStore((state) => state.project.assets.assets)
  const workflowNodes = useProjectStore((state) => state.project.workflow.nodes)
  const keybindings = useProjectStore((state) => state.preferences.keybindings)

  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) {
      return
    }

    dialog.showModal()
    inputRef.current?.focus()

    function handleClose() {
      onClose()
    }

    dialog.addEventListener('close', handleClose)
    return () => {
      dialog.removeEventListener('close', handleClose)
      if (dialog.open) {
        dialog.close()
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const trimmedQuery = query.trim()

  const clipObjects = useMemo(() => {
    const clips = tracks.flatMap((track) => track.clips)
    return indexClipAddresses(clips.map((clip) => ({ id: clip.id, name: assets[clip.assetId]?.name ?? null })))
  }, [tracks, assets])

  const nodeObjects = useMemo(
    () => indexNodeAddresses(workflowNodes.map((node) => ({ id: node.id, name: node.label }))),
    [workflowNodes],
  )

  // Fresh per render (cheap: a plain object of already-created references, not a deep clone) so
  // `enabled()` predicates and executed commands always see current selection/clipboard/history.
  const ctx = buildCommandContext({
    showShortcutsHelp: onOpenShortcutsHelp,
    openCommandPalette: () => {},
    openExportSheet: onOpenExportSheet,
    openStatusDrawer: onOpenStatusDrawer,
  })

  const commandEntries: ResultEntry[] = useMemo(() => {
    const entries: ResultEntry[] = []

    for (const command of COMMAND_REGISTRY) {
      const score = bestFuzzyScore(trimmedQuery, [command.title, command.id])
      if (score === null) {
        continue
      }

      const enabled = isCommandEnabled(command, ctx)
      const liveShortcut = resolveLiveShortcut(command.id, keybindings)

      entries.push({
        result: {
          key: `command:${command.id}`,
          kind: 'command',
          title: command.title,
          subtitle: command.scope !== 'global' ? capitalize(command.scope) : undefined,
          score,
          shortcut: liveShortcut ? formatShortcut(liveShortcut) : undefined,
          disabled: !enabled,
          disabledReason: enabled ? undefined : DISABLED_REASONS[command.id] ?? 'Not available right now',
        },
        // Palette rows already gate activation on `disabled` (see `executeAt`) before this ever
        // runs, so the enabled() re-check here would only matter if the store changed between
        // this render and the click/Enter — harmless either way, but skip it for consistency
        // with the disabled styling actually shown.
        execute: () => runCommand(command.id, ctx, { skipEnabledCheck: true }),
      })
    }

    return entries
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trimmedQuery, keybindings, tracks, assets, workflowNodes])

  const objectEntries: ResultEntry[] = useMemo(() => {
    if (trimmedQuery.length === 0) {
      return []
    }

    const matches = [...resolveAddressedObjects(trimmedQuery, clipObjects), ...resolveAddressedObjects(trimmedQuery, nodeObjects)]

    return matches.map(({ object, score }) => ({
      result: {
        key: `object:${object.kind}:${object.id}`,
        kind: 'object' as const,
        title: object.address,
        subtitle: object.name,
        score,
      },
      execute: () => revealLineageEndpoint(object.kind, object.id),
    }))
  }, [trimmedQuery, clipObjects, nodeObjects])

  const verbEntries: ResultEntry[] = useMemo(() => {
    const parsed = parseVerbInput(query)
    if (!parsed) {
      return []
    }

    return matchKnownVerbs(parsed.verb, VERB_COMMANDS).map((spec) => {
      const description = spec.describe(ctx, parsed.argsText)
      const score = isExactVerb(parsed.verb, spec) ? 500 : (fuzzyScore(parsed.verb, spec.verb) ?? 0)

      return {
        result: {
          key: `verb:${spec.verb}`,
          kind: 'verb' as const,
          title: description.title,
          subtitle: description.subtitle ?? spec.argsHint,
          score,
          disabled: description.disabled,
          disabledReason: description.disabledReason,
        },
        execute: () => spec.run(ctx, parsed.argsText),
      }
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, ctx])

  // Cheap (a few dozen entries at most) — not worth memoizing against an inline-built dependency
  // array, which would just recompute every render anyway.
  const allEntries = [...commandEntries, ...objectEntries, ...verbEntries]
  const entriesByKey = new Map(allEntries.map((entry) => [entry.result.key, entry]))
  const recencyOrder = getRecentCommandIds().map((id) => `command:${id}`)

  const rankedResults = mergePaletteResults(
    commandEntries.map((entry) => entry.result),
    objectEntries.map((entry) => entry.result),
    verbEntries.map((entry) => entry.result),
    recencyOrder,
  )

  const clampedIndex = rankedResults.length === 0 ? 0 : Math.min(selectedIndex, rankedResults.length - 1)

  function executeAt(index: number) {
    const target = rankedResults[index]
    if (!target || target.disabled) {
      return
    }
    entriesByKey.get(target.key)?.execute()
    dialogRef.current?.close()
  }

  function handleInputKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setSelectedIndex((current) => (rankedResults.length === 0 ? 0 : (current + 1) % rankedResults.length))
      return
    }

    if (event.key === 'ArrowUp') {
      event.preventDefault()
      setSelectedIndex((current) => (rankedResults.length === 0 ? 0 : (current - 1 + rankedResults.length) % rankedResults.length))
      return
    }

    if (event.key === 'Enter') {
      event.preventDefault()
      executeAt(clampedIndex)
    }

    // Escape is intentionally NOT handled here: it bubbles to the native <dialog>, which
    // already closes itself (and only itself — "Escape closes topmost overlay only", spec H) as
    // the browser's built-in behavior for a dialog shown via showModal().
  }

  const activeOptionId = rankedResults[clampedIndex] ? `meridian-palette-option-${clampedIndex}` : undefined

  return (
    <dialog
      ref={dialogRef}
      aria-modal="true"
      aria-label="Command palette"
      data-meridian-palette
      className="m-auto w-full max-w-xl rounded-[1.5rem] border border-white/10 bg-[#141416] p-0 text-white shadow-[0_30px_120px_rgba(0,0,0,0.55)] outline-none backdrop:bg-black/60"
      onClick={(event) => {
        if (event.target === dialogRef.current) {
          dialogRef.current?.close()
        }
      }}
    >
      <div className="p-4">
        <input
          ref={inputRef}
          role="combobox"
          aria-expanded={rankedResults.length > 0}
          aria-controls="meridian-palette-listbox"
          aria-activedescendant={activeOptionId}
          aria-autocomplete="list"
          aria-label="Search commands, addresses, or verbs"
          data-meridian-palette-input
          value={query}
          onChange={(event) => {
            setQuery(event.target.value)
            setSelectedIndex(0)
          }}
          onKeyDown={handleInputKeyDown}
          placeholder="Type a command, c1, n1, zoom 150…"
          className="w-full rounded-xl border border-white/10 bg-black/30 px-4 py-3 text-base text-white outline-none placeholder:text-text-secondary"
        />
      </div>
      {rankedResults.length === 0 ? (
        <PaletteEmptyState query={query} />
      ) : (
        <ul
          role="listbox"
          id="meridian-palette-listbox"
          aria-label="Command palette results"
          data-meridian-palette-list
          className="max-h-96 space-y-0.5 overflow-y-auto px-2 pb-3"
        >
          {rankedResults.map((result, index) => (
            <PaletteResultRow
              key={result.key}
              id={`meridian-palette-option-${index}`}
              result={result}
              active={index === clampedIndex}
              onSelect={() => executeAt(index)}
              onPointerMove={() => setSelectedIndex(index)}
            />
          ))}
        </ul>
      )}
    </dialog>
  )
}

function capitalize(value: string): string {
  return value.length === 0 ? value : value[0].toUpperCase() + value.slice(1)
}

function formatShortcut(binding: { key: string; modifiers: string[] }): string {
  return [...binding.modifiers, binding.key].join('+')
}
