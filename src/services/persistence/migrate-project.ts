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
 * Applies migrations in place and returns the (now current-version) project.
 * Safe to call on already-current projects — every step is idempotent.
 */
export function migrateProject(raw: FluxNodeProject): FluxNodeProject {
  if (isOlderThan(raw, CURRENT_PROJECT_VERSION)) {
    migrateSection11Fields(raw)
    raw.version = CURRENT_PROJECT_VERSION
  } else {
    // Still guard against partially-written saves even at the current version.
    migrateSection11Fields(raw)
  }

  return raw
}
