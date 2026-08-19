import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import type { useProjectStore as UseProjectStoreType } from './project-store'
import type { RenderJob, RenderJobStatus } from '../domain/project/types'

// The unavoidable mock: polling a render status crosses the Tauri IPC boundary. Everything
// either side of it is the real store.
const { pollRenderJobStatusMock } = vi.hoisted(() => ({ pollRenderJobStatusMock: vi.fn() }))
vi.mock('../services/ipc/render-job', () => ({
  pollRenderJobStatus: pollRenderJobStatusMock,
  startRenderJob: vi.fn(),
  cancelRenderJob: vi.fn(),
  pauseRenderJob: vi.fn(),
  resumeRenderJob: vi.fn(),
  retryRenderJob: vi.fn(),
}))

function installBrowserGlobals() {
  const localStorageData = new Map<string, string>()
  vi.stubGlobal('window', {
    localStorage: {
      getItem: (key: string) => (localStorageData.has(key) ? localStorageData.get(key)! : null),
      setItem: (key: string, value: string) => {
        localStorageData.set(key, value)
      },
      removeItem: (key: string) => {
        localStorageData.delete(key)
      },
    },
    setTimeout: (...args: Parameters<typeof setTimeout>) => setTimeout(...args),
    clearTimeout: (handle: ReturnType<typeof setTimeout>) => clearTimeout(handle),
    setInterval: (...args: Parameters<typeof setInterval>) => setInterval(...args),
    clearInterval: (handle: ReturnType<typeof setInterval>) => clearInterval(handle),
    addEventListener: () => {},
    removeEventListener: () => {},
    // openPathInShell reveals a finished export; stubbed so a completed-status tick stays quiet.
    open: () => null,
  })
  vi.stubGlobal('navigator', { onLine: true })
}

async function loadStore() {
  vi.resetModules()
  installBrowserGlobals()
  const mod = (await import('./project-store')) as { useProjectStore: typeof UseProjectStoreType }
  return mod.useProjectStore
}

const job = (overrides: Partial<RenderJob> = {}): RenderJob => ({
  id: 'render-1',
  name: 'test export',
  config: {
    outputPath: 'out.mp4',
    format: { container: 'mp4', videoCodec: 'h264', audioCodec: 'aac', quality: 'high' },
    resolution: { width: 1920, height: 1080 },
    frameRate: 30,
    range: 'full',
    useProxy: false,
    denoising: false,
    metadata: { title: null, comment: null },
  },
  format: 'mp4',
  progress: 0,
  status: 'rendering',
  computeMode: 'local',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  outputPath: 'out.mp4',
  manifestPath: null,
  currentFrame: 0,
  totalFrames: 100,
  completedAt: null,
  estimatedTimeRemaining: null,
  outputFileSize: null,
  errorCategory: null,
  lastError: null,
  failedFrame: null,
  resumeFromFrame: null,
  quotaResetAt: null,
  quotaUsageSummary: null,
  retryCount: 0,
  maxAutoRetries: 0,
  lastRetryAt: null,
  autoRetryReason: null,
  autoRetryScheduledFor: null,
  didFallbackResolution: false,
  originalResolution: null,
  audioMode: 'muxed',
  audioSourceSummary: '',
  outputRevealedAt: null,
  ...overrides,
})

const status = (overrides: Partial<RenderJobStatus> = {}): RenderJobStatus => ({
  jobId: 'render-1',
  status: 'rendering',
  progress: 42,
  currentFrame: 42,
  totalFrames: 100,
  updatedAt: '2026-01-01T00:00:01.000Z',
  completedAt: null,
  estimatedTimeRemaining: 58,
  outputPath: 'out.mp4',
  outputFileSize: null,
  error: null,
  ...overrides,
})

describe('render status polling', () => {
  let useProjectStore: typeof UseProjectStoreType

  beforeEach(async () => {
    pollRenderJobStatusMock.mockReset()
    pollRenderJobStatusMock.mockResolvedValue(status())
    useProjectStore = await loadStore()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  function queueOneRenderingJob() {
    useProjectStore.setState((state) => ({
      project: { ...state.project, output: { ...state.project.output, queue: [job()] } },
    }))
  }

  it('applies a refreshed status without adding an undo entry', async () => {
    queueOneRenderingJob()
    const undoBefore = useProjectStore.getState().history.undoStack.length

    await useProjectStore.getState().refreshRenderStatuses()

    // Proof it actually applied.
    expect(useProjectStore.getState().project.output.queue[0].progress).toBe(42)
    // A background status poll is not a user edit — it must not be undoable, and must not
    // evict the user's real edits from the 200-entry history.
    expect(useProjectStore.getState().history.undoStack.length).toBe(undoBefore)
  })

  it('leaves the redo stack intact so a poll cannot cancel a pending redo', async () => {
    useProjectStore.getState().addDemoClip()
    useProjectStore.getState().undo()
    expect(useProjectStore.getState().history.redoStack.length).toBe(1)
    queueOneRenderingJob()

    await useProjectStore.getState().refreshRenderStatuses()

    expect(useProjectStore.getState().history.redoStack.length).toBe(1)
  })

  it('polls automatically on an interval once started', async () => {
    vi.useFakeTimers()
    queueOneRenderingJob()

    useProjectStore.getState().startRenderStatusPolling()
    expect(pollRenderJobStatusMock).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(1_000)
    expect(pollRenderJobStatusMock).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(1_000)
    expect(pollRenderJobStatusMock).toHaveBeenCalledTimes(2)
  })

  it('stops polling once no job is active any more', async () => {
    vi.useFakeTimers()
    queueOneRenderingJob()
    pollRenderJobStatusMock.mockResolvedValue(status({ status: 'completed', progress: 100, completedAt: 'x' }))

    useProjectStore.getState().startRenderStatusPolling()
    await vi.advanceTimersByTimeAsync(1_000)
    expect(pollRenderJobStatusMock).toHaveBeenCalledTimes(1)

    // The job finished, so the timer must retire itself rather than tick forever.
    await vi.advanceTimersByTimeAsync(5_000)
    expect(pollRenderJobStatusMock).toHaveBeenCalledTimes(1)
  })

  it('does not stack intervals when starting twice', async () => {
    vi.useFakeTimers()
    queueOneRenderingJob()

    useProjectStore.getState().startRenderStatusPolling()
    useProjectStore.getState().startRenderStatusPolling()
    await vi.advanceTimersByTimeAsync(1_000)

    expect(pollRenderJobStatusMock).toHaveBeenCalledTimes(1)
  })

  it('stops polling on request', async () => {
    vi.useFakeTimers()
    queueOneRenderingJob()

    useProjectStore.getState().startRenderStatusPolling()
    useProjectStore.getState().stopRenderStatusPolling()
    await vi.advanceTimersByTimeAsync(5_000)

    expect(pollRenderJobStatusMock).not.toHaveBeenCalled()
  })
})
