/**
 * MERIDIAN item 9: relocated verbatim (dependency-free — no React, no Zustand) from the top of the
 * pre-item-9 `SystemPanels.tsx`. Backs the Diagnostics surface's Section 11 proof tooling
 * (`DiagnosticsPanel.tsx`), moved behind Settings + a palette verb per the item-9 destination map
 * ("developer/QA proof tooling from the masterplan, not user workflow — does NOT belong on the
 * main surface").
 */
import type {
  RuntimeHealth,
  Section11CoverageMapRecord,
  Section11CoverageTarget,
  Section11CapturePacketRecord,
  Section11ProofCheck,
  Section11ProofSuiteResult,
  Section11RenderProofResult,
  Section11TargetProfile,
} from '../../domain/project/types'

export function getOsTargetVerdict(runtimeHealth: RuntimeHealth) {
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

export function buildOsCoverageTargets(runtimeHealth: RuntimeHealth, checks: Section11ProofCheck[]): Section11CoverageTarget[] {
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

export function buildTargetProfile(runtimeHealth: RuntimeHealth, label: string): Section11TargetProfile {
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

export function getDefaultTargetProfileLabel(runtimeHealth: RuntimeHealth) {
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

export function getRuntimeProfileLabel(runtimeHealth: RuntimeHealth) {
  if (runtimeHealth.backend !== 'tauri') {
    return 'Browser'
  }

  if (runtimeHealth.osVersion) {
    return runtimeHealth.os ?? 'Desktop'
  }

  return runtimeHealth.os ?? 'Desktop'
}

export type Section11CoverageMapBundle = {
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

export function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string')
}

export function isSection11CoverageMapBundle(value: unknown): value is Section11CoverageMapBundle {
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

export function toSection11CoverageMapRecord(bundle: Section11CoverageMapBundle): Section11CoverageMapRecord {
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

export type Section11CapturePacketBundle = {
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

export function isSection11CapturePacketBundle(value: unknown): value is Section11CapturePacketBundle {
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

export function isSection11CapturePacketRecord(value: unknown): value is Section11CapturePacketRecord {
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

export function isSection11ProofSuiteResult(value: unknown): value is Section11ProofSuiteResult {
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

export function isSection11RenderProofResult(value: unknown): value is Section11RenderProofResult {
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

export function isSection11CoverageMapRecord(value: unknown): value is Section11CoverageMapRecord {
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
