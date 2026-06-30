import { useEffect, useRef } from 'react'
import { Film, HardDrive, Link2, PlayCircle, Sparkles } from 'lucide-react'
import { useProjectStore } from '../../store/project-store'

const PREVIEW_WIDTH = 960
const PREVIEW_HEIGHT = 540
const PREVIEW_PREFETCH_FRAMES = 30
// Minimum gap between decode requests while the timeline is actively shuttling,
// so rapid playhead ticks during playback/scrubbing don't flood the backend.
const PREVIEW_DECODE_THROTTLE_MS = 120

export function PreviewPanel() {
  const project = useProjectStore((state) => state.project)
  const runtimeHealth = useProjectStore((state) => state.runtimeHealth)
  const activeView = useProjectStore((state) => state.ui.activeView)
  const selectedClipId = useProjectStore((state) => state.ui.selectedClipId)
  const selectedNodeId = useProjectStore((state) => state.ui.selectedNodeId)
  const playbackState = useProjectStore((state) => state.ui.playbackState)
  const playhead = useProjectStore((state) => state.project.timeline.playhead)
  const previewFrames = useProjectStore((state) => state.previewFrames)
  const loadPreviewFrameForSelectedClip = useProjectStore((state) => state.loadPreviewFrameForSelectedClip)
  const generateProxyForSelectedClip = useProjectStore((state) => state.generateProxyForSelectedClip)
  const showSelectedClipInWorkflow = useProjectStore((state) => state.showSelectedClipInWorkflow)
  const showSelectedNodeInTimeline = useProjectStore((state) => state.showSelectedNodeInTimeline)
  const activeJob = useProjectStore((state) =>
    [...state.project.output.queue].reverse().find((job) => job.status === 'rendering' || job.status === 'queued' || job.status === 'completed'),
  )

  const selectedClip = project.timeline.tracks
    .flatMap((track) => track.clips)
    .find((clip) => clip.id === selectedClipId)
  const selectedAsset = selectedClip ? project.assets.assets[selectedClip.assetId] : null
  const selectedNode = project.workflow.nodes.find((node) => node.id === selectedNodeId) ?? null
  const outputNode = project.workflow.nodes.find((node) => node.type === 'output') ?? null
  const routedNode =
    outputNode
      ? project.workflow.edges.find((edge) => edge.target === outputNode.id)?.source ?? null
      : null
  const routedWorkflowNode = routedNode
    ? project.workflow.nodes.find((node) => node.id === routedNode) ?? null
    : null

  const previewTitle =
    activeView === 'timeline'
      ? selectedAsset?.name ?? 'Timeline monitor'
      : selectedNode?.label ?? routedWorkflowNode?.label ?? 'Workflow monitor'
  const previewSubtitle =
    activeView === 'timeline'
      ? selectedAsset
        ? `${selectedAsset.type} source linked for editorial review`
        : 'Select a clip to inspect its linked media'
      : selectedNode
        ? `${selectedNode.type.replace('_', ' ')} node selected${selectedNode.bypassed ? ' (bypassed)' : ''}`
        : routedWorkflowNode
          ? `Output currently routes from ${routedWorkflowNode.label ?? routedWorkflowNode.id}${routedWorkflowNode.bypassed ? ' (bypassed)' : ''}`
          : 'Connect a node to output to stage the final composite'

  const requestedSourceTime =
    selectedClip
      ? Number((selectedClip.inPoint + Math.max(0, playhead - selectedClip.startTime) * selectedClip.speed).toFixed(2))
      : null
  const requestScale = runtimeHealth.vramUtilizationPct !== null && runtimeHealth.vramUtilizationPct >= 90 ? 0.5 : 1
  const requestWidth = Math.max(256, Math.round(PREVIEW_WIDTH * requestScale))
  const requestHeight = Math.max(144, Math.round(PREVIEW_HEIGHT * requestScale))
  const effectivePreviewSource =
    selectedAsset && project.settings.proxyEnabled && selectedAsset.preferProxyForEditing && selectedAsset.proxyPath
      ? selectedAsset.proxyPath
      : selectedAsset?.sourcePath ?? null
  const previewFrameKey =
    selectedAsset && requestedSourceTime !== null && effectivePreviewSource
      ? `${selectedAsset.id}:${effectivePreviewSource}:${requestedSourceTime}:${requestWidth}x${requestHeight}`
      : null
  const previewFrame = previewFrameKey ? previewFrames[previewFrameKey] ?? null : null
  const bufferedFrameCount =
    selectedAsset && effectivePreviewSource
      ? Object.keys(previewFrames).filter((key) => key.startsWith(`${selectedAsset.id}:${effectivePreviewSource}:`) && key.endsWith(`:${requestWidth}x${requestHeight}`)).length
      : 0

  const lastDecodeAtRef = useRef(0)
  const lastDecodedTimeRef = useRef<number | null>(null)
  const trailingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const isVisualClip =
    activeView === 'timeline' &&
    !!selectedClip &&
    !!selectedAsset &&
    (selectedAsset.type === 'video' || selectedAsset.type === 'image')
  const isPlaying = playbackState === 'playing' || playbackState === 'reverse'

  useEffect(() => {
    if (!isVisualClip) {
      lastDecodedTimeRef.current = null
      return
    }

    // Only re-decode when the requested source time actually changes — avoids
    // redundant decode calls when unrelated state updates re-run this effect.
    if (requestedSourceTime !== null && requestedSourceTime === lastDecodedTimeRef.current) {
      return
    }

    const runDecode = () => {
      lastDecodeAtRef.current = Date.now()
      lastDecodedTimeRef.current = requestedSourceTime
      void loadPreviewFrameForSelectedClip(PREVIEW_WIDTH, PREVIEW_HEIGHT)
    }

    // Throttle while shuttling: cap decode frequency but always schedule a
    // trailing decode so the final settled position still renders a fresh frame.
    if (isPlaying) {
      const elapsed = Date.now() - lastDecodeAtRef.current

      if (elapsed >= PREVIEW_DECODE_THROTTLE_MS) {
        runDecode()
      } else {
        if (trailingTimerRef.current) {
          clearTimeout(trailingTimerRef.current)
        }
        trailingTimerRef.current = setTimeout(() => {
          trailingTimerRef.current = null
          runDecode()
        }, PREVIEW_DECODE_THROTTLE_MS - elapsed)
      }
      return
    }

    // Paused / single seek: decode immediately for a responsive scrub.
    runDecode()
  }, [isVisualClip, isPlaying, loadPreviewFrameForSelectedClip, requestedSourceTime])

  useEffect(
    () => () => {
      if (trailingTimerRef.current) {
        clearTimeout(trailingTimerRef.current)
      }
    },
    [],
  )

  return (
    <section
      aria-label="Preview monitor"
      className="rounded-[2rem] border border-white/10 bg-[#111315]/90 p-4 shadow-[0_18px_60px_rgba(0,0,0,0.35)] backdrop-blur-xl"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-[11px] uppercase tracking-[0.28em] text-[#7f8691]">Preview Monitor</p>
          <h2 className="mt-2 font-display text-2xl font-semibold text-white">{previewTitle}</h2>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-[#98a1ad]">{previewSubtitle}</p>
        </div>
        <div
          aria-live="polite"
          aria-label={`Playback ${playbackState} at ${playhead.toFixed(2)} seconds`}
          className="rounded-full border border-[#e0ff00]/20 bg-[#e0ff00]/10 px-4 py-2 text-xs uppercase tracking-[0.22em] text-[#f5ffd5]"
        >
          {playbackState} at {playhead.toFixed(2)}s
        </div>
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1.35fr)_minmax(280px,0.65fr)]">
        <div className="relative min-h-[280px] overflow-hidden rounded-[1.6rem] border border-white/8 bg-[radial-gradient(circle_at_top,rgba(59,130,246,0.16),transparent_35%),linear-gradient(180deg,#090a0c_0%,#13161b_100%)] p-5">
          <div aria-hidden="true" className="absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.04)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.04)_1px,transparent_1px)] bg-[size:42px_42px] opacity-20" />
          <div className="relative flex h-full flex-col justify-between">
            <div className="flex items-center gap-2 text-xs uppercase tracking-[0.22em] text-[#bfc7d2]">
              <PlayCircle size={15} className="text-[#e0ff00]" aria-hidden="true" />
              Decoded preview frame
            </div>

            <div className="rounded-[1.5rem] border border-white/10 bg-black/30 p-5">
              <div className="aspect-video overflow-hidden rounded-[1.2rem] border border-white/10 bg-[#0c0d0f]">
                {previewFrame ? (
                  <img
                    src={previewFrame.dataUrl}
                    alt={`${previewTitle} preview`}
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <div className="flex h-full flex-col justify-between p-4">
                    <div className="flex items-center justify-between gap-3 text-xs uppercase tracking-[0.2em] text-[#8d96a2]">
                      <span>{project.settings.resolution.width} x {project.settings.resolution.height}</span>
                      <span>{project.settings.frameRate} fps</span>
                    </div>
                    <div className="text-center">
                      <Film size={34} className="mx-auto text-[#e0ff00]" aria-hidden="true" />
                      <p className="mt-4 text-lg font-semibold text-white">{previewTitle}</p>
                      <p className="mt-2 text-sm leading-6 text-[#aab3bf]">
                        {effectivePreviewSource ?? routedWorkflowNode?.id ?? 'No preview source selected yet.'}
                      </p>
                    </div>
                    <div className="flex items-center justify-between gap-3 text-xs text-[#9ca3af]">
                      <span>Waiting for decoded frame</span>
                      <span>{requestedSourceTime !== null ? `${requestedSourceTime.toFixed(2)}s source` : 'No source time'}</span>
                    </div>
                  </div>
                )}
              </div>
            </div>

            <p className="mt-4 text-xs leading-5 text-[#7f8792]">
              The monitor now requests a decoded frame for the selected visual clip and current playhead position, preferring proxy media during editing when proxy mode is enabled.
            </p>
          </div>
        </div>

        <aside aria-label="Preview details" className="grid gap-3">
          <MetricCard
            icon={Link2}
            label="Output Route"
            value={routedWorkflowNode?.label ?? routedWorkflowNode?.id ?? 'Unrouted'}
            note={outputNode ? `Output node ${outputNode.label ?? outputNode.id} is available.` : 'Output node missing from graph.'}
          />
          <MetricCard
            icon={Sparkles}
            label="Selection"
            value={selectedAsset?.name ?? selectedNode?.label ?? 'No active selection'}
            note={selectedAsset ? selectedAsset.sourcePath : selectedNode ? selectedNode.type.replace('_', ' ') : 'Select a clip or node to inspect context.'}
          />
          <MetricCard
            icon={HardDrive}
            label="Preview Source"
            value={requestedSourceTime !== null ? `${requestedSourceTime.toFixed(2)}s` : 'No source time'}
            note={
              runtimeHealth.vramUtilizationPct !== null && runtimeHealth.vramUtilizationPct >= 95
                ? 'Preview decode paused because VRAM usage crossed the 95% safety threshold.'
                : runtimeHealth.vramUtilizationPct !== null && runtimeHealth.vramUtilizationPct >= 90
                  ? `Preview resolution reduced automatically to ${requestWidth}x${requestHeight} while VRAM is at ${runtimeHealth.vramUtilizationPct.toFixed(1)}%.`
                  : effectivePreviewSource ?? previewFrame?.mimeType ?? 'Decoded frame metadata will appear here once a visual clip is selected.'
            }
          />
          <MetricCard
            icon={HardDrive}
            label="Preview Buffer"
            value={selectedAsset?.type === 'video' ? `${bufferedFrameCount}/${PREVIEW_PREFETCH_FRAMES * 2 + 1} frames` : previewFrame ? '1 frame ready' : 'Idle'}
            note={
              selectedAsset?.type === 'video'
                ? 'FluxNode now prefetches an on-demand frame window around the playhead to keep shuttle and scrubbing previews responsive.'
                : 'Still images only need the current decoded frame.'
            }
          />
          <MetricCard
            icon={HardDrive}
            label="Proxy Mode"
            value={project.settings.proxyEnabled ? 'Enabled' : 'Disabled'}
            note={
              selectedAsset?.proxyPath
                ? `Proxy ready at ${selectedAsset.proxyPath}`
                : selectedAsset?.type === 'video'
                  ? 'No proxy yet. Generate one for smoother editing.'
                  : 'Proxy generation is only used for video assets.'
            }
          />
          <MetricCard
            icon={HardDrive}
            label="Latest Export"
            value={activeJob?.name ?? 'No export started'}
            note={activeJob?.manifestPath ?? 'Queue a render to produce an export handoff manifest.'}
          />
          {selectedAsset?.type === 'video' && !selectedAsset.proxyPath ? (
            <button
              type="button"
              onClick={() => void generateProxyForSelectedClip()}
              className="rounded-[1.2rem] border border-[#e0ff00]/20 bg-[#e0ff00]/10 px-4 py-3 text-left text-sm text-[#f5ffd5]"
            >
              Generate proxy for this clip
            </button>
          ) : null}
          {activeView === 'timeline' && selectedClip ? (
            <button
              type="button"
              onClick={showSelectedClipInWorkflow}
              className="rounded-[1.2rem] border border-white/10 bg-white/5 px-4 py-3 text-left text-sm text-white"
            >
              Show linked workflow node
            </button>
          ) : null}
          {activeView === 'workflow' && selectedNode ? (
            <button
              type="button"
              onClick={showSelectedNodeInTimeline}
              className="rounded-[1.2rem] border border-white/10 bg-white/5 px-4 py-3 text-left text-sm text-white"
            >
              Show linked timeline clip
            </button>
          ) : null}
        </aside>
      </div>
    </section>
  )
}

function MetricCard({
  icon: Icon,
  label,
  value,
  note,
}: {
  icon: React.ComponentType<{ size?: number; className?: string }>
  label: string
  value: string
  note: string
}) {
  return (
    <div className="rounded-[1.4rem] border border-white/8 bg-[#17181b] p-4">
      <div className="flex items-center gap-3">
        <Icon size={18} className="text-[#e0ff00]" aria-hidden="true" />
        <p className="text-[11px] uppercase tracking-[0.22em] text-[#7f8691]">{label}</p>
      </div>
      <p className="mt-3 text-sm font-medium text-white">{value}</p>
      <p className="mt-2 break-all text-xs leading-5 text-[#9ca3af]">{note}</p>
    </div>
  )
}
