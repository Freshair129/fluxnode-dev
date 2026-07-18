import { Suspense, lazy, useCallback, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight, FolderOpen, SlidersHorizontal } from 'lucide-react'
import { useProjectStore } from '../../store/project-store'
import {
  STUDIO_INSPECTOR_MAX_WIDTH_PX,
  STUDIO_INSPECTOR_MIN_WIDTH_PX,
  STUDIO_MEDIA_MAX_WIDTH_PX,
  STUDIO_MEDIA_MIN_WIDTH_PX,
  STUDIO_TIMELINE_MIN_HEIGHT_PX,
} from '../../domain/project/studio-layout'
import { ErrorBoundary } from '../../components/ErrorBoundary'
import { IconButton } from '../../components/IconButton'
import { PanelFallback } from '../../app/App'
import { PreviewPanel } from '../preview/PreviewPanel'
import { TransportBar } from '../preview/TransportBar'
import { MediaPanel } from '../media/MediaPanel'
import { InspectorContent } from '../inspector/InspectorContent'

const WorkflowView = lazy(() =>
  import('../workflow/WorkflowView').then((module) => ({ default: module.WorkflowView })),
)
const StudioTimeline = lazy(() =>
  import('../timeline/StudioTimeline').then((module) => ({ default: module.StudioTimeline })),
)

const RAIL_W = 40

interface StudioShellProps {
  className?: string
}

/**
 * Studio workspace shell — the default, familiar NLE arrangement (CapCut/Premiere grammar):
 * media bin / preview monitor + transport / inspector across the top, a full-width
 * time-proportional timeline below a draggable splitter. The Nodes workspace tab swaps the upper
 * region for the workflow canvas while the timeline stays put. The MERIDIAN strata shell remains
 * available behind the `workspaceLayout` preference.
 */
