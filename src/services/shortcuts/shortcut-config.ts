import type { KeyBinding, ShortcutScope } from '../../domain/project/types'

export type ShortcutCommand =
  | 'global.newProject'
  | 'global.openProject'
  | 'global.saveProject'
  | 'global.saveProjectAs'
  | 'global.importMedia'
  | 'global.openSettings'
  | 'global.toggleFullscreen'
  | 'global.quitApp'
  | 'global.undo'
  | 'global.redo'
  | 'global.redoAlt'
  | 'global.toggleView'
  | 'global.openShortcutsHelp'
  | 'timeline.selectAll'
  | 'timeline.copy'
  | 'timeline.paste'
  | 'timeline.playPause'
  | 'timeline.shuttleReverse'
  | 'timeline.pause'
  | 'timeline.shuttleForward'
  | 'timeline.split'
  | 'timeline.setInPoint'
  | 'timeline.setOutPoint'
  | 'timeline.clearInOut'
  | 'timeline.moveLeft'
  | 'timeline.moveRight'
  | 'timeline.moveLeftFast'
  | 'timeline.moveRightFast'
  | 'timeline.goHome'
  | 'timeline.goEnd'
  | 'timeline.moveClipUp'
  | 'timeline.moveClipDown'
  | 'timeline.zoomIn'
  | 'timeline.zoomOut'
  | 'timeline.fitView'
  | 'workflow.selectAll'
  | 'workflow.copy'
  | 'workflow.paste'
  | 'workflow.groupSelection'
  | 'workflow.openNodePicker'
  | 'workflow.fitView'
  | 'workflow.quickAddMedia'
  | 'workflow.quickAddCamera'
  | 'workflow.quickAddShader'
  | 'workflow.quickAddCompositor'
  | 'workflow.quickAddTransform'
  | 'workflow.quickAddColorCorrect'
  | 'workflow.quickAddAiGenerate'
  | 'workflow.quickAddAiUpscale'
  | 'workflow.quickAddOutput'
  | 'selection.delete'
  | 'selection.duplicate'

export interface ShortcutDefinition {
  command: ShortcutCommand
  label: string
  when: ShortcutScope
}

export const SHORTCUT_DEFINITIONS: ShortcutDefinition[] = [
  { command: 'global.newProject', label: 'New Project', when: 'global' },
  { command: 'global.openProject', label: 'Open Project', when: 'global' },
  { command: 'global.saveProject', label: 'Save Project', when: 'global' },
  { command: 'global.saveProjectAs', label: 'Save Project As', when: 'global' },
  { command: 'global.importMedia', label: 'Import Media', when: 'global' },
  { command: 'global.openSettings', label: 'Open Settings', when: 'global' },
  { command: 'global.toggleFullscreen', label: 'Toggle Fullscreen', when: 'global' },
  { command: 'global.quitApp', label: 'Quit App', when: 'global' },
  { command: 'global.undo', label: 'Undo', when: 'global' },
  { command: 'global.redo', label: 'Redo', when: 'global' },
  { command: 'global.redoAlt', label: 'Redo Alternate', when: 'global' },
  { command: 'global.toggleView', label: 'Toggle Timeline and Workflow View', when: 'global' },
  { command: 'global.openShortcutsHelp', label: 'Show Keyboard Shortcuts', when: 'global' },
  { command: 'timeline.selectAll', label: 'Select All Clips', when: 'timeline' },
  { command: 'timeline.copy', label: 'Copy Selected Clips', when: 'timeline' },
  { command: 'timeline.paste', label: 'Paste Clips', when: 'timeline' },
  { command: 'timeline.playPause', label: 'Play or Pause Timeline', when: 'timeline' },
  { command: 'timeline.shuttleReverse', label: 'Shuttle Reverse', when: 'timeline' },
  { command: 'timeline.pause', label: 'Pause Playback', when: 'timeline' },
  { command: 'timeline.shuttleForward', label: 'Shuttle Forward', when: 'timeline' },
  { command: 'timeline.split', label: 'Split Clip at Playhead', when: 'timeline' },
  { command: 'timeline.setInPoint', label: 'Set In Point', when: 'timeline' },
  { command: 'timeline.setOutPoint', label: 'Set Out Point', when: 'timeline' },
  { command: 'timeline.clearInOut', label: 'Clear In and Out Points', when: 'timeline' },
  { command: 'timeline.moveLeft', label: 'Move Playhead Left', when: 'timeline' },
  { command: 'timeline.moveRight', label: 'Move Playhead Right', when: 'timeline' },
  { command: 'timeline.moveLeftFast', label: 'Move Playhead Left 10 Frames', when: 'timeline' },
  { command: 'timeline.moveRightFast', label: 'Move Playhead Right 10 Frames', when: 'timeline' },
  { command: 'timeline.goHome', label: 'Go to Timeline Start', when: 'timeline' },
  { command: 'timeline.goEnd', label: 'Go to Timeline End', when: 'timeline' },
  { command: 'timeline.moveClipUp', label: 'Move Clip to Track Above', when: 'timeline' },
  { command: 'timeline.moveClipDown', label: 'Move Clip to Track Below', when: 'timeline' },
  { command: 'timeline.zoomIn', label: 'Zoom Timeline In', when: 'timeline' },
  { command: 'timeline.zoomOut', label: 'Zoom Timeline Out', when: 'timeline' },
  { command: 'timeline.fitView', label: 'Fit Timeline to Window', when: 'timeline' },
  { command: 'workflow.selectAll', label: 'Select All Nodes', when: 'workflow' },
  { command: 'workflow.copy', label: 'Copy Selected Nodes', when: 'workflow' },
  { command: 'workflow.paste', label: 'Paste Nodes', when: 'workflow' },
  { command: 'workflow.groupSelection', label: 'Group Selected Nodes', when: 'workflow' },
  { command: 'workflow.openNodePicker', label: 'Open Node Picker', when: 'workflow' },
  { command: 'workflow.fitView', label: 'Fit Workflow to View', when: 'workflow' },
  { command: 'workflow.quickAddMedia', label: 'Quick Add Media Node', when: 'workflow' },
  { command: 'workflow.quickAddCamera', label: 'Quick Add Camera Node', when: 'workflow' },
  { command: 'workflow.quickAddShader', label: 'Quick Add Shader Node', when: 'workflow' },
  { command: 'workflow.quickAddCompositor', label: 'Quick Add Compositor Node', when: 'workflow' },
  { command: 'workflow.quickAddTransform', label: 'Quick Add Transform Node', when: 'workflow' },
  { command: 'workflow.quickAddColorCorrect', label: 'Quick Add Color Correct Node', when: 'workflow' },
  { command: 'workflow.quickAddAiGenerate', label: 'Quick Add AI Generate Node', when: 'workflow' },
  { command: 'workflow.quickAddAiUpscale', label: 'Quick Add AI Upscale Node', when: 'workflow' },
  { command: 'workflow.quickAddOutput', label: 'Quick Add Output Node', when: 'workflow' },
  { command: 'selection.delete', label: 'Delete Current Selection', when: 'global' },
  { command: 'selection.duplicate', label: 'Duplicate Current Selection', when: 'global' },
]

