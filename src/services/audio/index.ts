/**
 * Self-contained frontend audio playback module for the FluxNode timeline.
 *
 * Plays timeline audio (and video clips' audio) in sync with the playhead via
 * HTMLAudioElement, applying per-clip + track + master volume and mute/solo.
 * Tauri mode resolves file URLs with `convertFileSrc`; browser mode no-ops.
 *
 * Primary entry point: {@link useTimelineAudio}.
 */

export { useTimelineAudio } from './use-timeline-audio'
export type { UseTimelineAudioOptions } from './use-timeline-audio'
export {
  TimelineAudioEngine,
  type AudioElementLike,
  type AudioElementFactory,
  type AudioEngineOptions,
  type SourceUrlResolver,
} from './audio-engine'
export {
  isClipActiveAtTime,
  sourceTimeForClip,
  resolveClipGain,
  resolveActivePlayback,
  hasAnySolo,
  timelineDuration,
  timelineRange,
  effectivePlaybackRate,
} from './clip-scheduling'
export type {
  TimelineAudioClip,
  TimelineAudioParams,
  ResolvedClipPlayback,
} from './types'
