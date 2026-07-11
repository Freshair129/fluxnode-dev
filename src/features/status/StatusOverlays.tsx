import { useProjectStore } from '../../store/project-store'
import type { StatusDrawerId } from './statusBar/segments'
import { ExportSheet } from './export/ExportSheet'
import { ConnectivityDrawer } from './drawers/ConnectivityDrawer'
import { AppUpdatesDrawer } from './drawers/AppUpdatesDrawer'
import { WorkspaceSharingDrawer } from './drawers/WorkspaceSharingDrawer'
import { AudioRuntimeDrawer } from './drawers/AudioRuntimeDrawer'
import { FailureInspectorModal } from './FailureInspectorModal'

export interface StatusOverlaysProps {
  openDrawer: StatusDrawerId | null
  onCloseDrawer: () => void
  showExportSheet: boolean
  onCloseExportSheet: () => void
  inspectorJobId: string | null
  onInspect: (jobId: string) => void
  onCloseInspector: () => void
}

/**
 * MERIDIAN item 9: the non-modal overlay host mounted once alongside `WelcomeModal`/`SettingsModal`
 * etc. in `App.tsx`. Owns nothing itself — `App.tsx` (mirroring its existing
 * `showShortcutsHelp`/`showCommandPalette` local-state pattern) holds which surface is open and
 * passes it down here, so this component is a thin, always-mounted router: at most one of
 * {export sheet, one drawer} renders at a time (single active secondary surface — see
 * `DrawerShell`'s doc comment for why they're not `aria-modal`), plus `FailureInspectorModal` on
 * top of whichever is open, since it's the one TRUE modal this surface can produce.
 */
export function StatusOverlays({
  openDrawer,
  onCloseDrawer,
  showExportSheet,
  onCloseExportSheet,
  inspectorJobId,
  onInspect,
  onCloseInspector,
}: StatusOverlaysProps) {
  const queue = useProjectStore((state) => state.project.output.queue)
  const appErrors = useProjectStore((state) => state.appErrors)
  const retryFailedRender = useProjectStore((state) => state.retryFailedRender)
  const performAppErrorAction = useProjectStore((state) => state.performAppErrorAction)

  // Same open-signal contract FailureInspectorModal always had (SystemPanels.tsx, items 12/13):
  // derived ONLY from an explicit id, never a fallback scan — see FailureInspectorModal's own doc
  // comment for why a fallback re-derivation would wedge its own Close button.
  const inspectorJob = inspectorJobId === null ? null : (queue.find((job) => job.id === inspectorJobId) ?? null)
  const quotaErrors = appErrors.filter((error) => error.category === 'cloud_quota')
  const inspectorQuotaError = inspectorJobId === null ? null : (quotaErrors.find((error) => error.contextId === inspectorJobId) ?? null)

  return (
    <>
      {showExportSheet ? <ExportSheet onClose={onCloseExportSheet} onInspect={onInspect} /> : null}
      {openDrawer === 'connectivity' ? <ConnectivityDrawer onClose={onCloseDrawer} /> : null}
      {openDrawer === 'appUpdates' ? <AppUpdatesDrawer onClose={onCloseDrawer} /> : null}
      {openDrawer === 'workspace' ? <WorkspaceSharingDrawer onClose={onCloseDrawer} /> : null}
      {openDrawer === 'audio' ? <AudioRuntimeDrawer onClose={onCloseDrawer} onInspect={onInspect} /> : null}
      {inspectorJob || inspectorQuotaError ? (
        <FailureInspectorModal
          job={inspectorJob}
          quotaError={inspectorQuotaError}
          onClose={onCloseInspector}
          onRetry={(jobId) => void retryFailedRender(jobId)}
          onResolveQuota={(errorId) => void performAppErrorAction(errorId)}
        />
      ) : null}
    </>
  )
}
