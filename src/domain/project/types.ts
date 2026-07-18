import type { Patch } from 'immer'
import type { DensityMode } from './density'

export interface FluxNodeProject {
  version: string
  meta: ProjectMeta
  settings: ProjectSettings
  assets: AssetRegistry
  timeline: TimelineState
  workflow: WorkflowState
  output: OutputState
  audio: AudioState
}

export interface ProjectMeta {
  id: string
  name: string
  createdAt: string
  updatedAt: string
  thumbnailPath: string | null
  panelLayouts: Record<DetachedPanelKind, DetachedPanelLayout>
  sharing: WorkspaceSharingState
  section11TargetProfileOverride: Section11TargetProfile['label'] | null
  section11ProofHistory: Section11ProofRecord[]
  section11CoverageMapHistory: Section11CoverageMapRecord[]
  section11CapturePacketHistory: Section11CapturePacketRecord[]
  /**
   * MERIDIAN strata shell: sky (workflow) fraction of the horizon splitter,
   * in [HORIZON_RATIO_MIN, HORIZON_RATIO_MAX]. Persisted per-project (spec
   * J.3). See `domain/project/horizon.ts` for the shared ratio math.
   */
  horizonRatio: number
  /**
   * MERIDIAN stage row (item 3): the job ledger (left) and context inspector
   * (right) organs individually collapse to a 40px rail (spec F.3). Persisted
   * per-project like `panelLayouts`/`horizonRatio`.
   */
  stageRowCollapse: StageRowCollapseState
  /**
   * Studio shell workspace geometry (timeline strip height, media-bin rail),
   * persisted per-project like `horizonRatio`. See `domain/project/studio-layout.ts`.
   */
  studioLayout: StudioLayoutState
}

export interface StudioLayoutState {
  timelineHeightPx: number
  mediaCollapsed: boolean
  mediaWidthPx: number
  inspectorWidthPx: number
}

export type StageRowSide = 'ledger' | 'inspector'

export interface StageRowCollapseState {
  ledger: boolean
  inspector: boolean
}

export type DetachedPanelKind = 'preview' | 'timeline' | 'inspector'

export interface DetachedPanelLayout {
  detached: boolean
  width: number
  height: number
  x: number | null
  y: number | null
}

export interface ProjectSettings {
  resolution: { width: number; height: number }
  frameRate: number
  sampleRate: number
  bitDepth: number
  colorSpace: 'sRGB' | 'Rec709' | 'Rec2020'
  proxyEnabled: boolean
  proxyResolution: { width: number; height: number }
}

export interface AssetRegistry {
  assets: Record<string, Asset>
}

export interface Asset {
  id: string
  name: string
  type: 'video' | 'audio' | 'image' | 'shader' | 'lut'
  sourcePath: string
  relativePath: string | null
  proxyPath: string | null
  preferProxyForEditing: boolean
  duration: number | null
  metadata: MediaMetadata
  status: 'linked' | 'missing' | 'corrupt' | 'importing' | 'proxy_generating'
}

export interface MediaMetadata {
  codec: string | null
  width: number | null
  height: number | null
  frameRate: number | null
  channels: number | null
  sampleRate: number | null
  fileSize: number
}

export interface TimelineState {
  tracks: Track[]
  playhead: number
  inPoint: number | null
  outPoint: number | null
  zoom: number
  scrollX: number
}

export interface Track {
  id: string
  name: string
  type: 'video' | 'audio' | 'subtitle'
  locked: boolean
  visible: boolean
  muted: boolean
  solo: boolean
  volume: number
  pan: number
  height: number
  clips: Clip[]
}

export interface Clip {
  id: string
  assetId: string
  trackId: string
  startTime: number
  duration: number
  inPoint: number
  outPoint: number
  speed: number
  volume: number
  opacity: number
  transform: ClipTransform
  keyframes: Keyframe[]
  linkedClipId: string | null
  workflowNodeId: string | null
}

export interface ClipTransform {
  x: number
  y: number
  scaleX: number
  scaleY: number
  rotation: number
  anchorX: number
  anchorY: number
}

