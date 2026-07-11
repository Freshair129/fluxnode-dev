import { ContextMenuItem } from '../../components/ContextMenu'
import { Kbd } from '../../components/Kbd'
import { useProjectStore } from '../../store/project-store'
import {
  buildCommandContext,
  getCommand,
  isCommandEnabled,
  resolveLiveShortcut,
  runCommand,
} from '../../services/commands/command-registry'
import type { ShortcutCommand } from '../../services/shortcuts/shortcut-config'

export interface CommandMenuItemProps {
  commandId: ShortcutCommand
  tone?: 'default' | 'danger'
  /** Called after a successful activation — callers use this to close the menu, mirroring the existing `runContextAction` helper's `setContextMenu(null)`. */
  onActivated?: () => void
}

/**
 * MERIDIAN item 6 (spec H "Context menu … generated from the command registry, shortcut shown
 * on every row" + L.4 "menu/palette/shortcut parity is automatic"). A context-menu row backed
 * directly by a `COMMAND_REGISTRY` entry: title, disabled state, and the inline shortcut hint
 * all come from the ONE registry instead of being hand-typed at each call site, so they can't
 * drift out of sync with the palette or the keyboard binding.
 *
 * Deliberately respects `enabled()` (unlike `useKeyboardShortcuts`, which bypasses it — see
 * `runCommand`'s `RunCommandOptions` doc comment): a menu row greyed out with its reason is
 * exactly spec H's "disabled ones may show, greyed, with the reason if cheap" behavior, and a
 * right-click menu (unlike a raw keystroke) has no existing "already handles its own no-op"
 * expectation to preserve.
 */
export function CommandMenuItem({ commandId, tone = 'default', onActivated }: CommandMenuItemProps) {
  const keybindings = useProjectStore((state) => state.preferences.keybindings)
  const command = getCommand(commandId)

  if (!command) {
    return null
  }

  const ctx = buildCommandContext()
  const enabled = isCommandEnabled(command, ctx)
  const liveShortcut = resolveLiveShortcut(commandId, keybindings)

  return (
    <ContextMenuItem
      label={
        <span className="flex w-full items-center justify-between gap-3">
          <span>{command.title}</span>
          {liveShortcut ? <Kbd binding={liveShortcut} /> : null}
        </span>
      }
      tone={tone}
      disabled={!enabled}
      onClick={() => {
        runCommand(commandId, ctx)
        onActivated?.()
      }}
    />
  )
}