export const DEFAULT_KEYBINDINGS: KeyBinding[] = [
  { command: 'global.newProject', key: 'n', modifiers: ['Ctrl'], when: 'global' },
  { command: 'global.openProject', key: 'o', modifiers: ['Ctrl'], when: 'global' },
  { command: 'global.saveProject', key: 's', modifiers: ['Ctrl'], when: 'global' },
  { command: 'global.saveProjectAs', key: 's', modifiers: ['Ctrl', 'Shift'], when: 'global' },
  { command: 'global.importMedia', key: 'i', modifiers: ['Ctrl'], when: 'global' },
  { command: 'global.openSettings', key: ',', modifiers: ['Ctrl'], when: 'global' },
  { command: 'global.toggleFullscreen', key: 'F11', modifiers: [], when: 'global' },
  { command: 'global.quitApp', key: 'q', modifiers: ['Ctrl'], when: 'global' },
  { command: 'global.undo', key: 'z', modifiers: ['Ctrl'], when: 'global' },
  { command: 'global.redo', key: 'z', modifiers: ['Ctrl', 'Shift'], when: 'global' },
  { command: 'global.redoAlt', key: 'y', modifiers: ['Ctrl'], when: 'global' },
  { command: 'global.toggleView', key: '`', modifiers: [], when: 'global' },
  // '?' is Shift+/ on standard keyboards — the browser reports event.shiftKey
  // for it, so the modifier must be declared to match keybindingMatchesEvent.
  { command: 'global.openShortcutsHelp', key: '?', modifiers: ['Shift'], when: 'global' },
  { command: 'timeline.selectAll', key: 'a', modifiers: ['Ctrl'], when: 'timeline' },
  { command: 'timeline.copy', key: 'c', modifiers: ['Ctrl'], when: 'timeline' },
  { command: 'timeline.paste', key: 'v', modifiers: ['Ctrl'], when: 'timeline' },
  { command: 'timeline.playPause', key: 'Space', modifiers: [], when: 'timeline' },
  { command: 'timeline.shuttleReverse', key: 'j', modifiers: [], when: 'timeline' },
  { command: 'timeline.pause', key: 'k', modifiers: [], when: 'timeline' },
  { command: 'timeline.shuttleForward', key: 'l', modifiers: [], when: 'timeline' },
  { command: 'timeline.split', key: 'c', modifiers: [], when: 'timeline' },
  { command: 'timeline.setInPoint', key: 'i', modifiers: [], when: 'timeline' },
  { command: 'timeline.setOutPoint', key: 'o', modifiers: [], when: 'timeline' },
  { command: 'timeline.clearInOut', key: 'x', modifiers: ['Ctrl', 'Shift'], when: 'timeline' },
  { command: 'timeline.moveLeft', key: 'ArrowLeft', modifiers: [], when: 'timeline' },
  { command: 'timeline.moveRight', key: 'ArrowRight', modifiers: [], when: 'timeline' },
  { command: 'timeline.moveLeftFast', key: 'ArrowLeft', modifiers: ['Shift'], when: 'timeline' },
  { command: 'timeline.moveRightFast', key: 'ArrowRight', modifiers: ['Shift'], when: 'timeline' },
  { command: 'timeline.goHome', key: 'Home', modifiers: [], when: 'timeline' },
  { command: 'timeline.goEnd', key: 'End', modifiers: [], when: 'timeline' },
  { command: 'timeline.moveClipUp', key: 'ArrowUp', modifiers: ['Ctrl', 'Shift'], when: 'timeline' },
  { command: 'timeline.moveClipDown', key: 'ArrowDown', modifiers: ['Ctrl', 'Shift'], when: 'timeline' },
  { command: 'timeline.zoomIn', key: '+', modifiers: [], when: 'timeline' },
  { command: 'timeline.zoomOut', key: '-', modifiers: [], when: 'timeline' },
  { command: 'timeline.fitView', key: '0', modifiers: ['Ctrl'], when: 'timeline' },
  { command: 'workflow.selectAll', key: 'a', modifiers: ['Ctrl'], when: 'workflow' },
  { command: 'workflow.copy', key: 'c', modifiers: ['Ctrl'], when: 'workflow' },
  { command: 'workflow.paste', key: 'v', modifiers: ['Ctrl'], when: 'workflow' },
  { command: 'workflow.groupSelection', key: 'g', modifiers: ['Ctrl'], when: 'workflow' },
  { command: 'workflow.openNodePicker', key: 'n', modifiers: [], when: 'workflow' },
  { command: 'workflow.fitView', key: 'f', modifiers: [], when: 'workflow' },
  { command: 'workflow.quickAddMedia', key: '1', modifiers: [], when: 'workflow' },
  { command: 'workflow.quickAddCamera', key: '2', modifiers: [], when: 'workflow' },
  { command: 'workflow.quickAddShader', key: '3', modifiers: [], when: 'workflow' },
  { command: 'workflow.quickAddCompositor', key: '4', modifiers: [], when: 'workflow' },
  { command: 'workflow.quickAddTransform', key: '5', modifiers: [], when: 'workflow' },
  { command: 'workflow.quickAddColorCorrect', key: '6', modifiers: [], when: 'workflow' },
  { command: 'workflow.quickAddAiGenerate', key: '7', modifiers: [], when: 'workflow' },
  { command: 'workflow.quickAddAiUpscale', key: '8', modifiers: [], when: 'workflow' },
  { command: 'workflow.quickAddOutput', key: '9', modifiers: [], when: 'workflow' },
  { command: 'selection.delete', key: 'Delete', modifiers: [], when: 'global' },
  { command: 'selection.duplicate', key: 'd', modifiers: ['Ctrl'], when: 'global' },
]