export interface Keyframe {
  id: string
  time: number
  property: string
  value: number
  easing: 'linear' | 'ease-in' | 'ease-out' | 'ease-in-out' | 'bezier'
  bezierHandles?: { x1: number; y1: number; x2: number; y2: number }
}

export interface WorkflowState {
  nodes: WorkflowNode[]
  groups: WorkflowGroup[]
  edges: WorkflowEdge[]
  viewport: { x: number; y: number; zoom: number }
  computeMode: 'local' | 'cloud'
}

export interface WorkflowGroup {
  id: string
  label: string
  nodeIds: string[]
  color: string
}

export interface WorkflowNode {
  id: string
  type: NodeType
  position: { x: number; y: number }
  data: NodeData
  collapsed: boolean
  bypassed: boolean
  executionError: {
    category: 'comfy_execution'
    message: string
    detail: string | null
    failedAt: string
  } | null
  label: string | null
}

export type NodeType =
  | 'media_source'
  | 'camera'
  | 'shader'
  | 'compositor'
  | 'output'
  | 'audio_mix'
  | 'transform'
  | 'color_correct'
  | 'ai_generate'
  | 'ai_upscale'

export interface WorkflowEdge {
  id: string
  source: string
  sourceHandle: string
  target: string
  targetHandle: string
}

export interface WorkflowClipboard {
  nodes: WorkflowNode[]
  groups: WorkflowGroup[]
  edges: WorkflowEdge[]
}

export interface MediaSourceData {
  assetId: string | null
  timelineClipId: string | null
}

export interface CameraData {
  mode: 'orthographic' | 'perspective'
  fov: number
  position: { x: number; y: number; z: number }
  rotation: { x: number; y: number; z: number }
  zoom: number
}

export interface ShaderData {
  shaderSource: string
  uniforms: Record<string, UniformValue>
  presetId: string | null
}

export interface UniformValue {
  type: 'float' | 'vec2' | 'vec3' | 'vec4' | 'sampler2D' | 'int'
  value: number | number[] | string
}

export interface CompositorData {
  blendMode: 'normal' | 'add' | 'multiply' | 'screen' | 'overlay'
  layers: { nodeId: string; opacity: number; order: number }[]
}

export interface OutputData {
  format: OutputFormat
  resolution: { width: number; height: number } | 'project'
  frameRate: number | 'project'
}

export interface AiGenerateData {
  prompt: string
  negativePrompt: string
  model: string
  steps: number
  cfg: number
  seed: number | 'random'
  computeSource: 'local' | 'cloud' | 'project'
}

export interface AiUpscaleData {
  model: string
  scaleFactor: 2 | 4
  computeSource: 'local' | 'cloud' | 'project'
}

export interface AudioMixInputSetting {
  sourceNodeId: string
  volume: number
  pan: number
}

export interface AudioMixData {
  bus: 'master'
  gain: number
  inputs: AudioMixInputSetting[]
}

export type NodeData =
  | MediaSourceData
  | CameraData
  | ShaderData
  | CompositorData
  | OutputData
  | AudioMixData
  | AiGenerateData
  | AiUpscaleData
  | Record<string, unknown>

export type PortDataType = 'video' | 'audio' | 'image' | 'mask' | 'number' | 'color' | 'any'

export interface PortDefinition {
  name: string
  dataType: PortDataType
  required: boolean
  multiple: boolean
}

export interface UserInterfaceState {
  activeView: 'timeline' | 'workflow'
  showWelcome: boolean
  showSettings: boolean
  showWorkspaceSharing: boolean
  showNodePicker: boolean
  statusMessage: string
  currentProjectPath: string | null
  lastSavedAt: string | null
  lastAutoSavedAt: string | null
  selectedClipId: string | null
  selectedClipIds: string[]
  selectedTrackId: string | null
  selectedNodeId: string | null
  selectedNodeIds: string[]
  networkStatus: 'online' | 'offline'
  performanceMode: 'balanced' | 'memory_guarded' | 'gpu_guarded'
  playbackState: 'playing' | 'paused' | 'reverse'
  playbackRate: number
  viewSwitchMetric: ViewSwitchMetric
  workflowBenchmarkMetric: WorkflowBenchmarkMetric
  scrubPreviewState: ScrubPreviewState
  workflowConnectionFeedback: WorkflowConnectionFeedback
  timelineClipboard: Clip[]
  workflowClipboard: WorkflowClipboard
}

