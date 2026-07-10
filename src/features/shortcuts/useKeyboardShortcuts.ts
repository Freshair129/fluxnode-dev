import { useEffect } from 'react'
import { getCommandBinding, keybindingMatchesEvent, type ShortcutCommand } from '../../services/shortcuts/shortcut-config'
import { useProjectStore } from '../../store/project-store'
import { buildCommandContext, runCommand } from '../../services/commands/command-registry'
import { isEditableTarget, isOverlayOpen } from './guardTargets'

/**
 * Duck-typed subset of `Element` this module needs — lets `resolveStratumScope` be unit tested
 * with a plain mock instead of requiring a real DOM (this repo's vitest config has no jsdom
 * environment set up; `domain/project/horizon.ts`'s `prefersReducedMotion` has the same
 * `typeof window !== 'undefined'` guard for the same reason).
 */
interface StratumScopeTarget {
  closest: (selector: string) => { getAttribute: (name: string) => string | null } | null
}

function isStratumScopeTarget(target: EventTarget | null): target is EventTarget & StratumScopeTarget {
  return target !== null && typeof (target as Partial<StratumScopeTarget>).closest === 'function'
}

/**
 * Carried review note (item-2 review, folded into item 4): `useKeyboardShortcuts` used to gate
 * every timeline/workflow command on `activeView` alone. That made sense when the two strata
 * were an either/or view switch, but MERIDIAN's shell (item 2/3) renders both sky and ground
 * simultaneously — `activeView` now only tracks which one is *emphasized* (has the bigger
 * horizon split), not which one the user is actually interacting with. Gating on it left the
 * visible, non-emphasized stratum keyboard-inert, in tension with M.1 ("accent = live signal or
 * selection only" implies the *other* visible surface is still a first-class target, not dead
 * chrome).
 *
 * Fix: command scope follows DOM focus. `StrataShell` tags each stratum's wrapper with
 * `data-meridian-stratum="workflow"` / `"timeline"`; this walks up from the keydown target to
 * find that marker. If focus is genuinely inside one stratum (a node, a clip, a toolbar button
 * within it, etc.), that stratum's commands fire regardless of horizon emphasis. If focus is
 * "at rest" (body, or anything outside both strata — e.g. the job ledger, inspector, a drawer),
 * scope falls back to `activeView`/emphasis, preserving today's default behavior when nothing
 * more specific is focused.
 */
export function resolveStratumScope(
  activeView: 'timeline' | 'workflow',
  target: EventTarget | null,
): 'timeline' | 'workflow' {
  if (!isStratumScopeTarget(target)) {
    return activeView
  }

  const stratumEl = target.closest('[data-meridian-stratum]')
  const stratum = stratumEl?.getAttribute('data-meridian-stratum')

  return stratum === 'timeline' || stratum === 'workflow' ? stratum : activeView
}

/**
 * MERIDIAN item 6: dispatch now goes THROUGH the unified command registry
 * (`services/commands/command-registry.ts`) instead of this hook owning 54+ inline store calls.
 * The guard/scope structure below — the top-of-handler editable-target check, the bare-Tab
 * passthrough, `resolveStratumScope`, per-branch `!event.repeat`/editable/overlay guards — is
 * UNCHANGED from before item 6; only the body of each matched branch changed, from calling a
 * store action directly to `runCommand(id, ctx, { skipEnabledCheck: true })`. `skipEnabledCheck`
 * is load-bearing: the registry's `enabled()` predicates exist purely to grey out palette rows
 * (spec H) and must NOT gate raw keyboard dispatch, or a shortcut like `F` with nothing selected
 * would silently do nothing instead of reaching `followLineageThread`'s own "nothing to follow"
 * status-hint feedback — see `runCommand`'s `RunCommandOptions` doc comment for the full
 * rationale.
 *
 * Explicitly NOT moved into the registry (per the item-6 brief): `StrataShell`'s Tab-flip,
 * backtick peek-hold, and Ctrl+Arrow horizon nudge. Those are shell mechanics — continuous
 * drag/gesture-adjacent behavior — not discrete commands, and they already have their own
 * `keydown` listener in `features/workspace/StrataShell.tsx`.
 */
