import { describe, expect, it } from 'vitest'
import { DEFAULT_KEYBINDINGS, SHORTCUT_DEFINITIONS, type ShortcutCommand } from '../shortcuts/shortcut-config'
import {
  COMMAND_REGISTRY,
  type CommandContext,
  getCommand,
  getRecentCommandIds,
  resolveLiveShortcut,
  runCommand,
} from './command-registry'

describe('COMMAND_REGISTRY: shape and coverage', () => {
  it('has exactly one entry per ShortcutCommand id, extending (not forking) SHORTCUT_DEFINITIONS', () => {
    expect(COMMAND_REGISTRY).toHaveLength(SHORTCUT_DEFINITIONS.length)
    expect(new Set(COMMAND_REGISTRY.map((command) => command.id)).size).toBe(COMMAND_REGISTRY.length)
    expect(COMMAND_REGISTRY.map((command) => command.id).sort()).toEqual(
      SHORTCUT_DEFINITIONS.map((definition) => definition.command).sort(),
    )
  })

  it('every entry carries a title, scope, reach, non-empty reachNote, and a run function', () => {
    for (const command of COMMAND_REGISTRY) {
      expect(command.title.length).toBeGreaterThan(0)
      expect(['global', 'timeline', 'workflow']).toContain(command.scope)
      expect(['direct', 'menu', 'accelerator']).toContain(command.reach)
      expect(command.reachNote.length).toBeGreaterThan(0)
      expect(typeof command.run).toBe('function')
    }
  })

  it('bakes each entry\'s default shortcut from DEFAULT_KEYBINDINGS (null when there is none, e.g. global.toggleView)', () => {
    const split = getCommand('timeline.split')
    expect(split?.shortcut).toMatchObject({ key: 'c', modifiers: [] })

    const toggleView = getCommand('global.toggleView')
    expect(toggleView?.shortcut).toBeNull()
  })

  it('M.9 reach classification totals (locks the item-6 report\'s numbers against silent drift)', () => {
    const counts = COMMAND_REGISTRY.reduce(
      (acc, command) => {
        acc[command.reach] += 1
        return acc
      },
      { direct: 0, menu: 0, accelerator: 0 },
    )

    expect(counts).toEqual({ direct: 39, menu: 9, accelerator: 10 })
    expect(counts.direct + counts.menu + counts.accelerator).toBe(COMMAND_REGISTRY.length)
  })

  it('every workflow.quickAdd* command is classified menu (reachable from the canvas "Add …" context menu rows)', () => {
    const quickAddIds = SHORTCUT_DEFINITIONS.map((definition) => definition.command).filter((id) =>
      id.startsWith('workflow.quickAdd'),
    )
    expect(quickAddIds.length).toBeGreaterThan(0)
    for (const id of quickAddIds) {
      expect(getCommand(id)?.reach).toBe('menu')
    }
  })
})

describe('resolveLiveShortcut', () => {
  it('reflects a live (remapped) keybinding, not just the shipped default', () => {
    const remapped = [
      ...DEFAULT_KEYBINDINGS.filter((binding) => binding.command !== 'timeline.split'),
      { command: 'timeline.split' as ShortcutCommand, key: 'x', modifiers: ['Alt'], when: 'timeline' as const },
    ]

    expect(resolveLiveShortcut('timeline.split', remapped)).toMatchObject({ key: 'x', modifiers: ['Alt'] })
    // The registry's own baked `shortcut` field is unaffected by the remap array passed here.
    expect(getCommand('timeline.split')?.shortcut).toMatchObject({ key: 'c', modifiers: [] })
  })

  it('returns null for a command with no binding in the given array', () => {
    expect(resolveLiveShortcut('global.toggleView', DEFAULT_KEYBINDINGS)).toBeNull()
  })
})

describe('runCommand', () => {
  function fakeContext(storeOverrides: Record<string, unknown>): CommandContext {
    return {
      store: storeOverrides as unknown as CommandContext['store'],
      showShortcutsHelp: () => {},
      openCommandPalette: () => {},
    }
  }

  it('calls the matching command\'s run() with the given context', () => {
    let called: unknown = null
    const deleteSelected = () => {
      called = 'deleted'
    }
    const ctx = fakeContext({
      deleteSelected,
      ui: { selectedClipIds: ['c1'], selectedNodeIds: [], selectedClipId: 'c1', selectedNodeId: null },
    })

    runCommand('selection.delete', ctx)

    expect(called).toBe('deleted')
  })

  it('does not run a disabled command (enabled() returning false short-circuits run())', () => {
    let called = false
    const ctx = fakeContext({
      deleteSelected: () => {
        called = true
      },
      ui: { selectedClipIds: [], selectedNodeIds: [], selectedClipId: null, selectedNodeId: null },
    })

    runCommand('selection.delete', ctx)

    expect(called).toBe(false)
  })

  it('skipEnabledCheck bypasses the enabled() gate — the contract useKeyboardShortcuts relies on so a keyboard shortcut still reaches a command\'s own "nothing to do" feedback (e.g. followLineageThread\'s status hint) instead of silently no-opping', () => {
    let called = false
    const ctx = fakeContext({
      deleteSelected: () => {
        called = true
      },
      ui: { selectedClipIds: [], selectedNodeIds: [], selectedClipId: null, selectedNodeId: null },
    })

    runCommand('selection.delete', ctx, { skipEnabledCheck: true })

    expect(called).toBe(true)
  })

  it('silently no-ops for an unknown command id', () => {
    expect(() => runCommand('not.a.real.command' as ShortcutCommand, fakeContext({}))).not.toThrow()
  })

  it('records successful runs into getRecentCommandIds, most-recent-first, de-duplicated', () => {
    const ctx = fakeContext({
      fitWorkflowViewport: () => {},
      openNodePicker: () => {},
    })

    runCommand('workflow.fitView', ctx)
    runCommand('workflow.openNodePicker', ctx)
    runCommand('workflow.fitView', ctx)

    const recent = getRecentCommandIds()
    expect(recent[0]).toBe('workflow.fitView')
    expect(recent[1]).toBe('workflow.openNodePicker')
    expect(recent.filter((id) => id === 'workflow.fitView')).toHaveLength(1)
  })

  it('does not crash the workspace.focus* commands when no DOM is present (this repo\'s vitest env has no jsdom)', () => {
    expect(() => runCommand('workspace.focusSky', fakeContext({}))).not.toThrow()
    expect(() => runCommand('workspace.focusHorizonSplitter', fakeContext({}))).not.toThrow()
  })
})
