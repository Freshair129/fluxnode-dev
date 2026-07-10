/**
 * MERIDIAN item 6 — the unified command registry (spec L.4): "single source `{ id, title, verb,
 * args?, shortcut, scope, run() }` consumed by palette, context menus, shortcut handler...
 * Menu/palette/shortcut parity is automatic."
 *
 * This EXTENDS the existing `SHORTCUT_DEFINITIONS` (item 4/5's `ShortcutCommand` union stays the
 * id space — see `services/shortcuts/shortcut-config.ts`) rather than forking a parallel command
 * list. `COMMAND_BEHAVIORS` below is a `Record<ShortcutCommand, …>`, so TypeScript enforces that
 * every shortcut command has exactly one registry entry — this file is the ONE place a
 * `ShortcutCommand` id maps to actual behavior; `useKeyboardShortcuts`, `CommandPalette`, and any
 * registry-driven context menu all call `runCommand`/read `COMMAND_REGISTRY` instead of owning
 * their own dispatch logic.
 *
 * Explicitly OUT of scope for this file (per the item-6 brief): the strata shell's Tab-flip,
 * backtick peek-hold, and Ctrl+Arrow horizon nudge (`features/workspace/StrataShell.tsx`). Those
 * are shell mechanics — continuous drag/gesture-adjacent behavior wired straight to
 * `animateRatioTo`/refs for zero-re-render performance — not discrete, palette-addressable
 * commands, and folding them in here would mean re-deriving StrataShell's drag/animation state
 * machine inside a `run()` call for no benefit.
 */
import type { KeyBinding, NodeType, ShortcutScope } from '../../domain/project/types'
import {
  DEFAULT_KEYBINDINGS,
  getCommandBinding,
  type ShortcutCommand,
  SHORTCUT_DEFINITIONS,
} from '../shortcuts/shortcut-config'
import {
  createProjectWithPicker,
  openProjectWithPicker,
  saveProjectAsWithPicker,
} from '../project-file-actions'
import { quitApplication, toggleAppFullscreen } from '../ipc/app-shell'
import { useProjectStore } from '../../store/project-store'
import { followLineageThread } from '../../features/workspace/followLineageThread'
import { focusShellRegion, resolveShellFocusTargets } from '../../features/workspace/shellFocusTargets'

type StoreState = ReturnType<typeof useProjectStore.getState>

export type CommandReach = 'direct' | 'menu' | 'accelerator'

/**
 * What a command's `run`/`enabled` need access to. `store` is a fresh snapshot
 * (`useProjectStore.getState()`) taken by the caller right before dispatch — same pattern
 * `followLineageThread.ts` already uses, so actions are always read/executed against current
 * state, never a stale closure. `showShortcutsHelp`/`openCommandPalette` are plain UI-local
 * callbacks (mirroring the existing `onOpenShortcutsHelp` option on `useKeyboardShortcuts`) —
 * NOT store state, per the item-6 hard constraint "do not change the store contract."
 */
export interface CommandContext {
  store: StoreState
  showShortcutsHelp: () => void
  openCommandPalette: () => void
  /** MERIDIAN item 9: opens the `Ctrl+E` export sheet — a UI-local callback (not store state), same
   *  pattern as `showShortcutsHelp`/`openCommandPalette` above. */
  openExportSheet: () => void
  /** MERIDIAN item 9 (round-2 advisory 5): opens one of the four status drawers — UI-local, same
   *  pattern as `openExportSheet`. */
  openStatusDrawer: (drawer: 'connectivity' | 'appUpdates' | 'workspace' | 'audio') => void
}

export function buildCommandContext(
  overrides: Partial<
    Pick<CommandContext, 'showShortcutsHelp' | 'openCommandPalette' | 'openExportSheet' | 'openStatusDrawer'>
  > = {},
): CommandContext {
  return {
    store: useProjectStore.getState(),
    showShortcutsHelp: overrides.showShortcutsHelp ?? (() => {}),
    openCommandPalette: overrides.openCommandPalette ?? (() => {}),
    openExportSheet: overrides.openExportSheet ?? (() => {}),
    openStatusDrawer: overrides.openStatusDrawer ?? (() => {}),
  }
}

