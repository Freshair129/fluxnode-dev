import type { FluxNodeProject, Track } from '../project/types'
import { removeRangeFromTracks, type MakeId, type RemoveRangeOp } from '../timeline/remove-range'
import { splitClipInTracks, type SplitClipOp } from '../timeline/split-clip'
import { trimClipInTracks, type TrimClipOp } from '../timeline/trim-clip'

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
  const a = asObject(args)
  return (
    a !== null &&
    typeof a.trackId === 'string' &&
    typeof a.start === 'number' &&
    typeof a.end === 'number' &&
    typeof a.ripple === 'boolean'
  )
}

export function isSplitClipArgs(args: unknown): args is SplitClipOp {
  const a = asObject(args)
  return a !== null && typeof a.clipId === 'string' && typeof a.time === 'number'
}

export function isTrimClipArgs(args: unknown): args is TrimClipOp {
  const a = asObject(args)
  return (
    a !== null &&
    typeof a.clipId === 'string' &&
    (a.edge === 'start' || a.edge === 'end') &&
    typeof a.delta === 'number'
  )
}

function asObject(args: unknown): Record<string, unknown> | null {
  return typeof args === 'object' && args !== null ? (args as Record<string, unknown>) : null
}

/**
 * Dispatch one proposal onto a track list — the SINGLE place that maps a proposal to its pure op,
 * shared by the ghost preview (`applyProposalsToProject`) and the store executor
 * (`applyCopilotProposals`) so the two can never diverge. Returns the input unchanged for
 * unsupported or malformed proposals.
 */
export function applyProposalToTracks(tracks: Track[], p: Proposal, makeId: MakeId): Track[] {
  switch (p.action) {
    case 'timeline_remove_range':
      return isRemoveRangeArgs(p.args) ? removeRangeFromTracks(tracks, p.args, makeId) : tracks
    case 'timeline_split_clip':
      return isSplitClipArgs(p.args) ? splitClipInTracks(tracks, p.args, makeId) : tracks
    case 'timeline_trim_clip':
      return isTrimClipArgs(p.args) ? trimClipInTracks(tracks, p.args, makeId) : tracks
    default:
      return tracks
  }
}

/** A frontend proposal this build knows how to preview and execute. */
export function isSupportedFrontendProposal(p: Proposal): boolean {
  if (p.site !== 'frontend') {
    return false
  }
  switch (p.action) {
    case 'timeline_remove_range':
      return isRemoveRangeArgs(p.args)
    case 'timeline_split_clip':
      return isSplitClipArgs(p.args)
    case 'timeline_trim_clip':
      return isTrimClipArgs(p.args)
    default:
      return false
  }
}

/** Human-readable one-liner, richer than the Rust-side summary (has project context). */
export function summarizeProposal(p: Proposal, project: FluxNodeProject): string {
  if (p.action === 'timeline_remove_range' && isRemoveRangeArgs(p.args)) {
    const track = project.timeline.tracks.find((t) => t.id === p.args.trackId)
    const where = track ? `"${track.name}"` : `track ${p.args.trackId}`
    const ripple = p.args.ripple ? ', ripple later clips left' : ', leave a gap'
    return `Remove ${p.args.start}s–${p.args.end}s on ${where}${ripple}`
  }
  if (p.action === 'timeline_split_clip' && isSplitClipArgs(p.args)) {
    return `Split clip ${p.args.clipId} at ${p.args.time}s`
  }
  if (p.action === 'timeline_trim_clip' && isTrimClipArgs(p.args)) {
    const verb = p.args.delta < 0 && p.args.edge === 'end' ? 'shorten' : p.args.delta > 0 && p.args.edge === 'start' ? 'trim' : 'extend'
    return `${verb[0].toUpperCase()}${verb.slice(1)} clip ${p.args.clipId} ${p.args.edge} by ${Math.abs(p.args.delta)}s`
  }
  return p.summary || p.action
}

/**
 * Apply the supported frontend proposals to a project, returning a new project — pure, for the
 * ghost preview. Uses the SAME dispatch as the store executor so preview and result cannot drift.
 */
export function applyProposalsToProject(
  project: FluxNodeProject,
  proposals: Proposal[],
  makeId: MakeId = previewIdFactory(),
): FluxNodeProject {
  let tracks = project.timeline.tracks
  for (const p of proposals) {
    tracks = applyProposalToTracks(tracks, p, makeId)
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
