import type { FluxNodeProject } from '../project/types'

export interface HistoryCommand {
  id: string
  type: string
  label: string
  timestamp: number
  before: FluxNodeProject
  after: FluxNodeProject
  entries?: HistoryCommand[]
}