export interface CommandDefinition {
  id: ShortcutCommand
  title: string
  scope: ShortcutScope
  /** Default binding, if any (baked from `DEFAULT_KEYBINDINGS` at module load). For a binding
   *  that reflects the user's live remaps, use `resolveLiveShortcut` with current
   *  `preferences.keybindings` instead — palette/context-menu rows should prefer that. */
  shortcut: KeyBinding | null
  /** M.9 discipline: is this verb also reachable by direct manipulation or a menu, or is it a
   *  deliberate expert accelerator? Populated per-command below, not defaulted, so every entry
   *  is an explicit, honest decision. */
  reach: CommandReach
  /** One-line justification for `reach` — surfaced in the palette's disabled/help text and this
   *  item's final report; keeps `reach` from being a bare, unverifiable label. */
  reachNote: string
  run: (ctx: CommandContext) => void
  enabled?: (ctx: CommandContext) => boolean
}

function hasSelection(store: StoreState): boolean {
  return store.ui.selectedClipIds.length > 0 || store.ui.selectedNodeIds.length > 0 || store.ui.selectedClipId !== null || store.ui.selectedNodeId !== null
}

interface CommandBehavior {
  reach: CommandReach
  reachNote: string
  run: (ctx: CommandContext) => void
  enabled?: (ctx: CommandContext) => boolean
}

const quickAddBehavior = (nodeType: NodeType, menuLabel: string): CommandBehavior => ({
  reach: 'menu',
  reachNote: `Same node type available from the canvas context menu ("${menuLabel}") and the node picker (workflow.openNodePicker).`,
  run: (ctx) => ctx.store.addNodeOfType(nodeType),
})

/**
 * The ONE map from `ShortcutCommand` id to behavior. `Record<ShortcutCommand, …>` is load-bearing
 * here: TypeScript will not compile if a command is added to the `ShortcutCommand` union (in
 * `shortcut-config.ts`) without a matching entry here, and vice versa — the registry can't
 * silently drift out of sync with the id space it extends.
 */
