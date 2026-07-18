import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent,
  type PointerEvent,
  type ReactNode,
} from 'react'
import {
  Copy,
  Eye,
  EyeOff,
  Film,
  ListPlus,
  Lock,
  LockOpen,
  Magnet,
  Minus,
  Music,
  Plus,
  Scissors,
  Trash2,
  Type,
  Upload,
  ZoomIn,
} from 'lucide-react'
import { useProjectStore } from '../../store/project-store'
import { useFileDropZone } from './useFileDropZone'
import { isTauriRuntime } from '../../services/ipc/tauri-runtime'
import { ContextMenu, ContextMenuDivider, ContextMenuItem } from '../../components/ContextMenu'
import { CommandMenuItem } from '../commands/CommandMenuItem'
import { ConfirmDialog } from '../../components/ConfirmDialog'
import { MEDIA_DRAG_MIME } from '../media/MediaPanel'
import type { Clip, Track } from '../../domain/project/types'

/** Pixels per second at zoom 1. `timeline.zoom` (0.25–6) scales this. */
const BASE_PPS = 60
/** Track-header column width. */
const HEADER_W = 176
/** Ruler row height. */
const RULER_H = 28
/** Snap threshold in screen pixels (converted to seconds at the current zoom). */
const SNAP_PX = 8
/** Extra scrollable room past the last clip so there is always space to drop into. */
const TAIL_PX = 480

type DragState =
  | { kind: 'move'; clipId: string; originStart: number; startClientX: number; dx: number }
  | {
      kind: 'trim-left' | 'trim-right'
      clipId: string
      originStart: number
      originDuration: number
      originInPoint: number
      startClientX: number
      dx: number
    }

function trackIcon(type: Track['type']) {
  if (type === 'audio') {
    return Music
  }

  if (type === 'subtitle') {
    return Type
  }

  return Film
}

/** Adaptive ruler tick step: the smallest "nice" interval that keeps labels ≥ ~72px apart. */
function tickStepSeconds(pps: number): number {
  const steps = [0.25, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600]
  return steps.find((step) => step * pps >= 72) ?? 600
}

/** Pointer capture that tolerates synthetic events (automation dispatches have no active pointer). */
function capturePointer(event: PointerEvent<HTMLElement>) {
  try {
    event.currentTarget.setPointerCapture(event.pointerId)
  } catch {
    // No live pointer to capture — dragging still works within the element.
  }
}

function formatRulerLabel(seconds: number): string {
  if (seconds < 60) {
    return Number.isInteger(seconds) ? `${seconds}s` : `${seconds.toFixed(2)}s`
  }

  const minutes = Math.floor(seconds / 60)
  const secs = Math.round(seconds % 60)
  return `${minutes}:${String(secs).padStart(2, '0')}`
}

/**
 * Studio-layout timeline: time-proportional lanes under an adaptive ruler — clips sit at
 * `startTime × zoom`, the playhead is a line spanning every lane, clips drag to move and trim at
 * their edges with snapping, and media-bin drags drop onto lanes at the pointer's time. This is
 * the CapCut/Premiere grammar the strata TimelineView's stacked clip cards never had.
 */
