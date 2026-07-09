import type { HistoryCommand } from './command'

const HISTORY_LIMIT = 200

export interface PendingHistoryGroup {
  id: string
  type: string
  label: string
  timestamp: number
  entries: HistoryCommand[]
}

export interface HistoryState {
  undoStack: HistoryCommand[]
  redoStack: HistoryCommand[]
  pendingGroup: PendingHistoryGroup | null
}

export function createHistoryState(): HistoryState {
  return {
    undoStack: [],
    redoStack: [],
    pendingGroup: null,
  }
}

export function pushCommand(history: HistoryState, command: HistoryCommand): HistoryState {
  if (history.pendingGroup) {
    return {
      ...history,
      pendingGroup: {
        ...history.pendingGroup,
        entries: [...history.pendingGroup.entries, command],
      },
      redoStack: [],
    }
  }

  const undoStack = [...history.undoStack, command].slice(-HISTORY_LIMIT)

  return {
    ...history,
    undoStack,
    redoStack: [],
  }
}

export function beginHistoryGroup(
  history: HistoryState,
  type: string,
  label: string,
  groupId: string,
): HistoryState {
  return {
    ...history,
    redoStack: [],
    pendingGroup: {
      id: groupId,
      type,
      label,
      timestamp: Date.now(),
      entries: [],
    },
  }
}

/**
 * Finalizes a pending group into a single HistoryCommand whose patches/inversePatches
 * are the composition of every step recorded in the group. `patches` (forward, used for
 * redo) are concatenated in step order; `inversePatches` (used for undo) are concatenated
 * in reverse step order so that applying them sequentially unwinds the group correctly.
 */
export function endHistoryGroup(history: HistoryState): HistoryState {
  const pendingGroup = history.pendingGroup

  if (!pendingGroup) {
    return history
  }

  if (pendingGroup.entries.length === 0) {
    return {
      ...history,
      pendingGroup: null,
    }
  }

  const patches = pendingGroup.entries.flatMap((entry) => entry.patches)
  const inversePatches = [...pendingGroup.entries].reverse().flatMap((entry) => entry.inversePatches)

  const groupedCommand: HistoryCommand = {
    id: pendingGroup.id,
    type: pendingGroup.type,
    label: pendingGroup.label,
    timestamp: pendingGroup.timestamp,
    patches,
    inversePatches,
    entries: pendingGroup.entries,
  }

  return {
    undoStack: [...history.undoStack, groupedCommand].slice(-HISTORY_LIMIT),
    redoStack: [],
    pendingGroup: null,
  }
}

export function popUndo(history: HistoryState) {
  const command = history.undoStack.at(-1)

  if (!command) {
    return null
  }

  return {
    command,
    history: {
      undoStack: history.undoStack.slice(0, -1),
      redoStack: [...history.redoStack, command],
      pendingGroup: history.pendingGroup,
    } satisfies HistoryState,
  }
}

export function popRedo(history: HistoryState) {
  const command = history.redoStack.at(-1)

  if (!command) {
    return null
  }

  return {
    command,
    history: {
      undoStack: [...history.undoStack, command],
      redoStack: history.redoStack.slice(0, -1),
      pendingGroup: history.pendingGroup,
    } satisfies HistoryState,
  }
}