const COMMAND_BEHAVIORS: Record<ShortcutCommand, CommandBehavior> = {
  'global.newProject': {
    reach: 'direct',
    reachNote: 'Header "New project" icon button.',
    run: (ctx) =>
      void createProjectWithPicker(
        ctx.store.newProject,
        ctx.store.createProjectAtPath,
        ctx.store.preferences.defaultProjectDirectory,
      ),
  },
  'global.openProject': {
    reach: 'direct',
    reachNote: 'Header "Open project" icon button.',
    run: (ctx) => void openProjectWithPicker(ctx.store.openProjectFromPath, ctx.store.preferences.defaultProjectDirectory),
  },
  'global.saveProject': {
    reach: 'direct',
    reachNote: 'Header "Save project" icon button.',
    run: (ctx) => void ctx.store.saveProject(),
  },
  'global.saveProjectAs': {
    reach: 'direct',
    reachNote: 'Header "Save project as" icon button.',
    run: (ctx) => void saveProjectAsWithPicker(ctx.store.saveProjectAs, ctx.store.preferences.defaultProjectDirectory),
  },
  'global.importMedia': {
    reach: 'direct',
    reachNote: 'TimelineView toolbar "Import Media…" button.',
    run: (ctx) => void ctx.store.importAssetFromPath(),
  },
  'global.openSettings': {
    reach: 'direct',
    reachNote: 'Header "Open settings" icon button.',
    run: (ctx) => ctx.store.openSettings(),
  },
  'global.toggleFullscreen': {
    reach: 'accelerator',
    reachNote:
      'Honest gap, not a design choice: no titlebar/menu control calls this today (item 9 dissolves the header into ' +
      'the window chrome and is the natural place to add one). Flagged in the item-6 report rather than mislabeled.',
    run: () => void toggleAppFullscreen(),
  },
  'global.quitApp': {
    reach: 'accelerator',
    reachNote: "Same gap as toggleFullscreen — the custom titlebar's own close control (item 1/9 scope) isn't wired to this command yet.",
    run: () => void quitApplication(),
  },
  'global.undo': {
    reach: 'direct',
    reachNote: 'Header "Undo" icon button.',
    run: (ctx) => ctx.store.undo(),
    enabled: (ctx) => ctx.store.history.undoStack.length > 0,
  },
  'global.redo': {
    reach: 'direct',
    reachNote: 'Header "Redo" icon button.',
    run: (ctx) => ctx.store.redo(),
    enabled: (ctx) => ctx.store.history.redoStack.length > 0,
  },
  'global.redoAlt': {
    reach: 'direct',
    reachNote: 'Same as global.redo (Header "Redo" icon button) — this is a second key for the same action.',
    run: (ctx) => ctx.store.redo(),
    enabled: (ctx) => ctx.store.history.redoStack.length > 0,
  },
  'global.toggleView': {
    reach: 'direct',
    reachNote: 'Header "Timeline" / "Workflow" mode buttons set activeView directly.',
    run: (ctx) => ctx.store.setActiveView(ctx.store.ui.activeView === 'timeline' ? 'workflow' : 'timeline'),
  },
  'global.openShortcutsHelp': {
    reach: 'accelerator',
    reachNote: 'Conventional app-level help accelerator (F1 / ?); no menu currently opens the cheat sheet.',
    run: (ctx) => ctx.showShortcutsHelp(),
  },
  'global.openCommandPalette': {
    reach: 'accelerator',
    reachNote: 'The palette is the entry point being opened — by definition it cannot itself be a menu row inside that palette.',
    run: (ctx) => ctx.openCommandPalette(),
  },
  'global.openExportSheet': {
    reach: 'direct',
    reachNote: 'Status bar\'s "jobs" segment opens the same export sheet directly.',
    run: (ctx) => ctx.openExportSheet(),
  },
  'status.openConnectivityDrawer': {
    reach: 'direct',
    reachNote: 'Status bar\'s "compute" / "connectivity" segments open the same drawer directly.',
    run: (ctx) => ctx.openStatusDrawer('connectivity'),
  },
  'status.openAppUpdatesDrawer': {
    reach: 'direct',
    reachNote: 'Status bar\'s "Updates" segment opens the same drawer directly.',
    run: (ctx) => ctx.openStatusDrawer('appUpdates'),
  },
  'status.openWorkspaceDrawer': {
    reach: 'direct',
    reachNote: 'Status bar\'s "Workspace" segment opens the same drawer directly.',
    run: (ctx) => ctx.openStatusDrawer('workspace'),
  },
  'status.openAudioDrawer': {
    reach: 'direct',
    reachNote: 'Status bar\'s "Audio" segment opens the same drawer directly.',
    run: (ctx) => ctx.openStatusDrawer('audio'),
  },
  'timeline.selectAll': {
    reach: 'direct',
    reachNote: 'TimelineView toolbar "Select All" button.',
    run: (ctx) => ctx.store.selectAllTimelineClips(),
  },
  'timeline.copy': {
    reach: 'direct',
    reachNote: 'TimelineView toolbar "Copy" button.',
    run: (ctx) => ctx.store.copySelectedClips(),
    enabled: (ctx) => ctx.store.ui.selectedClipIds.length > 0 || ctx.store.ui.selectedClipId !== null,
  },
  'timeline.paste': {
    reach: 'direct',
    reachNote: 'TimelineView toolbar "Paste" button.',
    run: (ctx) => ctx.store.pasteTimelineClipboard(),
    enabled: (ctx) => ctx.store.ui.timelineClipboard.length > 0,
  },
  'timeline.playPause': {
    reach: 'direct',
    reachNote: 'TimelineView toolbar Play/Pause button.',
    run: (ctx) => ctx.store.togglePlayback(),
  },
  'timeline.shuttleReverse': {
    reach: 'direct',
    reachNote: 'TimelineView toolbar "Reverse" button.',
    run: (ctx) => ctx.store.shuttlePlayback('reverse'),
  },
  'timeline.pause': {
    reach: 'accelerator',
    reachNote: 'Classic JKL shuttle trio (spec H) — expert accelerator by design; togglePlayback\'s Play/Pause button covers the direct-manipulation case.',
    run: (ctx) => ctx.store.pausePlayback(),
  },
  'timeline.shuttleForward': {
    reach: 'accelerator',
    reachNote: 'Classic JKL shuttle trio (spec H) — expert accelerator by design, paired with the direct-manipulation "Reverse" button for the other direction.',
    run: (ctx) => ctx.store.shuttlePlayback('forward'),
  },
  'timeline.split': {
    reach: 'direct',
    reachNote: 'TimelineView toolbar "Split" button and the clip context menu\'s "Split at Playhead" row.',
    run: (ctx) => ctx.store.splitSelectedClip(),
  },
  'timeline.setInPoint': {
    reach: 'direct',
    reachNote: 'TimelineView "Set In" mini button.',
    run: (ctx) => ctx.store.setInPoint(),
  },
  'timeline.setOutPoint': {
    reach: 'direct',
    reachNote: 'TimelineView "Set Out" mini button.',
    run: (ctx) => ctx.store.setOutPoint(),
  },
  'timeline.clearInOut': {
    reach: 'direct',
    reachNote: 'TimelineView "Clear In/Out" mini button.',
    run: (ctx) => ctx.store.clearInOutPoints(),
  },
  'timeline.moveLeft': {
    reach: 'accelerator',
    reachNote: 'Frame-step transport accelerator (spec H "arrow = frame"); the scrub bar is the direct-manipulation equivalent for arbitrary positions.',
    run: (ctx) => ctx.store.movePlayhead(-1 / 30),
  },
  'timeline.moveRight': {
    reach: 'accelerator',
    reachNote: 'Frame-step transport accelerator; scrub bar is the direct-manipulation equivalent.',
    run: (ctx) => ctx.store.movePlayhead(1 / 30),
  },
  'timeline.moveLeftFast': {
    reach: 'accelerator',
    reachNote: '10-frame transport accelerator; scrub bar is the direct-manipulation equivalent.',
    run: (ctx) => ctx.store.movePlayhead(-10 / 30),
  },
  'timeline.moveRightFast': {
    reach: 'accelerator',
    reachNote: '10-frame transport accelerator; scrub bar is the direct-manipulation equivalent.',
    run: (ctx) => ctx.store.movePlayhead(10 / 30),
  },
  'timeline.goHome': {
    reach: 'direct',
    reachNote: 'TimelineView toolbar "Start" button.',
    run: (ctx) => ctx.store.setPlayhead(0),
  },
  'timeline.goEnd': {
    reach: 'direct',
    reachNote: 'TimelineView toolbar "End" button.',
    run: (ctx) => {
      const { project } = ctx.store
      const timelineEnd = Math.max(
        ...project.timeline.tracks.flatMap((track) => track.clips.map((clip) => clip.startTime + clip.duration)),
        project.timeline.outPoint ?? 0,
        0,
      )
      ctx.store.setPlayhead(timelineEnd)
    },
  },
  'timeline.moveClipUp': {
    reach: 'direct',
    reachNote: 'TimelineView track-move mini buttons.',
    run: (ctx) => ctx.store.moveSelectedClipToAdjacentTrack('up'),
  },
  'timeline.moveClipDown': {
    reach: 'direct',
    reachNote: 'TimelineView track-move mini buttons.',
    run: (ctx) => ctx.store.moveSelectedClipToAdjacentTrack('down'),
  },
  'timeline.zoomIn': {
    reach: 'direct',
    reachNote: 'TimelineView "Zoom +" mini button.',
    run: (ctx) => ctx.store.adjustTimelineZoom(0.25),
  },
  'timeline.zoomOut': {
    reach: 'direct',
    reachNote: 'TimelineView "Zoom -" mini button.',
    run: (ctx) => ctx.store.adjustTimelineZoom(-0.25),
  },
  'timeline.fitView': {
    reach: 'direct',
    reachNote: 'TimelineView "Fit" mini button.',
    run: (ctx) => ctx.store.fitTimelineToWindow(),
  },
  'workflow.selectAll': {
    reach: 'direct',
    reachNote: 'WorkflowView "Select All" action pill and the canvas context menu\'s "Select All Nodes" row.',
    run: (ctx) => ctx.store.selectAllWorkflowNodes(),
  },
  'workflow.copy': {
    reach: 'direct',
    reachNote: 'WorkflowView "Copy" action pill and the node context menu\'s "Copy Nodes" row.',
    run: (ctx) => ctx.store.copySelectedNodes(),
    enabled: (ctx) => ctx.store.ui.selectedNodeIds.length > 0 || ctx.store.ui.selectedNodeId !== null,
  },
  'workflow.paste': {
    reach: 'direct',
    reachNote: 'WorkflowView "Paste" action pill and the canvas context menu\'s "Paste Nodes" row.',
    run: (ctx) => ctx.store.pasteWorkflowClipboard(),
    enabled: (ctx) => ctx.store.ui.workflowClipboard.nodes.length > 0,
  },
  'workflow.groupSelection': {
    reach: 'direct',
    reachNote: 'WorkflowView "Group" action pill and the node context menu\'s "Group Selected Nodes" row.',
    run: (ctx) => ctx.store.groupSelectedWorkflowNodes(),
  },
  'workflow.openNodePicker': {
    reach: 'direct',
    reachNote: 'WorkflowView canvas "+" add-node button (and the empty-canvas state\'s "Add a generator" affordance).',
    run: (ctx) => ctx.store.openNodePicker(),
  },
  'workflow.fitView': {
    reach: 'direct',
    reachNote: 'WorkflowView "Fit to View" toolbar button and the canvas context menu\'s "Fit to View" row.',
    run: (ctx) => ctx.store.fitWorkflowViewport(),
  },
  'workflow.quickAddMedia': quickAddBehavior('media_source', 'Add media_source'),
  'workflow.quickAddCamera': quickAddBehavior('camera', 'Add camera'),
  'workflow.quickAddShader': quickAddBehavior('shader', 'Add shader'),
  'workflow.quickAddCompositor': quickAddBehavior('compositor', 'Add compositor'),
  'workflow.quickAddTransform': quickAddBehavior('transform', 'Add transform'),
  'workflow.quickAddColorCorrect': quickAddBehavior('color_correct', 'Add color_correct'),
  'workflow.quickAddAiGenerate': quickAddBehavior('ai_generate', 'Add ai_generate'),
  'workflow.quickAddAiUpscale': quickAddBehavior('ai_upscale', 'Add ai_upscale'),
  'workflow.quickAddOutput': quickAddBehavior('output', 'Add output'),
  'selection.delete': {
    reach: 'direct',
    reachNote: 'TimelineView toolbar "Delete" button and both context menus\' "Delete Clip"/"Delete Node" rows.',
    run: (ctx) => ctx.store.deleteSelected(),
    enabled: hasSelectionCtx,
  },
  'selection.duplicate': {
    reach: 'direct',
    reachNote: 'TimelineView toolbar "Duplicate" button and the node context menu\'s "Duplicate Node" row.',
    run: (ctx) => ctx.store.duplicateSelected(),
    enabled: hasSelectionCtx,
  },
  'lineage.followThread': {
    reach: 'direct',
    reachNote:
      'Clicking the linked node/clip directly (or its off-screen edge pill, which performs the identical jump — see ' +
      'followLineageThread.ts) reaches the same place; F is the keyboard shortcut for the same, already-visible relation.',
    run: () => followLineageThread(),
    enabled: (ctx) => ctx.store.ui.selectedClipId !== null || ctx.store.ui.selectedNodeId !== null,
  },
  'workspace.focusHorizonSplitter': {
    reach: 'direct',
    reachNote: 'Clicking the horizon splitter focuses it natively (it is a tabIndex=0 [role="separator"]).',
    run: () => resolveShellFocusTargets().splitter?.focus(),
  },
  'workspace.focusSky': {
    reach: 'direct',
    reachNote: 'Clicking any control inside the sky stratum focuses it the same way this verb does.',
    run: () => focusShellRegion(resolveShellFocusTargets().sky),
  },
  'workspace.focusStage': {
    reach: 'direct',
    reachNote: 'Clicking any control inside the stage row focuses it the same way this verb does.',
    run: () => focusShellRegion(resolveShellFocusTargets().stage),
  },
  'workspace.focusGround': {
    reach: 'direct',
    reachNote: 'Clicking any control inside the ground stratum focuses it the same way this verb does.',
    run: () => focusShellRegion(resolveShellFocusTargets().ground),
  },
}

