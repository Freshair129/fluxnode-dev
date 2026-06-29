import { useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowDown,
  ArrowUp,
  Clapperboard,
  Copy,
  FastForward,
  FolderPlus,
  Home,
  Pause,
  Play,
  Plus,
  Replace,
  Rewind,
  ScissorsLineDashed,
  Split,
  Trash2,
  Unlink2,
} from 'lucide-react'
import { useProjectStore } from '../../store/project-store'

export function TimelineView() {
  const timeline = useProjectStore((state) => state.project.timeline)
  const assets = useProjectStore((state) => state.project.assets.assets)
  const assetThumbnails = useProjectStore((state) => state.assetThumbnails)
  const selectedClipId = useProjectStore((state) => state.ui.selectedClipId)
  const selectedClipIds = useProjectStore((state) => state.ui.selectedClipIds)
  const selectedTrackId = useProjectStore((state) => state.ui.selectedTrackId)
  const timelineClipboard = useProjectStore((state) => state.ui.timelineClipboard)
  const playbackState = useProjectStore((state) => state.ui.playbackState)
  const playbackRate = useProjectStore((state) => state.ui.playbackRate)
  const scrubPreviewState = useProjectStore((state) => state.ui.scrubPreviewState)
  const audio = useProjectStore((state) => state.project.audio)
  const addDemoClip = useProjectStore((state) => state.addDemoClip)
  const importAssetFromPath = useProjectStore((state) => state.importAssetFromPath)
  const rescanAssetStatuses = useProjectStore((state) => state.rescanAssetStatuses)
  const replaceSelectedAssetPath = useProjectStore((state) => state.replaceSelectedAssetPath)
  const toggleAssetProxyPreference = useProjectStore((state) => state.toggleAssetProxyPreference)
  const unlinkSelectedMedia = useProjectStore((state) => state.unlinkSelectedMedia)
  const setPlayhead = useProjectStore((state) => state.setPlayhead)
  const scrubPlayhead = useProjectStore((state) => state.scrubPlayhead)
  const togglePlayback = useProjectStore((state) => state.togglePlayback)
  const shuttlePlayback = useProjectStore((state) => state.shuttlePlayback)
  const setInPoint = useProjectStore((state) => state.setInPoint)
  const setOutPoint = useProjectStore((state) => state.setOutPoint)
  const clearInOutPoints = useProjectStore((state) => state.clearInOutPoints)
  const adjustTimelineZoom = useProjectStore((state) => state.adjustTimelineZoom)
  const fitTimelineToWindow = useProjectStore((state) => state.fitTimelineToWindow)
  const selectClip = useProjectStore((state) => state.selectClip)
  const selectTrack = useProjectStore((state) => state.selectTrack)
  const selectAllTimelineClips = useProjectStore((state) => state.selectAllTimelineClips)
  const copySelectedClips = useProjectStore((state) => state.copySelectedClips)
  const pasteTimelineClipboard = useProjectStore((state) => state.pasteTimelineClipboard)
  const addTrackAbove = useProjectStore((state) => state.addTrackAbove)
  const addTrackBelow = useProjectStore((state) => state.addTrackBelow)
  const moveSelectedTrack = useProjectStore((state) => state.moveSelectedTrack)
  const deleteSelectedTrack = useProjectStore((state) => state.deleteSelectedTrack)
  const renameSelectedTrack = useProjectStore((state) => state.renameSelectedTrack)
  const toggleSelectedTrackLock = useProjectStore((state) => state.toggleSelectedTrackLock)
  const toggleSelectedTrackMute = useProjectStore((state) => state.toggleSelectedTrackMute)
  const toggleSelectedTrackSolo = useProjectStore((state) => state.toggleSelectedTrackSolo)
  const toggleSelectedTrackVisibility = useProjectStore((state) => state.toggleSelectedTrackVisibility)
  const setSelectedTrackVolume = useProjectStore((state) => state.setSelectedTrackVolume)
  const setSelectedTrackPan = useProjectStore((state) => state.setSelectedTrackPan)
  const cycleSelectedTrackHeight = useProjectStore((state) => state.cycleSelectedTrackHeight)
  const setSelectedTrackHeight = useProjectStore((state) => state.setSelectedTrackHeight)
  const moveSelectedClipToAdjacentTrack = useProjectStore((state) => state.moveSelectedClipToAdjacentTrack)
  const setSelectedClipSpeed = useProjectStore((state) => state.setSelectedClipSpeed)
  const duplicateSelected = useProjectStore((state) => state.duplicateSelected)
  const splitSelectedClip = useProjectStore((state) => state.splitSelectedClip)
  const deleteSelected = useProjectStore((state) => state.deleteSelected)
  const showSelectedClipInWorkflow = useProjectStore((state) => state.showSelectedClipInWorkflow)
  const waveformCache = useProjectStore((state) => state.waveformCache)
  const generateWaveformForAsset = useProjectStore((state) => state.generateWaveformForAsset)
  const relinkMissingAssetsFromFolder = useProjectStore((state) => state.relinkMissingAssetsFromFolder)
  const openDetachedPanel = useProjectStore((state) => state.openDetachedPanel)
  const setScrubPreviewState = useProjectStore((state) => state.setScrubPreviewState)
  const clearScrubPreviewState = useProjectStore((state) => state.clearScrubPreviewState)
  const [contextMenu, setContextMenu] = useState<
    | { type: 'clip'; x: number; y: number }
    | { type: 'track'; x: number; y: number }
    | null
  >(null)
  const scrubTrackRef = useRef<HTMLDivElement | null>(null)
  const scrubSessionRef = useRef<{ lastAt: number; lastPlayhead: number; startedAt: string } | null>(null)
  const assetList = useMemo(() => Object.values(assets), [assets])

  const timelineEnd = Math.max(
    ...timeline.tracks.flatMap((track) => track.clips.map((clip) => clip.startTime + clip.duration)),
    timeline.outPoint ?? 0,
    0,
  )
  const selectedTrack = timeline.tracks.find((track) => track.id === selectedTrackId) ?? null
  const runContextAction = (action: () => void) => () => {
    action()
    setContextMenu(null)
  }
  const openSelectedClipProperties = () => void openDetachedPanel('inspector')
  const promptForCustomSpeed = () => {
    const value = window.prompt('Enter custom clip speed (0.25 - 4.00)', '1')

    if (!value) {
      return
    }

    const parsed = Number(value)

    if (!Number.isFinite(parsed)) {
      return
    }

    setSelectedClipSpeed(Math.max(0.25, Math.min(4, parsed)))
  }
  const activateWithKeyboard = (event: React.KeyboardEvent<HTMLElement>, action: () => void) => {
    if (event.key !== 'Enter' && event.key !== ' ') {
      return
    }

    event.preventDefault()
    action()
  }

  useEffect(() => {
    const audioAssetIds = timeline.tracks
      .filter((track) => track.type === 'audio')
      .flatMap((track) => track.clips.map((clip) => clip.assetId))

    const uniqueAudioAssetIds = [...new Set(audioAssetIds)]
    uniqueAudioAssetIds.forEach((assetId) => {
      void generateWaveformForAsset(assetId, audio.waveformDensity === 'compact' ? 24 : audio.waveformDensity === 'balanced' ? 40 : 64)
    })
  }, [audio.waveformDensity, generateWaveformForAsset, timeline.tracks])

  useEffect(() => {
    function closeMenu() {
      setContextMenu(null)
    }

    window.addEventListener('click', closeMenu)
    return () => window.removeEventListener('click', closeMenu)
  }, [])

  useEffect(() => {
    function getScrubTimeFromClientX(clientX: number) {
      const bounds = scrubTrackRef.current?.getBoundingClientRect()

      if (!bounds) {
        return timeline.playhead
      }

      const ratio = Math.max(0, Math.min(1, (clientX - bounds.left) / Math.max(bounds.width, 1)))
      return ratio * Math.max(timelineEnd, 0.01)
    }

    function handlePointerMove(event: PointerEvent) {
      if (!scrubSessionRef.current) {
        return
      }

      const nextTime = getScrubTimeFromClientX(event.clientX)
      const now = performance.now()
      const elapsedSeconds = Math.max((now - scrubSessionRef.current.lastAt) / 1000, 0.016)
      const deltaSeconds = Math.abs(nextTime - scrubSessionRef.current.lastPlayhead)
      const speed = Number(Math.max(0.1, deltaSeconds / elapsedSeconds).toFixed(2))
      const mode = speed < 2 ? 'slow_drag' : 'fast_drag'

      scrubPlayhead(nextTime)

      if (audio.scrubEnabled) {
        setScrubPreviewState({
          active: true,
          mode,
          speed,
          sourceTime: Number(nextTime.toFixed(2)),
          startedAt: scrubSessionRef.current.startedAt,
        })
      }

      scrubSessionRef.current = {
        ...scrubSessionRef.current,
        lastAt: now,
        lastPlayhead: nextTime,
      }
    }

    function handlePointerUp(event: PointerEvent) {
      if (!scrubSessionRef.current) {
        return
      }

      const finalTime = getScrubTimeFromClientX(event.clientX)
      setPlayhead(finalTime)
      scrubSessionRef.current = null
      clearScrubPreviewState()
    }

    window.addEventListener('pointermove', handlePointerMove)
    window.addEventListener('pointerup', handlePointerUp)

    return () => {
      window.removeEventListener('pointermove', handlePointerMove)
      window.removeEventListener('pointerup', handlePointerUp)
    }
  }, [audio.scrubEnabled, clearScrubPreviewState, scrubPlayhead, setPlayhead, setScrubPreviewState, timeline.playhead, timelineEnd])

  function beginScrub(clientX: number) {
    const bounds = scrubTrackRef.current?.getBoundingClientRect()
    if (!bounds) {
      return
    }

    const ratio = Math.max(0, Math.min(1, (clientX - bounds.left) / Math.max(bounds.width, 1)))
    const nextTime = ratio * Math.max(timelineEnd, 0.01)
    const startedAt = new Date().toISOString()

    scrubSessionRef.current = {
      lastAt: performance.now(),
      lastPlayhead: nextTime,
      startedAt,
    }

    scrubPlayhead(nextTime)

    if (audio.scrubEnabled) {
      setScrubPreviewState({
        active: true,
        mode: 'slow_drag',
        speed: 1,
        sourceTime: Number(nextTime.toFixed(2)),
        startedAt,
      })
    }
  }

  return (
    <section
      aria-label="Timeline editor"
      className="relative flex h-full flex-col gap-4 rounded-[2rem] border border-white/10 bg-[#111214]/85 p-4 shadow-[0_20px_80px_rgba(0,0,0,0.35)] backdrop-blur-xl"
    >
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-[1.5rem] border border-white/8 bg-black/20 p-4">
        <div>
          <p className="text-[11px] uppercase tracking-[0.3em] text-[#7f8691]">Timeline Mode</p>
          <h2 className="mt-2 font-display text-2xl font-semibold text-white">Editorial command slice</h2>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-[#98a1ad]">
            Transport, clipboard, track controls, and workflow-linked clips now share one undoable project state.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <ToolbarButton onClick={togglePlayback}>
            {playbackState === 'paused' ? <Play size={16} /> : <Pause size={16} />}
            {playbackState === 'paused' ? 'Play' : `Pause ${playbackRate}x`}
          </ToolbarButton>
          <ToolbarButton onClick={() => shuttlePlayback('reverse')}>
            <Rewind size={16} />
            Reverse
          </ToolbarButton>
          <ToolbarButton onClick={() => setPlayhead(0)}>
            <Home size={16} />
            Start
          </ToolbarButton>
          <ToolbarButton onClick={() => setPlayhead(timelineEnd)}>
            <FastForward size={16} />
            End
          </ToolbarButton>
          <ToolbarButton tone="accent" onClick={addDemoClip}>
            <Plus size={16} />
            Add Demo Clip
          </ToolbarButton>
          <ToolbarButton onClick={copySelectedClips}>
            <Copy size={16} />
            Copy
          </ToolbarButton>
          <ToolbarButton onClick={pasteTimelineClipboard}>
            <FolderPlus size={16} />
            Paste
          </ToolbarButton>
          <ToolbarButton onClick={duplicateSelected}>
            <Copy size={16} />
            Duplicate
          </ToolbarButton>
          <ToolbarButton onClick={splitSelectedClip}>
            <Split size={16} />
            Split
          </ToolbarButton>
          <ToolbarButton tone="danger" onClick={deleteSelected}>
            <Trash2 size={16} />
            Delete
          </ToolbarButton>
          <ToolbarButton onClick={() => void replaceSelectedAssetPath()}>
            <Replace size={16} />
            Replace Media
          </ToolbarButton>
          <ToolbarButton onClick={unlinkSelectedMedia}>
            <Unlink2 size={16} />
            Unlink A/V
          </ToolbarButton>
          <ToolbarButton onClick={selectAllTimelineClips}>Select All</ToolbarButton>
        </div>
      </div>

      <div className="grid flex-1 gap-4 xl:grid-cols-[340px_minmax(0,1fr)]">
        <aside aria-label="Timeline controls and asset library" className="rounded-[1.5rem] border border-white/8 bg-[#17181b] p-4">
          <p className="text-xs uppercase tracking-[0.25em] text-[#7f8691]">Project Transport</p>
          <div className="mt-4 grid gap-3 text-sm text-[#d7dce2]">
            <Metric label="Playhead" value={`${timeline.playhead.toFixed(1)}s`} />
            <Metric label="In / Out" value={`${timeline.inPoint ?? 0}s - ${timeline.outPoint ?? 0}s`} />
            <Metric label="Zoom" value={`${timeline.zoom.toFixed(1)}x`} />
            <Metric label="Tracks" value={`${timeline.tracks.length}`} />
            <Metric label="Selection" value={`${selectedClipIds.length} clip(s)`} />
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            <MiniButton onClick={setInPoint}>Set In</MiniButton>
            <MiniButton onClick={setOutPoint}>Set Out</MiniButton>
            <MiniButton onClick={clearInOutPoints}>Clear In/Out</MiniButton>
            <MiniButton onClick={() => adjustTimelineZoom(0.25)}>Zoom +</MiniButton>
            <MiniButton onClick={() => adjustTimelineZoom(-0.25)}>Zoom -</MiniButton>
            <MiniButton onClick={fitTimelineToWindow}>Fit</MiniButton>
          </div>
          <div className="mt-4 rounded-2xl border border-white/8 bg-black/20 p-3">
            <div className="flex items-center justify-between gap-3 text-[11px] uppercase tracking-[0.22em] text-[#7f8691]">
              <span>Scrub Timeline</span>
              <span>{scrubPreviewState.active ? `${scrubPreviewState.mode} ${scrubPreviewState.speed.toFixed(2)}x` : `${timeline.playhead.toFixed(2)}s`}</span>
            </div>
            <div
              ref={scrubTrackRef}
              onPointerDown={(event) => beginScrub(event.clientX)}
              className="mt-3 h-4 cursor-ew-resize rounded-full border border-white/8 bg-[linear-gradient(90deg,rgba(59,130,246,0.18),rgba(224,255,0,0.22))]"
            >
              <div
                className="relative h-full rounded-full bg-[#e0ff00]/20"
                style={{ width: `${Math.max(0, Math.min(100, (timeline.playhead / Math.max(timelineEnd, 0.01)) * 100))}%` }}
              >
                <span className="absolute right-0 top-1/2 h-5 w-1.5 -translate-y-1/2 rounded-full bg-[#f5ffd5] shadow-[0_0_0_1px_rgba(224,255,0,0.25)]" />
              </div>
            </div>
            <p className="mt-3 text-xs leading-5 text-[#8f97a2]">
              Drag slowly for pitched scrub preview intent, drag fast for burst scrub intent, and use J / K / L shuttle for transport scrubbing.
            </p>
          </div>

          <div className="mt-4 rounded-2xl border border-white/8 bg-black/20 p-3 text-xs text-[#c5ccd6]">
            Clipboard {timelineClipboard.length} clip{timelineClipboard.length === 1 ? '' : 's'}
          </div>

          <div className="mt-4 border-t border-white/8 pt-4">
            <p className="text-xs uppercase tracking-[0.25em] text-[#7f8691]">Track Actions</p>
            <div className="mt-3 flex flex-wrap gap-2">
              <MiniButton onClick={addTrackAbove}>Add Above</MiniButton>
              <MiniButton onClick={addTrackBelow}>Add Below</MiniButton>
              <MiniButton onClick={() => moveSelectedTrack('up')}>Move Up</MiniButton>
              <MiniButton onClick={() => moveSelectedTrack('down')}>Move Down</MiniButton>
              <MiniButton onClick={renameSelectedTrack}>Rename</MiniButton>
              <MiniButton onClick={toggleSelectedTrackLock}>
                {selectedTrack?.locked ? 'Unlock' : 'Lock'}
              </MiniButton>
              <MiniButton onClick={toggleSelectedTrackVisibility}>
                {selectedTrack?.visible === false ? 'Show' : 'Hide'}
              </MiniButton>
              <MiniButton onClick={toggleSelectedTrackMute}>
                {selectedTrack?.muted ? 'Unmute' : 'Mute'}
              </MiniButton>
              <MiniButton onClick={toggleSelectedTrackSolo}>
                {selectedTrack?.solo ? 'Unsolo' : 'Solo'}
              </MiniButton>
              <MiniButton onClick={cycleSelectedTrackHeight}>Height</MiniButton>
              <MiniButton tone="danger" onClick={deleteSelectedTrack}>
                Delete Track
              </MiniButton>
            </div>
            <p className="mt-3 text-xs leading-5 text-[#8f97a2]">
              {selectedTrack ? `${selectedTrack.name} selected` : 'Select a track to edit its properties.'}
            </p>
            {selectedTrack?.type === 'audio' ? (
              <div className="mt-4 space-y-3 rounded-2xl border border-white/8 bg-black/20 p-3">
                <label className="block text-[11px] uppercase tracking-[0.22em] text-[#7f8691]">
                  Track Volume {selectedTrack.volume.toFixed(2)}x
                </label>
                <input
                  type="range"
                  min={0}
                  max={2}
                  step={0.05}
                  value={selectedTrack.volume}
                  onChange={(event) => setSelectedTrackVolume(Number(event.target.value))}
                  className="w-full accent-[#e0ff00]"
                />
                <label className="block text-[11px] uppercase tracking-[0.22em] text-[#7f8691]">
                  Track Pan {selectedTrack.pan.toFixed(2)}
                </label>
                <input
                  type="range"
                  min={-1}
                  max={1}
                  step={0.05}
                  value={selectedTrack.pan}
                  onChange={(event) => setSelectedTrackPan(Number(event.target.value))}
                  className="w-full accent-[#3b82f6]"
                />
              </div>
            ) : null}
          </div>

          <div className="mt-4 border-t border-white/8 pt-4">
            <p className="text-xs uppercase tracking-[0.25em] text-[#7f8691]">Clip Actions</p>
            <div className="mt-3 flex flex-wrap gap-2">
              <MiniButton onClick={() => moveSelectedClipToAdjacentTrack('up')}>
                <ArrowUp size={14} />
                Move Up
              </MiniButton>
              <MiniButton onClick={() => moveSelectedClipToAdjacentTrack('down')}>
                <ArrowDown size={14} />
                Move Down
              </MiniButton>
              {[0.5, 1, 2, 4].map((speed) => (
                <MiniButton key={speed} onClick={() => setSelectedClipSpeed(speed)}>
                  {speed}x
                </MiniButton>
              ))}
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              <MiniButton onClick={() => void replaceSelectedAssetPath()}>Replace</MiniButton>
              <MiniButton onClick={unlinkSelectedMedia}>Unlink</MiniButton>
              <MiniButton onClick={showSelectedClipInWorkflow}>Show in Workflow</MiniButton>
            </div>
          </div>

          <div className="mt-6 border-t border-white/8 pt-4">
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs uppercase tracking-[0.25em] text-[#7f8691]">Asset Library</p>
              <span className="rounded-full border border-white/10 px-2 py-1 text-[10px] text-[#c5ccd6]">
                {assetList.length} asset{assetList.length === 1 ? '' : 's'}
              </span>
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => void importAssetFromPath()}
                className="rounded-full bg-[#e0ff00] px-4 py-2 text-sm font-semibold text-black"
              >
                Import Path
              </button>
              <button
                type="button"
                onClick={() => void rescanAssetStatuses()}
                className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm text-white"
              >
                Rescan
              </button>
              <button
                type="button"
                onClick={() => void relinkMissingAssetsFromFolder()}
                className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm text-white"
              >
                Batch Relink
              </button>
            </div>
            <div className="mt-3 space-y-2">
              {assetList.map((asset) => (
                <div key={asset.id} className="rounded-xl border border-white/8 bg-black/20 p-3">
                  <div className="flex gap-3">
                    <div className="flex h-16 w-24 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-white/8 bg-[#111214]">
                      {assetThumbnails[asset.id] ? (
                        <img
                          src={assetThumbnails[asset.id].thumbnailPath}
                          alt={asset.name}
                          className="h-full w-full object-cover"
                        />
                      ) : (
                        <div className="px-2 text-center text-[10px] uppercase tracking-[0.2em] text-[#7f8691]">
                          No Thumb
                        </div>
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate text-sm font-medium text-white">{asset.name}</span>
                        <span
                          className={`rounded-full px-2 py-1 text-[10px] uppercase tracking-[0.2em] ${
                            asset.status === 'linked'
                              ? 'bg-emerald-500/10 text-emerald-100'
                              : asset.status === 'corrupt'
                                ? 'bg-red-500/10 text-red-100'
                                : 'bg-amber-500/10 text-amber-50'
                          }`}
                        >
                          {asset.status}
                        </span>
                      </div>
                      <p className="mt-2 text-[11px] uppercase tracking-[0.22em] text-[#7f8691]">
                        {asset.type}
                        {asset.metadata.width && asset.metadata.height
                          ? ` | ${asset.metadata.width}x${asset.metadata.height}`
                          : ''}
                        {asset.duration ? ` | ${asset.duration.toFixed(1)}s` : ''}
                        {asset.relativePath ? ' | project-local' : ' | linked'}
                        {asset.proxyPath ? ` | ${asset.preferProxyForEditing ? 'proxy preferred' : 'original preferred'}` : ''}
                      </p>
                      {asset.relativePath ? (
                        <p className="mt-2 break-all text-[11px] leading-5 text-[#9ba4af]">
                          Relative: {asset.relativePath}
                        </p>
                      ) : null}
                      {asset.type === 'video' && asset.proxyPath ? (
                        <div className="mt-3">
                          <button
                            type="button"
                            onClick={() => toggleAssetProxyPreference(asset.id)}
                            className="rounded-full border border-white/10 bg-white/5 px-3 py-2 text-[11px] text-white"
                          >
                            {asset.preferProxyForEditing ? 'Use Original While Editing' : 'Use Proxy While Editing'}
                          </button>
                        </div>
                      ) : null}
                      <p className="mt-2 break-all text-xs leading-5 text-[#8f97a2]">{asset.sourcePath}</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </aside>

        <div aria-label="Timeline tracks" className="rounded-[1.5rem] border border-white/8 bg-[#0d0e10] p-4">
          {timeline.tracks.length === 0 ? (
            <EmptyTimelineState onAddClip={addDemoClip} />
          ) : (
            <div className="space-y-4">
              {timeline.tracks.map((track) => (
                <div
                  key={track.id}
                  onClick={() => selectTrack(track.id)}
                  onKeyDown={(event) => activateWithKeyboard(event, () => selectTrack(track.id))}
                  onContextMenu={(event) => {
                    event.preventDefault()
                    selectTrack(track.id)
                    setContextMenu({ type: 'track', x: event.clientX, y: event.clientY })
                  }}
                  tabIndex={0}
                  role="button"
                  aria-label={`Track ${track.name}, ${track.type}, ${track.clips.length} clips`}
                  className={`rounded-[1.25rem] border bg-[#16171a] p-4 transition ${
                    selectedTrackId === track.id ? 'border-[#e0ff00]/45' : 'border-white/8'
                  }`}
                >
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-white">{track.name}</p>
                      <p className="text-xs uppercase tracking-[0.2em] text-[#7f8691]">{track.type} track</p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="rounded-full border border-white/10 px-3 py-1 text-xs text-[#c5ccd6]">
                        {track.clips.length} clip{track.clips.length === 1 ? '' : 's'}
                      </span>
                      <span className="rounded-full border border-white/10 px-3 py-1 text-xs text-[#c5ccd6]">
                        {track.height}px
                      </span>
                      <span
                        className={`rounded-full border px-3 py-1 text-xs ${
                          track.locked
                            ? 'border-amber-300/20 bg-amber-500/10 text-amber-50'
                            : 'border-emerald-400/20 bg-emerald-500/10 text-emerald-50'
                        }`}
                      >
                        {track.locked ? 'Locked' : 'Editable'}
                      </span>
                    </div>
                  </div>

                  <div className="space-y-3">
                    {track.clips.map((clip) => {
                      const asset = assets[clip.assetId]
                      const isSelected = selectedClipIds.includes(clip.id)

                      return (
                        <article
                          key={clip.id}
                          onClick={(event) => {
                            event.stopPropagation()
                            selectClip(clip.id, event.ctrlKey || event.metaKey)
                          }}
                          onKeyDown={(event) => {
                            event.stopPropagation()
                            activateWithKeyboard(event, () => selectClip(clip.id, event.ctrlKey || event.metaKey))
                          }}
                          onContextMenu={(event) => {
                            event.preventDefault()
                            event.stopPropagation()
                            selectClip(clip.id, false)
                            setContextMenu({ type: 'clip', x: event.clientX, y: event.clientY })
                          }}
                          tabIndex={0}
                          role="button"
                          aria-label={`Clip ${asset?.name ?? clip.assetId}, starts at ${clip.startTime.toFixed(1)} seconds, duration ${clip.duration.toFixed(1)} seconds`}
                          className={`cursor-pointer rounded-[1rem] border p-4 transition ${
                            isSelected
                              ? 'border-[#e0ff00]/70 bg-[linear-gradient(135deg,rgba(224,255,0,0.18),rgba(255,255,255,0.08))] shadow-[0_0_0_1px_rgba(224,255,0,0.2)]'
                              : 'border-white/8 bg-[linear-gradient(135deg,rgba(224,255,0,0.15),rgba(255,255,255,0.04))]'
                          }`}
                        >
                          <div className="flex flex-wrap items-center justify-between gap-3">
                            <div className="flex items-center gap-3">
                              <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-black/25 text-[#e0ff00]">
                                <Clapperboard size={18} />
                              </div>
                              <div>
                                <p className="text-sm font-semibold text-white">{asset?.name ?? clip.assetId}</p>
                                <p className="text-xs text-[#afb6bf]">
                                  {clip.startTime.toFixed(1)}s start - {clip.duration.toFixed(1)}s duration
                                </p>
                              </div>
                            </div>
                            <div className="flex flex-wrap gap-2 text-xs text-[#d8dde4]">
                              <Badge label={`Linked node ${clip.workflowNodeId ?? 'none'}`} />
                              <Badge label={`Speed ${clip.speed.toFixed(2)}x`} />
                              <Badge label={`Opacity ${(clip.opacity * 100).toFixed(0)}%`} />
                              {asset?.status === 'missing' ? <Badge label="Media Offline" tone="warn" /> : null}
                              {asset?.status === 'corrupt' ? <Badge label="Cannot Decode" tone="danger" /> : null}
                              {selectedClipId === clip.id ? <Badge label="Primary" /> : null}
                              {isSelected ? <Badge label="Selected" /> : null}
                              {clip.keyframes.length > 0 ? <Badge label={`${clip.keyframes.length} keyframe${clip.keyframes.length === 1 ? '' : 's'}`} /> : null}
                            </div>
                          </div>
                          <KeyframeStrip duration={clip.duration} keyframes={clip.keyframes} />
                          {track.type === 'audio' ? (
                            <Waveform
                              clipDuration={clip.duration}
                              volume={clip.volume}
                              density={audio.waveformDensity}
                              peaks={waveformCache[clip.assetId]?.peaks ?? null}
                            />
                          ) : null}
                        </article>
                      )
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
      {contextMenu ? (
        <div
          className="fixed z-30 min-w-52 rounded-[1rem] border border-white/10 bg-[#101113]/95 p-2 shadow-[0_20px_60px_rgba(0,0,0,0.45)] backdrop-blur-xl"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onClick={(event) => event.stopPropagation()}
        >
          {contextMenu.type === 'clip' ? (
            <div className="space-y-1">
              <ContextAction label="Split at Playhead" onClick={runContextAction(splitSelectedClip)} />
              <ContextAction label="Delete Clip" onClick={runContextAction(deleteSelected)} tone="danger" />
              <ContextAction label="Duplicate Clip" onClick={runContextAction(duplicateSelected)} />
              <ContextDivider />
              {[0.25, 0.5, 1, 2, 4].map((speed) => (
                <ContextAction
                  key={speed}
                  label={`Speed ${speed}x`}
                  onClick={runContextAction(() => setSelectedClipSpeed(speed))}
                />
              ))}
              <ContextAction label="Speed Custom..." onClick={runContextAction(promptForCustomSpeed)} />
              <ContextDivider />
              <ContextAction label="Trim..." onClick={runContextAction(openSelectedClipProperties)} />
              <ContextAction label="Transform..." onClick={runContextAction(openSelectedClipProperties)} />
              <ContextDivider />
              <ContextAction label="Replace Media..." onClick={runContextAction(() => void replaceSelectedAssetPath())} />
              <ContextAction label="Unlink Audio / Video" onClick={runContextAction(unlinkSelectedMedia)} />
              <ContextAction label="Show in Workflow" onClick={runContextAction(showSelectedClipInWorkflow)} />
              <ContextAction label="Properties" onClick={runContextAction(openSelectedClipProperties)} />
            </div>
          ) : (
            <div className="space-y-1">
              <ContextAction label="Add Track Above" onClick={runContextAction(addTrackAbove)} />
              <ContextAction label="Add Track Below" onClick={runContextAction(addTrackBelow)} />
              <ContextAction label="Move Track Up" onClick={runContextAction(() => moveSelectedTrack('up'))} />
              <ContextAction label="Move Track Down" onClick={runContextAction(() => moveSelectedTrack('down'))} />
              <ContextAction label="Delete Track" onClick={runContextAction(deleteSelectedTrack)} tone="danger" />
              <ContextDivider />
              <ContextAction label="Rename Track" onClick={runContextAction(renameSelectedTrack)} />
              <ContextAction label={selectedTrack?.locked ? 'Unlock Track' : 'Lock Track'} onClick={runContextAction(toggleSelectedTrackLock)} />
              <ContextAction label={selectedTrack?.muted ? 'Unmute Track' : 'Mute Track'} onClick={runContextAction(toggleSelectedTrackMute)} />
              <ContextAction label={selectedTrack?.solo ? 'Unsolo Track' : 'Solo Track'} onClick={runContextAction(toggleSelectedTrackSolo)} />
              <ContextDivider />
              <ContextAction label="Track Height: Small" onClick={runContextAction(() => setSelectedTrackHeight(60))} />
              <ContextAction label="Track Height: Medium" onClick={runContextAction(() => setSelectedTrackHeight(84))} />
              <ContextAction label="Track Height: Large" onClick={runContextAction(() => setSelectedTrackHeight(112))} />
            </div>
          )}
        </div>
      ) : null}
    </section>
  )
}

function EmptyTimelineState({ onAddClip }: { onAddClip: () => void }) {
  return (
    <div className="flex h-full flex-col items-center justify-center rounded-[1.25rem] border border-dashed border-white/10 bg-white/[0.02] px-6 py-12 text-center">
      <ScissorsLineDashed size={28} className="text-[#e0ff00]" />
      <h3 className="mt-4 text-xl font-semibold text-white">Drop media here or press Ctrl+I to import</h3>
      <p className="mt-2 max-w-md text-sm leading-6 text-[#8f97a2]">
        The timeline foundation is ready for shared project state, persistence, and undoable clip mutations.
      </p>
      <button
        type="button"
        onClick={onAddClip}
        className="mt-5 rounded-full bg-[#e0ff00] px-5 py-3 text-sm font-semibold text-black"
      >
        Add Demo Clip
      </button>
    </div>
  )
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-white/8 bg-black/20 p-3">
      <p className="text-[11px] uppercase tracking-[0.22em] text-[#7f8691]">{label}</p>
      <p className="mt-2 text-base font-semibold text-white">{value}</p>
    </div>
  )
}

function Badge({ label, tone = 'default' }: { label: string; tone?: 'default' | 'warn' | 'danger' }) {
  const classes =
    tone === 'warn'
      ? 'border-amber-300/20 bg-amber-500/10 text-amber-50'
      : tone === 'danger'
        ? 'border-red-400/20 bg-red-500/10 text-red-100'
      : 'border-white/10 bg-black/20'

  return <span className={`rounded-full border px-3 py-1 ${classes}`}>{label}</span>
}

function MiniButton({
  children,
  onClick,
  tone = 'default',
}: {
  children: React.ReactNode
  onClick: () => void
  tone?: 'default' | 'danger'
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center gap-1 rounded-full border px-3 py-2 text-xs ${
        tone === 'danger'
          ? 'border-red-400/20 bg-red-500/10 text-red-100'
          : 'border-white/10 bg-white/5 text-white'
      }`}
    >
      {children}
    </button>
  )
}

function ToolbarButton({
  children,
  onClick,
  tone = 'default',
}: {
  children: React.ReactNode
  onClick: () => void
  tone?: 'default' | 'accent' | 'danger'
}) {
  const className =
    tone === 'accent'
      ? 'inline-flex items-center gap-2 rounded-full bg-[#e0ff00] px-4 py-2 text-sm font-semibold text-black'
      : tone === 'danger'
        ? 'inline-flex items-center gap-2 rounded-full border border-red-400/20 bg-red-500/10 px-4 py-2 text-sm text-red-100'
        : 'inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm text-white'

  return (
    <button type="button" onClick={onClick} className={className}>
      {children}
    </button>
  )
}

function ContextAction({
  label,
  onClick,
  tone = 'default',
}: {
  label: string
  onClick: () => void
  tone?: 'default' | 'danger'
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`block w-full rounded-xl px-3 py-2 text-left text-sm ${
        tone === 'danger'
          ? 'bg-red-500/10 text-red-100 hover:bg-red-500/15'
          : 'text-white hover:bg-white/5'
      }`}
    >
      {label}
    </button>
  )
}

function ContextDivider() {
  return <div className="my-1 border-t border-white/8" />
}

function KeyframeStrip({
  duration,
  keyframes,
}: {
  duration: number
  keyframes: Array<{
    id: string
    time: number
    property: string
    value: number
  }>
}) {
  if (keyframes.length === 0) {
    return null
  }

  const propertyColorMap: Record<string, string> = {
    speed: '#facc15',
    opacity: '#e0ff00',
    volume: '#3b82f6',
    'transform.x': '#fb7185',
    'transform.y': '#f97316',
    'transform.scaleX': '#a78bfa',
    'transform.scaleY': '#8b5cf6',
    'transform.rotation': '#14b8a6',
  }

  return (
    <div className="mt-4 rounded-2xl border border-white/8 bg-black/20 p-3">
      <div className="mb-2 flex items-center justify-between text-[10px] uppercase tracking-[0.2em] text-[#7f8792]">
        <span>Keyframes</span>
        <span>{keyframes.length}</span>
      </div>
      <div className="relative h-10 rounded-xl border border-white/8 bg-[#0f1012]">
        <div className="absolute inset-x-3 top-1/2 h-px -translate-y-1/2 bg-white/10" />
        {keyframes.map((keyframe) => {
          const offsetPct = duration > 0 ? Math.max(0, Math.min(100, (keyframe.time / duration) * 100)) : 0
          const markerColor = propertyColorMap[keyframe.property] ?? '#ffffff'

          return (
            <div
              key={keyframe.id}
              title={`${keyframe.property} @ ${keyframe.time.toFixed(2)}s = ${keyframe.value.toFixed(2)}`}
              className="absolute top-1/2 h-4 w-4 -translate-x-1/2 -translate-y-1/2 rotate-45 rounded-[0.3rem] border border-black/30"
              style={{ left: `calc(${offsetPct}% * 0.94 + 3%)`, backgroundColor: markerColor }}
            />
          )
        })}
      </div>
      <div className="mt-2 flex flex-wrap gap-2 text-[10px] uppercase tracking-[0.16em] text-[#8f97a2]">
        {Array.from(new Set(keyframes.map((keyframe) => keyframe.property))).map((property) => (
          <span key={property} className="rounded-full border border-white/8 bg-white/[0.03] px-2 py-1">
            {property}
          </span>
        ))}
      </div>
    </div>
  )
}

function Waveform({
  clipDuration,
  volume,
  density,
  peaks,
}: {
  clipDuration: number
  volume: number
  density: 'compact' | 'balanced' | 'detailed'
  peaks: Array<{ min: number; max: number }> | null
}) {
  const fallbackBarCount = density === 'compact' ? 16 : density === 'balanced' ? 24 : 36
  const bars = peaks && peaks.length > 0
    ? peaks
    : Array.from({ length: fallbackBarCount }, (_, index) => {
        const envelope = 0.35 + ((Math.sin(index * 0.8) + 1) / 2) * 0.65
        const max = Number((envelope * volume).toFixed(3))
        const min = Number((-envelope * volume * 0.75).toFixed(3))
        return { min, max }
      })

  return (
    <div className="mt-4 rounded-2xl border border-white/8 bg-black/20 p-3">
      <div className="mb-2 flex items-center justify-between text-[10px] uppercase tracking-[0.2em] text-[#7f8792]">
        <span>Waveform</span>
        <span>{clipDuration.toFixed(1)}s</span>
      </div>
      <div className="flex h-12 items-end gap-1">
        {bars.map((peak, index) => {
          const amplitude = Math.max(Math.abs(peak.min), Math.abs(peak.max))
          const height = Math.max(12, Math.round(amplitude * volume * 40))

          return (
            <span
              key={`${peak.min}-${peak.max}-${index}`}
              className="w-full rounded-full bg-[#4ade80]/30"
              style={{ height }}
            />
          )
        })}
      </div>
    </div>
  )
}
