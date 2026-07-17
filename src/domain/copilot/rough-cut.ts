import type { Track } from '../project/types'
import { r2 } from '../timeline/remove-range'
import type { Proposal } from './proposals'

/**
 * Rough-cut concierge: turn a speech transcript into a plan of `timeline_remove_range` proposals
 * that cut the silences. This is DELIBERATELY deterministic code, not LLM reasoning — the 4B brain
 * is reliable at proposing one edit but not at composing dozens of correct ones from a transcript
 * (the multi-op-coherence risk in the scope doc). The agent's job shrinks to "run the rough cut";
 * the plan is computed here and flows through the same approve-gate + ghost + one-undo machinery.
 *
 * Mirrors the Rust `Transcript` contract (media/traits.rs): audio-relative segment timestamps.
 */
export interface TranscriptSegment {
  start: number
  end: number
  text: string
}
export interface Transcript {
  text: string
  segments: TranscriptSegment[]
}

export interface SilenceCutOptions {
  /** Only cut silences at least this long (seconds). */
  minSilenceSec: number
  /** Keep this much silence next to speech, cutting only the middle (seconds). */
  paddingSec: number
  /** Ripple later clips left to close each gap. */
  ripple: boolean
  includeLeading: boolean
  includeTrailing: boolean
}

export const DEFAULT_SILENCE_OPTIONS: SilenceCutOptions = {
  minSilenceSec: 0.8,
  paddingSec: 0.15,
  ripple: true,
  includeLeading: true,
  includeTrailing: true,
}

/**
 * Whether a copilot message is asking for the rough-cut (cut the silences). Matched client-side so
 * the deterministic pipeline runs instead of hoping the 4B brain composes the plan. Covers English
 * and Thai phrasings.
 */
export function isRoughCutIntent(message: string): boolean {
  const m = message.toLowerCase()
  if (/\brough[\s-]?cut\b/.test(m)) return true
  if (/(cut|remove|trim|strip|kill)\b.{0,24}\bsilen/.test(m)) return true
  if (/silen.{0,24}\b(cut|remove|trim|out)\b/.test(m)) return true
  // Thai: ตัด … เงียบ / ความเงียบ / ช่วงเงียบ / "ตัด silence"
  if (/ตัด.{0,16}(เงียบ|silence)/.test(message)) return true
  return false
}

interface Span {
  start: number
  end: number
}

/**
 * Silent spans in AUDIO time, derived from the gaps between (sorted) speech segments. Padding is
 * applied only on the side adjacent to speech, so a keepalive of `paddingSec` remains around words.
 * A trailing span is left open-ended (Infinity) and clipped to each clip's source window later.
 */
export function detectSilences(segments: TranscriptSegment[], opts: SilenceCutOptions): Span[] {
  const sorted = [...segments].sort((a, b) => a.start - b.start)
  const raw: Array<Span & { pad: 'end' | 'both' | 'start' }> = []

  if (sorted.length === 0) {
    return []
  }
  if (opts.includeLeading && sorted[0].start > 0) {
    raw.push({ start: 0, end: sorted[0].start, pad: 'end' }) // pad only before the first word
  }
  for (let i = 0; i < sorted.length - 1; i++) {
    raw.push({ start: sorted[i].end, end: sorted[i + 1].start, pad: 'both' })
  }
  if (opts.includeTrailing) {
    raw.push({ start: sorted[sorted.length - 1].end, end: Infinity, pad: 'start' })
  }

  const cuts: Span[] = []
  for (const span of raw) {
    if (span.end - span.start < opts.minSilenceSec) {
      continue
    }
    const start = span.pad === 'start' || span.pad === 'both' ? r2(span.start + opts.paddingSec) : span.start
    const end = span.end === Infinity ? Infinity : span.pad === 'end' || span.pad === 'both' ? r2(span.end - opts.paddingSec) : span.end
    if (end > start) {
      cuts.push({ start, end })
    }
  }
  return cuts
}

/**
 * Plan the silence cuts for one track as `timeline_remove_range` proposals. Each audio silence is
 * intersected with each clip's source window and mapped to timeline coordinates (1 timeline-second
 * == 1 source-second, the codebase convention). Proposals are emitted **latest-first**: with
 * ripple on, applying an earlier cut shifts later content left, so cuts must be applied from the
 * end of the timeline backwards for the original coordinates to stay valid.
 */
export function planSilenceCuts(
  track: Track,
  transcript: Transcript,
  options: Partial<SilenceCutOptions> = {},
): Proposal[] {
  const opts = { ...DEFAULT_SILENCE_OPTIONS, ...options }
  const silences = detectSilences(transcript.segments, opts)

  const ranges: Span[] = []
  for (const clip of track.clips) {
    for (const silence of silences) {
      const from = Math.max(silence.start, clip.inPoint)
      const to = Math.min(silence.end, clip.outPoint)
      if (to - from < opts.minSilenceSec) {
        continue
      }
      ranges.push({
        start: r2(clip.startTime + (from - clip.inPoint)),
        end: r2(clip.startTime + (to - clip.inPoint)),
      })
    }
  }

  ranges.sort((a, b) => b.start - a.start) // latest-first, so ripple composes correctly
  return ranges.map((range) => ({
    action: 'timeline_remove_range',
    args: { trackId: track.id, start: range.start, end: range.end, ripple: opts.ripple },
    site: 'frontend',
    summary: `Remove silence ${range.start}s–${range.end}s`,
  }))
}