function hasSelectionCtx(ctx: CommandContext): boolean {
  return hasSelection(ctx.store)
}

export const COMMAND_REGISTRY: CommandDefinition[] = SHORTCUT_DEFINITIONS.map((definition) => {
  const behavior = COMMAND_BEHAVIORS[definition.command]

  return {
    id: definition.command,
    title: definition.label,
    scope: definition.when,
    shortcut: getCommandBinding(DEFAULT_KEYBINDINGS, definition.command) ?? null,
    reach: behavior.reach,
    reachNote: behavior.reachNote,
    run: behavior.run,
    enabled: behavior.enabled,
  }
})

const COMMAND_BY_ID = new Map(COMMAND_REGISTRY.map((command) => [command.id, command]))

export function getCommand(id: ShortcutCommand): CommandDefinition | undefined {
  return COMMAND_BY_ID.get(id)
}

/** Shortcut label reflecting the user's LIVE keybindings (remaps), not just the shipped default. */
export function resolveLiveShortcut(id: ShortcutCommand, keybindings: readonly KeyBinding[]): KeyBinding | null {
  return getCommandBinding(keybindings as KeyBinding[], id) ?? null
}

export function isCommandEnabled(command: CommandDefinition, ctx: CommandContext): boolean {
  return command.enabled ? command.enabled(ctx) : true
}

