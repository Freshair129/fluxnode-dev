import { ChevronLeft, ChevronRight, SlidersHorizontal } from 'lucide-react'
import { IconButton } from '../../components/IconButton'
import { useProjectStore } from '../../store/project-store'
import { InspectorContent } from './InspectorContent'

const INSPECTOR_WIDTH_PX = 288
const RAIL_WIDTH_PX = 40

/**
 * MERIDIAN stage row (item 3), right organ (spec F/M.4: "inspector"). Docked, fixed-width
 * (288px) context inspector for the current selection, collapsible to a 40px icon rail (spec
 * F.3). Wraps the same `InspectorContent` the detached inspector window uses — see that file's
 * header comment for why the responsive grids inside it don't need a "docked vs detached" prop.
 */
export function StageInspector() {
  const collapsed = useProjectStore((state) => state.project.meta.stageRowCollapse.inspector)
  const toggleStageRowCollapse = useProjectStore((state) => state.toggleStageRowCollapse)
  const selectedNodeId = useProjectStore((state) => state.ui.selectedNodeId)
  const selectedClipId = useProjectStore((state) => state.ui.selectedClipId)
  const hasSelection = selectedNodeId !== null || selectedClipId !== null

  if (collapsed) {
    return (
      <div
        aria-label="Context inspector, collapsed"
        data-meridian-inspector-rail
        style={{ width: RAIL_WIDTH_PX }}
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
    )
  }

  return (
    <aside
      aria-label="Context inspector"
      data-meridian-inspector
      style={{ width: INSPECTOR_WIDTH_PX }}
      className="flex h-full shrink-0 flex-col border-l border-hairline bg-surface-2"
    >
      {/* Item 7: header row's vertical padding follows --meridian-gutter (spec G 8px/6px), same
          treatment as JobLedger's header, so both stage-row rails tighten together in compact. */}
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
        <InspectorContent />
      </div>
    </aside>
  )
}
