import { Volume2 } from 'lucide-react'
import { useProjectStore } from '../../../store/project-store'
import { DrawerShell } from './DrawerShell'

/**
 * MERIDIAN item 9: relocated verbatim content from `SystemPanels.tsx`'s "Audio and runtime issues"
 * section. `onInspect` re-opens `FailureInspectorModal` for a `cloud_quota`/`render_failed` app
 * error — the same shared `activeInspectorJobId` open-signal the export sheet's "Inspect Failure"
 * button also drives (both now live in `StatusOverlays`, the surfaces' common ancestor).
 */
export function AudioRuntimeDrawer({ onClose, onInspect }: { onClose: () => void; onInspect: (jobId: string) => void }) {
  const audio = useProjectStore((state) => state.project.audio)
  const scrubPreviewState = useProjectStore((state) => state.ui.scrubPreviewState)
  const runtimeHealth = useProjectStore((state) => state.runtimeHealth)
  const viewSwitchMetric = useProjectStore((state) => state.ui.viewSwitchMetric)
  const runtimeCacheMetrics = useProjectStore((state) => state.runtimeCacheMetrics)
  const previewFrameCount = useProjectStore((state) => Object.keys(state.previewFrames).length)
  const nodePreviewCount = useProjectStore((state) => Object.keys(state.nodePreviewFrames).length)
  const waveformCacheCount = useProjectStore((state) => Object.keys(state.waveformCache).length)
  const assetThumbnailCount = useProjectStore((state) => Object.keys(state.assetThumbnails).length)
  const tracks = useProjectStore((state) => state.project.timeline.tracks)
  const errors = useProjectStore((state) => state.appErrors)
  const setMasterVolume = useProjectStore((state) => state.setMasterVolume)
  const toggleScrubEnabled = useProjectStore((state) => state.toggleScrubEnabled)
  const cycleWaveformDensity = useProjectStore((state) => state.cycleWaveformDensity)
  const clearRuntimeCaches = useProjectStore((state) => state.clearRuntimeCaches)
  const performAppErrorAction = useProjectStore((state) => state.performAppErrorAction)
  const dismissAppError = useProjectStore((state) => state.dismissAppError)
  const clearResolvedErrors = useProjectStore((state) => state.clearResolvedErrors)

  const soloTracks = tracks.filter((track) => track.solo)
  const audibleTracks = tracks.filter(
    (track) => track.type === 'audio' && !track.muted && (soloTracks.length === 0 || track.solo),
  )
  const audibleClipCount = audibleTracks.reduce((sum, track) => sum + track.clips.length, 0)
  const weightedTrackGain = audibleTracks.reduce((sum, track) => sum + track.volume, 0)
  const averagePan =
    audibleTracks.length > 0 ? audibleTracks.reduce((sum, track) => sum + track.pan, 0) / audibleTracks.length : 0

  return (
    <DrawerShell icon={Volume2} title="Audio + Errors" onClose={onClose} widthClassName="w-full max-w-md">
      <p className="text-xs leading-5 text-[#9ca3af]">
        Master volume {(audio.masterVolume * 100).toFixed(0)}% - Scrub {audio.scrubEnabled ? 'on' : 'off'} - Waveform {audio.waveformDensity}
        {scrubPreviewState.active ? ` - ${scrubPreviewState.mode} ${scrubPreviewState.speed.toFixed(2)}x` : ''}
      </p>
      <p className="mt-2 text-xs leading-5 text-[#9ca3af]">
        Device memory {runtimeHealth.deviceMemoryGb ?? '?'} GB - Last health check{' '}
        {runtimeHealth.lastCheckedAt ? new Date(runtimeHealth.lastCheckedAt).toLocaleTimeString() : 'pending'}
      </p>
      <div className="mt-4 rounded-[1.25rem] border border-white/8 bg-black/20 p-3">
        <p className="text-[11px] uppercase tracking-[0.22em] text-[#7f8691]">Live Mix</p>
        <p className="mt-2 text-sm text-white">
          {audibleTracks.length} audible audio track{audibleTracks.length === 1 ? '' : 's'} / {audibleClipCount} clip
          {audibleClipCount === 1 ? '' : 's'}
        </p>
        <p className="mt-2 text-xs leading-5 text-[#9ca3af]">
          {soloTracks.length > 0 ? `${soloTracks.length} track${soloTracks.length === 1 ? '' : 's'} in solo mode` : 'No solo tracks active'}
          {' - '}
          {tracks.filter((track) => track.muted).length} muted track{tracks.filter((track) => track.muted).length === 1 ? '' : 's'}
        </p>
        <p className="mt-2 text-xs leading-5 text-[#9ca3af]">
          Aggregate track gain {weightedTrackGain.toFixed(2)}x - Average pan {averagePan.toFixed(2)}
        </p>
      </div>
      <div className="mt-4 space-y-3 rounded-[1.25rem] border border-white/8 bg-black/20 p-3">
        <label className="block text-[11px] uppercase tracking-[0.22em] text-[#7f8691]">Master Volume</label>
        <input
          type="range"
          min={0}
          max={1}
          step={0.05}
          value={audio.masterVolume}
          onChange={(event) => setMasterVolume(Number(event.target.value))}
          aria-label="Master volume"
          className="w-full accent-[#e0ff00]"
        />
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={toggleScrubEnabled} aria-pressed={audio.scrubEnabled} className="rounded-full border border-white/10 bg-white/5 px-3 py-2 text-xs text-white">
            Scrub {audio.scrubEnabled ? 'On' : 'Off'}
          </button>
          <button type="button" onClick={cycleWaveformDensity} className="rounded-full border border-white/10 bg-white/5 px-3 py-2 text-xs text-white">
            Waveform {audio.waveformDensity}
          </button>
        </div>
      </div>
      <div className="mt-4 rounded-[1.25rem] border border-white/8 bg-black/20 p-3">
        <p className="text-[11px] uppercase tracking-[0.22em] text-[#7f8691]">Runtime Cache</p>
        <p className="mt-2 text-xs leading-5 text-[#9ca3af]">
          Preview {previewFrameCount} - Node {nodePreviewCount} - Waveform {waveformCacheCount} - Thumbnails {assetThumbnailCount} - Approx{' '}
          {runtimeCacheMetrics.estimatedUsageMb.toFixed(1)} MB
        </p>
        <p className="mt-2 text-xs leading-5 text-[#9ca3af]">
          {runtimeCacheMetrics.hardLimitExceeded
            ? 'Hard memory limit reached: new preview and waveform allocations are paused.'
            : runtimeCacheMetrics.softLimitExceeded
              ? 'Soft memory limit reached: FluxNode is evicting old cache entries.'
              : 'Memory budget is within the balanced operating range.'}
        </p>
        <button type="button" onClick={clearRuntimeCaches} className="mt-3 rounded-full border border-white/10 bg-white/5 px-3 py-2 text-xs text-white">
          Clear Caches
        </button>
      </div>
      <div className="mt-4 rounded-[1.25rem] border border-white/8 bg-black/20 p-3">
        <p className="text-[11px] uppercase tracking-[0.22em] text-[#7f8691]">View Switch Telemetry</p>
        <p className="mt-2 text-xs leading-5 text-[#9ca3af]">
          {viewSwitchMetric.durationMs !== null && viewSwitchMetric.fromView && viewSwitchMetric.toView
            ? `${viewSwitchMetric.fromView} -> ${viewSwitchMetric.toView} in ${viewSwitchMetric.durationMs.toFixed(1)} ms`
            : 'Switch between Timeline and Workflow to capture latency.'}
        </p>
        <p className="mt-2 text-xs leading-5 text-[#9ca3af]">
          {viewSwitchMetric.measuredAt ? `Last measured ${new Date(viewSwitchMetric.measuredAt).toLocaleTimeString()}` : 'No runtime measurement captured yet.'}
        </p>
      </div>
      <div className="mt-4 space-y-2">
        {errors.length === 0 ? (
          <div className="rounded-xl border border-emerald-400/15 bg-emerald-500/10 p-3 text-sm text-emerald-50">No active resilience issues.</div>
        ) : (
          errors.slice(-3).reverse().map((error) => (
            <div
              key={error.id}
              className={`rounded-xl border p-3 text-sm ${
                error.recoverable ? 'border-amber-300/20 bg-amber-500/10 text-amber-50' : 'border-red-400/20 bg-red-500/10 text-red-100'
              }`}
            >
              <p className="font-medium">{error.userMessage}</p>
              <p className="mt-1 text-[10px] uppercase tracking-[0.18em] opacity-70">{error.category}</p>
              <p className="mt-1 text-xs opacity-80">{error.suggestedAction}</p>
              <div className="mt-3 flex flex-wrap gap-2">
                {error.actionLabel && error.actionCommand ? (
                  <button
                    type="button"
                    onClick={() => void performAppErrorAction(error.id)}
                    className="rounded-full border border-white/10 bg-white/10 px-3 py-2 text-xs text-white"
                  >
                    {error.actionLabel}
                  </button>
                ) : null}
                {(error.category === 'cloud_quota' || error.category === 'render_failed') && error.contextId ? (
                  <button
                    type="button"
                    onClick={() => onInspect(error.contextId as string)}
                    className="rounded-full border border-white/10 bg-transparent px-3 py-2 text-xs text-white/85"
                  >
                    Inspect
                  </button>
                ) : null}
                <button
                  type="button"
                  onClick={() => dismissAppError(error.id)}
                  className="rounded-full border border-white/10 bg-transparent px-3 py-2 text-xs text-white/85"
                >
                  Dismiss
                </button>
              </div>
            </div>
          ))
        )}
      </div>
      <button type="button" onClick={clearResolvedErrors} className="mt-4 rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm text-white">
        Clear Resolved
      </button>
    </DrawerShell>
  )
}
