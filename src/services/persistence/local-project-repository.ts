import { applyPatches, enablePatches } from 'immer'
import { nextId } from '../../domain/id'
import { createDefaultProject } from '../../domain/project/defaults'
import type {
  AutosaveSnapshot,
  FluxNodeProject,
  RecentProject,
  RecentProjectsStore,
  WalEntry,
} from '../../domain/project/types'
import { migrateProject } from './migrate-project'
import type { ProjectRepository } from './project-repository'

// Idempotent (immer's loadPlugin no-ops if already registered) — this module can be
// imported/tested independently of project-store.ts, which also enables patches.
enablePatches()

const PROJECTS_KEY = 'fluxnode.projects.byPath'
const AUTOSAVES_KEY = 'fluxnode.autosaves.byPath'
const WAL_KEY = 'fluxnode.wal.byPath'
const RECENTS_KEY = 'fluxnode.recentProjects'
const CURRENT_PATH_KEY = 'fluxnode.currentProjectPath'
const SNAPSHOT_LIMIT = 10

// WAL is a bounded ring buffer: at most WAL_LIMIT entries are kept per project path.
// Every WAL_SNAPSHOT_INTERVAL-th entry (by monotonically increasing sequence number,
// which survives trimming) embeds a full project snapshot; the rest carry only immer
// patches relative to the previous WAL state. Because WAL_SNAPSHOT_INTERVAL < WAL_LIMIT,
// any trimmed window of the ring buffer is guaranteed to still contain at least one
// snapshot to reconstruct from, so we never need to re-baseline on trim.
// Exported (only) so tests can assert bounding behavior without hardcoding magic numbers.
export const WAL_LIMIT = 50
export const WAL_SNAPSHOT_INTERVAL = 10
// If a write still exceeds quota after a normal append, fall back to this much smaller
// window (re-based to a synthesized full snapshot) before giving up.
export const WAL_QUOTA_FALLBACK_LIMIT = 10

type ProjectMap = Record<string, FluxNodeProject>
type AutosaveMap = Record<string, AutosaveSnapshot[]>
interface WalBucket {
  seq: number
  entries: WalEntry[]
}
type WalMap = Record<string, WalBucket>

export class LocalStorageQuotaError extends Error {
  constructor(message: string, cause?: unknown) {
    super(message, { cause })
    this.name = 'LocalStorageQuotaError'
  }
}

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
    const walBucket = this.readWalMap()[normalizedPath]
    const walProject = reconstructProjectFromWal(walBucket?.entries ?? [])

    if (walProject) {
      migrateProject(walProject)
      this.setCurrentPath(normalizedPath)
      await this.markProjectOpened(walProject)
      return walProject
    }

    const project = projects[normalizedPath] ?? null

    if (project) {
      migrateProject(project)
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
      id: nextId('snapshot'),
      timestamp: new Date().toISOString(),
      project,
    }

    const autosaves = this.readAutosaveMap()
    const nextSnapshots = [...(autosaves[currentPath] ?? []), snapshot].slice(-SNAPSHOT_LIMIT)
    autosaves[currentPath] = nextSnapshots
    window.localStorage.setItem(AUTOSAVES_KEY, JSON.stringify(autosaves))
    // Autosave means the durable copy is now current, so the crash-recovery WAL for this
    // path can be truncated too (previously only saveAs() did this, leaving the WAL to grow
    // unbounded across a long session of nothing but autosaves).
    this.clearWal(currentPath)
    return snapshot
  }

  async appendWal(entry: WalEntry): Promise<void> {
    const currentPath = (await this.getCurrentProjectPath()) ?? defaultLocalPath(entry.projectSnapshot ?? createDefaultProject())
    const walMap = this.readWalMap()
    const bucket = walMap[currentPath] ?? { seq: 0, entries: [] }
    const seq = bucket.seq + 1
    const shouldEmbedSnapshot = seq % WAL_SNAPSHOT_INTERVAL === 1

    const storedEntry: WalEntry = shouldEmbedSnapshot
      ? { id: entry.id, timestamp: entry.timestamp, type: entry.type, label: entry.label, projectSnapshot: entry.projectSnapshot }
      : { id: entry.id, timestamp: entry.timestamp, type: entry.type, label: entry.label, patches: entry.patches }

    const nextEntries = [...bucket.entries, storedEntry].slice(-WAL_LIMIT)
    walMap[currentPath] = { seq, entries: nextEntries }

    try {
      this.writeWalMap(walMap)
    } catch (error) {
      if (!isQuotaExceededError(error)) {
        throw error
      }

      // Trim aggressively: keep only the most recent WAL_QUOTA_FALLBACK_LIMIT entries,
      // re-based to a synthesized full snapshot of the state as of the trim point (using
      // whatever WAL history we already had in memory) so the shortened buffer is still
      // self-sufficient for crash recovery.
      const trimmed = rebaseWalEntries(nextEntries, WAL_QUOTA_FALLBACK_LIMIT)
      walMap[currentPath] = { seq, entries: trimmed }

      try {
        this.writeWalMap(walMap)
      } catch (retryError) {
        // Give up rather than silently drop the write: surface a real, typed error so
        // callers can inform the user instead of the previous fire-and-forget `void`.
        throw new LocalStorageQuotaError(
          'Local storage quota exceeded while appending to the crash-recovery log; the last change was not journaled.',
          retryError,
        )
      }
    }
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
      const parsed = JSON.parse(serialized) as Record<string, WalEntry[] | WalBucket>
      const normalized: WalMap = {}

      for (const [path, value] of Object.entries(parsed)) {
        // Back-compat: older builds stored a bare WalEntry[] per path.
        normalized[path] = Array.isArray(value) ? { seq: value.length, entries: value } : value
      }

      return normalized
    } catch {
      return {}
    }
  }

  private writeWalMap(walMap: WalMap) {
    window.localStorage.setItem(WAL_KEY, JSON.stringify(walMap))
  }

  private clearWal(path: string) {
    const walMap = this.readWalMap()
    delete walMap[path]
    this.writeWalMap(walMap)
  }

  private setCurrentPath(path: string) {
    window.localStorage.setItem(CURRENT_PATH_KEY, path)
  }
}