export interface ViewSwitchMetric {
  fromView: 'timeline' | 'workflow' | null
  toView: 'timeline' | 'workflow' | null
  durationMs: number | null
  measuredAt: string | null
}

export interface WorkflowBenchmarkMetric {
  sceneLabel: string | null
  nodeCount: number
  edgeCount: number
  canvasRendererExpected: boolean
  generationMs: number | null
  fitViewDurationMs: number | null
  fitViewMeasuredAt: string | null
  panTraversalDurationMs: number | null
  zoomSweepDurationMs: number | null
  interactionMeasuredAt: string | null
  measuredAt: string | null
}

export interface Section11ProofSuiteResult {
  startedAt: string
  completedAt: string
  viewSwitchSamplesMs: number[]
  fitViewSamplesMs: number[]
  panTraversalDurationMs: number | null
  zoomSweepDurationMs: number | null
  averageViewSwitchMs: number | null
  averageFitViewMs: number | null
  benchmarkNodeCount: number
  benchmarkEdgeCount: number
}

export interface Section11RenderProofResult {
  startedAt: string
  completedAt: string
  presetId: string
  presetName: string
  resolution: { width: number; height: number }
  frameRate: number
  status: 'completed' | 'failed' | 'timed_out'
  outputPath: string | null
  totalFrames: number | null
  outputFileSize: number | null
  didFallbackResolution: boolean
  computeMode: 'local' | 'cloud' | null
  audioMode: 'muted' | 'muxed' | null
  failureReason: string | null
}

export interface Section11ProofCheck {
  label: string
  status: 'ready' | 'needs-proof'
  detail: string
}

export interface Section11CoverageTarget {
  id: 'windows-10-plus' | 'windows-11' | 'macos-12-plus' | 'ubuntu-22-04-plus'
  label: string
  status: 'ready' | 'needs-proof'
  detail: string
}

export interface Section11HardwareCoverageTarget {
  id: 'entry' | 'balanced' | 'high'
  label: string
  status: 'ready' | 'needs-proof'
  detail: string
  latestProof: Section11ProofRecord | null
}

export interface Section11CoverageCell {
  osTargetId: Section11CoverageTarget['id']
  hardwareTargetId: Section11HardwareCoverageTarget['id']
  label: string
  status: 'ready' | 'needs-proof'
  detail: string
  latestProof: Section11ProofRecord | null
}

export interface Section11CoverageMapRecord {
  bundleVersion: string
  bundleKind: 'section11-coverage-map' | 'section11-proof-bundle'
  generatedAt: string
  manifestTitle: string
  manifestContents: string[]
  runbook: string[]
  osCoverageCount: number
  hardwareCoverageCount: number
  combinedCoverageCount: number
  recommendedCount: number
}

export interface Section11CapturePacketRecord {
  bundleVersion: string
  bundleKind: 'section11-capture-packet'
  generatedAt: string
  manifestTitle: string
  runbook: string[]
  targetProfileOverride: Section11TargetProfile['label'] | null
  proofHistoryCount: number
  nextCaptureTargetsCount: number
  coverageMapHistoryCount: number
  proofSuiteRestored: boolean
  renderProofRestored: boolean
}

export interface Section11TargetProfile {
  label: string
  os: string | null
  osVersion: string | null
  arch: string | null
  cpuCores: number | null
  deviceMemoryGb: number | null
  vramTotalGb: number | null
  hardwareClass: 'unknown' | 'entry' | 'balanced' | 'high'
}