export function StudioTimeline() {
  const timeline = useProjectStore((state) => state.project.timeline)
  const assets = useProjectStore((state) => state.project.assets.assets)
  const assetThumbnails = useProjectStore((state) => state.assetThumbnails)
  const waveformCache = useProjectStore((state) => state.waveformCache)
  const selectedClipIds = useProjectStore((state) => state.ui.selectedClipIds)
  const selectedTrackId = useProjectStore((state) => state.ui.selectedTrackId)
  const playbackState = useProjectStore((state) => state.ui.playbackState)

  const selectClip = useProjectStore((state) => state.selectClip)
  const selectTrack = useProjectStore((state) => state.selectTrack)
  const setPlayhead = useProjectStore((state) => state.setPlayhead)
  const scrubPlayhead = useProjectStore((state) => state.scrubPlayhead)
  const setSelectedClipStartTime = useProjectStore((state) => state.setSelectedClipStartTime)
  const setSelectedClipInPoint = useProjectStore((state) => state.setSelectedClipInPoint)
  const setSelectedClipOutPoint = useProjectStore((state) => state.setSelectedClipOutPoint)
  const splitSelectedClip = useProjectStore((state) => state.splitSelectedClip)
  const deleteSelected = useProjectStore((state) => state.deleteSelected)
  const duplicateSelected = useProjectStore((state) => state.duplicateSelected)
  const copySelectedClips = useProjectStore((state) => state.copySelectedClips)
  const pasteTimelineClipboard = useProjectStore((state) => state.pasteTimelineClipboard)
  const adjustTimelineZoom = useProjectStore((state) => state.adjustTimelineZoom)
  const fitTimelineToWindow = useProjectStore((state) => state.fitTimelineToWindow)
  const addTrackBelow = useProjectStore((state) => state.addTrackBelow)
  const addTrackAbove = useProjectStore((state) => state.addTrackAbove)
  const moveSelectedTrack = useProjectStore((state) => state.moveSelectedTrack)
  const deleteSelectedTrack = useProjectStore((state) => state.deleteSelectedTrack)
  const renameSelectedTrack = useProjectStore((state) => state.renameSelectedTrack)
  const toggleSelectedTrackLock = useProjectStore((state) => state.toggleSelectedTrackLock)
  const toggleSelectedTrackMute = useProjectStore((state) => state.toggleSelectedTrackMute)
  const toggleSelectedTrackSolo = useProjectStore((state) => state.toggleSelectedTrackSolo)
  const toggleSelectedTrackVisibility = useProjectStore(
    (state) => state.toggleSelectedTrackVisibility,
  )
  const setSelectedClipSpeed = useProjectStore((state) => state.setSelectedClipSpeed)
  const replaceSelectedAssetPath = useProjectStore((state) => state.replaceSelectedAssetPath)
  const unlinkSelectedMedia = useProjectStore((state) => state.unlinkSelectedMedia)
  const showSelectedClipInWorkflow = useProjectStore((state) => state.showSelectedClipInWorkflow)
  const addClipFromAsset = useProjectStore((state) => state.addClipFromAsset)
  const importAssetFromPath = useProjectStore((state) => state.importAssetFromPath)
  const setTimelineScrollX = useProjectStore((state) => state.setTimelineScrollX)
  const projectId = useProjectStore((state) => state.project.meta.id)

  const [snapEnabled, setSnapEnabled] = useState(true)
  const [dragState, setDragState] = useState<DragState | null>(null)
  const [contextMenu, setContextMenu] = useState<{
    type: 'clip' | 'track'
    x: number
    y: number
  } | null>(null)
  const [confirmDeleteTrack, setConfirmDeleteTrack] = useState(false)
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const lastWrittenScrollXRef = useRef<number | null>(null)
  const scrollPersistTimerRef = useRef<number | null>(null)

  const pps = BASE_PPS * timeline.zoom
  const timelineEnd = useMemo(
    () =>
      timeline.tracks.reduce(
        (end, track) =>
          track.clips.reduce(
            (clipEnd, clip) => Math.max(clipEnd, clip.startTime + clip.duration),
            end,
          ),
        0,
      ),
    [timeline.tracks],
  )
  const totalClips = useMemo(
    () => timeline.tracks.reduce((count, track) => count + track.clips.length, 0),
    [timeline.tracks],
  )
  const laneWidth = Math.max(Math.ceil(timelineEnd * pps) + TAIL_PX, 960)
  const selectedTrack = timeline.tracks.find((track) => track.id === selectedTrackId) ?? null

  const handleFilesDropped = (paths: string[]) => {
    if (isTauriRuntime()) {
      for (const path of paths) {
        void importAssetFromPath(path)
      }
      return
    }

    void importAssetFromPath()
  }
  const fileDropZone = useFileDropZone<HTMLDivElement>(handleFilesDropped)

  /** Every static edge a dragged clip may snap to: 0, the playhead, and other clips' edges. */
  const snapCandidates = useMemo(() => {
    const candidates = [0, timeline.playhead]

    for (const track of timeline.tracks) {
      for (const clip of track.clips) {
        if (dragState && clip.id === dragState.clipId) {
          continue
        }

        candidates.push(clip.startTime, clip.startTime + clip.duration)
      }
    }

    return candidates
  }, [dragState, timeline.playhead, timeline.tracks])

  function snapTime(edges: number[], rawDelta: number): number {
    if (!snapEnabled) {
      return rawDelta
    }

    const threshold = SNAP_PX / pps
    let best: { delta: number; distance: number } | null = null

    for (const edge of edges) {
      for (const candidate of snapCandidates) {
        const distance = Math.abs(edge + rawDelta - candidate)

        if (distance < threshold && (best === null || distance < best.distance)) {
          best = { delta: candidate - edge, distance }
        }
      }
    }

    return best?.delta ?? rawDelta
  }

  // Restore the persisted horizontal scroll (project.timeline.scrollX) on mount, on project
  // switch, and on external writes (fitTimelineToWindow resets it to 0). Values this component
  // just persisted itself are skipped via lastWrittenScrollXRef so the debounced writer below
  // never fights live scrolling.
  useEffect(() => {
    const scroller = scrollRef.current

    if (!scroller || lastWrittenScrollXRef.current === timeline.scrollX) {
      return
    }

    scroller.scrollLeft = timeline.scrollX
  }, [projectId, timeline.scrollX])

  // Debounced scroll persistence (view state, outside undo history — see setTimelineScrollX).
  // The trailing write also flushes on unmount so tab switches don't lose the last position.
  useEffect(
    () => () => {
      if (scrollPersistTimerRef.current !== null) {
        window.clearTimeout(scrollPersistTimerRef.current)
        const scroller = scrollRef.current

        if (scroller) {
          lastWrittenScrollXRef.current = Math.round(scroller.scrollLeft)
          setTimelineScrollX(scroller.scrollLeft)
        }
      }
    },
    [setTimelineScrollX],
  )

  function handleScrollPersist() {
    if (scrollPersistTimerRef.current !== null) {
      window.clearTimeout(scrollPersistTimerRef.current)
    }

    scrollPersistTimerRef.current = window.setTimeout(() => {
      scrollPersistTimerRef.current = null
      const scroller = scrollRef.current

      if (scroller) {
        lastWrittenScrollXRef.current = Math.round(scroller.scrollLeft)
        setTimelineScrollX(scroller.scrollLeft)
      }
    }, 300)
  }

  // Ctrl+wheel zoom needs a NATIVE non-passive listener: React 17+ registers its root `wheel`
  // handler passively, so `preventDefault()` inside an `onWheel` prop can't stop the browser/
  // webview page-zoom from firing alongside the timeline zoom.
  useEffect(() => {
    const scroller = scrollRef.current

    if (!scroller) {
      return
    }

    function handleWheel(event: WheelEvent) {
      if (event.ctrlKey) {
        event.preventDefault()
        adjustTimelineZoom(event.deltaY < 0 ? 0.15 : -0.15)
      }
    }

    scroller.addEventListener('wheel', handleWheel, { passive: false })
    return () => scroller.removeEventListener('wheel', handleWheel)
  }, [adjustTimelineZoom])

  // Follow the playhead while playing (keep the line inside the viewport, CapCut-style).
  const playheadX = HEADER_W + timeline.playhead * pps
  useEffect(() => {
    if (playbackState === 'paused') {
      return
    }

    const scroller = scrollRef.current

    if (!scroller) {
      return
    }

    const visibleLeft = scroller.scrollLeft + HEADER_W
    const visibleRight = scroller.scrollLeft + scroller.clientWidth - 48

    if (playheadX < visibleLeft + 16 || playheadX > visibleRight) {
      scroller.scrollLeft = Math.max(0, playheadX - HEADER_W - 16)
    }
  }, [playbackState, playheadX])

  function seekFromRulerPointer(event: PointerEvent<HTMLDivElement>, commit: boolean) {
    const rect = event.currentTarget.getBoundingClientRect()
    const time = Math.max(0, (event.clientX - rect.left) / pps)

    if (commit) {
      setPlayhead(Number(time.toFixed(3)))
    } else {
      scrubPlayhead(Number(time.toFixed(3)))
    }
  }

  function beginClipDrag(event: PointerEvent<HTMLElement>, clip: Clip, kind: DragState['kind']) {
    if (event.button !== 0) {
      return
    }

    event.stopPropagation()
    // Non-additive select: move/trim always operates on exactly this clip (the store's
    // setSelectedClipStartTime applies to every selected clip, which would stack a
    // multi-selection onto one start time).
    selectClip(clip.id, false)
    capturePointer(event)

    if (kind === 'move') {
      setDragState({
        kind,
        clipId: clip.id,
        originStart: clip.startTime,
        startClientX: event.clientX,
        dx: 0,
      })
    } else {
      setDragState({
        kind,
        clipId: clip.id,
        originStart: clip.startTime,
        originDuration: clip.duration,
        originInPoint: clip.inPoint,
        startClientX: event.clientX,
        dx: 0,
      })
    }
  }

  function updateClipDrag(event: PointerEvent<HTMLElement>) {
    if (!dragState) {
      return
    }

    event.stopPropagation()
    setDragState({ ...dragState, dx: event.clientX - dragState.startClientX })
  }

  /** OS-level cancellation (alt-tab, touch cancel, capture loss) discards the uncommitted drag —
   *  without this, the stale drag state would keep tracking plain hover moves. */
  function cancelClipDrag() {
    setDragState(null)
  }

  function commitClipDrag(event: PointerEvent<HTMLElement>) {
    if (!dragState) {
      return
    }

    event.stopPropagation()
    const rawDelta = dragState.dx / pps

    if (dragState.kind === 'move') {
      const clipEnd = dragState.originStart + (findClip(dragState.clipId)?.duration ?? 0)
      const delta = snapTime([dragState.originStart, clipEnd], rawDelta)
      const nextStart = Math.max(0, dragState.originStart + delta)

      if (Math.abs(nextStart - dragState.originStart) > 0.0005) {
        setSelectedClipStartTime(nextStart)
      }
    } else if (dragState.kind === 'trim-right') {
      const delta = snapTime([dragState.originStart + dragState.originDuration], rawDelta)
      const nextDuration = Math.max(0.1, dragState.originDuration + delta)
      setSelectedClipOutPoint(dragState.originInPoint + nextDuration)
    } else {
      const maxDelta = dragState.originDuration - 0.1
      const minDelta = -dragState.originInPoint
      const delta = Math.min(
        maxDelta,
        Math.max(minDelta, snapTime([dragState.originStart], rawDelta)),
      )

      if (Math.abs(delta) > 0.0005) {
        setSelectedClipInPoint(dragState.originInPoint + delta)
        setSelectedClipStartTime(Math.max(0, dragState.originStart + delta))
      }
    }

    setDragState(null)
  }

  function findClip(clipId: string): Clip | null {
    for (const track of timeline.tracks) {
      const clip = track.clips.find((entry) => entry.id === clipId)

      if (clip) {
        return clip
      }
    }

    return null
  }

  /** Visual position while dragging (uncommitted preview). */
  function clipGeometry(clip: Clip): { left: number; width: number } {
    if (!dragState || dragState.clipId !== clip.id) {
      return { left: clip.startTime * pps, width: Math.max(clip.duration * pps, 8) }
    }

    const rawDelta = dragState.dx / pps

    if (dragState.kind === 'move') {
      const delta = snapTime(
        [dragState.originStart, dragState.originStart + clip.duration],
        rawDelta,
      )
      return {
        left: Math.max(0, dragState.originStart + delta) * pps,
        width: Math.max(clip.duration * pps, 8),
      }
    }

    if (dragState.kind === 'trim-right') {
      const delta = snapTime([dragState.originStart + dragState.originDuration], rawDelta)
      const width = Math.max(0.1, dragState.originDuration + delta) * pps
      return { left: dragState.originStart * pps, width: Math.max(width, 8) }
    }

    const maxDelta = dragState.originDuration - 0.1
    const minDelta = -dragState.originInPoint
    const delta = Math.min(
      maxDelta,
      Math.max(minDelta, snapTime([dragState.originStart], rawDelta)),
    )
    return {
      left: Math.max(0, dragState.originStart + delta) * pps,
      width: Math.max((dragState.originDuration - delta) * pps, 8),
    }
  }

  function handleLaneDrop(event: DragEvent<HTMLDivElement>, track: Track) {
    const assetId = event.dataTransfer.getData(MEDIA_DRAG_MIME)

    if (!assetId) {
      return
    }

    event.preventDefault()
    event.stopPropagation()
    const rect = event.currentTarget.getBoundingClientRect()
    const time = Math.max(0, (event.clientX - rect.left) / pps)
    addClipFromAsset(assetId, { trackId: track.id, startTime: Number(time.toFixed(2)) })
  }

  const step = tickStepSeconds(pps)
  const tickCount = Math.ceil(laneWidth / (step * pps)) + 1

  return (
    <section
      aria-label="Timeline editor"
      data-meridian-stratum="timeline"
      className="flex h-full min-h-0 flex-col bg-surface-3"
    >
      {/* Compact icon toolbar — CapCut grammar: edit verbs left, zoom right, no labels. */}
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-hairline px-2 py-1">
        <div className="flex items-center gap-0.5">
          <ToolbarIcon label="Split clip at playhead (S)" onClick={splitSelectedClip}>
            <Scissors size={14} aria-hidden="true" />
          </ToolbarIcon>
          <ToolbarIcon label="Copy selected clips (Ctrl+C)" onClick={copySelectedClips}>
            <Copy size={14} aria-hidden="true" />
          </ToolbarIcon>
          <ToolbarIcon label="Paste clips (Ctrl+V)" onClick={pasteTimelineClipboard}>
            <ListPlus size={14} aria-hidden="true" />
          </ToolbarIcon>
          <ToolbarIcon label="Duplicate selected (Ctrl+D)" onClick={duplicateSelected}>
            <Plus size={14} aria-hidden="true" />
          </ToolbarIcon>
          <ToolbarIcon label="Delete selected (Delete)" tone="danger" onClick={deleteSelected}>
            <Trash2 size={14} aria-hidden="true" />
          </ToolbarIcon>
          <div className="mx-1 h-4 w-px bg-white/10" aria-hidden="true" />
          <ToolbarIcon
            label={
              snapEnabled ? 'Snapping on — click to turn off' : 'Snapping off — click to turn on'
            }
            pressed={snapEnabled}
            onClick={() => setSnapEnabled((current) => !current)}
          >
            <Magnet size={14} aria-hidden="true" />
          </ToolbarIcon>
          <ToolbarIcon label="Add track" onClick={addTrackBelow}>
            <ListPlus size={14} aria-hidden="true" className="rotate-180" />
          </ToolbarIcon>
        </div>

        <div className="flex items-center gap-1.5">
          <ToolbarIcon label="Zoom out (Ctrl+scroll)" onClick={() => adjustTimelineZoom(-0.25)}>
            <Minus size={14} aria-hidden="true" />
          </ToolbarIcon>
          <input
            type="range"
            min={0.25}
            max={6}
            step={0.05}
            value={timeline.zoom}
            onChange={(event) => adjustTimelineZoom(Number(event.target.value) - timeline.zoom)}
            aria-label={`Timeline zoom, ${timeline.zoom.toFixed(2)}x`}
            title={`Zoom ${timeline.zoom.toFixed(2)}x`}
            className="w-28 accent-accent"
          />
          <ToolbarIcon label="Zoom in (Ctrl+scroll)" onClick={() => adjustTimelineZoom(0.25)}>
            <ZoomIn size={14} aria-hidden="true" />
          </ToolbarIcon>
          <button
            type="button"
            onClick={fitTimelineToWindow}
            className="rounded-[var(--radius-md)] px-2 py-1 text-[11px] font-medium text-text-secondary transition hover:bg-white/8 hover:text-white"
          >
            Fit
          </button>
        </div>
      </div>

      {/* One scroll container: sticky ruler row + sticky track headers, so lanes/ruler/headers
          can never drift out of alignment. */}
      <div
        ref={(element) => {
          scrollRef.current = element
          fileDropZone.zoneRef.current = element
        }}
        {...fileDropZone.browserDragHandlers}
        onScroll={handleScrollPersist}
        className={`relative min-h-0 flex-1 overflow-auto outline-2 -outline-offset-2 transition ${
          fileDropZone.isActive ? 'outline-accent/60' : 'outline-transparent'
        }`}
      >
        <div className="relative" style={{ width: HEADER_W + laneWidth }}>
          {/* Ruler row */}
          <div className="sticky top-0 z-30 flex" style={{ height: RULER_H }}>
            <div
              className="sticky left-0 z-10 shrink-0 border-b border-r border-hairline bg-surface-3"
              style={{ width: HEADER_W }}
              aria-hidden="true"
            />
            <div
              role="slider"
              tabIndex={0}
              aria-label="Timeline ruler — drag or use arrow keys to move the playhead"
              aria-valuemin={0}
              aria-valuemax={Number(Math.max(timelineEnd, 0).toFixed(2))}
              aria-valuenow={Number(timeline.playhead.toFixed(2))}
              aria-valuetext={`${timeline.playhead.toFixed(2)} seconds`}
              className="relative shrink-0 cursor-ew-resize border-b border-hairline bg-surface-3"
              style={{ width: laneWidth }}
              onPointerDown={(event) => {
                capturePointer(event)
                seekFromRulerPointer(event, false)
              }}
              onPointerMove={(event) => {
                if (event.buttons === 1) {
                  seekFromRulerPointer(event, false)
                }
              }}
              onPointerUp={(event) => seekFromRulerPointer(event, true)}
              onKeyDown={(event) => {
                const nudge = event.shiftKey ? step : step / 4

                if (event.key === 'ArrowRight') {
                  event.preventDefault()
                  setPlayhead(timeline.playhead + nudge)
                } else if (event.key === 'ArrowLeft') {
                  event.preventDefault()
                  setPlayhead(Math.max(0, timeline.playhead - nudge))
                } else if (event.key === 'Home') {
                  event.preventDefault()
                  setPlayhead(0)
                } else if (event.key === 'End') {
                  event.preventDefault()
                  setPlayhead(timelineEnd)
                }
              }}
            >
              {timeline.inPoint !== null &&
              timeline.outPoint !== null &&
              timeline.outPoint > timeline.inPoint ? (
                <div
                  aria-hidden="true"
                  className="absolute bottom-0 top-0 bg-accent/10"
                  style={{
                    left: timeline.inPoint * pps,
                    width: (timeline.outPoint - timeline.inPoint) * pps,
                  }}
                />
              ) : null}
              {Array.from({ length: tickCount }, (_, index) => {
                const seconds = index * step
                return (
                  <div
                    key={seconds}
                    aria-hidden="true"
                    className="absolute bottom-0 top-0 border-l border-white/12"
                    style={{ left: seconds * pps }}
                  >
                    <span className="absolute left-1 top-0.5 font-mono text-[10px] tabular-nums text-text-secondary">
                      {formatRulerLabel(seconds)}
                    </span>
                  </div>
                )
              })}
              {/* Playhead grab handle on the ruler */}
              <div
                aria-hidden="true"
                className="pointer-events-none absolute top-0 z-10 h-full"
                style={{ left: timeline.playhead * pps }}
              >
                <div className="absolute -left-[5px] top-0 h-0 w-0 border-x-[5px] border-t-[7px] border-x-transparent border-t-accent" />
              </div>
            </div>
          </div>

          {/* Track rows */}
          {timeline.tracks.map((track) => {
            const TrackTypeIcon = trackIcon(track.type)
            const laneHeight = Math.max(track.height, 44)
            const isSelectedTrack = selectedTrackId === track.id

            return (
              <div key={track.id} className="flex" style={{ height: laneHeight }}>
                <div
                  role="button"
                  tabIndex={0}
                  aria-label={`Track ${track.name}, ${track.type}, ${track.clips.length} clips`}
                  onClick={() => selectTrack(track.id)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault()
                      selectTrack(track.id)
                    }
                  }}
                  onDoubleClick={() => {
                    selectTrack(track.id)
                    renameSelectedTrack()
                  }}
                  onContextMenu={(event) => {
                    event.preventDefault()
                    selectTrack(track.id)
                    setContextMenu({ type: 'track', x: event.clientX, y: event.clientY })
                  }}
                  className={`sticky left-0 z-20 flex shrink-0 flex-col justify-between border-b border-r border-hairline px-2.5 py-1.5 text-left transition ${
                    isSelectedTrack ? 'bg-surface' : 'bg-surface-2'
                  }`}
                  style={{ width: HEADER_W }}
                >
                  <div className="flex min-w-0 items-center gap-1.5">
                    <TrackTypeIcon
                      size={12}
                      aria-hidden="true"
                      className="shrink-0 text-text-secondary"
                    />
                    <span
                      className="truncate text-xs font-medium text-text-data"
                      title={track.name}
                    >
                      {track.name}
                    </span>
                  </div>
                  <div className="flex items-center gap-0.5">
                    <TrackToggle
                      label={track.visible === false ? `Show ${track.name}` : `Hide ${track.name}`}
                      active={track.visible === false}
                      onClick={() => {
                        selectTrack(track.id)
                        toggleSelectedTrackVisibility()
                      }}
                    >
                      {track.visible === false ? (
                        <EyeOff size={12} aria-hidden="true" />
                      ) : (
                        <Eye size={12} aria-hidden="true" />
                      )}
                    </TrackToggle>
                    <TrackToggle
                      label={track.muted ? `Unmute ${track.name}` : `Mute ${track.name}`}
                      active={track.muted}
                      onClick={() => {
                        selectTrack(track.id)
                        toggleSelectedTrackMute()
                      }}
                    >
                      <span className="text-[10px] font-semibold leading-none">M</span>
                    </TrackToggle>
                    <TrackToggle
                      label={track.solo ? `Unsolo ${track.name}` : `Solo ${track.name}`}
                      active={track.solo}
                      onClick={() => {
                        selectTrack(track.id)
                        toggleSelectedTrackSolo()
                      }}
                    >
                      <span className="text-[10px] font-semibold leading-none">S</span>
                    </TrackToggle>
                    <TrackToggle
                      label={track.locked ? `Unlock ${track.name}` : `Lock ${track.name}`}
                      active={track.locked}
                      onClick={() => {
                        selectTrack(track.id)
                        toggleSelectedTrackLock()
                      }}
                    >
                      {track.locked ? (
                        <Lock size={12} aria-hidden="true" />
                      ) : (
                        <LockOpen size={12} aria-hidden="true" />
                      )}
                    </TrackToggle>
                  </div>
                </div>

                <div
                  role="group"
                  aria-label={`${track.name} lane`}
                  className={`relative shrink-0 border-b border-hairline ${track.locked ? 'opacity-60' : ''} ${
                    isSelectedTrack ? 'bg-white/[0.02]' : ''
                  }`}
                  style={{ width: laneWidth }}
                  onDragOver={(event) => {
                    if (event.dataTransfer.types.includes(MEDIA_DRAG_MIME)) {
                      event.preventDefault()
                      event.dataTransfer.dropEffect = 'copy'
                    }
                  }}
                  onDrop={(event) => handleLaneDrop(event, track)}
                  onPointerDown={(event) => {
                    // Click on empty lane space: select the track and deselect clips.
                    if (event.target === event.currentTarget) {
                      selectTrack(track.id)
                      selectClip(null)
                    }
                  }}
                >
                  {track.clips.map((clip) => {
                    const asset = assets[clip.assetId]
                    const isSelected = selectedClipIds.includes(clip.id)
                    const geometry = clipGeometry(clip)
                    const thumbnail = assetThumbnails[clip.assetId]?.thumbnailPath ?? null
                    const peaks =
                      track.type === 'audio' ? (waveformCache[clip.assetId]?.peaks ?? null) : null

                    return (
                      <article
                        key={clip.id}
                        data-meridian-clip-id={clip.id}
                        role="button"
                        tabIndex={0}
                        aria-label={`Clip ${asset?.name ?? clip.assetId}, starts at ${clip.startTime.toFixed(1)} seconds, duration ${clip.duration.toFixed(1)} seconds`}
                        title={asset?.name ?? clip.assetId}
                        onClick={(event) => {
                          event.stopPropagation()
                          selectClip(clip.id, event.ctrlKey || event.metaKey)
                        }}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter' || event.key === ' ') {
                            event.preventDefault()
                            event.stopPropagation()
                            selectClip(clip.id, event.ctrlKey || event.metaKey)
                          }
                        }}
                        onContextMenu={(event) => {
                          event.preventDefault()
                          event.stopPropagation()
                          selectClip(clip.id, false)
                          setContextMenu({ type: 'clip', x: event.clientX, y: event.clientY })
                        }}
                        onPointerDown={(event) => {
                          if (!track.locked && !(event.ctrlKey || event.metaKey)) {
                            beginClipDrag(event, clip, 'move')
                          }
                        }}
                        onPointerMove={updateClipDrag}
                        onPointerUp={commitClipDrag}
                        onPointerCancel={cancelClipDrag}
                        className={`absolute bottom-1 top-1 cursor-grab touch-none select-none overflow-hidden rounded-[var(--radius-md)] border transition-[border-color,box-shadow] active:cursor-grabbing ${
                          isSelected
                            ? 'z-10 border-accent shadow-[0_0_0_1px_rgba(224,255,0,0.35)]'
                            : 'border-white/15 hover:border-white/30'
                        } ${track.type === 'audio' ? 'bg-[#12240f]' : 'bg-[#101d2b]'}`}
                        style={{ left: geometry.left, width: geometry.width }}
                      >
                        {thumbnail && track.type !== 'audio' ? (
                          <div
                            aria-hidden="true"
                            className="absolute inset-0 opacity-55"
                            style={{
                              backgroundImage: `url(${JSON.stringify(thumbnail)})`,
                              backgroundSize: 'auto 100%',
                              backgroundRepeat: 'repeat-x',
                            }}
                          />
                        ) : null}
                        {peaks && peaks.length > 0 ? <WaveformStrip peaks={peaks} /> : null}
                        <div className="pointer-events-none relative flex h-full flex-col justify-between p-1.5">
                          <span className="truncate text-[10px] font-medium text-white drop-shadow-[0_1px_2px_rgba(0,0,0,0.9)]">
                            {asset?.name ?? clip.assetId}
                          </span>
                          <span className="flex items-center gap-1">
                            {clip.speed !== 1 ? (
                              <span className="rounded-[3px] bg-black/60 px-1 font-mono text-[9px] tabular-nums text-accent-soft">
                                {clip.speed.toFixed(2).replace(/\.?0+$/, '')}x
                              </span>
                            ) : null}
                            {asset?.status === 'missing' || asset?.status === 'corrupt' ? (
                              <span className="rounded-[3px] bg-danger/80 px-1 text-[9px] font-semibold text-black">
                                {asset.status === 'missing' ? 'offline' : 'error'}
                              </span>
                            ) : null}
                            {clip.keyframes.length > 0 ? (
                              <span className="rounded-[3px] bg-black/60 px-1 font-mono text-[9px] tabular-nums text-text-data">
                                ◆{clip.keyframes.length}
                              </span>
                            ) : null}
                          </span>
                        </div>
                        {isSelected && !track.locked ? (
                          <>
                            <span
                              role="presentation"
                              onPointerDown={(event) => beginClipDrag(event, clip, 'trim-left')}
                              onPointerMove={updateClipDrag}
                              onPointerUp={commitClipDrag}
                              onPointerCancel={cancelClipDrag}
                              className="absolute inset-y-0 left-0 w-2 cursor-ew-resize bg-accent/80"
                              style={{ borderRadius: 'var(--radius-md) 0 0 var(--radius-md)' }}
                            />
                            <span
                              role="presentation"
                              onPointerDown={(event) => beginClipDrag(event, clip, 'trim-right')}
                              onPointerMove={updateClipDrag}
                              onPointerUp={commitClipDrag}
                              onPointerCancel={cancelClipDrag}
                              className="absolute inset-y-0 right-0 w-2 cursor-ew-resize bg-accent/80"
                              style={{ borderRadius: '0 var(--radius-md) var(--radius-md) 0' }}
                            />
                          </>
                        ) : null}
                      </article>
                    )
                  })}
                </div>
              </div>
            )
          })}

          {/* Playhead line spanning all lanes (under the sticky headers/ruler, above clips). */}
          <div
            aria-hidden="true"
            className="pointer-events-none absolute bottom-0 z-20 w-px bg-accent"
            style={{ left: playheadX, top: RULER_H }}
          />
        </div>

        {totalClips === 0 ? (
          <div
            className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center"
            style={{ paddingLeft: HEADER_W }}
          >
            <div className="pointer-events-auto flex flex-col items-center gap-3 rounded-[var(--radius-lg)] border border-dashed border-white/15 bg-black/40 px-8 py-6 text-center backdrop-blur-sm">
              <Upload size={20} aria-hidden="true" className="text-text-secondary" />
              <p className="text-sm text-text-data">
                Drag media here, or import to start your edit.
              </p>
              <button
                type="button"
                onClick={() => void importAssetFromPath()}
                className="rounded-[var(--radius-md)] bg-accent px-3 py-1.5 text-xs font-semibold text-black transition hover:brightness-95"
              >
                Import media
              </button>
            </div>
          </div>
        ) : null}
      </div>

      {contextMenu ? (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          label={contextMenu.type === 'clip' ? 'Clip actions' : 'Track actions'}
        >
          {contextMenu.type === 'clip' ? (
            <div className="space-y-1">
              <CommandMenuItem
                commandId="timeline.split"
                onActivated={() => setContextMenu(null)}
              />
              <CommandMenuItem
                commandId="selection.duplicate"
                onActivated={() => setContextMenu(null)}
              />
              <CommandMenuItem
                commandId="selection.delete"
                tone="danger"
                onActivated={() => setContextMenu(null)}
              />
              <ContextMenuDivider />
              {[0.5, 1, 2, 4].map((speed) => (
                <ContextMenuItem
                  key={speed}
                  label={`Speed ${speed}x`}
                  onClick={() => {
                    setSelectedClipSpeed(speed)
                    setContextMenu(null)
                  }}
                />
              ))}
              <ContextMenuDivider />
              <ContextMenuItem
                label="Replace media…"
                onClick={() => {
                  setContextMenu(null)
                  void replaceSelectedAssetPath()
                }}
              />
              <ContextMenuItem
                label="Unlink audio / video"
                onClick={() => {
                  unlinkSelectedMedia()
                  setContextMenu(null)
                }}
              />
              <ContextMenuItem
                label="Show in node workflow"
                onClick={() => {
                  showSelectedClipInWorkflow()
                  setContextMenu(null)
                }}
              />
            </div>
          ) : (
            <div className="space-y-1">
              <ContextMenuItem
                label="Add track above"
                onClick={() => {
                  addTrackAbove()
                  setContextMenu(null)
                }}
              />
              <ContextMenuItem
                label="Add track below"
                onClick={() => {
                  addTrackBelow()
                  setContextMenu(null)
                }}
              />
              <ContextMenuItem
                label="Move up"
                onClick={() => {
                  moveSelectedTrack('up')
                  setContextMenu(null)
                }}
              />
              <ContextMenuItem
                label="Move down"
                onClick={() => {
                  moveSelectedTrack('down')
                  setContextMenu(null)
                }}
              />
              <ContextMenuDivider />
              <ContextMenuItem
                label="Rename track…"
                onClick={() => {
                  setContextMenu(null)
                  renameSelectedTrack()
                }}
              />
              <ContextMenuItem
                label="Delete track"
                tone="danger"
                onClick={() => {
                  setContextMenu(null)
                  setConfirmDeleteTrack(true)
                }}
              />
            </div>
          )}
        </ContextMenu>
      ) : null}

      {contextMenu ? (
        <button
          type="button"
          aria-label="Close menu"
          className="fixed inset-0 z-20 cursor-default"
          onClick={() => setContextMenu(null)}
          onContextMenu={(event) => {
            event.preventDefault()
            setContextMenu(null)
          }}
        />
      ) : null}

      <ConfirmDialog
        open={confirmDeleteTrack}
        title="Delete track"
        description={`Delete ${selectedTrack?.name ?? 'this track'} and all of its clips? You can undo this.`}
        confirmLabel="Delete track"
        onConfirm={() => {
          deleteSelectedTrack()
          setConfirmDeleteTrack(false)
        }}
        onCancel={() => setConfirmDeleteTrack(false)}
      />
    </section>
  )
}

