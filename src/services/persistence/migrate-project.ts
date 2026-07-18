import { clampHorizonRatio, DEFAULT_HORIZON_RATIO } from '../../domain/project/horizon'
import { normalizeStudioLayout } from '../../domain/project/studio-layout'
import type { FluxNodeProject } from '../../domain/project/types'

/**
 * Shared load-time normalization/migration step used by both the local
 * (browser) and Tauri project repositories. Previously each repository kept
 * an identical copy of this logic (see git history) which meant migrations
 * had to be applied twice; this module is now the single source of truth.
 *
 * `project.version` is written on every save but was never read back on
 * load. This starts a minimal, additive migration pipeline keyed by version:
 * each step is a no-op unless the loaded project predates it, so today it
 * only fills in fields that may be missing from older saves. Future schema
 * changes should add another `if (isOlderThan(...))` step rather than
 * rewriting the whole function.
 */
const CURRENT_PROJECT_VERSION = '1.0.0'

function compareVersions(a: string, b: string): number {
  const partsA = a.split('.').map((part) => Number.parseInt(part, 10) || 0)
  const partsB = b.split('.').map((part) => Number.parseInt(part, 10) || 0)
  const length = Math.max(partsA.length, partsB.length)

  for (let index = 0; index < length; index += 1) {
    const diff = (partsA[index] ?? 0) - (partsB[index] ?? 0)
    if (diff !== 0) {
      return diff
    }
  }

  return 0
}

function isOlderThan(project: FluxNodeProject, version: string): boolean {
  if (typeof project.version !== 'string' || project.version.length === 0) {
    return true
  }

  return compareVersions(project.version, version) < 0
}

/** Fields that may be missing on projects saved before section 11 proof-history tracking existed. */
function migrateSection11Fields(project: FluxNodeProject) {
  if (project.meta.section11TargetProfileOverride !== null && typeof project.meta.section11TargetProfileOverride !== 'string') {
    project.meta.section11TargetProfileOverride = null
  }

  if (!Array.isArray(project.meta.section11ProofHistory)) {
    project.meta.section11ProofHistory = []
  }

  if (!Array.isArray(project.meta.section11CoverageMapHistory)) {
    project.meta.section11CoverageMapHistory = []
  }

  if (!Array.isArray(project.meta.section11CapturePacketHistory)) {
    project.meta.section11CapturePacketHistory = []
  }
}

/**
 * MERIDIAN strata shell (item 2): saves written before the horizon splitter existed lack this
 * field. Only writes when the value actually needs correcting (missing/garbage) — some load
 * paths (e.g. WAL reconstruction via immer's `applyPatches`) hand back a frozen object, and an
 * unconditional reassignment would throw even when the value is already valid.
 */
function migrateHorizonRatio(project: FluxNodeProject) {
  const current = project.meta.horizonRatio
  const normalized = typeof current === 'number' ? clampHorizonRatio(current) : DEFAULT_HORIZON_RATIO

  if (current !== normalized) {
    project.meta.horizonRatio = normalized
  }
}

/**
 * MERIDIAN stage row (item 3): saves written before the job ledger/inspector collapse rails
 * existed lack this field. Same conditional-write guard as `migrateHorizonRatio` — only writes
 * when the value is actually missing/malformed, so already-valid (possibly frozen) objects are
 * left untouched.
 */
function migrateStageRowCollapse(project: FluxNodeProject) {
  const current = project.meta.stageRowCollapse

  if (
    current === null ||
    typeof current !== 'object' ||
    typeof current.ledger !== 'boolean' ||
    typeof current.inspector !== 'boolean'
  ) {
    project.meta.stageRowCollapse = { ledger: false, inspector: false }
  }
}

/**
 * Studio workspace layout: saves written before the studio shell existed lack this field. Same
 * conditional-write guard as `migrateHorizonRatio` — `normalizeStudioLayout` returns a fresh
 * valid object, but we only assign when the persisted value is actually missing/malformed so
 * already-valid (possibly frozen) objects are left untouched.
 */
function migrateStudioLayout(project: FluxNodeProject) {
  const current = project.meta.studioLayout
  const normalized = normalizeStudioLayout(current)

  if (
    current === null ||
    typeof current !== 'object' ||
    current.timelineHeightPx !== normalized.timelineHeightPx ||
    current.mediaCollapsed !== normalized.mediaCollapsed ||
    current.mediaWidthPx !== normalized.mediaWidthPx ||
    current.inspectorWidthPx !== normalized.inspectorWidthPx
  ) {
    project.meta.studioLayout = normalized
  }
}

/**
 * Applies migrations in place and returns the (now current-version) project.
 * Safe to call on already-current projects — every step is idempotent.
 */
export function migrateProject(raw: FluxNodeProject): FluxNodeProject {
  if (isOlderThan(raw, CURRENT_PROJECT_VERSION)) {
    migrateSection11Fields(raw)
    migrateHorizonRatio(raw)
    migrateStageRowCollapse(raw)
    migrateStudioLayout(raw)
    raw.version = CURRENT_PROJECT_VERSION
  } else {
    // Still guard against partially-written saves even at the current version.
    migrateSection11Fields(raw)
    migrateHorizonRatio(raw)
    migrateStageRowCollapse(raw)
    migrateStudioLayout(raw)
  }

  return raw
}