export interface Section11ProofRecord {
  id: string
  capturedAt: string
  source: 'system-panels'
  label: string
  targetProfile: Section11TargetProfile
  runtimeProfile: Section11TargetProfile
  appVersion: {
    currentVersion: string
    runtimeBackend: 'browser' | 'tauri'
    loadedAt: string | null
  }
  runtimeHealth: RuntimeHealth
  screen: {
    width: number | null
    height: number | null
    pixelRatio: number | null
  }
  activePreset: Pick<RenderPreset, 'id' | 'name' | 'format' | 'resolution' | 'frameRate' | 'videoCodec' | 'audioCodec' | 'quality'> | null
  viewSwitchMetric: ViewSwitchMetric
  workflowBenchmarkMetric: WorkflowBenchmarkMetric
  proofSuiteResult: Section11ProofSuiteResult | null
  renderProofResult: Section11RenderProofResult | null
  checks: Section11ProofCheck[]
  coverageSummary: {
    readyChecks: number
    pendingChecks: number
    totalChecks: number
  }
  osCoverage: Section11CoverageTarget[]
}

export interface ScrubPreviewState {
  active: boolean
  mode: 'slow_drag' | 'fast_drag' | 'shuttle' | null
  speed: number
  sourceTime: number | null
  startedAt: string | null
}

export interface WorkflowConnectionFeedback {
  targetNodeId: string | null
  targetHandle: string | null
  reason: string | null
  tone: 'warning' | 'error' | null
  visibleUntil: string | null
  shakeKey: number
}

export type OutputContainer = 'mp4' | 'mov' | 'webm' | 'mkv' | 'gif' | 'png_sequence'
export type OutputVideoCodec = 'h264' | 'h265' | 'prores' | 'vp9' | 'av1' | null
export type OutputAudioCodec = 'aac' | 'pcm' | 'opus' | 'mp3' | null
export type OutputQuality = 'draft' | 'medium' | 'high' | 'lossless'
export type OutputFormat = OutputContainer

export interface RecentProjectsStore {
  projects: RecentProject[]
}

export interface RecentProject {
  path: string
  name: string
  lastOpened: string
  thumbnailPath: string | null
}

export type WorkspaceAccessLevel = 'private' | 'team' | 'public_view'
export type WorkspaceRole = 'owner' | 'editor' | 'viewer'
export type WorkspacePresence = 'online' | 'idle' | 'offline'

export interface WorkspaceCollaborator {
  id: string
  name: string
  email: string
  role: WorkspaceRole
  presence: WorkspacePresence
  joinedAt: string
  lastActiveAt: string | null
}

export interface WorkspaceInvite {
  id: string
  email: string
  role: Exclude<WorkspaceRole, 'owner'>
  status: 'pending' | 'accepted' | 'revoked'
  invitedAt: string
  acceptedAt: string | null
}

export interface WorkspaceSharingState {
  enabled: boolean
  workspaceId: string | null
  shareLink: string | null
  accessLevel: WorkspaceAccessLevel
  ownerName: string
  ownerEmail: string | null
  collaborators: WorkspaceCollaborator[]
  invites: WorkspaceInvite[]
  lastSyncedAt: string | null
}

export interface WorkspaceSyncConflict {
  id: string
  sourceWindowId: string
  transactionId: string
  field: 'project'
  detectedAt: string
  localUpdatedAt: string | null
  remoteUpdatedAt: string | null
  autoResolution: 'local' | 'remote'
  resolvedWith: 'local' | 'remote' | null
  localProjectSnapshot: FluxNodeProject
  remoteProjectSnapshot: FluxNodeProject
}

export interface AutosaveSnapshot {
  id: string
  timestamp: string
  project: FluxNodeProject
}

export interface WalEntry {
  id: string
  timestamp: string
  type: string
  label: string
  /** Full project snapshot. Only present on periodic "base" entries — most entries carry `patches` instead. */
  projectSnapshot?: FluxNodeProject
  /** Immer forward patches that replay the change represented by this entry against the prior WAL state. */
  patches?: Patch[]
}

export interface OutputState {
  presets: RenderPreset[]
  activePresetId: string
  queue: RenderJob[]
  exportDefaults: ExportDefaults
}

