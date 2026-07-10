import { CheckCircle2 } from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react'
import type {
  Section11CoverageCell,
  Section11CoverageTarget,
  Section11HardwareCoverageTarget,
  Section11ProofCheck,
  Section11ProofRecord,
  Section11ProofSuiteResult,
  Section11RenderProofResult,
  Section11TargetProfile,
} from '../../domain/project/types'
import { useProjectStore } from '../../store/project-store'
import { PanelHeading, StatusPill } from '../status/shared/PanelPrimitives'
import {
  buildOsCoverageTargets,
  buildTargetProfile,
  getDefaultTargetProfileLabel,
  getOsTargetVerdict,
  getRuntimeProfileLabel,
  isSection11CapturePacketBundle,
  isSection11CapturePacketRecord,
  isSection11CoverageMapBundle,
  isSection11CoverageMapRecord,
  isSection11ProofSuiteResult,
  isSection11RenderProofResult,
  toSection11CoverageMapRecord,
} from './diagnosticsHelpers'

/**
 * MERIDIAN item 9: the "System requirement audit" / Section 11 proof tooling, relocated from
 * `SystemPanels.tsx` behind a dedicated Diagnostics surface (item-9 destination map: "developer/QA
 * proof tooling from the masterplan, not user workflow — does NOT belong on the main surface").
 * Reachable from Settings (mounted inside `SettingsModal`) and from the command palette via the
 * existing "Open Settings" command (`Ctrl+,`) — this panel doesn't need its own separate command
 * since Settings IS its container; see the item-9 report for the full reasoning.
 *
 * Content, state, and every button/action below are moved VERBATIM from the pre-item-9
 * `SystemPanels.tsx` — this is a relocation, not a redesign (item-9 brief: "nothing is deleted").
 */
export function DiagnosticsPanel() {
  const targetProfileOptions = ['Browser', 'Windows 10+', 'Windows 11', 'macOS 12+', 'Ubuntu 22.04+'] as const
  const runtimeHealth = useProjectStore((state) => state.runtimeHealth)
  const section11ProofHistory = useProjectStore((state) => state.project.meta.section11ProofHistory)
  const section11CoverageMapHistory = useProjectStore((state) => state.project.meta.section11CoverageMapHistory)
  const section11CapturePacketHistory = useProjectStore((state) => state.project.meta.section11CapturePacketHistory)
  const section11TargetProfileOverride = useProjectStore((state) => state.project.meta.section11TargetProfileOverride)
  const appUpdateState = useProjectStore((state) => state.appUpdateState)
  const runtimeCacheMetrics = useProjectStore((state) => state.runtimeCacheMetrics)
  const presets = useProjectStore((state) => state.project.output.presets)
  const activePresetId = useProjectStore((state) => state.project.output.activePresetId)
  const viewSwitchMetric = useProjectStore((state) => state.ui.viewSwitchMetric)
  const workflowBenchmarkMetric = useProjectStore((state) => state.ui.workflowBenchmarkMetric)
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
  const setActiveRenderPreset = useProjectStore((state) => state.setActiveRenderPreset)

  const activePreset = presets.find((preset) => preset.id === activePresetId) ?? presets[0]
  const osTargetVerdict = getOsTargetVerdict(runtimeHealth)

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

  return (
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
  )
}
