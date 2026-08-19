import { describe, expect, it } from 'vitest'
import { partitionProposals, type Proposal } from './proposals'

const frontendRemove: Proposal = {
  action: 'timeline_remove_range',
  args: { trackId: 't1', start: 1, end: 2, ripple: true },
  site: 'frontend',
  summary: 'remove',
}

const backendSave: Proposal = {
  action: 'save_project_state',
  args: { project_json: '{}' },
  site: 'backend',
  summary: 'save',
}

const malformedFrontend: Proposal = {
  action: 'timeline_remove_range',
  args: { trackId: 't1' }, // missing start/end/ripple
  site: 'frontend',
  summary: 'broken',
}

describe('partitionProposals', () => {
  it('routes a supported frontend op to frontend and a backend op to backend', () => {
    const result = partitionProposals([frontendRemove, backendSave])

    expect(result.frontend).toEqual([frontendRemove])
    expect(result.backend).toEqual([backendSave])
    expect(result.unsupported).toEqual([])
  })

  it('routes a malformed frontend op to unsupported rather than frontend', () => {
    const result = partitionProposals([malformedFrontend])

    expect(result.frontend).toEqual([])
    expect(result.unsupported).toEqual([malformedFrontend])
  })

  it('routes an unknown frontend action to unsupported', () => {
    const unknown: Proposal = { action: 'timeline_teleport', args: {}, site: 'frontend', summary: '?' }

    expect(partitionProposals([unknown]).unsupported).toEqual([unknown])
  })

  it('treats every backend proposal as executable regardless of action name', () => {
    // The registry already validated the schema before proposing, and the Rust side
    // re-validates on invoke — the frontend must not maintain a second allowlist that
    // would silently drop newly added backend actions.
    const novel: Proposal = { action: 'some_future_action', args: { a: 1 }, site: 'backend', summary: 'x' }

    expect(partitionProposals([novel]).backend).toEqual([novel])
  })
})