export function normalizeBindingKey(value: string) {
  if (value === ' ') return 'Space'
  if (value.length === 1) return value.toLowerCase()
  return value
}

export function formatKeybinding(binding: KeyBinding) {
  return [...binding.modifiers, binding.key].join('+')
}

export function getCommandBinding(bindings: KeyBinding[], command: ShortcutCommand) {
  return bindings.find((binding) => binding.command === command)
}

export function keybindingMatchesEvent(event: KeyboardEvent, binding: KeyBinding) {
  const normalizedKey = normalizeBindingKey(event.key)
  const normalizedModifiers = getEventModifiers(event)
  const bindingModifiers = [...binding.modifiers].sort()

  return binding.key === normalizedKey && normalizedModifiers.join('|') === bindingModifiers.join('|')
}

export function getEventModifiers(event: KeyboardEvent) {
  const modifiers: string[] = []
  if (event.ctrlKey) modifiers.push('Ctrl')
  if (event.shiftKey) modifiers.push('Shift')
  if (event.altKey) modifiers.push('Alt')
  if (event.metaKey) modifiers.push('Meta')
  return modifiers.sort()
}

export function captureEventAsBinding(
  event: KeyboardEvent,
  command: ShortcutCommand,
  when: ShortcutScope,
): KeyBinding {
  return {
    command,
    when,
    key: normalizeBindingKey(event.key),
    modifiers: getEventModifiers(event),
  }
}

export function detectKeybindingConflict(bindings: KeyBinding[], candidate: KeyBinding) {
  return bindings.find(
    (binding) =>
      binding.command !== candidate.command &&
      binding.when === candidate.when &&
      binding.key === candidate.key &&
      [...binding.modifiers].sort().join('|') === [...candidate.modifiers].sort().join('|'),
  )
}
