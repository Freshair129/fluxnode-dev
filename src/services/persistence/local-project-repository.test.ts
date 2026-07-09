import { enablePatches, produceWithPatches } from 'immer'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createDefaultProject } from '../../domain/project/defaults'
import type { FluxNodeProject, WalEntry } from '../../domain/project/types'
import {
  LocalProjectRepository,
  LocalStorageQuotaError,
  WAL_LIMIT,
  WAL_QUOTA_FALLBACK_LIMIT,
} from './local-project-repository'

enablePatches()

// Minimal in-memory localStorage. `onSetItem` lets individual tests simulate quota errors.
function installLocalStorage(onSetItem?: (key: string, value: string) => void) {
  const store = new Map<string, string>()

  vi.stubGlobal('window', {
    localStorage: {
      getItem: (key: string) => (store.has(key) ? store.get(key)! : null),
      setItem: (key: string, value: string) => {
        onSetItem?.(key, value)
        store.set(key, value)
      },
      removeItem: (key: string) => store.delete(key),
    },
  })

  return store
}

function defaultLocalPath(project: FluxNodeProject) {
  return `browser-local://${project.meta.id}.fluxnode`
}

/** Builds a chain of `count` incremental mutations to `project.timeline.playhead`, returning
 * the WalEntry payloads a store's applyMutation would send (full project ref + forward patches)
 * alongside the final project. */
function buildWalEntryChain(project: FluxNodeProject, count: number) {
  const entries: Array<{ id: string; timestamp: string; type: string; label: string; project: FluxNodeProject; patches: WalEntry['patches'] }> = []
  let current = project

  for (let index = 1; index <= count; index += 1) {
    const [next, patches] = produceWithPatches(current, (draft) => {
      ;(draft as FluxNodeProject).timeline.playhead = index
    })
    current = next
    entries.push({
      id: `cmd-${index}`,
      timestamp: new Date(index).toISOString(),
      type: 'timeline.playhead.set',
      label: 'Playhead positioned',
      project: current,
      patches,
    })
  }

  return { entries, finalProject: current }
}

describe('LocalProjectRepository: WAL bounding', () => {
  beforeEach(() => {
    installLocalStorage()
  })

  it('caps the WAL ring buffer at WAL_LIMIT entries per path even after many appends', async () => {
    const repo = new LocalProjectRepository()
    const project = createDefaultProject()
    const appendCount = WAL_LIMIT + 25
    const { entries } = buildWalEntryChain(project, appendCount)

    for (const entry of entries) {
      await repo.appendWal({
        id: entry.id,
        timestamp: entry.timestamp,
        type: entry.type,
        label: entry.label,
        projectSnapshot: entry.project,
        patches: entry.patches,
      })
    }

    const raw = window.localStorage.getItem('fluxnode.wal.byPath')
    expect(raw).toBeTruthy()
    const parsed = JSON.parse(raw!) as Record<string, { seq: number; entries: WalEntry[] }>
    const bucket = parsed[defaultLocalPath(project)]

    expect(bucket).toBeTruthy()
    expect(bucket.entries.length).toBeLessThanOrEqual(WAL_LIMIT)
    // seq is a monotonically increasing counter that survives trimming.
    expect(bucket.seq).toBe(appendCount)
  })

  it('reconstructs the exact latest project from a trimmed WAL via loadFromPath', async () => {
    const repo = new LocalProjectRepository()
    const project = createDefaultProject()
    const appendCount = WAL_LIMIT + 25
    const { entries, finalProject } = buildWalEntryChain(project, appendCount)

    for (const entry of entries) {
      await repo.appendWal({
        id: entry.id,
        timestamp: entry.timestamp,
        type: entry.type,
        label: entry.label,
        projectSnapshot: entry.project,
        patches: entry.patches,
      })
    }

    const loaded = await repo.loadFromPath(defaultLocalPath(project))
    expect(loaded).toBeTruthy()
    expect(loaded!.timeline.playhead).toBe(appendCount)
    expect(loaded).toEqual(finalProject)
  })

  it('saveAs / autosave truncate the WAL for that path', async () => {
    const repo = new LocalProjectRepository()
    const project = createDefaultProject()
    const { entries } = buildWalEntryChain(project, 5)

    for (const entry of entries) {
      await repo.appendWal({
        id: entry.id,
        timestamp: entry.timestamp,
        type: entry.type,
        label: entry.label,
        projectSnapshot: entry.project,
        patches: entry.patches,
      })
    }

    await repo.saveAs(defaultLocalPath(project), entries.at(-1)!.project)

    const raw = window.localStorage.getItem('fluxnode.wal.byPath')
    const parsed = JSON.parse(raw!) as Record<string, unknown>
    expect(parsed[defaultLocalPath(project)]).toBeUndefined()

    await repo.appendWal({
      id: 'cmd-after-save',
      timestamp: new Date().toISOString(),
      type: 'timeline.playhead.set',
      label: 'Playhead positioned',
      projectSnapshot: entries.at(-1)!.project,
      patches: [],
    })
    await repo.autosave(entries.at(-1)!.project)

    const rawAfterAutosave = window.localStorage.getItem('fluxnode.wal.byPath')
    const parsedAfterAutosave = JSON.parse(rawAfterAutosave!) as Record<string, unknown>
    expect(parsedAfterAutosave[defaultLocalPath(project)]).toBeUndefined()
  })
})

