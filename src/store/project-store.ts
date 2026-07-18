import { create } from 'zustand'
import { applyPatches, enablePatches, produceWithPatches, setAutoFreeze, type Patch } from 'immer'

// Immer's patches plugin (produceWithPatches/applyPatches, used by applyMutation and
// undo/redo below) must be explicitly enabled before first use, even on immer 10.x.
enablePatches()
// getValidationState (below) normalizes several project fields (workflow groups, workspace
// sharing, section 11 history, render queue, ...) by mutating its `project` argument in
// place, and it's called on the *result* of applyMutation/applyGroupedMutations/undo/redo —
// i.e. after immer has already finished producing that object. Immer deep-freezes produced
// state by default, which would make every one of those post-produce normalize calls throw.
// Rather than rewrite getValidationState and its six normalize* helpers into a pure/immer-
// draft style (touching a lot of call sites, including ones that pass plain, never-frozen
// objects like a freshly loaded/deserialized project), disable auto-freeze: immer's
// structural sharing and patch generation are unaffected by this flag, it only removes the
// runtime Object.freeze() safety net.
setAutoFreeze(false)
import {
  beginHistoryGroup,
  createHistoryState,
  endHistoryGroup,
  popRedo,
  popUndo,
  pushCommand,
  type HistoryState,
} from '../domain/history/history-manager'
import { nextId } from '../domain/id'
import { createDefaultProject, createTemplateProject, type ProjectTemplateId } from '../domain/project/defaults'
import { activeViewForRatio, clampHorizonRatio, DEFAULT_HORIZON_RATIO, defaultRatioForView } from '../domain/project/horizon'
import { DEFAULT_DENSITY_MODE, normalizeDensityMode, type DensityMode } from '../domain/project/density'
import { validateProject, type ProjectValidationIssue } from '../domain/project/validators'
import type {
  AppPreferences,
  AppError,
  AppUpdateState,
  AudioMixData,
  Asset,
  AssetInspection,
  AssetProbeResult,
  Clip,
  DetachedPanelKind,
  DetachedPanelLayout,
  ExportJobStartResult,
  FluxNodeProject,
  Keyframe,
  NodeType,
  PreviewFrameData,
  RecentProject,
  RenderJobStartResult,
  RenderConfig,
  RenderJobStatus,
  RuntimeCacheMetrics,
  RuntimeHealth,
  ScrubPreviewState,
  Section11CoverageMapRecord,
  Section11CapturePacketRecord,
  Section11ProofRecord,
  Section11TargetProfile,
  StageRowSide,
  ThumbnailResult,
  Track,
  UserInterfaceState,
  ViewSwitchMetric,
  WorkflowBenchmarkMetric,
  WaveformCacheEntry,
  WorkflowConnectionFeedback,
  WorkflowClipboard,
  WorkflowNode,
  WorkspaceLayout,
  WorkspaceRole,
  WorkspaceSharingState,
  WorkspaceSyncConflict,
} from '../domain/project/types'
import {
  NODE_PORT_DEFINITIONS,
} from '../domain/workflow/node-definitions'
import {
  replaceTargetConnectionIfNeeded,
  validateConnectionAttempt,
  validateWorkflowGraph,
  type WorkflowValidationIssue,
} from '../domain/workflow/validation'
import { startExportJob } from '../services/ipc/export-job'
import { cancelRenderJob, pauseRenderJob, pollRenderJobStatus, resumeRenderJob, retryRenderJob, startRenderJob } from '../services/ipc/render-job'
import { generateAssetProxy } from '../services/ipc/proxy'
import { copyAssetIntoProject } from '../services/ipc/asset-copy'
import { buildFallbackProbe, probeAssetMetadata } from '../services/ipc/asset-probe'
import { generateAssetThumbnail } from '../services/ipc/thumbnail'
import { decodePreviewFrame } from '../services/ipc/video-preview'
import { renderNodePreview } from '../services/ipc/node-preview'
import { generateComfyNode, pingComfy } from '../services/ipc/comfy'
import { isTauriRuntime } from '../services/ipc/tauri-runtime'
import { generateWaveformPeaks } from '../services/ipc/waveform'
import { pickMediaFile, pickRelinkDirectory } from '../services/ipc/file-dialog'
import { loadAppPreferences, normalizeWorkspaceLayout, saveAppPreferences, saveCloudApiKey } from '../services/persistence/app-preferences'
import { hasSeenWelcome, markWelcomeSeen } from '../services/persistence/welcome-seen'
import { closeDetachedPanelWindow, openDetachedPanelWindow } from '../services/ipc/detached-panels'
import type { ShortcutCommand } from '../services/shortcuts/shortcut-config'
import { DEFAULT_KEYBINDINGS } from '../services/shortcuts/shortcut-config'
import { createProjectRepository } from '../services/persistence/create-project-repository'
import { inspectAssetPath } from '../services/ipc/asset-inspection'
import { readRuntimeHealth } from '../services/ipc/runtime-health'
import { canOpenPathInShell, openPathInShell } from '../services/ipc/app-shell'
import { checkForAppUpdate, downloadAppUpdatePackage, getCurrentAppVersion } from '../services/ipc/app-update'

const projectRepository = createProjectRepository()

interface ProjectStoreState {
  project: FluxNodeProject
  preferences: AppPreferences
  history: HistoryState
  ui: UserInterfaceState
  recentProjects: RecentProject[]
  appErrors: AppError[]
  recoveryAttempts: {
    cloudNetwork: number
    comfyConnection: number
  }
  workspaceSyncConflicts: WorkspaceSyncConflict[]
  collaborationState: {
    lastLocalProjectMutationAt: number | null
    lastLocalProjectMutationLabel: string | null
  }
  appUpdateState: AppUpdateState
  runtimeHealth: RuntimeHealth
  runtimeCacheMetrics: RuntimeCacheMetrics
  waveformCache: Record<string, WaveformCacheEntry>
  previewFrames: Record<string, PreviewFrameData>
  nodePreviewFrames: Record<string, PreviewFrameData>
  aiNodeGenerationInFlight: Record<string, boolean>
  comfyConnected: boolean | null
  assetThumbnails: Record<string, ThumbnailResult>
  workflowValidationIssues: WorkflowValidationIssue[]
  projectValidationIssues: ProjectValidationIssue[]
  workflowExecutionOrder: string[]
  setActiveView: (view: UserInterfaceState['activeView']) => void
  setHorizonRatio: (ratio: number) => void
  toggleStageRowCollapse: (side: StageRowSide) => void
  toggleComputeMode: () => void
  toggleProxyMode: () => void
  dismissWelcome: () => void
  openSettings: () => void
  closeSettings: () => void
  openWorkspaceSharing: () => void
  closeWorkspaceSharing: () => void
  registerWorkspaceSyncConflict: (conflict: WorkspaceSyncConflict) => void
  resolveWorkspaceSyncConflict: (conflictId: string, resolution: 'local' | 'remote') => void
  dismissWorkspaceSyncConflict: (conflictId: string) => void
  openNodePicker: () => void
  closeNodePicker: () => void
  openDetachedPanel: (panel: DetachedPanelKind) => Promise<void>
  closeDetachedPanel: (panel: DetachedPanelKind) => Promise<void>
  loadAppPreferences: () => Promise<void>
  loadCurrentAppVersion: () => Promise<void>
  setDefaultProjectDirectory: (path: string | null) => Promise<void>
  setUpdateChannel: (channel: string) => Promise<void>
  setUpdateManifestUrl: (url: string | null) => Promise<void>
  /** MERIDIAN item 7: comfortable/compact UI density, an app-level preference persisted the same
   *  way as `keybindings` (see `services/persistence/app-preferences.ts`), not a project field. */
  setDensityMode: (mode: DensityMode) => Promise<void>
  /** Studio (default NLE arrangement) vs. strata (MERIDIAN horizon shell) — app-level preference
   *  persisted exactly like `density`. */
  setWorkspaceLayout: (layout: WorkspaceLayout) => Promise<void>
  enableWorkspaceSharing: () => void
  disableWorkspaceSharing: () => void
  setWorkspaceAccessLevel: (accessLevel: WorkspaceSharingState['accessLevel']) => void
  inviteWorkspaceCollaborator: (email: string, role: Exclude<WorkspaceRole, 'owner'>) => void
  acceptWorkspaceInvite: (inviteId: string) => void
  revokeWorkspaceInvite: (inviteId: string) => void
  updateWorkspaceCollaboratorRole: (collaboratorId: string, role: Exclude<WorkspaceRole, 'owner'>) => void
  removeWorkspaceCollaborator: (collaboratorId: string) => void
  setExportOutputDirectory: (path: string) => void
  toggleOpenFolderAfterExport: () => void
  setCloudApiKey: (apiKey: string) => Promise<void>
  setKeybinding: (command: ShortcutCommand, key: string, modifiers: string[]) => Promise<void>
  resetKeybinding: (command: ShortcutCommand) => Promise<void>
  movePlayhead: (delta: number) => void
  setPlayhead: (time: number) => void
  scrubPlayhead: (time: number) => void
  recordViewSwitchMetric: (metric: ViewSwitchMetric) => void
  recordWorkflowBenchmarkMetric: (metric: Partial<WorkflowBenchmarkMetric>) => void
  saveSection11ProofRecord: (proof: Section11ProofRecord) => void
  saveSection11CoverageMapRecord: (coverageMap: Section11CoverageMapRecord) => void
  setSection11TargetProfileOverride: (label: Section11TargetProfile['label'] | null) => void
  saveSection11CapturePacketRecord: (capturePacket: Section11CapturePacketRecord) => void
  clearSection11ProofHistory: () => void
  clearSection11CoverageMapHistory: () => void
  clearSection11CapturePacketHistory: () => void
  togglePlayback: () => void
  pausePlayback: () => void
  shuttlePlayback: (direction: 'forward' | 'reverse') => void
  setInPoint: () => void
  setOutPoint: () => void
  clearInOutPoints: () => void
  adjustTimelineZoom: (delta: number) => void
  fitTimelineToWindow: () => void
  addDemoClip: () => void
  /** Adds a new clip instance of an already-imported asset onto the timeline (media-bin
   *  drag/double-click). Appends to the end of the matching track unless a start time and/or
   *  track is provided. Creates the linked media-source workflow node like import does. */
  addClipFromAsset: (assetId: string, options?: { trackId?: string; startTime?: number }) => void
  addShaderNode: () => void
  addNodeOfType: (type: NodeType) => void
  nudgeFirstNode: () => void
  createLargeCanvasBenchmarkScene: () => void
  importAssetFromPath: (providedPath?: string) => Promise<void>
  rescanAssetStatuses: () => Promise<void>
  toggleAssetProxyPreference: (assetId: string) => void
  replaceSelectedAssetPath: () => Promise<void>
  relinkMissingAssetsFromFolder: () => Promise<void>
  generateProxyForAsset: (assetId: string) => Promise<void>
  generateProxyForSelectedClip: () => Promise<void>
  generateWaveformForAsset: (assetId: string, bucketCount?: number) => Promise<void>
  ensureThumbnailForAsset: (assetId: string) => Promise<void>
  loadPreviewFrameForSelectedClip: (width?: number, height?: number) => Promise<void>
  loadPreviewFrameForSelectedNode: (width?: number, height?: number) => Promise<void>
  requestNodePreview: (nodeId: string, width?: number, height?: number) => Promise<void>
  runAiNode: (nodeId: string) => Promise<void>
  pingComfyConnection: () => Promise<boolean>
  unlinkSelectedMedia: () => void
  showSelectedClipInWorkflow: () => void
  newProject: () => Promise<void>
  applyTemplate: (templateId: ProjectTemplateId) => Promise<void>
  createProjectAtPath: (path: string) => Promise<void>
  openProjectFromPath: (path: string) => Promise<void>
  autoSaveProject: () => Promise<void>
  selectClip: (clipId: string | null, additive?: boolean) => void
  selectTrack: (trackId: string | null) => void
  selectAllTimelineClips: () => void
  copySelectedClips: () => void
  pasteTimelineClipboard: () => void
  addTrackAbove: () => void
  addTrackBelow: () => void
  moveSelectedTrack: (direction: 'up' | 'down') => void
  deleteSelectedTrack: () => void
  renameSelectedTrack: () => void
  toggleSelectedTrackLock: () => void
  toggleSelectedTrackMute: () => void
  toggleSelectedTrackSolo: () => void
  toggleSelectedTrackVisibility: () => void
  setSelectedTrackVolume: (volume: number) => void
  setSelectedTrackPan: (pan: number) => void
  cycleSelectedTrackHeight: () => void
  setSelectedTrackHeight: (height: number) => void
  moveSelectedClipToAdjacentTrack: (direction: 'up' | 'down') => void
  setSelectedClipStartTime: (startTime: number) => void
  setSelectedClipDuration: (duration: number) => void
  setSelectedClipInPoint: (inPoint: number) => void
  setSelectedClipOutPoint: (outPoint: number) => void
  setSelectedClipSpeed: (speed: number) => void
  setSelectedClipVolume: (volume: number) => void
  setSelectedClipOpacity: (opacity: number) => void
  setSelectedClipTransformField: (
    field: 'x' | 'y' | 'scaleX' | 'scaleY' | 'rotation' | 'anchorX' | 'anchorY',
    value: number,
  ) => void
  addSelectedClipKeyframe: (
    property: 'speed' | 'opacity' | 'volume' | 'transform.x' | 'transform.y' | 'transform.scaleX' | 'transform.scaleY' | 'transform.rotation',
  ) => void
  updateSelectedClipKeyframe: (
    keyframeId: string,
    updates: Partial<Pick<Keyframe, 'time' | 'value' | 'easing'>>,
  ) => void
  removeSelectedClipKeyframe: (keyframeId: string) => void
  setMasterVolume: (volume: number) => void
  toggleScrubEnabled: () => void
  cycleWaveformDensity: () => void
  setScrubPreviewState: (previewState: ScrubPreviewState) => void
  clearScrubPreviewState: () => void
  selectNode: (nodeId: string | null, additive?: boolean) => void
  setWorkflowSelection: (nodeIds: string[]) => void
  selectAllWorkflowNodes: () => void
  selectOutputNode: () => void
  createTimelineClipFromSelectedNode: () => void
  showSelectedNodeInTimeline: () => void
  setSelectedNodeLabel: (label: string) => void
  setNodeDataField: (nodeId: string, path: string, value: unknown) => void
  setSelectedNodeDataField: (path: string, value: unknown) => void
  toggleSelectedNodeCollapsed: () => void
  toggleSelectedNodeBypass: () => void
  setSelectedNodeComputeSource: (source: 'local' | 'cloud' | 'project') => void
  simulateSelectedNodeExecutionFailure: () => void
  clearSelectedNodeExecutionFailure: () => void
  copySelectedNodes: () => void
  pasteWorkflowClipboard: () => void
  groupSelectedWorkflowNodes: () => void
  duplicateSelected: () => void
  deleteSelected: () => void
  splitSelectedClip: () => void
  connectSelectedNodeToOutput: () => void
  disconnectSelectedNodeEdges: () => void
  moveWorkflowNodes: (nodeIds: string[], deltaX: number, deltaY: number) => void
  connectWorkflowPorts: (
    sourceNodeId: string,
    sourceHandle: string,
    targetNodeId: string,
    targetHandle: string,
  ) => { ok: true } | { ok: false; reason: string }
  panWorkflowViewport: (deltaX: number, deltaY: number) => void
  adjustWorkflowZoom: (delta: number) => void
  fitWorkflowViewport: () => void
  validateWorkflow: () => void
  showWorkflowConnectionFeedback: (feedback: Omit<WorkflowConnectionFeedback, 'shakeKey'>) => void
  clearWorkflowConnectionFeedback: () => void
  enqueueRender: () => Promise<void>
  refreshRenderStatuses: () => Promise<void>
  pauseActiveRender: () => Promise<void>
  resumePausedRender: (jobId?: string) => Promise<void>
  cancelActiveRender: () => Promise<void>
  failActiveRender: () => void
  simulateCloudNetworkFailure: () => void
  simulateGpuOomFailure: () => void
  simulateQuotaExceeded: () => void
  retryFailedRender: (jobId?: string, options?: { automatic?: boolean }) => Promise<void>
  moveRenderJob: (jobId: string, direction: 'up' | 'down') => void
  openRenderOutput: (jobId: string) => Promise<void>
  clearResolvedErrors: () => void
  dismissAppError: (errorId: string) => void
  performAppErrorAction: (errorId: string) => Promise<void>
  setActiveRenderPreset: (presetId: string) => void
  refreshRuntimeHealth: () => Promise<void>
  syncResilienceState: () => void
  clearRuntimeCaches: () => void
  checkForAppUpdates: () => Promise<void>
  downloadAppUpdate: () => Promise<void>
  installDownloadedAppUpdate: () => Promise<void>
  openUpdateDownload: () => Promise<void>
  undo: () => void
  redo: () => void
  saveProject: () => Promise<void>
  saveProjectAs: (path: string) => Promise<void>
  loadPersistedProject: () => Promise<void>
}

type StoreSetter = (
  partial: Partial<ProjectStoreState> | ((state: ProjectStoreState) => Partial<ProjectStoreState>),
) => void

const PREVIEW_FRAME_CACHE_LIMIT = 18
const NODE_PREVIEW_CACHE_LIMIT = 12
const WAVEFORM_CACHE_LIMIT = 12
const THUMBNAIL_CACHE_LIMIT = 36
// Fixed per-entry estimate for a cached thumbnail's in-memory footprint (see
// estimateRuntimeCacheUsageMb) — deliberately not derived from thumbnailPath.length, which
// tracks path length rather than actual thumbnail size.
const THUMBNAIL_ESTIMATED_BYTES = 16 * 1024
const TIMELINE_PREVIEW_PREFETCH_FRAMES = 30
const TIMELINE_PREVIEW_DECODE_CONCURRENCY = 4
const MEMORY_PRESSURE_EVICTION_THRESHOLD_PCT = 70
const APP_MEMORY_SOFT_LIMIT_MB = 4 * 1024
const APP_MEMORY_HARD_LIMIT_MB = 6 * 1024
const RECOVERY_BACKOFF_MS = [2_000, 4_000, 8_000] as const
type RecoveryKind = 'cloudNetwork' | 'comfyConnection'
const recoveryTimers: Record<RecoveryKind, ReturnType<typeof window.setTimeout> | null> = {
  cloudNetwork: null,
  comfyConnection: null,
}
const renderRetryTimers = new Map<string, ReturnType<typeof window.setTimeout>>()
const pendingPreviewFrameRequests = new Set<string>()
const pendingNodePreviewRequests = new Set<string>()

// LRU bookkeeping for the runtime caches: previously trimRecordToLastN evicted purely
// by insertion order, so an entry the user kept coming back to (a genuine "hot" entry) was
// exactly as likely to be evicted as one that was produced once and never looked at again.
// Each map tracks a monotonic "last touched" tick per cache key so trimming can keep the
// actually-recently-used entries instead of just the most-recently-inserted ones. The tick
// is per-cache (not shared) — only the relative order within one cache matters for its own
// eviction, and keeping them separate avoids cross-cache traffic skewing any single cache.
let previewFrameAccessTick = 0
const previewFrameAccessOrder = new Map<string, number>()

function touchPreviewFrameAccess(cacheKey: string) {
  previewFrameAccessTick += 1
  previewFrameAccessOrder.set(cacheKey, previewFrameAccessTick)
}

let nodePreviewFrameAccessTick = 0
const nodePreviewFrameAccessOrder = new Map<string, number>()

function touchNodePreviewFrameAccess(cacheKey: string) {
  nodePreviewFrameAccessTick += 1
  nodePreviewFrameAccessOrder.set(cacheKey, nodePreviewFrameAccessTick)
}

let waveformAccessTick = 0
const waveformAccessOrder = new Map<string, number>()

function touchWaveformAccess(cacheKey: string) {
  waveformAccessTick += 1
  waveformAccessOrder.set(cacheKey, waveformAccessTick)
}

let assetThumbnailAccessTick = 0
const assetThumbnailAccessOrder = new Map<string, number>()

function touchAssetThumbnailAccess(cacheKey: string) {
  assetThumbnailAccessTick += 1
  assetThumbnailAccessOrder.set(cacheKey, assetThumbnailAccessTick)
}

/**
 * These caches/timers are module-level singletons (not part of the zustand store), so
 * switching projects (new/open/load) previously left them populated with entries keyed by
 * ids that no longer exist in the new project — a slow, unbounded leak across a long
 * session of opening many projects. Call this alongside every cache reset that already
 * happens on project switch.
 */
function clearModuleGlobalCaches() {
  pendingPreviewFrameRequests.clear()
  pendingNodePreviewRequests.clear()
  previewFrameAccessOrder.clear()
  nodePreviewFrameAccessOrder.clear()
  waveformAccessOrder.clear()
  assetThumbnailAccessOrder.clear()

  for (const kind of Object.keys(recoveryTimers) as RecoveryKind[]) {
    const timer = recoveryTimers[kind]
    if (timer !== null) {
      window.clearTimeout(timer)
      recoveryTimers[kind] = null
    }
  }

  for (const timer of renderRetryTimers.values()) {
    window.clearTimeout(timer)
  }
  renderRetryTimers.clear()
}

function createIdleScrubPreviewState(): ScrubPreviewState {
  return {
    active: false,
    mode: null,
    speed: 0,
    sourceTime: null,
    startedAt: null,
  }
}

function createIdleViewSwitchMetric(): ViewSwitchMetric {
  return {
    fromView: null,
    toView: null,
    durationMs: null,
    measuredAt: null,
  }
}

function createIdleWorkflowBenchmarkMetric(): WorkflowBenchmarkMetric {
  return {
    sceneLabel: null,
    nodeCount: 0,
    edgeCount: 0,
    canvasRendererExpected: false,
    generationMs: null,
    fitViewDurationMs: null,
    fitViewMeasuredAt: null,
    panTraversalDurationMs: null,
    zoomSweepDurationMs: null,
    interactionMeasuredAt: null,
    measuredAt: null,
  }
}

function createIdleWorkflowConnectionFeedback(): WorkflowConnectionFeedback {
  return {
    targetNodeId: null,
    targetHandle: null,
    reason: null,
    tone: null,
    visibleUntil: null,
    shakeKey: 0,
  }
}

/**
 * UI side effects of an EXPLICIT view switch (`setActiveView`: Header mode buttons, the
 * legacy `global.toggleView` shortcut, and store actions like showSelectedClipInWorkflow).
 * Deliberately NOT applied by `setHorizonRatio`'s emphasis sync — ratio-driven flips (Tab,
 * peek, nudge, drag across the midpoint) keep both strata visible, so clearing the other
 * stratum's selection there would be silent data-loss of the user's selection (review
 * round-1 blocking item 1). Kept as a pure patch-builder for testability.
 */
function computeActiveViewUiPatch(
  ui: UserInterfaceState,
  view: UserInterfaceState['activeView'],
): Partial<UserInterfaceState> {
  return {
    activeView: view,
    selectedClipId: view === 'workflow' ? null : ui.selectedClipId,
    selectedClipIds: view === 'workflow' ? [] : ui.selectedClipIds,
    selectedTrackId: view === 'workflow' ? null : ui.selectedTrackId,
    selectedNodeId: view === 'timeline' ? null : ui.selectedNodeId,
    selectedNodeIds: view === 'timeline' ? [] : ui.selectedNodeIds,
    showNodePicker: view === 'timeline' ? false : ui.showNodePicker,
    statusMessage: `Switched to ${view} view`,
  }
}

function createInitialAppUpdateState(): AppUpdateState {
  return {
    status: 'idle',
    downloadStatus: 'idle',
    versionInfo: {
      currentVersion: 'unknown',
      backend: typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window ? 'tauri' : 'browser',
      loadedAt: null,
    },
    latestVersion: null,
    downloadUrl: null,
    sha256: null,
    downloadedFilePath: null,
    notes: null,
    publishedAt: null,
    lastCheckedAt: null,
    errorMessage: null,
  }
}

function createWorkspaceShareLink(workspaceId: string) {
  return `https://share.fluxnode.app/workspaces/${workspaceId}`
}

function normalizeWorkspaceSharing(project: FluxNodeProject) {
  const fallback = createDefaultProject().meta.sharing
  const current = project.meta.sharing as Partial<WorkspaceSharingState> | undefined
  const workspaceId =
    typeof current?.workspaceId === 'string' && current.workspaceId.trim().length > 0
      ? current.workspaceId.trim()
      : `workspace-${project.meta.id}`
  const enabled = current?.enabled === true

  project.meta.sharing = {
    enabled,
    workspaceId,
    shareLink:
      typeof current?.shareLink === 'string' && current.shareLink.trim().length > 0
        ? current.shareLink.trim()
        : enabled
          ? createWorkspaceShareLink(workspaceId)
          : null,
    accessLevel:
      current?.accessLevel === 'team' || current?.accessLevel === 'public_view' || current?.accessLevel === 'private'
        ? current.accessLevel
        : fallback.accessLevel,
    ownerName:
      typeof current?.ownerName === 'string' && current.ownerName.trim().length > 0
        ? current.ownerName.trim()
        : fallback.ownerName,
    ownerEmail:
      typeof current?.ownerEmail === 'string' && current.ownerEmail.trim().length > 0 ? current.ownerEmail.trim() : null,
    collaborators: Array.isArray(current?.collaborators)
      ? current.collaborators.filter((collaborator) => !!collaborator && typeof collaborator.email === 'string')
      : [],
    invites: Array.isArray(current?.invites)
      ? current.invites.filter((invite) => !!invite && typeof invite.email === 'string')
      : [],
    lastSyncedAt:
      typeof current?.lastSyncedAt === 'string' && current.lastSyncedAt.trim().length > 0
        ? current.lastSyncedAt
        : fallback.lastSyncedAt,
  }
}

function normalizeSection11ProofHistory(project: FluxNodeProject) {
  const current = project.meta.section11ProofHistory as Partial<Section11ProofRecord>[] | undefined
  project.meta.section11ProofHistory = Array.isArray(current)
    ? current.filter(
        (proof): proof is Section11ProofRecord =>
          !!proof &&
          typeof proof.id === 'string' &&
          typeof proof.capturedAt === 'string' &&
          Array.isArray(proof.checks) &&
          Array.isArray(proof.osCoverage),
      )
    : []
}

function normalizeSection11CoverageMapHistory(project: FluxNodeProject) {
  const current = project.meta.section11CoverageMapHistory as Partial<Section11CoverageMapRecord>[] | undefined
  project.meta.section11CoverageMapHistory = Array.isArray(current)
    ? current
        .map((entry) => {
          if (!entry || typeof entry.generatedAt !== 'string') {
            return null
          }

          return {
            bundleVersion: typeof entry.bundleVersion === 'string' ? entry.bundleVersion : '1.0',
            bundleKind:
              entry.bundleKind === 'section11-coverage-map' || entry.bundleKind === 'section11-proof-bundle'
                ? entry.bundleKind
                : 'section11-coverage-map',
            generatedAt: entry.generatedAt,
            manifestTitle: typeof entry.manifestTitle === 'string' ? entry.manifestTitle : 'Section 11 Coverage Map',
            manifestContents: Array.isArray(entry.manifestContents)
              ? entry.manifestContents.filter((value): value is string => typeof value === 'string')
              : [],
            runbook: Array.isArray(entry.runbook)
              ? entry.runbook.filter((value): value is string => typeof value === 'string')
              : [],
            osCoverageCount: typeof entry.osCoverageCount === 'number' ? entry.osCoverageCount : 0,
            hardwareCoverageCount: typeof entry.hardwareCoverageCount === 'number' ? entry.hardwareCoverageCount : 0,
            combinedCoverageCount: typeof entry.combinedCoverageCount === 'number' ? entry.combinedCoverageCount : 0,
            recommendedCount: typeof entry.recommendedCount === 'number' ? entry.recommendedCount : 0,
          } satisfies Section11CoverageMapRecord
        })
        .filter((entry): entry is Section11CoverageMapRecord => !!entry)
    : []
}

function normalizeSection11CapturePacketHistory(project: FluxNodeProject) {
  const current = project.meta.section11CapturePacketHistory as Partial<Section11CapturePacketRecord>[] | undefined
  project.meta.section11CapturePacketHistory = Array.isArray(current)
    ? current
        .map((entry) => {
          if (!entry || typeof entry.generatedAt !== 'string') {
            return null
          }

          return {
            bundleVersion: typeof entry.bundleVersion === 'string' ? entry.bundleVersion : '1.0',
            bundleKind: entry.bundleKind === 'section11-capture-packet' ? entry.bundleKind : 'section11-capture-packet',
            generatedAt: entry.generatedAt,
            manifestTitle: typeof entry.manifestTitle === 'string' ? entry.manifestTitle : 'Section 11 Capture Packet',
            runbook: Array.isArray(entry.runbook)
              ? entry.runbook.filter((value): value is string => typeof value === 'string')
              : [],
            targetProfileOverride:
              entry.targetProfileOverride === 'Browser' ||
              entry.targetProfileOverride === 'Windows 10+' ||
              entry.targetProfileOverride === 'Windows 11' ||
              entry.targetProfileOverride === 'macOS 12+' ||
              entry.targetProfileOverride === 'Ubuntu 22.04+'
                ? entry.targetProfileOverride
                : null,
            proofHistoryCount: typeof entry.proofHistoryCount === 'number' ? entry.proofHistoryCount : 0,
            nextCaptureTargetsCount: typeof entry.nextCaptureTargetsCount === 'number' ? entry.nextCaptureTargetsCount : 0,
            coverageMapHistoryCount: typeof entry.coverageMapHistoryCount === 'number' ? entry.coverageMapHistoryCount : 0,
            proofSuiteRestored: entry.proofSuiteRestored === true,
            renderProofRestored: entry.renderProofRestored === true,
          } satisfies Section11CapturePacketRecord
        })
        .filter((entry): entry is Section11CapturePacketRecord => !!entry)
    : []
}

function normalizeSection11TargetProfileOverride(project: FluxNodeProject) {
  const current = project.meta.section11TargetProfileOverride
  const allowedLabels: Section11TargetProfile['label'][] = ['Browser', 'Windows 10+', 'Windows 11', 'macOS 12+', 'Ubuntu 22.04+']
  project.meta.section11TargetProfileOverride = typeof current === 'string' && allowedLabels.includes(current as Section11TargetProfile['label'])
    ? (current as Section11TargetProfile['label'])
    : null
}

