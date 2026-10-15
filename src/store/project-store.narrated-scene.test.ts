import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { useProjectStore as UseProjectStoreType } from './project-store'
import type { NarratedSceneResult } from '../services/ipc/narrated-scene'
import type { RenderJob } from '../domain/project/types'

const { copyMock, inspectMock, probeMock, thumbnailMock, appendWalMock } = vi.hoisted(() => ({
  copyMock: vi.fn(),
  inspectMock: vi.fn(),
  probeMock: vi.fn(),
  thumbnailMock: vi.fn(),
  appendWalMock: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('../services/ipc/tauri-runtime', () => ({ isTauriRuntime: () => true }))
vi.mock('../services/ipc/asset-copy', () => ({ copyAssetIntoProject: copyMock }))
vi.mock('../services/ipc/asset-inspection', () => ({ inspectAssetPath: inspectMock }))
vi.mock('../services/ipc/asset-probe', () => ({
  buildFallbackProbe: (path: string, fileSize: number) => ({
    codec: null,
    width: null,
    height: null,
    frameRate: null,
    channels: null,
    sampleRate: null,
    fileSize,
    duration: path.endsWith('.wav') ? 10.055 : null,
  }),
  probeAssetMetadata: probeMock,
}))
vi.mock('../services/ipc/thumbnail', () => ({ generateAssetThumbnail: thumbnailMock }))
vi.mock('../services/persistence/create-project-repository', () => ({
  createProjectRepository: () => ({ appendWal: appendWalMock }),
}))

function installBrowserGlobals() {
  const localStorageData = new Map<string, string>()
  vi.stubGlobal('window', {
    localStorage: {
      getItem: (key: string) => localStorageData.get(key) ?? null,
      setItem: (key: string, value: string) => localStorageData.set(key, value),
      removeItem: (key: string) => localStorageData.delete(key),
    },
    setTimeout: (...args: Parameters<typeof setTimeout>) => setTimeout(...args),
    clearTimeout: (handle: ReturnType<typeof setTimeout>) => clearTimeout(handle),
    setInterval: () => 1,
    clearInterval: () => {},
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

function queuedExport(): RenderJob {
  const timestamp = '2026-10-15T00:00:00.000Z'
  const outputPath = 'G:/fixture-project/exports/narrated-scene.mp4'
  return {
    id: 'render-narrated-scene-fixture',
    name: 'Fixture Project export',
    config: {
      outputPath,
      format: {
        container: 'mp4',
        videoCodec: 'h264_software',
        audioCodec: 'aac',
        quality: 'medium',
      },
      resolution: { width: 960, height: 540 },
      frameRate: 24,
      range: 'full',
      useProxy: false,
      denoising: false,
      metadata: { title: null, comment: null },
    },
    format: 'mp4',
    progress: 0,
    status: 'queued',
    computeMode: 'local',
    createdAt: timestamp,
    updatedAt: timestamp,
    outputPath,
    manifestPath: null,
    currentFrame: 0,
    totalFrames: 241,
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
    originalResolution: { width: 960, height: 540 },
    audioMode: 'muxed',
    audioSourceSummary: 'Narrated scene audio',
    outputRevealedAt: null,
  }
}

describe('project-store: narrated scene materialization', () => {
  let useProjectStore: typeof UseProjectStoreType

  beforeEach(async () => {
    copyMock.mockReset()
    inspectMock.mockReset()
    probeMock.mockReset()
    thumbnailMock.mockReset()
    appendWalMock.mockClear()
    useProjectStore = await loadStore()

    copyMock.mockImplementation(async (assetId: string, sourcePath: string) => {
      const fileName = sourcePath.split(/[\\/]/).at(-1)!
      return {
        assetId,
        relativePath: `media/${assetId}-${fileName}`,
        absolutePath: `G:/fixture-project/media/${assetId}-${fileName}`,
        copiedAt: '2026-10-15T00:00:00.000Z',
      }
    })
    inspectMock.mockImplementation(async (path: string) => ({
      path,
      exists: true,
      isFile: true,
      fileSize: path.endsWith('.wav') ? 482_684 : 277_167,
      fileName: path.split(/[\\/]/).at(-1)!,
      extension: path.split('.').at(-1)!,
    }))
    probeMock.mockImplementation(async (path: string) => ({
      codec: path.endsWith('.wav') ? 'PCM' : 'PNG',
      width: path.endsWith('.png') ? 512 : null,
      height: path.endsWith('.png') ? 512 : null,
      frameRate: null,
      channels: path.endsWith('.wav') ? 1 : null,
      sampleRate: path.endsWith('.wav') ? 24_000 : null,
      fileSize: path.endsWith('.wav') ? 482_684 : 277_167,
      duration: path.endsWith('.wav') ? 10.055 : null,
    }))
    thumbnailMock.mockResolvedValue({
      assetId: 'generated-image',
      thumbnailPath: 'G:/fixture-project/.fluxnode/thumbnails/generated-image.png',
      mimeType: 'image/png',
      generatedAt: '2026-10-15T00:00:00.000Z',
    })

    useProjectStore.setState((state) => ({
      ui: { ...state.ui, currentProjectPath: 'G:/fixture-project/fixture.fluxnode' },
      autoSaveProject: vi.fn().mockResolvedValue(undefined),
      enqueueRender: vi.fn(async () => {
        const job = queuedExport()
        useProjectStore.setState((current) => ({
          project: {
            ...current.project,
            output: { ...current.project.output, queue: [...current.project.output.queue, job] },
          },
        }))
      }),
      startRenderStatusPolling: vi.fn(),
      generateWaveformForAsset: vi.fn().mockResolvedValue(undefined),
    }))
  })

  it('copies generated PNG/WAV into a saved project, links timeline clips, and queues the CPU MP4 preset', async () => {
    const initial = useProjectStore.getState()
    const projectId = initial.project.meta.id
    const scene: NarratedSceneResult = {
      runId: 'fixture-run-01',
      imagePath: 'G:/verification/scene.png',
      audioPath: 'G:/verification/narration.wav',
      comfyPromptId: 'comfy-prompt-01',
      lalinJobId: 'lalin-job-01',
      gpuUuid: 'GPU-fixture',
      comfyFreeVramBeforeMb: 10_400,
      comfyFreeVramAfterMb: 10_350,
      lalinFreeVramBeforeMb: 10_350,
      lalinFreeVramAfterMb: 10_320,
      lalinReleaseStatus: 'released',
      lalinModel: 'f5',
    }

    const renderJobId = await initial.materializeNarratedScene(scene, projectId)
    const { project, ui } = useProjectStore.getState()
    const sceneAssets = Object.values(project.assets.assets).filter(
      (asset) =>
        asset.relativePath?.includes('asset-') &&
        (asset.name.endsWith('scene.png') || asset.name.endsWith('narration.wav')),
    )
    const imageAsset = sceneAssets.find((asset) => asset.name.endsWith('scene.png'))
    const audioAsset = sceneAssets.find((asset) => asset.name.endsWith('narration.wav'))
    const imageClip = project.timeline.tracks
      .flatMap((track) => track.clips)
      .find((clip) => clip.assetId === imageAsset?.id)
    const audioClip = project.timeline.tracks
      .flatMap((track) => track.clips)
      .find((clip) => clip.assetId === audioAsset?.id)

    expect(copyMock).toHaveBeenCalledTimes(2)
    expect(imageAsset?.type).toBe('image')
    expect(audioAsset?.type).toBe('audio')
    expect(imageClip).toBeDefined()
    expect(audioClip).toBeDefined()
    expect(imageClip?.duration).toBeCloseTo(10.055, 3)
    expect(audioClip?.duration).toBe(imageClip?.duration)
    expect(imageClip?.linkedClipId).toBe(audioClip?.id)
    expect(audioClip?.linkedClipId).toBe(imageClip?.id)
    expect(imageClip?.startTime).toBe(audioClip?.startTime)
    expect(project.output.presets.some((preset) => preset.id === 'preset-narrated-scene-cpu')).toBe(
      true,
    )
    expect(project.output.queue).toHaveLength(1)
    expect(project.output.queue[0]?.status).toBe('queued')
    expect(renderJobId).toBe('render-narrated-scene-fixture')
    expect(ui.activeView).toBe('timeline')
    expect(ui.selectedClipId).toBe(imageClip?.id)
    expect(ui.currentProjectPath).toBe('G:/fixture-project/fixture.fluxnode')
  })
})