describe('LocalProjectRepository: localStorage quota handling', () => {
  it('trims aggressively and succeeds when the first write hits quota but a retry fits', async () => {
    let failNextWrite = false
    const setItemCalls: string[] = []
    installLocalStorage((key) => {
      setItemCalls.push(key)
      if (key === 'fluxnode.wal.byPath' && failNextWrite) {
        failNextWrite = false
        throw new DOMException('quota exceeded', 'QuotaExceededError')
      }
    })

    const repo = new LocalProjectRepository()
    const project = createDefaultProject()
    const { entries } = buildWalEntryChain(project, 12)

    for (const entry of entries.slice(0, -1)) {
      await repo.appendWal({
        id: entry.id,
        timestamp: entry.timestamp,
        type: entry.type,
        label: entry.label,
        projectSnapshot: entry.project,
        patches: entry.patches,
      })
    }

    failNextWrite = true
    const lastEntry = entries.at(-1)!
    await expect(
      repo.appendWal({
        id: lastEntry.id,
        timestamp: lastEntry.timestamp,
        type: lastEntry.type,
        label: lastEntry.label,
        projectSnapshot: lastEntry.project,
        patches: lastEntry.patches,
      }),
    ).resolves.toBeUndefined()

    const raw = window.localStorage.getItem('fluxnode.wal.byPath')
    const parsed = JSON.parse(raw!) as Record<string, { seq: number; entries: WalEntry[] }>
    const bucket = parsed[defaultLocalPath(project)]
    expect(bucket.entries.length).toBeLessThanOrEqual(WAL_QUOTA_FALLBACK_LIMIT)

    // The trimmed buffer must still be reconstructible (rebased to a synthetic snapshot).
    const loaded = await repo.loadFromPath(defaultLocalPath(project))
    expect(loaded!.timeline.playhead).toBe(12)
  })

  it('surfaces a real LocalStorageQuotaError instead of silently swallowing when even the retry fails', async () => {
    installLocalStorage(() => {
      throw new DOMException('quota exceeded', 'QuotaExceededError')
    })

    const repo = new LocalProjectRepository()
    const project = createDefaultProject()

    await expect(
      repo.appendWal({
        id: 'cmd-1',
        timestamp: new Date().toISOString(),
        type: 'timeline.playhead.set',
        label: 'Playhead positioned',
        projectSnapshot: project,
        patches: [],
      }),
    ).rejects.toBeInstanceOf(LocalStorageQuotaError)
  })
})

describe('LocalProjectRepository: save -> load fidelity', () => {
  beforeEach(() => {
    installLocalStorage()
  })

  it('round-trips a project through saveAs/loadFromPath unchanged', async () => {
    const repo = new LocalProjectRepository()
    const project = createDefaultProject()
    const path = 'my-project.fluxnode'

    const normalizedPath = await repo.createProjectAtPath(path, project)
    const loaded = await repo.loadFromPath(normalizedPath)

    expect(loaded).toEqual(project)
  })
})
