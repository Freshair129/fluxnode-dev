/**
 * Pure scheduling helpers for timeline audio.
 *
 * No DOM, no Tauri, no React — these functions are deterministic and unit
 * tested. They answer: is a clip audible at time T, what source time should it
 * play from, and what gain should it have given clip/track/master volume and
 * mute/solo state.
 */

import type { ResolvedClipPlayback, TimelineAudioClip } from './types'

const EPSILON = 1e-6

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0
  if (value < 0) return 0
  if (value > 1) return 1
  return value
}

/** Effective speed of a clip on the timeline (clip.speed * timelineRate). */
export function effectivePlaybackRate(clip: TimelineAudioClip, timelineRate = 1): number {
  const clipSpeed = clip.speed ?? 1
  const rate = clipSpeed * timelineRate
  // Guard against zero/negative/NaN which would break HTMLMediaElement.
  if (!Number.isFinite(rate) || rate <= 0) return 1
  return rate
}

/**
 * Duration this clip occupies on the timeline, accounting for source trim and
 * playback speed. A 4s source segment at 2x speed occupies 2s of timeline.
 */
export function timelineDuration(clip: TimelineAudioClip): number {
  const sourceSpan = Math.max(0, clip.outPoint - clip.inPoint)
  const speed = clip.speed ?? 1
  if (!Number.isFinite(speed) || speed <= 0) return sourceSpan
  return sourceSpan / speed
}

/** Inclusive-start, exclusive-end timeline range covered by the clip. */
export function timelineRange(clip: TimelineAudioClip): { start: number; end: number } {
  const start = clip.startTime
  return { start, end: start + timelineDuration(clip) }
}

/** Whether the clip is audible at the given timeline time. */
export function isClipActiveAtTime(clip: TimelineAudioClip, timelineTime: number): boolean {
  const { start, end } = timelineRange(clip)
  return timelineTime >= start - EPSILON && timelineTime < end - EPSILON
}

/**
 * Map a timeline time to the corresponding source-media time for a clip.
 * Returns the in-point when the playhead is before the clip and clamps to the
 * out-point when after.
 */
export function sourceTimeForClip(clip: TimelineAudioClip, timelineTime: number): number {
  const speed = clip.speed ?? 1
  const offsetOnTimeline = timelineTime - clip.startTime
  const sourceOffset = offsetOnTimeline * (Number.isFinite(speed) && speed > 0 ? speed : 1)
  const raw = clip.inPoint + sourceOffset
  if (raw < clip.inPoint) return clip.inPoint
  if (raw > clip.outPoint) return clip.outPoint
  return raw
}

/**
 * Resolve the effective gain for a clip given mute/solo across all clips.
 *
 * Solo rule: if any clip is soloed, only soloed (and non-muted) clips are
 * audible. Otherwise muted clips are silenced.
 */
export function resolveClipGain(
  clip: TimelineAudioClip,
  masterVolume: number,
  anySolo: boolean,
): number {
  const muted = clip.trackMuted ?? false
  const solo = clip.trackSolo ?? false

  if (muted) return 0
  if (anySolo && !solo) return 0

  const clipVolume = clamp01(clip.volume)
  const trackVolume = clamp01(clip.trackVolume ?? 1)
  const master = clamp01(masterVolume)
  return clipVolume * trackVolume * master
}

/** Whether any clip in the set is soloed. */
export function hasAnySolo(clips: TimelineAudioClip[]): boolean {
  return clips.some((c) => c.trackSolo === true)
}

/**
 * Compute the set of clips that should currently be sounding, along with their
 * resolved source time, gain and playback rate. Clips that are inactive at the
 * playhead or silenced (gain 0) are excluded.
 */
export function resolveActivePlayback(
  clips: TimelineAudioClip[],
  playhead: number,
  masterVolume: number,
  timelineRate = 1,
): ResolvedClipPlayback[] {
  const anySolo = hasAnySolo(clips)
  const result: ResolvedClipPlayback[] = []

  for (const clip of clips) {
    if (!isClipActiveAtTime(clip, playhead)) continue
    const gain = resolveClipGain(clip, masterVolume, anySolo)
    if (gain <= 0) continue
    result.push({
      clip,
      gain,
      sourceTime: sourceTimeForClip(clip, playhead),
      playbackRate: effectivePlaybackRate(clip, timelineRate),
    })
  }

  return result
}
