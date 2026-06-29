import { createDefaultProject } from '../../domain/project/defaults'
import type {
  AutosaveSnapshot,
  FluxNodeProject,
  RecentProject,
  RecentProjectsStore,
  WalEntry,
} from '../../domain/project/types'
import type { ProjectRepository } from './project-repository'

const PROJECTS_KEY = 'fluxnode.projects.byPath'
const AUTOSAVES_KEY = 'fluxnode.autosaves.byPath'
const WAL_KEY = 'fluxnode.wal.byPath'
const RECENTS_KEY = 'fluxnode.recentProjects'
const CURRENT_PATH_KEY = 'fluxnode.currentProjectPath'
const SNAPSHOT_LIMIT = 10

type ProjectMap = Record<string, FluxNodeProject>
type AutosaveMap = Record<string, AutosaveSnapshot[]>
type WalMap = Record<string, WalEntry[]>

export class LocalProjectRepository implements ProjectRepository {
  async load(): Promise<FluxNodeProject | null> {
    const currentPath = await this.getCurrentProjectPath()

    if (!currentPath) {
      return createDefaultProject()
    }

    return this.loadFromPath(currentPath)
  }

  async loadFromPath(path: string): Promise<FluxNodeProject | null> {
    const normalizedPath = normalizeLocalPath(path)
    const projects = this.readProjects()
    const walEntries = this.readWalMap()[normalizedPath] ?? []
    const walSnapshot = walEntries.at(-1)?.projectSnapshot

    if (walSnapshot) {
      normalizeLoadedProject(walSnapshot)
      this.setCurrentPath(normalizedPath)
      await this.markProjectOpened(walSnapshot)
      return walSnapshot
    }

    const project = projects[normalizedPath] ?? null

    if (project) {
      normalizeLoadedProject(project)
      this.setCurrentPath(normalizedPath)
      await this.markProjectOpened(project)
      return project
    }

    return null
  }

  async save(project: FluxNodeProject): Promise<void> {
    const currentPath = (await this.getCurrentProjectPath()) ?? defaultLocalPath(project)
    await this.saveAs(currentPath, project)
  }

  async saveAs(path: string, project: FluxNodeProject): Promise<void> {
    const normalizedPath = normalizeLocalPath(path)
    const projects = this.readProjects()
    projects[normalizedPath] = project
    window.localStorage.setItem(PROJECTS_KEY, JSON.stringify(projects))
    this.setCurrentPath(normalizedPath)
    await this.markProjectOpened(project)
    this.clearWal(normalizedPath)
  }

  async autosave(project: FluxNodeProject): Promise<AutosaveSnapshot> {
    const currentPath = (await this.getCurrentProjectPath()) ?? defaultLocalPath(project)
    const snapshot: AutosaveSnapshot = {
      id: `snapshot-${Date.now()}`,
      timestamp: new Date().toISOString(),
      project,
    }

    const autosaves = this.readAutosaveMap()
    const nextSnapshots = [...(autosaves[currentPath] ?? []), snapshot].slice(-SNAPSHOT_LIMIT)
    autosaves[currentPath] = nextSnapshots
    window.localStorage.setItem(AUTOSAVES_KEY, JSON.stringify(autosaves))
    return snapshot
  }

  async appendWal(entry: WalEntry): Promise<void> {
    const currentPath = (await this.getCurrentProjectPath()) ?? defaultLocalPath(entry.projectSnapshot ?? createDefaultProject())
    const walMap = this.readWalMap()
    walMap[currentPath] = [...(walMap[currentPath] ?? []), entry]
    window.localStorage.setItem(WAL_KEY, JSON.stringify(walMap))
  }

  async loadRecentProjects(): Promise<RecentProject[]> {
    const serialized = window.localStorage.getItem(RECENTS_KEY)

    if (!serialized) {
      return []
    }

    try {
      const store = JSON.parse(serialized) as RecentProjectsStore
      return store.projects
    } catch {
      return []
    }
  }

  async markProjectOpened(project: FluxNodeProject): Promise<void> {
    const path = (await this.getCurrentProjectPath()) ?? defaultLocalPath(project)
    const existing = await this.loadRecentProjects()
    const nextProject: RecentProject = {
      path,
      name: project.meta.name,
      lastOpened: new Date().toISOString(),
      thumbnailPath: project.meta.thumbnailPath,
    }

    const deduped = existing.filter((item) => item.path !== nextProject.path)
    const store: RecentProjectsStore = {
      projects: [nextProject, ...deduped].slice(0, 20),
    }

    window.localStorage.setItem(RECENTS_KEY, JSON.stringify(store))
  }

  async getCurrentProjectPath(): Promise<string | null> {
    return window.localStorage.getItem(CURRENT_PATH_KEY)
  }

  async createProjectAtPath(path: string, project: FluxNodeProject): Promise<string> {
    const normalizedPath = normalizeLocalPath(path)
    await this.saveAs(normalizedPath, project)
    return normalizedPath
  }

  private readProjects(): ProjectMap {
    const serialized = window.localStorage.getItem(PROJECTS_KEY)

    if (!serialized) {
      return {}
    }

    try {
      return JSON.parse(serialized) as ProjectMap
    } catch {
      return {}
    }
  }

  private readAutosaveMap(): AutosaveMap {
    const serialized = window.localStorage.getItem(AUTOSAVES_KEY)

    if (!serialized) {
      return {}
    }

    try {
      return JSON.parse(serialized) as AutosaveMap
    } catch {
      return {}
    }
  }

  private readWalMap(): WalMap {
    const serialized = window.localStorage.getItem(WAL_KEY)

    if (!serialized) {
      return {}
    }

    try {
      return JSON.parse(serialized) as WalMap
    } catch {
      return {}
    }
  }

  private clearWal(path: string) {
    const walMap = this.readWalMap()
    delete walMap[path]
    window.localStorage.setItem(WAL_KEY, JSON.stringify(walMap))
  }

  private setCurrentPath(path: string) {
    window.localStorage.setItem(CURRENT_PATH_KEY, path)
  }
}

function normalizeLocalPath(path: string) {
  return path.startsWith('browser-local://') ? path : `browser-local://${path.replace(/\\/g, '/')}`
}

function defaultLocalPath(project: FluxNodeProject) {
  return `browser-local://${project.meta.id}.fluxnode`
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
}
