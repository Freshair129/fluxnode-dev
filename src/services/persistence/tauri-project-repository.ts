import type {
  AutosaveSnapshot,
  FluxNodeProject,
  RecentProject,
  WalEntry,
} from '../../domain/project/types'
import { invokeCommand } from '../ipc/tauri-commands'
import type { ProjectRepository } from './project-repository'

export class TauriProjectRepository implements ProjectRepository {
  async load(): Promise<FluxNodeProject | null> {
    const response = await invokeCommand<string | null>('load_project_state')
    return response ? normalizeLoadedProject(JSON.parse(response) as FluxNodeProject) : null
  }

  async loadFromPath(path: string): Promise<FluxNodeProject | null> {
    const response = await invokeCommand<string | null>('open_project_at_path', { path })
    return response ? normalizeLoadedProject(JSON.parse(response) as FluxNodeProject) : null
  }

  async save(project: FluxNodeProject): Promise<void> {
    await invokeCommand('save_project_state', {
      projectJson: JSON.stringify(project),
    })
  }

  async saveAs(path: string, project: FluxNodeProject): Promise<void> {
    await invokeCommand('save_project_state_as', {
      path,
      projectJson: JSON.stringify(project),
    })
  }

  async autosave(project: FluxNodeProject): Promise<AutosaveSnapshot> {
    const response = await invokeCommand<string>('autosave_project_state', {
      projectJson: JSON.stringify(project),
    })
    return JSON.parse(response) as AutosaveSnapshot
  }

  async appendWal(entry: WalEntry): Promise<void> {
    await invokeCommand('append_wal_entry', {
      entryJson: JSON.stringify(entry),
    })
  }

  async loadRecentProjects(): Promise<RecentProject[]> {
    const response = await invokeCommand<string>('load_recent_projects')
    return JSON.parse(response) as RecentProject[]
  }

  async markProjectOpened(project: FluxNodeProject): Promise<void> {
    await invokeCommand('mark_project_opened', {
      projectJson: JSON.stringify(project),
    })
  }

  async getCurrentProjectPath(): Promise<string | null> {
    const response = await invokeCommand<string | null>('get_current_project_path')
    return response
  }

  async createProjectAtPath(path: string, project: FluxNodeProject): Promise<string> {
    const response = await invokeCommand<string>('create_project_at_path', {
      path,
      projectJson: JSON.stringify(project),
    })
    return response
  }
}

function normalizeLoadedProject(project: FluxNodeProject) {
  if (project.meta.section11TargetProfileOverride !== null && typeof project.meta.section11TargetProfileOverride !== 'string') {
    project.meta.section11TargetProfileOverride = null
  }

  if (!Array.isArray(project.meta.section11ProofHistory)) {
    project.meta.section11ProofHistory = []
  }

  if (!Array.isArray(project.meta.section11CoverageMapHistory)) {
    project.meta.section11CoverageMapHistory = []
  }

  if (!Array.isArray(project.meta.section11CapturePacketHistory)) {
    project.meta.section11CapturePacketHistory = []
  }

  return project
}