export interface RenderPreset {
  id: string
  name: string
  format: OutputFormat
  videoCodec: OutputVideoCodec
  audioCodec: OutputAudioCodec
  quality: OutputQuality
  resolution: { width: number; height: number } | 'project'
  frameRate: number | 'project'
  videoBitrateMbps: number
  audioBitrateKbps: number
}

export interface ExportDefaults {
  outputDirectory: string
  useProxyRenders: boolean
  openFolderAfterExport: boolean
}

export interface RenderMetadata {
  title: string | null
  comment: string | null
}

export type RenderRange = 'full' | 'in_out' | { start: number; end: number }

export interface RenderConfig {
  outputPath: string
  format: {
    container: OutputContainer
    videoCodec: OutputVideoCodec
    audioCodec: OutputAudioCodec
    quality: OutputQuality
  }
  resolution: { width: number; height: number }
  frameRate: number
  range: RenderRange
  useProxy: boolean
  denoising: boolean
  metadata: RenderMetadata
}

export interface RenderJob {
  id: string
  name: string
  config: RenderConfig
  format: OutputFormat
  progress: number
  status: 'queued' | 'rendering' | 'paused' | 'completed' | 'failed' | 'cancelled'
  computeMode: 'local' | 'cloud'
  createdAt: string
  updatedAt: string
  outputPath: string
  manifestPath: string | null
  currentFrame: number
  totalFrames: number
  completedAt: string | null
  estimatedTimeRemaining: number | null
  outputFileSize: number | null
  errorCategory: ErrorCategory | null
  lastError: string | null
  failedFrame: number | null
  resumeFromFrame: number | null
  quotaResetAt: string | null
  quotaUsageSummary: string | null
  retryCount: number
  maxAutoRetries: number
  lastRetryAt: string | null
  autoRetryReason: 'cloud_network' | 'gpu_oom' | null
  autoRetryScheduledFor: string | null
  didFallbackResolution: boolean
  originalResolution: { width: number; height: number } | null
  audioMode: 'muted' | 'muxed'
  audioSourceSummary: string
  outputRevealedAt: string | null
}

export type ErrorCategory =
  | 'comfy_connection'
  | 'comfy_execution'
  | 'cloud_network'
  | 'cloud_auth'
  | 'cloud_quota'
  | 'asset_missing'
  | 'asset_corrupt'
  | 'render_failed'
  | 'disk_full'
  | 'memory_pressure'
  | 'gpu_oom'
  | 'internal'

export interface AppError {
  id: string
  category: ErrorCategory
  message: string
  userMessage: string
  recoverable: boolean
  suggestedAction: string
  actionLabel?: string
  actionCommand?:
    | 'switch_local_compute'
    | 'switch_cloud_compute'
    | 'open_settings'
    | 'clear_runtime_caches'
    | 'refresh_runtime_health'
    | 'retry_render'
    | 'rescan_assets'
    | 'replace_media'
    | 'remove_selected_clip'
    | 'inspect_node'
    | 'save_project'
  contextId?: string | null
  detail?: string | null
  resetAt?: string | null
  createdAt: string
}

export interface AudioState {
  masterVolume: number
  scrubEnabled: boolean
  waveformDensity: 'compact' | 'balanced' | 'detailed'
}

export interface RuntimeHealth {
  backend: 'browser' | 'tauri'
  status: 'unknown' | 'ok' | 'degraded'
  appDataDir: string | null
  os: string | null
  osVersion: string | null
  arch: string | null
  cpuCores: number | null
  deviceMemoryGb: number | null
  totalMemoryGb: number | null
  availableMemoryGb: number | null
  diskFreeGb: number | null
  diskCapacityGb: number | null
  vramTotalGb: number | null
  vramUsedGb: number | null
  vramUtilizationPct: number | null
  lastCheckedAt: string | null
}

export interface RuntimeCacheMetrics {
  estimatedUsageMb: number
  estimatedAppFootprintGb: number
  memoryPressurePct: number | null
  softLimitExceeded: boolean
  hardLimitExceeded: boolean
}