export function StudioShell({ className }: StudioShellProps) {
  const activeView = useProjectStore((state) => state.ui.activeView)
  const inspectorCollapsed = useProjectStore((state) => state.project.meta.stageRowCollapse.inspector)
  const toggleStageRowCollapse = useProjectStore((state) => state.toggleStageRowCollapse)
  const selectedClipId = useProjectStore((state) => state.ui.selectedClipId)
  const selectedNodeId = useProjectStore((state) => state.ui.selectedNodeId)

  // Persisted per-project (project.meta.studioLayout — saved with the project file, restored on
  // load). `dragHeight` is the uncommitted preview while the splitter is being dragged; the store
  // is only written on pointer-up / keyboard commit so autosave never captures a mid-drag value.
  const mediaCollapsed = useProjectStore((state) => state.project.meta.studioLayout.mediaCollapsed)
  const persistedTimelineHeight = useProjectStore((state) => state.project.meta.studioLayout.timelineHeightPx)
  const persistedMediaWidth = useProjectStore((state) => state.project.meta.studioLayout.mediaWidthPx)
  const persistedInspectorWidth = useProjectStore((state) => state.project.meta.studioLayout.inspectorWidthPx)
  const setStudioTimelineHeight = useProjectStore((state) => state.setStudioTimelineHeight)
  const setStudioMediaWidth = useProjectStore((state) => state.setStudioMediaWidth)
  const setStudioInspectorWidth = useProjectStore((state) => state.setStudioInspectorWidth)
  const toggleStudioMediaCollapse = useProjectStore((state) => state.toggleStudioMediaCollapse)
  const [dragHeight, setDragHeight] = useState<number | null>(null)
  const [dragMediaWidth, setDragMediaWidth] = useState<number | null>(null)
  const [dragInspectorWidth, setDragInspectorWidth] = useState<number | null>(null)
  const shellRef = useRef<HTMLDivElement | null>(null)
  const dragOriginRef = useRef<{ startY: number; startHeight: number } | null>(null)

  const clampTimelineHeight = useCallback((height: number) => {
    const shellHeight = shellRef.current?.clientHeight ?? 900
    return Math.min(
      Math.max(height, STUDIO_TIMELINE_MIN_HEIGHT_PX),
      Math.max(STUDIO_TIMELINE_MIN_HEIGHT_PX, Math.round(shellHeight * 0.7)),
    )
  }, [])

  const timelineHeight = clampTimelineHeight(dragHeight ?? persistedTimelineHeight)
  const mediaWidth = dragMediaWidth ?? persistedMediaWidth
  const inspectorWidth = dragInspectorWidth ?? persistedInspectorWidth

  const hasSelection = selectedClipId !== null || selectedNodeId !== null

  return (
    <div
      ref={shellRef}
      data-meridian-shell
      className={`flex min-h-0 flex-col overflow-hidden rounded-[var(--radius-lg)] border border-hairline bg-panel ${className ?? ''}`}
    >
      <div className="flex min-h-0 flex-1">
        {activeView === 'workflow' ? (
          <div data-meridian-stratum="workflow" className="min-h-0 min-w-0 flex-1 overflow-y-auto">
            <ErrorBoundary label="Node workflow">
              <Suspense fallback={<PanelFallback label="Loading node canvas" />}>
                <WorkflowView />
              </Suspense>
            </ErrorBoundary>
          </div>
        ) : (
          <>
            {mediaCollapsed ? (
              <div
                aria-label="Media bin, collapsed"
                style={{ width: RAIL_W }}
                className="flex h-full shrink-0 flex-col items-center gap-3 border-r border-hairline bg-surface-2 py-3"
              >
                <IconButton
                  label="Expand media bin"
                  title="Expand media bin"
                  ariaExpanded={false}
                  size="sm"
                  onClick={toggleStudioMediaCollapse}
                >
                  <ChevronRight size={14} aria-hidden="true" />
                </IconButton>
                <FolderOpen size={16} aria-hidden="true" className="text-text-secondary" />
              </div>
            ) : (
              <>
                <div style={{ width: mediaWidth }} className="h-full shrink-0">
                  <ErrorBoundary label="Media bin" compact>
                    <MediaPanel onCollapse={toggleStudioMediaCollapse} />
                  </ErrorBoundary>
                </div>
                <PanelResizer
                  label="Resize media bin — drag, or use Left and Right arrow keys"
                  direction={1}
                  width={mediaWidth}
                  min={STUDIO_MEDIA_MIN_WIDTH_PX}
                  max={STUDIO_MEDIA_MAX_WIDTH_PX}
                  onPreview={setDragMediaWidth}
                  onCommit={(widthPx) => {
                    setStudioMediaWidth(widthPx)
                    setDragMediaWidth(null)
                  }}
                />
              </>
            )}

            <div className="flex min-w-0 flex-1 flex-col">
              <ErrorBoundary label="Preview monitor" compact>
                <div className="min-h-0 flex-1">
                  <PreviewPanel monitor />
                </div>
                <TransportBar />
              </ErrorBoundary>
            </div>

            {inspectorCollapsed ? (
              <div
                aria-label="Inspector, collapsed"
                style={{ width: RAIL_W }}
                className="flex h-full shrink-0 flex-col items-center gap-3 border-l border-hairline bg-surface-2 py-3"
              >
                <IconButton
                  label="Expand inspector"
                  title="Expand inspector"
                  ariaExpanded={false}
                  size="sm"
                  onClick={() => toggleStageRowCollapse('inspector')}
                >
                  <ChevronLeft size={14} aria-hidden="true" />
                </IconButton>
                <SlidersHorizontal
                  size={16}
                  aria-hidden="true"
                  className={hasSelection ? 'text-accent' : 'text-text-secondary'}
                />
              </div>
            ) : (
              <>
                <PanelResizer
                  label="Resize inspector — drag, or use Left and Right arrow keys"
                  direction={-1}
                  width={inspectorWidth}
                  min={STUDIO_INSPECTOR_MIN_WIDTH_PX}
                  max={STUDIO_INSPECTOR_MAX_WIDTH_PX}
                  onPreview={setDragInspectorWidth}
                  onCommit={(widthPx) => {
                    setStudioInspectorWidth(widthPx)
                    setDragInspectorWidth(null)
                  }}
                />
              <aside
                aria-label="Inspector"
                style={{ width: inspectorWidth }}
                className="flex h-full shrink-0 flex-col bg-surface-2"
              >
                <div className="flex shrink-0 items-center justify-between gap-2 border-b border-hairline px-3 py-[var(--meridian-gutter)]">
                  <p className="text-[11px] uppercase tracking-[0.22em] text-text-secondary">Inspector</p>
                  <IconButton
                    label="Collapse inspector"
                    title="Collapse inspector"
                    ariaExpanded
                    size="sm"
                    onClick={() => toggleStageRowCollapse('inspector')}
                  >
                    <ChevronRight size={14} aria-hidden="true" />
                  </IconButton>
                </div>
                <div className="min-h-0 flex-1 overflow-y-auto p-3">
                  <ErrorBoundary label="Inspector" compact>
                    <InspectorContent />
                  </ErrorBoundary>
                </div>
              </aside>
              </>
            )}
          </>
        )}
      </div>

      {/* Horizontal splitter between the upper region and the timeline. */}
      <div
        role="separator"
        aria-orientation="horizontal"
        aria-label="Resize timeline — drag, or use Up and Down arrow keys"
        aria-valuenow={Math.round(timelineHeight)}
        tabIndex={0}
        onPointerDown={(event) => {
          event.preventDefault()
          try {
            event.currentTarget.setPointerCapture(event.pointerId)
          } catch {
            // Synthetic pointer (automation) — drag still works within the element.
          }
          dragOriginRef.current = { startY: event.clientY, startHeight: timelineHeight }
        }}
        onPointerMove={(event) => {
          if (!dragOriginRef.current) {
            return
          }

          setDragHeight(clampTimelineHeight(dragOriginRef.current.startHeight + (dragOriginRef.current.startY - event.clientY)))
        }}
        onPointerUp={() => {
          dragOriginRef.current = null
          if (dragHeight !== null) {
            setStudioTimelineHeight(dragHeight)
          }
          setDragHeight(null)
        }}
        onPointerCancel={() => {
          // OS-level cancellation (alt-tab, touch cancel): discard the uncommitted preview so a
          // later plain hover over the splitter can't keep resizing.
          dragOriginRef.current = null
          setDragHeight(null)
        }}
        onKeyDown={(event) => {
          const stepPx = event.shiftKey ? 64 : 16

          if (event.key === 'ArrowUp') {
            event.preventDefault()
            setStudioTimelineHeight(clampTimelineHeight(timelineHeight + stepPx))
          } else if (event.key === 'ArrowDown') {
            event.preventDefault()
            setStudioTimelineHeight(clampTimelineHeight(timelineHeight - stepPx))
          }
        }}
        className="group flex h-1.5 shrink-0 cursor-row-resize items-center justify-center border-y border-hairline bg-surface-3 transition hover:bg-accent/20"
      >
        <span aria-hidden="true" className="h-0.5 w-10 rounded-full bg-white/20 transition group-hover:bg-accent/70" />
      </div>

      <div style={{ height: timelineHeight }} className="shrink-0">
        <ErrorBoundary label="Timeline">
          <Suspense fallback={<PanelFallback label="Loading timeline" compact />}>
            <StudioTimeline />
          </Suspense>
        </ErrorBoundary>
      </div>
    </div>
  )
}

