import type { FluxNodeProject, Track } from '../project/types'
import { removeRangeFromTracks, type MakeId, type RemoveRangeOp } from '../timeline/remove-range'
import { splitClipInTracks, type SplitClipOp } from '../timeline/split-clip'
import { trimClipInTracks, type TrimClipOp } from '../timeline/trim-clip'
import {
  addClipInTracks,
  moveClipInTracks,
  setClipPropertyInTracks,
  type AddClipOp,
  type ClipProperty,
  type MoveClipOp,
  type SetClipPropertyOp,
} from '../timeline/clip-edits'

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

/** What happened to one proposal after the user approved the batch it was in. */
export interface ProposalOutcome {
  action: string
  site: 'frontend' | 'backend'
  /** `unsupported` = a frontend proposal this build cannot materialize; never executed. */
  status: 'applied' | 'failed' | 'unsupported'
  detail: string
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

export function isMoveClipArgs(args: unknown): args is MoveClipOp {
  const a = asObject(args)
  return (
    a !== null &&
    typeof a.clipId === 'string' &&
    typeof a.startTime === 'number' &&
    (a.trackId === undefined || typeof a.trackId === 'string')
  )
}

export function isAddClipArgs(args: unknown): args is AddClipOp {
  const a = asObject(args)
  return (
    a !== null &&
    typeof a.trackId === 'string' &&
    typeof a.assetId === 'string' &&
    typeof a.startTime === 'number' &&
    typeof a.duration === 'number'
  )
}

export function isSetClipPropertyArgs(args: unknown): args is SetClipPropertyOp {
  const a = asObject(args)
  return (
    a !== null &&
    typeof a.clipId === 'string' &&
    (a.property === 'volume' || a.property === 'opacity' || a.property === 'speed') &&
    typeof a.value === 'number'
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
    case 'timeline_move_clip':
      return isMoveClipArgs(p.args) ? moveClipInTracks(tracks, p.args, makeId) : tracks
    case 'timeline_add_clip':
      return isAddClipArgs(p.args) ? addClipInTracks(tracks, p.args, makeId) : tracks
    case 'timeline_set_clip_property':
      return isSetClipPropertyArgs(p.args) ? setClipPropertyInTracks(tracks, p.args, makeId) : tracks
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
    case 'timeline_move_clip':
      return isMoveClipArgs(p.args)
    case 'timeline_add_clip':
      return isAddClipArgs(p.args)
    case 'timeline_set_clip_property':
      return isSetClipPropertyArgs(p.args)
    default:
      return false
  }
}

/**
 * Split a batch of proposals by how approval must execute them:
 *
 * - `frontend` — materialized through the store as one undoable edit (`applyCopilotProposals`).
 * - `backend`  — re-invoked against the Rust registry with `allow_writes = true`, per the
 *   approve-gate scope doc (step A5). Deliberately NOT filtered against a frontend allowlist:
 *   `Registry::invoke` already validated the schema when it produced the proposal and validates
 *   again on execution, so a second list here would silently drop newly added actions.
 * - `unsupported` — a `site: 'frontend'` proposal this build cannot materialize (unknown action
 *   or malformed args). Surfaced to the user rather than executed.
 */
export function partitionProposals(proposals: Proposal[]): {
  frontend: Proposal[]
  backend: Proposal[]
  unsupported: Proposal[]
} {
  const frontend: Proposal[] = []
  const backend: Proposal[] = []
  const unsupported: Proposal[] = []

  for (const proposal of proposals) {
    if (proposal.site === 'backend') {
      backend.push(proposal)
    } else if (isSupportedFrontendProposal(proposal)) {
      frontend.push(proposal)
    } else {
      unsupported.push(proposal)
    }
  }

  return { frontend, backend, unsupported }
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
  if (p.action === 'timeline_move_clip' && isMoveClipArgs(p.args)) {
    const where = p.args.trackId ? ` to track ${p.args.trackId}` : ''
    return `Move clip ${p.args.clipId} to ${p.args.startTime}s${where}`
  }
  if (p.action === 'timeline_add_clip' && isAddClipArgs(p.args)) {
    return `Add ${p.args.duration}s clip (${p.args.assetId}) at ${p.args.startTime}s on track ${p.args.trackId}`
  }
  if (p.action === 'timeline_set_clip_property' && isSetClipPropertyArgs(p.args)) {
    return `Set clip ${p.args.clipId} ${p.args.property} to ${p.args.value}`
  }
  return p.summary || p.action
}

/** Property names the set-clip-property op accepts (surfaced for the Rust schema doc). */
export type { ClipProperty }

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
