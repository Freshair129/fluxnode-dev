import { describe, expect, it } from 'vitest'
import { createDefaultProject } from '../../domain/project/defaults'
import { migrateProject } from './migrate-project'

describe('migrateProject', () => {
  it('is a no-op (aside from re-affirming version) on an already-current project', () => {
    const project = createDefaultProject()
    const before = JSON.stringify(project)
    const migrated = migrateProject(project)

    expect(migrated).toBe(project)
    expect(JSON.stringify(migrated)).toBe(before)
  })

  it('fills in missing section 11 history fields and stamps the current version on an older/partial save', () => {
    const project = createDefaultProject()
    // Simulate a save written before section 11 tracking existed, and an unset/garbage version.
    project.version = ''
    // @ts-expect-error simulating a legacy save missing this field entirely
    delete project.meta.section11ProofHistory
    // @ts-expect-error simulating a legacy save missing this field entirely
    delete project.meta.section11CoverageMapHistory
    // @ts-expect-error simulating a legacy save missing this field entirely
    delete project.meta.section11CapturePacketHistory
    project.meta.section11TargetProfileOverride = 42 as unknown as string | null

    const migrated = migrateProject(project)

    expect(migrated.version).toBe('1.0.0')
    expect(migrated.meta.section11ProofHistory).toEqual([])
    expect(migrated.meta.section11CoverageMapHistory).toEqual([])
    expect(migrated.meta.section11CapturePacketHistory).toEqual([])
    expect(migrated.meta.section11TargetProfileOverride).toBeNull()
  })

  it('fills in a missing/malformed stageRowCollapse field (MERIDIAN item 3) without touching an already-valid one', () => {
    const legacyProject = createDefaultProject()
    // @ts-expect-error simulating a save written before the stage row collapse rails existed
    delete legacyProject.meta.stageRowCollapse

    const migratedLegacy = migrateProject(legacyProject)
    expect(migratedLegacy.meta.stageRowCollapse).toEqual({ ledger: false, inspector: false })

    const malformedProject = createDefaultProject()
    malformedProject.meta.stageRowCollapse = { ledger: true } as unknown as typeof malformedProject.meta.stageRowCollapse

    const migratedMalformed = migrateProject(malformedProject)
    expect(migratedMalformed.meta.stageRowCollapse).toEqual({ ledger: false, inspector: false })

    const currentProject = createDefaultProject()
    currentProject.meta.stageRowCollapse = { ledger: true, inspector: true }
    const before = JSON.stringify(currentProject)

    const migratedCurrent = migrateProject(currentProject)
    expect(JSON.stringify(migratedCurrent)).toBe(before)
  })
})
