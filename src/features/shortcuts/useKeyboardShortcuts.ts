import { useEffect } from 'react'
import {
  createProjectWithPicker,
  openProjectWithPicker,
  saveProjectAsWithPicker,
} from '../../services/project-file-actions'
import { quitApplication, toggleAppFullscreen } from '../../services/ipc/app-shell'
import {
  getCommandBinding,
  keybindingMatchesEvent,
  type ShortcutCommand,
} from '../../services/shortcuts/shortcut-config'
import { useProjectStore } from '../../store/project-store'
import { followLineageThread } from '../workspace/followLineageThread'
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

export function useKeyboardShortcuts(options?: { onOpenShortcutsHelp?: () => void }) {
  const { onOpenShortcutsHelp } = options ?? {}
  const activeView = useProjectStore((state) => state.ui.activeView)
  const keybindings = useProjectStore((state) => state.preferences.keybindings)
  const setActiveView = useProjectStore((state) => state.setActiveView)
  const saveProject = useProjectStore((state) => state.saveProject)
  const saveProjectAs = useProjectStore((state) => state.saveProjectAs)
  const defaultProjectDirectory = useProjectStore((state) => state.preferences.defaultProjectDirectory)
  const newProject = useProjectStore((state) => state.newProject)
  const createProjectAtPath = useProjectStore((state) => state.createProjectAtPath)
  const openProjectFromPath = useProjectStore((state) => state.openProjectFromPath)
  const importAssetFromPath = useProjectStore((state) => state.importAssetFromPath)
  const openSettings = useProjectStore((state) => state.openSettings)
  const openNodePicker = useProjectStore((state) => state.openNodePicker)
  const undo = useProjectStore((state) => state.undo)
  const redo = useProjectStore((state) => state.redo)
  const addNodeOfType = useProjectStore((state) => state.addNodeOfType)
  const selectAllWorkflowNodes = useProjectStore((state) => state.selectAllWorkflowNodes)
  const copySelectedNodes = useProjectStore((state) => state.copySelectedNodes)
  const pasteWorkflowClipboard = useProjectStore((state) => state.pasteWorkflowClipboard)
  const groupSelectedWorkflowNodes = useProjectStore((state) => state.groupSelectedWorkflowNodes)
  const duplicateSelected = useProjectStore((state) => state.duplicateSelected)
  const deleteSelected = useProjectStore((state) => state.deleteSelected)
  const splitSelectedClip = useProjectStore((state) => state.splitSelectedClip)
  const movePlayhead = useProjectStore((state) => state.movePlayhead)
  const togglePlayback = useProjectStore((state) => state.togglePlayback)
  const pausePlayback = useProjectStore((state) => state.pausePlayback)
  const shuttlePlayback = useProjectStore((state) => state.shuttlePlayback)
  const setInPoint = useProjectStore((state) => state.setInPoint)
  const setOutPoint = useProjectStore((state) => state.setOutPoint)
  const clearInOutPoints = useProjectStore((state) => state.clearInOutPoints)
  const adjustTimelineZoom = useProjectStore((state) => state.adjustTimelineZoom)
  const fitTimelineToWindow = useProjectStore((state) => state.fitTimelineToWindow)
  const setPlayhead = useProjectStore((state) => state.setPlayhead)
  const selectAllTimelineClips = useProjectStore((state) => state.selectAllTimelineClips)
  const copySelectedClips = useProjectStore((state) => state.copySelectedClips)
  const pasteTimelineClipboard = useProjectStore((state) => state.pasteTimelineClipboard)
  const moveSelectedClipToAdjacentTrack = useProjectStore((state) => state.moveSelectedClipToAdjacentTrack)
  const fitWorkflowViewport = useProjectStore((state) => state.fitWorkflowViewport)

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

      // Timeline/workflow command scope for THIS keydown — see resolveStratumScope's doc
      // comment. Deliberately NOT used by 'global.toggleView' below, which flips which stratum
      // is *emphasized* and must stay keyed to the real activeView/horizon state. Named
      // `stratumScope` (not `scope`) to avoid shadowing the inner `matches()` helper's own
      // `scope` parameter (the keybinding's `when` clause — a related but distinct concept).
      const stratumScope = resolveStratumScope(activeView, event.target)

      if (matches('global.toggleView', 'global', event)) {
        event.preventDefault()
        setActiveView(activeView === 'timeline' ? 'workflow' : 'timeline')
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

      if (matches('global.saveProject', 'global', event)) {
        event.preventDefault()
        void saveProject()
        return
      }

      if (matches('global.saveProjectAs', 'global', event)) {
        event.preventDefault()
        void saveProjectAsWithPicker(saveProjectAs, defaultProjectDirectory)
        return
      }

      if (matches('global.newProject', 'global', event)) {
        event.preventDefault()
        void createProjectWithPicker(newProject, createProjectAtPath, defaultProjectDirectory)
        return
      }

      if (matches('global.openProject', 'global', event)) {
        event.preventDefault()
        void openProjectWithPicker(openProjectFromPath, defaultProjectDirectory)
        return
      }

      if (matches('global.importMedia', 'global', event)) {
        event.preventDefault()
        void importAssetFromPath()
        return
      }

      if (matches('global.openSettings', 'global', event)) {
        event.preventDefault()
        openSettings()
        return
      }

      if (matches('global.toggleFullscreen', 'global', event)) {
        event.preventDefault()
        void toggleAppFullscreen()
        return
      }

      if (matches('global.quitApp', 'global', event)) {
        event.preventDefault()
        void quitApplication()
        return
      }

      if (matches('global.undo', 'global', event)) {
        event.preventDefault()
        undo()
        return
      }

      if (matches('global.redo', 'global', event)) {
        event.preventDefault()
        redo()
        return
      }

      if (matches('global.redoAlt', 'global', event)) {
        event.preventDefault()
        redo()
        return
      }

      if (stratumScope === 'timeline' && matches('timeline.selectAll', 'timeline', event)) {
        event.preventDefault()
        selectAllTimelineClips()
        return
      }

      if (stratumScope === 'workflow' && matches('workflow.selectAll', 'workflow', event)) {
        event.preventDefault()
        selectAllWorkflowNodes()
        return
      }

      if (stratumScope === 'timeline' && matches('timeline.copy', 'timeline', event)) {
        event.preventDefault()
        copySelectedClips()
        return
      }

      if (stratumScope === 'timeline' && matches('timeline.paste', 'timeline', event)) {
        event.preventDefault()
        pasteTimelineClipboard()
        return
      }

      if (stratumScope === 'workflow' && matches('workflow.copy', 'workflow', event)) {
        event.preventDefault()
        copySelectedNodes()
        return
      }

      if (stratumScope === 'workflow' && matches('workflow.paste', 'workflow', event)) {
        event.preventDefault()
        pasteWorkflowClipboard()
        return
      }

      if (stratumScope === 'workflow' && matches('workflow.groupSelection', 'workflow', event)) {
        event.preventDefault()
        groupSelectedWorkflowNodes()
        return
      }

      if (matches('selection.delete', 'global', event)) {
        event.preventDefault()
        deleteSelected()
        return
      }

      if (matches('selection.duplicate', 'global', event)) {
        event.preventDefault()
        duplicateSelected()
        return
      }

      // MERIDIAN item 5: F follows the lineage thread from the current selection. Reuses item
      // 2's editable-target/overlay guards on top of the top-of-handler INPUT/TEXTAREA/SELECT
      // check (that one doesn't cover contentEditable or an open dialog's own buttons).
      // Strictly observational (decision B) — see followLineageThread's doc comment.
      if (!event.repeat && matches('lineage.followThread', 'global', event) && !isEditableTarget(event.target) && !isOverlayOpen()) {
        event.preventDefault()
        followLineageThread()
        return
      }

      if (stratumScope === 'workflow' && matches('workflow.openNodePicker', 'workflow', event)) {
        event.preventDefault()
        openNodePicker()
        return
      }

      if (stratumScope === 'workflow' && matches('workflow.fitView', 'workflow', event)) {
        event.preventDefault()
        fitWorkflowViewport()
        return
      }

      if (stratumScope === 'workflow') {
        const quickAddMap: Array<[ShortcutCommand, Parameters<typeof addNodeOfType>[0]]> = [
          ['workflow.quickAddMedia', 'media_source'],
          ['workflow.quickAddCamera', 'camera'],
          ['workflow.quickAddShader', 'shader'],
          ['workflow.quickAddCompositor', 'compositor'],
          ['workflow.quickAddTransform', 'transform'],
          ['workflow.quickAddColorCorrect', 'color_correct'],
          ['workflow.quickAddAiGenerate', 'ai_generate'],
          ['workflow.quickAddAiUpscale', 'ai_upscale'],
          ['workflow.quickAddOutput', 'output'],
        ]

        const quickAdd = quickAddMap.find(([command]) => matches(command, 'workflow', event))
        if (quickAdd) {
          event.preventDefault()
          addNodeOfType(quickAdd[1])
          return
        }
      }

      if (stratumScope === 'timeline' && matches('timeline.playPause', 'timeline', event)) {
        event.preventDefault()
        togglePlayback()
        return
      }

      if (stratumScope === 'timeline' && matches('timeline.shuttleReverse', 'timeline', event)) {
        event.preventDefault()
        shuttlePlayback('reverse')
        return
      }

      if (stratumScope === 'timeline' && matches('timeline.pause', 'timeline', event)) {
        event.preventDefault()
        pausePlayback()
        return
      }

      if (stratumScope === 'timeline' && matches('timeline.shuttleForward', 'timeline', event)) {
        event.preventDefault()
        shuttlePlayback('forward')
        return
      }

      if (stratumScope === 'timeline' && matches('timeline.split', 'timeline', event)) {
        event.preventDefault()
        splitSelectedClip()
        return
      }

      if (stratumScope === 'timeline' && matches('timeline.setInPoint', 'timeline', event)) {
        event.preventDefault()
        setInPoint()
        return
      }

      if (stratumScope === 'timeline' && matches('timeline.setOutPoint', 'timeline', event)) {
        event.preventDefault()
        setOutPoint()
        return
      }

      if (stratumScope === 'timeline' && matches('timeline.clearInOut', 'timeline', event)) {
        event.preventDefault()
        clearInOutPoints()
        return
      }

      if (stratumScope === 'timeline' && matches('timeline.moveLeft', 'timeline', event)) {
        event.preventDefault()
        movePlayhead(-1 / 30)
        return
      }

      if (stratumScope === 'timeline' && matches('timeline.moveRight', 'timeline', event)) {
        event.preventDefault()
        movePlayhead(1 / 30)
        return
      }

      if (stratumScope === 'timeline' && matches('timeline.moveLeftFast', 'timeline', event)) {
        event.preventDefault()
        movePlayhead(-10 / 30)
        return
      }

      if (stratumScope === 'timeline' && matches('timeline.moveRightFast', 'timeline', event)) {
        event.preventDefault()
        movePlayhead(10 / 30)
        return
      }

      if (stratumScope === 'timeline' && matches('timeline.goHome', 'timeline', event)) {
        event.preventDefault()
        setPlayhead(0)
        return
      }

      if (stratumScope === 'timeline' && matches('timeline.goEnd', 'timeline', event)) {
        event.preventDefault()
        const store = useProjectStore.getState()
        const timelineEnd = Math.max(
          ...store.project.timeline.tracks.flatMap((track) => track.clips.map((clip) => clip.startTime + clip.duration)),
          store.project.timeline.outPoint ?? 0,
          0,
        )
        setPlayhead(timelineEnd)
        return
      }

      if (stratumScope === 'timeline' && matches('timeline.moveClipUp', 'timeline', event)) {
        event.preventDefault()
        moveSelectedClipToAdjacentTrack('up')
        return
      }

      if (stratumScope === 'timeline' && matches('timeline.moveClipDown', 'timeline', event)) {
        event.preventDefault()
        moveSelectedClipToAdjacentTrack('down')
        return
      }

      if (stratumScope === 'timeline' && matches('timeline.zoomIn', 'timeline', event)) {
        event.preventDefault()
        adjustTimelineZoom(0.25)
        return
      }

      if (stratumScope === 'timeline' && matches('timeline.zoomOut', 'timeline', event)) {
        event.preventDefault()
        adjustTimelineZoom(-0.25)
        return
      }

      if (stratumScope === 'timeline' && matches('timeline.fitView', 'timeline', event)) {
        event.preventDefault()
        fitTimelineToWindow()
      }
    }

    window.addEventListener('keydown', handleKeyDown)

    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [
    activeView,
    addNodeOfType,
    adjustTimelineZoom,
    clearInOutPoints,
    copySelectedClips,
    copySelectedNodes,
    fitTimelineToWindow,
    fitWorkflowViewport,
    groupSelectedWorkflowNodes,
    deleteSelected,
    duplicateSelected,
    movePlayhead,
    moveSelectedClipToAdjacentTrack,
    newProject,
    createProjectAtPath,
    defaultProjectDirectory,
    keybindings,
    openProjectFromPath,
    importAssetFromPath,
    onOpenShortcutsHelp,
    openNodePicker,
    openSettings,
    pausePlayback,
    pasteTimelineClipboard,
    pasteWorkflowClipboard,
    redo,
    saveProject,
    saveProjectAs,
    selectAllTimelineClips,
    selectAllWorkflowNodes,
    setPlayhead,
    setInPoint,
    setOutPoint,
    setActiveView,
    splitSelectedClip,
    shuttlePlayback,
    togglePlayback,
    undo,
  ])
}
