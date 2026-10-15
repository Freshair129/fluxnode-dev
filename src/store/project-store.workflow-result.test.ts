import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { useProjectStore as UseProjectStoreType } from './project-store'
import type { MediaSourceData, PreviewFrameData, WorkflowNode } from '../domain/project/types'

// These tests keep the frontend's file and media-probe IPC edges deterministic. The store,
// deduplication, project mutation, timeline clip creation, and switch guard remain real.
const { materializeMock, inspectMock, probeMock, appendWalMock, comfyGenerateMock, nodePreviewMock } = vi.hoisted(() => ({
  materializeMock: vi.fn(),
  inspectMock: vi.fn(),
  probeMock: vi.fn(),
  appendWalMock: vi.fn().mockResolvedValue(undefined),
  comfyGenerateMock: vi.fn(),
  nodePreviewMock: vi.fn(),
}))

vi.mock('../services/ipc/tauri-runtime', () => ({ isTauriRuntime: () => true }))
vi.mock('../services/ipc/workflow-result', () => ({
  materializeGeneratedWorkflowImage: materializeMock,
}))
vi.mock('../services/ipc/asset-inspection', () => ({ inspectAssetPath: inspectMock }))
vi.mock('../services/ipc/asset-probe', () => ({ probeAssetMetadata: probeMock }))
vi.mock('../services/ipc/comfy', () => ({
  generateComfyNode: comfyGenerateMock,
  pingComfy: vi.fn().mockResolvedValue(true),
}))
vi.mock('../services/ipc/node-preview', () => ({ renderNodePreview: nodePreviewMock }))
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

function preview(sourceResultId: string): PreviewFrameData {
  return {
    assetId: 'node-generate-fixture',
    sourcePath: '',
    sourceFileName: `fixture-${sourceResultId}.png`,
    sourceResultId,
    requestedTime: 0,
    width: 64,
    height: 64,
    mimeType: 'image/png',
    dataUrl: 'data:image/png;base64,aGVsbG8=',
    generatedAt: '2026-10-15T00:00:00.000Z',
  }
}

type MediaSourceWorkflowNode = WorkflowNode & { type: 'media_source'; data: MediaSourceData }

function generatedResultNodes(project: { workflow: { nodes: WorkflowNode[] } }, sourceNodeId: string) {
  return project.workflow.nodes.filter(
    (node): node is MediaSourceWorkflowNode =>
      node.type === 'media_source' &&
      (node.data as MediaSourceData).sourceWorkflowNodeId === sourceNodeId,
  )
}

