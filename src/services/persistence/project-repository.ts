import type {
  AutosaveSnapshot,
  FluxNodeProject,
  RecentProject,
  WalEntry,
} from '../../domain/project/types'

export interface ProjectRepository {
  load(): Promise<FluxNodeProject | null>
  loadFromPath(path: string): Promise<FluxNodeProject | null>
  save(project: FluxNodeProject): Promise<void>
  saveAs(path: string, project: FluxNodeProject): Promise<void>
  autosave(project: FluxNodeProject): Promise<AutosaveSnapshot>
  appendWal(entry: WalEntry): Promise<void>
  loadRecentProjects(): Promise<RecentProject[]>
  markProjectOpened(project: FluxNodeProject): Promise<void>
  getCurrentProjectPath(): Promise<string | null>
  createProjectAtPath(path: string, project: FluxNodeProject): Promise<string>
}