export function useKeyboardShortcuts(options?: {
  onOpenShortcutsHelp?: () => void
  onOpenCommandPalette?: () => void
}) {
  const { onOpenShortcutsHelp, onOpenCommandPalette } = options ?? {}
  const keybindings = useProjectStore((state) => state.preferences.keybindings)

  useEffect(() => {
    function matches(command: ShortcutCommand, scope: 'global' | 'timeline' | 'workflow', event: KeyboardEvent) {
      const binding = getCommandBinding(keybindings, command)
      if (!binding || binding.when !== scope) {
        return false
      }
      return keybindingMatchesEvent(event, binding)
    }

    function handleKeyDown(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null

      if (target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) {
        return
      }

      // A bare Tab (no modifiers) must always be left to the browser for native
      // focus traversal (WCAG 2.1.1). No command may ever bind to it, no matter
      // what a future keybinding remap does — this guard is intentionally ahead
      // of the generic `matches()` dispatch below.
      if (event.key === 'Tab' && !event.ctrlKey && !event.shiftKey && !event.altKey && !event.metaKey) {
        return
      }

      // Fresh store snapshot for THIS keydown — every registry `run()`/`enabled()` reads off of
      // it, same "getState() right before dispatch" pattern `followLineageThread.ts` already
      // uses. Built once per event so every branch below shares one consistent snapshot.
      const ctx = buildCommandContext({
        showShortcutsHelp: () => onOpenShortcutsHelp?.(),
        openCommandPalette: () => onOpenCommandPalette?.(),
      })

      // Timeline/workflow command scope for THIS keydown — see resolveStratumScope's doc
      // comment. Deliberately NOT used by 'global.toggleView' below, which flips which stratum
      // is *emphasized* and must stay keyed to the real activeView/horizon state (the registry's
      // own 'global.toggleView' behavior reads that straight off `ctx.store.ui.activeView`).
      const stratumScope = resolveStratumScope(ctx.store.ui.activeView, event.target)

      if (matches('global.toggleView', 'global', event)) {
        event.preventDefault()
        runCommand('global.toggleView', ctx, { skipEnabledCheck: true })
        return
      }

      // F1 is a conventional "show help" key on desktop apps; it isn't part
      // of the rebindable keybindings table since it always maps to the same
      // command, unlike '?' which goes through the normal binding lookup.
      if (event.key === 'F1' || matches('global.openShortcutsHelp', 'global', event)) {
        event.preventDefault()
        onOpenShortcutsHelp?.()
        return
      }

      // MERIDIAN item 6: Ctrl+K opens the command palette (spec H). Same editable-target/overlay
      // guard shape as lineage.followThread below — typing "k" in a text field must never pop
      // the palette, and the palette itself counts as an overlay so it can't be re-triggered
      // over another already-open one.
      if (
        !event.repeat &&
        matches('global.openCommandPalette', 'global', event) &&
        !isEditableTarget(event.target) &&
        !isOverlayOpen()
      ) {
        event.preventDefault()
        runCommand('global.openCommandPalette', ctx, { skipEnabledCheck: true })
        return
      }

      if (matches('global.saveProject', 'global', event)) {
        event.preventDefault()
        runCommand('global.saveProject', ctx, { skipEnabledCheck: true })
        return
      }

      if (matches('global.saveProjectAs', 'global', event)) {
        event.preventDefault()
        runCommand('global.saveProjectAs', ctx, { skipEnabledCheck: true })
        return
      }

      if (matches('global.newProject', 'global', event)) {
        event.preventDefault()
        runCommand('global.newProject', ctx, { skipEnabledCheck: true })
        return
      }

      if (matches('global.openProject', 'global', event)) {
        event.preventDefault()
        runCommand('global.openProject', ctx, { skipEnabledCheck: true })
        return
      }

      if (matches('global.importMedia', 'global', event)) {
        event.preventDefault()
        runCommand('global.importMedia', ctx, { skipEnabledCheck: true })
        return
      }

      if (matches('global.openSettings', 'global', event)) {
        event.preventDefault()
        runCommand('global.openSettings', ctx, { skipEnabledCheck: true })
        return
      }

      if (matches('global.toggleFullscreen', 'global', event)) {
        event.preventDefault()
        runCommand('global.toggleFullscreen', ctx, { skipEnabledCheck: true })
        return
      }

      if (matches('global.quitApp', 'global', event)) {
        event.preventDefault()
        runCommand('global.quitApp', ctx, { skipEnabledCheck: true })
        return
      }

      if (matches('global.undo', 'global', event)) {
        event.preventDefault()
        runCommand('global.undo', ctx, { skipEnabledCheck: true })
        return
      }

      if (matches('global.redo', 'global', event)) {
        event.preventDefault()
        runCommand('global.redo', ctx, { skipEnabledCheck: true })
        return
      }

      if (matches('global.redoAlt', 'global', event)) {
        event.preventDefault()
        runCommand('global.redoAlt', ctx, { skipEnabledCheck: true })
        return
      }

      if (stratumScope === 'timeline' && matches('timeline.selectAll', 'timeline', event)) {
        event.preventDefault()
        runCommand('timeline.selectAll', ctx, { skipEnabledCheck: true })
        return
      }

      if (stratumScope === 'workflow' && matches('workflow.selectAll', 'workflow', event)) {
        event.preventDefault()
        runCommand('workflow.selectAll', ctx, { skipEnabledCheck: true })
        return
      }

      if (stratumScope === 'timeline' && matches('timeline.copy', 'timeline', event)) {
        event.preventDefault()
        runCommand('timeline.copy', ctx, { skipEnabledCheck: true })
        return
      }

      if (stratumScope === 'timeline' && matches('timeline.paste', 'timeline', event)) {
        event.preventDefault()
        runCommand('timeline.paste', ctx, { skipEnabledCheck: true })
        return
      }

      if (stratumScope === 'workflow' && matches('workflow.copy', 'workflow', event)) {
        event.preventDefault()
        runCommand('workflow.copy', ctx, { skipEnabledCheck: true })
        return
      }

      if (stratumScope === 'workflow' && matches('workflow.paste', 'workflow', event)) {
        event.preventDefault()
        runCommand('workflow.paste', ctx, { skipEnabledCheck: true })
        return
      }

      if (stratumScope === 'workflow' && matches('workflow.groupSelection', 'workflow', event)) {
        event.preventDefault()
        runCommand('workflow.groupSelection', ctx, { skipEnabledCheck: true })
        return
      }

      if (matches('selection.delete', 'global', event)) {
        event.preventDefault()
        runCommand('selection.delete', ctx, { skipEnabledCheck: true })
        return
      }

      if (matches('selection.duplicate', 'global', event)) {
        event.preventDefault()
        runCommand('selection.duplicate', ctx, { skipEnabledCheck: true })
        return
      }

      // MERIDIAN item 5: F follows the lineage thread from the current selection. Reuses item
      // 2's editable-target/overlay guards on top of the top-of-handler INPUT/TEXTAREA/SELECT
      // check (that one doesn't cover contentEditable or an open dialog's own buttons).
      // Strictly observational (decision B) — see followLineageThread's doc comment.
      if (!event.repeat && matches('lineage.followThread', 'global', event) && !isEditableTarget(event.target) && !isOverlayOpen()) {
        event.preventDefault()
        runCommand('lineage.followThread', ctx, { skipEnabledCheck: true })
        return
      }

      if (stratumScope === 'workflow' && matches('workflow.openNodePicker', 'workflow', event)) {
        event.preventDefault()
        runCommand('workflow.openNodePicker', ctx, { skipEnabledCheck: true })
        return
      }

      if (stratumScope === 'workflow' && matches('workflow.fitView', 'workflow', event)) {
        event.preventDefault()
        runCommand('workflow.fitView', ctx, { skipEnabledCheck: true })
        return
      }

      if (stratumScope === 'workflow') {
        const quickAddCommands: ShortcutCommand[] = [
          'workflow.quickAddMedia',
          'workflow.quickAddCamera',
          'workflow.quickAddShader',
          'workflow.quickAddCompositor',
          'workflow.quickAddTransform',
          'workflow.quickAddColorCorrect',
          'workflow.quickAddAiGenerate',
          'workflow.quickAddAiUpscale',
          'workflow.quickAddOutput',
        ]

        const quickAdd = quickAddCommands.find((command) => matches(command, 'workflow', event))
        if (quickAdd) {
          event.preventDefault()
          runCommand(quickAdd, ctx, { skipEnabledCheck: true })
          return
        }
      }

      if (stratumScope === 'timeline' && matches('timeline.playPause', 'timeline', event)) {
        event.preventDefault()
        runCommand('timeline.playPause', ctx, { skipEnabledCheck: true })
        return
      }

      if (stratumScope === 'timeline' && matches('timeline.shuttleReverse', 'timeline', event)) {
        event.preventDefault()
        runCommand('timeline.shuttleReverse', ctx, { skipEnabledCheck: true })
        return
      }

      if (stratumScope === 'timeline' && matches('timeline.pause', 'timeline', event)) {
        event.preventDefault()
        runCommand('timeline.pause', ctx, { skipEnabledCheck: true })
        return
      }

      if (stratumScope === 'timeline' && matches('timeline.shuttleForward', 'timeline', event)) {
        event.preventDefault()
        runCommand('timeline.shuttleForward', ctx, { skipEnabledCheck: true })
        return
      }

      if (stratumScope === 'timeline' && matches('timeline.split', 'timeline', event)) {
        event.preventDefault()
        runCommand('timeline.split', ctx, { skipEnabledCheck: true })
        return
      }

      if (stratumScope === 'timeline' && matches('timeline.setInPoint', 'timeline', event)) {
        event.preventDefault()
        runCommand('timeline.setInPoint', ctx, { skipEnabledCheck: true })
        return
      }

      if (stratumScope === 'timeline' && matches('timeline.setOutPoint', 'timeline', event)) {
        event.preventDefault()
        runCommand('timeline.setOutPoint', ctx, { skipEnabledCheck: true })
        return
      }

      if (stratumScope === 'timeline' && matches('timeline.clearInOut', 'timeline', event)) {
        event.preventDefault()
        runCommand('timeline.clearInOut', ctx, { skipEnabledCheck: true })
        return
      }

      if (stratumScope === 'timeline' && matches('timeline.moveLeft', 'timeline', event)) {
        event.preventDefault()
        runCommand('timeline.moveLeft', ctx, { skipEnabledCheck: true })
        return
      }

      if (stratumScope === 'timeline' && matches('timeline.moveRight', 'timeline', event)) {
        event.preventDefault()
        runCommand('timeline.moveRight', ctx, { skipEnabledCheck: true })
        return
      }

      if (stratumScope === 'timeline' && matches('timeline.moveLeftFast', 'timeline', event)) {
        event.preventDefault()
        runCommand('timeline.moveLeftFast', ctx, { skipEnabledCheck: true })
        return
      }

      if (stratumScope === 'timeline' && matches('timeline.moveRightFast', 'timeline', event)) {
        event.preventDefault()
        runCommand('timeline.moveRightFast', ctx, { skipEnabledCheck: true })
        return
      }

      if (stratumScope === 'timeline' && matches('timeline.goHome', 'timeline', event)) {
        event.preventDefault()
        runCommand('timeline.goHome', ctx, { skipEnabledCheck: true })
        return
      }

      if (stratumScope === 'timeline' && matches('timeline.goEnd', 'timeline', event)) {
        event.preventDefault()
        runCommand('timeline.goEnd', ctx, { skipEnabledCheck: true })
        return
      }

      if (stratumScope === 'timeline' && matches('timeline.moveClipUp', 'timeline', event)) {
        event.preventDefault()
        runCommand('timeline.moveClipUp', ctx, { skipEnabledCheck: true })
        return
      }

      if (stratumScope === 'timeline' && matches('timeline.moveClipDown', 'timeline', event)) {
        event.preventDefault()
        runCommand('timeline.moveClipDown', ctx, { skipEnabledCheck: true })
        return
      }

      if (stratumScope === 'timeline' && matches('timeline.zoomIn', 'timeline', event)) {
        event.preventDefault()
        runCommand('timeline.zoomIn', ctx, { skipEnabledCheck: true })
        return
      }

      if (stratumScope === 'timeline' && matches('timeline.zoomOut', 'timeline', event)) {
        event.preventDefault()
        runCommand('timeline.zoomOut', ctx, { skipEnabledCheck: true })
        return
      }

      if (stratumScope === 'timeline' && matches('timeline.fitView', 'timeline', event)) {
        event.preventDefault()
        runCommand('timeline.fitView', ctx, { skipEnabledCheck: true })
      }
    }

    window.addEventListener('keydown', handleKeyDown)

    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [keybindings, onOpenShortcutsHelp, onOpenCommandPalette])
}