describe('project-store: generated workflow result materialization', () => {
  let useProjectStore: typeof UseProjectStoreType
  let aiNodeId: string
  let previewKey: string

  beforeEach(async () => {
    materializeMock.mockReset()
    inspectMock.mockReset()
    probeMock.mockReset()
    comfyGenerateMock.mockReset()
    nodePreviewMock.mockReset()
    appendWalMock.mockClear()
    useProjectStore = await loadStore()

    const project = structuredClone(useProjectStore.getState().project)
    let aiNode = project.workflow.nodes.find((node) => node.type === 'ai_generate')
    if (!aiNode) {
      aiNode = {
        id: 'node-generate-fixture',
        type: 'ai_generate',
        position: { x: 0, y: 0 },
        data: { model: 'fixture', scaleFactor: 2, computeSource: 'local' },
        collapsed: false,
        bypassed: false,
        executionError: null,
        label: 'Fixture generator',
      }
      project.workflow.nodes.push(aiNode)
    }
    aiNodeId = aiNode.id
    const storeModule = await import('./project-store')
    previewKey = storeModule.buildNodePreviewSource(project.workflow, aiNodeId)!
    useProjectStore.setState({ project, nodePreviewFrames: { [previewKey]: preview('prompt-result-1') } })

    materializeMock.mockImplementation(async (_projectJson: string, assetId: string, sourceFileName: string) => ({
      assetId,
      relativePath: `media/${assetId}-${sourceFileName}`,
      absolutePath: `G:/fixture-project/media/${assetId}-${sourceFileName}`,
      copiedAt: '2026-10-15T00:00:00.000Z',
    }))
    inspectMock.mockImplementation(async (path: string) => ({
      path,
      exists: true,
      isFile: true,
      fileSize: 16,
      fileName: path.split(/[\\/]/).at(-1)!,
      extension: 'png',
    }))
    probeMock.mockResolvedValue({
      codec: 'PNG',
      width: 64,
      height: 64,
      frameRate: null,
      channels: null,
      sampleRate: null,
      fileSize: 16,
      duration: null,
    })
  })

  it('keeps a repeated result idempotent and inserts a distinct rerun result', async () => {
    const store = useProjectStore.getState()
    await store.materializeGeneratedWorkflowResult(aiNodeId)
    const first = useProjectStore.getState().project
    const firstResultNodes = generatedResultNodes(first, aiNodeId)
    expect(firstResultNodes).toHaveLength(1)
    expect(firstResultNodes[0].data.sourceWorkflowResultId).toBe('prompt-result-1')
    expect(materializeMock).toHaveBeenCalledTimes(1)

    await useProjectStore.getState().materializeGeneratedWorkflowResult(aiNodeId)
    expect(materializeMock).toHaveBeenCalledTimes(1)
    expect(
      generatedResultNodes(useProjectStore.getState().project, aiNodeId),
    ).toHaveLength(1)

    useProjectStore.setState({ nodePreviewFrames: { [previewKey]: preview('prompt-result-2') } })
    await useProjectStore.getState().materializeGeneratedWorkflowResult(aiNodeId)
    const finalProject = useProjectStore.getState().project
    const resultNodes = generatedResultNodes(finalProject, aiNodeId)
    expect(resultNodes.map((node) => node.data.sourceWorkflowResultId)).toEqual([
      'prompt-result-1',
      'prompt-result-2',
    ])
    expect(materializeMock).toHaveBeenCalledTimes(2)
    expect(finalProject.assets.assets).toHaveProperty(resultNodes[0].data.assetId!)
    expect(finalProject.assets.assets).toHaveProperty(resultNodes[1].data.assetId!)
    expect(
      finalProject.timeline.tracks.flatMap((track) => track.clips).filter((clip) =>
        resultNodes.some((node) => node.data.timelineClipId === clip.id),
      ),
    ).toHaveLength(2)
  })

  it('keeps a completed Comfy result when a stale selection preview resolves afterward', async () => {
    let finishPreview: ((frame: PreviewFrameData) => void) | undefined
    nodePreviewMock.mockImplementationOnce(
      () =>
        new Promise<PreviewFrameData>((resolve) => {
          finishPreview = resolve
        }),
    )
    comfyGenerateMock.mockResolvedValueOnce(preview('comfy-prompt-result'))
    useProjectStore.setState({ nodePreviewFrames: {} })

    const stalePreview = useProjectStore.getState().requestNodePreview(aiNodeId)
    await vi.waitFor(() => expect(nodePreviewMock).toHaveBeenCalledOnce())
    await useProjectStore.getState().runAiNode(aiNodeId)
    expect(useProjectStore.getState().nodePreviewFrames[previewKey]?.sourceResultId).toBe(
      'comfy-prompt-result',
    )

    finishPreview?.({ ...preview(''), sourceResultId: null })
    await stalePreview
    expect(useProjectStore.getState().nodePreviewFrames[previewKey]?.sourceResultId).toBe(
      'comfy-prompt-result',
    )
  })

  it('reports a project switch while the native PNG copy is in flight', async () => {
    let finishCopy: ((value: { assetId: string; relativePath: string; absolutePath: string; copiedAt: string }) => void) | undefined
    materializeMock.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishCopy = resolve
        }),
    )

    const operation = useProjectStore.getState().materializeGeneratedWorkflowResult(aiNodeId)
    await vi.waitFor(() => expect(materializeMock).toHaveBeenCalledOnce())
    useProjectStore.setState((state) => ({
      project: { ...state.project, meta: { ...state.project.meta, id: 'another-project' } },
    }))
    finishCopy?.({
      assetId: 'asset-copy-pending',
      relativePath: 'media/asset-copy-pending.png',
      absolutePath: 'G:/fixture-project/media/asset-copy-pending.png',
      copiedAt: '2026-10-15T00:00:00.000Z',
    })
    await operation

    expect(useProjectStore.getState().project.assets.assets).not.toHaveProperty('asset-copy-pending')
    expect(useProjectStore.getState().appErrors.some((error) =>
      error.detail?.includes('active project changed while the generated image was being saved'),
    )).toBe(true)
  })
})
