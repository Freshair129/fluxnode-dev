import { describe, expect, it } from 'vitest'
import { createDefaultProject } from './defaults'
import { validateProject } from './validators'

/**
 * MERIDIAN item 8 (empty/error state copy pass, spec M.6: "every empty state names the key that
 * fixes it" — extended here to the Validation panel's error/warning list, WorkflowView's
 * `combinedIssues`, spec H's broader "error detail must be actionable" instruction). These issue
 * messages are surfaced verbatim in the UI, so pinning their exact text is what makes this a real
 * regression guard, not just a smoke test — reverting the copy in `validators.ts` turns this red.
 */
describe('validateProject: actionable issue copy (item 8)', () => {
  it('names the real timeline affordance when there are no tracks', () => {
    const project = createDefaultProject()
    project.timeline.tracks = []

    const issues = validateProject(project)
    const issue = issues.find((candidate) => candidate.scope === 'timeline' && candidate.message.startsWith('Timeline has no tracks yet'))

    expect(issue).toBeDefined()
    expect(issue?.message).toBe('Timeline has no tracks yet. Use Add Track Above or Add Track Below in the Timeline view.')
  })

  it('names the real fix affordances for an offline (missing) asset', () => {
    const project = createDefaultProject()
    const asset = project.assets.assets['asset-video-01']
    expect(asset).toBeDefined()
    asset!.status = 'missing'

    const issues = validateProject(project)
    const issue = issues.find((candidate) => candidate.scope === 'assets' && candidate.message.includes('is offline'))

    expect(issue).toBeDefined()
    expect(issue?.message).toBe(`${asset!.name} is offline. Use Replace Media or Batch Relink to fix it.`)
  })

  it('names the real fix affordances for a corrupt asset', () => {
    const project = createDefaultProject()
    const asset = project.assets.assets['asset-video-01']
    expect(asset).toBeDefined()
    asset!.status = 'corrupt'

    const issues = validateProject(project)
    const issue = issues.find((candidate) => candidate.scope === 'assets' && candidate.message.includes('cannot be decoded'))

    expect(issue).toBeDefined()
    expect(issue?.message).toBe(`${asset!.name} cannot be decoded. Use Replace Media to relink it, or Delete the clip.`)
  })

  it('does not fire the no-tracks issue when a track exists (regression guard for the assertion above)', () => {
    const project = createDefaultProject()
    expect(project.timeline.tracks.length).toBeGreaterThan(0)

    const issues = validateProject(project)
    expect(issues.some((candidate) => candidate.message.startsWith('Timeline has no tracks yet'))).toBe(false)
  })
})
