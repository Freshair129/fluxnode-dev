import { Radio } from 'lucide-react'
import { useProjectStore } from '../../../store/project-store'
import { StatusPill } from '../shared/PanelPrimitives'
import { DrawerShell } from './DrawerShell'

/**
 * MERIDIAN item 9: relocated verbatim content from `SystemPanels.tsx`'s "Connectivity status"
 * section (also the destination for the status bar's `compute` and `connectivity` segments — spec
 * F's compute-mode/connectivity wireframe items don't have distinct owning drawers in this app, so
 * both route here).
 */
export function ConnectivityDrawer({ onClose }: { onClose: () => void }) {
  const networkStatus = useProjectStore((state) => state.ui.networkStatus)
  const performanceMode = useProjectStore((state) => state.ui.performanceMode)
  const runtimeHealth = useProjectStore((state) => state.runtimeHealth)
  const runtimeCacheMetrics = useProjectStore((state) => state.runtimeCacheMetrics)
  const comfyConnected = useProjectStore((state) => state.comfyConnected)
  const cloudApiKey = useProjectStore((state) => state.preferences.cloudApiKey)
  const computeMode = useProjectStore((state) => state.project.workflow.computeMode)
  const estimatedAppFootprintGb = Number.isFinite(runtimeCacheMetrics?.estimatedAppFootprintGb)
    ? runtimeCacheMetrics.estimatedAppFootprintGb
    : null
  const memoryPressurePct = Number.isFinite(runtimeCacheMetrics?.memoryPressurePct)
    ? runtimeCacheMetrics.memoryPressurePct
    : null

  return (
    <DrawerShell icon={Radio} title="Connectivity" onClose={onClose}>
      <div aria-live="polite" className="space-y-3">
        <StatusPill label={`Compute: ${computeMode === 'local' ? 'Local' : 'Cloud'}`} tone={computeMode === 'local' ? 'ok' : 'warn'} />
        <StatusPill label={networkStatus === 'online' ? 'Online' : 'Offline'} tone={networkStatus === 'online' ? 'ok' : 'warn'} />
        <StatusPill label={`Mode: ${performanceMode.replace('_', ' ')}`} tone={performanceMode === 'balanced' ? 'ok' : 'warn'} />
        <StatusPill label={`Backend: ${runtimeHealth.backend}`} tone={runtimeHealth.status === 'ok' ? 'ok' : 'warn'} />
        <StatusPill
          label={`ComfyUI: ${comfyConnected === true ? 'Connected' : comfyConnected === false ? 'Unavailable' : 'Checking'}`}
          tone={comfyConnected === true ? 'ok' : 'warn'}
        />
        <StatusPill
          label={cloudApiKey.trim().length > 0 ? 'Cloud Auth Ready' : 'Cloud Auth Missing'}
          tone={cloudApiKey.trim().length > 0 ? 'ok' : 'warn'}
        />
        <p className="text-xs leading-5 text-[#9ca3af]">
          Cloud compute auto-falls back to local when the app goes offline, matching the resilience path described in the master plan.
        </p>
        <p className="text-xs leading-5 text-[#9ca3af]">
          {runtimeHealth.backend === 'tauri'
            ? `${runtimeHealth.os ?? 'unknown os'} / ${runtimeHealth.arch ?? 'unknown arch'} / ${runtimeHealth.cpuCores ?? '?'} cores`
            : `${runtimeHealth.cpuCores ?? '?'} browser cores detected`}
        </p>
        <p className="text-xs leading-5 text-[#9ca3af]">
          {typeof runtimeHealth.availableMemoryGb === 'number' &&
          Number.isFinite(runtimeHealth.availableMemoryGb) &&
          typeof runtimeHealth.totalMemoryGb === 'number' &&
          Number.isFinite(runtimeHealth.totalMemoryGb)
            ? `Memory ${runtimeHealth.availableMemoryGb.toFixed(1)} GB free / ${runtimeHealth.totalMemoryGb.toFixed(1)} GB total`
            : `Device memory ${runtimeHealth.deviceMemoryGb ?? '?'} GB`}
        </p>
        <p className="text-xs leading-5 text-[#9ca3af]">
          Estimated app footprint {estimatedAppFootprintGb?.toFixed(2) ?? 'pending'} GB
          {memoryPressurePct !== null
            ? ` - memory pressure ${memoryPressurePct.toFixed(1)}%`
            : ' - memory pressure pending'}
        </p>
        <p className="text-xs leading-5 text-[#9ca3af]">
          {typeof runtimeHealth.diskFreeGb === 'number' &&
          Number.isFinite(runtimeHealth.diskFreeGb) &&
          typeof runtimeHealth.diskCapacityGb === 'number' &&
          Number.isFinite(runtimeHealth.diskCapacityGb)
            ? `Disk ${runtimeHealth.diskFreeGb.toFixed(1)} GB free / ${runtimeHealth.diskCapacityGb.toFixed(1)} GB total`
            : 'Disk telemetry pending'}
        </p>
        <p className="text-xs leading-5 text-[#9ca3af]">
          {typeof runtimeHealth.vramTotalGb === 'number' && Number.isFinite(runtimeHealth.vramTotalGb)
            ? `VRAM ${runtimeHealth.vramUsedGb?.toFixed(1) ?? '?'} GB / ${runtimeHealth.vramTotalGb.toFixed(1)} GB (${runtimeHealth.vramUtilizationPct?.toFixed(1) ?? '?'}%)`
            : 'VRAM telemetry pending'}
        </p>
        {runtimeHealth.appDataDir ? (
          <p className="break-all text-xs leading-5 text-[#7f8792]">{runtimeHealth.appDataDir}</p>
        ) : null}
      </div>
    </DrawerShell>
  )
}
