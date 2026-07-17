import type { FluxNodeProject } from '../project/types'
import { removeRangeFromTracks, type MakeId, type RemoveRangeOp } from '../timeline/remove-range'

/**
 * A copilot proposal — the structured, gated action the agent wants to run, returned by the Rust
 * write-gate instead of being executed (see docs/copilot-approve-gate-and-timeline-edits-scope.md).
 * `site` decides how an approved proposal is executed: `frontend` ops materialize through the
 * store; `backend` ops re-invoke the Rust registry with writes allowed.
 */
export interface Proposal {
  action: string
  args: Record<string, unknown>
  site: 'frontend' | 'backend'
  summary: string
}

export function isRemoveRangeArgs(args: unknown): args is RemoveRangeOp {
  if (typeof args !== 'object' || args === null) {
    return false
  }
  const a = args as Record<string, unknown>
  return (
    typeof a.trackId === 'string' &&
    typeof a.start === 'number' &&
    typeof a.end === 'number' &&
    typeof a.ripple === 'boolean'
  )
}

/** A frontend proposal this build knows how to preview and execute. */
export function isSupportedFrontendProposal(p: Proposal): boolean {
  return p.site === 'frontend' && p.action === 'timeline_remove_range' && isRemoveRangeArgs(p.args)
}

/** Human-readable one-liner, richer than the Rust-side summary (has project context). */
export function summarizeProposal(p: Proposal, project: FluxNodeProject): string {
  if (p.action === 'timeline_remove_range' && isRemoveRangeArgs(p.args)) {
    const track = project.timeline.tracks.find((t) => t.id === p.args.trackId)
    const where = track ? `"${track.name}"` : `track ${p.args.trackId}`
    const ripple = p.args.ripple ? ', ripple later clips left' : ', leave a gap'
    return `Remove ${p.args.start}s–${p.args.end}s on ${where}${ripple}`
  }
  return p.summary || p.action
}

/**
 * Apply the supported frontend proposals to a project, returning a new project — pure, for the
 * ghost preview. Uses the SAME op logic as the store executor so preview and result cannot drift.
 * Unsupported proposals are skipped (they are executed elsewhere or not yet materializable here).
 */
export function applyProposalsToProject(
  project: FluxNodeProject,
  proposals: Proposal[],
  makeId: MakeId = previewIdFactory(),
): FluxNodeProject {
  let tracks = project.timeline.tracks
  for (const p of proposals) {
    if (p.action === 'timeline_remove_range' && isRemoveRangeArgs(p.args)) {
      tracks = removeRangeFromTracks(tracks, p.args, makeId)
    }
  }
  if (tracks === project.timeline.tracks) {
    return project
  }
  return { ...project, timeline: { ...project.timeline, tracks } }
}

/** Deterministic throwaway ids for preview (never persisted). */
export function previewIdFactory(): MakeId {
  const counters = { clip: 0, keyframe: 0 }
  return (prefix) => `preview-${prefix}-${++counters[prefix]}`
}
