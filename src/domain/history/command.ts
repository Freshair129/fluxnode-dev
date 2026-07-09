import type { Patch } from 'immer'

/**
 * A history entry stores the immer patches needed to move forward (`patches`)
 * or backward (`inversePatches`) instead of full project snapshots. This keeps
 * the undo stack proportional to the size of each edit rather than the size
 * of the whole project, which matters once HISTORY_LIMIT (200) entries have
 * accumulated.
 */
export interface HistoryCommand {
  id: string
  type: string
  label: string
  timestamp: number
  patches: Patch[]
  inversePatches: Patch[]
  entries?: HistoryCommand[]
}
