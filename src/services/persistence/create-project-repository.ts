import { isTauriRuntime } from '../ipc/tauri-runtime'
import { LocalProjectRepository } from './local-project-repository'
import type { ProjectRepository } from './project-repository'
import { TauriProjectRepository } from './tauri-project-repository'

export function createProjectRepository(): ProjectRepository {
  return isTauriRuntime() ? new TauriProjectRepository() : new LocalProjectRepository()
}
