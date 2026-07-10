import { RefreshCcw } from 'lucide-react'
import { useProjectStore } from '../../../store/project-store'
import { StatusPill } from '../shared/PanelPrimitives'
import { DrawerShell } from './DrawerShell'

/** MERIDIAN item 9: relocated verbatim content from `SystemPanels.tsx`'s "App updates" section. */
export function AppUpdatesDrawer({ onClose }: { onClose: () => void }) {
  const appUpdateState = useProjectStore((state) => state.appUpdateState)
  const networkStatus = useProjectStore((state) => state.ui.networkStatus)
  const updateManifestUrl = useProjectStore((state) => state.preferences.updateManifestUrl)
  const checkForAppUpdates = useProjectStore((state) => state.checkForAppUpdates)
  const downloadAppUpdate = useProjectStore((state) => state.downloadAppUpdate)
  const installDownloadedAppUpdate = useProjectStore((state) => state.installDownloadedAppUpdate)
  const openUpdateDownload = useProjectStore((state) => state.openUpdateDownload)

  return (
    <DrawerShell icon={RefreshCcw} title="App Updates" onClose={onClose}>
      <div className="space-y-3">
        <StatusPill
          label={
            appUpdateState.status === 'update-available'
              ? 'Update Available'
              : appUpdateState.status === 'up-to-date'
                ? 'Up To Date'
                : appUpdateState.status === 'checking'
                  ? 'Checking'
                  : appUpdateState.status === 'error'
                    ? 'Update Error'
                    : 'Manual Check'
          }
          tone={appUpdateState.status === 'error' ? 'warn' : 'ok'}
        />
        <p className="text-xs leading-5 text-[#9ca3af]">
          Current version {appUpdateState.versionInfo.currentVersion} on the {appUpdateState.versionInfo.backend} runtime.
        </p>
        <p className="text-xs leading-5 text-[#9ca3af]">
          {appUpdateState.lastCheckedAt
            ? `Last checked ${new Date(appUpdateState.lastCheckedAt).toLocaleString()}`
            : 'No update check has been run yet. Use Check Now below.'}
        </p>
        <p className="text-xs leading-5 text-[#9ca3af]">
          {updateManifestUrl
            ? `Manifest ${updateManifestUrl}`
            : 'Set an update manifest URL in Settings to enable manual update checks.'}
        </p>
        {appUpdateState.latestVersion ? (
          <p className="text-xs leading-5 text-[#9ca3af]">
            Latest published version {appUpdateState.latestVersion}
            {appUpdateState.publishedAt ? ` - ${new Date(appUpdateState.publishedAt).toLocaleString()}` : ''}
          </p>
        ) : null}
        {appUpdateState.notes ? (
          <p className="rounded-xl border border-white/8 bg-black/20 p-3 text-xs leading-5 text-[#cbd2dc]">{appUpdateState.notes}</p>
        ) : null}
        {appUpdateState.downloadedFilePath ? (
          <p className="break-all text-xs leading-5 text-[#7f8792]">{appUpdateState.downloadedFilePath}</p>
        ) : null}
        {appUpdateState.errorMessage ? (
          <p className="rounded-xl border border-amber-300/20 bg-amber-500/10 p-3 text-xs leading-5 text-amber-50">
            {appUpdateState.errorMessage}
          </p>
        ) : null}
      </div>
      <div className="mt-4 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => void checkForAppUpdates()}
          disabled={networkStatus === 'offline' || appUpdateState.status === 'checking'}
          className="rounded-full bg-[#e0ff00] px-4 py-2 text-sm font-semibold text-black disabled:cursor-not-allowed disabled:opacity-50"
        >
          Check Now
        </button>
        <button
          type="button"
          onClick={() => void downloadAppUpdate()}
          disabled={!appUpdateState.downloadUrl || appUpdateState.downloadStatus === 'downloading'}
          className="rounded-full border border-[#3b82f6]/25 bg-[#3b82f6]/10 px-4 py-2 text-sm text-[#dbeafe] disabled:cursor-not-allowed disabled:opacity-50"
        >
          {appUpdateState.downloadStatus === 'downloading' ? 'Downloading…' : appUpdateState.downloadedFilePath ? 'Download Again' : 'Download Update'}
        </button>
        <button
          type="button"
          onClick={() => void installDownloadedAppUpdate()}
          disabled={!appUpdateState.downloadedFilePath}
          className="rounded-full border border-emerald-400/20 bg-emerald-500/10 px-4 py-2 text-sm text-emerald-50 disabled:cursor-not-allowed disabled:opacity-50"
        >
          Install Update
        </button>
        <button
          type="button"
          onClick={() => void openUpdateDownload()}
          disabled={!appUpdateState.downloadUrl && !appUpdateState.downloadedFilePath}
          className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm text-white disabled:cursor-not-allowed disabled:opacity-50"
        >
          {appUpdateState.downloadedFilePath ? 'Open Package' : 'Open Download'}
        </button>
      </div>
    </DrawerShell>
  )
}