function cloneProject(project: FluxNodeProject): FluxNodeProject {
  return structuredClone(project)
}

function syncUpdatedAt(project: FluxNodeProject) {
  project.meta.updatedAt = new Date().toISOString()
}

function makeStatusMessage(project: FluxNodeProject) {
  return `${project.timeline.tracks.length} track(s), ${project.workflow.nodes.length} node(s), ${project.workflow.computeMode} compute`
}

function clampClipKeyframeTime(clip: Clip, time: number) {
  return Math.max(0, Math.min(clip.duration, Number(time.toFixed(2))))
}

function getClipKeyframeValue(clip: Clip, property: 'speed' | 'opacity' | 'volume') {
  if (property === 'speed') {
    return Number(clip.speed.toFixed(2))
  }

  if (property === 'opacity') {
    return Number(clip.opacity.toFixed(2))
  }

  return Number(clip.volume.toFixed(2))
}

function getClipKeyframeValueByProperty(
  clip: Clip,
  property:
    | 'speed'
    | 'opacity'
    | 'volume'
    | 'transform.x'
    | 'transform.y'
    | 'transform.scaleX'
    | 'transform.scaleY'
    | 'transform.rotation',
) {
  if (property === 'speed' || property === 'opacity' || property === 'volume') {
    return getClipKeyframeValue(clip, property)
  }

  if (property === 'transform.x') {
    return Number(clip.transform.x.toFixed(2))
  }

  if (property === 'transform.y') {
    return Number(clip.transform.y.toFixed(2))
  }

  if (property === 'transform.scaleX') {
    return Number(clip.transform.scaleX.toFixed(2))
  }

  if (property === 'transform.scaleY') {
    return Number(clip.transform.scaleY.toFixed(2))
  }

  return Number(clip.transform.rotation.toFixed(2))
}

function sortClipKeyframes(keyframes: Keyframe[]) {
  keyframes.sort((left, right) => left.time - right.time || left.property.localeCompare(right.property))
}

function clampClipDuration(value: number) {
  return Math.max(0.1, Number(value.toFixed(2)))
}

function isNodeDataArrayIndex(segment: string) {
  return /^\d+$/.test(segment)
}

function createNodeDataContainer(nextSegment: string | undefined) {
  return isNodeDataArrayIndex(nextSegment ?? '') ? [] : {}
}

function setNestedNodeDataValue(target: Record<string, unknown>, path: string, value: unknown) {
  const segments = path.split('.')
  let cursor: Record<string, unknown> | unknown[] = target

  for (let index = 0; index < segments.length - 1; index += 1) {
    const key = segments[index]
    const nextSegment = segments[index + 1]

    if (Array.isArray(cursor)) {
      const arrayIndex = Number(key)
      const nextValue = cursor[arrayIndex]

      if (!nextValue || typeof nextValue !== 'object') {
        cursor[arrayIndex] = createNodeDataContainer(nextSegment)
      }

      cursor = cursor[arrayIndex] as Record<string, unknown> | unknown[]
      continue
    }

    const nextValue = cursor[key]

    if (!nextValue || typeof nextValue !== 'object') {
      cursor[key] = createNodeDataContainer(nextSegment)
    }

    cursor = cursor[key] as Record<string, unknown> | unknown[]
  }

  const lastSegment = segments[segments.length - 1]

  if (Array.isArray(cursor)) {
    cursor[Number(lastSegment)] = value
    return
  }

  cursor[lastSegment] = value
}

function normalizeHorizonRatio(project: FluxNodeProject) {
  const current = project.meta.horizonRatio
  const normalized = clampHorizonRatio(typeof current === 'number' ? current : DEFAULT_HORIZON_RATIO)

  // Guard against unconditional writes to a value that's already correct — getValidationState
  // sometimes runs against objects immer has frozen (see migrate-project.ts's analogous note).
  if (current !== normalized) {
    project.meta.horizonRatio = normalized
  }
}

function getValidationState(project: FluxNodeProject) {
  normalizeWorkflowGroups(project)
  normalizeWorkspaceSharing(project)
  normalizeSection11ProofHistory(project)
  normalizeSection11CoverageMapHistory(project)
  normalizeSection11CapturePacketHistory(project)
  normalizeSection11TargetProfileOverride(project)
  normalizeHorizonRatio(project)
  normalizeRenderQueue(project)
  const workflowReport = validateWorkflowGraph(project.workflow)
  return {
    workflowValidationIssues: workflowReport.issues,
    workflowExecutionOrder: workflowReport.topologicalOrder,
    projectValidationIssues: validateProject(project),
  }
}

function normalizeRenderQueue(project: FluxNodeProject) {
  project.output.queue = project.output.queue.map((job) => ({
    ...job,
    retryCount: typeof job.retryCount === 'number' ? job.retryCount : 0,
    maxAutoRetries: typeof job.maxAutoRetries === 'number' ? job.maxAutoRetries : 0,
    lastRetryAt: typeof job.lastRetryAt === 'string' ? job.lastRetryAt : null,
    autoRetryReason: job.autoRetryReason === 'cloud_network' || job.autoRetryReason === 'gpu_oom' ? job.autoRetryReason : null,
    autoRetryScheduledFor: typeof job.autoRetryScheduledFor === 'string' ? job.autoRetryScheduledFor : null,
    didFallbackResolution: job.didFallbackResolution === true,
    originalResolution:
      job.originalResolution && typeof job.originalResolution.width === 'number' && typeof job.originalResolution.height === 'number'
        ? job.originalResolution
        : { ...job.config.resolution },
  }))
}

function createShaderNode(index: number): WorkflowNode {
  return {
    id: `node-shader-${index.toString().padStart(2, '0')}`,
    type: 'shader',
    position: { x: 280 + index * 28, y: 110 + index * 24 },
    data: {
      shaderSource: 'vec3 glow = color.rgb * 1.05;',
      uniforms: {
        intensity: {
          type: 'float',
          value: 0.75 + index * 0.05,
        },
      },
      presetId: null,
    },
    collapsed: false,
    bypassed: false,
    executionError: null,
    label: `Shader ${index}`,
  }
}

function createWorkflowNodeOfType(type: NodeType, index: number): WorkflowNode {
  const position = { x: 220 + (index % 4) * 220, y: 120 + Math.floor(index / 4) * 140 }

  switch (type) {
    case 'camera':
      return {
        id: `node-camera-${index.toString().padStart(2, '0')}`,
        type,
        position,
        data: {
          mode: 'perspective',
          fov: 60,
          position: { x: 0, y: 0, z: 3 },
          rotation: { x: 0, y: 0, z: 0 },
          zoom: 1,
        },
        collapsed: false,
        bypassed: false,
        executionError: null,
        label: `Camera ${index}`,
      }
    case 'compositor':
      return {
        id: `node-compositor-${index.toString().padStart(2, '0')}`,
        type,
        position,
        data: {
          blendMode: 'screen',
          layers: [],
        },
        collapsed: false,
        bypassed: false,
        executionError: null,
        label: `Compositor ${index}`,
      }
    case 'output':
      return {
        id: `node-output-${index.toString().padStart(2, '0')}`,
        type,
        position,
        data: {
          format: 'mp4',
          resolution: 'project',
          frameRate: 'project',
        },
        collapsed: false,
        bypassed: false,
        executionError: null,
        label: `Output ${index}`,
      }
    case 'audio_mix':
      return {
        id: `node-audio-mix-${index.toString().padStart(2, '0')}`,
        type,
        position,
        data: {
          bus: 'master',
          gain: 1,
          inputs: [],
        },
        collapsed: false,
        bypassed: false,
        executionError: null,
        label: `Audio Mix ${index}`,
      }
    case 'transform':
      return {
        id: `node-transform-${index.toString().padStart(2, '0')}`,
        type,
        position,
        data: {
          x: 0,
          y: 0,
          scale: 1,
          rotation: 0,
        },
        collapsed: false,
        bypassed: false,
        executionError: null,
        label: `Transform ${index}`,
      }
    case 'color_correct':
      return {
        id: `node-color-${index.toString().padStart(2, '0')}`,
        type,
        position,
        data: {
          lift: 0,
          gamma: 1,
          gain: 1,
        },
        collapsed: false,
        bypassed: false,
        executionError: null,
        label: `Color ${index}`,
      }
    case 'ai_generate':
      return {
        id: `node-ai-generate-${index.toString().padStart(2, '0')}`,
        type,
        position,
        data: {
          prompt: 'Cinematic neon city alley',
          negativePrompt: 'low quality, blurry',
          model: 'fluxnode-core',
          steps: 24,
          cfg: 6.5,
          seed: 'random',
          computeSource: 'project',
        },
        collapsed: false,
        bypassed: false,
        executionError: null,
        label: `AI Generate ${index}`,
      }
    case 'ai_upscale':
      return {
        id: `node-ai-upscale-${index.toString().padStart(2, '0')}`,
        type,
        position,
        data: {
          model: 'fluxnode-upscale-4x',
          scaleFactor: 4,
          computeSource: 'project',
        },
        collapsed: false,
        bypassed: false,
        executionError: null,
        label: `AI Upscale ${index}`,
      }
    case 'media_source':
      return {
        id: `${nextId('node-media')}-${index}`,
        type,
        position,
        data: {
          assetId: null,
          timelineClipId: null,
        },
        collapsed: false,
        bypassed: false,
        executionError: null,
        label: `Media Source ${index}`,
      }
    case 'shader':
      return createShaderNode(index)
  }
}

function createUniqueMediaSourceNodeId(project: FluxNodeProject, preferredIndex?: number) {
  const fallbackIndex = project.workflow.nodes.filter((node) => node.type === 'media_source').length + 1
  const baseIndex = preferredIndex ?? fallbackIndex
  const preferredId = `node-media-${baseIndex.toString().padStart(2, '0')}`

  if (!project.workflow.nodes.some((node) => node.id === preferredId)) {
    return preferredId
  }

  let collisionIndex = 1
  let candidateId = `${nextId('node-media')}-${collisionIndex}`
  while (project.workflow.nodes.some((node) => node.id === candidateId)) {
    collisionIndex += 1
    candidateId = `${nextId('node-media')}-${collisionIndex}`
  }

  return candidateId
}

function createMediaSourceNode(project: FluxNodeProject, clipId: string, assetId = 'asset-video-01', label?: string | null) {
  const mediaSourceCount = project.workflow.nodes.filter((node) => node.type === 'media_source').length
  const nextIndex = mediaSourceCount + 1

  return {
    id: createUniqueMediaSourceNodeId(project, nextIndex),
    type: 'media_source' as const,
    position: { x: 80, y: 240 + nextIndex * 90 },
    data: {
      assetId,
      timelineClipId: clipId,
    },
    collapsed: false,
    bypassed: false,
    executionError: null,
    label: label ?? `Media Source ${nextIndex}`,
  }
}

function buildLargeCanvasBenchmarkScene() {
  const mediaNodeCount = 40
  const shaderNodeCount = 40
  const branchCompositorCount = 38
  const nodes: WorkflowNode[] = []
  const edges: FluxNodeProject['workflow']['edges'] = []

  for (let index = 0; index < mediaNodeCount; index += 1) {
    nodes.push({
      id: `bench-media-${index + 1}`,
      type: 'media_source',
      position: { x: 80, y: 100 + index * 116 },
      data: {
        assetId: null,
        timelineClipId: null,
      },
      collapsed: index % 3 === 0,
      bypassed: false,
      executionError: null,
      label: `Bench Media ${index + 1}`,
    })
  }

  for (let index = 0; index < shaderNodeCount; index += 1) {
    nodes.push({
      id: `bench-shader-${index + 1}`,
      type: 'shader',
      position: { x: 430, y: 100 + index * 116 },
      data: {
        shaderSource: 'vec3 bench = color.rgb * 1.02;',
        uniforms: {
          intensity: {
            type: 'float',
            value: Number((0.6 + (index % 5) * 0.08).toFixed(2)),
          },
        },
        presetId: null,
      },
      collapsed: index % 4 === 0,
      bypassed: false,
      executionError: null,
      label: `Bench Shader ${index + 1}`,
    })
  }

  for (let index = 0; index < branchCompositorCount; index += 1) {
    nodes.push({
      id: `bench-comp-${index + 1}`,
      type: 'compositor',
      position: { x: 820, y: 110 + index * 120 },
      data: {
        blendMode: index % 2 === 0 ? 'screen' : 'overlay',
        layers: [],
      },
      collapsed: index % 5 === 0,
      bypassed: false,
      executionError: null,
      label: `Bench Comp ${index + 1}`,
    })
  }

  nodes.push({
    id: 'bench-final-comp',
    type: 'compositor',
    position: { x: 1230, y: 760 },
    data: {
      blendMode: 'normal',
      layers: [],
    },
    collapsed: false,
    bypassed: false,
    executionError: null,
    label: 'Bench Final Composite',
  })

  nodes.push({
    id: 'bench-output',
    type: 'output',
    position: { x: 1580, y: 760 },
    data: {
      format: 'mp4',
      resolution: 'project',
      frameRate: 'project',
    },
    collapsed: false,
    bypassed: false,
    executionError: null,
    label: 'Bench Output',
  })

  for (let index = 0; index < mediaNodeCount; index += 1) {
    edges.push({
      id: `bench-edge-media-shader-${index + 1}`,
      source: `bench-media-${index + 1}`,
      sourceHandle: 'video',
      target: `bench-shader-${index + 1}`,
      targetHandle: 'input',
    })
  }

  for (let shaderIndex = 0; shaderIndex < shaderNodeCount; shaderIndex += 1) {
    for (let branchOffset = 0; branchOffset < 5; branchOffset += 1) {
      const branchIndex = (shaderIndex + branchOffset * 7) % branchCompositorCount
      edges.push({
        id: `bench-edge-shader-comp-${shaderIndex + 1}-${branchOffset + 1}`,
        source: `bench-shader-${shaderIndex + 1}`,
        sourceHandle: 'output',
        target: `bench-comp-${branchIndex + 1}`,
        targetHandle: 'layer',
      })
    }
  }

  for (let index = 0; index < branchCompositorCount; index += 1) {
    edges.push({
      id: `bench-edge-comp-final-${index + 1}`,
      source: `bench-comp-${index + 1}`,
      sourceHandle: 'composite',
      target: 'bench-final-comp',
      targetHandle: 'layer',
    })
  }

  edges.push({
    id: 'bench-edge-final-output',
    source: 'bench-final-comp',
    sourceHandle: 'composite',
    target: 'bench-output',
    targetHandle: 'video',
  })

  return {
    nodes,
    edges,
    nodeCount: nodes.length,
    edgeCount: edges.length,
  }
}

function inferAssetType(inspection: AssetInspection): Asset['type'] {
  const extension = inspection.extension?.toLowerCase() ?? ''
  if (['mp4', 'mov', 'mkv', 'webm'].includes(extension)) return 'video'
  if (['wav', 'mp3', 'flac', 'aac'].includes(extension)) return 'audio'
  if (['png', 'jpg', 'jpeg', 'webp'].includes(extension)) return 'image'
  return 'lut'
}

function buildAssetFromInspection(
  assetId: string,
  inspection: AssetInspection,
  probe: AssetProbeResult = buildFallbackProbe(inspection.path, inspection.fileSize),
  statusOverride?: Asset['status'],
): Asset {
  const assetType = inferAssetType(inspection)

  return {
    id: assetId,
    name: inspection.fileName,
    type: assetType,
    sourcePath: inspection.path,
    relativePath: null,
    proxyPath: null,
    preferProxyForEditing: assetType === 'video',
    duration: assetType === 'image' ? null : probe.duration,
    metadata: {
      codec: probe.codec,
      width: probe.width,
      height: probe.height,
      frameRate: probe.frameRate,
      channels: probe.channels,
      sampleRate: probe.sampleRate,
      fileSize: probe.fileSize,
    },
    status: statusOverride ?? (inspection.exists ? 'linked' : 'missing'),
  }
}

function pushAssetCorruptError(
  set: StoreSetter,
  assetId: string,
  assetName: string,
  message: string,
  detail?: string | null,
) {
  pushAppError(set, {
    id: `${nextId('error')}-${assetId}`,
    category: 'asset_corrupt',
    message,
    userMessage: `${assetName} cannot be decoded.`,
    recoverable: true,
    suggestedAction: 'Replace the media with a healthy file or remove the affected clip from the timeline.',
    actionLabel: 'Replace Media',
    actionCommand: 'replace_media',
    contextId: assetId,
    detail: detail ?? null,
    createdAt: new Date().toISOString(),
  })
}

function resolveProjectRelativePath(projectPath: string | null, relativePath: string) {
  const normalizedRelative = relativePath.replace(/\\/g, '/')

  if (!projectPath) {
    return normalizedRelative
  }

  const normalizedProjectPath = projectPath.replace(/\\/g, '/').replace(/\/$/, '')
  return `${normalizedProjectPath}/${normalizedRelative}`
}

function resolveAssetRuntimePath(asset: Asset, currentProjectPath: string | null) {
  if (asset.relativePath) {
    return resolveProjectRelativePath(currentProjectPath, asset.relativePath)
  }

  return asset.sourcePath
}

function shouldOfferProxy(asset: Asset) {
  return (
    asset.type === 'video' &&
    ((asset.metadata.width ?? 0) > 1920 ||
      (asset.metadata.height ?? 0) > 1080 ||
      asset.metadata.fileSize > 100_000_000)
  )
}

async function generateThumbnailForAssetRecord(
  set: StoreSetter,
  get: () => ProjectStoreState,
  assetId: string,
) {
  const asset = get().project.assets.assets[assetId]
  const runtimePath = asset ? resolveAssetRuntimePath(asset, get().ui.currentProjectPath) : null

  if (!asset || asset.status === 'missing' || !runtimePath) {
    return
  }

  try {
    const thumbnail = await generateAssetThumbnail(asset.id, runtimePath, 0)
    touchAssetThumbnailAccess(asset.id)
    set((state) => ({
      ...trimRuntimeCachesForBudget({
        ...state,
        assetThumbnails: {
          ...state.assetThumbnails,
          [asset.id]: thumbnail,
        },
      }),
      project:
        !state.project.meta.thumbnailPath ||
        state.project.meta.thumbnailPath === state.assetThumbnails[asset.id]?.thumbnailPath
          ? {
              ...state.project,
              meta: {
                ...state.project.meta,
                thumbnailPath: thumbnail.thumbnailPath,
              },
            }
          : state.project,
      runtimeCacheMetrics: buildRuntimeCacheMetrics({
        ...state,
        assetThumbnails: {
          ...state.assetThumbnails,
          [asset.id]: thumbnail,
        },
      }),
    }))
  } catch (error) {
    applyMutation(set, get, 'asset.status.corrupt', 'Asset marked corrupt after thumbnail failure', (project) => {
      const target = project.assets.assets[asset.id]

      if (target && target.status !== 'missing') {
        target.status = 'corrupt'
      }
    })
    pushAppError(set, {
      id: nextId('error'),
      category: 'asset_corrupt',
      message: error instanceof Error ? error.message : `Thumbnail generation failed for ${asset.sourcePath}.`,
      userMessage: 'FluxNode could not generate a media thumbnail.',
      recoverable: true,
      suggestedAction: 'Re-import or relink the media, then try again.',
      createdAt: new Date().toISOString(),
    })
  }
}

async function generateThumbnailsForAssets(
  set: StoreSetter,
  get: () => ProjectStoreState,
  assetIds: string[],
) {
  await Promise.all(assetIds.map((assetId) => generateThumbnailForAssetRecord(set, get, assetId)))
}

async function replaceAssetPathById(
  set: StoreSetter,
  get: () => ProjectStoreState,
  assetId: string,
) {
  const nextPath = await pickMediaFile(
    'Enter the replacement media file path',
    getPreferredDirectory(get()),
  )

  if (!nextPath) {
    return
  }

  const copyIntoProject = window.confirm('Copy the replacement media into the current FluxNode project?')
  const copyResult =
    copyIntoProject ? await copyAssetIntoProject(assetId, nextPath).catch(() => null) : null
  const effectivePath = copyResult?.absolutePath ?? nextPath
  const inspection = await inspectAssetPath(effectivePath)

  let probe = buildFallbackProbe(effectivePath, inspection.fileSize)
  let probeFailed = false

  if (inspection.exists) {
    try {
      probe = await probeAssetMetadata(effectivePath)
    } catch {
      probeFailed = true
    }
  }

  applyMutation(set, get, 'asset.replace', 'Selected media replaced', (project) => {
    const asset = project.assets.assets[assetId]

    if (!asset) {
      return
    }

    const replacement = buildAssetFromInspection(
      asset.id,
      inspection,
      probe,
      inspection.exists && probeFailed ? 'corrupt' : undefined,
    )
    project.assets.assets[asset.id] = {
      ...replacement,
      id: asset.id,
      sourcePath: copyResult ? nextPath : replacement.sourcePath,
      relativePath: copyResult?.relativePath ?? null,
    }
  })

  if (inspection.exists && !probeFailed) {
    await generateThumbnailForAssetRecord(set, get, assetId)
  } else {
    set((state) => {
      const nextThumbnails = { ...state.assetThumbnails }
      const removedThumbnailPath = nextThumbnails[assetId]?.thumbnailPath ?? null
      delete nextThumbnails[assetId]
      assetThumbnailAccessOrder.delete(assetId)
      const fallbackThumbnail = Object.values(nextThumbnails)[0]?.thumbnailPath ?? null
      return {
        project:
          state.project.meta.thumbnailPath === removedThumbnailPath
            ? {
                ...state.project,
                meta: {
                  ...state.project.meta,
                  thumbnailPath: fallbackThumbnail,
                },
              }
            : state.project,
        assetThumbnails: nextThumbnails,
      }
    })
  }

  if (inspection.exists && probeFailed) {
    const replacementAsset = get().project.assets.assets[assetId]
    pushAssetCorruptError(
      set,
      assetId,
      replacementAsset?.name ?? assetId,
      `Probe failed for replacement media ${effectivePath}.`,
      'Metadata probe could not decode the replacement asset.',
    )
  }
}

function getOrCreateTrack(project: FluxNodeProject, type: 'video' | 'audio') {
  const existing = project.timeline.tracks.find((track) => track.type === type)

  if (existing) {
    return existing
  }

  const newTrack = {
    id: `track-${type}-${project.timeline.tracks.length + 1}`,
    name: `${type === 'video' ? 'Video' : 'Audio'} Track ${project.timeline.tracks.length + 1}`,
    type,
    locked: false,
    visible: true,
    muted: false,
    solo: false,
    volume: 1,
    pan: 0,
    height: type === 'video' ? 84 : 72,
    clips: [],
  } satisfies FluxNodeProject['timeline']['tracks'][number]

  project.timeline.tracks.push(newTrack)
  return newTrack
}

function getVideoTrack(project: FluxNodeProject) {
  return project.timeline.tracks.find((item) => item.type === 'video')
}

function getAllTimelineClips(project: FluxNodeProject) {
  return project.timeline.tracks.flatMap((track) => track.clips)
}

interface ClipLocation {
  trackId: string
  trackIndex: number
  clipIndex: number
}

// Derived by-id clip index, memoized per committed project reference (immer gives every
// mutation a new top-level `project` reference, so the WeakMap naturally invalidates once
// the project changes — no manual bookkeeping needed). This turns repeated by-id lookups
// against a *committed* project (i.e. `get().project` / `state.project`, never an in-flight
// immer draft that a caller might still be splicing) from O(clip count) into O(1) without
// changing the on-disk track/clip array shape. Not used inside mutate() callbacks, where the
// draft's contents can change mid-callback and would make a cached index stale.
const clipIndexByProject = new WeakMap<FluxNodeProject, Map<string, ClipLocation>>()

function getClipIndex(project: FluxNodeProject): Map<string, ClipLocation> {
  const cached = clipIndexByProject.get(project)

  if (cached) {
    return cached
  }

  const index = new Map<string, ClipLocation>()

  project.timeline.tracks.forEach((track, trackIndex) => {
    track.clips.forEach((clip, clipIndex) => {
      index.set(clip.id, { trackId: track.id, trackIndex, clipIndex })
    })
  })

  clipIndexByProject.set(project, index)
  return index
}

/** O(1) by-id clip lookup against a committed project snapshot. See getClipIndex for caching notes. */
function findCommittedClipById(project: FluxNodeProject, clipId: string) {
  const location = getClipIndex(project).get(clipId)
  return location ? project.timeline.tracks[location.trackIndex]?.clips[location.clipIndex] ?? null : null
}

/** O(1) by-id track lookup (which track owns this clip) against a committed project snapshot. */
function findCommittedTrackByClipId(project: FluxNodeProject, clipId: string) {
  const location = getClipIndex(project).get(clipId)
  return location ? project.timeline.tracks[location.trackIndex] ?? null : null
}

function getTimelineDuration(project: FluxNodeProject) {
  return Math.max(
    ...project.timeline.tracks.flatMap((track) =>
      track.clips.map((clip) => clip.startTime + clip.duration),
    ),
    project.timeline.outPoint ?? 0,
    0,
  )
}

function findTrackIndexByClipId(project: FluxNodeProject, clipId: string) {
  return project.timeline.tracks.findIndex((track) =>
    track.clips.some((clip) => clip.id === clipId),
  )
}

function createTrack(project: FluxNodeProject, type: Track['type'], index: number) {
  const nextNumber = project.timeline.tracks.filter((track) => track.type === type).length + 1

  return {
    id: `${nextId('track')}-${type}-${index}`,
    name: `${type.charAt(0).toUpperCase()}${type.slice(1)} Track ${nextNumber}`,
    type,
    locked: false,
    visible: true,
    muted: false,
    solo: false,
    volume: 1,
    pan: 0,
    height: type === 'video' ? 84 : 72,
    clips: [],
  } satisfies Track
}

function cloneClipForPaste(sourceClip: Clip, nextTrackId: string, startTime: number, suffix: string): Clip {
  return {
    ...sourceClip,
    id: `${sourceClip.id}-${suffix}`,
    trackId: nextTrackId,
    startTime,
    linkedClipId: null,
    workflowNodeId: null,
    keyframes: structuredClone(sourceClip.keyframes),
    transform: structuredClone(sourceClip.transform),
  }
}

function getActiveRenderJob(project: FluxNodeProject) {
  return (
    project.output.queue.find((job) => job.status === 'rendering') ??
    project.output.queue.find((job) => job.status === 'queued')
  )
}

/**
 * Trims a cache record down to `limit` entries. When `accessOrder` is provided, eviction is
 * true LRU (drop the entries with the oldest recorded access tick, keep the rest); otherwise
 * it falls back to the previous insertion-order behavior (drop the oldest-inserted entries).
 */
function trimRecordToLastN<T>(record: Record<string, T>, limit: number, accessOrder?: Map<string, number>) {
  const keys = Object.keys(record)

  if (keys.length <= limit) {
    return record
  }

  if (!accessOrder) {
    return Object.fromEntries(Object.entries(record).slice(Math.max(0, keys.length - limit)))
  }

  const keysByRecency = [...keys].sort((a, b) => (accessOrder.get(a) ?? 0) - (accessOrder.get(b) ?? 0))
  const evicted = new Set(keysByRecency.slice(0, keys.length - limit))

  for (const key of evicted) {
    accessOrder.delete(key)
  }

  return Object.fromEntries(Object.entries(record).filter(([key]) => !evicted.has(key)))
}

type TimelinePreviewRequest = {
  asset: Asset
  assetName: string
  previewSourcePath: string
  requestWidth: number
  requestHeight: number
  sourceTime: number
  cacheKey: string
}

function buildTimelinePreviewRequest(
  state: ProjectStoreState,
  width = 960,
  height = 540,
  sourceTimeOverride?: number,
): TimelinePreviewRequest | null {
  const selectedClipId = state.ui.selectedClipId

  if (!selectedClipId) {
    return null
  }

  const clip = findCommittedClipById(state.project, selectedClipId)

  if (!clip) {
    return null
  }

  const asset = state.project.assets.assets[clip.assetId]
  const runtimePath = asset ? resolveAssetRuntimePath(asset, state.ui.currentProjectPath) : null

  if (!asset || !runtimePath || (asset.type !== 'video' && asset.type !== 'image')) {
    return null
  }

  const previewSourcePath =
    state.project.settings.proxyEnabled && asset.proxyPath ? asset.proxyPath : runtimePath
  const requestScale = shouldReducePreviewResolution(state.runtimeHealth) ? 0.5 : 1
  const requestWidth = Math.max(256, Math.round(width * requestScale))
  const requestHeight = Math.max(144, Math.round(height * requestScale))
  const clipRelativeTime = Math.max(0, state.project.timeline.playhead - clip.startTime)
  const sourceTime = Number(
    (
      sourceTimeOverride ??
      (clip.inPoint + clipRelativeTime * clip.speed)
    ).toFixed(2),
  )

  return {
    asset,
    assetName: asset.name,
    previewSourcePath,
    requestWidth,
    requestHeight,
    sourceTime,
    cacheKey: `${asset.id}:${previewSourcePath}:${sourceTime}:${requestWidth}x${requestHeight}`,
  }
}

function buildTimelinePreviewWindowRequests(
  state: ProjectStoreState,
  width = 960,
  height = 540,
) {
  const currentRequest = buildTimelinePreviewRequest(state, width, height)

  if (!currentRequest) {
    return []
  }

  if (currentRequest.asset.type !== 'video') {
    return [currentRequest]
  }

  const selectedClipId = state.ui.selectedClipId
  const clip = selectedClipId ? findCommittedClipById(state.project, selectedClipId) : null

  if (!clip) {
    return [currentRequest]
  }

  const projectFrameRate = Math.max(1, Math.round(state.project.settings.frameRate || 30))
  const sourceFrameStep = clip.speed <= 0 ? 1 / projectFrameRate : clip.speed / projectFrameRate
  const requests = [currentRequest]
  const seenKeys = new Set([currentRequest.cacheKey])

  for (let frameOffset = 1; frameOffset <= TIMELINE_PREVIEW_PREFETCH_FRAMES; frameOffset += 1) {
    for (const direction of [-1, 1] as const) {
      const candidateTime = Math.max(0, currentRequest.sourceTime + sourceFrameStep * frameOffset * direction)
      const request = buildTimelinePreviewRequest(state, width, height, candidateTime)

      if (!request || seenKeys.has(request.cacheKey)) {
        continue
      }

      seenKeys.add(request.cacheKey)
      requests.push(request)
    }
  }

  return requests
}