export interface AppVersionInfo {
  currentVersion: string
  backend: 'browser' | 'tauri'
  loadedAt: string | null
}

export interface AppUpdateManifest {
  version: string
  downloadUrl: string | null
  sha256: string | null
  notes: string | null
  publishedAt: string | null
  channel: string | null
}

export interface AppUpdateState {
  status: 'idle' | 'checking' | 'up-to-date' | 'update-available' | 'error'
  downloadStatus: 'idle' | 'downloading' | 'downloaded' | 'error'
  versionInfo: AppVersionInfo
  latestVersion: string | null
  downloadUrl: string | null
  sha256: string | null
  downloadedFilePath: string | null
  notes: string | null
  publishedAt: string | null
  lastCheckedAt: string | null
  errorMessage: string | null
}

/**
 * Which workspace shell composes the main window. `studio` is the familiar NLE arrangement
 * (media bin / monitor / inspector over a full-width timeline — CapCut/Premiere grammar) and the
 * default; `strata` is the MERIDIAN sky/ground horizon shell (docs/design/MERIDIAN-UI-SPEC.md).
 */
export type WorkspaceLayout = 'studio' | 'strata'

export interface AppPreferences {
  defaultProjectDirectory: string | null
  comfyUiEndpoint: string
  cloudApiKey: string
  updateChannel: string
  updateManifestUrl: string | null
  keybindings: KeyBinding[]
  /** MERIDIAN item 7 (spec G/L.7): comfortable/compact UI density. An app-level preference (like
   *  `keybindings` above), not a project property — it follows the user across projects rather
   *  than living in `project.meta` alongside `horizonRatio`/`stageRowCollapse`. */
  density: DensityMode
  /** App-level like `density`: the shell arrangement follows the user, not the project. */
  workspaceLayout: WorkspaceLayout
}

export type ShortcutScope = 'global' | 'timeline' | 'workflow'

export interface KeyBinding {
  command: string
  key: string
  modifiers: string[]
  when: ShortcutScope
}

export interface AssetInspection {
  path: string
  exists: boolean
  isFile: boolean
  fileSize: number
  fileName: string
  extension: string | null
}

export interface AssetProbeResult {
  codec: string | null
  width: number | null
  height: number | null
  frameRate: number | null
  channels: number | null
  sampleRate: number | null
  fileSize: number
  duration: number | null
}

export interface ExportJobStartResult {
  manifestPath: string
  outputPath: string
  exportDirectory: string
  startedAt: string
}

export interface WaveformPeak {
  min: number
  max: number
}

export interface WaveformCacheEntry {
  assetId: string
  sourcePath: string
  cachePath: string
  peaks: WaveformPeak[]
  generatedAt: string
}

export interface PreviewFrameData {
  assetId: string
  sourcePath: string
  requestedTime: number
  width: number
  height: number
  mimeType: string
  dataUrl: string
  generatedAt: string
}

export interface ThumbnailResult {
  assetId: string
  thumbnailPath: string
  mimeType: string
  generatedAt: string
}

export interface AssetCopyResult {
  assetId: string
  relativePath: string
  absolutePath: string
  copiedAt: string
}

export interface AssetWatchTarget {
  assetId: string
  path: string
}

export interface AssetWatchEvent {
  assetId: string
  path: string
  changeType: 'deleted' | 'restored' | 'modified' | 'resized' | 'changed'
  exists: boolean
  modifiedAt: number | null
  fileSize: number | null
  detectedAt: string
}

export interface RenderJobStartResult {
  jobId: string
  outputPath: string
  manifestPath: string
  statusPath: string
  startedAt: string
  totalFrames: number
}

export interface RenderJobStatus {
  jobId: string
  status: 'queued' | 'rendering' | 'paused' | 'completed' | 'failed' | 'cancelled'
  progress: number
  currentFrame: number
  totalFrames: number
  updatedAt: string
  completedAt: string | null
  estimatedTimeRemaining: number | null
  outputPath: string
  outputFileSize: number | null
  error: string | null
  quotaResetAt?: string | null
  quotaUsageSummary?: string | null
}
