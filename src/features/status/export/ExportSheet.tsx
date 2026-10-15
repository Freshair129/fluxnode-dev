import { HardDrive, Rocket } from 'lucide-react'
import { canOpenPathInShell } from '../../../services/ipc/app-shell'
import { useProjectStore } from '../../../store/project-store'
import { RenderJobProgress } from '../RenderJobProgress'
import { PanelHeading } from '../shared/PanelPrimitives'
import { DrawerShell } from '../drawers/DrawerShell'

/**
 * MERIDIAN item 9: the `Ctrl+E` export sheet (spec H global keys, J.7 "sheet, not modal"). Composes
 * the old `SystemPanels.tsx` "Export queue" and "Export preset" sections verbatim (same
 * `aria-label="Export queue"` — several e2e specs key off it), sharing `DrawerShell`'s chrome so it
 * gets the same non-`aria-modal`, focus-trapped-while-open, right-edge overlay treatment as the
 * four status-bar drawers, just wider to hold two sections side by side above `lg`.
 */
export function ExportSheet({ onClose, onInspect }: { onClose: () => void; onInspect: (jobId: string) => void }) {
  const queue = useProjectStore((state) => state.project.output.queue)
  const presets = useProjectStore((state) => state.project.output.presets)
  const activePresetId = useProjectStore((state) => state.project.output.activePresetId)
  const enqueueRender = useProjectStore((state) => state.enqueueRender)
  const refreshRenderStatuses = useProjectStore((state) => state.refreshRenderStatuses)
  const pauseActiveRender = useProjectStore((state) => state.pauseActiveRender)
  const resumePausedRender = useProjectStore((state) => state.resumePausedRender)
  const cancelActiveRender = useProjectStore((state) => state.cancelActiveRender)
  const failActiveRender = useProjectStore((state) => state.failActiveRender)
  const simulateCloudNetworkFailure = useProjectStore((state) => state.simulateCloudNetworkFailure)
  const simulateGpuOomFailure = useProjectStore((state) => state.simulateGpuOomFailure)
  const simulateQuotaExceeded = useProjectStore((state) => state.simulateQuotaExceeded)
  const retryFailedRender = useProjectStore((state) => state.retryFailedRender)
  const moveRenderJob = useProjectStore((state) => state.moveRenderJob)
  const openRenderOutput = useProjectStore((state) => state.openRenderOutput)
  const setActiveRenderPreset = useProjectStore((state) => state.setActiveRenderPreset)

  const activePreset = presets.find((preset) => preset.id === activePresetId) ?? presets[0]

  return (
    <DrawerShell icon={Rocket} title="Export" onClose={onClose} widthClassName="w-full max-w-4xl">
      <div className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
        <section aria-label="Export queue" className="rounded-[1.5rem] border border-white/8 bg-[#151618]/90 p-4">
          <PanelHeading icon={Rocket} title="Export Queue" />
          <p aria-live="polite" className="mt-3 text-sm text-[#cbd2dc]">
            {queue.length === 0 ? 'No render jobs yet. Use Queue Render below.' : `${queue.length} render job(s) tracked in the project queue.`}
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            <button type="button" onClick={() => void enqueueRender()} className="rounded-full bg-[#e0ff00] px-4 py-2 text-sm font-semibold text-black">
              Queue Render
            </button>
            <button type="button" onClick={() => void refreshRenderStatuses()} className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm text-white">
              Refresh Status
            </button>
            <button type="button" onClick={() => void pauseActiveRender()} className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm text-white">
              Pause Active
            </button>
            <button type="button" onClick={() => void resumePausedRender()} className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm text-white">
              Resume Paused
            </button>
            <button type="button" onClick={() => void cancelActiveRender()} className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm text-white">
              Cancel Active
            </button>
            <button type="button" onClick={failActiveRender} className="rounded-full border border-red-400/20 bg-red-500/10 px-4 py-2 text-sm text-red-100">
              Simulate Failure
            </button>
            <button type="button" onClick={simulateCloudNetworkFailure} className="rounded-full border border-sky-400/20 bg-sky-500/10 px-4 py-2 text-sm text-sky-100">
              Simulate Network
            </button>
            <button type="button" onClick={simulateGpuOomFailure} className="rounded-full border border-orange-400/20 bg-orange-500/10 px-4 py-2 text-sm text-orange-100">
              Simulate GPU OOM
            </button>
            <button type="button" onClick={simulateQuotaExceeded} className="rounded-full border border-blue-400/20 bg-blue-500/10 px-4 py-2 text-sm text-blue-100">
              Simulate Quota
            </button>
          </div>
          <div className="mt-4 space-y-2">
            {queue.slice(-3).reverse().map((job) => (
              <div key={job.id} className="rounded-xl border border-white/8 bg-black/20 p-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-medium text-white">{job.name}</span>
                  <span className="text-[11px] uppercase tracking-[0.2em] text-[#9ca3af]">{job.status}</span>
                </div>
                <p className="mt-2 text-xs text-[#9ca3af]">
                  {job.config.format.container.toUpperCase()} / {job.config.format.videoCodec ?? 'no-video'} / {job.config.format.audioCodec ?? 'no-audio'} / {job.config.format.quality} -{' '}
                  {job.computeMode}
                </p>
                <RenderJobProgress job={job} />
                <p className="mt-2 text-[11px] leading-5 text-[#9ca3af]">
                  Audio {job.audioMode === 'muxed' ? 'muxed' : 'muted'} - {job.audioSourceSummary}
                </p>
                <p className="mt-2 text-[11px] leading-5 text-[#9ca3af]">
                  {job.config.resolution.width}x{job.config.resolution.height} @ {job.config.frameRate} fps - Range{' '}
                  {typeof job.config.range === 'string' ? job.config.range : `${job.config.range.start}-${job.config.range.end}`} - Denoise{' '}
                  {job.config.denoising ? 'on' : 'off'}
                </p>
                {job.outputFileSize !== null ? (
                  <p className="mt-2 text-[11px] leading-5 text-[#9ca3af]">Output size {(job.outputFileSize / 1024).toFixed(0)} KB</p>
                ) : null}
                {job.autoRetryScheduledFor ? (
                  <p className="mt-2 text-[11px] leading-5 text-[#93c5fd]">
                    Auto retry {job.retryCount}/{job.maxAutoRetries}
                    {job.autoRetryReason === 'gpu_oom' ? ' after reduced-resolution fallback' : ''} scheduled for{' '}
                    {new Date(job.autoRetryScheduledFor).toLocaleTimeString()}
                  </p>
                ) : null}
                {job.didFallbackResolution ? (
                  <p className="mt-2 text-[11px] leading-5 text-[#fdba74]">
                    GPU fallback active{job.originalResolution ? ` · original ${job.originalResolution.width}x${job.originalResolution.height}` : ''}.
                  </p>
                ) : null}
                {job.status === 'failed' || job.status === 'cancelled' ? (
                  <p className="mt-2 text-[11px] leading-5 text-[#9ca3af]">
                    {job.retryCount > 0 && job.maxAutoRetries > 0
                      ? `Auto recovery used ${job.retryCount}/${job.maxAutoRetries} attempt(s). Manual retry resumes from the last completed frame.`
                      : 'Retry resumes from the last completed frame.'}
                  </p>
                ) : null}
                {job.manifestPath ? <p className="mt-2 break-all text-[11px] leading-5 text-[#7f8792]">{job.manifestPath}</p> : null}
                <p className="mt-2 break-all text-[11px] leading-5 text-[#7f8792]">{job.outputPath}</p>
                {job.lastError ? (
                  <p className="mt-2 text-[11px] leading-5 text-[#f9d58b]">
                    {job.errorCategory === 'cloud_quota' ? 'Quota issue' : 'Failure detail'}: {job.lastError}
                  </p>
                ) : null}
                {job.failedFrame !== null ? (
                  <p className="mt-2 text-[11px] leading-5 text-[#9ca3af]">
                    Failed frame {job.failedFrame}
                    {job.resumeFromFrame !== null ? ` - Resume from ${job.resumeFromFrame}` : ''}
                  </p>
                ) : null}
                {job.quotaResetAt ? (
                  <p className="mt-2 text-[11px] leading-5 text-[#93c5fd]">Quota resets {new Date(job.quotaResetAt).toLocaleString()}</p>
                ) : null}
                {job.status === 'failed' || job.status === 'cancelled' ? (
                  <div className="mt-3 flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => onInspect(job.id)}
                      className="rounded-full border border-white/10 bg-white/5 px-3 py-2 text-xs text-white"
                    >
                      Inspect Failure
                    </button>
                    {job.errorCategory !== 'cloud_quota' ? (
                      <button
                        type="button"
                        onClick={() => void retryFailedRender(job.id)}
                        className="rounded-full border border-white/10 bg-white/5 px-3 py-2 text-xs text-white"
                        disabled={Boolean(job.autoRetryScheduledFor)}
                      >
                        Retry Job
                      </button>
                    ) : null}
                  </div>
                ) : null}
                <div className="mt-3 flex flex-wrap gap-2">
                  <button type="button" onClick={() => moveRenderJob(job.id, 'up')} className="rounded-full border border-white/10 bg-transparent px-3 py-2 text-xs text-white/85">
                    Move Up
                  </button>
                  <button type="button" onClick={() => moveRenderJob(job.id, 'down')} className="rounded-full border border-white/10 bg-transparent px-3 py-2 text-xs text-white/85">
                    Move Down
                  </button>
                  {job.status === 'completed' && canOpenPathInShell(job.outputPath) ? (
                    <button
                      type="button"
                      onClick={() => void openRenderOutput(job.id)}
                      className="rounded-full border border-emerald-400/20 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-50"
                    >
                      Open Output
                    </button>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        </section>

        <section aria-label="Export preset" className="rounded-[1.5rem] border border-white/8 bg-[#151618]/90 p-4">
          <PanelHeading icon={HardDrive} title="Export Preset" />
          <div className="mt-3 space-y-2">
            {presets.map((preset) => (
              <button
                key={preset.id}
                type="button"
                onClick={() => setActiveRenderPreset(preset.id)}
                className={`w-full rounded-xl border px-3 py-3 text-left transition ${
                  preset.id === activePresetId ? 'border-[#e0ff00]/45 bg-[#e0ff00]/10 text-white' : 'border-white/8 bg-black/20 text-[#cbd2dc]'
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-medium">{preset.name}</span>
                  <span className="text-[11px] uppercase tracking-[0.2em]">{preset.format}</span>
                </div>
                <p className="mt-2 text-xs leading-5 opacity-80">
                  {preset.videoCodec ?? 'no-video'} / {preset.audioCodec ?? 'no-audio'} / {preset.quality}
                </p>
              </button>
            ))}
          </div>
          {activePreset ? (
            <p className="mt-4 text-xs leading-5 text-[#9ca3af]">
              Active preset: {activePreset.name}, bitrate {activePreset.videoBitrateMbps} Mbps video / {activePreset.audioBitrateKbps} kbps audio,{' '}
              {activePreset.videoCodec ?? 'no video'} + {activePreset.audioCodec ?? 'no audio'} at {activePreset.quality} quality.
            </p>
          ) : null}
        </section>
      </div>
    </DrawerShell>
  )
}
