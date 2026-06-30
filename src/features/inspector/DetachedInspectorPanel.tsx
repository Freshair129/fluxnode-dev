import { useEffect, useMemo, useRef, useState } from 'react'
import { Link2, Layers3, PlaySquare, SlidersHorizontal } from 'lucide-react'
import type { AudioMixInputSetting, UniformValue, WorkflowNode } from '../../domain/project/types'
import { useProjectStore } from '../../store/project-store'

export function DetachedInspectorPanel() {
  const project = useProjectStore((state) => state.project)
  const selectedNodeId = useProjectStore((state) => state.ui.selectedNodeId)
  const selectedClipId = useProjectStore((state) => state.ui.selectedClipId)
  const nodePreviewFrames = useProjectStore((state) => state.nodePreviewFrames)
  const loadPreviewFrameForSelectedNode = useProjectStore((state) => state.loadPreviewFrameForSelectedNode)
  const setSelectedClipSpeed = useProjectStore((state) => state.setSelectedClipSpeed)
  const setSelectedClipVolume = useProjectStore((state) => state.setSelectedClipVolume)
  const setSelectedClipOpacity = useProjectStore((state) => state.setSelectedClipOpacity)
  const setSelectedClipStartTime = useProjectStore((state) => state.setSelectedClipStartTime)
  const setSelectedClipDuration = useProjectStore((state) => state.setSelectedClipDuration)
  const setSelectedClipInPoint = useProjectStore((state) => state.setSelectedClipInPoint)
  const setSelectedClipOutPoint = useProjectStore((state) => state.setSelectedClipOutPoint)
  const setSelectedClipTransformField = useProjectStore((state) => state.setSelectedClipTransformField)
  const addSelectedClipKeyframe = useProjectStore((state) => state.addSelectedClipKeyframe)
  const updateSelectedClipKeyframe = useProjectStore((state) => state.updateSelectedClipKeyframe)
  const removeSelectedClipKeyframe = useProjectStore((state) => state.removeSelectedClipKeyframe)
  const setSelectedNodeLabel = useProjectStore((state) => state.setSelectedNodeLabel)
  const setNodeDataField = useProjectStore((state) => state.setNodeDataField)
  const toggleSelectedNodeCollapsed = useProjectStore((state) => state.toggleSelectedNodeCollapsed)
  const toggleSelectedNodeBypass = useProjectStore((state) => state.toggleSelectedNodeBypass)
  const setSelectedNodeComputeSource = useProjectStore((state) => state.setSelectedNodeComputeSource)
  const simulateSelectedNodeExecutionFailure = useProjectStore((state) => state.simulateSelectedNodeExecutionFailure)
  const clearSelectedNodeExecutionFailure = useProjectStore((state) => state.clearSelectedNodeExecutionFailure)

  const selectedNode = project.workflow.nodes.find((node) => node.id === selectedNodeId) ?? null
  const selectedClip = project.timeline.tracks.flatMap((track) => track.clips).find((clip) => clip.id === selectedClipId) ?? null
  const selectedClipAsset = selectedClip ? project.assets.assets[selectedClip.assetId] ?? null : null
  const selectedNodeTimelineClipId =
    selectedNode && 'timelineClipId' in selectedNode.data && typeof selectedNode.data.timelineClipId === 'string'
      ? selectedNode.data.timelineClipId
      : null
  const linkedClip =
    selectedNodeTimelineClipId
      ? project.timeline.tracks.flatMap((track) => track.clips).find((clip) => clip.id === selectedNodeTimelineClipId) ?? null
      : null
  const linkedNode =
    selectedClip?.workflowNodeId
      ? project.workflow.nodes.find((node) => node.id === selectedClip.workflowNodeId) ?? null
      : null
  const nodePreview = selectedNode ? nodePreviewFrames[selectedNode.id] ?? null : null
  const [nodeLabelDraft, setNodeLabelDraft] = useState('')
  const pendingNodeDataWritesRef = useRef<Map<string, unknown>>(new Map())
  const pendingNodeDataTimerRef = useRef<number | null>(null)
  const pendingNodeDataTargetIdRef = useRef<string | null>(null)

  const selectedTrack = useMemo(
    () => (selectedClip ? project.timeline.tracks.find((track) => track.id === selectedClip.trackId) ?? null : null),
    [project.timeline.tracks, selectedClip],
  )
  const sortedClipKeyframes = useMemo(
    () => [...(selectedClip?.keyframes ?? [])].sort((left, right) => left.time - right.time || left.property.localeCompare(right.property)),
    [selectedClip?.keyframes],
  )
  const nodeComputeSource =
    selectedNode && (selectedNode.type === 'ai_generate' || selectedNode.type === 'ai_upscale') && 'computeSource' in selectedNode.data
      ? selectedNode.data.computeSource
      : null

  useEffect(() => {
    if (!selectedNode) {
      return
    }

    void loadPreviewFrameForSelectedNode(512, 512)
  }, [loadPreviewFrameForSelectedNode, selectedNode])

  useEffect(() => {
    setNodeLabelDraft(selectedNode?.label ?? '')
  }, [selectedNode?.id, selectedNode?.label])

  useEffect(() => {
    if (pendingNodeDataTimerRef.current === null || pendingNodeDataWritesRef.current.size === 0) {
      return
    }

    window.clearTimeout(pendingNodeDataTimerRef.current)
    pendingNodeDataTimerRef.current = null

    const targetNodeId = pendingNodeDataTargetIdRef.current

    if (targetNodeId) {
      for (const [path, value] of pendingNodeDataWritesRef.current.entries()) {
        setNodeDataField(targetNodeId, path, value)
      }
    }

    pendingNodeDataWritesRef.current.clear()
    pendingNodeDataTargetIdRef.current = null
  }, [selectedNode?.id, setNodeDataField])

  useEffect(
    () => () => {
      if (pendingNodeDataTimerRef.current !== null) {
        window.clearTimeout(pendingNodeDataTimerRef.current)
      }

      const targetNodeId = pendingNodeDataTargetIdRef.current

      if (targetNodeId) {
        for (const [path, value] of pendingNodeDataWritesRef.current.entries()) {
          setNodeDataField(targetNodeId, path, value)
        }
      }

      pendingNodeDataWritesRef.current.clear()
      pendingNodeDataTimerRef.current = null
      pendingNodeDataTargetIdRef.current = null
    },
    [setNodeDataField],
  )

  function scheduleSelectedNodeDataField(path: string, value: unknown) {
    if (!selectedNode) {
      return
    }

    if (pendingNodeDataTargetIdRef.current && pendingNodeDataTargetIdRef.current !== selectedNode.id) {
      for (const [pendingPath, pendingValue] of pendingNodeDataWritesRef.current.entries()) {
        setNodeDataField(pendingNodeDataTargetIdRef.current, pendingPath, pendingValue)
      }

      pendingNodeDataWritesRef.current.clear()
    }

    pendingNodeDataTargetIdRef.current = selectedNode.id
    pendingNodeDataWritesRef.current.set(path, value)

    if (pendingNodeDataTimerRef.current !== null) {
      return
    }

    pendingNodeDataTimerRef.current = window.setTimeout(() => {
      pendingNodeDataTimerRef.current = null

      const targetNodeId = pendingNodeDataTargetIdRef.current

      if (targetNodeId) {
        for (const [pendingPath, pendingValue] of pendingNodeDataWritesRef.current.entries()) {
          setNodeDataField(targetNodeId, pendingPath, pendingValue)
        }
      }

      pendingNodeDataWritesRef.current.clear()
      pendingNodeDataTargetIdRef.current = null
    }, 16)
  }

  return (
    <section className="rounded-[1.75rem] border border-white/10 bg-[#111214] p-5 shadow-[0_20px_60px_rgba(0,0,0,0.35)]">
      <p className="text-[11px] uppercase tracking-[0.28em] text-[#7f8691]">Detached Inspector</p>
      <h2 className="mt-2 text-2xl font-semibold text-white">Selection properties</h2>
      <div className="mt-5 overflow-hidden rounded-[1.5rem] border border-white/8 bg-black/20 p-4">
        <p className="text-[11px] uppercase tracking-[0.22em] text-[#7f8691]">Node Preview</p>
        <div className="mt-3 aspect-square overflow-hidden rounded-[1.2rem] border border-white/10 bg-[#0c0d0f]">
          {nodePreview ? (
            <img
              src={nodePreview.dataUrl}
              alt={`${selectedNode?.label ?? selectedNode?.id ?? 'Selected node'} preview`}
              className="h-full w-full object-cover"
            />
          ) : (
            <div className="flex h-full items-center justify-center px-6 text-center text-sm leading-6 text-[#9ca3af]">
              {selectedNode
                ? 'Preview is being prepared for the selected node.'
                : 'Select a workflow node to inspect its cached preview.'}
            </div>
          )}
        </div>
        <p className="mt-3 text-xs leading-5 text-[#8f97a2]">
          Node previews are capped at 512x512 and cached per node signature so they only regenerate when inputs change.
        </p>
      </div>
      <div className="mt-5 grid gap-4">
        <InspectorCard
          icon={Layers3}
          label="Workflow Node"
          title={selectedNode?.label ?? 'No node selected'}
          note={selectedNode ? `${selectedNode.type} at ${selectedNode.position.x}, ${selectedNode.position.y}` : 'Select a node in the main window to inspect it here.'}
        />
        <InspectorCard
          icon={PlaySquare}
          label="Timeline Clip"
          title={selectedClip?.id ?? linkedClip?.id ?? 'No clip selected'}
          note={
            selectedClip
              ? `${selectedClip.startTime.toFixed(2)}s to ${(selectedClip.startTime + selectedClip.duration).toFixed(2)}s`
              : linkedClip
                ? `Linked clip from selected node on ${linkedClip.trackId}`
                : 'Select a clip in the main window to inspect it here.'
          }
        />
        <InspectorCard
          icon={Link2}
          label="Linked Pair"
          title={linkedNode?.label ?? linkedClip?.id ?? 'No link active'}
          note={
            linkedNode
              ? `Clip routes to ${linkedNode.type}`
              : linkedClip
                ? 'Selected node is linked to this timeline clip.'
                : 'Timeline and workflow links will appear here when available.'
          }
        />
      </div>
      <div className="mt-5 grid gap-4 xl:grid-cols-2">
        <section className="rounded-[1.4rem] border border-white/8 bg-black/20 p-4">
          <div className="flex items-center gap-3">
            <Layers3 size={18} className="text-[#e0ff00]" />
            <p className="text-[11px] uppercase tracking-[0.22em] text-[#7f8691]">Node Properties</p>
          </div>
          {selectedNode ? (
            <div className="mt-4 space-y-4">
              <label className="block">
                <span className="text-[11px] uppercase tracking-[0.18em] text-[#7f8691]">Label</span>
                <input
                  value={nodeLabelDraft}
                  onChange={(event) => setNodeLabelDraft(event.target.value)}
                  onBlur={() => setSelectedNodeLabel(nodeLabelDraft)}
                  className="mt-2 w-full rounded-[1rem] border border-white/10 bg-[#111214] px-4 py-3 text-sm text-white outline-none"
                />
              </label>
              <div className="grid gap-3 md:grid-cols-2">
                <Metric label="Node ID" value={selectedNode.id} />
                <Metric label="Type" value={selectedNode.type} />
                <Metric label="Position" value={`${selectedNode.position.x}, ${selectedNode.position.y}`} />
                <Metric label="Bypass" value={selectedNode.bypassed ? 'Enabled' : 'Disabled'} />
                <Metric label="Execution" value={selectedNode.executionError ? 'Failed' : 'Healthy'} />
                <Metric label="Ports" value={`${'inputs' in selectedNode.data ? '?' : ''}${project.workflow.edges.filter((edge) => edge.source === selectedNode.id || edge.target === selectedNode.id).length} linked edges`} />
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={toggleSelectedNodeCollapsed}
                  className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm text-white"
                >
                  {selectedNode.collapsed ? 'Expand Node' : 'Collapse Node'}
                </button>
                <button
                  type="button"
                  onClick={toggleSelectedNodeBypass}
                  disabled={selectedNode.type === 'output' || selectedNode.type === 'media_source'}
                  className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm text-white disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {selectedNode.bypassed ? 'Enable Node' : 'Bypass Node'}
                </button>
                <button
                  type="button"
                  onClick={selectedNode.executionError ? clearSelectedNodeExecutionFailure : simulateSelectedNodeExecutionFailure}
                  className={`rounded-full border px-4 py-2 text-sm ${
                    selectedNode.executionError
                      ? 'border-red-400/30 bg-red-500/10 text-red-100'
                      : 'border-white/10 bg-white/5 text-white'
                  }`}
                >
                  {selectedNode.executionError ? 'Clear Comfy Failure' : 'Simulate Comfy Failure'}
                </button>
              </div>
              {selectedNode.executionError ? (
                <div className="rounded-[1.1rem] border border-red-400/25 bg-red-500/10 p-4">
                  <p className="text-[11px] uppercase tracking-[0.18em] text-red-100">Execution Error</p>
                  <p className="mt-3 text-sm font-medium text-white">{selectedNode.executionError.message}</p>
                  {selectedNode.executionError.detail ? (
                    <p className="mt-2 text-sm leading-6 text-red-50/90">{selectedNode.executionError.detail}</p>
                  ) : null}
                  <p className="mt-3 text-xs uppercase tracking-[0.16em] text-red-100/80">
                    Failed at {new Date(selectedNode.executionError.failedAt).toLocaleString()}
                  </p>
                </div>
              ) : null}
              {nodeComputeSource ? (
                <div className="rounded-[1.1rem] border border-white/8 bg-[#111214] p-4">
                  <p className="text-[11px] uppercase tracking-[0.18em] text-[#7f8691]">AI Compute Source</p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {(['project', 'local', 'cloud'] as const).map((source) => (
                      <button
                        key={source}
                        type="button"
                        onClick={() => setSelectedNodeComputeSource(source)}
                        disabled={source === 'cloud' && useProjectStore.getState().ui.networkStatus === 'offline'}
                        aria-pressed={nodeComputeSource === source}
                        aria-label={`Compute source ${source}`}
                        className={`rounded-full px-3 py-2 text-xs ${
                          nodeComputeSource === source
                            ? 'bg-[#e0ff00] font-semibold text-black'
                            : 'border border-white/10 bg-white/5 text-white'
                        } disabled:cursor-not-allowed disabled:opacity-40`}
                      >
                        {source}
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}
              <NodeDataEditor node={selectedNode} workflowNodes={project.workflow.nodes} onChange={scheduleSelectedNodeDataField} />
              <PropertyDump title="Node Data" value={selectedNode.data} />
            </div>
          ) : (
            <EmptyPropertyState message="Select a workflow node to inspect or adjust its properties." />
          )}
        </section>
        <section className="rounded-[1.4rem] border border-white/8 bg-black/20 p-4">
          <div className="flex items-center gap-3">
            <SlidersHorizontal size={18} className="text-[#e0ff00]" />
            <p className="text-[11px] uppercase tracking-[0.22em] text-[#7f8691]">Clip Properties</p>
          </div>
          {selectedClip ? (
            <div className="mt-4 space-y-4">
              <div className="grid gap-3 md:grid-cols-2">
                <Metric label="Asset" value={selectedClipAsset?.name ?? selectedClip.assetId} />
                <Metric label="Track" value={selectedTrack?.name ?? selectedClip.trackId} />
                <Metric label="Start / End" value={`${selectedClip.startTime.toFixed(2)}s - ${(selectedClip.startTime + selectedClip.duration).toFixed(2)}s`} />
                <Metric label="In / Out" value={`${selectedClip.inPoint.toFixed(2)}s - ${selectedClip.outPoint.toFixed(2)}s`} />
                <Metric label="Linked Node" value={selectedClip.workflowNodeId ?? 'None'} />
                <Metric label="Linked Clip" value={selectedClip.linkedClipId ?? 'None'} />
              </div>
              <div className="rounded-[1rem] border border-white/8 bg-[#111214] p-3">
                <p className="text-[11px] uppercase tracking-[0.18em] text-[#7f8691]">Timing & Trim</p>
                <div className="mt-3 grid gap-3 md:grid-cols-2">
                  <TransformField
                    label="Start Time"
                    value={selectedClip.startTime}
                    step={0.1}
                    onChange={(value) => setSelectedClipStartTime(value)}
                  />
                  <TransformField
                    label="Duration"
                    value={selectedClip.duration}
                    step={0.1}
                    onChange={(value) => setSelectedClipDuration(value)}
                  />
                  <TransformField
                    label="In Point"
                    value={selectedClip.inPoint}
                    step={0.1}
                    onChange={(value) => setSelectedClipInPoint(value)}
                  />
                  <TransformField
                    label="Out Point"
                    value={selectedClip.outPoint}
                    step={0.1}
                    onChange={(value) => setSelectedClipOutPoint(value)}
                  />
                </div>
              </div>
              <RangeField
                label={`Speed ${selectedClip.speed.toFixed(2)}x`}
                min={0.25}
                max={4}
                step={0.25}
                value={selectedClip.speed}
                onChange={(value) => setSelectedClipSpeed(value)}
              />
              <RangeField
                label={`Opacity ${(selectedClip.opacity * 100).toFixed(0)}%`}
                min={0}
                max={1}
                step={0.05}
                value={selectedClip.opacity}
                onChange={(value) => setSelectedClipOpacity(value)}
              />
              <RangeField
                label={`Volume ${selectedClip.volume.toFixed(2)}x`}
                min={0}
                max={2}
                step={0.05}
                value={selectedClip.volume}
                onChange={(value) => setSelectedClipVolume(value)}
              />
              <div className="rounded-[1rem] border border-white/8 bg-[#111214] p-3">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="text-[11px] uppercase tracking-[0.18em] text-[#7f8691]">Keyframes</p>
                    <p className="mt-2 text-xs leading-5 text-[#9ca3af]">
                      Add keyframes at playhead {Math.max(0, project.timeline.playhead - selectedClip.startTime).toFixed(2)}s within the selected clip.
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => addSelectedClipKeyframe('speed')}
                      className="rounded-full border border-white/10 bg-white/5 px-3 py-2 text-xs text-white"
                    >
                      Add Speed
                    </button>
                    <button
                      type="button"
                      onClick={() => addSelectedClipKeyframe('opacity')}
                      className="rounded-full border border-white/10 bg-white/5 px-3 py-2 text-xs text-white"
                    >
                      Add Opacity
                    </button>
                    <button
                      type="button"
                      onClick={() => addSelectedClipKeyframe('volume')}
                      className="rounded-full border border-white/10 bg-white/5 px-3 py-2 text-xs text-white"
                    >
                      Add Volume
                    </button>
                    <button
                      type="button"
                      onClick={() => addSelectedClipKeyframe('transform.x')}
                      className="rounded-full border border-white/10 bg-white/5 px-3 py-2 text-xs text-white"
                    >
                      Add X
                    </button>
                    <button
                      type="button"
                      onClick={() => addSelectedClipKeyframe('transform.y')}
                      className="rounded-full border border-white/10 bg-white/5 px-3 py-2 text-xs text-white"
                    >
                      Add Y
                    </button>
                    <button
                      type="button"
                      onClick={() => addSelectedClipKeyframe('transform.scaleX')}
                      className="rounded-full border border-white/10 bg-white/5 px-3 py-2 text-xs text-white"
                    >
                      Add ScaleX
                    </button>
                    <button
                      type="button"
                      onClick={() => addSelectedClipKeyframe('transform.scaleY')}
                      className="rounded-full border border-white/10 bg-white/5 px-3 py-2 text-xs text-white"
                    >
                      Add ScaleY
                    </button>
                    <button
                      type="button"
                      onClick={() => addSelectedClipKeyframe('transform.rotation')}
                      className="rounded-full border border-white/10 bg-white/5 px-3 py-2 text-xs text-white"
                    >
                      Add Rotation
                    </button>
                  </div>
                </div>
                {sortedClipKeyframes.length > 0 ? (
                  <div className="mt-4 space-y-3">
                    {sortedClipKeyframes.map((keyframe) => (
                      <div key={keyframe.id} className="rounded-[0.9rem] border border-white/8 bg-black/20 p-3">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <p className="text-sm font-medium text-white">
                            {keyframe.property} at {keyframe.time.toFixed(2)}s
                          </p>
                          <button
                            type="button"
                            onClick={() => removeSelectedClipKeyframe(keyframe.id)}
                            className="rounded-full border border-red-400/20 bg-red-500/10 px-3 py-1.5 text-xs text-red-100"
                          >
                            Remove
                          </button>
                        </div>
                        <div className="mt-3 grid gap-3 md:grid-cols-3">
                          <label className="block">
                            <span className="text-[11px] uppercase tracking-[0.16em] text-[#7f8691]">Time</span>
                            <input
                              type="number"
                              min={0}
                              max={selectedClip.duration}
                              step={0.1}
                              value={keyframe.time}
                              onChange={(event) =>
                                updateSelectedClipKeyframe(keyframe.id, { time: Number(event.target.value) })
                              }
                              className="mt-2 w-full rounded-[0.8rem] border border-white/10 bg-[#0f1012] px-3 py-2 text-sm text-white outline-none"
                            />
                          </label>
                          <label className="block">
                            <span className="text-[11px] uppercase tracking-[0.16em] text-[#7f8691]">Value</span>
                            <input
                              type="number"
                              step={0.05}
                              value={keyframe.value}
                              onChange={(event) =>
                                updateSelectedClipKeyframe(keyframe.id, { value: Number(event.target.value) })
                              }
                              className="mt-2 w-full rounded-[0.8rem] border border-white/10 bg-[#0f1012] px-3 py-2 text-sm text-white outline-none"
                            />
                          </label>
                          <label className="block">
                            <span className="text-[11px] uppercase tracking-[0.16em] text-[#7f8691]">Easing</span>
                            <select
                              value={keyframe.easing}
                              onChange={(event) =>
                                updateSelectedClipKeyframe(keyframe.id, {
                                  easing: event.target.value as 'linear' | 'ease-in' | 'ease-out' | 'ease-in-out' | 'bezier',
                                })
                              }
                              className="mt-2 w-full rounded-[0.8rem] border border-white/10 bg-[#0f1012] px-3 py-2 text-sm text-white outline-none"
                            >
                              <option value="linear">linear</option>
                              <option value="ease-in">ease-in</option>
                              <option value="ease-out">ease-out</option>
                              <option value="ease-in-out">ease-in-out</option>
                              <option value="bezier">bezier</option>
                            </select>
                          </label>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="mt-4 text-sm leading-6 text-[#9ca3af]">
                    No clip keyframes yet. Add playback or transform keyframes from the current playhead.
                  </p>
                )}
              </div>
              <div className="rounded-[1rem] border border-white/8 bg-[#111214] p-3">
                <p className="text-[11px] uppercase tracking-[0.18em] text-[#7f8691]">Transform</p>
                <div className="mt-3 grid gap-3 md:grid-cols-2">
                  <TransformField
                    label="Position X"
                    value={selectedClip.transform.x}
                    step={1}
                    onChange={(value) => setSelectedClipTransformField('x', value)}
                  />
                  <TransformField
                    label="Position Y"
                    value={selectedClip.transform.y}
                    step={1}
                    onChange={(value) => setSelectedClipTransformField('y', value)}
                  />
                  <TransformField
                    label="Scale X"
                    value={selectedClip.transform.scaleX}
                    step={0.05}
                    onChange={(value) => setSelectedClipTransformField('scaleX', value)}
                  />
                  <TransformField
                    label="Scale Y"
                    value={selectedClip.transform.scaleY}
                    step={0.05}
                    onChange={(value) => setSelectedClipTransformField('scaleY', value)}
                  />
                  <TransformField
                    label="Rotation"
                    value={selectedClip.transform.rotation}
                    step={1}
                    onChange={(value) => setSelectedClipTransformField('rotation', value)}
                  />
                  <TransformField
                    label="Anchor X"
                    value={selectedClip.transform.anchorX}
                    step={0.05}
                    onChange={(value) => setSelectedClipTransformField('anchorX', value)}
                  />
                  <TransformField
                    label="Anchor Y"
                    value={selectedClip.transform.anchorY}
                    step={0.05}
                    onChange={(value) => setSelectedClipTransformField('anchorY', value)}
                  />
                </div>
              </div>
            </div>
          ) : (
            <EmptyPropertyState message="Select a timeline clip to inspect speed, opacity, volume, and transform data." />
          )}
        </section>
      </div>
    </section>
  )
}

function InspectorCard({
  icon: Icon,
  label,
  title,
  note,
}: {
  icon: React.ComponentType<{ size?: number; className?: string }>
  label: string
  title: string
  note: string
}) {
  return (
    <div className="rounded-[1.25rem] border border-white/8 bg-black/20 p-4">
      <div className="flex items-center gap-3">
        <Icon size={18} className="text-[#e0ff00]" />
        <p className="text-[11px] uppercase tracking-[0.22em] text-[#7f8691]">{label}</p>
      </div>
      <p className="mt-3 text-base font-medium text-white">{title}</p>
      <p className="mt-2 text-sm leading-6 text-[#9ca3af]">{note}</p>
    </div>
  )
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[1rem] border border-white/8 bg-[#111214] p-3">
      <p className="text-[11px] uppercase tracking-[0.18em] text-[#7f8691]">{label}</p>
      <p className="mt-2 break-all text-sm text-white">{value}</p>
    </div>
  )
}

function RangeField({
  label,
  min,
  max,
  step,
  value,
  onChange,
}: {
  label: string
  min: number
  max: number
  step: number
  value: number
  onChange: (value: number) => void
}) {
  return (
    <label className="block rounded-[1rem] border border-white/8 bg-[#111214] p-3">
      <span className="text-[11px] uppercase tracking-[0.18em] text-[#7f8691]">{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        className="mt-3 w-full accent-[#e0ff00]"
      />
    </label>
  )
}

function TransformField({
  label,
  value,
  step,
  onChange,
}: {
  label: string
  value: number
  step: number
  onChange: (value: number) => void
}) {
  return (
    <label className="block rounded-[0.9rem] border border-white/8 bg-[#0f1012] p-3">
      <span className="text-[11px] uppercase tracking-[0.16em] text-[#7f8691]">{label}</span>
      <input
        type="number"
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        className="mt-2 w-full rounded-[0.8rem] border border-white/10 bg-[#111214] px-3 py-2 text-sm text-white outline-none"
      />
    </label>
  )
}

function NodeDataEditor({
  node,
  workflowNodes,
  onChange,
}: {
  node: NonNullable<ReturnType<typeof useProjectStore.getState>['project']['workflow']['nodes'][number]>
  workflowNodes: WorkflowNode[]
  onChange: (path: string, value: unknown) => void
}) {
  const data = node.data as Record<string, unknown>
  const availableNodeOptions = workflowNodes.filter((workflowNode) => workflowNode.id !== node.id).map((workflowNode) => workflowNode.id)

  if (node.type === 'media_source') {
    return null
  }

  return (
    <div className="rounded-[1rem] border border-white/8 bg-[#111214] p-3">
      <p className="text-[11px] uppercase tracking-[0.18em] text-[#7f8691]">Node Settings</p>
      <div className="mt-3 grid gap-3 md:grid-cols-2">
        {node.type === 'camera' ? (
          <>
            <SelectField
              label="Mode"
              value={String(data.mode ?? 'perspective')}
              options={['perspective', 'orthographic']}
              onChange={(value) => onChange('mode', value)}
            />
            <TransformField label="FOV" value={Number(data.fov ?? 60)} step={1} onChange={(value) => onChange('fov', value)} />
            <TransformField label="Zoom" value={Number(data.zoom ?? 1)} step={0.1} onChange={(value) => onChange('zoom', value)} />
            <TransformField label="Pos X" value={Number((data.position as Record<string, unknown> | undefined)?.x ?? 0)} step={0.1} onChange={(value) => onChange('position.x', value)} />
            <TransformField label="Pos Y" value={Number((data.position as Record<string, unknown> | undefined)?.y ?? 0)} step={0.1} onChange={(value) => onChange('position.y', value)} />
            <TransformField label="Pos Z" value={Number((data.position as Record<string, unknown> | undefined)?.z ?? 0)} step={0.1} onChange={(value) => onChange('position.z', value)} />
            <TransformField label="Rot X" value={Number((data.rotation as Record<string, unknown> | undefined)?.x ?? 0)} step={0.1} onChange={(value) => onChange('rotation.x', value)} />
            <TransformField label="Rot Y" value={Number((data.rotation as Record<string, unknown> | undefined)?.y ?? 0)} step={0.1} onChange={(value) => onChange('rotation.y', value)} />
            <TransformField label="Rot Z" value={Number((data.rotation as Record<string, unknown> | undefined)?.z ?? 0)} step={0.1} onChange={(value) => onChange('rotation.z', value)} />
          </>
        ) : null}
        {node.type === 'shader' ? (
          <>
            <TextField label="Preset ID" value={String(data.presetId ?? '')} onChange={(value) => onChange('presetId', value || null)} />
            <TextAreaField label="Shader Source" value={String(data.shaderSource ?? '')} onChange={(value) => onChange('shaderSource', value)} />
            <ShaderUniformEditor uniforms={getUniformRecord(data.uniforms)} onChange={(nextUniforms) => onChange('uniforms', nextUniforms)} />
          </>
        ) : null}
        {node.type === 'compositor' ? (
          <>
            <SelectField
              label="Blend Mode"
              value={String(data.blendMode ?? 'normal')}
              options={['normal', 'add', 'multiply', 'screen', 'overlay']}
              onChange={(value) => onChange('blendMode', value)}
            />
            <CompositorLayerEditor
              layers={getCompositorLayers(data.layers)}
              nodeOptions={availableNodeOptions}
              onChange={(nextLayers) => onChange('layers', nextLayers)}
            />
          </>
        ) : null}
        {node.type === 'output' ? (
          <>
            <SelectField
              label="Format"
              value={String(data.format ?? 'mp4')}
              options={['mp4', 'mov', 'webm', 'mkv', 'gif', 'png_sequence']}
              onChange={(value) => onChange('format', value)}
            />
            <SelectField
              label="Resolution Mode"
              value={typeof data.resolution === 'string' ? data.resolution : 'custom'}
              options={['project', 'custom']}
              onChange={(value) => onChange('resolution', value === 'project' ? 'project' : { width: 1920, height: 1080 } as never)}
            />
            {typeof data.resolution === 'object' && data.resolution ? (
              <>
                <TransformField label="Width" value={Number((data.resolution as Record<string, unknown>).width ?? 1920)} step={1} onChange={(value) => onChange('resolution.width', value)} />
                <TransformField label="Height" value={Number((data.resolution as Record<string, unknown>).height ?? 1080)} step={1} onChange={(value) => onChange('resolution.height', value)} />
              </>
            ) : null}
            <SelectField
              label="Frame Rate Mode"
              value={typeof data.frameRate === 'string' ? data.frameRate : 'custom'}
              options={['project', 'custom']}
              onChange={(value) => onChange('frameRate', value === 'project' ? 'project' : 30)}
            />
            {typeof data.frameRate === 'number' ? (
              <TransformField label="Frame Rate" value={data.frameRate} step={1} onChange={(value) => onChange('frameRate', value)} />
            ) : null}
          </>
        ) : null}
        {node.type === 'audio_mix' ? (
          <>
            <SelectField label="Bus" value={String(data.bus ?? 'master')} options={['master']} onChange={(value) => onChange('bus', value)} />
            <TransformField label="Gain" value={Number(data.gain ?? 1)} step={0.05} onChange={(value) => onChange('gain', value)} />
            <AudioMixInputsEditor
              inputs={getAudioMixInputs(data.inputs)}
              nodeOptions={availableNodeOptions}
              onChange={(nextInputs) => onChange('inputs', nextInputs)}
            />
          </>
        ) : null}
        {node.type === 'ai_generate' ? (
          <>
            <TextField label="Model" value={String(data.model ?? '')} onChange={(value) => onChange('model', value)} />
            <TransformField label="Steps" value={Number(data.steps ?? 24)} step={1} onChange={(value) => onChange('steps', value)} />
            <TransformField label="CFG" value={Number(data.cfg ?? 6.5)} step={0.1} onChange={(value) => onChange('cfg', value)} />
            <TextField label="Seed" value={String(data.seed ?? 'random')} onChange={(value) => onChange('seed', value === 'random' ? 'random' : Number(value))} />
            <TextAreaField label="Prompt" value={String(data.prompt ?? '')} onChange={(value) => onChange('prompt', value)} />
            <TextAreaField label="Negative Prompt" value={String(data.negativePrompt ?? '')} onChange={(value) => onChange('negativePrompt', value)} />
          </>
        ) : null}
        {node.type === 'ai_upscale' ? (
          <>
            <TextField label="Model" value={String(data.model ?? '')} onChange={(value) => onChange('model', value)} />
            <SelectField label="Scale Factor" value={String(data.scaleFactor ?? 4)} options={['2', '4']} onChange={(value) => onChange('scaleFactor', Number(value))} />
          </>
        ) : null}
        {node.type === 'transform' ? (
          <>
            <TransformField label="X" value={Number(data.x ?? 0)} step={0.1} onChange={(value) => onChange('x', value)} />
            <TransformField label="Y" value={Number(data.y ?? 0)} step={0.1} onChange={(value) => onChange('y', value)} />
            <TransformField label="Scale" value={Number(data.scale ?? 1)} step={0.05} onChange={(value) => onChange('scale', value)} />
            <TransformField label="Rotation" value={Number(data.rotation ?? 0)} step={1} onChange={(value) => onChange('rotation', value)} />
          </>
        ) : null}
        {node.type === 'color_correct' ? (
          <>
            <TransformField label="Lift" value={Number(data.lift ?? 0)} step={0.05} onChange={(value) => onChange('lift', value)} />
            <TransformField label="Gamma" value={Number(data.gamma ?? 1)} step={0.05} onChange={(value) => onChange('gamma', value)} />
            <TransformField label="Gain" value={Number(data.gain ?? 1)} step={0.05} onChange={(value) => onChange('gain', value)} />
          </>
        ) : null}
      </div>
    </div>
  )
}

function ShaderUniformEditor({
  uniforms,
  onChange,
}: {
  uniforms: Record<string, UniformValue>
  onChange: (uniforms: Record<string, UniformValue>) => void
}) {
  const uniformEntries = Object.entries(uniforms)

  const addUniform = () => {
    const nextKey = window.prompt('Enter a unique uniform name', `uniform_${uniformEntries.length + 1}`)

    if (!nextKey) {
      return
    }

    const trimmedKey = nextKey.trim()

    if (trimmedKey.length === 0 || uniforms[trimmedKey]) {
      return
    }

    onChange({
      ...uniforms,
      [trimmedKey]: { type: 'float', value: 0 },
    })
  }

  const renameUniform = (uniformKey: string) => {
    const nextKey = window.prompt('Rename uniform', uniformKey)

    if (!nextKey) {
      return
    }

    const trimmedKey = nextKey.trim()

    if (trimmedKey.length === 0 || (trimmedKey !== uniformKey && uniforms[trimmedKey])) {
      return
    }

    const renamedUniforms = Object.entries(uniforms).reduce<Record<string, UniformValue>>((result, [key, value]) => {
      result[key === uniformKey ? trimmedKey : key] = value
      return result
    }, {})

    onChange(renamedUniforms)
  }

  return (
    <div className="rounded-[0.9rem] border border-white/8 bg-[#0f1012] p-3 md:col-span-2">
      <div className="flex items-center justify-between gap-3">
        <span className="text-[11px] uppercase tracking-[0.16em] text-[#7f8691]">Uniforms</span>
        <button type="button" onClick={addUniform} className="rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-white">
          Add Uniform
        </button>
      </div>
      <div className="mt-3 space-y-3">
        {uniformEntries.length === 0 ? (
          <p className="text-sm text-[#8f97a2]">No shader uniforms configured.</p>
        ) : (
          uniformEntries.map(([uniformKey, uniform]) => (
            <div key={uniformKey} className="rounded-[0.9rem] border border-white/8 bg-[#111214] p-3">
              <div className="flex items-center justify-between gap-3">
                <button type="button" onClick={() => renameUniform(uniformKey)} className="text-sm font-medium text-white underline-offset-4 hover:underline">
                  {uniformKey}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const nextUniforms = { ...uniforms }
                    delete nextUniforms[uniformKey]
                    onChange(nextUniforms)
                  }}
                  className="rounded-full border border-red-400/20 bg-red-500/10 px-3 py-1.5 text-xs text-red-100"
                >
                  Remove
                </button>
              </div>
              <div className="mt-3 grid gap-3 md:grid-cols-2">
                <SelectField
                  label="Type"
                  value={uniform.type}
                  options={['float', 'vec2', 'vec3', 'vec4', 'sampler2D', 'int']}
                  onChange={(value) =>
                    onChange({
                      ...uniforms,
                      [uniformKey]: {
                        type: value as UniformValue['type'],
                        value: createDefaultUniformValue(value as UniformValue['type']),
                      },
                    })
                  }
                />
                <TextField
                  label="Value"
                  value={formatUniformValue(uniform.value)}
                  onChange={(value) =>
                    onChange({
                      ...uniforms,
                      [uniformKey]: {
                        ...uniform,
                        value: parseUniformValue(uniform.type, value),
                      },
                    })
                  }
                />
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  )
}

function CompositorLayerEditor({
  layers,
  nodeOptions,
  onChange,
}: {
  layers: Array<{ nodeId: string; opacity: number; order: number }>
  nodeOptions: string[]
  onChange: (layers: Array<{ nodeId: string; opacity: number; order: number }>) => void
}) {
  const addLayer = () => {
    onChange([
      ...layers,
      {
        nodeId: nodeOptions[0] ?? '',
        opacity: 1,
        order: layers.length,
      },
    ])
  }

  return (
    <div className="rounded-[0.9rem] border border-white/8 bg-[#0f1012] p-3 md:col-span-2">
      <div className="flex items-center justify-between gap-3">
        <span className="text-[11px] uppercase tracking-[0.16em] text-[#7f8691]">Layers</span>
        <button type="button" onClick={addLayer} className="rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-white">
          Add Layer
        </button>
      </div>
      <div className="mt-3 space-y-3">
        {layers.length === 0 ? (
          <p className="text-sm text-[#8f97a2]">No compositor layers configured.</p>
        ) : (
          layers.map((layer, index) => (
            <div key={`${layer.nodeId}-${index}`} className="rounded-[0.9rem] border border-white/8 bg-[#111214] p-3">
              <div className="flex items-center justify-between gap-3">
                <span className="text-sm font-medium text-white">Layer {index + 1}</span>
                <button
                  type="button"
                  onClick={() => onChange(layers.filter((_, layerIndex) => layerIndex !== index))}
                  className="rounded-full border border-red-400/20 bg-red-500/10 px-3 py-1.5 text-xs text-red-100"
                >
                  Remove
                </button>
              </div>
              <div className="mt-3 grid gap-3 md:grid-cols-3">
                <SelectField
                  label="Source Node"
                  value={layer.nodeId}
                  options={nodeOptions.length > 0 ? nodeOptions : ['']}
                  onChange={(value) => onChange(updateListItem(layers, index, { ...layer, nodeId: value }))}
                />
                <TransformField
                  label="Opacity"
                  value={layer.opacity}
                  step={0.05}
                  onChange={(value) => onChange(updateListItem(layers, index, { ...layer, opacity: value }))}
                />
                <TransformField
                  label="Order"
                  value={layer.order}
                  step={1}
                  onChange={(value) => onChange(updateListItem(layers, index, { ...layer, order: Math.max(0, Math.round(value)) }))}
                />
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  )
}

function AudioMixInputsEditor({
  inputs,
  nodeOptions,
  onChange,
}: {
  inputs: AudioMixInputSetting[]
  nodeOptions: string[]
  onChange: (inputs: AudioMixInputSetting[]) => void
}) {
  const addInput = () => {
    onChange([
      ...inputs,
      {
        sourceNodeId: nodeOptions[0] ?? '',
        volume: 1,
        pan: 0,
      },
    ])
  }

  return (
    <div className="rounded-[0.9rem] border border-white/8 bg-[#0f1012] p-3 md:col-span-2">
      <div className="flex items-center justify-between gap-3">
        <span className="text-[11px] uppercase tracking-[0.16em] text-[#7f8691]">Input Routing</span>
        <button type="button" onClick={addInput} className="rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-white">
          Add Input
        </button>
      </div>
      <div className="mt-3 space-y-3">
        {inputs.length === 0 ? (
          <p className="text-sm text-[#8f97a2]">No audio input overrides configured.</p>
        ) : (
          inputs.map((input, index) => (
            <div key={`${input.sourceNodeId}-${index}`} className="rounded-[0.9rem] border border-white/8 bg-[#111214] p-3">
              <div className="flex items-center justify-between gap-3">
                <span className="text-sm font-medium text-white">Input {index + 1}</span>
                <button
                  type="button"
                  onClick={() => onChange(inputs.filter((_, inputIndex) => inputIndex !== index))}
                  className="rounded-full border border-red-400/20 bg-red-500/10 px-3 py-1.5 text-xs text-red-100"
                >
                  Remove
                </button>
              </div>
              <div className="mt-3 grid gap-3 md:grid-cols-3">
                <SelectField
                  label="Source Node"
                  value={input.sourceNodeId}
                  options={nodeOptions.length > 0 ? nodeOptions : ['']}
                  onChange={(value) => onChange(updateListItem(inputs, index, { ...input, sourceNodeId: value }))}
                />
                <TransformField
                  label="Volume"
                  value={input.volume}
                  step={0.05}
                  onChange={(value) => onChange(updateListItem(inputs, index, { ...input, volume: value }))}
                />
                <TransformField
                  label="Pan"
                  value={input.pan}
                  step={0.05}
                  onChange={(value) => onChange(updateListItem(inputs, index, { ...input, pan: value }))}
                />
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  )
}

function getUniformRecord(value: unknown) {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, UniformValue>) : {}
}

function getCompositorLayers(value: unknown) {
  return Array.isArray(value) ? (value as Array<{ nodeId: string; opacity: number; order: number }>) : []
}

function getAudioMixInputs(value: unknown) {
  return Array.isArray(value) ? (value as AudioMixInputSetting[]) : []
}

function createDefaultUniformValue(type: UniformValue['type']) {
  switch (type) {
    case 'vec2':
      return [0, 0]
    case 'vec3':
      return [0, 0, 0]
    case 'vec4':
      return [0, 0, 0, 0]
    case 'sampler2D':
      return ''
    default:
      return 0
  }
}

function formatUniformValue(value: UniformValue['value']) {
  return Array.isArray(value) ? value.join(', ') : String(value)
}

function parseUniformValue(type: UniformValue['type'], rawValue: string) {
  if (type === 'sampler2D') {
    return rawValue
  }

  if (type === 'vec2' || type === 'vec3' || type === 'vec4') {
    const expectedLength = Number(type.replace('vec', ''))
    const values = rawValue
      .split(',')
      .map((part) => Number(part.trim()))
      .filter((part) => Number.isFinite(part))

    while (values.length < expectedLength) {
      values.push(0)
    }

    return values.slice(0, expectedLength)
  }

  const nextNumber = Number(rawValue)
  return Number.isFinite(nextNumber) ? nextNumber : 0
}

function updateListItem<T>(items: T[], index: number, nextItem: T) {
  return items.map((item, itemIndex) => (itemIndex === index ? nextItem : item))
}

function TextField({
  label,
  value,
  onChange,
}: {
  label: string
  value: string
  onChange: (value: string) => void
}) {
  return (
    <label className="block rounded-[0.9rem] border border-white/8 bg-[#0f1012] p-3">
      <span className="text-[11px] uppercase tracking-[0.16em] text-[#7f8691]">{label}</span>
      <input
        type="text"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="mt-2 w-full rounded-[0.8rem] border border-white/10 bg-[#111214] px-3 py-2 text-sm text-white outline-none"
      />
    </label>
  )
}

function TextAreaField({
  label,
  value,
  onChange,
}: {
  label: string
  value: string
  onChange: (value: string) => void
}) {
  return (
    <label className="block rounded-[0.9rem] border border-white/8 bg-[#0f1012] p-3 md:col-span-2">
      <span className="text-[11px] uppercase tracking-[0.16em] text-[#7f8691]">{label}</span>
      <textarea
        value={value}
        onChange={(event) => onChange(event.target.value)}
        rows={4}
        className="mt-2 w-full rounded-[0.8rem] border border-white/10 bg-[#111214] px-3 py-2 text-sm text-white outline-none"
      />
    </label>
  )
}

function SelectField({
  label,
  value,
  options,
  onChange,
}: {
  label: string
  value: string
  options: string[]
  onChange: (value: string) => void
}) {
  return (
    <label className="block rounded-[0.9rem] border border-white/8 bg-[#0f1012] p-3">
      <span className="text-[11px] uppercase tracking-[0.16em] text-[#7f8691]">{label}</span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="mt-2 w-full rounded-[0.8rem] border border-white/10 bg-[#111214] px-3 py-2 text-sm text-white outline-none"
      >
        {options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    </label>
  )
}

function PropertyDump({ title, value }: { title: string; value: unknown }) {
  return (
    <div className="rounded-[1rem] border border-white/8 bg-[#111214] p-3">
      <p className="text-[11px] uppercase tracking-[0.18em] text-[#7f8691]">{title}</p>
      <pre className="mt-3 overflow-auto whitespace-pre-wrap break-all text-xs leading-6 text-[#c8d0db]">
        {JSON.stringify(value, null, 2)}
      </pre>
    </div>
  )
}

function EmptyPropertyState({ message }: { message: string }) {
  return (
    <div className="mt-4 rounded-[1rem] border border-dashed border-white/10 bg-[#111214] px-4 py-6 text-sm leading-6 text-[#9ca3af]">
      {message}
    </div>
  )
}
