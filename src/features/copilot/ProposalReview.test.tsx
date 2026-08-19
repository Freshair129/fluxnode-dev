import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { createDefaultProject } from '../../domain/project/defaults'
import type { Proposal, ProposalOutcome } from '../../domain/copilot/proposals'
import { ProposalReview } from './ProposalReview'

/**
 * Same constraint as JobChip.test.tsx: no jsdom/testing-library in this repo, so this renders with
 * `renderToStaticMarkup`. That is also why the review list is a pure props-driven component rather
 * than reading the store directly — zustand serves `getInitialState` under SSR, so a store-wired
 * component always renders empty here. Same split as JobChip (pure) / JobLedger (store-wired).
 */
const project = createDefaultProject()

const backend = (action: string, summary: string): Proposal => ({ action, args: {}, site: 'backend', summary })

const noop = () => {}
const render = (proposals: Proposal[], outcomes: ProposalOutcome[] = []) =>
  renderToStaticMarkup(
    <ProposalReview
      proposals={proposals}
      project={project}
      outcomes={outcomes}
      busy={false}
      onApproveFrontend={noop}
      onRunBackend={noop}
      onReject={noop}
    />,
  )

describe('ProposalReview', () => {
  it('offers a run control for a pending backend proposal', () => {
    const markup = render([backend('save_project_state', 'Save the project')])

    expect(markup).toContain('save_project_state')
    expect(markup).toContain('Run')
    // The old build listed backend proposals as permanently inert. That text must be gone.
    expect(markup).not.toContain('materializable')
  })

  it('warns that a backend proposal is a real side effect before it is approved', () => {
    const markup = render([backend('render_start', 'Start a render')])

    expect(markup.toLowerCase()).toContain('cannot be undone')
  })

  it('still lists an unsupported frontend proposal as not materializable, with no run control', () => {
    const markup = render([{ action: 'timeline_teleport', args: {}, site: 'frontend', summary: 'Teleport' }])

    expect(markup).toContain('materializable')
    expect(markup).not.toContain('>Run<')
  })

  it('offers one run control per backend proposal so approval stays per action', () => {
    const markup = render([backend('save_project_state', 'a'), backend('render_start', 'b')])

    expect(markup.match(/>Run</g)).toHaveLength(2)
  })

  it('reports the failure detail when a backend proposal did not run', () => {
    const markup = render(
      [],
      [{ action: 'render_start', site: 'backend', status: 'failed', detail: 'No active project directory' }],
    )

    expect(markup).toContain('No active project directory')
  })

  it('renders nothing when there is nothing to review', () => {
    expect(render([])).toBe('')
  })
})