function isQuotaExceededError(error: unknown): boolean {
  if (typeof DOMException !== 'undefined' && error instanceof DOMException) {
    return error.name === 'QuotaExceededError' || error.code === 22 || error.code === 1014
  }

  return error instanceof Error && error.name === 'QuotaExceededError'
}

/**
 * Reconstructs the latest project state described by a WAL entry list: finds the most
 * recent embedded snapshot (scanning backward) and replays subsequent entries' forward
 * patches on top of it via immer's applyPatches. Returns null if no snapshot is present
 * (e.g. an empty WAL).
 */
function reconstructProjectFromWal(entries: WalEntry[]): FluxNodeProject | null {
  let baseIndex = -1

  for (let index = entries.length - 1; index >= 0; index -= 1) {
    if (entries[index].projectSnapshot) {
      baseIndex = index
      break
    }
  }

  if (baseIndex === -1) {
    return null
  }

  let project = entries[baseIndex].projectSnapshot as FluxNodeProject

  for (let index = baseIndex + 1; index < entries.length; index += 1) {
    const patches = entries[index].patches
    if (patches && patches.length > 0) {
      project = applyPatches(project, patches)
    }
  }

  return project
}

/** Trims entries down to `limit`, synthesizing a full snapshot at the new head so the result is self-sufficient. */
function rebaseWalEntries(entries: WalEntry[], limit: number): WalEntry[] {
  if (entries.length <= limit) {
    return entries
  }

  const cut = entries.length - limit
  const rebasedProject = reconstructProjectFromWal(entries.slice(0, cut + 1))
  const tail = entries.slice(cut + 1)

  if (!rebasedProject) {
    // No snapshot to rebase from at all (shouldn't happen given WAL_SNAPSHOT_INTERVAL <
    // WAL_LIMIT, but fall back to a plain trim rather than throwing).
    return entries.slice(cut)
  }

  const headEntry = entries[cut]
  const syntheticHead: WalEntry = {
    id: headEntry.id,
    timestamp: headEntry.timestamp,
    type: headEntry.type,
    label: headEntry.label,
    projectSnapshot: rebasedProject,
  }

  return [syntheticHead, ...tail]
}

function normalizeLocalPath(path: string) {
  return path.startsWith('browser-local://') ? path : `browser-local://${path.replace(/\\/g, '/')}`
}

function defaultLocalPath(project: FluxNodeProject) {
  return `browser-local://${project.meta.id}.fluxnode`
}
