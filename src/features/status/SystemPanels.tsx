import { AlertTriangle, CheckCircle2, HardDrive, Radio, RefreshCcw, Rocket, Users, Volume2, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react'
import type {
  RuntimeHealth,
  Section11CoverageMapRecord,
  Section11CoverageTarget,
  Section11CoverageCell,
  Section11HardwareCoverageTarget,
  Section11ProofCheck,
  Section11ProofRecord,
  Section11ProofSuiteResult,
  Section11RenderProofResult,
  Section11CapturePacketRecord,
  Section11TargetProfile,
} from '../../domain/project/types'
import { canOpenPathInShell } from '../../services/ipc/app-shell'
import { useProjectStore } from '../../store/project-store'
import { useModalA11y } from '../settings/useModalA11y'
import { RenderJobProgress } from './RenderJobProgress'

function getOsTargetVerdict(runtimeHealth: RuntimeHealth) {
  if (runtimeHealth.backend !== 'tauri') {
    return {
      detail: 'Browser runtime cannot prove desktop OS compatibility',
      tone: 'warn' as const,
    }
  }

  const normalizedOs = runtimeHealth.os?.toLowerCase() ?? null
  const osVersion = runtimeHealth.osVersion

  if (!normalizedOs || !osVersion) {
    return {
      detail: `${runtimeHealth.os ?? 'unknown'} runtime needs manual validation`,
      tone: 'warn' as const,
    }
  }

  if (normalizedOs === 'windows') {
    const supported = /\b(10|11)\b/.test(osVersion)
    return {
      detail: supported ? `${osVersion} detected` : `${osVersion} needs Windows 10+ validation`,
      tone: supported ? ('ok' as const) : ('warn' as const),
    }
  }

  if (normalizedOs === 'macos') {
    const major = Number((osVersion.match(/(\d+)(?:\.\d+)?/) ?? [])[1] ?? NaN)
    const supported = Number.isFinite(major) && major >= 12
    return {
      detail: supported ? `${osVersion} detected` : `${osVersion} needs macOS 12+ validation`,
      tone: supported ? ('ok' as const) : ('warn' as const),
    }
  }

  if (normalizedOs === 'linux') {
    const ubuntuMatch = osVersion.match(/ubuntu\s+(\d+)\.(\d+)/i)
    if (ubuntuMatch) {
      const major = Number(ubuntuMatch[1])
      const minor = Number(ubuntuMatch[2])
      const supported = major > 22 || (major === 22 && minor >= 4)
      return {
        detail: supported ? `${osVersion} detected` : `${osVersion} needs Ubuntu 22.04+ validation`,
        tone: supported ? ('ok' as const) : ('warn' as const),
      }
    }

    return {
      detail: `${osVersion} detected, but Ubuntu 22.04+ is the explicit spec target`,
      tone: 'warn' as const,
    }
  }

  return {
    detail: `${runtimeHealth.os} runtime needs manual validation`,
    tone: 'warn' as const,
  }
}

function buildOsCoverageTargets(runtimeHealth: RuntimeHealth, checks: Section11ProofCheck[]): Section11CoverageTarget[] {
  const allChecksReady = checks.length > 0 && checks.every((check) => check.status === 'ready')
  const runtimeSupported = runtimeHealth.backend === 'tauri' && allChecksReady
  const normalizedOs = runtimeHealth.os?.toLowerCase() ?? null
  const osVersion = runtimeHealth.osVersion ?? ''

  const windowsMatch = osVersion.match(/\b(10|11)\b/)
  const windowsMajor = windowsMatch ? Number(windowsMatch[1]) : null
  const macMajor = Number((osVersion.match(/(\d+)(?:\.\d+)?/) ?? [])[1] ?? NaN)
  const ubuntuMatch = osVersion.match(/ubuntu\s+(\d+)\.(\d+)/i)
  const ubuntuMajor = ubuntuMatch ? Number(ubuntuMatch[1]) : null
  const ubuntuMinor = ubuntuMatch ? Number(ubuntuMatch[2]) : null

  const isWindows10Plus = runtimeSupported && normalizedOs === 'windows' && windowsMajor !== null && windowsMajor >= 10
  const isWindows11 = runtimeSupported && normalizedOs === 'windows' && windowsMajor === 11
  const isMacos12Plus = runtimeSupported && normalizedOs === 'macos' && Number.isFinite(macMajor) && macMajor >= 12
  const isUbuntu2204Plus =
    runtimeSupported &&
    normalizedOs === 'linux' &&
    ubuntuMajor !== null &&
    ubuntuMinor !== null &&
    (ubuntuMajor > 22 || (ubuntuMajor === 22 && ubuntuMinor >= 4))

  return [
    {
      id: 'windows-10-plus',
      label: 'Windows 10+',
      status: isWindows10Plus ? 'ready' : 'needs-proof',
      detail: isWindows10Plus ? `Verified on ${osVersion}` : 'Awaiting saved proof from a Tauri runtime on Windows 10+',
    },
    {
      id: 'windows-11',
      label: 'Windows 11',
      status: isWindows11 ? 'ready' : 'needs-proof',
      detail: isWindows11 ? `Verified on ${osVersion}` : 'Awaiting saved proof from a Tauri runtime on Windows 11',
    },
    {
      id: 'macos-12-plus',
      label: 'macOS 12+',
      status: isMacos12Plus ? 'ready' : 'needs-proof',
      detail: isMacos12Plus ? `Verified on ${osVersion}` : 'Awaiting saved proof from a Tauri runtime on macOS 12+',
    },
    {
      id: 'ubuntu-22-04-plus',
      label: 'Ubuntu 22.04+',
      status: isUbuntu2204Plus ? 'ready' : 'needs-proof',
      detail: isUbuntu2204Plus ? `Verified on ${osVersion}` : 'Awaiting saved proof from a Tauri runtime on Ubuntu 22.04+',
    },
  ]
}

function buildTargetProfile(runtimeHealth: RuntimeHealth, label: string): Section11TargetProfile {
  const hardwareClass: Section11TargetProfile['hardwareClass'] =
    runtimeHealth.vramTotalGb !== null && runtimeHealth.vramTotalGb >= 8
      ? 'high'
      : runtimeHealth.vramTotalGb !== null && runtimeHealth.vramTotalGb >= 4
        ? 'balanced'
        : runtimeHealth.vramTotalGb !== null || runtimeHealth.cpuCores !== null
          ? 'entry'
          : 'unknown'

  return {
    label,
    os: runtimeHealth.os,
    osVersion: runtimeHealth.osVersion,
    arch: runtimeHealth.arch,
    cpuCores: runtimeHealth.cpuCores,
    deviceMemoryGb: runtimeHealth.deviceMemoryGb,
    vramTotalGb: runtimeHealth.vramTotalGb,
    hardwareClass,
  }
}

function getDefaultTargetProfileLabel(runtimeHealth: RuntimeHealth) {
  if (runtimeHealth.backend !== 'tauri') {
    return 'Browser'
  }

  const os = runtimeHealth.os?.toLowerCase() ?? null
  const osVersion = runtimeHealth.osVersion ?? ''

  if (os === 'windows') {
    return /\b11\b/.test(osVersion) ? 'Windows 11' : 'Windows 10+'
  }

  if (os === 'macos') {
    return 'macOS 12+'
  }

  if (os === 'linux') {
    return 'Ubuntu 22.04+'
  }

  return runtimeHealth.os ?? 'Browser'
}

function getRuntimeProfileLabel(runtimeHealth: RuntimeHealth) {
  if (runtimeHealth.backend !== 'tauri') {
    return 'Browser'
  }

  if (runtimeHealth.osVersion) {
    return runtimeHealth.os ?? 'Desktop'
  }

  return runtimeHealth.os ?? 'Desktop'
}

type Section11CoverageMapBundle = {
  bundleVersion: string
  bundleKind: 'section11-coverage-map' | 'section11-proof-bundle'
  generatedAt: string
  manifest: {
    title: string
    contents: string[]
  }
  runbook: string[]
  osCoverage: unknown[]
  hardwareCoverage: unknown[]
  combinedCoverage: unknown[]
  recommendedProofTargets?: unknown[]
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string')
}

function isSection11CoverageMapBundle(value: unknown): value is Section11CoverageMapBundle {
  if (!value || typeof value !== 'object') {
    return false
  }

  const bundle = value as {
    bundleVersion?: unknown
    bundleKind?: unknown
    generatedAt?: unknown
    manifest?: unknown
    runbook?: unknown
    osCoverage?: unknown
    hardwareCoverage?: unknown
    combinedCoverage?: unknown
    recommendedProofTargets?: unknown
  }

  return (
    typeof bundle.bundleVersion === 'string' &&
    (bundle.bundleKind === 'section11-coverage-map' || bundle.bundleKind === 'section11-proof-bundle') &&
    typeof bundle.generatedAt === 'string' &&
    bundle.manifest !== null &&
    typeof bundle.manifest === 'object' &&
    typeof (bundle.manifest as { title?: unknown }).title === 'string' &&
    isStringArray((bundle.manifest as { contents?: unknown }).contents) &&
    isStringArray(bundle.runbook) &&
    Array.isArray(bundle.osCoverage) &&
    Array.isArray(bundle.hardwareCoverage) &&
    Array.isArray(bundle.combinedCoverage) &&
    (bundle.recommendedProofTargets === undefined || Array.isArray(bundle.recommendedProofTargets))
  )
}

function toSection11CoverageMapRecord(bundle: Section11CoverageMapBundle): Section11CoverageMapRecord {
  return {
    bundleVersion: bundle.bundleVersion,
    bundleKind: bundle.bundleKind,
    generatedAt: bundle.generatedAt,
    manifestTitle: bundle.manifest.title,
    manifestContents: bundle.manifest.contents,
    runbook: bundle.runbook,
    osCoverageCount: bundle.osCoverage.length,
    hardwareCoverageCount: bundle.hardwareCoverage.length,
    combinedCoverageCount: bundle.combinedCoverage.length,
    recommendedCount: Array.isArray(bundle.recommendedProofTargets) ? bundle.recommendedProofTargets.length : 0,
  }
}

type Section11CapturePacketBundle = {
  bundleVersion: string
  bundleKind: 'section11-capture-packet'
  generatedAt: string
  manifest: {
    title: string
    contents: string[]
  }
  runbook: string[]
  proofs?: unknown[]
  proofSuiteResult?: unknown
  renderProofResult?: unknown
  targetProfileOverride?: unknown
  latestSavedProofSummary?: unknown
  nextCaptureTargets?: unknown[]
  coverageMapHistory?: unknown[]
  proofHistoryCount?: unknown
  packetArchiveHistory?: unknown[]
}

function isSection11CapturePacketBundle(value: unknown): value is Section11CapturePacketBundle {
  if (!value || typeof value !== 'object') {
    return false
  }

  const bundle = value as {
    bundleVersion?: unknown
    bundleKind?: unknown
    generatedAt?: unknown
    manifest?: unknown
    runbook?: unknown
    proofs?: unknown
    proofSuiteResult?: unknown
    renderProofResult?: unknown
    targetProfileOverride?: unknown
    nextCaptureTargets?: unknown
    coverageMapHistory?: unknown
    proofHistoryCount?: unknown
    packetArchiveHistory?: unknown
  }

  return (
    typeof bundle.bundleVersion === 'string' &&
    bundle.bundleKind === 'section11-capture-packet' &&
    typeof bundle.generatedAt === 'string' &&
    bundle.manifest !== null &&
    typeof bundle.manifest === 'object' &&
    typeof (bundle.manifest as { title?: unknown }).title === 'string' &&
    isStringArray((bundle.manifest as { contents?: unknown }).contents) &&
    isStringArray(bundle.runbook) &&
    (bundle.proofs === undefined || Array.isArray(bundle.proofs)) &&
    (bundle.proofSuiteResult === undefined || (bundle.proofSuiteResult !== null && typeof bundle.proofSuiteResult === 'object')) &&
    (bundle.renderProofResult === undefined || (bundle.renderProofResult !== null && typeof bundle.renderProofResult === 'object')) &&
    (bundle.targetProfileOverride === undefined || typeof bundle.targetProfileOverride === 'string' || bundle.targetProfileOverride === null) &&
    (bundle.nextCaptureTargets === undefined || Array.isArray(bundle.nextCaptureTargets)) &&
    (bundle.coverageMapHistory === undefined || Array.isArray(bundle.coverageMapHistory)) &&
    (bundle.packetArchiveHistory === undefined || Array.isArray(bundle.packetArchiveHistory)) &&
    (bundle.proofHistoryCount === undefined || typeof bundle.proofHistoryCount === 'number')
  )
}

function isSection11CapturePacketRecord(value: unknown): value is Section11CapturePacketRecord {
  if (!value || typeof value !== 'object') {
    return false
  }

  const record = value as Partial<Section11CapturePacketRecord>
  return (
    typeof record.bundleVersion === 'string' &&
    record.bundleKind === 'section11-capture-packet' &&
    typeof record.generatedAt === 'string' &&
    typeof record.manifestTitle === 'string' &&
    isStringArray(record.runbook) &&
    (record.targetProfileOverride === null ||
      record.targetProfileOverride === 'Browser' ||
      record.targetProfileOverride === 'Windows 10+' ||
      record.targetProfileOverride === 'Windows 11' ||
      record.targetProfileOverride === 'macOS 12+' ||
      record.targetProfileOverride === 'Ubuntu 22.04+') &&
    typeof record.proofHistoryCount === 'number' &&
    typeof record.nextCaptureTargetsCount === 'number' &&
    typeof record.coverageMapHistoryCount === 'number' &&
    typeof record.proofSuiteRestored === 'boolean' &&
    typeof record.renderProofRestored === 'boolean'
  )
}

function isSection11ProofSuiteResult(value: unknown): value is Section11ProofSuiteResult {
  if (!value || typeof value !== 'object') {
    return false
  }

  const result = value as Partial<Section11ProofSuiteResult>
  return (
    typeof result.startedAt === 'string' &&
    typeof result.completedAt === 'string' &&
    Array.isArray(result.viewSwitchSamplesMs) &&
    Array.isArray(result.fitViewSamplesMs) &&
    typeof result.benchmarkNodeCount === 'number' &&
    typeof result.benchmarkEdgeCount === 'number'
  )
}

function isSection11RenderProofResult(value: unknown): value is Section11RenderProofResult {
  if (!value || typeof value !== 'object') {
    return false
  }

  const result = value as Partial<Section11RenderProofResult>
  return (
    typeof result.startedAt === 'string' &&
    typeof result.completedAt === 'string' &&
    typeof result.presetId === 'string' &&
    typeof result.presetName === 'string' &&
    !!result.resolution &&
    typeof result.resolution === 'object' &&
    typeof (result.resolution as { width?: unknown }).width === 'number' &&
    typeof (result.resolution as { height?: unknown }).height === 'number' &&
    typeof result.frameRate === 'number' &&
    (result.status === 'completed' || result.status === 'failed' || result.status === 'timed_out')
  )
}

function isSection11CoverageMapRecord(value: unknown): value is Section11CoverageMapRecord {
  if (!value || typeof value !== 'object') {
    return false
  }

  const record = value as Partial<Section11CoverageMapRecord>
  return (
    typeof record.bundleVersion === 'string' &&
    (record.bundleKind === 'section11-coverage-map' || record.bundleKind === 'section11-proof-bundle') &&
    typeof record.generatedAt === 'string' &&
    typeof record.manifestTitle === 'string' &&
    isStringArray(record.manifestContents) &&
    isStringArray(record.runbook) &&
    typeof record.osCoverageCount === 'number' &&
    typeof record.hardwareCoverageCount === 'number' &&
    typeof record.combinedCoverageCount === 'number' &&
    typeof record.recommendedCount === 'number'
  )
}

export function SystemPanels() {
  const targetProfileOptions = ['Browser', 'Windows 10+', 'Windows 11', 'macOS 12+', 'Ubuntu 22.04+'] as const
  const networkStatus = useProjectStore((state) => state.ui.networkStatus)
  const performanceMode = useProjectStore((state) => state.ui.performanceMode)
  const runtimeHealth = useProjectStore((state) => state.runtimeHealth)
  const section11ProofHistory = useProjectStore((state) => state.project.meta.section11ProofHistory)
  const section11CoverageMapHistory = useProjectStore((state) => state.project.meta.section11CoverageMapHistory)
  const section11CapturePacketHistory = useProjectStore((state) => state.project.meta.section11CapturePacketHistory)
  const section11TargetProfileOverride = useProjectStore((state) => state.project.meta.section11TargetProfileOverride)
  const workspaceSharing = useProjectStore((state) => state.project.meta.sharing)
  const workspaceSyncConflicts = useProjectStore((state) => state.workspaceSyncConflicts)
  const appUpdateState = useProjectStore((state) => state.appUpdateState)
  const runtimeCacheMetrics = useProjectStore((state) => state.runtimeCacheMetrics)
  const cloudApiKey = useProjectStore((state) => state.preferences.cloudApiKey)
  const updateManifestUrl = useProjectStore((state) => state.preferences.updateManifestUrl)
  const errors = useProjectStore((state) => state.appErrors)
  const queue = useProjectStore((state) => state.project.output.queue)
  const presets = useProjectStore((state) => state.project.output.presets)
  const activePresetId = useProjectStore((state) => state.project.output.activePresetId)
  const audio = useProjectStore((state) => state.project.audio)
  const scrubPreviewState = useProjectStore((state) => state.ui.scrubPreviewState)
  const viewSwitchMetric = useProjectStore((state) => state.ui.viewSwitchMetric)
  const workflowBenchmarkMetric = useProjectStore((state) => state.ui.workflowBenchmarkMetric)
  const tracks = useProjectStore((state) => state.project.timeline.tracks)
  const setActiveView = useProjectStore((state) => state.setActiveView)
  const createLargeCanvasBenchmarkScene = useProjectStore((state) => state.createLargeCanvasBenchmarkScene)
  const panWorkflowViewport = useProjectStore((state) => state.panWorkflowViewport)
  const adjustWorkflowZoom = useProjectStore((state) => state.adjustWorkflowZoom)
  const fitWorkflowViewport = useProjectStore((state) => state.fitWorkflowViewport)
  const recordWorkflowBenchmarkMetric = useProjectStore((state) => state.recordWorkflowBenchmarkMetric)
  const saveSection11ProofRecord = useProjectStore((state) => state.saveSection11ProofRecord)
  const saveSection11CoverageMapRecord = useProjectStore((state) => state.saveSection11CoverageMapRecord)
  const saveSection11CapturePacketRecord = useProjectStore((state) => state.saveSection11CapturePacketRecord)
  const setSection11TargetProfileOverride = useProjectStore((state) => state.setSection11TargetProfileOverride)
  const clearSection11ProofHistory = useProjectStore((state) => state.clearSection11ProofHistory)
  const clearSection11CoverageMapHistory = useProjectStore((state) => state.clearSection11CoverageMapHistory)
  const clearSection11CapturePacketHistory = useProjectStore((state) => state.clearSection11CapturePacketHistory)
  const enqueueRender = useProjectStore((state) => state.enqueueRender)
  const refreshRenderStatuses = useProjectStore((state) => state.refreshRenderStatuses)
  const pauseActiveRender = useProjectStore((state) => state.pauseActiveRender)
  const resumePausedRender = useProjectStore((state) => state.resumePausedRender)
  const cancelActiveRender = useProjectStore((state) => state.cancelActiveRender)
  const failActiveRender = useProjectStore((state) => state.failActiveRender)
  const simulateCloudNetworkFailure = useProjectStore((state) => state.simulateCloudNetworkFailure)
  const simulateGpuOomFailure = useProjectStore((state) => state.simulateGpuOomFailure)
  const simulateQuotaExceeded = useProjectStore((state) => state.simulateQuotaExceeded)
  const retryFailedRender = useProjectStore((state) => state.retryFailedRender)
  const moveRenderJob = useProjectStore((state) => state.moveRenderJob)
  const openRenderOutput = useProjectStore((state) => state.openRenderOutput)
  const clearResolvedErrors = useProjectStore((state) => state.clearResolvedErrors)
  const dismissAppError = useProjectStore((state) => state.dismissAppError)
  const performAppErrorAction = useProjectStore((state) => state.performAppErrorAction)
  const setActiveRenderPreset = useProjectStore((state) => state.setActiveRenderPreset)
  const setMasterVolume = useProjectStore((state) => state.setMasterVolume)
  const toggleScrubEnabled = useProjectStore((state) => state.toggleScrubEnabled)
  const cycleWaveformDensity = useProjectStore((state) => state.cycleWaveformDensity)
  const clearRuntimeCaches = useProjectStore((state) => state.clearRuntimeCaches)
  const checkForAppUpdates = useProjectStore((state) => state.checkForAppUpdates)
  const downloadAppUpdate = useProjectStore((state) => state.downloadAppUpdate)
  const installDownloadedAppUpdate = useProjectStore((state) => state.installDownloadedAppUpdate)
  const openUpdateDownload = useProjectStore((state) => state.openUpdateDownload)
  const openWorkspaceSharing = useProjectStore((state) => state.openWorkspaceSharing)
  const previewFrameCount = useProjectStore((state) => Object.keys(state.previewFrames).length)
  const nodePreviewCount = useProjectStore((state) => Object.keys(state.nodePreviewFrames).length)
  const waveformCacheCount = useProjectStore((state) => Object.keys(state.waveformCache).length)
  const assetThumbnailCount = useProjectStore((state) => Object.keys(state.assetThumbnails).length)

  const activePreset = presets.find((preset) => preset.id === activePresetId) ?? presets[0]
  const osTargetVerdict = getOsTargetVerdict(runtimeHealth)
  const soloTracks = tracks.filter((track) => track.solo)
  const audibleTracks = tracks.filter((track) =>
    track.type === 'audio' &&
    !track.muted &&
    (soloTracks.length === 0 || track.solo),
  )
  const audibleClipCount = audibleTracks.reduce((sum, track) => sum + track.clips.length, 0)
  const weightedTrackGain = audibleTracks.reduce((sum, track) => sum + track.volume, 0)
  const averagePan =
    audibleTracks.length > 0
      ? audibleTracks.reduce((sum, track) => sum + track.pan, 0) / audibleTracks.length
      : 0
  const [activeInspectorJobId, setActiveInspectorJobId] = useState<string | null>(null)
  const [proofExportStatus, setProofExportStatus] = useState<string | null>(null)
  const [proofSuiteRunning, setProofSuiteRunning] = useState(false)
  const [proofSuiteResult, setProofSuiteResult] = useState<Section11ProofSuiteResult | null>(null)
  const [renderProofRunning, setRenderProofRunning] = useState(false)
  const [renderProofResult, setRenderProofResult] = useState<Section11RenderProofResult | null>(null)
  const proofImportInputRef = useRef<HTMLInputElement | null>(null)
  const coverageMapImportInputRef = useRef<HTMLInputElement | null>(null)
  const capturePacketImportInputRef = useRef<HTMLInputElement | null>(null)
  const [targetProfileOverride, setTargetProfileOverride] = useState<Section11TargetProfile['label']>(
    section11TargetProfileOverride ?? getDefaultTargetProfileLabel(runtimeHealth),
  )
  const [importedCoverageMapSummary, setImportedCoverageMapSummary] = useState<{
    bundleVersion: string
    bundleKind: string
    generatedAt: string
    manifestTitle: string
    manifestContents: string[]
    runbook: string[]
    osCoverageCount: number
    hardwareCoverageCount: number
    combinedCoverageCount: number
    recommendedCount: number
  } | null>(null)
  const [importedCapturePacketSummary, setImportedCapturePacketSummary] = useState<{
    bundleVersion: string
    bundleKind: string
    generatedAt: string
    manifestTitle: string
    runbook: string[]
    targetProfileOverride: string | null
    proofHistoryCount: number
    nextCaptureTargets: number
    coverageMapHistoryCount: number
    proofSuiteRestored: boolean
    renderProofRestored: boolean
  } | null>(null)
  const latestCoverageMapSummary = importedCoverageMapSummary ?? section11CoverageMapHistory[0] ?? null
  const latestCapturePacketArchive = section11CapturePacketHistory[0] ?? null
  useEffect(() => {
    setTargetProfileOverride(section11TargetProfileOverride ?? getDefaultTargetProfileLabel(runtimeHealth))
  }, [section11TargetProfileOverride, runtimeHealth])
  const quotaErrors = useMemo(
    () => errors.filter((error) => error.category === 'cloud_quota'),
    [errors],
  )
  const screenSnapshot = useMemo(
    () => ({
      width: typeof window !== 'undefined' ? window.screen.width : null,
      height: typeof window !== 'undefined' ? window.screen.height : null,
      pixelRatio: typeof window !== 'undefined' ? Number(window.devicePixelRatio.toFixed(2)) : null,
    }),
    [],
  )
  const minimumSystemChecks = useMemo(() => {
    const totalMemoryGb = runtimeHealth.totalMemoryGb ?? runtimeHealth.deviceMemoryGb
    const displayReady =
      screenSnapshot.width !== null && screenSnapshot.height !== null
        ? screenSnapshot.width >= 1280 && screenSnapshot.height >= 720
        : null
    const diskReady = runtimeHealth.diskFreeGb !== null ? runtimeHealth.diskFreeGb >= 0.5 : null
    const benchmarkLoaded = workflowBenchmarkMetric.nodeCount >= 100
    const measuredViewSwitch = viewSwitchMetric.durationMs !== null
    const fastViewSwitch = measuredViewSwitch ? viewSwitchMetric.durationMs! < 500 : null
    const fitViewMeasured = workflowBenchmarkMetric.fitViewDurationMs !== null
    const panZoomMeasured =
      workflowBenchmarkMetric.panTraversalDurationMs !== null &&
      workflowBenchmarkMetric.zoomSweepDurationMs !== null
    const renderProofReady = renderProofResult?.status === 'completed'
    const render4kReady = presets.some((preset) => {
      const resolution = preset.resolution === 'project' ? null : preset.resolution
      const frameRate = preset.frameRate === 'project' ? null : preset.frameRate
      return (
        resolution !== null &&
        resolution.width >= 3840 &&
        resolution.height >= 2160 &&
        frameRate !== null &&
        frameRate >= 60
      )
    })

    return [
      {
        label: 'OS target',
        detail: osTargetVerdict.detail,
        tone: osTargetVerdict.tone,
      },
      {
        label: 'CPU floor',
        detail:
          runtimeHealth.cpuCores !== null
            ? `${runtimeHealth.cpuCores} cores detected (target 4+)`
            : 'CPU telemetry pending',
        tone:
          runtimeHealth.cpuCores === null ? 'warn' : runtimeHealth.cpuCores >= 4 ? 'ok' : 'warn',
      },
      {
        label: 'RAM floor',
        detail:
          totalMemoryGb !== null
            ? `${totalMemoryGb.toFixed(1)} GB detected (target 8+)`
            : 'Memory telemetry pending',
        tone: totalMemoryGb === null ? 'warn' : totalMemoryGb >= 8 ? 'ok' : 'warn',
      },
      {
        label: 'GPU floor',
        detail:
          runtimeHealth.vramTotalGb !== null
            ? `${runtimeHealth.vramTotalGb.toFixed(1)} GB VRAM detected (target 2+, AI rec 6+)`
            : 'VRAM telemetry pending',
        tone:
          runtimeHealth.vramTotalGb === null
            ? 'warn'
            : runtimeHealth.vramTotalGb >= 2
              ? 'ok'
              : 'warn',
      },
      {
        label: 'Disk floor',
        detail:
          runtimeHealth.diskFreeGb !== null
            ? `${runtimeHealth.diskFreeGb.toFixed(1)} GB free (target 0.5+ GB before project media growth)`
            : 'Disk telemetry pending',
        tone: diskReady === null ? 'warn' : diskReady ? 'ok' : 'warn',
      },
      {
        label: 'Display floor',
        detail:
          displayReady === null
            ? 'Display telemetry pending'
            : `${screenSnapshot.width}x${screenSnapshot.height} detected (target 1280x720+)`,
        tone: displayReady === null ? 'warn' : displayReady ? 'ok' : 'warn',
      },
      {
        label: '4K/60 preset path',
        detail: render4kReady
          ? 'Export presets include a 4K/60-capable profile'
          : '4K preset path still depends on project settings or manual configuration',
        tone: render4kReady ? 'ok' : 'warn',
      },
      {
        label: '4K/60 render proof',
        detail: renderProofResult
          ? renderProofResult.status === 'completed'
            ? `${renderProofResult.resolution.width}x${renderProofResult.resolution.height} @ ${renderProofResult.frameRate} fps render completed`
            : renderProofResult.status === 'failed'
              ? `4K/60 render failed: ${renderProofResult.failureReason ?? 'unknown error'}`
              : '4K/60 render proof timed out before completion'
          : 'Run the 4K/60 render proof to verify the export path end-to-end',
        tone: renderProofReady ? 'ok' : 'warn',
      },
      {
        label: 'View switch target',
        detail: measuredViewSwitch
          ? `${viewSwitchMetric.durationMs!.toFixed(1)} ms measured (target <500 ms)`
          : 'Switch timeline/workflow once to capture a measurement',
        tone: fastViewSwitch === null ? 'warn' : fastViewSwitch ? 'ok' : 'warn',
      },
      {
        label: '100+ node canvas target',
        detail: benchmarkLoaded
          ? `${workflowBenchmarkMetric.nodeCount} nodes / ${workflowBenchmarkMetric.edgeCount} edges benchmark loaded`
          : 'Load the 120-node benchmark scene to exercise the large-canvas path',
        tone: benchmarkLoaded ? 'ok' : 'warn',
      },
      {
        label: 'Fit-to-view runtime proof',
        detail: fitViewMeasured
          ? `${workflowBenchmarkMetric.fitViewDurationMs!.toFixed(1)} ms measured on benchmark scene`
          : 'Measure Fit View in Workflow to capture a representative viewport timing',
        tone: fitViewMeasured ? 'ok' : 'warn',
      },
      {
        label: 'Pan/zoom runtime proof',
        detail: panZoomMeasured
          ? `Pan ${workflowBenchmarkMetric.panTraversalDurationMs!.toFixed(1)} ms / Zoom ${workflowBenchmarkMetric.zoomSweepDurationMs!.toFixed(1)} ms on benchmark scene`
          : 'Measure benchmark pan and zoom to capture interaction timing under large-canvas load',
        tone: panZoomMeasured ? 'ok' : 'warn',
      },
    ] as const
  }, [osTargetVerdict.detail, osTargetVerdict.tone, presets, renderProofResult, runtimeHealth, screenSnapshot, viewSwitchMetric, workflowBenchmarkMetric])
  const performanceEvidenceSnapshot = useMemo<Section11ProofRecord>(() => {
    const readyCount = minimumSystemChecks.filter((check) => check.tone === 'ok').length
    const checks: Section11ProofCheck[] = minimumSystemChecks.map((check) => ({
      label: check.label,
      status: check.tone === 'ok' ? 'ready' : 'needs-proof',
      detail: check.detail,
    }))

    return {
      id: `section11-proof-${Date.now()}`,
      capturedAt: new Date().toISOString(),
      source: 'system-panels',
      label: runtimeHealth.backend === 'tauri' ? `${runtimeHealth.os ?? 'Desktop'} verification` : 'Browser verification',
      targetProfile: buildTargetProfile(
        runtimeHealth,
        targetProfileOverride,
      ),
      runtimeProfile: buildTargetProfile(
        runtimeHealth,
        getRuntimeProfileLabel(runtimeHealth),
      ),
      appVersion: {
        currentVersion: appUpdateState.versionInfo.currentVersion,
        runtimeBackend: appUpdateState.versionInfo.backend,
        loadedAt: appUpdateState.versionInfo.loadedAt,
      },
      runtimeHealth,
      screen: screenSnapshot,
      runtimeCacheMetrics,
      activePreset: activePreset
        ? {
            id: activePreset.id,
            name: activePreset.name,
            format: activePreset.format,
            resolution: activePreset.resolution,
            frameRate: activePreset.frameRate,
            videoCodec: activePreset.videoCodec,
            audioCodec: activePreset.audioCodec,
            quality: activePreset.quality,
          }
        : null,
      viewSwitchMetric,
      workflowBenchmarkMetric,
      proofSuiteResult,
      renderProofResult,
      checks,
      coverageSummary: {
        readyChecks: readyCount,
        pendingChecks: minimumSystemChecks.length - readyCount,
        totalChecks: minimumSystemChecks.length,
      },
      osCoverage: buildOsCoverageTargets(runtimeHealth, checks),
    }
  }, [
    activePreset,
    appUpdateState.versionInfo.backend,
    appUpdateState.versionInfo.currentVersion,
    appUpdateState.versionInfo.loadedAt,
    minimumSystemChecks,
    runtimeCacheMetrics,
    runtimeHealth,
    screenSnapshot,
    viewSwitchMetric,
    workflowBenchmarkMetric,
    proofSuiteResult,
    renderProofResult,
    targetProfileOverride,
  ])
  const section11CoverageMatrix = useMemo(() => {
    const targets: Section11CoverageTarget['id'][] = ['windows-10-plus', 'windows-11', 'macos-12-plus', 'ubuntu-22-04-plus']
    const allProofs = [...section11ProofHistory, performanceEvidenceSnapshot]

    return targets.map((targetId) => {
      const savedMatches = section11ProofHistory.filter((proof) =>
        proof.osCoverage.some((coverage) => coverage.id === targetId && coverage.status === 'ready'),
      )
      const liveMatch = performanceEvidenceSnapshot.osCoverage.some(
        (coverage) => coverage.id === targetId && coverage.status === 'ready',
      )
      const matches = liveMatch ? [performanceEvidenceSnapshot, ...savedMatches] : savedMatches
      const target = allProofs
        .flatMap((proof) => proof.osCoverage)
        .find((coverage) => coverage.id === targetId)

      return {
        id: targetId,
        label: target?.label ?? targetId,
        status: matches.length > 0 ? 'ready' : 'needs-proof',
        detail:
          matches.length > 0
            ? liveMatch
              ? savedMatches.length > 0
                ? `Live runtime verified and ${savedMatches.length} saved proof snapshot${savedMatches.length === 1 ? '' : 's'} recorded`
                : 'Live runtime currently verifies this target'
              : `${savedMatches.length} saved proof snapshot${savedMatches.length === 1 ? '' : 's'} recorded`
            : 'No saved proof snapshot yet',
        latestProof: matches[0] ?? null,
      }
    })
  }, [performanceEvidenceSnapshot, section11ProofHistory])
  const section11HardwareCoverageMatrix = useMemo(() => {
    const targets: Section11HardwareCoverageTarget['id'][] = ['entry', 'balanced', 'high']
    const allProofs = [...section11ProofHistory, performanceEvidenceSnapshot]

    return targets.map((targetId) => {
      const savedMatches = section11ProofHistory.filter(
        (proof) =>
          proof.runtimeProfile.hardwareClass === targetId ||
          proof.targetProfile.hardwareClass === targetId,
      )
      const liveMatch =
        performanceEvidenceSnapshot.runtimeProfile.hardwareClass === targetId ||
        performanceEvidenceSnapshot.targetProfile.hardwareClass === targetId
      const matches = liveMatch ? [performanceEvidenceSnapshot, ...savedMatches] : savedMatches
      const latestProof =
        matches[0] ??
        allProofs.find(
          (proof) =>
            proof.runtimeProfile.hardwareClass === targetId ||
            proof.targetProfile.hardwareClass === targetId,
        ) ??
        null

      return {
        id: targetId,
        label:
          targetId === 'entry'
            ? 'Entry tier'
            : targetId === 'balanced'
              ? 'Balanced tier'
              : 'High tier',
        status: matches.length > 0 ? 'ready' : 'needs-proof',
        detail:
          matches.length > 0
            ? liveMatch
              ? savedMatches.length > 0
                ? `Live runtime verified and ${savedMatches.length} saved proof snapshot${savedMatches.length === 1 ? '' : 's'} recorded`
                : 'Live runtime currently verifies this tier'
              : `${savedMatches.length} saved proof snapshot${savedMatches.length === 1 ? '' : 's'} recorded`
            : 'No saved proof snapshot yet',
        latestProof,
      }
    })
  }, [performanceEvidenceSnapshot, section11ProofHistory])
  const section11CombinedCoverageMatrix = useMemo(() => {
    const cells: Section11CoverageCell[] = []

    for (const osTarget of section11CoverageMatrix) {
      for (const hardwareTarget of section11HardwareCoverageMatrix) {
        const matchingProof = [...section11ProofHistory, performanceEvidenceSnapshot].find(
          (proof) =>
            proof.osCoverage.some((coverage) => coverage.id === osTarget.id && coverage.status === 'ready') &&
            (proof.runtimeProfile.hardwareClass === hardwareTarget.id ||
              proof.targetProfile.hardwareClass === hardwareTarget.id),
        )

        cells.push({
          osTargetId: osTarget.id,
          hardwareTargetId: hardwareTarget.id,
          label: `${osTarget.label} · ${hardwareTarget.label}`,
          status: matchingProof ? 'ready' : 'needs-proof',
          detail: matchingProof
            ? `Covered by ${matchingProof.label} captured ${new Date(matchingProof.capturedAt).toLocaleString()}`
            : 'No saved proof covers this exact OS / hardware combination yet',
          latestProof: matchingProof ?? null,
        })
      }
    }

    return cells
  }, [performanceEvidenceSnapshot, section11HardwareCoverageMatrix, section11CoverageMatrix, section11ProofHistory])
  const section11RecommendedProofTargets = useMemo(
    () =>
      section11CombinedCoverageMatrix
        .filter((cell) => cell.status === 'needs-proof')
        .slice(0, 6),
    [section11CombinedCoverageMatrix],
  )
  const latestSavedProof = section11ProofHistory[0] ?? null
  const latestSavedProofSummary = useMemo(() => {
    if (!latestSavedProof) {
      return null
    }

    const proofKind =
      latestSavedProof.renderProofResult?.status === 'completed'
        ? '4K/60 render proof'
        : latestSavedProof.renderProofResult
          ? `4K/60 render proof (${latestSavedProof.renderProofResult.status})`
          : latestSavedProof.proofSuiteResult
            ? 'Section 11 proof suite'
            : 'Section 11 snapshot'

    return {
      proofKind,
      capturedAt: latestSavedProof.capturedAt,
      readyChecks: latestSavedProof.coverageSummary.readyChecks,
      pendingChecks: latestSavedProof.coverageSummary.pendingChecks,
      totalChecks: latestSavedProof.coverageSummary.totalChecks,
      osCoverageReady: latestSavedProof.osCoverage.filter((coverage) => coverage.status === 'ready').length,
      osCoverageTotal: latestSavedProof.osCoverage.length,
      targetProfile: latestSavedProof.targetProfile,
      runtimeProfile: latestSavedProof.runtimeProfile,
      hardwareCoverageReady: section11HardwareCoverageMatrix.filter((coverage) => coverage.status === 'ready').length,
      hardwareCoverageTotal: section11HardwareCoverageMatrix.length,
      combinedCoverageReady: section11CombinedCoverageMatrix.filter((coverage) => coverage.status === 'ready').length,
      combinedCoverageTotal: section11CombinedCoverageMatrix.length,
    }
  }, [latestSavedProof, section11CombinedCoverageMatrix, section11HardwareCoverageMatrix])
  const createPersistedProofRecord = (patch: Partial<Section11ProofRecord>): Section11ProofRecord => ({
    ...performanceEvidenceSnapshot,
    id: `section11-proof-${Date.now()}`,
    capturedAt: new Date().toISOString(),
    ...patch,
  })
  async function copyPerformanceEvidenceSnapshot() {
    await navigator.clipboard.writeText(JSON.stringify(performanceEvidenceSnapshot, null, 2))
    setProofExportStatus(`Copied proof snapshot at ${new Date().toLocaleTimeString()}`)
  }
  function downloadPerformanceEvidenceSnapshot() {
    const payload = JSON.stringify(performanceEvidenceSnapshot, null, 2)
    const blob = new Blob([payload], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `fluxnode-section11-proof-${new Date().toISOString().replace(/[:.]/g, '-')}.json`
    anchor.click()
    URL.revokeObjectURL(url)
    setProofExportStatus(`Downloaded proof snapshot at ${new Date().toLocaleTimeString()}`)
  }
  function downloadSavedProofHistory() {
    const payload = JSON.stringify(
      {
        bundleVersion: '1.0',
        bundleKind: 'section11-proof-bundle',
        generatedAt: new Date().toISOString(),
        source: 'system-panels',
        manifest: {
          title: 'Section 11 Proof Bundle',
          contents: ['proofs', 'coverageMapHistory', 'latestSavedProofSummary', 'compatibilityMatrix', 'hardwareCompatibilityMatrix', 'combinedCompatibilityMatrix'],
        },
        runbook: [
          'Load the bundle on the target machine.',
          'Run proof suite and/or 4K/60 render proof for missing cells.',
          'Save the new proof snapshot and re-export the bundle.',
        ],
        savedProofCount: section11ProofHistory.length,
        latestSavedProofSummary,
        compatibilityMatrix: section11CoverageMatrix,
        hardwareCompatibilityMatrix: section11HardwareCoverageMatrix,
        combinedCompatibilityMatrix: section11CombinedCoverageMatrix,
        recommendedProofTargets: section11RecommendedProofTargets,
        coverageMapHistory: section11CoverageMapHistory,
        proofs: section11ProofHistory,
      },
      null,
      2,
    )
    const blob = new Blob([payload], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `fluxnode-section11-proof-history-${new Date().toISOString().replace(/[:.]/g, '-')}.json`
    anchor.click()
    URL.revokeObjectURL(url)
    setProofExportStatus(`Downloaded saved proof history at ${new Date().toLocaleTimeString()}`)
  }
  function downloadSection11CoverageMap() {
    const payload = JSON.stringify(
      {
        bundleVersion: '1.0',
        bundleKind: 'section11-coverage-map',
        generatedAt: new Date().toISOString(),
        source: 'system-panels',
        manifest: {
          title: 'Section 11 Coverage Map',
          contents: ['coverageSummary', 'osCoverage', 'hardwareCoverage', 'combinedCoverage'],
        },
        runbook: [
          'Open the coverage map on the target machine.',
          'Capture the missing OS x hardware cells listed in the recommended targets.',
          'Import the updated bundle back into the project archive.',
        ],
        coverageSummary: latestSavedProofSummary,
        osCoverage: section11CoverageMatrix,
        hardwareCoverage: section11HardwareCoverageMatrix,
        combinedCoverage: section11CombinedCoverageMatrix,
      },
      null,
      2,
    )
    const blob = new Blob([payload], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `fluxnode-section11-coverage-map-${new Date().toISOString().replace(/[:.]/g, '-')}.json`
    anchor.click()
    URL.revokeObjectURL(url)
    setProofExportStatus(`Downloaded Section 11 coverage map at ${new Date().toLocaleTimeString()}`)
  }
  function downloadSection11CapturePacket() {
    const payload = JSON.stringify(
      {
        bundleVersion: '1.0',
        bundleKind: 'section11-capture-packet',
        generatedAt: new Date().toISOString(),
        source: 'system-panels',
        manifest: {
          title: 'Section 11 Capture Packet',
          contents: ['targetProfileOverride', 'latestSavedProofSummary', 'nextCaptureTargets', 'captureRunbook', 'coverageMapHistory'],
        },
        runbook: [
          'Open this packet on the target machine.',
          'Choose a matching OS and hardware tier from the next capture targets.',
          'Run the proof suite and save the new snapshot to the project.',
          'Re-export the proof bundle after the new snapshot is archived.',
        ],
        proofs: section11ProofHistory,
        proofSuiteResult,
        renderProofResult,
        targetProfileOverride,
        latestSavedProofSummary,
        nextCaptureTargets: section11RecommendedProofTargets,
        coverageMapHistory: section11CoverageMapHistory,
        proofHistoryCount: section11ProofHistory.length,
      },
      null,
      2,
    )
    const blob = new Blob([payload], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `fluxnode-section11-capture-packet-${new Date().toISOString().replace(/[:.]/g, '-')}.json`
    anchor.click()
    URL.revokeObjectURL(url)
    setProofExportStatus(`Downloaded Section 11 capture packet at ${new Date().toLocaleTimeString()}`)
  }
  function downloadSection11CapturePacketArchive() {
    const payload = JSON.stringify(
      {
        bundleVersion: '1.0',
        bundleKind: 'section11-capture-packet-archive',
        generatedAt: new Date().toISOString(),
        source: 'system-panels',
        manifest: {
          title: 'Section 11 Capture Packet Archive',
          contents: ['packetArchiveHistory', 'latestCapturePacketArchive'],
        },
        runbook: [
          'Open this archive on the destination machine.',
          'Import the archive back into the project to restore packet history.',
          'Use the latest packet record as the current handoff baseline.',
        ],
        packetArchiveHistory: section11CapturePacketHistory,
        latestCapturePacketArchive,
      },
      null,
      2,
    )
    const blob = new Blob([payload], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `fluxnode-section11-capture-packet-archive-${new Date().toISOString().replace(/[:.]/g, '-')}.json`
    anchor.click()
    URL.revokeObjectURL(url)
    setProofExportStatus(`Downloaded Section 11 capture packet archive at ${new Date().toLocaleTimeString()}`)
  }
  function importSection11CoverageMap(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0] ?? null
    event.target.value = ''

    if (!file) {
      return
    }

    void file.text().then((payload) => {
      try {
        const parsed = JSON.parse(payload) as unknown
        if (!isSection11CoverageMapBundle(parsed)) {
          throw new Error('Invalid coverage map payload')
        }

        const summary = toSection11CoverageMapRecord(parsed)
        setImportedCoverageMapSummary(summary)
        saveSection11CoverageMapRecord(summary)
        setProofExportStatus(`Imported Section 11 coverage map from ${file.name}`)
      } catch {
        setProofExportStatus(`Failed to import Section 11 coverage map from ${file.name}`)
      }
    })
  }
  function importSection11CapturePacket(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0] ?? null
    event.target.value = ''

    if (!file) {
      return
    }

    void file.text().then((payload) => {
      try {
        const parsed = JSON.parse(payload) as unknown
        if (!isSection11CapturePacketBundle(parsed)) {
          throw new Error('Invalid capture packet payload')
        }

        let importedProofCount = 0
        let proofSuiteRestored = false
        let renderProofRestored = false
        if (Array.isArray(parsed.proofs)) {
          for (const proofRecord of parsed.proofs) {
            if (!proofRecord || typeof proofRecord !== 'object') {
              continue
            }

            const proof = proofRecord as Partial<Section11ProofRecord>
            if (
              typeof proof.id !== 'string' ||
              typeof proof.capturedAt !== 'string' ||
              proof.source !== 'system-panels' ||
              !Array.isArray(proof.osCoverage)
            ) {
              continue
            }

            const hydratedProof = proof as Section11ProofRecord
            if (!hydratedProof.targetProfile) {
              hydratedProof.targetProfile = buildTargetProfile(
                hydratedProof.runtimeHealth ?? runtimeHealth,
                hydratedProof.label,
              )
            }
            if (!hydratedProof.runtimeProfile) {
              hydratedProof.runtimeProfile = buildTargetProfile(
                hydratedProof.runtimeHealth ?? runtimeHealth,
                getRuntimeProfileLabel(hydratedProof.runtimeHealth ?? runtimeHealth),
              )
            }

            saveSection11ProofRecord(hydratedProof)
            importedProofCount += 1
          }
        }

        if (isSection11ProofSuiteResult(parsed.proofSuiteResult)) {
          setProofSuiteResult(parsed.proofSuiteResult)
          proofSuiteRestored = true
        }

        if (isSection11RenderProofResult(parsed.renderProofResult)) {
          setRenderProofResult(parsed.renderProofResult)
          renderProofRestored = true
        }

        if (typeof parsed.targetProfileOverride === 'string') {
          const nextTargetProfile = parsed.targetProfileOverride as Section11TargetProfile['label']
          setTargetProfileOverride(nextTargetProfile)
          setSection11TargetProfileOverride(nextTargetProfile)
        }

        let importedCoverageMapCount = 0
        if (Array.isArray(parsed.coverageMapHistory)) {
          for (const coverageRecord of parsed.coverageMapHistory) {
            if (!isSection11CoverageMapRecord(coverageRecord)) {
              continue
            }

            saveSection11CoverageMapRecord(coverageRecord)
            importedCoverageMapCount += 1
          }
        }

        if (Array.isArray(parsed.packetArchiveHistory)) {
          for (const packetRecord of parsed.packetArchiveHistory) {
            if (!isSection11CapturePacketRecord(packetRecord)) {
              continue
            }

            saveSection11CapturePacketRecord(packetRecord)
          }
        }

        setImportedCapturePacketSummary({
          bundleVersion: parsed.bundleVersion,
          bundleKind: parsed.bundleKind,
          generatedAt: parsed.generatedAt,
          manifestTitle: parsed.manifest.title,
          runbook: parsed.runbook,
          targetProfileOverride:
            typeof parsed.targetProfileOverride === 'string' ? parsed.targetProfileOverride : null,
          proofHistoryCount:
            typeof parsed.proofHistoryCount === 'number'
              ? parsed.proofHistoryCount
              : Array.isArray(parsed.proofs)
                ? parsed.proofs.length
                : section11ProofHistory.length,
          nextCaptureTargets: Array.isArray(parsed.nextCaptureTargets) ? parsed.nextCaptureTargets.length : 0,
          coverageMapHistoryCount: importedCoverageMapCount,
          proofSuiteRestored,
          renderProofRestored,
        })
        const nextPacketRecord = {
          bundleVersion: parsed.bundleVersion,
          bundleKind: parsed.bundleKind,
          generatedAt: parsed.generatedAt,
          manifestTitle: parsed.manifest.title,
          runbook: parsed.runbook,
          targetProfileOverride:
            typeof parsed.targetProfileOverride === 'string' ? parsed.targetProfileOverride : null,
          proofHistoryCount:
            typeof parsed.proofHistoryCount === 'number'
              ? parsed.proofHistoryCount
              : Array.isArray(parsed.proofs)
                ? parsed.proofs.length
                : section11ProofHistory.length,
          nextCaptureTargetsCount: Array.isArray(parsed.nextCaptureTargets) ? parsed.nextCaptureTargets.length : 0,
          coverageMapHistoryCount: importedCoverageMapCount,
          proofSuiteRestored,
          renderProofRestored,
        }
        saveSection11CapturePacketRecord(nextPacketRecord)
        setProofExportStatus(
          `Imported Section 11 capture packet from ${file.name} (${importedProofCount} proofs, ${importedCoverageMapCount} coverage maps)`,
        )
      } catch {
        setProofExportStatus(`Failed to import Section 11 capture packet from ${file.name}`)
      }
    })
  }
  function savePerformanceEvidenceSnapshot() {
    saveSection11ProofRecord(performanceEvidenceSnapshot)
    setProofExportStatus(`Saved proof snapshot to project at ${new Date().toLocaleTimeString()}`)
  }
  function clearSavedPerformanceEvidenceSnapshots() {
    clearSection11ProofHistory()
    setProofExportStatus(`Cleared saved proof snapshots at ${new Date().toLocaleTimeString()}`)
  }
  function clearSavedCoverageMapHistory() {
    clearSection11CoverageMapHistory()
    setImportedCoverageMapSummary(null)
    setProofExportStatus(`Cleared saved coverage maps at ${new Date().toLocaleTimeString()}`)
  }
  function clearImportedCapturePacketSummary() {
    setImportedCapturePacketSummary(null)
    setProofExportStatus(`Cleared imported capture packet at ${new Date().toLocaleTimeString()}`)
  }
  function importSection11ProofSnapshots(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0] ?? null
    event.target.value = ''

    if (!file) {
      return
    }

    void file.text().then((payload) => {
      try {
        const parsed = JSON.parse(payload) as unknown
        const records = Array.isArray(parsed) ? parsed : [parsed]
        let importedProofCount = 0
        let importedCoverageMapCount = 0

        for (const record of records) {
          if (!record || typeof record !== 'object') {
            continue
          }

          const bundle = record as { bundleKind?: unknown; manifest?: unknown; proofs?: unknown; coverageMapHistory?: unknown }
          if (
            bundle.bundleKind === 'section11-proof-bundle' ||
            bundle.bundleKind === 'section11-coverage-map' ||
            Array.isArray(bundle.proofs) ||
            Array.isArray(bundle.coverageMapHistory)
          ) {
            if (Array.isArray(bundle.proofs)) {
              for (const proofRecord of bundle.proofs) {
                if (!proofRecord || typeof proofRecord !== 'object') {
                  continue
                }

                const proof = proofRecord as Partial<Section11ProofRecord>
                if (
                  typeof proof.id !== 'string' ||
                  typeof proof.capturedAt !== 'string' ||
                  proof.source !== 'system-panels' ||
                  !Array.isArray(proof.osCoverage)
                ) {
                  continue
                }

                const hydratedProof = proof as Section11ProofRecord
                if (!hydratedProof.targetProfile) {
                  hydratedProof.targetProfile = buildTargetProfile(
                    hydratedProof.runtimeHealth ?? runtimeHealth,
                    hydratedProof.label,
                  )
                }
                if (!hydratedProof.runtimeProfile) {
                  hydratedProof.runtimeProfile = buildTargetProfile(
                    hydratedProof.runtimeHealth ?? runtimeHealth,
                    getRuntimeProfileLabel(hydratedProof.runtimeHealth ?? runtimeHealth),
                  )
                }

                saveSection11ProofRecord(hydratedProof)
                importedProofCount += 1
              }
            }

            if (Array.isArray(bundle.coverageMapHistory)) {
              for (const coverageRecord of bundle.coverageMapHistory) {
                if (!isSection11CoverageMapRecord(coverageRecord)) {
                  continue
                }

                saveSection11CoverageMapRecord(coverageRecord)
                importedCoverageMapCount += 1
              }
            }

            continue
          }

          const proof = record as Partial<Section11ProofRecord>
          if (
            typeof proof.id !== 'string' ||
            typeof proof.capturedAt !== 'string' ||
            proof.source !== 'system-panels' ||
            !Array.isArray(proof.osCoverage)
          ) {
            continue
          }

          const hydratedProof = proof as Section11ProofRecord
          if (!hydratedProof.targetProfile) {
            hydratedProof.targetProfile = buildTargetProfile(
              hydratedProof.runtimeHealth ?? runtimeHealth,
              hydratedProof.label,
            )
          }
          if (!hydratedProof.runtimeProfile) {
            hydratedProof.runtimeProfile = buildTargetProfile(
              hydratedProof.runtimeHealth ?? runtimeHealth,
              getRuntimeProfileLabel(hydratedProof.runtimeHealth ?? runtimeHealth),
            )
          }

          saveSection11ProofRecord(hydratedProof)
          importedProofCount += 1
        }

        setProofExportStatus(
          importedProofCount > 0 || importedCoverageMapCount > 0
            ? `Imported ${importedProofCount} proof snapshot${importedProofCount === 1 ? '' : 's'} and ${importedCoverageMapCount} coverage map${importedCoverageMapCount === 1 ? '' : 's'} at ${new Date().toLocaleTimeString()}`
            : `No compatible proof bundle found in ${file.name}`,
        )
      } catch {
        setProofExportStatus(`Failed to import proof bundle from ${file.name}`)
      }
    })
  }
  async function runSection11ProofSuite() {
    const suiteStartedAt = new Date().toISOString()
    setProofSuiteRunning(true)
    setProofExportStatus('Running Section 11 proof suite...')

    const waitForAnimationFrames = async (count: number) => {
      for (let index = 0; index < count; index += 1) {
        await new Promise<void>((resolve) => {
          window.requestAnimationFrame(() => resolve())
        })
      }
    }

    const waitForViewSwitchMetric = async (baselineMeasuredAt: string | null) => {
      const timeoutAt = window.performance.now() + 3_000
      while (window.performance.now() < timeoutAt) {
        const latestMetric = useProjectStore.getState().ui.viewSwitchMetric
        if (latestMetric.measuredAt && latestMetric.measuredAt !== baselineMeasuredAt && latestMetric.durationMs !== null) {
          return latestMetric.durationMs
        }

        await new Promise<void>((resolve) => window.setTimeout(resolve, 16))
      }

      return null
    }
    const runPanAndZoomProof = async () => {
      const panSteps: Array<[number, number]> = [
        [140, 0],
        [0, 110],
        [140, 0],
        [0, 110],
      ]
      const startedPanAt = performance.now()
      for (const [deltaX, deltaY] of panSteps) {
        panWorkflowViewport(deltaX, deltaY)
        await waitForAnimationFrames(1)
      }
      const panTraversalDurationMs = Number((performance.now() - startedPanAt).toFixed(1))

      const zoomSteps = [0.08, 0.08, -0.08, -0.08]
      const startedZoomAt = performance.now()
      for (const delta of zoomSteps) {
        adjustWorkflowZoom(delta)
        await waitForAnimationFrames(1)
      }
      const zoomSweepDurationMs = Number((performance.now() - startedZoomAt).toFixed(1))

      recordWorkflowBenchmarkMetric({
        panTraversalDurationMs,
        zoomSweepDurationMs,
        interactionMeasuredAt: new Date().toISOString(),
      })

      return {
        panTraversalDurationMs,
        zoomSweepDurationMs,
      }
    }

    try {
      createLargeCanvasBenchmarkScene()
      await waitForAnimationFrames(4)

      const fitViewSamplesMs: number[] = []
      for (let index = 0; index < 3; index += 1) {
        const startedAt = performance.now()
        fitWorkflowViewport()
        await waitForAnimationFrames(2)
        const durationMs = Number((performance.now() - startedAt).toFixed(1))
        fitViewSamplesMs.push(durationMs)
        recordWorkflowBenchmarkMetric({
          fitViewDurationMs: durationMs,
          fitViewMeasuredAt: new Date().toISOString(),
        })
        await waitForAnimationFrames(1)
      }
      const interactionProof = await runPanAndZoomProof()

      const originalView = useProjectStore.getState().ui.activeView
      const viewSwitchSamplesMs: number[] = []
      const switchSequence: Array<'timeline' | 'workflow'> = ['timeline', 'workflow', 'timeline', 'workflow']
      for (const nextView of switchSequence) {
        const baselineMeasuredAt = useProjectStore.getState().ui.viewSwitchMetric.measuredAt
        setActiveView(nextView)
        const capturedDuration = await waitForViewSwitchMetric(baselineMeasuredAt)
        if (capturedDuration !== null) {
          viewSwitchSamplesMs.push(capturedDuration)
        }
      }

      if (useProjectStore.getState().ui.activeView !== originalView) {
        const baselineMeasuredAt = useProjectStore.getState().ui.viewSwitchMetric.measuredAt
        setActiveView(originalView)
        await waitForViewSwitchMetric(baselineMeasuredAt)
      }

      const latestBenchmarkMetric = useProjectStore.getState().ui.workflowBenchmarkMetric
      const average = (samples: number[]) =>
        samples.length > 0
          ? Number((samples.reduce((sum, sample) => sum + sample, 0) / samples.length).toFixed(1))
          : null

      setProofSuiteResult({
        startedAt: suiteStartedAt,
        completedAt: new Date().toISOString(),
        viewSwitchSamplesMs,
        fitViewSamplesMs,
        panTraversalDurationMs: interactionProof.panTraversalDurationMs,
        zoomSweepDurationMs: interactionProof.zoomSweepDurationMs,
        averageViewSwitchMs: average(viewSwitchSamplesMs),
        averageFitViewMs: average(fitViewSamplesMs),
        benchmarkNodeCount: latestBenchmarkMetric.nodeCount,
        benchmarkEdgeCount: latestBenchmarkMetric.edgeCount,
      })
      saveSection11ProofRecord(
        createPersistedProofRecord({
          proofSuiteResult: {
            startedAt: suiteStartedAt,
            completedAt: new Date().toISOString(),
            viewSwitchSamplesMs,
            fitViewSamplesMs,
            panTraversalDurationMs: interactionProof.panTraversalDurationMs,
            zoomSweepDurationMs: interactionProof.zoomSweepDurationMs,
            averageViewSwitchMs: average(viewSwitchSamplesMs),
            averageFitViewMs: average(fitViewSamplesMs),
            benchmarkNodeCount: latestBenchmarkMetric.nodeCount,
            benchmarkEdgeCount: latestBenchmarkMetric.edgeCount,
          },
        }),
      )
      setProofExportStatus(`Section 11 proof suite completed at ${new Date().toLocaleTimeString()}`)
    } finally {
      setProofSuiteRunning(false)
    }
  }
  async function run4k60RenderProof() {
    const targetPreset = presets.find((preset) => preset.id === 'preset-4k60-master')

    if (!targetPreset) {
      setProofExportStatus('4K/60 proof could not start because the preset is missing.')
      setRenderProofResult({
        startedAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
        presetId: 'preset-4k60-master',
        presetName: '4K 60 Master',
        resolution: { width: 3840, height: 2160 },
        frameRate: 60,
        status: 'failed',
        outputPath: null,
        totalFrames: null,
        outputFileSize: null,
        didFallbackResolution: false,
        computeMode: null,
        audioMode: null,
        failureReason: 'Preset missing',
      })
      return
    }

    setRenderProofRunning(true)
    setProofExportStatus('Running 4K/60 render proof...')

    try {
      setActiveRenderPreset(targetPreset.id)
      await enqueueRender()

      const startedAt = new Date().toISOString()
      const timeoutAt = performance.now() + 6_000

      while (performance.now() < timeoutAt) {
        await refreshRenderStatuses()

        const latestJob = [...useProjectStore.getState().project.output.queue]
          .reverse()
          .find((job) => job.config.resolution.width === 3840 && job.config.resolution.height === 2160 && job.config.frameRate === 60)

        if (latestJob?.status === 'completed') {
          setRenderProofResult({
            startedAt,
            completedAt: new Date().toISOString(),
            presetId: targetPreset.id,
            presetName: targetPreset.name,
            resolution: { ...latestJob.config.resolution },
            frameRate: latestJob.config.frameRate,
            status: 'completed',
            outputPath: latestJob.outputPath,
            totalFrames: latestJob.totalFrames,
            outputFileSize: latestJob.outputFileSize,
            didFallbackResolution: latestJob.didFallbackResolution,
            computeMode: latestJob.computeMode,
            audioMode: latestJob.audioMode,
            failureReason: null,
          })
          saveSection11ProofRecord(
            createPersistedProofRecord({
              renderProofResult: {
                startedAt,
                completedAt: new Date().toISOString(),
                presetId: targetPreset.id,
                presetName: targetPreset.name,
                resolution: { ...latestJob.config.resolution },
                frameRate: latestJob.config.frameRate,
                status: 'completed',
                outputPath: latestJob.outputPath,
                totalFrames: latestJob.totalFrames,
                outputFileSize: latestJob.outputFileSize,
                didFallbackResolution: latestJob.didFallbackResolution,
                computeMode: latestJob.computeMode,
                audioMode: latestJob.audioMode,
                failureReason: null,
              },
            }),
          )
          setProofExportStatus(`4K/60 render proof completed at ${new Date().toLocaleTimeString()}`)
          return
        }

        if (latestJob?.status === 'failed' || latestJob?.status === 'cancelled') {
          setRenderProofResult({
            startedAt,
            completedAt: new Date().toISOString(),
            presetId: targetPreset.id,
            presetName: targetPreset.name,
            resolution: { ...latestJob.config.resolution },
            frameRate: latestJob.config.frameRate,
            status: 'failed',
            outputPath: latestJob.outputPath,
            totalFrames: latestJob.totalFrames,
            outputFileSize: latestJob.outputFileSize,
            didFallbackResolution: latestJob.didFallbackResolution,
            computeMode: latestJob.computeMode,
            audioMode: latestJob.audioMode,
            failureReason: latestJob.lastError ?? latestJob.status,
          })
          saveSection11ProofRecord(
            createPersistedProofRecord({
              renderProofResult: {
                startedAt,
                completedAt: new Date().toISOString(),
                presetId: targetPreset.id,
                presetName: targetPreset.name,
                resolution: { ...latestJob.config.resolution },
                frameRate: latestJob.config.frameRate,
                status: 'failed',
                outputPath: latestJob.outputPath,
                totalFrames: latestJob.totalFrames,
                outputFileSize: latestJob.outputFileSize,
                didFallbackResolution: latestJob.didFallbackResolution,
                computeMode: latestJob.computeMode,
                audioMode: latestJob.audioMode,
                failureReason: latestJob.lastError ?? latestJob.status,
              },
            }),
          )
          setProofExportStatus(`4K/60 render proof failed at ${new Date().toLocaleTimeString()}`)
          return
        }

        await new Promise<void>((resolve) => window.setTimeout(resolve, 150))
      }

      setRenderProofResult({
        startedAt,
        completedAt: new Date().toISOString(),
        presetId: targetPreset.id,
        presetName: targetPreset.name,
        resolution: targetPreset.resolution === 'project' ? { width: 3840, height: 2160 } : targetPreset.resolution,
        frameRate: targetPreset.frameRate === 'project' ? 60 : targetPreset.frameRate,
        status: 'timed_out',
        outputPath: null,
        totalFrames: null,
        outputFileSize: null,
        didFallbackResolution: false,
        computeMode: null,
        audioMode: null,
        failureReason: 'Timed out waiting for render completion',
      })
      saveSection11ProofRecord(
        createPersistedProofRecord({
          renderProofResult: {
            startedAt,
            completedAt: new Date().toISOString(),
            presetId: targetPreset.id,
            presetName: targetPreset.name,
            resolution: targetPreset.resolution === 'project' ? { width: 3840, height: 2160 } : targetPreset.resolution,
            frameRate: targetPreset.frameRate === 'project' ? 60 : targetPreset.frameRate,
            status: 'timed_out',
            outputPath: null,
            totalFrames: null,
            outputFileSize: null,
            didFallbackResolution: false,
            computeMode: null,
            audioMode: null,
            failureReason: 'Timed out waiting for render completion',
          },
        }),
      )
      setProofExportStatus(`4K/60 render proof timed out at ${new Date().toLocaleTimeString()}`)
    } finally {
      setRenderProofRunning(false)
    }
  }
  // `activeInspectorJobId` is the inspector's only open signal. It must not fall back to "the last
  // job with an errorCategory": this panel is `aria-modal`, and spec J.7 keeps exports out of modal
  // locks — a fallback would both pop it open on every failure and make its own Close button a
  // no-op, since setting the id back to null would re-derive the same job on the next render.
  const inspectorJob =
    activeInspectorJobId === null
      ? null
      : (queue.find((job) => job.id === activeInspectorJobId) ?? null)

  // Quota app-errors carry the failing job's id as `contextId` (project-store.ts), so the same
  // open signal addresses both halves of the dialog.
  const inspectorQuotaError =
    activeInspectorJobId === null
      ? null
      : (quotaErrors.find((error) => error.contextId === activeInspectorJobId) ?? null)

  return (
    <>
      <aside aria-label="System status and export controls" className="grid gap-4 xl:grid-cols-5">
      <section aria-label="Export queue" className="rounded-[1.5rem] border border-white/8 bg-[#151618]/90 p-4">
        <PanelHeading icon={Rocket} title="Export Queue" />
        <p aria-live="polite" className="mt-3 text-sm text-[#cbd2dc]">
          {queue.length === 0 ? 'No render jobs yet.' : `${queue.length} render job(s) tracked in the project queue.`}
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          <button type="button" onClick={enqueueRender} className="rounded-full bg-[#e0ff00] px-4 py-2 text-sm font-semibold text-black">
            Queue Render
          </button>
          <button type="button" onClick={() => void refreshRenderStatuses()} className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm text-white">
            Refresh Status
          </button>
          <button type="button" onClick={() => void pauseActiveRender()} className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm text-white">
            Pause Active
          </button>
          <button type="button" onClick={() => void resumePausedRender()} className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm text-white">
            Resume Paused
          </button>
          <button type="button" onClick={() => void cancelActiveRender()} className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm text-white">
            Cancel Active
          </button>
          <button type="button" onClick={failActiveRender} className="rounded-full border border-red-400/20 bg-red-500/10 px-4 py-2 text-sm text-red-100">
            Simulate Failure
          </button>
          <button type="button" onClick={simulateCloudNetworkFailure} className="rounded-full border border-sky-400/20 bg-sky-500/10 px-4 py-2 text-sm text-sky-100">
            Simulate Network
          </button>
          <button type="button" onClick={simulateGpuOomFailure} className="rounded-full border border-orange-400/20 bg-orange-500/10 px-4 py-2 text-sm text-orange-100">
            Simulate GPU OOM
          </button>
          <button type="button" onClick={simulateQuotaExceeded} className="rounded-full border border-blue-400/20 bg-blue-500/10 px-4 py-2 text-sm text-blue-100">
            Simulate Quota
          </button>
        </div>
        <div className="mt-4 space-y-2">
          {queue.slice(-3).reverse().map((job) => (
            <div key={job.id} className="rounded-xl border border-white/8 bg-black/20 p-3">
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-medium text-white">{job.name}</span>
                <span className="text-[11px] uppercase tracking-[0.2em] text-[#9ca3af]">{job.status}</span>
              </div>
              <p className="mt-2 text-xs text-[#9ca3af]">
                {job.config.format.container.toUpperCase()} / {job.config.format.videoCodec ?? 'no-video'} / {job.config.format.audioCodec ?? 'no-audio'} / {job.config.format.quality} - {job.computeMode}
              </p>
              <RenderJobProgress job={job} />
              <p className="mt-2 text-[11px] leading-5 text-[#9ca3af]">
                Audio {job.audioMode === 'muxed' ? 'muxed' : 'muted'} - {job.audioSourceSummary}
              </p>
              <p className="mt-2 text-[11px] leading-5 text-[#9ca3af]">
                {job.config.resolution.width}x{job.config.resolution.height} @ {job.config.frameRate} fps - Range {typeof job.config.range === 'string' ? job.config.range : `${job.config.range.start}-${job.config.range.end}`} - Denoise {job.config.denoising ? 'on' : 'off'}
              </p>
              {job.outputFileSize !== null ? (
                <p className="mt-2 text-[11px] leading-5 text-[#9ca3af]">
                  Output size {(job.outputFileSize / 1024).toFixed(0)} KB
                </p>
              ) : null}
              {job.autoRetryScheduledFor ? (
                <p className="mt-2 text-[11px] leading-5 text-[#93c5fd]">
                  Auto retry {job.retryCount}/{job.maxAutoRetries}
                  {job.autoRetryReason === 'gpu_oom' ? ' after reduced-resolution fallback' : ''}
                  {' '}scheduled for {new Date(job.autoRetryScheduledFor).toLocaleTimeString()}
                </p>
              ) : null}
              {job.didFallbackResolution ? (
                <p className="mt-2 text-[11px] leading-5 text-[#fdba74]">
                  GPU fallback active{job.originalResolution ? ` · original ${job.originalResolution.width}x${job.originalResolution.height}` : ''}.
                </p>
              ) : null}
              {job.status === 'failed' || job.status === 'cancelled' ? (
                <p className="mt-2 text-[11px] leading-5 text-[#9ca3af]">
                  {job.retryCount > 0 && job.maxAutoRetries > 0
                    ? `Auto recovery used ${job.retryCount}/${job.maxAutoRetries} attempt(s). Manual retry resumes from the last completed frame.`
                    : 'Retry resumes from the last completed frame.'}
                </p>
              ) : null}
              {job.manifestPath ? (
                <p className="mt-2 break-all text-[11px] leading-5 text-[#7f8792]">{job.manifestPath}</p>
              ) : null}
              <p className="mt-2 break-all text-[11px] leading-5 text-[#7f8792]">{job.outputPath}</p>
              {job.lastError ? (
                <p className="mt-2 text-[11px] leading-5 text-[#f9d58b]">
                  {job.errorCategory === 'cloud_quota' ? 'Quota issue' : 'Failure detail'}: {job.lastError}
                </p>
              ) : null}
              {job.failedFrame !== null ? (
                <p className="mt-2 text-[11px] leading-5 text-[#9ca3af]">
                  Failed frame {job.failedFrame}
                  {job.resumeFromFrame !== null ? ` - Resume from ${job.resumeFromFrame}` : ''}
                </p>
              ) : null}
              {job.quotaResetAt ? (
                <p className="mt-2 text-[11px] leading-5 text-[#93c5fd]">
                  Quota resets {new Date(job.quotaResetAt).toLocaleString()}
                </p>
              ) : null}
              {job.status === 'failed' || job.status === 'cancelled' ? (
                <div className="mt-3 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => setActiveInspectorJobId(job.id)}
                    className="rounded-full border border-white/10 bg-white/5 px-3 py-2 text-xs text-white"
                  >
                    Inspect Failure
                  </button>
                  {job.errorCategory !== 'cloud_quota' ? (
                  <button
                    type="button"
                    onClick={() => void retryFailedRender(job.id)}
                    className="rounded-full border border-white/10 bg-white/5 px-3 py-2 text-xs text-white"
                    disabled={Boolean(job.autoRetryScheduledFor)}
                  >
                    Retry Job
                  </button>
                ) : null}
                </div>
              ) : null}
              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => moveRenderJob(job.id, 'up')}
                  className="rounded-full border border-white/10 bg-transparent px-3 py-2 text-xs text-white/85"
                >
                  Move Up
                </button>
                <button
                  type="button"
                  onClick={() => moveRenderJob(job.id, 'down')}
                  className="rounded-full border border-white/10 bg-transparent px-3 py-2 text-xs text-white/85"
                >
                  Move Down
                </button>
                {job.status === 'completed' && canOpenPathInShell(job.outputPath) ? (
                  <button
                    type="button"
                    onClick={() => void openRenderOutput(job.id)}
                    className="rounded-full border border-emerald-400/20 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-50"
                  >
                    Open Output
                  </button>
                ) : null}
              </div>
            </div>
          ))}
        </div>
      </section>

      <section aria-label="Export preset" className="rounded-[1.5rem] border border-white/8 bg-[#151618]/90 p-4">
        <PanelHeading icon={HardDrive} title="Export Preset" />
        <div className="mt-3 space-y-2">
          {presets.map((preset) => (
            <button
              key={preset.id}
              type="button"
              onClick={() => setActiveRenderPreset(preset.id)}
              className={`w-full rounded-xl border px-3 py-3 text-left transition ${
                preset.id === activePresetId
                  ? 'border-[#e0ff00]/45 bg-[#e0ff00]/10 text-white'
                  : 'border-white/8 bg-black/20 text-[#cbd2dc]'
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-medium">{preset.name}</span>
                <span className="text-[11px] uppercase tracking-[0.2em]">{preset.format}</span>
              </div>
              <p className="mt-2 text-xs leading-5 opacity-80">
                {preset.videoCodec ?? 'no-video'} / {preset.audioCodec ?? 'no-audio'} / {preset.quality}
              </p>
            </button>
          ))}
        </div>
        {activePreset ? (
          <p className="mt-4 text-xs leading-5 text-[#9ca3af]">
            Active preset: {activePreset.name}, bitrate {activePreset.videoBitrateMbps} Mbps video / {activePreset.audioBitrateKbps} kbps audio, {activePreset.videoCodec ?? 'no video'} + {activePreset.audioCodec ?? 'no audio'} at {activePreset.quality} quality.
          </p>
        ) : null}
      </section>

      <section aria-label="Connectivity status" className="rounded-[1.5rem] border border-white/8 bg-[#151618]/90 p-4">
        <PanelHeading icon={Radio} title="Connectivity" />
        <div aria-live="polite" className="mt-4 space-y-3">
          <StatusPill label={networkStatus === 'online' ? 'Online' : 'Offline'} tone={networkStatus === 'online' ? 'ok' : 'warn'} />
          <StatusPill label={`Mode: ${performanceMode.replace('_', ' ')}`} tone={performanceMode === 'balanced' ? 'ok' : 'warn'} />
          <StatusPill label={`Backend: ${runtimeHealth.backend}`} tone={runtimeHealth.status === 'ok' ? 'ok' : 'warn'} />
          <StatusPill
            label={cloudApiKey.trim().length > 0 ? 'Cloud Auth Ready' : 'Cloud Auth Missing'}
            tone={cloudApiKey.trim().length > 0 ? 'ok' : 'warn'}
          />
          <p className="text-xs leading-5 text-[#9ca3af]">
            Cloud compute auto-falls back to local when the app goes offline, matching the resilience path described in the master plan.
          </p>
          <p className="text-xs leading-5 text-[#9ca3af]">
            {runtimeHealth.backend === 'tauri'
              ? `${runtimeHealth.os ?? 'unknown os'} / ${runtimeHealth.arch ?? 'unknown arch'} / ${runtimeHealth.cpuCores ?? '?'} cores`
              : `${runtimeHealth.cpuCores ?? '?'} browser cores detected`}
          </p>
          <p className="text-xs leading-5 text-[#9ca3af]">
            {runtimeHealth.availableMemoryGb !== null && runtimeHealth.totalMemoryGb !== null
              ? `Memory ${runtimeHealth.availableMemoryGb.toFixed(1)} GB free / ${runtimeHealth.totalMemoryGb.toFixed(1)} GB total`
              : `Device memory ${runtimeHealth.deviceMemoryGb ?? '?'} GB`}
          </p>
          <p className="text-xs leading-5 text-[#9ca3af]">
            Estimated app footprint {runtimeCacheMetrics.estimatedAppFootprintGb.toFixed(2)} GB
            {runtimeCacheMetrics.memoryPressurePct !== null
              ? ` - memory pressure ${runtimeCacheMetrics.memoryPressurePct.toFixed(1)}%`
              : ' - memory pressure pending'}
          </p>
          <p className="text-xs leading-5 text-[#9ca3af]">
            {runtimeHealth.diskFreeGb !== null && runtimeHealth.diskCapacityGb !== null
              ? `Disk ${runtimeHealth.diskFreeGb.toFixed(1)} GB free / ${runtimeHealth.diskCapacityGb.toFixed(1)} GB total`
              : 'Disk telemetry pending'}
          </p>
          <p className="text-xs leading-5 text-[#9ca3af]">
            {runtimeHealth.vramTotalGb !== null
              ? `VRAM ${runtimeHealth.vramUsedGb?.toFixed(1) ?? '?'} GB / ${runtimeHealth.vramTotalGb.toFixed(1)} GB (${runtimeHealth.vramUtilizationPct?.toFixed(1) ?? '?'}%)`
              : 'VRAM telemetry pending'}
          </p>
          {runtimeHealth.appDataDir ? (
            <p className="break-all text-xs leading-5 text-[#7f8792]">{runtimeHealth.appDataDir}</p>
          ) : null}
        </div>
      </section>

      <section aria-label="System requirement audit" className="rounded-[1.5rem] border border-white/8 bg-[#151618]/90 p-4">
        <PanelHeading icon={CheckCircle2} title="System Requirement Audit" />
        <p className="mt-3 text-xs leading-5 text-[#9ca3af]">
          This panel maps live telemetry and benchmark hooks back to the minimum-system and performance targets in Section 11 of the master plan.
        </p>
        <div className="mt-4 grid gap-3">
          {minimumSystemChecks.map((check) => (
            <div key={check.label} className="rounded-[1.1rem] border border-white/8 bg-black/20 p-3">
              <div className="flex items-center justify-between gap-3">
                <p className="text-sm font-medium text-white">{check.label}</p>
                <StatusPill label={check.tone === 'ok' ? 'Ready' : 'Needs Proof'} tone={check.tone} />
              </div>
              <p className="mt-2 text-xs leading-5 text-[#9ca3af]">{check.detail}</p>
            </div>
          ))}
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={createLargeCanvasBenchmarkScene}
            className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm text-white"
          >
            Load Canvas Benchmark
          </button>
          <button
            type="button"
            onClick={() => void runSection11ProofSuite()}
            disabled={proofSuiteRunning}
            className="rounded-full bg-[#e0ff00] px-4 py-2 text-sm font-semibold text-black disabled:cursor-not-allowed disabled:opacity-50"
          >
            {proofSuiteRunning ? 'Running Proof Suite…' : 'Run Proof Suite'}
          </button>
          <button
            type="button"
            onClick={() => void run4k60RenderProof()}
            disabled={renderProofRunning}
            className="rounded-full border border-[#f97316]/25 bg-[#f97316]/10 px-4 py-2 text-sm text-[#ffedd5] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {renderProofRunning ? 'Running 4K/60 Render…' : 'Run 4K/60 Render Proof'}
          </button>
          <button
            type="button"
            onClick={() => void copyPerformanceEvidenceSnapshot()}
            className="rounded-full border border-[#3b82f6]/25 bg-[#3b82f6]/10 px-4 py-2 text-sm text-[#dbeafe]"
          >
            Copy Proof JSON
          </button>
          <button
            type="button"
            onClick={downloadPerformanceEvidenceSnapshot}
            className="rounded-full border border-emerald-400/20 bg-emerald-500/10 px-4 py-2 text-sm text-emerald-50"
          >
            Download Proof JSON
          </button>
          <button
            type="button"
            onClick={downloadSavedProofHistory}
            disabled={section11ProofHistory.length === 0}
            className="rounded-full border border-[#a78bfa]/20 bg-[#a78bfa]/10 px-4 py-2 text-sm text-[#f5f3ff] disabled:cursor-not-allowed disabled:opacity-50"
          >
            Download Saved Proofs
          </button>
          <button
            type="button"
            onClick={downloadSection11CoverageMap}
            className="rounded-full border border-[#22c55e]/25 bg-[#22c55e]/10 px-4 py-2 text-sm text-[#dcfce7]"
          >
            Download Coverage Map
          </button>
          <button
            type="button"
            onClick={downloadSection11CapturePacket}
            className="rounded-full border border-amber-400/25 bg-amber-500/10 px-4 py-2 text-sm text-amber-50"
          >
            Download Capture Packet
          </button>
          <button
            type="button"
            onClick={downloadSection11CapturePacketArchive}
            className="rounded-full border border-amber-300/20 bg-amber-400/10 px-4 py-2 text-sm text-amber-50"
          >
            Download Packet Archive
          </button>
          <button
            type="button"
            onClick={() => capturePacketImportInputRef.current?.click()}
            className="rounded-full border border-amber-400/25 bg-amber-500/10 px-4 py-2 text-sm text-amber-50"
          >
            Import Capture Packet
          </button>
          <button
            type="button"
            onClick={() => coverageMapImportInputRef.current?.click()}
            className="rounded-full border border-[#22c55e]/25 bg-[#22c55e]/10 px-4 py-2 text-sm text-[#dcfce7]"
          >
            Import Coverage Map
          </button>
          <button
            type="button"
            onClick={savePerformanceEvidenceSnapshot}
            className="rounded-full border border-cyan-400/20 bg-cyan-500/10 px-4 py-2 text-sm text-cyan-50"
          >
            Save Proof To Project
          </button>
          <button
            type="button"
            onClick={clearSavedPerformanceEvidenceSnapshots}
            disabled={section11ProofHistory.length === 0}
            className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm text-white disabled:cursor-not-allowed disabled:opacity-50"
          >
            Clear Saved Proofs
          </button>
          <button
            type="button"
            onClick={() => proofImportInputRef.current?.click()}
            className="rounded-full border border-fuchsia-400/20 bg-fuchsia-500/10 px-4 py-2 text-sm text-fuchsia-50"
          >
            Import Proof JSON
          </button>
        </div>
        <div className="mt-4 rounded-[1rem] border border-white/8 bg-black/20 p-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-[11px] uppercase tracking-[0.22em] text-[#7f8691]">Target Profile</p>
              <p className="mt-1 text-xs leading-5 text-[#9ca3af]">
                Tag the proof with the intended machine profile before saving it into the archive.
              </p>
            </div>
            <select
              value={targetProfileOverride}
              onChange={(event) => {
                const nextValue = event.target.value as Section11TargetProfile['label']
                setTargetProfileOverride(nextValue)
                setSection11TargetProfileOverride(nextValue)
              }}
              className="min-w-[200px] rounded-full border border-white/10 bg-[#15171c] px-4 py-2 text-sm text-white outline-none"
            >
              {targetProfileOptions.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </div>
        </div>
        <input
          ref={proofImportInputRef}
          type="file"
          accept="application/json,.json"
          className="hidden"
          onChange={importSection11ProofSnapshots}
        />
        <input
          ref={coverageMapImportInputRef}
          type="file"
          accept="application/json,.json"
          className="hidden"
          onChange={importSection11CoverageMap}
        />
        <input
          ref={capturePacketImportInputRef}
          type="file"
          accept="application/json,.json"
          className="hidden"
          onChange={importSection11CapturePacket}
        />
        <p className="mt-3 text-xs leading-5 text-[#9ca3af]">
          Proof packet includes runtime health, screen telemetry, active export preset, cache pressure, latest view-switch timing, benchmark timing, and requirement-by-requirement Section 11 verdicts.
        </p>
        <div className="mt-3 rounded-[1.1rem] border border-white/8 bg-black/20 p-3">
          <div className="flex items-center justify-between gap-3">
            <p className="text-[11px] uppercase tracking-[0.22em] text-[#7f8691]">Compatibility Matrix</p>
            <p className="text-xs text-[#7f8792]">{section11ProofHistory.length} saved proof snapshot{section11ProofHistory.length === 1 ? '' : 's'}</p>
          </div>
          {latestSavedProofSummary ? (
            <div className="mt-3 rounded-[1rem] border border-white/8 bg-[#111214] p-3">
              <p className="text-[11px] uppercase tracking-[0.22em] text-[#7f8691]">Latest Saved Proof</p>
              <p className="mt-2 text-sm font-medium text-white">{latestSavedProofSummary.proofKind}</p>
              <p className="mt-2 text-xs leading-5 text-[#9ca3af]">
                {latestSavedProofSummary.readyChecks}/{latestSavedProofSummary.totalChecks} checks ready · {latestSavedProofSummary.osCoverageReady}/{latestSavedProofSummary.osCoverageTotal} OS targets ready
              </p>
              <p className="mt-1 text-xs leading-5 text-[#7f8792]">
                Captured {new Date(latestSavedProofSummary.capturedAt).toLocaleString()}
              </p>
              <p className="mt-1 text-xs leading-5 text-[#7f8792]">
                Intended {latestSavedProofSummary.targetProfile.label} · {latestSavedProofSummary.targetProfile.hardwareClass} tier
                {latestSavedProofSummary.targetProfile.os ? ` · ${latestSavedProofSummary.targetProfile.os}` : ''}
                {latestSavedProofSummary.targetProfile.osVersion ? ` ${latestSavedProofSummary.targetProfile.osVersion}` : ''}
                {latestSavedProofSummary.targetProfile.arch ? ` · ${latestSavedProofSummary.targetProfile.arch}` : ''}
              </p>
              <p className="mt-1 text-xs leading-5 text-[#7f8792]">
                Runtime {latestSavedProofSummary.runtimeProfile.label} · {latestSavedProofSummary.runtimeProfile.hardwareClass} tier
                {latestSavedProofSummary.runtimeProfile.os ? ` · ${latestSavedProofSummary.runtimeProfile.os}` : ''}
                {latestSavedProofSummary.runtimeProfile.osVersion ? ` ${latestSavedProofSummary.runtimeProfile.osVersion}` : ''}
                {latestSavedProofSummary.runtimeProfile.arch ? ` · ${latestSavedProofSummary.runtimeProfile.arch}` : ''}
              </p>
              <p className="mt-1 text-xs leading-5 text-[#7f8792]">
                Intended profile tag: {targetProfileOverride}
              </p>
              <p className="mt-1 text-xs leading-5 text-[#7f8792]">
                Hardware tiers ready: {latestSavedProofSummary.hardwareCoverageReady}/{latestSavedProofSummary.hardwareCoverageTotal}
              </p>
              <p className="mt-1 text-xs leading-5 text-[#7f8792]">
                OS + hardware combinations ready: {latestSavedProofSummary.combinedCoverageReady}/{latestSavedProofSummary.combinedCoverageTotal}
              </p>
            </div>
          ) : null}
          <div className="mt-3 grid gap-3 md:grid-cols-2">
            {section11CoverageMatrix.map((target) => (
              <div key={target.id} className="rounded-[1rem] border border-white/8 bg-[#111214] p-3">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-sm font-medium text-white">{target.label}</p>
                  <StatusPill label={target.status === 'ready' ? 'Ready' : 'Needs Proof'} tone={target.status === 'ready' ? 'ok' : 'warn'} />
                </div>
                <p className="mt-2 text-xs leading-5 text-[#9ca3af]">{target.detail}</p>
                <p className="mt-2 text-xs leading-5 text-[#7f8792]">
                  {target.latestProof
                    ? `${target.latestProof.label} - ${new Date(target.latestProof.capturedAt).toLocaleString()}`
                    : 'Capture and save a proof snapshot on the matching target machine.'}
                </p>
              </div>
            ))}
          </div>
          <div className="mt-3 grid gap-3 md:grid-cols-3">
            {section11HardwareCoverageMatrix.map((target) => (
              <div key={target.id} className="rounded-[1rem] border border-white/8 bg-[#111214] p-3">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-sm font-medium text-white">{target.label}</p>
                  <StatusPill label={target.status === 'ready' ? 'Ready' : 'Needs Proof'} tone={target.status === 'ready' ? 'ok' : 'warn'} />
                </div>
                <p className="mt-2 text-xs leading-5 text-[#9ca3af]">{target.detail}</p>
                <p className="mt-2 text-xs leading-5 text-[#7f8792]">
                  {target.latestProof
                    ? `${target.latestProof.label} - ${new Date(target.latestProof.capturedAt).toLocaleString()}`
                    : 'Capture and save a proof snapshot on the matching hardware tier.'}
                </p>
              </div>
            ))}
          </div>
          <div className="mt-3 rounded-[1rem] border border-white/8 bg-[#111214] p-3">
            <div className="flex items-center justify-between gap-3">
              <p className="text-[11px] uppercase tracking-[0.22em] text-[#7f8691]">Combined OS + Hardware Coverage</p>
              <p className="text-xs text-[#7f8792]">{section11CombinedCoverageMatrix.length} cells</p>
            </div>
            <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {section11CombinedCoverageMatrix.map((cell) => (
                <div key={`${cell.osTargetId}-${cell.hardwareTargetId}`} className="rounded-[1rem] border border-white/8 bg-black/20 p-3">
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-sm font-medium text-white">{cell.label}</p>
                    <StatusPill label={cell.status === 'ready' ? 'Ready' : 'Needs Proof'} tone={cell.status === 'ready' ? 'ok' : 'warn'} />
                  </div>
                  <p className="mt-2 text-xs leading-5 text-[#9ca3af]">{cell.detail}</p>
                  <p className="mt-2 text-xs leading-5 text-[#7f8792]">
                    {cell.latestProof
                      ? `${cell.latestProof.label} - ${new Date(cell.latestProof.capturedAt).toLocaleString()}`
                      : 'No captured proof yet.'}
                  </p>
                </div>
              ))}
            </div>
          </div>
          <div className="mt-3 rounded-[1rem] border border-white/8 bg-black/20 p-3">
            <div className="flex items-center justify-between gap-3">
              <p className="text-[11px] uppercase tracking-[0.22em] text-[#7f8691]">Next Capture Targets</p>
              <p className="text-xs text-[#7f8792]">{section11RecommendedProofTargets.length} suggested</p>
            </div>
            {section11RecommendedProofTargets.length > 0 ? (
              <div className="mt-3 grid gap-3 md:grid-cols-2">
                {section11RecommendedProofTargets.map((target) => (
                  <div key={`${target.osTargetId}-${target.hardwareTargetId}`} className="rounded-[1rem] border border-white/8 bg-[#111214] p-3">
                    <p className="text-sm font-medium text-white">{target.label}</p>
                    <p className="mt-2 text-xs leading-5 text-[#9ca3af]">{target.detail}</p>
                    <p className="mt-2 text-xs leading-5 text-[#7f8792]">
                      Capture on the matching OS and hardware tier, then save the proof snapshot back into the project.
                    </p>
                  </div>
                ))}
              </div>
            ) : (
              <p className="mt-3 text-xs leading-5 text-[#9ca3af]">
                Every current OS and hardware combination has at least one saved proof snapshot.
              </p>
            )}
          </div>
          {latestCoverageMapSummary ? (
            <div className="mt-3 rounded-[1rem] border border-white/8 bg-[#111214] p-3">
              <p className="text-[11px] uppercase tracking-[0.22em] text-[#7f8691]">Imported Coverage Map</p>
              <p className="mt-1 text-xs leading-5 text-[#7f8792]">
                {latestCoverageMapSummary.bundleKind} · v{latestCoverageMapSummary.bundleVersion} · {latestCoverageMapSummary.manifestTitle}
              </p>
              <p className="mt-1 text-xs leading-5 text-[#7f8792]">
                Manifest fields: {latestCoverageMapSummary.manifestContents.join(', ')}
              </p>
              <p className="mt-2 text-xs leading-5 text-[#9ca3af]">
                Imported {latestCoverageMapSummary.osCoverageCount} OS targets, {latestCoverageMapSummary.hardwareCoverageCount} hardware tiers, {latestCoverageMapSummary.combinedCoverageCount} combined cells.
              </p>
              <p className="mt-1 text-xs leading-5 text-[#7f8792]">
                Suggested next captures: {latestCoverageMapSummary.recommendedCount}
              </p>
              <p className="mt-1 text-xs leading-5 text-[#7f8792]">
                Generated {new Date(latestCoverageMapSummary.generatedAt).toLocaleString()}
              </p>
            </div>
          ) : null}
          {importedCapturePacketSummary ? (
            <div className="mt-3 rounded-[1rem] border border-amber-400/15 bg-amber-500/10 p-3">
              <div className="flex items-center justify-between gap-3">
                <p className="text-[11px] uppercase tracking-[0.22em] text-amber-100">Imported Capture Packet</p>
                <button
                  type="button"
                  onClick={clearImportedCapturePacketSummary}
                  className="rounded-full border border-amber-300/20 bg-amber-400/10 px-3 py-1 text-[11px] text-amber-50"
                >
                  Clear Packet
                </button>
              </div>
              <p className="mt-1 text-xs leading-5 text-amber-50/90">
                {importedCapturePacketSummary.bundleKind} · v{importedCapturePacketSummary.bundleVersion} · {importedCapturePacketSummary.manifestTitle}
              </p>
              <p className="mt-1 text-xs leading-5 text-amber-50/80">
                Runbook: {importedCapturePacketSummary.runbook.join(' · ')}
              </p>
              <p className="mt-1 text-xs leading-5 text-amber-50/80">
                Targets suggested: {importedCapturePacketSummary.nextCaptureTargets} · coverage archive cells: {importedCapturePacketSummary.coverageMapHistoryCount}
              </p>
              <p className="mt-1 text-xs leading-5 text-amber-50/80">
                Proof snapshots in source packet: {importedCapturePacketSummary.proofHistoryCount}
              </p>
              <p className="mt-1 text-xs leading-5 text-amber-50/80">
                Proof suite restored: {importedCapturePacketSummary.proofSuiteRestored ? 'yes' : 'no'} · 4K/60 render restored: {importedCapturePacketSummary.renderProofRestored ? 'yes' : 'no'}
              </p>
              <p className="mt-1 text-xs leading-5 text-amber-50/80">
                Intended profile tag: {importedCapturePacketSummary.targetProfileOverride ?? 'unspecified'}
              </p>
              <p className="mt-1 text-xs leading-5 text-amber-50/70">
                Imported {new Date(importedCapturePacketSummary.generatedAt).toLocaleString()}
              </p>
            </div>
          ) : null}
          {latestCapturePacketArchive ? (
            <div className="mt-3 rounded-[1rem] border border-amber-300/10 bg-black/20 p-3">
              <div className="flex items-center justify-between gap-3">
                <p className="text-[11px] uppercase tracking-[0.22em] text-[#7f8691]">Archived Capture Packets</p>
                <button
                  type="button"
                  onClick={clearSection11CapturePacketHistory}
                  className="rounded-full border border-amber-300/15 bg-amber-400/10 px-3 py-1 text-[11px] text-amber-50"
                >
                  Clear Packets
                </button>
              </div>
              <p className="mt-1 text-xs leading-5 text-[#9ca3af]">
                {section11CapturePacketHistory.length} packet{section11CapturePacketHistory.length === 1 ? '' : 's'} archived in project metadata
              </p>
              <p className="mt-1 text-xs leading-5 text-[#7f8792]">
                Latest {latestCapturePacketArchive.manifestTitle} · {new Date(latestCapturePacketArchive.generatedAt).toLocaleString()}
              </p>
              <p className="mt-1 text-xs leading-5 text-[#7f8792]">
                Proofs {latestCapturePacketArchive.proofHistoryCount} · maps {latestCapturePacketArchive.coverageMapHistoryCount} · target {latestCapturePacketArchive.targetProfileOverride ?? 'unspecified'}
              </p>
            </div>
          ) : null}
        </div>
        {proofSuiteResult ? (
          <div className="mt-3 rounded-[1.1rem] border border-white/8 bg-black/20 p-3">
            <p className="text-[11px] uppercase tracking-[0.22em] text-[#7f8691]">Proof Suite Summary</p>
            <p className="mt-2 text-xs leading-5 text-[#9ca3af]">
              View switch samples: {proofSuiteResult.viewSwitchSamplesMs.length > 0 ? proofSuiteResult.viewSwitchSamplesMs.map((sample) => `${sample.toFixed(1)} ms`).join(', ') : 'none'}
            </p>
            <p className="mt-2 text-xs leading-5 text-[#9ca3af]">
              Fit-view samples: {proofSuiteResult.fitViewSamplesMs.length > 0 ? proofSuiteResult.fitViewSamplesMs.map((sample) => `${sample.toFixed(1)} ms`).join(', ') : 'none'}
            </p>
            <p className="mt-2 text-xs leading-5 text-[#9ca3af]">
              Pan traversal {proofSuiteResult.panTraversalDurationMs?.toFixed(1) ?? '?'} ms / Zoom sweep {proofSuiteResult.zoomSweepDurationMs?.toFixed(1) ?? '?'} ms
            </p>
            <p className="mt-2 text-xs leading-5 text-[#9ca3af]">
              Average switch {proofSuiteResult.averageViewSwitchMs?.toFixed(1) ?? '?'} ms / Average fit view {proofSuiteResult.averageFitViewMs?.toFixed(1) ?? '?'} ms on {proofSuiteResult.benchmarkNodeCount} nodes and {proofSuiteResult.benchmarkEdgeCount} edges.
            </p>
          </div>
        ) : null}
        {renderProofResult ? (
          <div className="mt-3 rounded-[1.1rem] border border-white/8 bg-black/20 p-3">
            <p className="text-[11px] uppercase tracking-[0.22em] text-[#7f8691]">4K/60 Render Proof</p>
            <p className="mt-2 text-xs leading-5 text-[#9ca3af]">
              {renderProofResult.presetName}: {renderProofResult.resolution.width}x{renderProofResult.resolution.height} @ {renderProofResult.frameRate} fps
            </p>
            <p className="mt-2 text-xs leading-5 text-[#9ca3af]">
              Status {renderProofResult.status}
              {renderProofResult.computeMode ? ` / ${renderProofResult.computeMode}` : ''}
              {renderProofResult.audioMode ? ` / ${renderProofResult.audioMode}` : ''}
              {renderProofResult.outputFileSize !== null ? ` / ${(renderProofResult.outputFileSize / 1024).toFixed(0)} KB` : ''}
            </p>
            <p className="mt-2 break-all text-xs leading-5 text-[#9ca3af]">
              {renderProofResult.outputPath ?? renderProofResult.failureReason ?? 'No output path recorded.'}
            </p>
          </div>
        ) : null}
        <p aria-live="polite" className="mt-2 text-xs leading-5 text-[#7f8792]">{proofExportStatus ?? ''}</p>
        <p className="mt-2 text-xs leading-5 text-[#7f8792]">
          Archived coverage maps: {section11CoverageMapHistory.length}
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={clearSavedCoverageMapHistory}
            disabled={section11CoverageMapHistory.length === 0}
            className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm text-white disabled:cursor-not-allowed disabled:opacity-50"
          >
            Clear Coverage Maps
          </button>
        </div>
      </section>

      <section aria-label="App updates" className="rounded-[1.5rem] border border-white/8 bg-[#151618]/90 p-4">
        <PanelHeading icon={RefreshCcw} title="App Updates" />
        <div className="mt-4 space-y-3">
          <StatusPill
            label={
              appUpdateState.status === 'update-available'
                ? 'Update Available'
                : appUpdateState.status === 'up-to-date'
                  ? 'Up To Date'
                  : appUpdateState.status === 'checking'
                    ? 'Checking'
                    : appUpdateState.status === 'error'
                      ? 'Update Error'
                      : 'Manual Check'
            }
            tone={appUpdateState.status === 'error' ? 'warn' : 'ok'}
          />
          <p className="text-xs leading-5 text-[#9ca3af]">
            Current version {appUpdateState.versionInfo.currentVersion} on the {appUpdateState.versionInfo.backend} runtime.
          </p>
          <p className="text-xs leading-5 text-[#9ca3af]">
            {appUpdateState.lastCheckedAt
              ? `Last checked ${new Date(appUpdateState.lastCheckedAt).toLocaleString()}`
              : 'No update check has been run yet.'}
          </p>
          <p className="text-xs leading-5 text-[#9ca3af]">
            {updateManifestUrl
              ? `Manifest ${updateManifestUrl}`
              : 'Set an update manifest URL in Settings to enable manual update checks.'}
          </p>
          {appUpdateState.latestVersion ? (
            <p className="text-xs leading-5 text-[#9ca3af]">
              Latest published version {appUpdateState.latestVersion}
              {appUpdateState.publishedAt ? ` - ${new Date(appUpdateState.publishedAt).toLocaleString()}` : ''}
            </p>
          ) : null}
          {appUpdateState.notes ? (
            <p className="rounded-xl border border-white/8 bg-black/20 p-3 text-xs leading-5 text-[#cbd2dc]">
              {appUpdateState.notes}
            </p>
          ) : null}
          {appUpdateState.downloadedFilePath ? (
            <p className="break-all text-xs leading-5 text-[#7f8792]">{appUpdateState.downloadedFilePath}</p>
          ) : null}
          {appUpdateState.errorMessage ? (
            <p className="rounded-xl border border-amber-300/20 bg-amber-500/10 p-3 text-xs leading-5 text-amber-50">
              {appUpdateState.errorMessage}
            </p>
          ) : null}
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => void checkForAppUpdates()}
            disabled={networkStatus === 'offline' || appUpdateState.status === 'checking'}
            className="rounded-full bg-[#e0ff00] px-4 py-2 text-sm font-semibold text-black disabled:cursor-not-allowed disabled:opacity-50"
          >
            Check Now
          </button>
          <button
            type="button"
            onClick={() => void downloadAppUpdate()}
            disabled={!appUpdateState.downloadUrl || appUpdateState.downloadStatus === 'downloading'}
            className="rounded-full border border-[#3b82f6]/25 bg-[#3b82f6]/10 px-4 py-2 text-sm text-[#dbeafe] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {appUpdateState.downloadStatus === 'downloading' ? 'Downloading…' : appUpdateState.downloadedFilePath ? 'Download Again' : 'Download Update'}
          </button>
          <button
            type="button"
            onClick={() => void installDownloadedAppUpdate()}
            disabled={!appUpdateState.downloadedFilePath}
            className="rounded-full border border-emerald-400/20 bg-emerald-500/10 px-4 py-2 text-sm text-emerald-50 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Install Update
          </button>
          <button
            type="button"
            onClick={() => void openUpdateDownload()}
            disabled={!appUpdateState.downloadUrl && !appUpdateState.downloadedFilePath}
            className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm text-white disabled:cursor-not-allowed disabled:opacity-50"
          >
            {appUpdateState.downloadedFilePath ? 'Open Package' : 'Open Download'}
          </button>
        </div>
      </section>

      <section aria-label="Workspace sharing" className="rounded-[1.5rem] border border-white/8 bg-[#151618]/90 p-4">
        <PanelHeading icon={Users} title="Workspace Sync" />
        <div className="mt-4 space-y-3">
          <StatusPill label={workspaceSharing.enabled ? 'Sharing Enabled' : 'Private Workspace'} tone={workspaceSharing.enabled ? 'ok' : 'warn'} />
          <p className="text-xs leading-5 text-[#9ca3af]">
            Access {workspaceSharing.accessLevel.replace('_', ' ')} with {workspaceSharing.collaborators.length} collaborator{workspaceSharing.collaborators.length === 1 ? '' : 's'} and {workspaceSharing.invites.filter((invite) => invite.status === 'pending').length} pending invite{workspaceSharing.invites.filter((invite) => invite.status === 'pending').length === 1 ? '' : 's'}.
          </p>
          <p className="text-xs leading-5 text-[#9ca3af]">
            {workspaceSharing.lastSyncedAt
              ? `Last workspace sync ${new Date(workspaceSharing.lastSyncedAt).toLocaleString()}`
              : 'Workspace sync has not run yet.'}
          </p>
          <p className="text-xs leading-5 text-[#9ca3af]">
            {workspaceSyncConflicts.length === 0
              ? 'No co-edit conflicts queued.'
              : `${workspaceSyncConflicts.length} co-edit conflict${workspaceSyncConflicts.length === 1 ? '' : 's'} queued for review.`}
          </p>
          <p className="break-all text-xs leading-5 text-[#7f8792]">
            {workspaceSharing.shareLink ?? 'Enable sharing to create a workspace link.'}
          </p>
        </div>
        <button
          type="button"
          onClick={openWorkspaceSharing}
          className="mt-4 rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm text-white"
        >
          Manage Workspace
        </button>
      </section>

      <section aria-label="Audio and runtime issues" className="rounded-[1.5rem] border border-white/8 bg-[#151618]/90 p-4">
        <PanelHeading icon={Volume2} title="Audio + Errors" />
        <p className="mt-3 text-xs leading-5 text-[#9ca3af]">
          Master volume {(audio.masterVolume * 100).toFixed(0)}% - Scrub {audio.scrubEnabled ? 'on' : 'off'} - Waveform {audio.waveformDensity}
          {scrubPreviewState.active
            ? ` - ${scrubPreviewState.mode} ${scrubPreviewState.speed.toFixed(2)}x`
            : ''}
        </p>
        <p className="mt-2 text-xs leading-5 text-[#9ca3af]">
          Device memory {runtimeHealth.deviceMemoryGb ?? '?'} GB - Last health check {runtimeHealth.lastCheckedAt ? new Date(runtimeHealth.lastCheckedAt).toLocaleTimeString() : 'pending'}
        </p>
        <div className="mt-4 rounded-[1.25rem] border border-white/8 bg-black/20 p-3">
          <p className="text-[11px] uppercase tracking-[0.22em] text-[#7f8691]">Live Mix</p>
          <p className="mt-2 text-sm text-white">
            {audibleTracks.length} audible audio track{audibleTracks.length === 1 ? '' : 's'} / {audibleClipCount} clip{audibleClipCount === 1 ? '' : 's'}
          </p>
          <p className="mt-2 text-xs leading-5 text-[#9ca3af]">
            {soloTracks.length > 0
              ? `${soloTracks.length} track${soloTracks.length === 1 ? '' : 's'} in solo mode`
              : 'No solo tracks active'}
            {' - '}
            {tracks.filter((track) => track.muted).length} muted track{tracks.filter((track) => track.muted).length === 1 ? '' : 's'}
          </p>
          <p className="mt-2 text-xs leading-5 text-[#9ca3af]">
            Aggregate track gain {weightedTrackGain.toFixed(2)}x - Average pan {averagePan.toFixed(2)}
          </p>
        </div>
        <div className="mt-4 space-y-3 rounded-[1.25rem] border border-white/8 bg-black/20 p-3">
          <label className="block text-[11px] uppercase tracking-[0.22em] text-[#7f8691]">
            Master Volume
          </label>
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={audio.masterVolume}
            onChange={(event) => setMasterVolume(Number(event.target.value))}
            aria-label="Master volume"
            className="w-full accent-[#e0ff00]"
          />
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={toggleScrubEnabled} aria-pressed={audio.scrubEnabled} className="rounded-full border border-white/10 bg-white/5 px-3 py-2 text-xs text-white">
              Scrub {audio.scrubEnabled ? 'On' : 'Off'}
            </button>
            <button type="button" onClick={cycleWaveformDensity} className="rounded-full border border-white/10 bg-white/5 px-3 py-2 text-xs text-white">
              Waveform {audio.waveformDensity}
            </button>
          </div>
        </div>
        <div className="mt-4 rounded-[1.25rem] border border-white/8 bg-black/20 p-3">
          <p className="text-[11px] uppercase tracking-[0.22em] text-[#7f8691]">Runtime Cache</p>
          <p className="mt-2 text-xs leading-5 text-[#9ca3af]">
            Preview {previewFrameCount} - Node {nodePreviewCount} - Waveform {waveformCacheCount} - Thumbnails {assetThumbnailCount} - Approx {runtimeCacheMetrics.estimatedUsageMb.toFixed(1)} MB
          </p>
          <p className="mt-2 text-xs leading-5 text-[#9ca3af]">
            {runtimeCacheMetrics.hardLimitExceeded
              ? 'Hard memory limit reached: new preview and waveform allocations are paused.'
              : runtimeCacheMetrics.softLimitExceeded
                ? 'Soft memory limit reached: FluxNode is evicting old cache entries.'
                : 'Memory budget is within the balanced operating range.'}
          </p>
          <button type="button" onClick={clearRuntimeCaches} className="mt-3 rounded-full border border-white/10 bg-white/5 px-3 py-2 text-xs text-white">
            Clear Caches
          </button>
        </div>
        <div className="mt-4 rounded-[1.25rem] border border-white/8 bg-black/20 p-3">
          <p className="text-[11px] uppercase tracking-[0.22em] text-[#7f8691]">View Switch Telemetry</p>
          <p className="mt-2 text-xs leading-5 text-[#9ca3af]">
            {viewSwitchMetric.durationMs !== null && viewSwitchMetric.fromView && viewSwitchMetric.toView
              ? `${viewSwitchMetric.fromView} -> ${viewSwitchMetric.toView} in ${viewSwitchMetric.durationMs.toFixed(1)} ms`
              : 'Switch between Timeline and Workflow to capture latency.'}
          </p>
          <p className="mt-2 text-xs leading-5 text-[#9ca3af]">
            {viewSwitchMetric.measuredAt
              ? `Last measured ${new Date(viewSwitchMetric.measuredAt).toLocaleTimeString()}`
              : 'No runtime measurement captured yet.'}
          </p>
        </div>
        <div className="mt-4 space-y-2">
          {errors.length === 0 ? (
            <div className="rounded-xl border border-emerald-400/15 bg-emerald-500/10 p-3 text-sm text-emerald-50">
              No active resilience issues.
            </div>
          ) : (
            errors.slice(-3).reverse().map((error) => (
              <div
                key={error.id}
                className={`rounded-xl border p-3 text-sm ${
                  error.recoverable
                    ? 'border-amber-300/20 bg-amber-500/10 text-amber-50'
                    : 'border-red-400/20 bg-red-500/10 text-red-100'
                }`}
              >
                <p className="font-medium">{error.userMessage}</p>
                <p className="mt-1 text-[10px] uppercase tracking-[0.18em] opacity-70">{error.category}</p>
                <p className="mt-1 text-xs opacity-80">{error.suggestedAction}</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  {error.actionLabel && error.actionCommand ? (
                    <button
                      type="button"
                      onClick={() => void performAppErrorAction(error.id)}
                      className="rounded-full border border-white/10 bg-white/10 px-3 py-2 text-xs text-white"
                    >
                      {error.actionLabel}
                    </button>
                  ) : null}
                  {(error.category === 'cloud_quota' || error.category === 'render_failed') && error.contextId ? (
                    <button
                      type="button"
                      onClick={() => setActiveInspectorJobId(error.contextId ?? null)}
                      className="rounded-full border border-white/10 bg-transparent px-3 py-2 text-xs text-white/85"
                    >
                      Inspect
                    </button>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => dismissAppError(error.id)}
                    className="rounded-full border border-white/10 bg-transparent px-3 py-2 text-xs text-white/85"
                  >
                    Dismiss
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
        <button type="button" onClick={clearResolvedErrors} className="mt-4 rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm text-white">
          Clear Resolved
        </button>
      </section>
      </aside>
      {inspectorJob || inspectorQuotaError ? (
        <FailureInspectorModal
          job={inspectorJob}
          quotaError={inspectorQuotaError}
          onClose={() => setActiveInspectorJobId(null)}
          onRetry={(jobId) => void retryFailedRender(jobId)}
          onResolveQuota={(errorId) => void performAppErrorAction(errorId)}
        />
      ) : null}
    </>
  )
}

function PanelHeading({
  icon: Icon,
  title,
}: {
  icon: React.ComponentType<{ size?: number; className?: string }>
  title: string
}) {
  return (
    <div className="flex items-center gap-3">
      <Icon size={18} className="text-[#e0ff00]" />
      <h3 className="text-sm font-semibold uppercase tracking-[0.2em] text-white">{title}</h3>
    </div>
  )
}

function StatusPill({ label, tone }: { label: string; tone: 'ok' | 'warn' }) {
  const Icon = tone === 'ok' ? CheckCircle2 : AlertTriangle
  const classes =
    tone === 'ok'
      ? 'border-emerald-400/20 bg-emerald-500/10 text-emerald-50'
      : 'border-amber-300/20 bg-amber-500/10 text-amber-50'

  return (
    <div className={`inline-flex items-center gap-2 rounded-full border px-3 py-2 text-xs uppercase tracking-[0.2em] ${classes}`}>
      <Icon size={14} />
      {label}
    </div>
  )
}

function FailureInspectorModal({
  job,
  quotaError,
  onClose,
  onRetry,
  onResolveQuota,
}: {
  job: ReturnType<typeof useProjectStore.getState>['project']['output']['queue'][number] | null
  quotaError: ReturnType<typeof useProjectStore.getState>['appErrors'][number] | null
  onClose: () => void
  onRetry: (jobId: string) => void
  onResolveQuota: (errorId: string) => void
}) {
  const isOpen = Boolean(job || quotaError)
  const dialogRef = useModalA11y<HTMLElement>(isOpen)

  useEffect(() => {
    if (!isOpen) {
      return
    }

    function handleEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.preventDefault()
        onClose()
      }
    }

    window.addEventListener('keydown', handleEscape)
    return () => window.removeEventListener('keydown', handleEscape)
  }, [isOpen, onClose])

  if (!isOpen) {
    return null
  }

  return (
    <div className="absolute inset-0 z-40 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
      <section
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="failure-inspector-title"
        tabIndex={-1}
        className="w-full max-w-2xl rounded-[1.75rem] border border-white/10 bg-[#111214] p-5 shadow-[0_30px_120px_rgba(0,0,0,0.55)] outline-none"
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-[11px] uppercase tracking-[0.28em] text-[#7f8691]">
              {job?.errorCategory === 'cloud_quota' || quotaError ? 'Cloud Quota' : 'Render Failure'}
            </p>
            <h3 id="failure-inspector-title" className="mt-2 text-2xl font-semibold text-white">
              {job?.name ?? 'Render issue'} inspector
            </h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close failure inspector"
            className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-white/10 bg-white/5 text-white"
          >
            <X size={16} />
          </button>
        </div>
        {job ? (
          <div className="mt-4 grid gap-3 md:grid-cols-2">
            <InspectorCard label="Status" value={`${job.status} / ${job.errorCategory ?? 'n/a'}`} />
            <InspectorCard label="Frames" value={`${job.currentFrame}/${job.totalFrames}`} />
            <InspectorCard label="Failed Frame" value={job.failedFrame !== null ? String(job.failedFrame) : 'n/a'} />
            <InspectorCard label="Resume From" value={job.resumeFromFrame !== null ? String(job.resumeFromFrame) : 'n/a'} />
          </div>
        ) : null}
        {job?.lastError ? (
          <div className="mt-4 rounded-[1.25rem] border border-amber-300/20 bg-amber-500/10 p-4 text-sm text-amber-50">
            {job.lastError}
          </div>
        ) : null}
        {job?.quotaUsageSummary || quotaError ? (
          <div className="mt-4 rounded-[1.25rem] border border-blue-400/20 bg-blue-500/10 p-4 text-sm text-blue-50">
            <p>{job?.quotaUsageSummary ?? quotaError?.suggestedAction ?? 'Quota summary unavailable.'}</p>
            <p className="mt-2 text-xs opacity-80">
              Reset time:{' '}
              {job?.quotaResetAt
                ? new Date(job.quotaResetAt).toLocaleString()
                : quotaError?.resetAt
                  ? new Date(quotaError.resetAt).toLocaleString()
                  : 'pending'}
            </p>
          </div>
        ) : null}
        <div className="mt-5 flex flex-wrap gap-2">
          {job && job.errorCategory !== 'cloud_quota' ? (
            <button
              type="button"
              onClick={() => onRetry(job.id)}
              className="rounded-full bg-[#e0ff00] px-4 py-2 text-sm font-semibold text-black"
            >
              Retry from failed frame
            </button>
          ) : null}
          {quotaError ? (
            <button
              type="button"
              onClick={() => onResolveQuota(quotaError.id)}
              className="rounded-full bg-[#3b82f6] px-4 py-2 text-sm font-semibold text-white"
            >
              {quotaError.actionLabel ?? 'Resolve quota'}
            </button>
          ) : null}
          <button
            type="button"
            onClick={onClose}
            className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm text-white"
          >
            Close
          </button>
        </div>
      </section>
    </div>
  )
}

function InspectorCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[1.25rem] border border-white/8 bg-black/20 p-4">
      <p className="text-[11px] uppercase tracking-[0.22em] text-[#7f8691]">{label}</p>
      <p className="mt-3 text-sm leading-6 text-white">{value}</p>
    </div>
  )
}