function ToolbarIcon({
  label,
  onClick,
  children,
  pressed,
  tone = 'default',
}: {
  label: string
  onClick: () => void
  children: ReactNode
  pressed?: boolean
  tone?: 'default' | 'danger'
}) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={pressed}
      title={label}
      onClick={onClick}
      className={`inline-flex h-7 w-7 items-center justify-center rounded-[var(--radius-md)] transition ${
        pressed
          ? 'bg-accent/15 text-accent'
          : tone === 'danger'
            ? 'text-text-secondary hover:bg-danger/15 hover:text-danger'
            : 'text-text-secondary hover:bg-white/8 hover:text-white'
      }`}
    >
      {children}
    </button>
  )
}

function TrackToggle({
  label,
  active,
  onClick,
  children,
}: {
  label: string
  active: boolean
  onClick: () => void
  children: ReactNode
}) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={active}
      title={label}
      onClick={(event) => {
        event.stopPropagation()
        onClick()
      }}
      className={`inline-flex h-5 w-5 items-center justify-center rounded-[var(--radius-sm)] transition ${
        active
          ? 'bg-accent/20 text-accent'
          : 'text-text-secondary hover:bg-white/8 hover:text-white'
      }`}
    >
      {children}
    </button>
  )
}

/** Lightweight peak strip for audio clips: downsampled symmetric bars in one SVG. */
function WaveformStrip({ peaks }: { peaks: { min: number; max: number }[] }) {
  const bars = 96
  const stride = Math.max(1, Math.floor(peaks.length / bars))
  const sampled: number[] = []

  for (let index = 0; index < peaks.length; index += stride) {
    const peak = peaks[index]
    sampled.push(Math.min(1, Math.max(Math.abs(peak.max), Math.abs(peak.min))))
  }

  return (
    <svg
      aria-hidden="true"
      className="absolute inset-0 h-full w-full text-success/70"
      viewBox={`0 0 ${sampled.length} 2`}
      preserveAspectRatio="none"
    >
      {sampled.map((value, index) => (
        <rect
          key={index}
          x={index + 0.15}
          y={1 - value}
          width={0.7}
          height={Math.max(value * 2, 0.06)}
          fill="currentColor"
        />
      ))}
    </svg>
  )
}