/**
 * Vertical panel-edge resizer. `direction` maps pointer movement to width change: +1 for a
 * left-docked panel (dragging right widens it), -1 for a right-docked panel. Width previews
 * through `onPreview` while dragging and commits once on pointer-up / keyboard step, mirroring
 * the timeline splitter above so autosave never captures a mid-drag value; pointer cancellation
 * discards the preview.
 */
function PanelResizer({
  label,
  direction,
  width,
  min,
  max,
  onPreview,
  onCommit,
}: {
  label: string
  direction: 1 | -1
  width: number
  min: number
  max: number
  onPreview: (widthPx: number | null) => void
  onCommit: (widthPx: number) => void
}) {
  const originRef = useRef<{ startX: number; startWidth: number } | null>(null)
  const lastPreviewRef = useRef<number | null>(null)
  const clamp = (value: number) => Math.min(max, Math.max(min, Math.round(value)))

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      aria-valuenow={Math.round(width)}
      aria-valuemin={min}
      aria-valuemax={max}
      tabIndex={0}
      onPointerDown={(event) => {
        event.preventDefault()
        try {
          event.currentTarget.setPointerCapture(event.pointerId)
        } catch {
          // Synthetic pointer (automation) — drag still works within the element.
        }
        originRef.current = { startX: event.clientX, startWidth: width }
        lastPreviewRef.current = null
      }}
      onPointerMove={(event) => {
        if (!originRef.current) {
          return
        }

        const next = clamp(originRef.current.startWidth + direction * (event.clientX - originRef.current.startX))
        lastPreviewRef.current = next
        onPreview(next)
      }}
      onPointerUp={() => {
        originRef.current = null
        if (lastPreviewRef.current !== null) {
          onCommit(lastPreviewRef.current)
        }
        lastPreviewRef.current = null
      }}
      onPointerCancel={() => {
        originRef.current = null
        lastPreviewRef.current = null
        onPreview(null)
      }}
      onKeyDown={(event) => {
        const stepPx = event.shiftKey ? 48 : 12

        if (event.key === 'ArrowRight') {
          event.preventDefault()
          onCommit(clamp(width + direction * stepPx))
        } else if (event.key === 'ArrowLeft') {
          event.preventDefault()
          onCommit(clamp(width - direction * stepPx))
        }
      }}
      className="group flex w-1.5 shrink-0 cursor-col-resize items-center justify-center border-x border-hairline bg-surface-3 transition hover:bg-accent/20"
    >
      <span aria-hidden="true" className="h-10 w-0.5 rounded-full bg-white/20 transition group-hover:bg-accent/70" />
    </div>
  )
}
