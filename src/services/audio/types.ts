/**
 * Public input types for the timeline audio playback module.
 *
 * These types are intentionally decoupled from the Zustand store and the
 * domain `Clip`/`Track`/`AudioState` shapes. The integrator maps store state
 * onto these plain props so the hook stays testable and independent of store
 * internals.
 */

/**
 * A single audible clip on the timeline. Covers both dedicated audio-track
 * clips and the audio stream of video clips — anything with a decodable audio
 * stream and a file path.
 */
export interface TimelineAudioClip {
  /** Stable identity used to diff/reconcile playing elements across renders. */
  id: string
  /**
   * Absolute file path to the source media (as stored on `Asset.sourcePath`).
   * In Tauri mode this is converted to an asset URL via `convertFileSrc`.
   */
  sourcePath: string
  /** Timeline position (seconds) where this clip begins on the master timeline. */
  startTime: number
  /** In-point within the source media (seconds). */
  inPoint: number
  /** Out-point within the source media (seconds). Must be >= inPoint. */
  outPoint: number
  /** Per-clip linear gain multiplier in [0, 1]. */
  volume: number
  /**
   * Playback speed multiplier (1 = normal). Affects how source time maps to
   * timeline time and the element's `playbackRate`. Defaults to 1 when omitted.
   */
  speed?: number
  /** Whether the owning track is muted. */
  trackMuted?: boolean
  /** Whether the owning track is soloed. */
  trackSolo?: boolean
  /** Per-track linear gain multiplier in [0, 1]. Defaults to 1 when omitted. */
  trackVolume?: number
}

/** Inputs consumed by {@link useTimelineAudio}. */
export interface TimelineAudioParams {
  /** All audible clips currently on the timeline. */
  clips: TimelineAudioClip[]
  /** Current playhead position on the master timeline (seconds). */
  playhead: number
  /** Whether timeline playback is currently running. */
  isPlaying: boolean
  /** Master output gain in [0, 1]. */
  masterVolume: number
  /**
   * Playback rate of the whole timeline (1 = normal). Combined with each clip's
   * own `speed`. Defaults to 1.
   */
  playbackRate?: number
  /**
   * Optional override for runtime detection. When omitted, the module detects
   * the Tauri runtime itself. Primarily a testing seam.
   */
  enabled?: boolean
}

/**
 * Resolved gain for a clip after combining clip, track and master volume and
 * applying mute/solo rules. Returned by the scheduling helpers.
 */
export interface ResolvedClipPlayback {
  clip: TimelineAudioClip
  /** Effective linear gain in [0, 1] to apply to the audio element. */
  gain: number
  /** Source-media time (seconds) corresponding to the current playhead. */
  sourceTime: number
  /** Effective element playbackRate (clip speed * timeline rate). */
  playbackRate: number
}
