/**
 * React hook that keeps timeline audio playback in sync with the playhead.
 *
 * Decoupled by design: it accepts plain {@link TimelineAudioParams} rather than
 * reaching into the Zustand store, so the integrator maps store state onto the
 * props. The hook is a thin lifecycle wrapper around {@link TimelineAudioEngine}.
 *
 * Behaviour:
 * - Tauri mode: resolves file paths via `convertFileSrc` and plays/pauses,
 *   seeks, and applies per-clip + track + master volume with mute/solo rules.
 * - Browser mode (no Tauri): no-ops gracefully — no elements are created.
 */

import { useEffect, useMemo, useRef } from 'react'
import { convertFileSrc } from '@tauri-apps/api/core'
import { isTauriRuntime } from '../ipc/tauri-runtime'
import { TimelineAudioEngine, type SourceUrlResolver } from './audio-engine'
import type { TimelineAudioParams } from './types'

export interface UseTimelineAudioOptions {
  /**
   * Override URL resolution. Mainly a testing seam; when omitted the hook uses
   * `convertFileSrc` in Tauri mode and a no-op resolver in the browser.
   */
  resolveUrl?: SourceUrlResolver
  /** Force enable/disable independent of runtime detection (testing seam). */
  enabled?: boolean
}

/**
 * Keep audio playback synced to the timeline. Mount once near the playback
 * surface and feed it the current timeline state on every render.
 */
export function useTimelineAudio(
  params: TimelineAudioParams,
  options: UseTimelineAudioOptions = {},
): void {
  const { clips, playhead, isPlaying, masterVolume, playbackRate = 1 } = params

  const enabled = options.enabled ?? params.enabled ?? isTauriRuntime()

  const resolveUrl = useMemo<SourceUrlResolver>(() => {
    if (options.resolveUrl) return options.resolveUrl
    if (!enabled) return () => null
    return (sourcePath: string) => {
      if (!sourcePath) return null
      try {
        return convertFileSrc(sourcePath)
      } catch {
        return null
      }
    }
  }, [options.resolveUrl, enabled])

  const engineRef = useRef<TimelineAudioEngine | null>(null)

  // Create the engine lazily and tear it down on unmount or resolver change.
  useEffect(() => {
    const engine = new TimelineAudioEngine({ resolveUrl })
    engineRef.current = engine
    return () => {
      engine.dispose()
      engineRef.current = null
    }
  }, [resolveUrl])

  // Reconcile on any input change (playhead tick, play/pause, volume, clips).
  useEffect(() => {
    const engine = engineRef.current
    if (!engine) return
    engine.sync({ clips, playhead, isPlaying, masterVolume, timelineRate: playbackRate })
  }, [clips, playhead, isPlaying, masterVolume, playbackRate])
}
