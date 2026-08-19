import type { FluxNodeProject } from '../../domain/project/types'
import {
  applyProposalsToProject,
  partitionProposals,
  summarizeProposal,
  type Proposal,
  type ProposalOutcome,
} from '../../domain/copilot/proposals'

export interface ProposalReviewProps {
  proposals: Proposal[]
  project: FluxNodeProject
  outcomes: ProposalOutcome[]
  busy: boolean
  /** Approve every frontend edit at once — one approval, one undo step. */
  onApproveFrontend: () => void
  /** Run ONE backend action. Per-proposal by design: a backend effect is real and not undoable,
   *  so there is no "approve all" for these and no session-wide writes toggle. */
  onRunBackend: (proposal: Proposal) => void
  onReject: () => void
}

/**
 * The review surface for a batch of copilot proposals: ghost preview + approve for timeline
 * edits, a per-action run control for backend actions, and the result of the last approval.
 *
 * Pure and props-driven so it can be rendered in tests (see ProposalReview.test.tsx) — the
 * store wiring lives in CopilotPanel, mirroring the JobChip / JobLedger split.
 */
export function ProposalReview({
  proposals,
  project,
  outcomes,
  busy,
  onApproveFrontend,
  onRunBackend,
  onReject,
}: ProposalReviewProps) {
  const { frontend, backend, unsupported } = partitionProposals(proposals)

  if (frontend.length === 0 && backend.length === 0 && unsupported.length === 0 && outcomes.length === 0) {
    return null
  }

  // Clip-count delta per affected track, computed with the SAME op logic the executor uses, so
  // what you see is exactly what approval produces.
  const after = frontend.length > 0 ? applyProposalsToProject(project, frontend) : project
  const ghost = project.timeline.tracks
    .map((before) => {
      const found = after.timeline.tracks.find((track) => track.id === before.id)
      if (!found || found.clips.length === before.clips.length) {
        return null
      }
      return { name: before.name, before: before.clips.length, after: found.clips.length }
    })
    .filter((entry): entry is { name: string; before: number; after: number } => entry !== null)

  return (
    <>
      {frontend.length > 0 ? (
        <div className="rounded-xl border border-[#e0ff00]/30 bg-black/30 p-3">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-[#e0ff00]">
            {frontend.length} proposed edit{frontend.length === 1 ? '' : 's'}
          </p>
          <ul className="space-y-1.5">
            {frontend.map((proposal, index) => (
              <li key={index} className="text-[#d1d5db]">
                • {summarizeProposal(proposal, project)}
              </li>
            ))}
          </ul>
          {ghost.length > 0 ? (
            <div className="mt-2 border-t border-white/10 pt-2 text-xs text-[#9ca3af]">
              {ghost.map((entry) => (
                <div key={entry.name}>
                  {entry.name}: {entry.before} → {entry.after} clips
                </div>
              ))}
            </div>
          ) : null}
          <div className="mt-3 flex gap-2">
            <button
              type="button"
              onClick={onApproveFrontend}
              disabled={busy}
              className="rounded-lg bg-[#e0ff00] px-3 py-1.5 text-xs font-semibold text-black transition enabled:hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40"
            >
              Approve &amp; apply
            </button>
            <button
              type="button"
              onClick={onReject}
              className="rounded-lg border border-white/15 px-3 py-1.5 text-xs text-[#d1d5db] transition hover:bg-white/5"
            >
              Reject
            </button>
          </div>
        </div>
      ) : null}

      {backend.length > 0 ? (
        <div className="rounded-xl border border-[#3b82f6]/40 bg-black/30 p-3">
          <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-[#3b82f6]">
            {backend.length} action{backend.length === 1 ? '' : 's'} awaiting approval
          </p>
          <p className="mb-2 text-xs text-[#9ca3af]">
            These run on your machine and cannot be undone. Approve one at a time.
          </p>
          <ul className="space-y-2">
            {backend.map((proposal, index) => (
              <li key={index} className="flex items-start justify-between gap-2">
                <span className="min-w-0 text-[#d1d5db]">
                  {summarizeProposal(proposal, project)}
                  <span className="mt-0.5 block truncate font-mono text-[10px] text-[#6b7280]">
                    {proposal.action}
                  </span>
                </span>
                <button
                  type="button"
                  onClick={() => onRunBackend(proposal)}
                  disabled={busy}
                  className="shrink-0 rounded-lg bg-[#3b82f6] px-3 py-1 text-xs font-semibold text-white transition enabled:hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  Run
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {unsupported.length > 0 ? (
        <div className="rounded-xl border border-white/10 bg-black/20 p-3 text-xs text-[#9ca3af]">
          {unsupported.length} proposal{unsupported.length === 1 ? '' : 's'} could not be understood and
          {unsupported.length === 1 ? ' is' : ' are'} not materializable in this build:
          <ul className="mt-1 space-y-1">
            {unsupported.map((proposal, index) => (
              <li key={index}>• {summarizeProposal(proposal, project)}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {outcomes.length > 0 ? (
        <div className="rounded-xl border border-white/10 bg-black/20 p-3 text-xs">
          <p className="mb-1 font-semibold uppercase tracking-wide text-[#9ca3af]">Result</p>
          <ul className="space-y-1">
            {outcomes.map((outcome, index) => (
              <li
                key={index}
                className={outcome.status === 'failed' ? 'text-red-300' : 'text-[#9ca3af]'}
              >
                • <span className="font-mono text-[10px]">{outcome.action}</span> — {outcome.detail}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </>
  )
}
