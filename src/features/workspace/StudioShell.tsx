import { Suspense, lazy, useCallback, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight, FolderOpen, SlidersHorizontal } from 'lucide-react'
import { useProjectStore } from '../../store/project-store'
import { STUDIO_TIMELINE_MIN_HEIGHT_PX } from '../../domain/project/studio-layout'
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

const MEDIA_W = 264
const INSPECTOR_W = 300
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
  const setStudioTimelineHeight = useProjectStore((state) => state.setStudioTimelineHeight)
  const toggleStudioMediaCollapse = useProjectStore((state) => state.toggleStudioMediaCollapse)
  const [dragHeight, setDragHeight] = useState<number | null>(null)
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
              <div style={{ width: MEDIA_W }} className="h-full shrink-0 border-r border-hairline">
                <ErrorBoundary label="Media bin" compact>
                  <MediaPanel onCollapse={toggleStudioMediaCollapse} />
                </ErrorBoundary>
              </div>
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
              <aside
                aria-label="Inspector"
                style={{ width: INSPECTOR_W }}
                className="flex h-full shrink-0 flex-col border-l border-hairline bg-surface-2"
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
