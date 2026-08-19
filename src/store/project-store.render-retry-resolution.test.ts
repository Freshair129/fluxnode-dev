import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { useProjectStore as UseProjectStoreType } from './project-store'
import type { RenderJob } from '../domain/project/types'

/**
 * The unavoidable mock: `retryRenderJob` crosses the Tauri IPC boundary, and in browser-mode
 * fallback it is a silent no-op — which would hide exactly the thing these tests check (what
 * resolution gets sent). Everything else here is the real store.
 */
const { retryRenderJobMock } = vi.hoisted(() => ({ retryRenderJobMock: vi.fn() }))
vi.mock('../services/ipc/render-job', () => ({
  retryRenderJob: retryRenderJobMock,
  startRenderJob: vi.fn(),
  pollRenderJobStatus: vi.fn(),
  cancelRenderJob: vi.fn(),
  pauseRenderJob: vi.fn(),
  resumeRenderJob: vi.fn(),
  RENDER_UNAVAILABLE_IN_BROWSER_MESSAGE: 'unavailable in browser preview mode',
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
    addEventListener: () => {},
    removeEventListener: () => {},
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
  status: 'failed',
  computeMode: 'local',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  outputPath: 'out.mp4',
  manifestPath: null,
  currentFrame: 40,
  totalFrames: 100,
  completedAt: null,
  estimatedTimeRemaining: null,
  outputFileSize: null,
  errorCategory: 'gpu_oom',
  lastError: 'CUDA error: out of memory',
  failedFrame: 40,
  resumeFromFrame: 40,
  quotaResetAt: null,
  quotaUsageSummary: null,
  retryCount: 1,
  maxAutoRetries: 1,
  lastRetryAt: null,
  autoRetryReason: 'gpu_oom',
  autoRetryScheduledFor: null,
  didFallbackResolution: false,
  originalResolution: null,
  audioMode: 'muxed',
  audioSourceSummary: '',
  outputRevealedAt: null,
  ...overrides,
})

describe('retryFailedRender resolution threading (G-05)', () => {
  let useProjectStore: typeof UseProjectStoreType

  beforeEach(async () => {
    retryRenderJobMock.mockReset()
    retryRenderJobMock.mockResolvedValue(undefined)
    useProjectStore = await loadStore()
  })

  it('sends the job\'s CURRENT (already-reduced) resolution on an automatic GPU-OOM retry', async () => {
    // Mirrors what scheduleRenderAutoRetry leaves behind: config.resolution already halved,
    // didFallbackResolution set, the pre-fallback size preserved separately.
    useProjectStore.setState((state) => ({
      project: {
        ...state.project,
        output: {
          ...state.project.output,
          queue: [
            job({
              config: {
                ...job().config,
                resolution: { width: 960, height: 540 },
              },
              didFallbackResolution: true,
              originalResolution: { width: 1920, height: 1080 },
            }),
          ],
        },
      },
    }))

    await useProjectStore.getState().retryFailedRender('render-1', { automatic: true })

    expect(retryRenderJobMock).toHaveBeenCalledWith('render-1', true, { width: 960, height: 540 })
  })

  it('sends the ORIGINAL resolution on a manual retry, matching what local state resets to', async () => {
    useProjectStore.setState((state) => ({
      project: {
        ...state.project,
        output: {
          ...state.project.output,
          queue: [
            job({
              // Left over from a prior fallback attempt — a manual retry must not send this.
              config: { ...job().config, resolution: { width: 960, height: 540 } },
              didFallbackResolution: true,
              originalResolution: { width: 1920, height: 1080 },
            }),
          ],
        },
      },
    }))

    await useProjectStore.getState().retryFailedRender('render-1')

    expect(retryRenderJobMock).toHaveBeenCalledWith('render-1', true, { width: 1920, height: 1080 })
    // And local state actually lands where the sent resolution says it will.
    const queued = useProjectStore.getState().project.output.queue.find((entry) => entry.id === 'render-1')!
    expect(queued.config.resolution).toEqual({ width: 1920, height: 1080 })
  })

  it('sends the unchanged resolution for a job that never fell back (no-op override)', async () => {
    useProjectStore.setState((state) => ({
      project: {
        ...state.project,
        output: { ...state.project.output, queue: [job()] },
      },
    }))

    await useProjectStore.getState().retryFailedRender('render-1', { automatic: true })

    expect(retryRenderJobMock).toHaveBeenCalledWith('render-1', true, { width: 1920, height: 1080 })
  })
})