function commitPreviewFrame(
  set: StoreSetter,
  request: TimelinePreviewRequest,
  frame: PreviewFrameData,
  options?: { background?: boolean },
) {
  touchPreviewFrameAccess(request.cacheKey)
  set((currentState) => {
    const nextPreviewFrames = {
      ...currentState.previewFrames,
      [request.cacheKey]: frame,
    }
    const trimmedCaches = trimRuntimeCachesForBudget({
      ...currentState,
      previewFrames: nextPreviewFrames,
    })
    const nextMetrics = buildRuntimeCacheMetrics({
      ...currentState,
      ...trimmedCaches,
    })
    const nextState = {
      ...currentState,
      ...trimmedCaches,
    }
    const softLimited = isMemorySoftLimited(nextState)

    return {
      ...trimmedCaches,
      runtimeCacheMetrics: nextMetrics,
      ui: {
        ...currentState.ui,
        performanceMode: softLimited ? 'gpu_guarded' : currentState.ui.performanceMode,
        statusMessage: options?.background
          ? currentState.ui.statusMessage
          : softLimited
            ? `Preview cache rotated for ${request.assetName}`
            : `Preview updated for ${request.assetName}`,
      },
    }
  })
}

async function decodeTimelinePreviewRequest(
  set: StoreSetter,
  get: () => ProjectStoreState,
  request: TimelinePreviewRequest,
  options?: { background?: boolean },
) {
  const currentState = get()

  if (currentState.previewFrames[request.cacheKey]) {
    touchPreviewFrameAccess(request.cacheKey)
    return false
  }

  if (pendingPreviewFrameRequests.has(request.cacheKey)) {
    return false
  }

  pendingPreviewFrameRequests.add(request.cacheKey)

  try {
    const frame = await decodePreviewFrame(
      request.asset.id,
      request.previewSourcePath,
      request.sourceTime,
      request.requestWidth,
      request.requestHeight,
    )
    commitPreviewFrame(set, request, frame, options)
    return true
  } finally {
    pendingPreviewFrameRequests.delete(request.cacheKey)
  }
}

function createEmptyWorkflowClipboard(): WorkflowClipboard {
  return {
    nodes: [],
    groups: [],
    edges: [],
  }
}

function createWorkflowGroupColor(index: number) {
  const colors = ['#e0ff00', '#3b82f6', '#f97316', '#14b8a6', '#f43f5e', '#a78bfa']
  return colors[index % colors.length]
}

function normalizeWorkflowGroups(project: FluxNodeProject) {
  if (!Array.isArray((project.workflow as { groups?: unknown }).groups)) {
    ;(project.workflow as FluxNodeProject['workflow']).groups = []
  }

  const nodeIdSet = new Set(project.workflow.nodes.map((node) => node.id))
  project.workflow.groups = project.workflow.groups
    .map((group) => ({
      ...group,
      nodeIds: group.nodeIds.filter((nodeId) => nodeIdSet.has(nodeId)),
    }))
    .filter((group) => group.nodeIds.length >= 2)
}

function getPreferredDirectory(state: ProjectStoreState) {
  return state.ui.currentProjectPath ?? state.preferences.defaultProjectDirectory
}

function estimateRuntimeCacheUsageMb(
  state: Pick<ProjectStoreState, 'previewFrames' | 'nodePreviewFrames' | 'waveformCache' | 'assetThumbnails'>,
) {
  const previewBytes = Object.values(state.previewFrames).reduce(
    (sum, frame) => sum + frame.dataUrl.length,
    0,
  )
  const nodePreviewBytes = Object.values(state.nodePreviewFrames).reduce(
    (sum, frame) => sum + frame.dataUrl.length,
    0,
  )
  const waveformBytes = Object.values(state.waveformCache).reduce(
    (sum, waveform) => sum + waveform.peaks.length * 16,
    0,
  )
  // Thumbnails are stored on disk (only a path is cached in memory), so we can't measure
  // their real byte size cheaply here. Estimating from the PATH STRING length previously
  // produced numbers unrelated to actual memory usage (a longer file path != a bigger
  // thumbnail); use a fixed per-thumbnail constant instead, calibrated to a typical small
  // JPEG/PNG timeline thumbnail.
  const thumbnailBytes = Object.keys(state.assetThumbnails).length * THUMBNAIL_ESTIMATED_BYTES

  return Number(((previewBytes + nodePreviewBytes + waveformBytes + thumbnailBytes) / 1_048_576).toFixed(1))
}

// Byte-per-structural-unit constants below are rough calibrations against typical
// serialized JSON size for each entity kind — intentionally approximate. The point of this
// estimate is to stay cheap (O(entity count), no stringify of the whole project) rather
// than to be byte-exact; it only feeds a soft/hard memory-pressure threshold check.
const FOOTPRINT_BYTES_PER_CLIP = 900
const FOOTPRINT_BYTES_PER_KEYFRAME = 150
const FOOTPRINT_BYTES_PER_TRACK = 300
const FOOTPRINT_BYTES_PER_NODE = 700
const FOOTPRINT_BYTES_PER_EDGE = 200
const FOOTPRINT_BYTES_PER_ASSET = 500
const FOOTPRINT_BYTES_PER_RENDER_JOB = 600
const FOOTPRINT_BYTES_PER_HISTORY_RECORD = 400
const FOOTPRINT_BASE_OVERHEAD_BYTES = 4_096

function estimateProjectFootprintMb(project: FluxNodeProject) {
  let clipCount = 0
  let keyframeCount = 0

  for (const track of project.timeline.tracks) {
    clipCount += track.clips.length
    for (const clip of track.clips) {
      keyframeCount += clip.keyframes.length
    }
  }

  const assetCount = Object.keys(project.assets.assets).length
  const historyRecordCount =
    project.meta.section11ProofHistory.length +
    project.meta.section11CoverageMapHistory.length +
    project.meta.section11CapturePacketHistory.length

  const estimatedBytes =
    clipCount * FOOTPRINT_BYTES_PER_CLIP +
    keyframeCount * FOOTPRINT_BYTES_PER_KEYFRAME +
    project.timeline.tracks.length * FOOTPRINT_BYTES_PER_TRACK +
    project.workflow.nodes.length * FOOTPRINT_BYTES_PER_NODE +
    project.workflow.edges.length * FOOTPRINT_BYTES_PER_EDGE +
    assetCount * FOOTPRINT_BYTES_PER_ASSET +
    project.output.queue.length * FOOTPRINT_BYTES_PER_RENDER_JOB +
    historyRecordCount * FOOTPRINT_BYTES_PER_HISTORY_RECORD +
    FOOTPRINT_BASE_OVERHEAD_BYTES

  return Number((estimatedBytes / 1_048_576).toFixed(2))
}

function getMemoryPressurePct(runtimeHealth: RuntimeHealth) {
  if (
    runtimeHealth.totalMemoryGb === null ||
    runtimeHealth.availableMemoryGb === null ||
    runtimeHealth.totalMemoryGb <= 0
  ) {
    return null
  }

  const usedPct =
    ((runtimeHealth.totalMemoryGb - runtimeHealth.availableMemoryGb) / runtimeHealth.totalMemoryGb) * 100

  return Number(Math.min(100, Math.max(0, usedPct)).toFixed(1))
}

function buildRuntimeCacheMetrics(
  state: Pick<ProjectStoreState, 'project' | 'runtimeHealth' | 'previewFrames' | 'nodePreviewFrames' | 'waveformCache' | 'assetThumbnails'>,
): RuntimeCacheMetrics {
  const estimatedUsageMb = estimateRuntimeCacheUsageMb(state)
  const estimatedAppFootprintMb = estimatedUsageMb + estimateProjectFootprintMb(state.project)
  const memoryPressurePct = getMemoryPressurePct(state.runtimeHealth)

  return {
    estimatedUsageMb,
    estimatedAppFootprintGb: Number((estimatedAppFootprintMb / 1024).toFixed(2)),
    memoryPressurePct,
    softLimitExceeded:
      estimatedAppFootprintMb >= APP_MEMORY_SOFT_LIMIT_MB ||
      (memoryPressurePct !== null && memoryPressurePct >= MEMORY_PRESSURE_EVICTION_THRESHOLD_PCT),
    hardLimitExceeded:
      estimatedAppFootprintMb >= APP_MEMORY_HARD_LIMIT_MB ||
      (memoryPressurePct !== null && memoryPressurePct >= 92),
  }
}

function isMemorySoftLimited(
  state: Pick<ProjectStoreState, 'project' | 'runtimeHealth' | 'previewFrames' | 'nodePreviewFrames' | 'waveformCache' | 'assetThumbnails'>,
) {
  return buildRuntimeCacheMetrics(state).softLimitExceeded
}

function isMemoryHardLimited(
  state: Pick<ProjectStoreState, 'project' | 'runtimeHealth' | 'previewFrames' | 'nodePreviewFrames' | 'waveformCache' | 'assetThumbnails'>,
) {
  return buildRuntimeCacheMetrics(state).hardLimitExceeded
}

function getCacheLimit(baseLimit: number, state: Pick<ProjectStoreState, 'project' | 'runtimeHealth' | 'previewFrames' | 'nodePreviewFrames' | 'waveformCache' | 'assetThumbnails'>) {
  return isMemorySoftLimited(state) ? Math.max(4, Math.floor(baseLimit / 2)) : baseLimit
}

function trimRuntimeCachesForBudget(
  state: Pick<ProjectStoreState, 'project' | 'runtimeHealth' | 'previewFrames' | 'nodePreviewFrames' | 'waveformCache' | 'assetThumbnails'>,
) {
  return {
    previewFrames: trimRecordToLastN(
      state.previewFrames,
      getCacheLimit(PREVIEW_FRAME_CACHE_LIMIT, state),
      previewFrameAccessOrder,
    ),
    // All four runtime caches evict by true LRU: each passes its own access-order map so a
    // hot entry (touched on cache-hit and on write) survives trimming over cold entries that
    // were produced once and never looked at again.
    nodePreviewFrames: trimRecordToLastN(
      state.nodePreviewFrames,
      getCacheLimit(NODE_PREVIEW_CACHE_LIMIT, state),
      nodePreviewFrameAccessOrder,
    ),
    waveformCache: trimRecordToLastN(
      state.waveformCache,
      getCacheLimit(WAVEFORM_CACHE_LIMIT, state),
      waveformAccessOrder,
    ),
    assetThumbnails: trimRecordToLastN(
      state.assetThumbnails,
      getCacheLimit(THUMBNAIL_CACHE_LIMIT, state),
      assetThumbnailAccessOrder,
    ),
  }
}

export function buildNodePreviewSource(workflow: FluxNodeProject['workflow'], nodeId: string) {
  const node = workflow.nodes.find((entry) => entry.id === nodeId)

  if (!node) {
    return null
  }

  const connectedInputs = workflow.edges
    .filter((edge) => edge.target === nodeId)
    .map((edge) => `${edge.source}:${edge.sourceHandle}->${edge.targetHandle}`)
    .sort()

  const signature = JSON.stringify({
    type: node.type,
    label: node.label,
    bypassed: node.bypassed,
    data: node.data,
    connectedInputs,
    computeMode: workflow.computeMode,
  })

  return `workflow://${node.id}/${encodeURIComponent(signature)}`
}

function findOutputNode(workflow: FluxNodeProject['workflow']) {
  return workflow.nodes.find((node) => node.type === 'output') ?? null
}

function getWorkflowAudioSummary(project: FluxNodeProject) {
  const outputNode = findOutputNode(project.workflow)

  if (!outputNode) {
    return {
      audioMode: 'muted' as const,
      audioSourceSummary: 'No output node available',
    }
  }

  const outputAudioEdge = project.workflow.edges.find(
    (edge) => edge.target === outputNode.id && edge.targetHandle === 'audio',
  )

  if (!outputAudioEdge) {
    return {
      audioMode: 'muted' as const,
      audioSourceSummary: 'No audio connected to output',
    }
  }

  const sourceNode = project.workflow.nodes.find((node) => node.id === outputAudioEdge.source)

  if (!sourceNode) {
    return {
      audioMode: 'muted' as const,
      audioSourceSummary: 'Audio connection source missing',
    }
  }

  if (sourceNode.bypassed) {
    return {
      audioMode: 'muted' as const,
      audioSourceSummary: `${sourceNode.label ?? sourceNode.id} is bypassed`,
      mixNodeId: sourceNode.id,
      connectedInputNodeIds: [],
    }
  }

  if (sourceNode.type === 'audio_mix') {
    const inputEdges = project.workflow.edges.filter(
      (edge) => edge.target === sourceNode.id && edge.targetHandle === 'input',
    )

    return {
      audioMode: 'muxed' as const,
      audioSourceSummary: `${sourceNode.label ?? 'Audio Mix'} muxes ${inputEdges.length} input(s)`,
      mixNodeId: sourceNode.id,
      connectedInputNodeIds: inputEdges.map((edge) => edge.source),
    }
  }

  return {
    audioMode: 'muxed' as const,
    audioSourceSummary: `${sourceNode.label ?? sourceNode.id} routed directly to output`,
    mixNodeId: null,
    connectedInputNodeIds: [sourceNode.id],
  }
}

function resolvePresetResolution(
  project: FluxNodeProject,
  preset: FluxNodeProject['output']['presets'][number],
) {
  return preset.resolution === 'project' ? project.settings.resolution : preset.resolution
}

function resolvePresetFrameRate(
  project: FluxNodeProject,
  preset: FluxNodeProject['output']['presets'][number],
) {
  return preset.frameRate === 'project' ? project.settings.frameRate : preset.frameRate
}

function buildRenderRange(project: FluxNodeProject): RenderConfig['range'] {
  if (project.timeline.inPoint !== null || project.timeline.outPoint !== null) {
    return 'in_out'
  }

  return 'full'
}

function buildRenderConfig(
  project: FluxNodeProject,
  preset: FluxNodeProject['output']['presets'][number],
  outputPath: string,
): RenderConfig {
  return {
    outputPath,
    format: {
      container: preset.format,
      videoCodec: preset.videoCodec,
      audioCodec: preset.audioCodec,
      quality: preset.quality,
    },
    resolution: resolvePresetResolution(project, preset),
    frameRate: resolvePresetFrameRate(project, preset),
    range: buildRenderRange(project),
    useProxy: false,
    denoising: project.workflow.nodes.some((node) => !node.bypassed && (node.type === 'ai_generate' || node.type === 'ai_upscale')),
    metadata: {
      title: project.meta.name,
      comment: `Exported from FluxNode project ${project.meta.id}`,
    },
  }
}

function collectRenderBlockingIssues(project: FluxNodeProject) {
  const blockingIssues: string[] = []
  const workflowValidation = validateWorkflowGraph(project.workflow)
  const projectValidation = validateProject(project)

  blockingIssues.push(
    ...workflowValidation.issues
      .filter((issue) => issue.level === 'error')
      .map((issue) => issue.message),
  )
  blockingIssues.push(
    ...projectValidation
      .filter((issue) => issue.level === 'error')
      .map((issue) => issue.message),
  )

  for (const node of project.workflow.nodes) {
    if (node.bypassed) {
      continue
    }

    const definition = NODE_PORT_DEFINITIONS[node.type]
    for (const input of definition.inputs.filter((port) => port.required)) {
      const hasConnection = project.workflow.edges.some(
        (edge) => edge.target === node.id && edge.targetHandle === input.name,
      )

      if (!hasConnection) {
        blockingIssues.push(`${node.label ?? node.id} is missing required input "${input.name}".`)
      }
    }
  }

  const offlineAssets = project.timeline.tracks
    .flatMap((track) => track.clips)
    .map((clip) => project.assets.assets[clip.assetId])
    .filter((asset): asset is NonNullable<typeof asset> => Boolean(asset))
    .filter((asset) => asset.status === 'missing' || asset.status === 'corrupt')

  for (const asset of offlineAssets) {
    blockingIssues.push(
      asset.status === 'corrupt'
        ? `${asset.name} cannot be decoded. Export requires a healthy replacement source file.`
        : `${asset.name} is offline. Export requires the original source file.`,
    )
  }

  return Array.from(new Set(blockingIssues))
}

function cloneDetachedPanelLayout(layout: DetachedPanelLayout): DetachedPanelLayout {
  return {
    detached: layout.detached,
    width: layout.width,
    height: layout.height,
    x: layout.x,
    y: layout.y,
  }
}

function shouldReducePreviewResolution(runtimeHealth: RuntimeHealth) {
  return runtimeHealth.vramUtilizationPct !== null && runtimeHealth.vramUtilizationPct >= 90
}

function shouldBlockGpuOperations(runtimeHealth: RuntimeHealth) {
  return runtimeHealth.vramUtilizationPct !== null && runtimeHealth.vramUtilizationPct >= 95
}

function buildRenderFailureError(job: {
  id: string
  currentFrame: number
  errorCategory: AppError['category']
  lastError: string | null
  quotaResetAt: string | null
  quotaUsageSummary: string | null
  computeMode: 'local' | 'cloud'
}): AppError {
  if (job.errorCategory === 'cloud_quota') {
    const resetAtLabel = job.quotaResetAt
      ? `Quota resets at ${new Date(job.quotaResetAt).toLocaleTimeString()}.`
      : 'Quota reset time is pending from the provider.'

    return {
      id: `${nextId('error')}-${job.id}-quota`,
      category: 'cloud_quota',
      message: job.lastError ?? `Cloud quota exceeded for render job ${job.id}.`,
      userMessage: 'Cloud quota has been exceeded for this render.',
      recoverable: true,
      suggestedAction: `${job.quotaUsageSummary ?? 'Reduce cloud render usage or wait for reset.'} ${resetAtLabel}`,
      actionLabel: job.computeMode === 'cloud' ? 'Switch to Local' : 'Open Settings',
      actionCommand: job.computeMode === 'cloud' ? 'switch_local_compute' : 'open_settings',
      contextId: job.id,
      detail: job.lastError,
      resetAt: job.quotaResetAt,
      createdAt: new Date().toISOString(),
    }
  }

  return {
    id: `${nextId('error')}-${job.id}-failed`,
    category: job.errorCategory,
    message: job.lastError ?? `Render job ${job.id} failed at frame ${job.currentFrame}.`,
    userMessage: 'Render stopped before completion.',
    recoverable: true,
    suggestedAction: `Retry from frame ${job.currentFrame} or queue the export again.`,
    actionLabel: 'Retry Render',
    actionCommand: 'retry_render',
    contextId: job.id,
    detail: job.lastError,
    createdAt: new Date().toISOString(),
  }
}

function pushAppError(set: StoreSetter, error: AppError) {
  set((state) => ({
    appErrors: [
      ...state.appErrors.filter(
        (existing) =>
          !(
            existing.category === error.category &&
            existing.message === error.message &&
            existing.contextId === error.contextId
          ),
      ),
      error,
    ],
  }))
}

function removeAppErrors(set: StoreSetter, predicate: (error: AppError) => boolean) {
  set((state) => ({
    appErrors: state.appErrors.filter((error) => !predicate(error)),
  }))
}

function clearRecoveryTimer(kind: RecoveryKind) {
  const timer = recoveryTimers[kind]
  if (timer !== null) {
    window.clearTimeout(timer)
    recoveryTimers[kind] = null
  }
}

function clearRenderRetryTimer(jobId: string) {
  const timer = renderRetryTimers.get(jobId)
  if (timer !== undefined) {
    window.clearTimeout(timer)
    renderRetryTimers.delete(jobId)
  }
}

function reduceRenderResolution(resolution: { width: number; height: number }) {
  const nextWidth = Math.max(640, Math.round((resolution.width * 0.75) / 2) * 2)
  const nextHeight = Math.max(360, Math.round((resolution.height * 0.75) / 2) * 2)

  return {
    width: nextWidth,
    height: nextHeight,
  }
}

function scheduleRenderAutoRetry(
  set: StoreSetter,
  get: () => ProjectStoreState,
  jobId: string,
  reason: 'cloud_network' | 'gpu_oom',
) {
  const job = get().project.output.queue.find((entry) => entry.id === jobId)

  if (!job) {
    return false
  }

  if (renderRetryTimers.has(jobId)) {
    return true
  }

  if (reason === 'cloud_network') {
    if (job.computeMode !== 'cloud' || job.retryCount >= 3) {
      return false
    }

    const nextRetryCount = job.retryCount + 1
    const delay = RECOVERY_BACKOFF_MS[job.retryCount] ?? RECOVERY_BACKOFF_MS[RECOVERY_BACKOFF_MS.length - 1]
    const scheduledFor = new Date(Date.now() + delay).toISOString()

    applyMutation(set, get, 'render.queue.retry.schedule', 'Render auto-retry scheduled', (project) => {
      const targetJob = project.output.queue.find((entry) => entry.id === jobId)

      if (!targetJob) {
        return
      }

      targetJob.retryCount = nextRetryCount
      targetJob.maxAutoRetries = 3
      targetJob.autoRetryReason = 'cloud_network'
      targetJob.autoRetryScheduledFor = scheduledFor
      targetJob.updatedAt = new Date().toISOString()
    })

    renderRetryTimers.set(
      jobId,
      window.setTimeout(() => {
        clearRenderRetryTimer(jobId)
        void get().retryFailedRender(jobId, { automatic: true })
      }, delay),
    )

    return true
  }

  if (job.didFallbackResolution) {
    return false
  }

  const nextResolution = reduceRenderResolution(job.config.resolution)
  if (
    nextResolution.width === job.config.resolution.width &&
    nextResolution.height === job.config.resolution.height
  ) {
    return false
  }

  const scheduledFor = new Date(Date.now() + 1_200).toISOString()
  applyMutation(set, get, 'render.queue.retry.schedule.gpu', 'Render GPU fallback scheduled', (project) => {
    const targetJob = project.output.queue.find((entry) => entry.id === jobId)

    if (!targetJob) {
      return
    }

    targetJob.config.resolution = nextResolution
    targetJob.retryCount = 1
    targetJob.maxAutoRetries = 1
    targetJob.autoRetryReason = 'gpu_oom'
    targetJob.autoRetryScheduledFor = scheduledFor
    targetJob.didFallbackResolution = true
    targetJob.updatedAt = new Date().toISOString()
  })

  renderRetryTimers.set(
    jobId,
    window.setTimeout(() => {
      clearRenderRetryTimer(jobId)
      void get().retryFailedRender(jobId, { automatic: true })
    }, 1_200),
  )

  return true
}

function scheduleRecoveryRetry(
  kind: RecoveryKind,
  set: StoreSetter,
  get: () => ProjectStoreState,
  message: string,
) {
  const attempt = get().recoveryAttempts[kind]

  if (attempt >= RECOVERY_BACKOFF_MS.length || recoveryTimers[kind] !== null) {
    return
  }

  const delay = RECOVERY_BACKOFF_MS[attempt]
  set((state) => ({
    ui: {
      ...state.ui,
      statusMessage: `${message} Retrying in ${Math.round(delay / 1000)}s (${attempt + 1}/3)`,
    },
  }))

  recoveryTimers[kind] = window.setTimeout(() => {
    recoveryTimers[kind] = null
    set((state) => ({
      recoveryAttempts: {
        ...state.recoveryAttempts,
        [kind]: state.recoveryAttempts[kind] + 1,
      },
      ui: {
        ...state.ui,
        statusMessage: `${message} Retrying now (${state.recoveryAttempts[kind] + 1}/3)`,
      },
    }))

    const navigatorOnline =
      typeof navigator === 'undefined' ? null : navigator.onLine

    if (kind === 'cloudNetwork' && navigatorOnline !== null) {
      set((state) => ({
        ui: {
          ...state.ui,
          networkStatus: navigatorOnline ? 'online' : 'offline',
        },
      }))
    }

    void get().refreshRuntimeHealth()
  }, delay)
}

function inferErrorCategory(message: string, fallback: AppError['category']): AppError['category'] {
  const normalized = message.toLowerCase()

  if (normalized.includes('quota') || normalized.includes('rate limit')) {
    return 'cloud_quota'
  }

  if (normalized.includes('auth') || normalized.includes('api key') || normalized.includes('unauthorized')) {
    return 'cloud_auth'
  }

  if (normalized.includes('network') || normalized.includes('offline') || normalized.includes('connection')) {
    return 'cloud_network'
  }

  if (normalized.includes('comfyui') || normalized.includes('backend')) {
    return 'comfy_connection'
  }

  if (normalized.includes('disk') || normalized.includes('space') || normalized.includes('storage')) {
    return 'disk_full'
  }

  if (normalized.includes('gpu') || normalized.includes('memory') || normalized.includes('oom')) {
    return 'gpu_oom'
  }

  return fallback
}

/** Fire-and-forget WAL append that surfaces failures as a real app error instead of swallowing them. */
function appendWalSafely(
  set: StoreSetter,
  entry: { id: string; timestamp: string; type: string; label: string; project: FluxNodeProject; patches: Patch[] },
) {
  void projectRepository
    .appendWal({
      id: entry.id,
      timestamp: entry.timestamp,
      type: entry.type,
      label: entry.label,
      // Always hand the repository the full current project reference (cheap: with immer
      // this is a reference, not a copy) alongside the forward patches for this change. The
      // repository decides per-entry whether to persist the full snapshot (periodic "base"
      // entries) or just the patches (see LocalProjectRepository.appendWal).
      projectSnapshot: entry.project,
      patches: entry.patches,
    })
    .catch((error: unknown) => {
      pushAppError(set, {
        id: nextId('error'),
        category: 'disk_full',
        message: error instanceof Error ? error.message : 'Failed to append crash-recovery log entry.',
        userMessage: 'Local storage is full — recent changes may not be recoverable after a crash.',
        recoverable: true,
        suggestedAction: 'Save your project now to persist your work durably.',
        actionLabel: 'Save Project',
        actionCommand: 'save_project',
        contextId: null,
        detail: null,
        createdAt: new Date().toISOString(),
      })
    })
}

/**
 * Applies a single project mutation through immer's `produceWithPatches`, so only the
 * paths actually touched by `mutate` are cloned (structural sharing for everything else)
 * instead of the previous four `structuredClone(project)` calls per mutation. History now
 * records immer patches/inversePatches rather than full before/after project snapshots.
 */
function applyMutation(
  set: StoreSetter,
  get: () => ProjectStoreState,
  type: string,
  label: string,
  mutate: (project: FluxNodeProject) => void,
) {
  const before = get().project
  const [after, patches, inversePatches] = produceWithPatches(before, (draft) => {
    mutate(draft as FluxNodeProject)
    syncUpdatedAt(draft as FluxNodeProject)
  })
  const validationState = getValidationState(after)
  const commandId = nextId(type)
  const walTimestamp = new Date().toISOString()

  set((state) => ({
    project: after,
    runtimeCacheMetrics: buildRuntimeCacheMetrics({
      ...state,
      project: after,
    }),
    collaborationState: {
      lastLocalProjectMutationAt: Date.now(),
      lastLocalProjectMutationLabel: label,
    },
    history: pushCommand(state.history, {
      id: commandId,
      type,
      label,
      timestamp: Date.now(),
      patches,
      inversePatches,
    }),
    ...validationState,
    ui: {
      ...state.ui,
      statusMessage: `${label} complete`,
    },
  }))

  appendWalSafely(set, { id: commandId, timestamp: walTimestamp, type, label, project: after, patches })
}

function applyGroupedMutations(
  set: StoreSetter,
  get: () => ProjectStoreState,
  type: string,
  label: string,
  steps: Array<{
    type: string
    label: string
    mutate: (project: FluxNodeProject) => void
  }>,
) {
  if (steps.length === 0) {
    return
  }

  const baseTimestamp = Date.now()
  let workingProject = get().project
  let history = beginHistoryGroup(get().history, type, label, nextId(type))
  const walTimestamp = new Date(baseTimestamp).toISOString()
  const groupPatches: Patch[] = []

  steps.forEach((step, index) => {
    const [nextProject, patches, inversePatches] = produceWithPatches(workingProject, (draft) => {
      step.mutate(draft as FluxNodeProject)
      syncUpdatedAt(draft as FluxNodeProject)
    })
    workingProject = nextProject
    groupPatches.push(...patches)
    history = pushCommand(history, {
      id: nextId(step.type),
      type: step.type,
      label: step.label,
      timestamp: baseTimestamp + index,
      patches,
      inversePatches,
    })
  })

  const afterGroup = workingProject
  const validationState = getValidationState(afterGroup)
  const finalizedHistory = endHistoryGroup(history)
  const walId = nextId(type)

  set((state) => ({
    project: afterGroup,
    runtimeCacheMetrics: buildRuntimeCacheMetrics({
      ...state,
      project: afterGroup,
    }),
    collaborationState: {
      lastLocalProjectMutationAt: Date.now(),
      lastLocalProjectMutationLabel: label,
    },
    history: finalizedHistory,
    ...validationState,
    ui: {
      ...state.ui,
      statusMessage: `${label} complete`,
    },
  }))

  appendWalSafely(set, {
    id: walId,
    timestamp: walTimestamp,
    type,
    label,
    project: afterGroup,
    patches: groupPatches,
  })
}

