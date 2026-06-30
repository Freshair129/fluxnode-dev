/**
 * Imperative, framework-agnostic audio engine.
 *
 * Owns one {@link HTMLAudioElement} per active clip and reconciles the live set
 * of elements against a desired playback state derived from the timeline. The
 * React hook is a thin wrapper around this; keeping the engine plain makes it
 * straightforward to reason about and to drive from tests.
 *
 * In browser (non-Tauri) mode the engine no-ops gracefully: it resolves no
 * source URLs and creates no elements, so importing/using the module never
 * throws outside Tauri.
 */

import type { ResolvedClipPlayback, TimelineAudioClip } from './types'
import { resolveActivePlayback } from './clip-scheduling'

/** Resolves a source file path to a playable URL. */
export type SourceUrlResolver = (sourcePath: string) => string | null

/** Minimal subset of the audio element API the engine relies on. */
export interface AudioElementLike {
  src: string
  volume: number
  muted: boolean
  playbackRate: number
  currentTime: number
  preload: string
  loop: boolean
  crossOrigin: string | null
  play(): Promise<void>
  pause(): void
  load(): void
}

/** Factory for audio elements; injectable for testing. */
export type AudioElementFactory = () => AudioElementLike

export interface AudioEngineOptions {
  /**
   * Resolves a clip source path to a playable URL. Return `null` to skip the
   * clip (e.g. in browser mode or when the path cannot be resolved).
   */
  resolveUrl: SourceUrlResolver
  /** Creates a new audio element. Defaults to `new Audio()` in the browser. */
  createElement?: AudioElementFactory
  /**
   * Difference (seconds) between an element's currentTime and the desired
   * source time beyond which the engine re-seeks. Keeps minor drift from
   * causing constant seeking. Defaults to 0.25s.
   */
  resyncThreshold?: number
}

interface ActiveEntry {
  element: AudioElementLike
  url: string
}

function defaultFactory(): AudioElementLike {
  // `Audio` is a DOM global; guarded by callers that only run in the browser.
  return new Audio() as unknown as AudioElementLike
}

export class TimelineAudioEngine {
  private readonly resolveUrl: SourceUrlResolver
  private readonly createElement: AudioElementFactory
  private readonly resyncThreshold: number
  private readonly active = new Map<string, ActiveEntry>()

  constructor(options: AudioEngineOptions) {
    this.resolveUrl = options.resolveUrl
    this.createElement = options.createElement ?? defaultFactory
    this.resyncThreshold = options.resyncThreshold ?? 0.25
  }

  /**
   * Reconcile the engine to the given timeline state. Safe to call on every
   * playhead tick and on play/pause/volume changes.
   */
  sync(params: {
    clips: TimelineAudioClip[]
    playhead: number
    isPlaying: boolean
    masterVolume: number
    timelineRate?: number
  }): void {
    const { clips, playhead, isPlaying, masterVolume, timelineRate = 1 } = params

    const desired = resolveActivePlayback(clips, playhead, masterVolume, timelineRate)
    const desiredById = new Map<string, ResolvedClipPlayback>()
    for (const entry of desired) desiredById.set(entry.clip.id, entry)

    // Tear down elements no longer active.
    for (const [id, entry] of this.active) {
      if (!desiredById.has(id)) {
        this.disposeEntry(entry)
        this.active.delete(id)
      }
    }

    // Create / update elements for the desired set.
    for (const playback of desired) {
      this.applyPlayback(playback, isPlaying)
    }
  }

  /** Pause all active elements without tearing them down. */
  pauseAll(): void {
    for (const { element } of this.active.values()) {
      element.pause()
    }
  }

  /** Stop and release every element. */
  dispose(): void {
    for (const entry of this.active.values()) {
      this.disposeEntry(entry)
    }
    this.active.clear()
  }

  /** Number of live audio elements — exposed for tests/diagnostics. */
  get activeCount(): number {
    return this.active.size
  }

  private applyPlayback(playback: ResolvedClipPlayback, isPlaying: boolean): void {
    const { clip, gain, sourceTime, playbackRate } = playback
    const url = this.resolveUrl(clip.sourcePath)
    if (!url) {
      // Browser mode or unresolvable path: ensure no stale element lingers.
      const stale = this.active.get(clip.id)
      if (stale) {
        this.disposeEntry(stale)
        this.active.delete(clip.id)
      }
      return
    }

    let entry = this.active.get(clip.id)
    if (!entry || entry.url !== url) {
      if (entry) this.disposeEntry(entry)
      const element = this.createElement()
      element.preload = 'auto'
      element.loop = false
      element.crossOrigin = 'anonymous'
      element.src = url
      entry = { element, url }
      this.active.set(clip.id, entry)
    }

    const { element } = entry
    element.volume = gain
    element.muted = gain <= 0
    if (Number.isFinite(playbackRate) && playbackRate > 0) {
      element.playbackRate = playbackRate
    }

    // Re-seek only when drift exceeds the threshold to avoid stutter.
    if (Math.abs(element.currentTime - sourceTime) > this.resyncThreshold) {
      element.currentTime = sourceTime
    }

    if (isPlaying) {
      // `play()` may reject (autoplay policy, race with pause); swallow it.
      void element.play().catch(() => {})
    } else {
      element.pause()
    }
  }

  private disposeEntry(entry: ActiveEntry): void {
    const { element } = entry
    try {
      element.pause()
    } catch {
      // ignore
    }
    element.src = ''
    try {
      element.load()
    } catch {
      // ignore — `load()` resets the element to release the source.
    }
  }
}