// ---------------------------------------------------------------------------------------------
// Recency tracking (module-level, in-memory only — NOT persisted, so it never touches the store
// contract or project file format). Feeds the palette's "most-recent-first" tiebreak (spec H).
// ---------------------------------------------------------------------------------------------

const MAX_RECENT_COMMANDS = 20
let recentCommandIds: ShortcutCommand[] = []

function recordCommandUse(id: ShortcutCommand): void {
  recentCommandIds = [id, ...recentCommandIds.filter((existing) => existing !== id)].slice(0, MAX_RECENT_COMMANDS)
}

export function getRecentCommandIds(): readonly ShortcutCommand[] {
  return recentCommandIds
}

export interface RunCommandOptions {
  /**
   * Skip the `enabled()` gate and always invoke `run()` when the id resolves. `enabled()` is a
   * PALETTE-ONLY affordance (spec H: grey out a row, with a cheap reason) — it was never part of
   * the pre-item-6 keyboard dispatch, which called store actions unconditionally and let each
   * action's own logic decide what a no-op looks like (e.g. `followLineageThread()` sets a
   * status-hint message when nothing is selected rather than doing nothing at all). Gating
   * keyboard dispatch on `enabled()` would silently swallow that feedback — a real behavior
   * regression, not a cosmetic one — so `useKeyboardShortcuts` always passes `skipEnabledCheck:
   * true`. `CommandPalette` leaves this false (default): a disabled row is already prevented from
   * being activated in the UI, so the gate here is just defense in depth.
   */
  skipEnabledCheck?: boolean
}

/**
 * Runs a command by id through the registry — the single dispatch entry point used by
 * `useKeyboardShortcuts`, `CommandPalette`, and any registry-driven context menu row. Silently
 * no-ops on an unknown id (callers that need to know *why* should check `getCommand`/
 * `isCommandEnabled` themselves before calling, e.g. to grey out a palette row).
 */
export function runCommand(id: ShortcutCommand, ctx: CommandContext, options: RunCommandOptions = {}): void {
  const command = getCommand(id)

  if (!command) {
    return
  }

  if (!options.skipEnabledCheck && !isCommandEnabled(command, ctx)) {
    return
  }

  recordCommandUse(id)
  command.run(ctx)
}