export const useProjectStore = create<ProjectStoreState>((set, get) => ({
  project: createDefaultProject(),
  preferences: {
    defaultProjectDirectory: null,
    comfyUiEndpoint: 'http://127.0.0.1:8188',
    cloudApiKey: '',
    updateChannel: 'stable',
    updateManifestUrl: null,
    keybindings: DEFAULT_KEYBINDINGS,
    density: DEFAULT_DENSITY_MODE,
    workspaceLayout: 'studio',
  },
  history: createHistoryState(),
  recentProjects: [],
  appErrors: [],
  recoveryAttempts: {
    cloudNetwork: 0,
    comfyConnection: 0,
  },
  workspaceSyncConflicts: [],
  collaborationState: {
    lastLocalProjectMutationAt: null,
    lastLocalProjectMutationLabel: null,
  },
  appUpdateState: createInitialAppUpdateState(),
  runtimeHealth: {
    backend: 'browser',
    status: 'unknown',
    appDataDir: null,
    os: null,
    osVersion: null,
    arch: null,
    cpuCores: null,
    deviceMemoryGb: null,
    totalMemoryGb: null,
    availableMemoryGb: null,
    diskFreeGb: null,
    diskCapacityGb: null,
    vramTotalGb: null,
    vramUsedGb: null,
    vramUtilizationPct: null,
    lastCheckedAt: null,
  },
  runtimeCacheMetrics: {
    estimatedUsageMb: 0,
    estimatedAppFootprintGb: 0,
    memoryPressurePct: null,
    softLimitExceeded: false,
    hardLimitExceeded: false,
  },
  waveformCache: {},
  previewFrames: {},
  nodePreviewFrames: {},
  aiNodeGenerationInFlight: {},
  comfyConnected: null,
  assetThumbnails: {},
  ...getValidationState(createDefaultProject()),
  ui: {
    // Boot into the Edit workspace (studio layout's timeline-first grammar). Node-centric verbs
    // (openNodePicker, showSelectedClipInWorkflow, …) still jump to 'workflow' explicitly.
    activeView: 'timeline',
    // First boot only — any dismissal path marks the flag (see dismissWelcome) so returning
    // users go straight to the editor. e2e clears storage per test, so specs still see it.
    showWelcome: !hasSeenWelcome(),
    showSettings: false,
    showWorkspaceSharing: false,
    showNodePicker: false,
    statusMessage: 'Foundation store ready',
    currentProjectPath: null,
    lastSavedAt: null,
    lastAutoSavedAt: null,
    selectedClipId: null,
    selectedClipIds: [],
    selectedTrackId: null,
    selectedNodeId: null,
    selectedNodeIds: [],
    networkStatus: typeof navigator !== 'undefined' && navigator.onLine ? 'online' : 'offline',
    performanceMode: 'balanced',
    playbackState: 'paused',
    playbackRate: 1,
    viewSwitchMetric: createIdleViewSwitchMetric(),
    workflowBenchmarkMetric: createIdleWorkflowBenchmarkMetric(),
    scrubPreviewState: createIdleScrubPreviewState(),
    workflowConnectionFeedback: createIdleWorkflowConnectionFeedback(),
    timelineClipboard: [],
    workflowClipboard: createEmptyWorkflowClipboard(),
  },
  setActiveView: (view) =>
    set((state) => ({
      ui: { ...state.ui, ...computeActiveViewUiPatch(state.ui, view) },
      // MERIDIAN strata shell: both strata always render, so "switching views" now means
      // sliding the horizon to that view's default detent (spec F.2) rather than mounting a
      // different component. This keeps every existing caller (Header's mode buttons, the
      // `global.toggleView` shortcut) working unchanged while driving the new splitter.
      project: {
        ...state.project,
        meta: {
          ...state.project.meta,
          horizonRatio: defaultRatioForView(view),
        },
      },
    })),
  setHorizonRatio: (ratio) =>
    set((state) => {
      const clamped = clampHorizonRatio(ratio)
      const nextProject = {
        ...state.project,
        meta: { ...state.project.meta, horizonRatio: clamped },
      }

      const nextView = activeViewForRatio(clamped)

      if (nextView === state.ui.activeView) {
        return { project: nextProject }
      }

      // The splitter crossed the midpoint: keep `ui.activeView` (and everything gated on it —
      // keyboard shortcut scope, the preview title, PreviewPanel's inspector target) in sync
      // with whichever stratum now has more room. Unlike `setActiveView`, this deliberately
      // does NOT clear selection or emit a "Switched to..." status toast: in the strata shell
      // both strata stay visible across a ratio flip, so the user's selection on either side
      // is still on screen and must survive (review round-1 blocking item 1).
      return {
        project: nextProject,
        ui: { ...state.ui, activeView: nextView },
      }
    }),
  // MERIDIAN stage row (item 3): mirrors `setHorizonRatio`'s pattern — a direct `set` on
  // `project.meta`, not routed through `applyMutation`/undo history. Rail collapse is layout
  // state (like the horizon ratio and detached-panel geometry), not project *content*, so it
  // shouldn't show up in the undo stack or dirty the "unsaved changes" story any differently
  // than dragging the horizon does.
  toggleStageRowCollapse: (side) =>
    set((state) => ({
      project: {
        ...state.project,
        meta: {
          ...state.project.meta,
          stageRowCollapse: {
            ...state.project.meta.stageRowCollapse,
            [side]: !state.project.meta.stageRowCollapse[side],
          },
        },
      },
    })),
  recordViewSwitchMetric: (metric) =>
    set((state) => ({
      ui: {
        ...state.ui,
        viewSwitchMetric: metric,
      },
    })),
  recordWorkflowBenchmarkMetric: (metric) =>
    set((state) => ({
      ui: {
        ...state.ui,
        workflowBenchmarkMetric: {
          ...state.ui.workflowBenchmarkMetric,
          ...metric,
        },
      },
    })),
  saveSection11ProofRecord: (proof) =>
    applyMutation(set, get, 'system.section11-proof.save', 'Section 11 proof snapshot saved', (project) => {
      project.meta.section11ProofHistory = [
        proof,
        ...project.meta.section11ProofHistory.filter((entry) => entry.id !== proof.id),
      ].slice(0, 12)
    }),
  saveSection11CoverageMapRecord: (coverageMap) =>
    applyMutation(set, get, 'system.section11-coverage-map.save', 'Section 11 coverage map saved', (project) => {
      project.meta.section11CoverageMapHistory = [
        coverageMap,
        ...project.meta.section11CoverageMapHistory.filter((entry) => entry.generatedAt !== coverageMap.generatedAt),
      ].slice(0, 12)
    }),
  setSection11TargetProfileOverride: (label) =>
    applyMutation(set, get, 'system.section11-target-profile.set', 'Section 11 target profile updated', (project) => {
      project.meta.section11TargetProfileOverride = label
    }),
  saveSection11CapturePacketRecord: (capturePacket) =>
    applyMutation(set, get, 'system.section11-capture-packet.save', 'Section 11 capture packet saved', (project) => {
      project.meta.section11CapturePacketHistory = [
        capturePacket,
        ...project.meta.section11CapturePacketHistory.filter((entry) => entry.generatedAt !== capturePacket.generatedAt),
      ].slice(0, 12)
    }),
  clearSection11ProofHistory: () =>
    applyMutation(set, get, 'system.section11-proof.clear', 'Section 11 proof history cleared', (project) => {
      project.meta.section11ProofHistory = []
    }),
  clearSection11CoverageMapHistory: () =>
    applyMutation(set, get, 'system.section11-coverage-map.clear', 'Section 11 coverage map history cleared', (project) => {
      project.meta.section11CoverageMapHistory = []
    }),
  clearSection11CapturePacketHistory: () =>
    applyMutation(set, get, 'system.section11-capture-packet.clear', 'Section 11 capture packet history cleared', (project) => {
      project.meta.section11CapturePacketHistory = []
    }),
  toggleComputeMode: () =>
    applyMutation(set, get, 'workflow.compute.toggle', 'Compute mode updated', (project) => {
      if (get().ui.networkStatus === 'offline') {
        project.workflow.computeMode = 'local'
        return
      }

      project.workflow.computeMode = project.workflow.computeMode === 'local' ? 'cloud' : 'local'
    }),
  toggleProxyMode: () =>
    applyMutation(set, get, 'settings.proxy.toggle', 'Proxy mode updated', (project) => {
      project.settings.proxyEnabled = !project.settings.proxyEnabled
    }),
  dismissWelcome: () => {
    markWelcomeSeen()
    set((state) => ({
      ui: {
        ...state.ui,
        showWelcome: false,
        statusMessage: 'Demo project ready',
      },
    }))
  },
  openSettings: () =>
    set((state) => ({
      ui: {
        ...state.ui,
        showSettings: true,
        statusMessage: 'Settings opened',
      },
    })),
  closeSettings: () =>
    set((state) => ({
      ui: {
        ...state.ui,
        showSettings: false,
        statusMessage: 'Settings closed',
      },
    })),
  openWorkspaceSharing: () =>
    set((state) => ({
      ui: {
        ...state.ui,
        showWorkspaceSharing: true,
        statusMessage: 'Workspace sharing opened',
      },
    })),
  closeWorkspaceSharing: () =>
    set((state) => ({
      ui: {
        ...state.ui,
        showWorkspaceSharing: false,
        statusMessage: 'Workspace sharing closed',
      },
    })),
  registerWorkspaceSyncConflict: (conflict) =>
    set((state) => ({
      workspaceSyncConflicts: [conflict, ...state.workspaceSyncConflicts].slice(0, 12),
      ui: {
        ...state.ui,
        statusMessage: 'Workspace sync conflict detected',
      },
    })),
  resolveWorkspaceSyncConflict: (conflictId, resolution) => {
    const conflict = get().workspaceSyncConflicts.find((entry) => entry.id === conflictId)
    if (!conflict) {
      return
    }

    const nextProject = cloneProject(
      resolution === 'local' ? conflict.localProjectSnapshot : conflict.remoteProjectSnapshot,
    )
    const validationState = getValidationState(nextProject)

    set((state) => ({
      project: nextProject,
      runtimeCacheMetrics: buildRuntimeCacheMetrics({
        ...state,
        project: nextProject,
      }),
      ...validationState,
      collaborationState: {
        lastLocalProjectMutationAt: Date.now(),
        lastLocalProjectMutationLabel: `workspace conflict ${resolution}`,
      },
      workspaceSyncConflicts: state.workspaceSyncConflicts.map((entry) =>
        entry.id === conflictId ? { ...entry, resolvedWith: resolution } : entry,
      ),
      ui: {
        ...state.ui,
        statusMessage: `Workspace conflict resolved with ${resolution} version`,
      },
    }))
  },
  dismissWorkspaceSyncConflict: (conflictId) =>
    set((state) => ({
      workspaceSyncConflicts: state.workspaceSyncConflicts.filter((entry) => entry.id !== conflictId),
      ui: {
        ...state.ui,
        statusMessage: 'Workspace conflict dismissed',
      },
    })),
  openNodePicker: () =>
    set((state) => ({
      ui: {
        ...state.ui,
        activeView: 'workflow',
        showNodePicker: true,
        statusMessage: 'Node picker opened',
      },
    })),
  closeNodePicker: () =>
    set((state) => ({
      ui: {
        ...state.ui,
        showNodePicker: false,
        statusMessage: 'Node picker closed',
      },
    })),
  openDetachedPanel: async (panel) => {
    const currentLayout = cloneDetachedPanelLayout(get().project.meta.panelLayouts[panel])
    const nextLayout = await openDetachedPanelWindow(panel, currentLayout)

    applyMutation(set, get, 'panel.detach', `${panel} panel detached`, (project) => {
      project.meta.panelLayouts[panel] = {
        ...project.meta.panelLayouts[panel],
        ...nextLayout,
        detached: true,
      }
    })
  },
  closeDetachedPanel: async (panel) => {
    const latestLayout = await closeDetachedPanelWindow(panel)

    applyMutation(set, get, 'panel.attach', `${panel} panel reattached`, (project) => {
      project.meta.panelLayouts[panel] = {
        ...project.meta.panelLayouts[panel],
        ...(latestLayout ?? {}),
        detached: false,
      }
    })
  },
  loadAppPreferences: async () => {
    const preferences = await loadAppPreferences()
    set({ preferences })
  },
  loadCurrentAppVersion: async () => {
    try {
      const currentVersion = await getCurrentAppVersion()
      set((state) => ({
        appUpdateState: {
          ...state.appUpdateState,
          versionInfo: {
            currentVersion,
            backend: state.runtimeHealth.backend,
            loadedAt: new Date().toISOString(),
          },
        },
      }))
    } catch (error) {
      set((state) => ({
        appUpdateState: {
          ...state.appUpdateState,
          status: 'error',
          downloadStatus: 'error',
          errorMessage: error instanceof Error ? error.message : 'Unable to read the current app version.',
        },
      }))
    }
  },
  setDefaultProjectDirectory: async (path) => {
    const nextPreferences = {
      ...get().preferences,
      defaultProjectDirectory: path,
    }
    await saveAppPreferences(nextPreferences)
    set((state) => ({
      preferences: nextPreferences,
      ui: {
        ...state.ui,
        statusMessage: path ? 'Default project directory updated' : 'Default project directory cleared',
      },
    }))
  },
  setUpdateChannel: async (channel) => {
    const nextPreferences = {
      ...get().preferences,
      updateChannel: channel.trim().length > 0 ? channel.trim() : 'stable',
    }
    await saveAppPreferences(nextPreferences)
    set((state) => ({
      preferences: nextPreferences,
      ui: {
        ...state.ui,
        statusMessage: `Update channel set to ${nextPreferences.updateChannel}`,
      },
    }))
  },
  setUpdateManifestUrl: async (url) => {
    const nextPreferences = {
      ...get().preferences,
      updateManifestUrl: url && url.trim().length > 0 ? url.trim() : null,
    }
    await saveAppPreferences(nextPreferences)
    set((state) => ({
      preferences: nextPreferences,
      ui: {
        ...state.ui,
        statusMessage: nextPreferences.updateManifestUrl ? 'Update manifest URL updated' : 'Update manifest URL cleared',
      },
    }))
  },
  setDensityMode: async (mode) => {
    const nextPreferences = {
      ...get().preferences,
      density: normalizeDensityMode(mode),
    }
    await saveAppPreferences(nextPreferences)
    set((state) => ({
      preferences: nextPreferences,
      ui: {
        ...state.ui,
        statusMessage: `Density set to ${nextPreferences.density}`,
      },
    }))
  },
  setWorkspaceLayout: async (layout) => {
    const nextPreferences = {
      ...get().preferences,
      workspaceLayout: normalizeWorkspaceLayout(layout),
    }
    await saveAppPreferences(nextPreferences)
    set((state) => ({
      preferences: nextPreferences,
      ui: {
        ...state.ui,
        statusMessage: `Workspace layout set to ${nextPreferences.workspaceLayout}`,
      },
    }))
  },
  enableWorkspaceSharing: () => {
    if (get().ui.networkStatus === 'offline') {
      return
    }

    applyMutation(set, get, 'workspace.share.enable', 'Workspace sharing enabled', (project) => {
      const workspaceId = project.meta.sharing.workspaceId ?? `workspace-${project.meta.id}`
      project.meta.sharing.enabled = true
      project.meta.sharing.workspaceId = workspaceId
      project.meta.sharing.shareLink = createWorkspaceShareLink(workspaceId)
      project.meta.sharing.lastSyncedAt = new Date().toISOString()
    })
  },
  disableWorkspaceSharing: () => {
    if (get().ui.networkStatus === 'offline') {
      return
    }

    applyMutation(set, get, 'workspace.share.disable', 'Workspace sharing disabled', (project) => {
      project.meta.sharing.enabled = false
      project.meta.sharing.shareLink = null
      project.meta.sharing.accessLevel = 'private'
      project.meta.sharing.lastSyncedAt = new Date().toISOString()
    })
  },
  setWorkspaceAccessLevel: (accessLevel) => {
    if (get().ui.networkStatus === 'offline') {
      return
    }

    applyMutation(set, get, 'workspace.access.update', 'Workspace access updated', (project) => {
      project.meta.sharing.accessLevel = accessLevel
      project.meta.sharing.lastSyncedAt = new Date().toISOString()
    })
  },
  inviteWorkspaceCollaborator: (email, role) => {
    if (get().ui.networkStatus === 'offline') {
      return
    }

    applyMutation(set, get, 'workspace.invite.add', 'Workspace invite sent', (project) => {
      const normalizedEmail = email.trim().toLowerCase()
      if (!normalizedEmail || !project.meta.sharing.enabled) {
        return
      }

      const alreadyInvited = project.meta.sharing.invites.some(
        (invite) => invite.status === 'pending' && invite.email.trim().toLowerCase() === normalizedEmail,
      )
      const alreadyMember = project.meta.sharing.collaborators.some(
        (collaborator) => collaborator.email.trim().toLowerCase() === normalizedEmail,
      )

      if (alreadyInvited || alreadyMember) {
        return
      }

      project.meta.sharing.invites.push({
        id: `${nextId('invite')}-${Math.random().toString(36).slice(2, 8)}`,
        email: normalizedEmail,
        role,
        status: 'pending',
        invitedAt: new Date().toISOString(),
        acceptedAt: null,
      })
      project.meta.sharing.lastSyncedAt = new Date().toISOString()
    })
  },
  acceptWorkspaceInvite: (inviteId) => {
    if (get().ui.networkStatus === 'offline') {
      return
    }

    applyMutation(set, get, 'workspace.invite.accept', 'Workspace invite accepted', (project) => {
      const invite = project.meta.sharing.invites.find((entry) => entry.id === inviteId)
      if (!invite || invite.status !== 'pending') {
        return
      }

      invite.status = 'accepted'
      invite.acceptedAt = new Date().toISOString()
      project.meta.sharing.collaborators.push({
        id: `${nextId('member')}-${Math.random().toString(36).slice(2, 8)}`,
        name: invite.email.split('@')[0] || invite.email,
        email: invite.email,
        role: invite.role,
        presence: 'online',
        joinedAt: invite.acceptedAt,
        lastActiveAt: invite.acceptedAt,
      })
      project.meta.sharing.lastSyncedAt = invite.acceptedAt
    })
  },
  revokeWorkspaceInvite: (inviteId) => {
    if (get().ui.networkStatus === 'offline') {
      return
    }

    applyMutation(set, get, 'workspace.invite.revoke', 'Workspace invite revoked', (project) => {
      const invite = project.meta.sharing.invites.find((entry) => entry.id === inviteId)
      if (!invite || invite.status !== 'pending') {
        return
      }

      invite.status = 'revoked'
      project.meta.sharing.lastSyncedAt = new Date().toISOString()
    })
  },
  updateWorkspaceCollaboratorRole: (collaboratorId, role) => {
    if (get().ui.networkStatus === 'offline') {
      return
    }

    applyMutation(set, get, 'workspace.member.role', 'Workspace collaborator role updated', (project) => {
      const collaborator = project.meta.sharing.collaborators.find((entry) => entry.id === collaboratorId)
      if (!collaborator) {
        return
      }

      collaborator.role = role
      collaborator.lastActiveAt = new Date().toISOString()
      collaborator.presence = collaborator.presence === 'offline' ? 'idle' : collaborator.presence
      project.meta.sharing.lastSyncedAt = collaborator.lastActiveAt
    })
  },
  removeWorkspaceCollaborator: (collaboratorId) => {
    if (get().ui.networkStatus === 'offline') {
      return
    }

    applyMutation(set, get, 'workspace.member.remove', 'Workspace collaborator removed', (project) => {
      const nextCollaborators = project.meta.sharing.collaborators.filter((entry) => entry.id !== collaboratorId)
      if (nextCollaborators.length === project.meta.sharing.collaborators.length) {
        return
      }

      project.meta.sharing.collaborators = nextCollaborators
      project.meta.sharing.lastSyncedAt = new Date().toISOString()
    })
  },
  setExportOutputDirectory: (path) =>
    applyMutation(set, get, 'export.defaults.directory', 'Export output directory updated', (project) => {
      project.output.exportDefaults.outputDirectory = path
    }),
  toggleOpenFolderAfterExport: () =>
    applyMutation(set, get, 'export.defaults.open-folder', 'Export reveal behavior updated', (project) => {
      project.output.exportDefaults.openFolderAfterExport = !project.output.exportDefaults.openFolderAfterExport
    }),
  setCloudApiKey: async (apiKey) => {
    const nextPreferences = {
      ...get().preferences,
      cloudApiKey: apiKey.trim(),
    }
    // Persist the secret to the OS keychain (Tauri) / local prefs (browser), never to the
    // plaintext preferences file.
    await saveCloudApiKey(nextPreferences.cloudApiKey)
    set((state) => ({
      preferences: nextPreferences,
      ui: {
        ...state.ui,
        statusMessage: nextPreferences.cloudApiKey ? 'Cloud API key updated' : 'Cloud API key cleared',
      },
    }))
    get().syncResilienceState()
  },
  setKeybinding: async (command, key, modifiers) => {
    const currentPreferences = get().preferences
    const existing = currentPreferences.keybindings.filter((binding) => binding.command !== command)
    const definition = DEFAULT_KEYBINDINGS.find((binding) => binding.command === command)

    if (!definition) {
      return
    }

    const nextPreferences = {
      ...currentPreferences,
      keybindings: [
        ...existing,
        {
          command,
          key,
          modifiers,
          when: definition.when,
        },
      ],
    }
    await saveAppPreferences(nextPreferences)
    set((state) => ({
      preferences: nextPreferences,
      ui: {
        ...state.ui,
        statusMessage: `Shortcut updated for ${command}`,
      },
    }))
  },
  resetKeybinding: async (command) => {
    const defaults = DEFAULT_KEYBINDINGS.find((binding) => binding.command === command)

    if (!defaults) {
      return
    }

    const nextPreferences = {
      ...get().preferences,
      keybindings: [
        ...get().preferences.keybindings.filter((binding) => binding.command !== command),
        defaults,
      ],
    }
    await saveAppPreferences(nextPreferences)
    set((state) => ({
      preferences: nextPreferences,
      ui: {
        ...state.ui,
        statusMessage: `Shortcut reset for ${command}`,
      },
    }))
  },
  // movePlayhead/setPlayhead are called up to ~10x/sec by the playback loop, so — like
  // scrubPlayhead/panWorkflowViewport/adjustWorkflowZoom below — they bypass applyMutation
  // entirely: no history entry (undo would otherwise fill up with playback frames) and no
  // WAL append (which would otherwise rewrite the crash-recovery log every tick).
  movePlayhead: (delta) =>
    set((state) => {
      const nextPlayhead = Math.max(
        0,
        Math.min(getTimelineDuration(state.project), Number((state.project.timeline.playhead + delta).toFixed(2))),
      )

      return {
        project: {
          ...state.project,
          timeline: {
            ...state.project.timeline,
            playhead: nextPlayhead,
          },
        },
        ui: {
          ...state.ui,
          statusMessage: 'Playhead moved complete',
        },
      }
    }),
  setPlayhead: (time) =>
    set((state) => {
      const nextPlayhead = Math.max(0, Math.min(getTimelineDuration(state.project), Number(time.toFixed(2))))

      return {
        project: {
          ...state.project,
          timeline: {
            ...state.project.timeline,
            playhead: nextPlayhead,
          },
        },
        ui: {
          ...state.ui,
          statusMessage: 'Playhead positioned complete',
        },
      }
    }),
  scrubPlayhead: (time) =>
    set((state) => ({
      project: {
        ...state.project,
        timeline: {
          ...state.project.timeline,
          playhead: Math.max(0, Math.min(getTimelineDuration(state.project), Number(time.toFixed(2)))),
        },
      },
      ui: {
        ...state.ui,
        statusMessage: `Scrubbing ${Math.max(0, Math.min(getTimelineDuration(state.project), Number(time.toFixed(2)))).toFixed(2)}s`,
      },
    })),
  togglePlayback: () =>
    set((state) => ({
      ui: {
        ...state.ui,
        playbackState: state.ui.playbackState === 'paused' ? 'playing' : 'paused',
        playbackRate: state.ui.playbackState === 'paused' ? 1 : state.ui.playbackRate,
        scrubPreviewState:
          state.ui.playbackState === 'paused' ? state.ui.scrubPreviewState : createIdleScrubPreviewState(),
        statusMessage:
          state.ui.playbackState === 'paused' ? 'Timeline playback started' : 'Timeline playback paused',
      },
    })),
  pausePlayback: () =>
    set((state) => ({
      ui: {
        ...state.ui,
        playbackState: 'paused',
        playbackRate: 1,
        scrubPreviewState: createIdleScrubPreviewState(),
        statusMessage: 'Timeline playback paused',
      },
    })),
  shuttlePlayback: (direction) =>
    set((state) => {
      const isSameDirection =
        (direction === 'forward' && state.ui.playbackState === 'playing') ||
        (direction === 'reverse' && state.ui.playbackState === 'reverse')
      const nextRate = isSameDirection ? Math.min(state.ui.playbackRate * 2, 4) : 1

      return {
        ui: {
          ...state.ui,
          playbackState: direction === 'forward' ? 'playing' : 'reverse',
          playbackRate: nextRate,
          scrubPreviewState:
            state.project.audio.scrubEnabled
              ? {
                  active: true,
                  mode: 'shuttle',
                  speed: nextRate,
                  sourceTime: state.project.timeline.playhead,
                  startedAt: new Date().toISOString(),
                }
              : state.ui.scrubPreviewState,
          statusMessage: `${direction === 'forward' ? 'Forward' : 'Reverse'} shuttle ${nextRate}x`,
        },
      }
    }),
  setInPoint: () =>
    applyMutation(set, get, 'timeline.inpoint.set', 'In point set', (project) => {
      project.timeline.inPoint = Number(project.timeline.playhead.toFixed(2))
    }),
  setOutPoint: () =>
    applyMutation(set, get, 'timeline.outpoint.set', 'Out point set', (project) => {
      project.timeline.outPoint = Number(project.timeline.playhead.toFixed(2))
    }),
  clearInOutPoints: () =>
    applyMutation(set, get, 'timeline.inout.clear', 'In/Out points cleared', (project) => {
      project.timeline.inPoint = null
      project.timeline.outPoint = null
    }),
  adjustTimelineZoom: (delta) =>
    applyMutation(set, get, 'timeline.zoom.adjust', 'Timeline zoom adjusted', (project) => {
      project.timeline.zoom = Math.max(0.25, Math.min(6, Number((project.timeline.zoom + delta).toFixed(2))))
    }),
  fitTimelineToWindow: () =>
    applyMutation(set, get, 'timeline.zoom.fit', 'Timeline fit to window', (project) => {
      project.timeline.zoom = 1
      project.timeline.scrollX = 0
    }),
  newProject: async () => {
    markWelcomeSeen()
    const project = createDefaultProject()
    const validationState = getValidationState(project)
    clearModuleGlobalCaches()
    set((state) => ({
      project,
      history: createHistoryState(),
      previewFrames: {},
      waveformCache: {},
      nodePreviewFrames: {},
      assetThumbnails: {},
      runtimeCacheMetrics: buildRuntimeCacheMetrics({
        ...state,
        project,
        previewFrames: {},
        waveformCache: {},
        nodePreviewFrames: {},
        assetThumbnails: {},
      }),
      ...validationState,
      ui: {
        ...state.ui,
        showWelcome: false,
        currentProjectPath: null,
        selectedClipId: null,
        selectedClipIds: [],
        selectedTrackId: null,
        selectedNodeId: null,
        selectedNodeIds: [],
        statusMessage: 'Created a fresh unsaved project',
      },
    }))
  },
  applyTemplate: async (templateId) => {
    markWelcomeSeen()
    const project = createTemplateProject(templateId)
    const validationState = getValidationState(project)
    clearModuleGlobalCaches()
    set((state) => ({
      project,
      history: createHistoryState(),
      previewFrames: {},
      waveformCache: {},
      nodePreviewFrames: {},
      assetThumbnails: {},
      runtimeCacheMetrics: buildRuntimeCacheMetrics({
        ...state,
        project,
        previewFrames: {},
        waveformCache: {},
        nodePreviewFrames: {},
        assetThumbnails: {},
      }),
      ...validationState,
      ui: {
        ...state.ui,
        showWelcome: false,
        currentProjectPath: null,
        selectedClipId: null,
        selectedClipIds: [],
        selectedTrackId: null,
        selectedNodeId: null,
        selectedNodeIds: [],
        statusMessage: `${project.meta.name} template loaded`,
      },
    }))

    await generateThumbnailsForAssets(set, get, Object.keys(project.assets.assets))
  },
  createProjectAtPath: async (path) => {
    markWelcomeSeen()
    const project = cloneProject(get().project)
    syncUpdatedAt(project)
    const savedPath = await projectRepository.createProjectAtPath(path, project)
    const recentProjects = await projectRepository.loadRecentProjects()
    set((state) => ({
      project,
      recentProjects,
      ui: {
        ...state.ui,
        currentProjectPath: savedPath,
        lastSavedAt: new Date().toISOString(),
        showWelcome: false,
        statusMessage: 'Project directory created',
      },
    }))
  },
  openProjectFromPath: async (path) => {
    markWelcomeSeen()
    const loadedProject = await projectRepository.loadFromPath(path)

    if (!loadedProject) {
      pushAppError(set, {
        id: nextId('error'),
        category: 'internal',
        message: `Project could not be opened from path ${path}.`,
        userMessage: 'Project could not be opened.',
        recoverable: true,
        suggestedAction: 'Check that the .fluxnode folder contains a valid project.json file.',
        actionLabel: 'Open Settings',
        actionCommand: 'open_settings',
        createdAt: new Date().toISOString(),
      })
      return
    }

    const recentProjects = await projectRepository.loadRecentProjects()
    const validationState = getValidationState(loadedProject)
    const currentProjectPath = await projectRepository.getCurrentProjectPath()

    clearModuleGlobalCaches()
    set((state) => ({
      project: loadedProject,
      history: createHistoryState(),
      previewFrames: {},
      waveformCache: {},
      nodePreviewFrames: {},
      assetThumbnails: {},
      runtimeCacheMetrics: buildRuntimeCacheMetrics({
        ...state,
        project: loadedProject,
        previewFrames: {},
        waveformCache: {},
        nodePreviewFrames: {},
        assetThumbnails: {},
      }),
      recentProjects,
      ...validationState,
      ui: {
        ...state.ui,
        currentProjectPath,
        selectedClipId: null,
        selectedClipIds: [],
        selectedTrackId: null,
        selectedNodeId: null,
        selectedNodeIds: [],
        showWelcome: false,
        statusMessage: `Opened ${loadedProject.meta.name}`,
      },
    }))

    await generateThumbnailsForAssets(set, get, Object.keys(loadedProject.assets.assets))
  },
  addDemoClip: () =>
    applyMutation(set, get, 'clip.add', 'Demo clip added', (project) => {
      const track = getVideoTrack(project)

      if (!track) {
        return
      }

      const nextIndex = track.clips.length + 1
      const clipId = `clip-video-${nextIndex.toString().padStart(2, '0')}`
      const demoNode = createMediaSourceNode(project, clipId, 'asset-video-01', 'Demo Media Source')
      const startTime = Number((track.clips.at(-1)?.startTime ?? 0) + (track.clips.at(-1)?.duration ?? 0) + 0.4)

      track.clips.push({
        id: clipId,
        assetId: 'asset-video-01',
        trackId: track.id,
        startTime,
        duration: 4,
        inPoint: 0,
        outPoint: 4,
        speed: 1,
        volume: 1,
        opacity: 1,
        transform: {
          x: 0,
          y: 0,
          scaleX: 1,
          scaleY: 1,
          rotation: 0,
          anchorX: 0.5,
          anchorY: 0.5,
        },
        keyframes: [],
        linkedClipId: null,
        workflowNodeId: demoNode.id,
      })

      project.workflow.nodes.push(demoNode)
    }),
  addClipFromAsset: (assetId, options) => {
    const addedClipIdRef: { current: string | null } = { current: null }

    applyMutation(set, get, 'clip.add', 'Clip added from media bin', (project) => {
      const asset = project.assets.assets[assetId]

      if (!asset) {
        return
      }

      const trackType = asset.type === 'audio' ? 'audio' : 'video'
      const requestedTrack = options?.trackId
        ? project.timeline.tracks.find((track) => track.id === options.trackId)
        : null
      // A drop onto an incompatible lane (audio file over a video track and vice versa) falls
      // back to the matching-type track rather than silently creating an invalid clip.
      const track =
        requestedTrack && (requestedTrack.type === trackType || (trackType === 'video' && requestedTrack.type === 'subtitle'))
          ? requestedTrack
          : getOrCreateTrack(project, trackType)

      if (track.locked) {
        return
      }

      const clipId = `clip-${trackType}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
      const duration = asset.duration ?? 4
      const appendAt = Number(
        ((track.clips.at(-1)?.startTime ?? 0) + (track.clips.at(-1)?.duration ?? 0) + (track.clips.length > 0 ? 0.1 : 0)).toFixed(2),
      )
      const startTime = Math.max(0, Number((options?.startTime ?? appendAt).toFixed(2)))
      const mediaSourceNode = createMediaSourceNode(project, clipId, asset.id, asset.name)

      track.clips.push({
        id: clipId,
        assetId: asset.id,
        trackId: track.id,
        startTime,
        duration,
        inPoint: 0,
        outPoint: duration,
        speed: 1,
        volume: 1,
        opacity: 1,
        transform: {
          x: 0,
          y: 0,
          scaleX: 1,
          scaleY: 1,
          rotation: 0,
          anchorX: 0.5,
          anchorY: 0.5,
        },
        keyframes: [],
        linkedClipId: null,
        workflowNodeId: mediaSourceNode.id,
      })
      track.clips.sort((a, b) => a.startTime - b.startTime)

      project.workflow.nodes.push(mediaSourceNode)
      addedClipIdRef.current = clipId
    })

    if (addedClipIdRef.current) {
      set((state) => ({
        ui: {
          ...state.ui,
          selectedClipId: addedClipIdRef.current,
          selectedClipIds: [addedClipIdRef.current as string],
          selectedTrackId: state.ui.selectedTrackId,
        },
      }))
    }
  },
  addShaderNode: () =>
    applyMutation(set, get, 'node.add', 'Shader node added', (project) => {
      const nextIndex = project.workflow.nodes.filter((node) => node.type === 'shader').length + 1
      project.workflow.nodes.push(createShaderNode(nextIndex))
    }),
  addNodeOfType: (type) => {
    const nextIndex = get().project.workflow.nodes.filter((node) => node.type === type).length + 1
    const nextNode = createWorkflowNodeOfType(type, nextIndex)
    applyMutation(set, get, 'node.add', `${type.replace('_', ' ')} node added`, (project) => {
      project.workflow.nodes.push(structuredClone(nextNode))
    })
    set((state) => ({
      ui: {
        ...state.ui,
        showNodePicker: false,
        selectedNodeId: nextNode.id,
        selectedNodeIds: [nextNode.id],
      },
    }))
  },
  createLargeCanvasBenchmarkScene: () => {
    const startedAt = performance.now()
    const scene = buildLargeCanvasBenchmarkScene()

    applyMutation(set, get, 'workflow.benchmark.scene', 'Large canvas benchmark scene generated', (project) => {
      for (const track of project.timeline.tracks) {
        for (const clip of track.clips) {
          clip.workflowNodeId = null
        }
      }

      project.workflow.nodes = scene.nodes
      project.workflow.edges = scene.edges
      project.workflow.groups = []
      project.workflow.viewport = {
        x: 0,
        y: 0,
        zoom: 0.42,
      }
    })

    const generationMs = Number((performance.now() - startedAt).toFixed(1))
    set((state) => ({
      ui: {
        ...state.ui,
        activeView: 'workflow',
        selectedNodeId: null,
        selectedNodeIds: [],
        selectedClipId: null,
        selectedClipIds: [],
        selectedTrackId: null,
        workflowBenchmarkMetric: {
          sceneLabel: '120-node large canvas benchmark',
          nodeCount: scene.nodeCount,
          edgeCount: scene.edgeCount,
          canvasRendererExpected: scene.edgeCount >= 200,
          generationMs,
          measuredAt: new Date().toISOString(),
          fitViewDurationMs: null,
          fitViewMeasuredAt: null,
          panTraversalDurationMs: null,
          zoomSweepDurationMs: null,
          interactionMeasuredAt: null,
        },
        statusMessage: `Large canvas benchmark loaded with ${scene.nodeCount} nodes and ${scene.edgeCount} edges`,
      },
    }))
  },
  nudgeFirstNode: () =>
    applyMutation(set, get, 'node.move', 'Workflow node nudged', (project) => {
      const firstNode = project.workflow.nodes[0]

      if (!firstNode) {
        return
      }

      firstNode.position.x += 36
      firstNode.position.y += 20
    }),
  importAssetFromPath: async (providedPath) => {
    const path =
      providedPath?.trim() ||
      (await pickMediaFile('Enter a media file path to import into FluxNode', getPreferredDirectory(get())))

    if (!path) {
      return
    }

    const assetId = nextId('asset')
    const copyIntoProject = window.confirm('Copy this media into the current FluxNode project?')
    const copyResult =
      copyIntoProject ? await copyAssetIntoProject(assetId, path).catch(() => null) : null
    const effectivePath = copyResult?.absolutePath ?? path
    const inspection = await inspectAssetPath(effectivePath)
    let probe = buildFallbackProbe(effectivePath, inspection.fileSize)
    let probeFailed = false

    if (inspection.exists) {
      try {
        probe = await probeAssetMetadata(effectivePath)
      } catch {
        probeFailed = true
      }
    }

    const importedAssetSnapshot = buildAssetFromInspection(
      assetId,
      inspection,
      probe,
      inspection.exists && probeFailed ? 'corrupt' : undefined,
    )

    applyMutation(set, get, 'asset.import', 'Asset imported', (project) => {
      const asset = structuredClone(importedAssetSnapshot)
      if (copyResult) {
        asset.sourcePath = path
        asset.relativePath = copyResult.relativePath
      }
      project.assets.assets[asset.id] = asset

      const trackType = asset.type === 'audio' ? 'audio' : 'video'
      const track = getOrCreateTrack(project, trackType)
      const nextClipIndex = track.clips.length + 1
      const clipId = `clip-${trackType}-${nextClipIndex.toString().padStart(2, '0')}`
      const startTime = Number(
        ((track.clips.at(-1)?.startTime ?? 0) + (track.clips.at(-1)?.duration ?? 0) + 0.4).toFixed(2),
      )
      const mediaSourceNode = createMediaSourceNode(project, clipId, asset.id, inspection.fileName)

      track.clips.push({
        id: clipId,
        assetId: asset.id,
        trackId: track.id,
        startTime,
        duration: asset.duration ?? 4,
        inPoint: 0,
        outPoint: asset.duration ?? 4,
        speed: 1,
        volume: 1,
        opacity: 1,
        transform: {
          x: 0,
          y: 0,
          scaleX: 1,
          scaleY: 1,
          rotation: 0,
          anchorX: 0.5,
          anchorY: 0.5,
        },
        keyframes: [],
        linkedClipId: null,
        workflowNodeId: mediaSourceNode.id,
      })

      project.workflow.nodes.push(mediaSourceNode)
    })

    if (!inspection.exists) {
      pushAppError(set, {
        id: nextId('error'),
        category: 'asset_missing',
        message: `Imported path ${path} does not currently exist.`,
        userMessage: 'Imported media is offline.',
        recoverable: true,
        suggestedAction: 'Relink the media to an existing file path, then rescan assets.',
        actionLabel: 'Rescan Assets',
        actionCommand: 'rescan_assets',
        createdAt: new Date().toISOString(),
      })
    }

    if (inspection.exists && shouldOfferProxy(importedAssetSnapshot) && get().project.settings.proxyEnabled) {
      const shouldGenerateProxy = window.confirm(
        `Generate a proxy for ${inspection.fileName} for smoother editing?`,
      )

      if (shouldGenerateProxy) {
        void get().generateProxyForAsset(assetId)
      }
    }

    if (inspection.exists) {
      if (probeFailed) {
        pushAssetCorruptError(
          set,
          assetId,
          importedAssetSnapshot.name,
          `Probe failed for imported media ${effectivePath}.`,
          'Metadata probe could not decode the imported asset.',
        )
      } else {
        await generateThumbnailForAssetRecord(set, get, assetId)
      }
    }
  },
  rescanAssetStatuses: async () => {
    const assetEntries = Object.values(get().project.assets.assets)
    const inspections = await Promise.all(
      assetEntries.map(async (asset) => ({
        assetId: asset.id,
        inspection: await inspectAssetPath(resolveAssetRuntimePath(asset, get().ui.currentProjectPath)),
      })),
    )

    applyMutation(set, get, 'asset.rescan', 'Asset statuses rescanned', (project) => {
      for (const { assetId, inspection } of inspections) {
        const asset = project.assets.assets[assetId]

        if (!asset) {
          continue
        }

        asset.status =
          inspection.exists && asset.status === 'corrupt'
            ? 'corrupt'
            : inspection.exists
              ? 'linked'
              : 'missing'
        asset.metadata.fileSize = inspection.fileSize
      }
    })

    const linkedAssetIds = inspections
      .filter((entry) => entry.inspection.exists)
      .map((entry) => entry.assetId)

    await generateThumbnailsForAssets(set, get, linkedAssetIds)
  },
  toggleAssetProxyPreference: (assetId) =>
    applyMutation(set, get, 'asset.proxy.preference.toggle', 'Asset proxy preference updated', (project) => {
      const asset = project.assets.assets[assetId]

      if (!asset || asset.type !== 'video') {
        return
      }

      asset.preferProxyForEditing = !asset.preferProxyForEditing
    }),
  relinkMissingAssetsFromFolder: async () => {
    const folderPath = await pickRelinkDirectory(getPreferredDirectory(get()))

    if (!folderPath) {
      return
    }

    const missingAssets = Object.values(get().project.assets.assets).filter((asset) => asset.status === 'missing')

    if (missingAssets.length === 0) {
      set((state) => ({
        ui: {
          ...state.ui,
          statusMessage: 'No missing assets need relinking',
        },
      }))
      return
    }

    const resolutions = await Promise.all(
      missingAssets.map(async (asset) => {
        const normalizedFolder = folderPath.replace(/[\\/]$/, '')
        const candidatePath = `${normalizedFolder}/${asset.name}`.replace(/\\/g, '/')
        const inspection = await inspectAssetPath(candidatePath)
        return { assetId: asset.id, candidatePath, inspection }
      }),
    )

    applyMutation(set, get, 'asset.relink.batch', 'Missing assets relinked from folder scan', (project) => {
      for (const resolution of resolutions) {
        if (!resolution.inspection.exists) {
          continue
        }

        const asset = project.assets.assets[resolution.assetId]

        if (!asset) {
          continue
        }

        asset.sourcePath = resolution.candidatePath
        asset.relativePath = null
        asset.status = 'linked'
        asset.metadata.fileSize = resolution.inspection.fileSize
      }
    })

    const linkedIds = resolutions
      .filter((resolution) => resolution.inspection.exists)
      .map((resolution) => resolution.assetId)

    await generateThumbnailsForAssets(set, get, linkedIds)
  },
  replaceSelectedAssetPath: async () => {
    const selectedClipId = get().ui.selectedClipId

    if (!selectedClipId) {
      return
    }

    const selectedAssetId = get().project.timeline.tracks
      .flatMap((track) => track.clips)
      .find((clip) => clip.id === selectedClipId)?.assetId

    if (!selectedAssetId) {
      return
    }

    await replaceAssetPathById(set, get, selectedAssetId)
  },
  generateProxyForAsset: async (assetId) => {
    const project = get().project
    const asset = project.assets.assets[assetId]
    const runtimePath = asset ? resolveAssetRuntimePath(asset, get().ui.currentProjectPath) : null

    if (!asset || asset.type !== 'video' || !runtimePath) {
      return
    }

    if (shouldBlockGpuOperations(get().runtimeHealth)) {
      pushAppError(set, {
        id: nextId('error'),
        category: 'gpu_oom',
        message: 'GPU operations paused because VRAM usage exceeded 95%.',
        userMessage: 'GPU memory is critically high, so proxy generation was paused.',
        recoverable: true,
        suggestedAction: 'Clear runtime caches or wait for GPU pressure to drop before generating another proxy.',
        actionLabel: 'Clear Caches',
        actionCommand: 'clear_runtime_caches',
        createdAt: new Date().toISOString(),
      })
      return
    }

    applyMutation(set, get, 'asset.proxy.start', 'Proxy generation started', (draft) => {
      const target = draft.assets.assets[assetId]
      if (target) {
        target.status = 'proxy_generating'
      }
    })

    try {
      const proxyPath = await generateAssetProxy(
        asset.id,
        runtimePath,
        project.settings.proxyResolution.width,
        project.settings.proxyResolution.height,
      )

      applyMutation(set, get, 'asset.proxy.ready', 'Proxy generated', (draft) => {
        const target = draft.assets.assets[assetId]
        if (!target) {
          return
        }

        target.proxyPath = proxyPath
        target.preferProxyForEditing = true
        target.status = 'linked'
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : `Proxy generation failed for ${assetId}.`
      pushAppError(set, {
        id: nextId('error'),
        category: inferErrorCategory(message, 'render_failed'),
        message,
        userMessage: 'Proxy could not be generated.',
        recoverable: true,
        suggestedAction: 'Retry proxy generation or continue editing from original media.',
        actionLabel: 'Clear Caches',
        actionCommand: 'clear_runtime_caches',
        createdAt: new Date().toISOString(),
      })

      applyMutation(set, get, 'asset.proxy.fail', 'Proxy generation failed', (draft) => {
        const target = draft.assets.assets[assetId]
        if (target) {
          target.status = 'linked'
        }
      })
    }
  },
  generateProxyForSelectedClip: async () => {
    const selectedClipId = get().ui.selectedClipId
    if (!selectedClipId) {
      return
    }

    const clip = findCommittedClipById(get().project, selectedClipId)
    if (!clip) {
      return
    }

    await get().generateProxyForAsset(clip.assetId)
  },
  generateWaveformForAsset: async (assetId, bucketCount = 48) => {
    const asset = get().project.assets.assets[assetId]
    const runtimePath = asset ? resolveAssetRuntimePath(asset, get().ui.currentProjectPath) : null

    if (!asset || asset.type !== 'audio' || !runtimePath) {
      return
    }

    if (isMemoryHardLimited(get())) {
      pushAppError(set, {
        id: `${nextId('error')}-memory-waveform`,
        category: 'memory_pressure',
        message: 'Waveform generation blocked because the app exceeded the hard memory budget.',
        userMessage: 'Waveform caching paused while memory pressure is critical.',
        recoverable: true,
        suggestedAction: 'Clear runtime caches or wait for memory pressure to drop before generating more waveforms.',
        actionLabel: 'Clear Caches',
        actionCommand: 'clear_runtime_caches',
        createdAt: new Date().toISOString(),
      })
      return
    }

    const cached = get().waveformCache[assetId]

    if (cached && cached.sourcePath === runtimePath && cached.peaks.length >= bucketCount) {
      touchWaveformAccess(assetId)
      return
    }

    try {
      const waveform = await generateWaveformPeaks(assetId, runtimePath, bucketCount)
      touchWaveformAccess(assetId)
      set((state) => ({
        ...trimRuntimeCachesForBudget({
          ...state,
          waveformCache: {
            ...state.waveformCache,
            [assetId]: waveform,
          },
        }),
        runtimeCacheMetrics: buildRuntimeCacheMetrics({
          ...state,
          waveformCache: {
            ...state.waveformCache,
            [assetId]: waveform,
          },
        }),
        ui: {
          ...state.ui,
          performanceMode:
            isMemorySoftLimited({
              ...state,
              waveformCache: {
                ...state.waveformCache,
                [assetId]: waveform,
              },
            })
              ? 'memory_guarded'
              : state.ui.performanceMode,
          statusMessage:
            isMemorySoftLimited({
              ...state,
              waveformCache: {
                ...state.waveformCache,
                [assetId]: waveform,
              },
            })
              ? `Waveform cache rotated for ${asset.name}`
              : `Waveform cached for ${asset.name}`,
        },
      }))
    } catch (error) {
      const message = error instanceof Error ? error.message : `Waveform generation failed for ${assetId}.`
      pushAppError(set, {
        id: nextId('error'),
        category: inferErrorCategory(message, 'internal'),
        message,
        userMessage: 'Audio waveform could not be generated.',
        recoverable: true,
        suggestedAction: 'Verify the media path and try rescanning or replacing the asset.',
        actionLabel: 'Rescan Assets',
        actionCommand: 'rescan_assets',
        createdAt: new Date().toISOString(),
      })
    }
  },
  ensureThumbnailForAsset: async (assetId) => {
    const state = get()
    const asset = state.project.assets.assets[assetId]

    if (!asset || asset.status === 'missing' || asset.status === 'corrupt') {
      return
    }

    if (state.assetThumbnails[assetId]) {
      touchAssetThumbnailAccess(assetId)
      return
    }

    if (isMemoryHardLimited(state)) {
      return
    }

    await generateThumbnailForAssetRecord(set, get, assetId)
  },
  loadPreviewFrameForSelectedClip: async (width = 960, height = 540) => {
    const state = get()
    const currentRequest = buildTimelinePreviewRequest(state, width, height)

    if (!currentRequest) {
      return
    }

    if (isMemoryHardLimited(state)) {
      pushAppError(set, {
        id: `${nextId('error')}-memory-preview`,
        category: 'memory_pressure',
        message: 'Preview decode blocked because the app exceeded the hard memory budget.',
        userMessage: 'Preview decoding paused while memory pressure is critical.',
        recoverable: true,
        suggestedAction: 'Clear runtime caches or wait for memory pressure to drop before decoding more preview frames.',
        actionLabel: 'Clear Caches',
        actionCommand: 'clear_runtime_caches',
        createdAt: new Date().toISOString(),
      })
      return
    }

    if (shouldBlockGpuOperations(state.runtimeHealth)) {
      pushAppError(set, {
        id: nextId('error'),
        category: 'gpu_oom',
        message: 'Preview decode blocked because VRAM usage exceeded 95%.',
        userMessage: 'Preview decoding paused to prevent a GPU crash.',
        recoverable: true,
        suggestedAction: 'Clear runtime caches or wait for GPU pressure to drop before decoding more previews.',
        actionLabel: 'Clear Caches',
        actionCommand: 'clear_runtime_caches',
        createdAt: new Date().toISOString(),
      })
      return
    }

    try {
      await decodeTimelinePreviewRequest(set, get, currentRequest)

      const latestState = get()

      if (
        isMemoryHardLimited(latestState) ||
        shouldBlockGpuOperations(latestState.runtimeHealth)
      ) {
        return
      }

      const windowRequests = buildTimelinePreviewWindowRequests(latestState, width, height)
        .slice(1)
        .filter((request) => !latestState.previewFrames[request.cacheKey] && !pendingPreviewFrameRequests.has(request.cacheKey))

      for (let index = 0; index < windowRequests.length; index += TIMELINE_PREVIEW_DECODE_CONCURRENCY) {
        const currentState = get()

        if (
          isMemoryHardLimited(currentState) ||
          shouldBlockGpuOperations(currentState.runtimeHealth)
        ) {
          break
        }

        const chunk = windowRequests.slice(index, index + TIMELINE_PREVIEW_DECODE_CONCURRENCY)
        await Promise.all(
          chunk.map((request) =>
            decodeTimelinePreviewRequest(set, get, request, { background: true }).catch(() => false),
          ),
        )
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : `Preview decode failed for ${currentRequest.asset.id}.`
      applyMutation(set, get, 'asset.status.corrupt', 'Asset marked corrupt after preview decode failure', (project) => {
        const target = project.assets.assets[currentRequest.asset.id]

        if (target && target.status !== 'missing') {
          target.status = 'corrupt'
        }
      })
      pushAppError(set, {
        id: nextId('error'),
        category: inferErrorCategory(message, 'asset_corrupt'),
        message,
        userMessage: 'Preview frame could not be decoded.',
        recoverable: true,
        suggestedAction: 'Check the source media, relink the asset, or try another clip.',
        actionLabel: 'Replace Media',
        actionCommand: 'replace_media',
        contextId: currentRequest.asset.id,
        createdAt: new Date().toISOString(),
      })
    }
  },
  loadPreviewFrameForSelectedNode: async (width = 512, height = 512) => {
    const state = get()
    const selectedNodeId = state.ui.selectedNodeId

    if (!selectedNodeId) {
      return
    }

    const selectedNode = state.project.workflow.nodes.find((node) => node.id === selectedNodeId)
    const previewSource = buildNodePreviewSource(state.project.workflow, selectedNodeId)

    if (!selectedNode || !previewSource) {
      return
    }

    if (shouldBlockGpuOperations(state.runtimeHealth) || isMemoryHardLimited(state)) {
      pushAppError(set, {
        id: `${nextId('error')}-memory-node-preview`,
        category: shouldBlockGpuOperations(state.runtimeHealth) ? 'gpu_oom' : 'memory_pressure',
        message: 'Node preview generation paused because runtime pressure crossed the hard safety limit.',
        userMessage: 'Node preview is paused until GPU or memory pressure drops.',
        recoverable: true,
        suggestedAction: 'Clear runtime caches or reduce preview activity before opening more node previews.',
        actionLabel: 'Clear Caches',
        actionCommand: 'clear_runtime_caches',
        createdAt: new Date().toISOString(),
      })
      return
    }

    const requestScale = shouldReducePreviewResolution(state.runtimeHealth) ? 0.75 : 1
    const requestWidth = Math.min(512, Math.max(192, Math.round(width * requestScale)))
    const requestHeight = Math.min(512, Math.max(192, Math.round(height * requestScale)))
    const cached = state.nodePreviewFrames[selectedNodeId]

    if (
      cached &&
      cached.sourcePath === previewSource &&
      cached.width === requestWidth &&
      cached.height === requestHeight
    ) {
      touchNodePreviewFrameAccess(selectedNodeId)
      return
    }

    try {
      const frame = await decodePreviewFrame(
        selectedNode.id,
        previewSource,
        0,
        requestWidth,
        requestHeight,
      )

      touchNodePreviewFrameAccess(selectedNode.id)
      set((currentState) => ({
        ...trimRuntimeCachesForBudget({
          ...currentState,
          nodePreviewFrames: {
            ...currentState.nodePreviewFrames,
            [selectedNode.id]: frame,
          },
        }),
        runtimeCacheMetrics: buildRuntimeCacheMetrics({
          ...currentState,
          nodePreviewFrames: {
            ...currentState.nodePreviewFrames,
            [selectedNode.id]: frame,
          },
        }),
        ui: {
          ...currentState.ui,
          performanceMode:
            isMemorySoftLimited({
              ...currentState,
              nodePreviewFrames: {
                ...currentState.nodePreviewFrames,
                [selectedNode.id]: frame,
              },
            })
              ? 'memory_guarded'
              : currentState.ui.performanceMode,
          statusMessage: `Node preview cached for ${selectedNode.label ?? selectedNode.id}`,
        },
      }))
    } catch (error) {
      const message = error instanceof Error ? error.message : `Node preview generation failed for ${selectedNode.id}.`
      pushAppError(set, {
        id: `${nextId('error')}-node-preview`,
        category: inferErrorCategory(message, 'internal'),
        message,
        userMessage: 'Node preview could not be generated.',
        recoverable: true,
        suggestedAction: 'Validate the workflow graph or clear runtime caches before retrying.',
        actionLabel: 'Clear Caches',
        actionCommand: 'clear_runtime_caches',
        createdAt: new Date().toISOString(),
      })
    }
  },
  requestNodePreview: async (nodeId, width = 320, height = 200) => {
    if (!isTauriRuntime()) {
      return
    }

    const state = get()
    const cacheKey = buildNodePreviewSource(state.project.workflow, nodeId)

    if (!cacheKey) {
      return
    }

    if (state.nodePreviewFrames[cacheKey]) {
      touchNodePreviewFrameAccess(cacheKey)
      return
    }

    if (pendingNodePreviewRequests.has(cacheKey)) {
      return
    }

    pendingNodePreviewRequests.add(cacheKey)

    let projectJson: string

    try {
      projectJson = JSON.stringify(state.project)
    } catch {
      pendingNodePreviewRequests.delete(cacheKey)
      return
    }

    try {
      const frame = await renderNodePreview(projectJson, nodeId, width, height)

      touchNodePreviewFrameAccess(cacheKey)
      set((currentState) => {
        const nextNodePreviewFrames = {
          ...currentState.nodePreviewFrames,
          [cacheKey]: frame,
        }

        return {
          ...trimRuntimeCachesForBudget({
            ...currentState,
            nodePreviewFrames: nextNodePreviewFrames,
          }),
          runtimeCacheMetrics: buildRuntimeCacheMetrics({
            ...currentState,
            nodePreviewFrames: nextNodePreviewFrames,
          }),
        }
      })
    } catch {
      // Browser fallback / uncompilable graphs keep the existing placeholder.
    } finally {
      pendingNodePreviewRequests.delete(cacheKey)
    }
  },
  runAiNode: async (nodeId) => {
    if (!isTauriRuntime()) {
      return
    }

    const state = get()
    const node = state.project.workflow.nodes.find((entry) => entry.id === nodeId)

    if (!node || (node.type !== 'ai_generate' && node.type !== 'ai_upscale')) {
      return
    }

    if (state.aiNodeGenerationInFlight[nodeId]) {
      return
    }

    const cacheKey = buildNodePreviewSource(state.project.workflow, nodeId)

    if (!cacheKey) {
      return
    }

    const endpoint = state.preferences.comfyUiEndpoint
    let projectJson: string

    try {
      projectJson = JSON.stringify(state.project)
    } catch {
      return
    }

    const nodeLabel = node.label ?? node.id

    set((currentState) => ({
      aiNodeGenerationInFlight: {
        ...currentState.aiNodeGenerationInFlight,
        [nodeId]: true,
      },
    }))

    // Clear any prior execution failure for this node before retrying.
    removeAppErrors(set, (error) => error.category === 'comfy_execution' && error.contextId === nodeId)

    try {
      const frame = await generateComfyNode(projectJson, nodeId, endpoint, 120)

      touchNodePreviewFrameAccess(cacheKey)
      set((currentState) => {
        const nextNodePreviewFrames = {
          ...currentState.nodePreviewFrames,
          [cacheKey]: frame,
        }

        return {
          ...trimRuntimeCachesForBudget({
            ...currentState,
            nodePreviewFrames: nextNodePreviewFrames,
          }),
          runtimeCacheMetrics: buildRuntimeCacheMetrics({
            ...currentState,
            nodePreviewFrames: nextNodePreviewFrames,
          }),
        }
      })
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error)

      pushAppError(set, {
        id: `${nextId('error')}-${nodeId}`,
        category: 'comfy_execution',
        message: `ComfyUI generation failed for ${nodeId}.`,
        userMessage: `${nodeLabel} could not be generated on ComfyUI.`,
        recoverable: true,
        suggestedAction:
          'Confirm the ComfyUI endpoint in Settings is reachable, then verify the node prompt and inputs before retrying.',
        actionLabel: 'Open Settings',
        actionCommand: 'open_settings',
        contextId: nodeId,
        detail,
        createdAt: new Date().toISOString(),
      })
    } finally {
      set((currentState) => {
        const nextInFlight = { ...currentState.aiNodeGenerationInFlight }
        delete nextInFlight[nodeId]
        return { aiNodeGenerationInFlight: nextInFlight }
      })
    }
  },
  pingComfyConnection: async () => {
    const endpoint = get().preferences.comfyUiEndpoint
    const connected = await pingComfy(endpoint)
    set({ comfyConnected: connected })
    return connected
  },
  unlinkSelectedMedia: () =>
    applyMutation(set, get, 'clip.unlink', 'Linked media unlinked', (project) => {
      const selectedClipId = get().ui.selectedClipId

      if (!selectedClipId) {
        return
      }

      const selectedClip = project.timeline.tracks
        .flatMap((track) => track.clips)
        .find((clip) => clip.id === selectedClipId)

      if (!selectedClip) {
        return
      }

      if (selectedClip.linkedClipId) {
        const linkedClip = project.timeline.tracks
          .flatMap((track) => track.clips)
          .find((clip) => clip.id === selectedClip.linkedClipId)

        if (linkedClip) {
          linkedClip.linkedClipId = null
        }
      }

      selectedClip.linkedClipId = null
    }),
  autoSaveProject: async () => {
    const project = cloneProject(get().project)
    syncUpdatedAt(project)
    const snapshot = await projectRepository.autosave(project)
    set((state) => ({
      project,
      ui: {
        ...state.ui,
        lastAutoSavedAt: snapshot.timestamp,
        statusMessage: 'Autosave snapshot captured',
      },
    }))
  },
  selectClip: (clipId, additive = false) =>
    set((state) => ({
      ui: {
        ...state.ui,
        selectedClipId: clipId,
        selectedClipIds: clipId === null ? [] : additive
          ? state.ui.selectedClipIds.includes(clipId)
            ? state.ui.selectedClipIds.filter((id) => id !== clipId)
            : [...state.ui.selectedClipIds, clipId]
          : [clipId],
        selectedTrackId:
          clipId === null
            ? state.ui.selectedTrackId
            : findCommittedTrackByClipId(state.project, clipId)?.id ?? state.ui.selectedTrackId,
        selectedNodeId: null,
        selectedNodeIds: [],
      },
    })),
  selectTrack: (trackId) =>
    set((state) => ({
      ui: {
        ...state.ui,
        selectedTrackId: trackId,
        selectedNodeId: null,
        selectedNodeIds: [],
      },
    })),
  selectAllTimelineClips: () =>
    set((state) => {
      const clipIds = getAllTimelineClips(state.project).map((clip) => clip.id)
      return {
        ui: {
          ...state.ui,
          selectedClipId: clipIds[0] ?? null,
          selectedClipIds: clipIds,
          selectedNodeId: null,
          selectedNodeIds: [],
          statusMessage: clipIds.length === 0 ? 'No clips to select' : `Selected ${clipIds.length} clip(s)`,
        },
      }
    }),
  copySelectedClips: () =>
    set((state) => {
      const selectedSet = new Set(state.ui.selectedClipIds)
      const clips = getAllTimelineClips(state.project)
        .filter((clip) => selectedSet.has(clip.id))
        .map((clip) => structuredClone(clip))

      return {
        ui: {
          ...state.ui,
          timelineClipboard: clips,
          statusMessage: clips.length === 0 ? 'No clips copied' : `Copied ${clips.length} clip(s)`,
        },
      }
    }),
  pasteTimelineClipboard: () => {
    const clipboard = get().ui.timelineClipboard

    if (clipboard.length === 0) {
      return
    }

    const baseTimestamp = Date.now()
    const baseStart = Math.min(...clipboard.map((clip) => clip.startTime))
    const targetPlayhead = get().project.timeline.playhead

    applyGroupedMutations(
      set,
      get,
      'clip.paste.group',
      'Timeline clipboard pasted',
      clipboard.map((clip, index) => ({
        type: 'clip.add',
        label: `Clip pasted: ${clip.id}`,
        mutate: (project) => {
          const nextTrack = project.timeline.tracks.find((track) => track.id === clip.trackId) ?? project.timeline.tracks[0]

          if (!nextTrack) {
            return
          }

          const relativeOffset = clip.startTime - baseStart
          const nextStart = Number((targetPlayhead + relativeOffset + index * 0.02).toFixed(2))
          nextTrack.clips.push(
            cloneClipForPaste(clip, nextTrack.id, nextStart, `paste-${baseTimestamp}-${index}`),
          )
        },
      })),
    )
  },
  addTrackAbove: () =>
    applyMutation(set, get, 'track.add', 'Track added above selection', (project) => {
      const selectedTrackId = get().ui.selectedTrackId
      const selectedIndex = selectedTrackId
        ? project.timeline.tracks.findIndex((track) => track.id === selectedTrackId)
        : 0
      const insertIndex = Math.max(0, selectedIndex)
      const baseType = project.timeline.tracks[insertIndex]?.type ?? 'video'
      project.timeline.tracks.splice(insertIndex, 0, createTrack(project, baseType, insertIndex))
    }),
  addTrackBelow: () =>
    applyMutation(set, get, 'track.add', 'Track added below selection', (project) => {
      const selectedTrackId = get().ui.selectedTrackId
      const selectedIndex = selectedTrackId
        ? project.timeline.tracks.findIndex((track) => track.id === selectedTrackId)
        : project.timeline.tracks.length - 1
      const insertIndex = Math.max(0, selectedIndex + 1)
      const baseType = project.timeline.tracks[Math.max(0, insertIndex - 1)]?.type ?? 'video'
      project.timeline.tracks.splice(insertIndex, 0, createTrack(project, baseType, insertIndex))
    }),
  moveSelectedTrack: (direction) =>
    applyMutation(set, get, 'track.reorder', 'Selected track reordered', (project) => {
      const selectedTrackId = get().ui.selectedTrackId

      if (!selectedTrackId) {
        return
      }

      const selectedIndex = project.timeline.tracks.findIndex((track) => track.id === selectedTrackId)

      if (selectedIndex === -1) {
        return
      }

      const targetIndex = direction === 'up' ? selectedIndex - 1 : selectedIndex + 1

      if (targetIndex < 0 || targetIndex >= project.timeline.tracks.length) {
        return
      }

      const [selectedTrack] = project.timeline.tracks.splice(selectedIndex, 1)
      project.timeline.tracks.splice(targetIndex, 0, selectedTrack)
    }),
  deleteSelectedTrack: () => {
    const selectedTrackId = get().ui.selectedTrackId

    if (!selectedTrackId) {
      return
    }

    const selectedTrack = get().project.timeline.tracks.find((track) => track.id === selectedTrackId)

    if (!selectedTrack) {
      return
    }

    const steps = selectedTrack.clips.map((clip) => ({
      type: 'clip.remove',
      label: `Clip removed: ${clip.id}`,
      mutate: (project: FluxNodeProject) => {
        for (const track of project.timeline.tracks) {
          const clipIndex = track.clips.findIndex((item) => item.id === clip.id)

          if (clipIndex === -1) {
            continue
          }

          const [removedClip] = track.clips.splice(clipIndex, 1)

          if (!removedClip?.workflowNodeId) {
            return
          }

          const linkedNode = project.workflow.nodes.find((node) => node.id === removedClip.workflowNodeId)

          if (linkedNode && 'timelineClipId' in linkedNode.data) {
            linkedNode.data.timelineClipId = null
          }

          return
        }
      },
    }))

    steps.push({
      type: 'track.remove',
      label: `Track removed: ${selectedTrack.name}`,
      mutate: (project) => {
        project.timeline.tracks = project.timeline.tracks.filter((track) => track.id !== selectedTrackId)
      },
    })

    applyGroupedMutations(set, get, 'track.remove.group', 'Selected track deleted', steps)
  },
  showSelectedClipInWorkflow: () => {
    const selectedClipId = get().ui.selectedClipId

    if (!selectedClipId) {
      return
    }

    let selectedWorkflowNodeId =
      get()
        .project.timeline.tracks
        .flatMap((track) => track.clips)
        .find((clip) => clip.id === selectedClipId)?.workflowNodeId ?? null

    if (!selectedWorkflowNodeId) {
      applyMutation(set, get, 'node.add', 'Workflow node created from timeline clip', (project) => {
        const selectedClip = project.timeline.tracks
          .flatMap((track) => track.clips)
          .find((clip) => clip.id === selectedClipId)

        if (!selectedClip || selectedClip.workflowNodeId) {
          selectedWorkflowNodeId = selectedClip?.workflowNodeId ?? null
          return
        }

        const asset = project.assets.assets[selectedClip.assetId]

        if (!asset) {
          return
        }

        const mediaSourceIndex = project.workflow.nodes.filter((node) => node.type === 'media_source').length + 1
        const workflowNodeId = `${nextId('node-media')}-${mediaSourceIndex}`

        project.workflow.nodes.push({
          id: workflowNodeId,
          type: 'media_source',
          position: {
            x: 80,
            y: 240 + project.workflow.nodes.filter((node) => node.type === 'media_source').length * 90,
          },
          data: {
            assetId: asset.id,
            timelineClipId: selectedClip.id,
          },
          collapsed: false,
          bypassed: false,
          executionError: null,
          label: asset.name,
        })

        selectedClip.workflowNodeId = workflowNodeId
        selectedWorkflowNodeId = workflowNodeId
      })
    }

    set((state) => ({
      ui: {
        ...state.ui,
        activeView: 'workflow',
        selectedNodeId: selectedWorkflowNodeId,
        selectedNodeIds: selectedWorkflowNodeId ? [selectedWorkflowNodeId] : [],
        selectedClipId: null,
        selectedClipIds: [],
        selectedTrackId: null,
        statusMessage: selectedWorkflowNodeId
          ? 'Linked workflow node selected'
          : 'Selected clip has no linked workflow node',
      },
    }))
  },
  renameSelectedTrack: () => {
    const selectedTrackId = get().ui.selectedTrackId

    if (!selectedTrackId) {
      return
    }

    const currentTrack = get().project.timeline.tracks.find((track) => track.id === selectedTrackId)
    const nextName = window.prompt('Enter the new track name', currentTrack?.name ?? '')

    if (!nextName) {
      return
    }

    applyMutation(set, get, 'track.rename', 'Track renamed', (project) => {
      const track = project.timeline.tracks.find((entry) => entry.id === selectedTrackId)

      if (track) {
        track.name = nextName
      }
    })
  },
  toggleSelectedTrackLock: () =>
    applyMutation(set, get, 'track.lock.toggle', 'Track lock updated', (project) => {
      const selectedTrackId = get().ui.selectedTrackId
      const track = project.timeline.tracks.find((entry) => entry.id === selectedTrackId)

      if (track) {
        track.locked = !track.locked
      }
    }),
  toggleSelectedTrackMute: () =>
    applyMutation(set, get, 'track.mute.toggle', 'Track mute updated', (project) => {
      const selectedTrackId = get().ui.selectedTrackId
      const track = project.timeline.tracks.find((entry) => entry.id === selectedTrackId)

      if (track) {
        track.muted = !track.muted
      }
    }),
  toggleSelectedTrackSolo: () =>
    applyMutation(set, get, 'track.solo.toggle', 'Track solo updated', (project) => {
      const selectedTrackId = get().ui.selectedTrackId
      const track = project.timeline.tracks.find((entry) => entry.id === selectedTrackId)

      if (track) {
        track.solo = !track.solo
      }
    }),
  toggleSelectedTrackVisibility: () =>
    applyMutation(set, get, 'track.visibility.toggle', 'Track visibility updated', (project) => {
      const selectedTrackId = get().ui.selectedTrackId
      const track = project.timeline.tracks.find((entry) => entry.id === selectedTrackId)

      if (track) {
        track.visible = !track.visible
      }
    }),
  setSelectedTrackVolume: (volume) =>
    applyMutation(set, get, 'track.volume.set', 'Track volume updated', (project) => {
      const selectedTrackId = get().ui.selectedTrackId
      const track = project.timeline.tracks.find((entry) => entry.id === selectedTrackId)

      if (track && track.type === 'audio') {
        track.volume = Math.max(0, Math.min(2, Number(volume.toFixed(2))))
      }
    }),
  setSelectedTrackPan: (pan) =>
    applyMutation(set, get, 'track.pan.set', 'Track pan updated', (project) => {
      const selectedTrackId = get().ui.selectedTrackId
      const track = project.timeline.tracks.find((entry) => entry.id === selectedTrackId)

      if (track && track.type === 'audio') {
        track.pan = Math.max(-1, Math.min(1, Number(pan.toFixed(2))))
      }
    }),
  cycleSelectedTrackHeight: () =>
    applyMutation(set, get, 'track.height.cycle', 'Track height updated', (project) => {
      const selectedTrackId = get().ui.selectedTrackId
      const track = project.timeline.tracks.find((entry) => entry.id === selectedTrackId)
      const nextHeights = [60, 84, 112]

      if (!track) {
        return
      }

      const currentIndex = nextHeights.findIndex((height) => height === track.height)
      track.height = nextHeights[(currentIndex + 1 + nextHeights.length) % nextHeights.length]
    }),
  setSelectedTrackHeight: (height) =>
    applyMutation(set, get, 'track.height.set', 'Track height updated', (project) => {
      const selectedTrackId = get().ui.selectedTrackId
      const track = project.timeline.tracks.find((entry) => entry.id === selectedTrackId)
      const allowedHeights = [60, 84, 112]

      if (!track) {
        return
      }

      track.height = allowedHeights.includes(height) ? height : 84
    }),
  moveSelectedClipToAdjacentTrack: (direction) =>
    applyMutation(set, get, 'clip.move', 'Selected clips moved between tracks', (project) => {
      const selectedClipIds = new Set(get().ui.selectedClipIds)

      if (selectedClipIds.size === 0) {
        return
      }

      const orderedTracks = project.timeline.tracks
      const trackDelta = direction === 'up' ? -1 : 1

      for (const clipId of selectedClipIds) {
        const currentTrackIndex = findTrackIndexByClipId(project, clipId)

        if (currentTrackIndex === -1) {
          continue
        }

        const targetTrackIndex = currentTrackIndex + trackDelta
        const currentTrack = orderedTracks[currentTrackIndex]
        const targetTrack = orderedTracks[targetTrackIndex]

        if (!currentTrack || !targetTrack || currentTrack.locked || targetTrack.locked) {
          continue
        }

        const clipIndex = currentTrack.clips.findIndex((clip) => clip.id === clipId)

        if (clipIndex === -1) {
          continue
        }

        const [clip] = currentTrack.clips.splice(clipIndex, 1)
        clip.trackId = targetTrack.id
        targetTrack.clips.push(clip)
      }
    }),
  setSelectedClipStartTime: (startTime) =>
    applyMutation(set, get, 'clip.move', 'Clip start time updated', (project) => {
      const selectedClipIds = new Set(get().ui.selectedClipIds)

      for (const track of project.timeline.tracks) {
        for (const clip of track.clips) {
          if (selectedClipIds.has(clip.id)) {
            clip.startTime = Math.max(0, Number(startTime.toFixed(2)))
          }
        }
      }
    }),
  setSelectedClipDuration: (duration) =>
    applyMutation(set, get, 'clip.trim', 'Clip duration updated', (project) => {
      const selectedClipIds = new Set(get().ui.selectedClipIds)

      for (const track of project.timeline.tracks) {
        for (const clip of track.clips) {
          if (selectedClipIds.has(clip.id)) {
            const nextDuration = clampClipDuration(duration)
            clip.duration = nextDuration
            clip.outPoint = Number((clip.inPoint + nextDuration).toFixed(2))
            clip.keyframes = clip.keyframes
              .filter((keyframe) => keyframe.time <= nextDuration)
              .map((keyframe) => ({ ...keyframe, time: Math.min(keyframe.time, nextDuration) }))
            sortClipKeyframes(clip.keyframes)
          }
        }
      }
    }),
  setSelectedClipInPoint: (inPoint) =>
    applyMutation(set, get, 'clip.trim', 'Clip in point updated', (project) => {
      const selectedClipIds = new Set(get().ui.selectedClipIds)

      for (const track of project.timeline.tracks) {
        for (const clip of track.clips) {
          if (selectedClipIds.has(clip.id)) {
            const nextInPoint = Math.max(0, Number(inPoint.toFixed(2)))
            const nextOutPoint = Math.max(Number((nextInPoint + 0.1).toFixed(2)), clip.outPoint)
            clip.inPoint = nextInPoint
            clip.outPoint = nextOutPoint
            clip.duration = clampClipDuration(nextOutPoint - nextInPoint)
            clip.keyframes = clip.keyframes
              .filter((keyframe) => keyframe.time <= clip.duration)
              .map((keyframe) => ({ ...keyframe, time: Math.min(keyframe.time, clip.duration) }))
            sortClipKeyframes(clip.keyframes)
          }
        }
      }
    }),
  setSelectedClipOutPoint: (outPoint) =>
    applyMutation(set, get, 'clip.trim', 'Clip out point updated', (project) => {
      const selectedClipIds = new Set(get().ui.selectedClipIds)

      for (const track of project.timeline.tracks) {
        for (const clip of track.clips) {
          if (selectedClipIds.has(clip.id)) {
            const minOutPoint = Number((clip.inPoint + 0.1).toFixed(2))
            const nextOutPoint = Math.max(minOutPoint, Number(outPoint.toFixed(2)))
            clip.outPoint = nextOutPoint
            clip.duration = clampClipDuration(nextOutPoint - clip.inPoint)
            clip.keyframes = clip.keyframes
              .filter((keyframe) => keyframe.time <= clip.duration)
              .map((keyframe) => ({ ...keyframe, time: Math.min(keyframe.time, clip.duration) }))
            sortClipKeyframes(clip.keyframes)
          }
        }
      }
    }),
  setSelectedClipSpeed: (speed) =>
    applyMutation(set, get, 'clip.speed', 'Clip speed updated', (project) => {
      const selectedClipIds = new Set(get().ui.selectedClipIds)

      for (const track of project.timeline.tracks) {
        for (const clip of track.clips) {
          if (selectedClipIds.has(clip.id)) {
            clip.speed = speed
          }
        }
      }
    }),
  setSelectedClipVolume: (volume) =>
    applyMutation(set, get, 'clip.volume', 'Clip volume updated', (project) => {
      const selectedClipIds = new Set(get().ui.selectedClipIds)

      for (const track of project.timeline.tracks) {
        for (const clip of track.clips) {
          if (selectedClipIds.has(clip.id)) {
            clip.volume = Math.max(0, Math.min(2, Number(volume.toFixed(2))))
          }
        }
      }
    }),
  setSelectedClipOpacity: (opacity) =>
    applyMutation(set, get, 'clip.opacity', 'Clip opacity updated', (project) => {
      const selectedClipIds = new Set(get().ui.selectedClipIds)

      for (const track of project.timeline.tracks) {
        for (const clip of track.clips) {
          if (selectedClipIds.has(clip.id)) {
            clip.opacity = Math.max(0, Math.min(1, Number(opacity.toFixed(2))))
          }
        }
      }
    }),
  setSelectedClipTransformField: (field, value) =>
    applyMutation(set, get, 'clip.transform', 'Clip transform updated', (project) => {
      const selectedClipIds = new Set(get().ui.selectedClipIds)

      for (const track of project.timeline.tracks) {
        for (const clip of track.clips) {
          if (selectedClipIds.has(clip.id)) {
            clip.transform[field] = Number(value.toFixed(2))
          }
        }
      }
    }),
  addSelectedClipKeyframe: (property) =>
    applyMutation(set, get, 'keyframe.add', 'Clip keyframe added', (project) => {
      const selectedClipId = get().ui.selectedClipId

      if (!selectedClipId) {
        return
      }

      const playhead = project.timeline.playhead

      for (const track of project.timeline.tracks) {
        const clip = track.clips.find((item) => item.id === selectedClipId)

        if (!clip) {
          continue
        }

        const relativeTime = clampClipKeyframeTime(clip, playhead - clip.startTime)
        const existing = clip.keyframes.find(
          (keyframe) => keyframe.property === property && Math.abs(keyframe.time - relativeTime) < 0.01,
        )

        if (existing) {
          existing.value = getClipKeyframeValueByProperty(clip, property)
          existing.easing = 'linear'
        } else {
          clip.keyframes.push({
            id: `${nextId('kf')}-${clip.keyframes.length + 1}`,
            time: relativeTime,
            property,
            value: getClipKeyframeValueByProperty(clip, property),
            easing: 'linear',
          })
        }

        sortClipKeyframes(clip.keyframes)
        return
      }
    }),
  updateSelectedClipKeyframe: (keyframeId, updates) =>
    applyMutation(set, get, 'keyframe.move', 'Clip keyframe updated', (project) => {
      const selectedClipId = get().ui.selectedClipId

      if (!selectedClipId) {
        return
      }

      for (const track of project.timeline.tracks) {
        const clip = track.clips.find((item) => item.id === selectedClipId)

        if (!clip) {
          continue
        }

        const keyframe = clip.keyframes.find((item) => item.id === keyframeId)

        if (!keyframe) {
          return
        }

        if (typeof updates.time === 'number') {
          keyframe.time = clampClipKeyframeTime(clip, updates.time)
        }

        if (typeof updates.value === 'number') {
          keyframe.value = Number(updates.value.toFixed(2))
        }

        if (updates.easing) {
          keyframe.easing = updates.easing
        }

        sortClipKeyframes(clip.keyframes)
        return
      }
    }),
  removeSelectedClipKeyframe: (keyframeId) =>
    applyMutation(set, get, 'keyframe.remove', 'Clip keyframe removed', (project) => {
      const selectedClipId = get().ui.selectedClipId

      if (!selectedClipId) {
        return
      }

      for (const track of project.timeline.tracks) {
        const clip = track.clips.find((item) => item.id === selectedClipId)

        if (!clip) {
          continue
        }

        clip.keyframes = clip.keyframes.filter((item) => item.id !== keyframeId)
        return
      }
    }),
  setMasterVolume: (volume) =>
    applyMutation(set, get, 'audio.master.set', 'Master volume updated', (project) => {
      project.audio.masterVolume = Math.max(0, Math.min(1, Number(volume.toFixed(2))))
    }),
  toggleScrubEnabled: () => {
    const nextEnabled = !get().project.audio.scrubEnabled
    applyMutation(set, get, 'audio.scrub.toggle', 'Audio scrubbing updated', (project) => {
      project.audio.scrubEnabled = nextEnabled
    })

    if (!nextEnabled) {
      set((state) => ({
        ui: {
          ...state.ui,
          scrubPreviewState: createIdleScrubPreviewState(),
        },
      }))
    }
  },
  cycleWaveformDensity: () =>
    applyMutation(set, get, 'audio.waveform.cycle', 'Waveform density updated', (project) => {
      const densities: Array<typeof project.audio.waveformDensity> = ['compact', 'balanced', 'detailed']
      const currentIndex = densities.indexOf(project.audio.waveformDensity)
      project.audio.waveformDensity = densities[(currentIndex + 1) % densities.length]
    }),
  setScrubPreviewState: (previewState) =>
    set((state) => ({
      ui: {
        ...state.ui,
        scrubPreviewState: previewState,
      },
    })),
  clearScrubPreviewState: () =>
    set((state) => ({
      ui: {
        ...state.ui,
        scrubPreviewState: createIdleScrubPreviewState(),
      },
    })),
  selectNode: (nodeId, additive = false) =>
    set((state) => {
      const nextSelectedNodeIds =
        nodeId === null
          ? []
          : additive
            ? state.ui.selectedNodeIds.includes(nodeId)
              ? state.ui.selectedNodeIds.filter((id) => id !== nodeId)
              : [...state.ui.selectedNodeIds, nodeId]
            : [nodeId]

      return {
        ui: {
          ...state.ui,
          selectedNodeId: nextSelectedNodeIds[0] ?? null,
          selectedNodeIds: nextSelectedNodeIds,
          selectedClipId: null,
          selectedClipIds: [],
          selectedTrackId: null,
        },
      }
    }),
  setWorkflowSelection: (nodeIds) =>
    set((state) => ({
      ui: {
        ...state.ui,
        selectedNodeId: nodeIds[0] ?? null,
        selectedNodeIds: nodeIds,
        selectedClipId: null,
        selectedClipIds: [],
        selectedTrackId: null,
        statusMessage: nodeIds.length === 0 ? 'Workflow selection cleared' : `Selected ${nodeIds.length} node(s)`,
      },
    })),
  selectAllWorkflowNodes: () =>
    set((state) => {
      const nodeIds = state.project.workflow.nodes.map((node) => node.id)
      return {
        ui: {
          ...state.ui,
          selectedNodeId: nodeIds[0] ?? null,
          selectedNodeIds: nodeIds,
          selectedClipId: null,
          selectedClipIds: [],
          selectedTrackId: null,
          statusMessage: nodeIds.length === 0 ? 'No nodes to select' : `Selected ${nodeIds.length} node(s)`,
        },
      }
    }),
  selectOutputNode: () =>
    set((state) => {
      const outputNode = state.project.workflow.nodes.find((node) => node.type === 'output') ?? null
      return {
        ui: {
          ...state.ui,
          selectedNodeId: outputNode?.id ?? null,
          selectedNodeIds: outputNode ? [outputNode.id] : [],
          selectedClipId: null,
          selectedClipIds: [],
          selectedTrackId: null,
          statusMessage: outputNode ? 'Output node selected' : 'No output node available',
        },
      }
    }),
  copySelectedNodes: () =>
    set((state) => {
      const selectedNodeIds = new Set(state.ui.selectedNodeIds)
      const nodes = state.project.workflow.nodes
        .filter((node) => selectedNodeIds.has(node.id))
        .map((node) => structuredClone(node))
      const groups = state.project.workflow.groups
        .filter((group) => group.nodeIds.every((nodeId) => selectedNodeIds.has(nodeId)))
        .map((group) => structuredClone(group))
      const edges = state.project.workflow.edges
        .filter((edge) => selectedNodeIds.has(edge.source) && selectedNodeIds.has(edge.target))
        .map((edge) => structuredClone(edge))

      return {
        ui: {
          ...state.ui,
          workflowClipboard: {
            nodes,
            groups,
            edges,
          },
          statusMessage: nodes.length === 0 ? 'No nodes copied' : `Copied ${nodes.length} node(s)`,
        },
      }
    }),
  pasteWorkflowClipboard: () => {
    const clipboard = get().ui.workflowClipboard

    if (clipboard.nodes.length === 0) {
      return
    }

    const nodeIdMap = new Map<string, string>()
    const duplicatedNodes = clipboard.nodes.map((node) => {
      const duplicatedNodeId = nextId(node.type)
      nodeIdMap.set(node.id, duplicatedNodeId)

      return {
        ...structuredClone(node),
        id: duplicatedNodeId,
        position: {
          x: node.position.x + 56,
          y: node.position.y + 40,
        },
        label: node.label ? `${node.label} Copy` : `${node.type.replace('_', ' ')} Copy`,
        data:
          node.type === 'media_source'
            ? {
                ...structuredClone(node.data),
                timelineClipId: null,
              }
            : structuredClone(node.data),
      }
    })
    const duplicatedEdges = clipboard.edges.map((edge) => ({
      ...structuredClone(edge),
      id: nextId('edge'),
      source: nodeIdMap.get(edge.source) ?? edge.source,
      target: nodeIdMap.get(edge.target) ?? edge.target,
    }))
    const duplicatedGroups = clipboard.groups
      .map((group) => ({
        ...structuredClone(group),
        id: nextId('group'),
        label: `${group.label} Copy`,
        nodeIds: group.nodeIds
          .map((nodeId) => nodeIdMap.get(nodeId))
          .filter((nodeId): nodeId is string => typeof nodeId === 'string'),
      }))
      .filter((group) => group.nodeIds.length >= 2)

    applyGroupedMutations(
      set,
      get,
      'node.paste.group',
      'Workflow clipboard pasted',
      [
        ...duplicatedNodes.map((node) => ({
          type: 'node.add',
          label: `Node pasted: ${node.label ?? node.id}`,
          mutate: (project: FluxNodeProject) => {
            project.workflow.nodes.push(structuredClone(node))
          },
        })),
        ...duplicatedEdges.map((edge) => ({
          type: 'edge.add',
          label: `Edge pasted: ${edge.id}`,
          mutate: (project: FluxNodeProject) => {
            project.workflow.edges.push(structuredClone(edge))
          },
        })),
        ...duplicatedGroups.map((group) => ({
          type: 'group.add',
          label: `Group pasted: ${group.label}`,
          mutate: (project: FluxNodeProject) => {
            project.workflow.groups.push(structuredClone(group))
          },
        })),
      ],
    )

    set((state) => ({
      ui: {
        ...state.ui,
        selectedNodeId: duplicatedNodes[0]?.id ?? null,
        selectedNodeIds: duplicatedNodes.map((node) => node.id),
      },
    }))
  },
  groupSelectedWorkflowNodes: () =>
    applyMutation(set, get, 'group.add', 'Workflow nodes grouped', (project) => {
      const selectedNodeIds = Array.from(new Set(get().ui.selectedNodeIds))

      if (selectedNodeIds.length < 2) {
        return
      }

      const existingNodeIds = new Set(project.workflow.nodes.map((node) => node.id))
      const validNodeIds = selectedNodeIds.filter((nodeId) => existingNodeIds.has(nodeId))

      if (validNodeIds.length < 2) {
        return
      }

      project.workflow.groups = project.workflow.groups.map((group) => ({
        ...group,
        nodeIds: group.nodeIds.filter((nodeId) => !validNodeIds.includes(nodeId)),
      }))
      normalizeWorkflowGroups(project)

      project.workflow.groups.push({
        id: nextId('group'),
        label: `Group ${project.workflow.groups.length + 1}`,
        nodeIds: validNodeIds,
        color: createWorkflowGroupColor(project.workflow.groups.length),
      })
    }),
  duplicateSelected: () =>
    applyMutation(set, get, 'selection.duplicate', 'Selection duplicated', (project) => {
      const activeView = get().ui.activeView

      if (activeView === 'timeline') {
        const selectedClipIds = get().ui.selectedClipIds

        if (selectedClipIds.length === 0) {
          return
        }

        selectedClipIds.forEach((selectedClipId) => {
          const track = project.timeline.tracks.find((item) =>
            item.clips.some((clip) => clip.id === selectedClipId),
          )
          const sourceClip = track?.clips.find((clip) => clip.id === selectedClipId)

          if (!track || !sourceClip) {
            return
          }

          const nextIndex = track.clips.length + 1
          const clipId = `${sourceClip.id}-dup-${nextIndex.toString().padStart(2, '0')}`
          const duplicatedNode = createMediaSourceNode(project, clipId, sourceClip.assetId, `${sourceClip.id} Source`)

          track.clips.push({
            ...sourceClip,
            id: clipId,
            startTime: Number((sourceClip.startTime + sourceClip.duration + 0.4).toFixed(2)),
            workflowNodeId: duplicatedNode.id,
            linkedClipId: null,
          })

          project.workflow.nodes.push(duplicatedNode)
        })
        return
      }

      const selectedNodeIds = get().ui.selectedNodeIds

      if (selectedNodeIds.length === 0) {
        return
      }

      const selectedNodeIdSet = new Set(selectedNodeIds)
      const selectedGroups = project.workflow.groups.filter((group) =>
        group.nodeIds.every((nodeId) => selectedNodeIdSet.has(nodeId)),
      )
      const idMap = new Map<string, string>()
      const duplicatedNodes = project.workflow.nodes
        .filter((node) => selectedNodeIdSet.has(node.id))
        .map((sourceNode, index) => {
          const duplicatedId = `${nextId(sourceNode.type)}-${index + 1}`
          idMap.set(sourceNode.id, duplicatedId)

          return {
            ...sourceNode,
            id: duplicatedId,
            position: {
              x: sourceNode.position.x + 42,
              y: sourceNode.position.y + 28,
            },
            label: `${sourceNode.label ?? sourceNode.type} Copy`,
            data:
              sourceNode.type === 'media_source'
                ? {
                    ...sourceNode.data,
                    timelineClipId: null,
                  }
                : structuredClone(sourceNode.data),
          }
        })
      const duplicatedEdges = project.workflow.edges
        .filter((edge) => selectedNodeIdSet.has(edge.source) && selectedNodeIdSet.has(edge.target))
        .map((edge, index) => ({
          ...edge,
          id: `${nextId('edge')}-dup-${index + 1}`,
          source: idMap.get(edge.source) ?? edge.source,
          target: idMap.get(edge.target) ?? edge.target,
        }))
      const duplicatedGroups = selectedGroups
        .map((group, index) => ({
          ...structuredClone(group),
          id: `${nextId('group')}-dup-${index + 1}`,
          label: `${group.label} Copy`,
          nodeIds: group.nodeIds
            .map((nodeId) => idMap.get(nodeId))
            .filter((nodeId): nodeId is string => typeof nodeId === 'string'),
        }))
        .filter((group) => group.nodeIds.length >= 2)

      project.workflow.nodes.push(...duplicatedNodes)
      project.workflow.edges.push(...duplicatedEdges)
      project.workflow.groups.push(...duplicatedGroups)
    }),
  deleteSelected: () => {
    const activeView = get().ui.activeView

    if (activeView === 'timeline') {
      const selectedClipIds = new Set(get().ui.selectedClipIds)

      if (selectedClipIds.size === 0) {
        return
      }

      const linkedNodes = get()
        .project.timeline.tracks
        .flatMap((track) => track.clips)
        .filter((clip) => selectedClipIds.has(clip.id) && clip.workflowNodeId)
        .map((clip) => clip.workflowNodeId)
        .filter((nodeId): nodeId is string => typeof nodeId === 'string')

      const shouldRemoveLinkedNodes =
        linkedNodes.length > 0
          ? window.confirm(
              linkedNodes.length === 1
                ? 'Remove the linked workflow node for this clip too? Click Cancel to keep the node and only unlink it.'
                : `Remove ${linkedNodes.length} linked workflow node(s) too? Click Cancel to keep the nodes and only unlink them.`,
            )
          : false
      const linkedNodeIdSet = new Set(linkedNodes)

      applyMutation(set, get, 'selection.delete', 'Selection deleted', (project) => {
        for (const track of project.timeline.tracks) {
          track.clips = track.clips.filter((clip) => {
            if (!selectedClipIds.has(clip.id)) {
              return true
            }

            if (clip.workflowNodeId) {
              const linkedNode = project.workflow.nodes.find(
                (node) => node.id === clip.workflowNodeId,
              )

              if (linkedNode && 'timelineClipId' in linkedNode.data) {
                linkedNode.data.timelineClipId = null
              }
            }

            return false
          })
        }

        if (shouldRemoveLinkedNodes && linkedNodeIdSet.size > 0) {
          project.workflow.nodes = project.workflow.nodes.filter((node) => !linkedNodeIdSet.has(node.id))
          project.workflow.edges = project.workflow.edges.filter(
            (edge) => !linkedNodeIdSet.has(edge.source) && !linkedNodeIdSet.has(edge.target),
          )
        }
      })
      return
    }

    applyMutation(set, get, 'selection.delete', 'Selection deleted', (project) => {
      const selectedNodeIds = new Set(get().ui.selectedNodeIds)

      if (selectedNodeIds.size === 0) {
        return
      }

      project.workflow.nodes = project.workflow.nodes.filter((node) => !selectedNodeIds.has(node.id))
      project.workflow.edges = project.workflow.edges.filter(
        (edge) => !selectedNodeIds.has(edge.source) && !selectedNodeIds.has(edge.target),
      )
      project.workflow.groups = project.workflow.groups.map((group) => ({
        ...group,
        nodeIds: group.nodeIds.filter((nodeId) => !selectedNodeIds.has(nodeId)),
      }))
      normalizeWorkflowGroups(project)

      for (const track of project.timeline.tracks) {
        for (const clip of track.clips) {
          if (clip.workflowNodeId && selectedNodeIds.has(clip.workflowNodeId)) {
            clip.workflowNodeId = null
          }
        }
      }
    })
  },
  createTimelineClipFromSelectedNode: () => {
    const selectedNodeId = get().ui.selectedNodeId

    if (!selectedNodeId) {
      return
    }

    const selectedNodeSnapshot = get().project.workflow.nodes.find((node) => node.id === selectedNodeId)

    if (!selectedNodeSnapshot || selectedNodeSnapshot.type !== 'media_source') {
      return
    }

    const selectedNodeSnapshotData = selectedNodeSnapshot.data as {
      assetId: string | null
      timelineClipId: string | null
    }

    const timelineClipId =
      typeof selectedNodeSnapshotData.timelineClipId === 'string' ? selectedNodeSnapshotData.timelineClipId : null

    if (timelineClipId) {
      get().showSelectedNodeInTimeline()
      return
    }

    const assetId =
      typeof selectedNodeSnapshotData.assetId === 'string' ? selectedNodeSnapshotData.assetId : null

    if (!assetId) {
      return
    }

    let createdClipId: string | null = null
    let createdTrackId: string | null = null

    applyMutation(set, get, 'clip.add', 'Timeline clip created from workflow node', (project) => {
      const selectedNode = project.workflow.nodes.find((node) => node.id === selectedNodeId)

      if (!selectedNode || selectedNode.type !== 'media_source') {
        return
      }

      const selectedNodeData = selectedNode.data as {
        assetId: string | null
        timelineClipId: string | null
      }

      const linkedClipId =
        typeof selectedNodeData.timelineClipId === 'string' ? selectedNodeData.timelineClipId : null

      if (linkedClipId) {
        createdClipId = linkedClipId
        createdTrackId =
          project.timeline.tracks.find((track) => track.clips.some((clip) => clip.id === linkedClipId))?.id ?? null
        return
      }

      const asset = project.assets.assets[assetId]

      if (!asset) {
        return
      }

      const targetTrackType: Track['type'] = asset.type === 'audio' ? 'audio' : 'video'
      let targetTrack = project.timeline.tracks.find((track) => track.type === targetTrackType) ?? null

      if (!targetTrack) {
        targetTrack = createTrack(project, targetTrackType, project.timeline.tracks.length)
        project.timeline.tracks.push(targetTrack)
      }

      const clipId = `${nextId('clip')}-${selectedNode.id}`
      const timelineEnd = Math.max(
        ...project.timeline.tracks.flatMap((track) => track.clips.map((clip) => clip.startTime + clip.duration)),
        project.timeline.outPoint ?? 0,
        0,
      )
      const clipDuration = asset.duration ?? 4

      targetTrack.clips.push({
        id: clipId,
        assetId: asset.id,
        trackId: targetTrack.id,
        startTime: Number(timelineEnd.toFixed(2)),
        duration: clipDuration,
        inPoint: 0,
        outPoint: clipDuration,
        speed: 1,
        volume: 1,
        opacity: 1,
        transform: {
          x: 0,
          y: 0,
          scaleX: 1,
          scaleY: 1,
          rotation: 0,
          anchorX: 0.5,
          anchorY: 0.5,
        },
        keyframes: [],
        linkedClipId: null,
        workflowNodeId: selectedNode.id,
      })

      selectedNodeData.timelineClipId = clipId
      createdClipId = clipId
      createdTrackId = targetTrack.id
    })

    if (!createdClipId) {
      return
    }

    set((state) => ({
      ui: {
        ...state.ui,
        activeView: 'timeline',
        selectedClipId: createdClipId,
        selectedClipIds: createdClipId ? [createdClipId] : [],
        selectedTrackId: createdTrackId,
        selectedNodeId: null,
        selectedNodeIds: [],
        statusMessage: 'Timeline clip created from workflow node',
      },
    }))
  },
  showSelectedNodeInTimeline: () => {
    const state = get()
    const selectedNode = state.project.workflow.nodes.find((node) => node.id === state.ui.selectedNodeId)
    const timelineClipId =
      selectedNode && 'timelineClipId' in selectedNode.data && typeof selectedNode.data.timelineClipId === 'string'
        ? selectedNode.data.timelineClipId
        : null

    if (!timelineClipId && selectedNode?.type === 'media_source') {
      get().createTimelineClipFromSelectedNode()
      return
    }

    const selectedTrackId = timelineClipId
      ? findCommittedTrackByClipId(state.project, timelineClipId)?.id ?? null
      : null

    set((currentState) => ({
      ui: {
        ...currentState.ui,
        activeView: 'timeline',
        selectedNodeId: null,
        selectedNodeIds: [],
        selectedClipId: timelineClipId,
        selectedClipIds: timelineClipId ? [timelineClipId] : [],
        selectedTrackId,
        statusMessage: timelineClipId
          ? 'Linked timeline clip selected'
          : 'Selected node has no linked timeline clip',
      },
    }))
  },
  setSelectedNodeLabel: (label) =>
    applyMutation(set, get, 'workflow.node.label', 'Selected node label updated', (project) => {
      const selectedNodeId = get().ui.selectedNodeId
      const selectedNode = project.workflow.nodes.find((node) => node.id === selectedNodeId)

      if (!selectedNode) {
        return
      }

      const trimmed = label.trim()
      selectedNode.label = trimmed.length > 0 ? trimmed : null
    }),
  setNodeDataField: (nodeId, path, value) =>
    applyMutation(set, get, 'workflow.node.data', 'Workflow node data updated', (project) => {
      const targetNode = project.workflow.nodes.find((node) => node.id === nodeId)

      if (!targetNode) {
        return
      }

      setNestedNodeDataValue(targetNode.data as Record<string, unknown>, path, value)
    }),
  setSelectedNodeDataField: (path, value) =>
    get().setNodeDataField(get().ui.selectedNodeId ?? '', path, value),
  toggleSelectedNodeCollapsed: () =>
    applyMutation(set, get, 'workflow.node.collapse', 'Selected node collapse state updated', (project) => {
      const selectedNodeId = get().ui.selectedNodeId
      const selectedNode = project.workflow.nodes.find((node) => node.id === selectedNodeId)

      if (!selectedNode) {
        return
      }

      selectedNode.collapsed = !selectedNode.collapsed
    }),
  toggleSelectedNodeBypass: () =>
    applyMutation(set, get, 'workflow.node.bypass', 'Selected node bypass state updated', (project) => {
      const selectedNodeId = get().ui.selectedNodeId
      const selectedNode = project.workflow.nodes.find((node) => node.id === selectedNodeId)

      if (!selectedNode || selectedNode.type === 'output' || selectedNode.type === 'media_source') {
        return
      }

      selectedNode.bypassed = !selectedNode.bypassed
    }),
  setSelectedNodeComputeSource: (source) =>
    applyMutation(set, get, 'workflow.node.compute', 'Selected node compute source updated', (project) => {
      const selectedNodeId = get().ui.selectedNodeId
      const selectedNode = project.workflow.nodes.find((node) => node.id === selectedNodeId)

      if (!selectedNode || (selectedNode.type !== 'ai_generate' && selectedNode.type !== 'ai_upscale')) {
        return
      }

      if (source === 'cloud' && get().ui.networkStatus === 'offline') {
        return
      }

      if (selectedNode.type === 'ai_generate' || selectedNode.type === 'ai_upscale') {
        ;(selectedNode.data as { computeSource: 'local' | 'cloud' | 'project' }).computeSource = source
      }
    }),
  simulateSelectedNodeExecutionFailure: () => {
    const selectedNodeSnapshot = get().project.workflow.nodes.find((node) => node.id === get().ui.selectedNodeId)

    if (!selectedNodeSnapshot) {
      return
    }

    applyMutation(set, get, 'workflow.node.execution.fail', 'Selected node marked with ComfyUI execution failure', (project) => {
      const selectedNodeId = get().ui.selectedNodeId
      const selectedNode = project.workflow.nodes.find((node) => node.id === selectedNodeId)

      if (!selectedNode) {
        return
      }

      selectedNode.executionError = {
        category: 'comfy_execution',
        message: 'Node execution failed in ComfyUI.',
        detail:
          selectedNode.type === 'ai_generate' || selectedNode.type === 'ai_upscale'
            ? 'ComfyUI returned an execution error for the selected AI node. Inspect prompt, model, or inputs before retrying.'
            : 'The selected node failed during a simulated ComfyUI execution pass.',
        failedAt: new Date().toISOString(),
      }
    })

    pushAppError(set, {
      id: `${nextId('error')}-${selectedNodeSnapshot.id}`,
      category: 'comfy_execution',
      message: `ComfyUI execution failed for ${selectedNodeSnapshot.id}.`,
      userMessage: `${selectedNodeSnapshot.label ?? selectedNodeSnapshot.id} failed during ComfyUI execution.`,
      recoverable: true,
      suggestedAction: 'Inspect the failed node, review its inputs, then clear the failure after fixing the workflow.',
      actionLabel: 'Inspect Node',
      actionCommand: 'inspect_node',
      contextId: selectedNodeSnapshot.id,
      detail:
        selectedNodeSnapshot.type === 'ai_generate' || selectedNodeSnapshot.type === 'ai_upscale'
          ? 'Prompt, model, or media input may be invalid for the selected AI node.'
          : 'The node reported a simulated local workflow execution failure.',
      createdAt: new Date().toISOString(),
    })
  },
  clearSelectedNodeExecutionFailure: () =>
    applyMutation(set, get, 'workflow.node.execution.clear', 'Selected node execution failure cleared', (project) => {
      const selectedNodeId = get().ui.selectedNodeId
      const selectedNode = project.workflow.nodes.find((node) => node.id === selectedNodeId)

      if (!selectedNode) {
        return
      }

      selectedNode.executionError = null
    }),
  splitSelectedClip: () =>
    applyMutation(set, get, 'clip.split', 'Clip split at playhead', (project) => {
      const selectedClipId = get().ui.selectedClipId

      if (!selectedClipId) {
        return
      }

      const playhead = project.timeline.playhead

      for (const track of project.timeline.tracks) {
        const clipIndex = track.clips.findIndex((clip) => clip.id === selectedClipId)

        if (clipIndex === -1) {
          continue
        }

        const clip = track.clips[clipIndex]
        const clipEnd = clip.startTime + clip.duration

        if (playhead <= clip.startTime || playhead >= clipEnd) {
          return
        }

        const leftDuration = Number((playhead - clip.startTime).toFixed(2))
        const rightDuration = Number((clipEnd - playhead).toFixed(2))
        // `clip` is an immer draft here (applyMutation now runs mutate() through
        // produceWithPatches), and structuredClone can't clone a Proxy — snapshot via a
        // plain shallow copy instead of the structuredClone this used before immer.
        const originalKeyframes = clip.keyframes.map((keyframe) => ({ ...keyframe }))

        clip.duration = leftDuration
        clip.outPoint = Number((clip.inPoint + leftDuration).toFixed(2))
        clip.keyframes = originalKeyframes
          .filter((keyframe) => keyframe.time <= leftDuration)
          .map((keyframe) => ({
            ...keyframe,
            time: clampClipKeyframeTime(clip, keyframe.time),
          }))

        const duplicated = {
          ...clip,
          // Fresh ids rather than `${clip.id}-split`: splitting an already-split clip
          // (whose id already ends in "-split") previously produced a duplicate id,
          // corrupting by-id lookups/selection for both halves.
          id: nextId('clip'),
          startTime: playhead,
          duration: rightDuration,
          inPoint: clip.outPoint,
          outPoint: Number((clip.outPoint + rightDuration).toFixed(2)),
          workflowNodeId: null,
          linkedClipId: null,
          keyframes: originalKeyframes
            .filter((keyframe) => keyframe.time >= leftDuration)
            .map((keyframe) => ({
              ...keyframe,
              id: nextId('keyframe'),
              time: Math.max(0, Number((keyframe.time - leftDuration).toFixed(2))),
            })),
        }

        sortClipKeyframes(clip.keyframes)
        sortClipKeyframes(duplicated.keyframes)
        track.clips.splice(clipIndex + 1, 0, duplicated)
        return
      }
    }),
  connectSelectedNodeToOutput: () =>
    applyMutation(set, get, 'edge.add', 'Selected node connected to output', (project) => {
      const selectedNodeId = get().ui.selectedNodeId

      if (!selectedNodeId) {
        return
      }

      const sourceNode = project.workflow.nodes.find((node) => node.id === selectedNodeId)
      const outputNode = project.workflow.nodes.find((node) => node.type === 'output')

      if (!sourceNode || !outputNode || sourceNode.id === outputNode.id) {
        return
      }

      const sourcePort = NODE_PORT_DEFINITIONS[sourceNode.type].outputs[0]
      const targetPort = NODE_PORT_DEFINITIONS.output.inputs[0]

      if (!sourcePort || !targetPort) {
        return
      }

      const attempt = validateConnectionAttempt(project.workflow, {
        sourceNodeId: sourceNode.id,
        sourceHandle: sourcePort.name,
        targetNodeId: outputNode.id,
        targetHandle: targetPort.name,
      })

      if (!attempt.ok) {
        return
      }

      project.workflow.edges = replaceTargetConnectionIfNeeded(
        project.workflow.edges,
        outputNode.id,
        targetPort,
        {
          id: nextId('edge'),
          source: sourceNode.id,
          sourceHandle: sourcePort.name,
          target: outputNode.id,
          targetHandle: targetPort.name,
        },
      )
    }),
  disconnectSelectedNodeEdges: () =>
    applyMutation(set, get, 'edge.remove', 'Selected node edges disconnected', (project) => {
      const selectedNodeId = get().ui.selectedNodeId

      if (!selectedNodeId) {
        return
      }

      project.workflow.edges = project.workflow.edges.filter(
        (edge) => edge.source !== selectedNodeId && edge.target !== selectedNodeId,
      )
    }),
  moveWorkflowNodes: (nodeIds, deltaX, deltaY) =>
    applyMutation(set, get, 'node.move', 'Workflow nodes moved', (project) => {
      if (nodeIds.length === 0 || (deltaX === 0 && deltaY === 0)) {
        return
      }

      const selectedNodeIds = new Set(nodeIds)

      for (const node of project.workflow.nodes) {
        if (!selectedNodeIds.has(node.id)) {
          continue
        }

        node.position = {
          x: Number(Math.max(0, node.position.x + deltaX).toFixed(0)),
          y: Number(Math.max(0, node.position.y + deltaY).toFixed(0)),
        }
      }
    }),
  connectWorkflowPorts: (sourceNodeId, sourceHandle, targetNodeId, targetHandle) => {
    const project = get().project
    const sourceNode = project.workflow.nodes.find((node) => node.id === sourceNodeId)
    const targetNode = project.workflow.nodes.find((node) => node.id === targetNodeId)

    if (!sourceNode || !targetNode) {
      return { ok: false, reason: 'Both nodes must exist before connecting them.' }
    }

    const targetPort = NODE_PORT_DEFINITIONS[targetNode.type].inputs.find(
      (port) => port.name === targetHandle,
    )

    if (!targetPort) {
      return { ok: false, reason: 'The target port is not valid for this node.' }
    }

    const attempt = validateConnectionAttempt(project.workflow, {
      sourceNodeId,
      sourceHandle,
      targetNodeId,
      targetHandle,
    })

    if (!attempt.ok) {
      return attempt
    }

    applyMutation(set, get, 'edge.add', 'Workflow edge connected', (draft) => {
      draft.workflow.edges = replaceTargetConnectionIfNeeded(
        draft.workflow.edges,
        targetNodeId,
        targetPort,
        {
          id: nextId('edge'),
          source: sourceNodeId,
          sourceHandle,
          target: targetNodeId,
          targetHandle,
        },
      )

      const draftTargetNode = draft.workflow.nodes.find((node) => node.id === targetNodeId)
      if (draftTargetNode?.type === 'audio_mix') {
        const mixData = draftTargetNode.data as AudioMixData
        const existingInput = mixData.inputs.find((input) => input.sourceNodeId === sourceNodeId)
        if (!existingInput) {
          mixData.inputs.push({
            sourceNodeId,
            volume: 1,
            pan: 0,
          })
        }
      }
    })

    return { ok: true }
  },
  panWorkflowViewport: (deltaX, deltaY) =>
    set((state) => ({
      project: {
        ...state.project,
        workflow: {
          ...state.project.workflow,
          viewport: {
            ...state.project.workflow.viewport,
            x: Number(Math.max(0, state.project.workflow.viewport.x + deltaX).toFixed(0)),
            y: Number(Math.max(0, state.project.workflow.viewport.y + deltaY).toFixed(0)),
          },
        },
      },
    })),
  adjustWorkflowZoom: (delta) =>
    set((state) => ({
      project: {
        ...state.project,
        workflow: {
          ...state.project.workflow,
          viewport: {
            ...state.project.workflow.viewport,
            zoom: Number(Math.max(0.45, Math.min(1.8, state.project.workflow.viewport.zoom + delta)).toFixed(2)),
          },
        },
      },
      ui: {
        ...state.ui,
        statusMessage: `Workflow zoom ${(Math.max(0.45, Math.min(1.8, state.project.workflow.viewport.zoom + delta)) * 100).toFixed(0)}%`,
      },
    })),
  fitWorkflowViewport: () =>
    applyMutation(set, get, 'workflow.viewport.fit', 'Workflow viewport fit to nodes', (project) => {
      if (project.workflow.nodes.length === 0) {
        project.workflow.viewport = { x: 0, y: 0, zoom: 1 }
        return
      }

      const positions = project.workflow.nodes.map((node) => node.position)
      const minX = Math.min(...positions.map((position) => position.x))
      const maxX = Math.max(...positions.map((position) => position.x))
      const minY = Math.min(...positions.map((position) => position.y))
      const maxY = Math.max(...positions.map((position) => position.y))
      const spanX = maxX - minX + 320
      const spanY = maxY - minY + 180
      const zoom = Number(Math.max(0.45, Math.min(1.35, Math.min(980 / spanX, 640 / spanY))).toFixed(2))

      project.workflow.viewport = {
        x: Number(Math.max(0, minX - 80).toFixed(0)),
        y: Number(Math.max(0, minY - 80).toFixed(0)),
        zoom,
      }
    }),
  validateWorkflow: () => {
    const validationState = getValidationState(get().project)
    set((state) => ({
      ...validationState,
      ui: {
        ...state.ui,
        statusMessage:
          validationState.workflowValidationIssues.length === 0 &&
          validationState.projectValidationIssues.length === 0
            ? 'Validation passed'
            : 'Validation found actionable issues',
        },
      }))
  },
  showWorkflowConnectionFeedback: (feedback) =>
    set((state) => ({
      ui: {
        ...state.ui,
        workflowConnectionFeedback: {
          ...feedback,
          shakeKey: state.ui.workflowConnectionFeedback.shakeKey + 1,
        },
      },
    })),
  clearWorkflowConnectionFeedback: () =>
    set((state) => ({
      ui: {
        ...state.ui,
        workflowConnectionFeedback: {
          ...createIdleWorkflowConnectionFeedback(),
          shakeKey: state.ui.workflowConnectionFeedback.shakeKey,
        },
      },
    })),
  enqueueRender: async () => {
    const projectSnapshot = cloneProject(get().project)
    const renderBlockingIssues = collectRenderBlockingIssues(projectSnapshot)
    const activePreset =
      projectSnapshot.output.presets.find((preset) => preset.id === projectSnapshot.output.activePresetId) ??
      projectSnapshot.output.presets[0]

    if (renderBlockingIssues.length > 0) {
      const detail = renderBlockingIssues.slice(0, 4).join(' ')
      pushAppError(set, {
        id: `${nextId('error')}-render-validation`,
        category: 'render_failed',
        message: `Render validation failed: ${detail}`,
        userMessage: 'Render cannot start until validation issues are resolved.',
        recoverable: true,
        suggestedAction: detail,
        actionLabel: 'Rescan Assets',
        actionCommand: renderBlockingIssues.some((issue) => issue.includes('offline') || issue.includes('source file'))
          ? 'rescan_assets'
          : 'refresh_runtime_health',
        createdAt: new Date().toISOString(),
      })
      set((state) => ({
        workflowValidationIssues: getValidationState(projectSnapshot).workflowValidationIssues,
        projectValidationIssues: getValidationState(projectSnapshot).projectValidationIssues,
        ui: {
          ...state.ui,
          statusMessage: 'Render blocked by validation issues',
        },
      }))
      return
    }

    if (!activePreset) {
      pushAppError(set, {
        id: nextId('error'),
        category: 'internal',
        message: 'No active render preset was available when queueing export.',
        userMessage: 'Render preset is missing.',
        recoverable: true,
        suggestedAction: 'Select or recreate an export preset, then queue the render again.',
        actionLabel: 'Open Settings',
        actionCommand: 'open_settings',
        createdAt: new Date().toISOString(),
      })
      return
    }

    const jobId = nextId('render')
    const audioSummary = getWorkflowAudioSummary(projectSnapshot)
    let exportStart: ExportJobStartResult
    let renderStart: RenderJobStartResult

    try {
      exportStart = await startExportJob(projectSnapshot, activePreset, jobId)
      renderStart = await startRenderJob(projectSnapshot, activePreset, jobId)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Export handoff failed to start.'
      pushAppError(set, {
        id: nextId('error'),
        category: inferErrorCategory(message, 'render_failed'),
        message,
        userMessage: 'Export handoff could not be created.',
        recoverable: true,
        suggestedAction: 'Check export permissions or output directory settings, then try again.',
        actionLabel: 'Open Settings',
        actionCommand: 'open_settings',
        createdAt: new Date().toISOString(),
      })
      return
    }

    applyMutation(set, get, 'render.queue.add', 'Render queued', (project) => {
      const resolvedOutputPath = exportStart.outputPath
      project.output.queue.push({
        id: jobId,
        name: `${project.meta.name} export`,
        config: buildRenderConfig(projectSnapshot, activePreset, resolvedOutputPath),
        format: activePreset.format,
        progress: 0,
        status: 'queued',
        computeMode: get().ui.networkStatus === 'offline' ? 'local' : project.workflow.computeMode,
        createdAt: exportStart.startedAt,
        updatedAt: exportStart.startedAt,
        outputPath: resolvedOutputPath,
        manifestPath: exportStart.manifestPath,
        currentFrame: 0,
        totalFrames: renderStart.totalFrames,
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
        originalResolution: { ...buildRenderConfig(projectSnapshot, activePreset, resolvedOutputPath).resolution },
        audioMode: audioSummary.audioMode,
        audioSourceSummary: audioSummary.audioSourceSummary,
        outputRevealedAt: null,
      })
    })
  },
  refreshRenderStatuses: async () => {
    const queuedJobs = get().project.output.queue.filter(
      (job) => job.status === 'queued' || job.status === 'rendering' || job.status === 'paused',
    )

    if (queuedJobs.length === 0) {
      return
    }

    const statuses = await Promise.all(
      queuedJobs.map(async (job) => {
        try {
          const status = await pollRenderJobStatus(job.id)
          return { jobId: job.id, status }
        } catch (error) {
          return {
            jobId: job.id,
            status: {
              jobId: job.id,
              status: 'failed',
              progress: job.progress,
              currentFrame: job.currentFrame,
              totalFrames: job.totalFrames,
              updatedAt: new Date().toISOString(),
              completedAt: null,
              estimatedTimeRemaining: null,
              outputPath: job.outputPath,
              outputFileSize: null,
              error: error instanceof Error ? error.message : 'Unknown render polling error.',
            } satisfies RenderJobStatus,
          }
        }
      }),
    )
    const shouldRevealCompletedOutputs = get().project.output.exportDefaults.openFolderAfterExport
    const outputsToReveal = shouldRevealCompletedOutputs
      ? statuses
          .filter((entry) => entry.status.status === 'completed')
          .map((entry) => {
            const existingJob = get().project.output.queue.find((job) => job.id === entry.jobId)
            if (!existingJob || existingJob.outputRevealedAt) {
              return null
            }

            return {
              jobId: entry.jobId,
              outputPath: entry.status.outputPath || existingJob.outputPath,
            }
          })
          .filter((entry): entry is { jobId: string; outputPath: string } => Boolean(entry))
          .filter((entry) => canOpenPathInShell(entry.outputPath))
      : []

    applyMutation(set, get, 'render.queue.refresh', 'Render queue refreshed', (project) => {
      for (const entry of statuses) {
        const job = project.output.queue.find((item) => item.id === entry.jobId)

        if (!job) {
          continue
        }

        job.status = entry.status.status
        job.progress = entry.status.progress
        job.currentFrame = entry.status.currentFrame
        job.totalFrames = entry.status.totalFrames
        job.updatedAt = entry.status.updatedAt
        job.completedAt = entry.status.completedAt
        job.estimatedTimeRemaining = entry.status.estimatedTimeRemaining
        job.outputFileSize = entry.status.outputFileSize

        if (entry.status.outputPath) {
          job.outputPath = entry.status.outputPath
        }

        if (entry.status.status === 'failed') {
          job.errorCategory = inferErrorCategory(entry.status.error ?? '', 'render_failed')
          job.lastError = entry.status.error
          job.failedFrame = entry.status.currentFrame
          job.resumeFromFrame = Math.max(0, entry.status.currentFrame)
          job.quotaResetAt = entry.status.quotaResetAt ?? null
          job.quotaUsageSummary = entry.status.quotaUsageSummary ?? null
        } else if (entry.status.status === 'completed') {
          clearRenderRetryTimer(job.id)
          job.errorCategory = null
          job.lastError = null
          job.failedFrame = null
          job.resumeFromFrame = null
          job.quotaResetAt = null
          job.quotaUsageSummary = null
          job.autoRetryReason = null
          job.autoRetryScheduledFor = null
          if (outputsToReveal.some((item) => item.jobId === job.id)) {
            job.outputRevealedAt = new Date().toISOString()
          }
        }
      }
    })

    await Promise.all(outputsToReveal.map((entry) => openPathInShell(entry.outputPath)))

    for (const entry of statuses) {
      if (entry.status.status !== 'failed') {
        continue
      }

      const existingJob = get().project.output.queue.find((job) => job.id === entry.jobId)

      if (!existingJob) {
        continue
      }

      if (existingJob.errorCategory === 'cloud_network' && scheduleRenderAutoRetry(set, get, existingJob.id, 'cloud_network')) {
        continue
      }

      if (existingJob.errorCategory === 'gpu_oom' && scheduleRenderAutoRetry(set, get, existingJob.id, 'gpu_oom')) {
        continue
      }

      pushAppError(set, buildRenderFailureError({
        id: existingJob.id,
        currentFrame: entry.status.currentFrame,
        errorCategory: inferErrorCategory(entry.status.error ?? '', 'render_failed'),
        lastError: entry.status.error,
        quotaResetAt: entry.status.quotaResetAt ?? null,
        quotaUsageSummary: entry.status.quotaUsageSummary ?? null,
        computeMode: existingJob.computeMode,
      }))
    }
  },
  pauseActiveRender: async () => {
    const activeJob = get().project.output.queue.find((job) => job.status === 'rendering')

    if (!activeJob) {
      return
    }

    try {
      await pauseRenderJob(activeJob.id)
    } catch (error) {
      pushAppError(set, {
        id: nextId('error'),
        category: 'render_failed',
        message: error instanceof Error ? error.message : 'Render pause failed.',
        userMessage: 'Render could not be paused.',
        recoverable: true,
        suggestedAction: 'Refresh the queue and retry pause if the job is still running.',
        createdAt: new Date().toISOString(),
      })
      return
    }

    applyMutation(set, get, 'render.queue.pause', 'Active render paused', (project) => {
      const job = project.output.queue.find((item) => item.id === activeJob.id)

      if (!job) {
        return
      }

      job.status = 'paused'
      job.updatedAt = new Date().toISOString()
      job.autoRetryReason = null
      job.autoRetryScheduledFor = null
    })
  },
  resumePausedRender: async (jobId) => {
    const pausedJob =
      get().project.output.queue.find((job) => job.id === jobId && job.status === 'paused') ??
      [...get().project.output.queue].reverse().find((job) => job.status === 'paused')

    if (!pausedJob) {
      return
    }

    try {
      await resumeRenderJob(pausedJob.id)
    } catch (error) {
      pushAppError(set, {
        id: nextId('error'),
        category: 'render_failed',
        message: error instanceof Error ? error.message : 'Render resume failed.',
        userMessage: 'Render could not be resumed.',
        recoverable: true,
        suggestedAction: 'Refresh the queue and retry resume if the job is still paused.',
        createdAt: new Date().toISOString(),
      })
      return
    }

    applyMutation(set, get, 'render.queue.resume', 'Paused render resumed', (project) => {
      const job = project.output.queue.find((item) => item.id === pausedJob.id)

      if (!job) {
        return
      }

      job.status = 'queued'
      job.updatedAt = new Date().toISOString()
      job.autoRetryReason = null
      job.autoRetryScheduledFor = null
    })
  },
  cancelActiveRender: async () => {
    const activeJob = getActiveRenderJob(get().project)

    if (!activeJob) {
      return
    }

    try {
      await cancelRenderJob(activeJob.id)
    } catch (error) {
      pushAppError(set, {
        id: nextId('error'),
        category: 'render_failed',
        message: error instanceof Error ? error.message : 'Render cancel failed.',
        userMessage: 'Render could not be cancelled cleanly.',
        recoverable: true,
        suggestedAction: 'Refresh the queue and retry cancellation if the job is still active.',
        createdAt: new Date().toISOString(),
      })
      return
    }

    applyMutation(set, get, 'render.queue.cancel', 'Active render cancelled', (project) => {
      const job = project.output.queue.find((item) => item.id === activeJob.id)

      if (!job) {
        return
      }

      job.status = 'cancelled'
      job.updatedAt = new Date().toISOString()
      job.completedAt = new Date().toISOString()
      job.estimatedTimeRemaining = 0
      job.lastError = null
      job.failedFrame = null
      job.resumeFromFrame = null
      job.quotaResetAt = null
      job.quotaUsageSummary = null
      job.autoRetryReason = null
      job.autoRetryScheduledFor = null
      job.outputRevealedAt = null
    })
    clearRenderRetryTimer(activeJob.id)
  },
  failActiveRender: () => {
    const activeJob = getActiveRenderJob(get().project)

    if (!activeJob) {
      return
    }

    applyMutation(set, get, 'render.queue.fail', 'Render failure simulated', (project) => {
      const queuedJob = project.output.queue.find((job) => job.id === activeJob.id)

      if (!queuedJob) {
        return
      }

      queuedJob.status = 'failed'
      queuedJob.errorCategory = 'render_failed'
      queuedJob.updatedAt = new Date().toISOString()
      queuedJob.lastError = `Render job ${activeJob.id} failed while encoding output frames.`
      queuedJob.failedFrame = queuedJob.currentFrame
      queuedJob.resumeFromFrame = queuedJob.currentFrame
      queuedJob.quotaResetAt = null
      queuedJob.quotaUsageSummary = null
      queuedJob.autoRetryReason = null
      queuedJob.autoRetryScheduledFor = null
    })

    pushAppError(set, buildRenderFailureError({
      id: activeJob.id,
      currentFrame: activeJob.currentFrame,
      errorCategory: 'render_failed',
      lastError: `Render job ${activeJob.id} failed at ${activeJob.progress}% progress.`,
      quotaResetAt: null,
      quotaUsageSummary: null,
      computeMode: activeJob.computeMode,
    }))
  },
  simulateCloudNetworkFailure: () => {
    const activeJob = getActiveRenderJob(get().project)

    if (!activeJob) {
      return
    }

    applyMutation(set, get, 'render.queue.fail.network', 'Cloud network failure simulated', (project) => {
      const queuedJob = project.output.queue.find((job) => job.id === activeJob.id)

      if (!queuedJob) {
        return
      }

      queuedJob.status = 'failed'
      queuedJob.errorCategory = 'cloud_network'
      queuedJob.updatedAt = new Date().toISOString()
      queuedJob.lastError = 'Cloud network interrupted while polling the render worker.'
      queuedJob.failedFrame = queuedJob.currentFrame
      queuedJob.resumeFromFrame = queuedJob.currentFrame
      queuedJob.quotaResetAt = null
      queuedJob.quotaUsageSummary = null
    })

    void Promise.resolve().then(() => {
      if (!scheduleRenderAutoRetry(set, get, activeJob.id, 'cloud_network')) {
        pushAppError(set, buildRenderFailureError({
          id: activeJob.id,
          currentFrame: activeJob.currentFrame,
          errorCategory: 'cloud_network',
          lastError: 'Cloud network interrupted while polling the render worker.',
          quotaResetAt: null,
          quotaUsageSummary: null,
          computeMode: activeJob.computeMode,
        }))
      }
    })
  },
  simulateGpuOomFailure: () => {
    const activeJob = getActiveRenderJob(get().project)

    if (!activeJob) {
      return
    }

    applyMutation(set, get, 'render.queue.fail.gpu', 'GPU OOM failure simulated', (project) => {
      const queuedJob = project.output.queue.find((job) => job.id === activeJob.id)

      if (!queuedJob) {
        return
      }

      queuedJob.status = 'failed'
      queuedJob.errorCategory = 'gpu_oom'
      queuedJob.updatedAt = new Date().toISOString()
      queuedJob.lastError = 'GPU memory exceeded while encoding render frames.'
      queuedJob.failedFrame = queuedJob.currentFrame
      queuedJob.resumeFromFrame = queuedJob.currentFrame
      queuedJob.quotaResetAt = null
      queuedJob.quotaUsageSummary = null
    })

    void Promise.resolve().then(() => {
      if (!scheduleRenderAutoRetry(set, get, activeJob.id, 'gpu_oom')) {
        pushAppError(set, buildRenderFailureError({
          id: activeJob.id,
          currentFrame: activeJob.currentFrame,
          errorCategory: 'gpu_oom',
          lastError: 'GPU memory exceeded while encoding render frames.',
          quotaResetAt: null,
          quotaUsageSummary: null,
          computeMode: activeJob.computeMode,
        }))
      }
    })
  },
  simulateQuotaExceeded: () => {
    const activeJob = getActiveRenderJob(get().project)

    if (!activeJob) {
      return
    }

    const resetAt = new Date(Date.now() + 60 * 60 * 1000).toISOString()
    const usageSummary = 'Cloud plan used 100% of hourly render credits.'

    applyMutation(set, get, 'render.queue.fail.quota', 'Cloud quota failure simulated', (project) => {
      const queuedJob = project.output.queue.find((job) => job.id === activeJob.id)

      if (!queuedJob) {
        return
      }

      queuedJob.status = 'failed'
      queuedJob.errorCategory = 'cloud_quota'
      queuedJob.updatedAt = new Date().toISOString()
      queuedJob.lastError = '429 rate limit: cloud quota exceeded for the current billing window.'
      queuedJob.failedFrame = queuedJob.currentFrame
      queuedJob.resumeFromFrame = queuedJob.currentFrame
      queuedJob.quotaResetAt = resetAt
      queuedJob.quotaUsageSummary = usageSummary
      queuedJob.autoRetryReason = null
      queuedJob.autoRetryScheduledFor = null
    })

    pushAppError(set, buildRenderFailureError({
      id: activeJob.id,
      currentFrame: activeJob.currentFrame,
      errorCategory: 'cloud_quota',
      lastError: '429 rate limit: cloud quota exceeded for the current billing window.',
      quotaResetAt: resetAt,
      quotaUsageSummary: usageSummary,
      computeMode: activeJob.computeMode,
    }))
  },
  retryFailedRender: async (jobId, options) => {
    const targetJob =
      get().project.output.queue.find((job) => job.id === jobId) ??
      [...get().project.output.queue].reverse().find((job) => job.status === 'failed' || job.status === 'cancelled')

    if (!targetJob) {
      return
    }

    const automatic = options?.automatic === true

    try {
      await retryRenderJob(targetJob.id, true)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Render retry failed to re-arm.'
      pushAppError(set, {
        id: nextId('error'),
        category: inferErrorCategory(message, 'render_failed'),
        message,
        userMessage: 'Render retry could not be started.',
        recoverable: true,
        suggestedAction: 'Refresh the queue and queue a fresh export if retry keeps failing.',
        actionLabel: 'Retry Render',
        actionCommand: 'retry_render',
        contextId: targetJob.id,
        createdAt: new Date().toISOString(),
      })
      return
    }

    clearRenderRetryTimer(targetJob.id)

    applyMutation(set, get, 'render.queue.retry', 'Render retry queued', (project) => {
      const job = project.output.queue.find((item) => item.id === targetJob.id)

      if (!job) {
        return
      }

      job.status = 'queued'
      job.completedAt = null
      job.updatedAt = new Date().toISOString()
      job.estimatedTimeRemaining = null
      job.errorCategory = null
      job.lastError = null
      job.failedFrame = null
      job.resumeFromFrame = null
      job.quotaResetAt = null
      job.quotaUsageSummary = null
      job.lastRetryAt = new Date().toISOString()
      job.autoRetryReason = null
      job.autoRetryScheduledFor = null

      if (!automatic) {
        job.retryCount = 0
        job.maxAutoRetries = 0
        job.didFallbackResolution = false
        job.config.resolution = job.originalResolution ? { ...job.originalResolution } : job.config.resolution
      }
    })
  },
  moveRenderJob: (jobId, direction) =>
    applyMutation(set, get, 'render.queue.reorder', 'Render queue reordered', (project) => {
      const currentIndex = project.output.queue.findIndex((job) => job.id === jobId)

      if (currentIndex === -1) {
        return
      }

      const nextIndex =
        direction === 'up'
          ? Math.max(0, currentIndex - 1)
          : Math.min(project.output.queue.length - 1, currentIndex + 1)

      if (nextIndex === currentIndex) {
        return
      }

      const [job] = project.output.queue.splice(currentIndex, 1)
      project.output.queue.splice(nextIndex, 0, job)
    }),
  openRenderOutput: async (jobId) => {
    const job = get().project.output.queue.find((entry) => entry.id === jobId)

    if (!job || !canOpenPathInShell(job.outputPath)) {
      return
    }

    await openPathInShell(job.outputPath)
  },
  clearResolvedErrors: () =>
    set((state) => ({
      appErrors: state.appErrors.filter((error) => !error.recoverable),
      ui: {
        ...state.ui,
        statusMessage: 'Resolved alerts cleared',
      },
    })),
  dismissAppError: (errorId) =>
    set((state) => ({
      appErrors: state.appErrors.filter((error) => error.id !== errorId),
    })),
  performAppErrorAction: async (errorId) => {
    const error = get().appErrors.find((entry) => entry.id === errorId)

    if (!error?.actionCommand) {
      return
    }

    switch (error.actionCommand) {
      case 'switch_local_compute':
        if (get().project.workflow.computeMode === 'cloud') {
          get().toggleComputeMode()
        }
        break
      case 'switch_cloud_compute':
        if (get().project.workflow.computeMode === 'local' && get().ui.networkStatus === 'online') {
          get().toggleComputeMode()
        }
        break
      case 'open_settings':
        get().openSettings()
        break
      case 'clear_runtime_caches':
        get().clearRuntimeCaches()
        break
      case 'refresh_runtime_health':
        await get().refreshRuntimeHealth()
        break
      case 'retry_render':
        await get().retryFailedRender(error.contextId ?? undefined)
        break
      case 'rescan_assets':
        await get().rescanAssetStatuses()
        break
      case 'replace_media':
        if (error.contextId && get().project.assets.assets[error.contextId]) {
          await replaceAssetPathById(set, get, error.contextId)
        } else {
          await get().replaceSelectedAssetPath()
        }
        break
      case 'remove_selected_clip':
        get().deleteSelected()
        break
      case 'inspect_node':
        if (error.contextId) {
          const targetNode = get().project.workflow.nodes.find((node) => node.id === error.contextId)

          if (targetNode) {
            get().setActiveView('workflow')
            get().setWorkflowSelection([targetNode.id])
            await get().openDetachedPanel('inspector')
          }
        }
        break
      case 'save_project':
        await get().saveProject()
        break
      default:
        break
    }

    get().dismissAppError(errorId)
  },
  setActiveRenderPreset: (presetId) =>
    applyMutation(set, get, 'render.preset.select', 'Render preset updated', (project) => {
      if (!project.output.presets.some((preset) => preset.id === presetId)) {
        return
      }

      project.output.activePresetId = presetId
    }),
  refreshRuntimeHealth: async () => {
    const runtimeHealth = await readRuntimeHealth()
    const currentState = get()
    const nextMetrics = buildRuntimeCacheMetrics({
      ...currentState,
      runtimeHealth,
    })
    const trimmedCaches = trimRuntimeCachesForBudget({
      ...currentState,
      runtimeHealth,
    })
    set((state) => ({
      runtimeHealth,
      runtimeCacheMetrics: nextMetrics,
      ...trimmedCaches,
      ui: {
        ...state.ui,
        performanceMode:
          nextMetrics.hardLimitExceeded || nextMetrics.softLimitExceeded || (runtimeHealth.availableMemoryGb !== null && runtimeHealth.availableMemoryGb <= 2)
            ? 'memory_guarded'
            : runtimeHealth.vramUtilizationPct !== null && runtimeHealth.vramUtilizationPct >= 80
            ? 'gpu_guarded'
            : runtimeHealth.deviceMemoryGb !== null && runtimeHealth.deviceMemoryGb <= 8
            ? 'memory_guarded'
            : nextMetrics.estimatedUsageMb >= 256 || Object.keys(state.previewFrames).length > 18
            ? 'gpu_guarded'
            : 'balanced',
      },
    }))
    get().syncResilienceState()
  },
  syncResilienceState: () => {
    const state = get()
    const cacheUsageMb = estimateRuntimeCacheUsageMb(state)

    removeAppErrors(set, (error) =>
      ['cloud_network', 'comfy_connection', 'gpu_oom', 'disk_full', 'cloud_auth', 'memory_pressure'].includes(error.category),
    )

    if (state.ui.networkStatus === 'online' && state.recoveryAttempts.cloudNetwork !== 0) {
      clearRecoveryTimer('cloudNetwork')
      set((currentState) => ({
        recoveryAttempts: {
          ...currentState.recoveryAttempts,
          cloudNetwork: 0,
        },
      }))
    }

    if (
      (state.runtimeHealth.status !== 'degraded' || state.project.workflow.computeMode !== 'local') &&
      state.recoveryAttempts.comfyConnection !== 0
    ) {
      clearRecoveryTimer('comfyConnection')
      set((currentState) => ({
        recoveryAttempts: {
          ...currentState.recoveryAttempts,
          comfyConnection: 0,
        },
      }))
    }

    if (state.ui.networkStatus === 'offline') {
      scheduleRecoveryRetry(
        'cloudNetwork',
        set,
        get,
        'Cloud connection issue detected.',
      )
      pushAppError(set, {
        id: `${nextId('error')}-offline`,
        category: 'cloud_network',
        message: 'Network connectivity is offline.',
        userMessage:
          state.recoveryAttempts.cloudNetwork >= 3
            ? 'Cloud services are unavailable after repeated retry attempts.'
            : 'Cloud connection issue detected, retrying automatically.',
        recoverable: true,
        suggestedAction:
          state.recoveryAttempts.cloudNetwork >= 3
            ? 'Reconnect to the network or switch to local compute, then retry.'
            : `Retrying automatically with exponential backoff (${Math.min(state.recoveryAttempts.cloudNetwork + 1, 3)}/3).`,
        actionLabel: state.project.workflow.computeMode === 'cloud' ? 'Switch to Local' : 'Refresh Health',
        actionCommand: state.project.workflow.computeMode === 'cloud' ? 'switch_local_compute' : 'refresh_runtime_health',
        createdAt: new Date().toISOString(),
      })
    }

    if (state.runtimeHealth.status === 'degraded' && state.project.workflow.computeMode === 'local') {
      scheduleRecoveryRetry(
        'comfyConnection',
        set,
        get,
        'Connecting to ComfyUI...',
      )
      pushAppError(set, {
        id: `${nextId('error')}-comfy`,
        category: 'comfy_connection',
        message: 'Local backend health is degraded while local compute is selected.',
        userMessage:
          state.recoveryAttempts.comfyConnection >= 3
            ? 'ComfyUI is still unavailable after three retry attempts.'
            : 'Connecting to ComfyUI...',
        recoverable: true,
        suggestedAction:
          state.recoveryAttempts.comfyConnection >= 3
            ? 'Switch to cloud compute, retry local backend health, or check the ComfyUI setup.'
            : `Retrying automatically with backoff (${Math.min(state.recoveryAttempts.comfyConnection + 1, 3)}/3).`,
        actionLabel: state.ui.networkStatus === 'online' ? 'Switch to Cloud' : 'Refresh Health',
        actionCommand: state.ui.networkStatus === 'online' ? 'switch_cloud_compute' : 'refresh_runtime_health',
        createdAt: new Date().toISOString(),
      })
    }

    if (
      state.project.workflow.computeMode === 'cloud' &&
      state.preferences.cloudApiKey.trim().length === 0
    ) {
      pushAppError(set, {
        id: `${nextId('error')}-cloud-auth`,
        category: 'cloud_auth',
        message: 'Cloud compute selected without an API key.',
        userMessage: 'Cloud authentication is not configured.',
        recoverable: true,
        suggestedAction: 'Add a cloud API key in Settings or switch back to local compute.',
        actionLabel: 'Open Settings',
        actionCommand: 'open_settings',
        createdAt: new Date().toISOString(),
      })
    }

    if (
      state.runtimeHealth.diskFreeGb !== null &&
      state.runtimeHealth.diskFreeGb <= 2
    ) {
      const recoverableGb = Number((cacheUsageMb / 1024).toFixed(2))
      pushAppError(set, {
        id: `${nextId('error')}-disk`,
        category: 'disk_full',
        message: `Low disk space detected (${state.runtimeHealth.diskFreeGb.toFixed(1)} GB remaining).`,
        userMessage: `Insufficient disk headroom for reliable renders (${state.runtimeHealth.diskFreeGb.toFixed(1)} GB free).`,
        recoverable: true,
        suggestedAction: `Clear runtime cache (${recoverableGb.toFixed(2)} GB estimate) or choose a different output location before rendering.`,
        actionLabel: 'Clear Caches',
        actionCommand: 'clear_runtime_caches',
        createdAt: new Date().toISOString(),
      })
    }

    if (state.runtimeCacheMetrics.softLimitExceeded) {
      pushAppError(set, {
        id: `${nextId('error')}-memory-soft`,
        category: 'memory_pressure',
        message: `Estimated app footprint is ${state.runtimeCacheMetrics.estimatedAppFootprintGb.toFixed(2)} GB.`,
        userMessage:
          state.runtimeCacheMetrics.hardLimitExceeded
            ? 'Memory pressure is critical. New cache allocations are paused.'
            : 'Memory pressure is elevated. Old cache entries are being evicted.',
        recoverable: true,
        suggestedAction:
          state.runtimeCacheMetrics.hardLimitExceeded
            ? 'Clear runtime caches or close detached panels before requesting more previews.'
            : 'FluxNode is evicting old previews and waveforms because memory pressure crossed the soft limit.',
        actionLabel: 'Clear Caches',
        actionCommand: 'clear_runtime_caches',
        createdAt: new Date().toISOString(),
      })
    }

    if (
      state.ui.performanceMode === 'gpu_guarded' &&
      (
        (state.runtimeHealth.vramUtilizationPct !== null && state.runtimeHealth.vramUtilizationPct >= 80) ||
        cacheUsageMb >= 256 ||
        (state.runtimeHealth.availableMemoryGb !== null && state.runtimeHealth.availableMemoryGb <= 2) ||
        (state.runtimeHealth.deviceMemoryGb !== null && state.runtimeHealth.deviceMemoryGb <= 8)
      )
    ) {
      const vramSummary =
        state.runtimeHealth.vramUtilizationPct !== null
          ? `VRAM usage is ${state.runtimeHealth.vramUtilizationPct.toFixed(1)}%`
          : `Preview cache pressure is ${cacheUsageMb.toFixed(1)} MB`
      pushAppError(set, {
        id: `${nextId('error')}-gpu`,
        category: 'gpu_oom',
        message: `${vramSummary} and crossed the guarded threshold.`,
        userMessage:
          state.runtimeHealth.vramUtilizationPct !== null && state.runtimeHealth.vramUtilizationPct >= 95
            ? 'GPU memory is critically high. GPU-heavy operations are paused.'
            : state.runtimeHealth.vramUtilizationPct !== null && state.runtimeHealth.vramUtilizationPct >= 90
            ? 'GPU memory is very high. Preview resolution is being reduced automatically.'
            : 'GPU or preview memory pressure is elevated.',
        recoverable: true,
        suggestedAction:
          state.runtimeHealth.vramUtilizationPct !== null && state.runtimeHealth.vramUtilizationPct >= 95
            ? 'Clear runtime caches or wait for GPU pressure to drop before starting more GPU-heavy work.'
            : state.runtimeHealth.vramUtilizationPct !== null && state.runtimeHealth.vramUtilizationPct >= 90
            ? 'Preview resolution has been reduced automatically. Clear caches if pressure stays high.'
            : 'Clear runtime caches, reduce preview activity, or continue with reduced throughput.',
        actionLabel: 'Clear Caches',
        actionCommand: 'clear_runtime_caches',
        createdAt: new Date().toISOString(),
      })
    }
  },
  clearRuntimeCaches: () =>
    set((state) => ({
      waveformCache: {},
      previewFrames: {},
      nodePreviewFrames: {},
      assetThumbnails: {},
      runtimeCacheMetrics: buildRuntimeCacheMetrics({
        ...state,
        waveformCache: {},
        previewFrames: {},
        nodePreviewFrames: {},
        assetThumbnails: {},
      }),
      ui: {
        ...state.ui,
        performanceMode:
          state.runtimeHealth.vramUtilizationPct !== null && state.runtimeHealth.vramUtilizationPct >= 80
            ? 'gpu_guarded'
            : state.runtimeHealth.deviceMemoryGb !== null && state.runtimeHealth.deviceMemoryGb <= 8
          ? 'memory_guarded'
          : 'balanced',
        statusMessage: 'Runtime caches cleared',
      },
    })),
  checkForAppUpdates: async () => {
    const state = get()

    if (state.ui.networkStatus === 'offline') {
      set((currentState) => ({
        appUpdateState: {
          ...currentState.appUpdateState,
          status: 'error',
          downloadStatus: currentState.appUpdateState.downloadStatus,
          errorMessage: 'Update checks are unavailable while FluxNode is offline.',
        },
        ui: {
          ...currentState.ui,
          statusMessage: 'Update check skipped while offline',
        },
      }))
      return
    }

    if (!state.preferences.updateManifestUrl) {
      set((currentState) => ({
        appUpdateState: {
          ...currentState.appUpdateState,
          status: 'error',
          downloadStatus: currentState.appUpdateState.downloadStatus,
          errorMessage: 'Set an update manifest URL in Settings before checking for updates.',
        },
        ui: {
          ...currentState.ui,
          statusMessage: 'Update manifest URL is not configured',
        },
      }))
      return
    }

    set((currentState) => ({
      appUpdateState: {
        ...currentState.appUpdateState,
        status: 'checking',
        downloadStatus: currentState.appUpdateState.downloadStatus,
        errorMessage: null,
      },
      ui: {
        ...currentState.ui,
        statusMessage: 'Checking for updates...',
      },
    }))

    try {
      const result = await checkForAppUpdate(state.preferences.updateManifestUrl)
      set((currentState) => ({
        appUpdateState: {
          status: result.updateAvailable ? 'update-available' : 'up-to-date',
          downloadStatus: currentState.appUpdateState.downloadStatus,
          versionInfo: {
            currentVersion: result.currentVersion,
            backend: currentState.runtimeHealth.backend,
            loadedAt: currentState.appUpdateState.versionInfo.loadedAt ?? result.checkedAt,
          },
          latestVersion: result.latestVersion,
          downloadUrl: result.downloadUrl,
          sha256: result.sha256,
          downloadedFilePath: currentState.appUpdateState.downloadedFilePath,
          notes: result.notes,
          publishedAt: result.publishedAt,
          lastCheckedAt: result.checkedAt,
          errorMessage: null,
        },
        ui: {
          ...currentState.ui,
          statusMessage: result.updateAvailable
            ? `Update ${result.latestVersion} is available`
            : 'FluxNode is up to date',
        },
      }))
    } catch (error) {
      set((currentState) => ({
        appUpdateState: {
          ...currentState.appUpdateState,
          status: 'error',
          downloadStatus: currentState.appUpdateState.downloadStatus,
          lastCheckedAt: new Date().toISOString(),
          errorMessage: error instanceof Error ? error.message : 'Update check failed.',
        },
        ui: {
          ...currentState.ui,
          statusMessage: 'Update check failed',
        },
      }))
    }
  },
  downloadAppUpdate: async () => {
    const state = get()
    if (!state.appUpdateState.downloadUrl) {
      return
    }

    set((currentState) => ({
      appUpdateState: {
        ...currentState.appUpdateState,
        downloadStatus: 'downloading',
        errorMessage: null,
      },
      ui: {
        ...currentState.ui,
        statusMessage: 'Downloading update package...',
      },
    }))

    try {
      const downloadedFilePath = await downloadAppUpdatePackage(
        state.appUpdateState.downloadUrl,
        state.appUpdateState.sha256,
      )
      set((currentState) => ({
        appUpdateState: {
          ...currentState.appUpdateState,
          downloadStatus: 'downloaded',
          downloadedFilePath,
        },
        ui: {
          ...currentState.ui,
          statusMessage: 'Update package downloaded',
        },
      }))
    } catch (error) {
      set((currentState) => ({
        appUpdateState: {
          ...currentState.appUpdateState,
          downloadStatus: 'error',
          errorMessage: error instanceof Error ? error.message : 'Update download failed.',
        },
        ui: {
          ...currentState.ui,
          statusMessage: 'Update download failed',
        },
      }))
    }
  },
  installDownloadedAppUpdate: async () => {
    const downloadedFilePath = get().appUpdateState.downloadedFilePath

    if (!downloadedFilePath) {
      return
    }

    await openPathInShell(downloadedFilePath)
    set((state) => ({
      ui: {
        ...state.ui,
        statusMessage: 'Launching downloaded update installer',
      },
    }))
  },
  openUpdateDownload: async () => {
    const { downloadUrl, downloadedFilePath } = get().appUpdateState
    const targetPath = downloadedFilePath ?? downloadUrl

    if (!targetPath) {
      return
    }

    await openPathInShell(targetPath)
    set((state) => ({
      ui: {
        ...state.ui,
        statusMessage: downloadedFilePath ? 'Opening downloaded update package' : 'Opening update download',
      },
    }))
  },
  undo: () => {
    const result = popUndo(get().history)

    if (!result) {
      return
    }

    // Patch-based history: reconstruct the prior project by applying this command's
    // inverse patches to the CURRENT project (which must be exactly this command's
    // "after" state, since undo/redo is strictly LIFO and redoStack is cleared on any
    // new mutation) rather than storing a second full snapshot.
    const restoredProject = applyPatches(get().project, result.command.inversePatches)

    set((state) => ({
      project: restoredProject,
      history: result.history,
      ...getValidationState(restoredProject),
      ui: {
        ...state.ui,
        statusMessage: `Undid ${result.command.label.toLowerCase()}`,
      },
    }))
  },
  redo: () => {
    const result = popRedo(get().history)

    if (!result) {
      return
    }

    const restoredProject = applyPatches(get().project, result.command.patches)

    set((state) => ({
      project: restoredProject,
      history: result.history,
      ...getValidationState(restoredProject),
      ui: {
        ...state.ui,
        statusMessage: `Redid ${result.command.label.toLowerCase()}`,
      },
    }))
  },
  saveProject: async () => {
    const project = cloneProject(get().project)
    syncUpdatedAt(project)
    await projectRepository.save(project)
    const recentProjects = await projectRepository.loadRecentProjects()
    const currentProjectPath = await projectRepository.getCurrentProjectPath()
    set((state) => ({
      project,
      recentProjects,
      ui: {
        ...state.ui,
        currentProjectPath,
        lastSavedAt: new Date().toISOString(),
        statusMessage: 'Project saved to local persistence',
      },
    }))
  },
  saveProjectAs: async (path) => {
    const project = cloneProject(get().project)
    syncUpdatedAt(project)
    await projectRepository.saveAs(path, project)
    const recentProjects = await projectRepository.loadRecentProjects()
    const currentProjectPath = await projectRepository.getCurrentProjectPath()
    set((state) => ({
      project,
      recentProjects,
      ui: {
        ...state.ui,
        currentProjectPath,
        lastSavedAt: new Date().toISOString(),
        statusMessage: 'Project saved to selected project directory',
      },
    }))
  },
  loadPersistedProject: async () => {
    const loadedProject = (await projectRepository.load()) ?? createDefaultProject()
    const recentProjects = await projectRepository.loadRecentProjects()
    const currentProjectPath = await projectRepository.getCurrentProjectPath()
    const validationState = getValidationState(loadedProject)
    clearModuleGlobalCaches()
    set((state) => ({
      project: loadedProject,
      history: createHistoryState(),
      previewFrames: {},
      waveformCache: {},
      assetThumbnails: {},
      nodePreviewFrames: {},
      runtimeCacheMetrics: buildRuntimeCacheMetrics({
        ...state,
        project: loadedProject,
        previewFrames: {},
        nodePreviewFrames: {},
        waveformCache: {},
        assetThumbnails: {},
      }),
      recentProjects,
      ...validationState,
      ui: {
        ...state.ui,
        currentProjectPath,
        selectedClipId: null,
        selectedNodeId: null,
        selectedNodeIds: [],
        statusMessage: makeStatusMessage(loadedProject),
      },
    }))

    await generateThumbnailsForAssets(set, get, Object.keys(loadedProject.assets.assets))
  },
}))
