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

export function useKeyboardShortcuts() {
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

      if (matches('global.toggleView', 'global', event)) {
        event.preventDefault()
        setActiveView(activeView === 'timeline' ? 'workflow' : 'timeline')
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

      if (activeView === 'timeline' && matches('timeline.selectAll', 'timeline', event)) {
        event.preventDefault()
        selectAllTimelineClips()
        return
      }

      if (activeView === 'workflow' && matches('workflow.selectAll', 'workflow', event)) {
        event.preventDefault()
        selectAllWorkflowNodes()
        return
      }

      if (activeView === 'timeline' && matches('timeline.copy', 'timeline', event)) {
        event.preventDefault()
        copySelectedClips()
        return
      }

      if (activeView === 'timeline' && matches('timeline.paste', 'timeline', event)) {
        event.preventDefault()
        pasteTimelineClipboard()
        return
      }

      if (activeView === 'workflow' && matches('workflow.copy', 'workflow', event)) {
        event.preventDefault()
        copySelectedNodes()
        return
      }

      if (activeView === 'workflow' && matches('workflow.paste', 'workflow', event)) {
        event.preventDefault()
        pasteWorkflowClipboard()
        return
      }

      if (activeView === 'workflow' && matches('workflow.groupSelection', 'workflow', event)) {
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

      if (activeView === 'workflow' && matches('workflow.openNodePicker', 'workflow', event)) {
        event.preventDefault()
        openNodePicker()
        return
      }

      if (activeView === 'workflow' && matches('workflow.fitView', 'workflow', event)) {
        event.preventDefault()
        fitWorkflowViewport()
        return
      }

      if (activeView === 'workflow') {
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

      if (activeView === 'timeline' && matches('timeline.playPause', 'timeline', event)) {
        event.preventDefault()
        togglePlayback()
        return
      }

      if (activeView === 'timeline' && matches('timeline.shuttleReverse', 'timeline', event)) {
        event.preventDefault()
        shuttlePlayback('reverse')
        return
      }

      if (activeView === 'timeline' && matches('timeline.pause', 'timeline', event)) {
        event.preventDefault()
        pausePlayback()
        return
      }

      if (activeView === 'timeline' && matches('timeline.shuttleForward', 'timeline', event)) {
        event.preventDefault()
        shuttlePlayback('forward')
        return
      }

      if (activeView === 'timeline' && matches('timeline.split', 'timeline', event)) {
        event.preventDefault()
        splitSelectedClip()
        return
      }

      if (activeView === 'timeline' && matches('timeline.setInPoint', 'timeline', event)) {
        event.preventDefault()
        setInPoint()
        return
      }

      if (activeView === 'timeline' && matches('timeline.setOutPoint', 'timeline', event)) {
        event.preventDefault()
        setOutPoint()
        return
      }

      if (activeView === 'timeline' && matches('timeline.clearInOut', 'timeline', event)) {
        event.preventDefault()
        clearInOutPoints()
        return
      }

      if (activeView === 'timeline' && matches('timeline.moveLeft', 'timeline', event)) {
        event.preventDefault()
        movePlayhead(-1 / 30)
        return
      }

      if (activeView === 'timeline' && matches('timeline.moveRight', 'timeline', event)) {
        event.preventDefault()
        movePlayhead(1 / 30)
        return
      }

      if (activeView === 'timeline' && matches('timeline.moveLeftFast', 'timeline', event)) {
        event.preventDefault()
        movePlayhead(-10 / 30)
        return
      }

      if (activeView === 'timeline' && matches('timeline.moveRightFast', 'timeline', event)) {
        event.preventDefault()
        movePlayhead(10 / 30)
        return
      }

      if (activeView === 'timeline' && matches('timeline.goHome', 'timeline', event)) {
        event.preventDefault()
        setPlayhead(0)
        return
      }

      if (activeView === 'timeline' && matches('timeline.goEnd', 'timeline', event)) {
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

      if (activeView === 'timeline' && matches('timeline.moveClipUp', 'timeline', event)) {
        event.preventDefault()
        moveSelectedClipToAdjacentTrack('up')
        return
      }

      if (activeView === 'timeline' && matches('timeline.moveClipDown', 'timeline', event)) {
        event.preventDefault()
        moveSelectedClipToAdjacentTrack('down')
        return
      }

      if (activeView === 'timeline' && matches('timeline.zoomIn', 'timeline', event)) {
        event.preventDefault()
        adjustTimelineZoom(0.25)
        return
      }

      if (activeView === 'timeline' && matches('timeline.zoomOut', 'timeline', event)) {
        event.preventDefault()
        adjustTimelineZoom(-0.25)
        return
      }

      if (activeView === 'timeline' && matches('timeline.fitView', 'timeline', event)) {
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
