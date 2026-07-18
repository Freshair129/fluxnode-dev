import { RefreshCcw } from 'lucide-react'
import { useProjectStore } from '../../../store/project-store'
import { StatusPill } from '../shared/PanelPrimitives'
import { DrawerShell } from './DrawerShell'

/**
 * App-updates drawer. Two pipelines share this surface:
 * - `updater-plugin` (desktop default): signed check → one-click download & install → restart.
 * - `manifest` (browser mode / custom manifest URL fallback): legacy check → download → open
 *   installer manually.
 */
export function AppUpdatesDrawer({ onClose }: { onClose: () => void }) {
  const appUpdateState = useProjectStore((state) => state.appUpdateState)
  const networkStatus = useProjectStore((state) => state.ui.networkStatus)
  const updateManifestUrl = useProjectStore((state) => state.preferences.updateManifestUrl)
  const checkForAppUpdates = useProjectStore((state) => state.checkForAppUpdates)
  const downloadAndInstallAppUpdate = useProjectStore((state) => state.downloadAndInstallAppUpdate)
  const restartToApplyUpdate = useProjectStore((state) => state.restartToApplyUpdate)
  const downloadAppUpdate = useProjectStore((state) => state.downloadAppUpdate)
  const installDownloadedAppUpdate = useProjectStore((state) => state.installDownloadedAppUpdate)
  const openUpdateDownload = useProjectStore((state) => state.openUpdateDownload)

  // Before any check has run (source null), pick the pipeline the runtime will actually use:
  // desktop defaults to the signed updater, browser mode only ever has the manifest flow.
  const isSignedPipeline =
    appUpdateState.source === 'updater-plugin' ||
    (appUpdateState.source === null && appUpdateState.versionInfo.backend === 'tauri')
  const installing = appUpdateState.installStatus === 'downloading'
  const readyToRestart = appUpdateState.installStatus === 'ready-to-restart'

  return (
    <DrawerShell icon={RefreshCcw} title="App Updates" onClose={onClose}>
      <div className="space-y-3">
        <StatusPill
          label={
            readyToRestart
              ? 'Restart To Apply'
              : appUpdateState.status === 'update-available'
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
            : 'FluxNode checks for updates shortly after launch. Use Check Now to check again.'}
        </p>
        <p className="text-xs leading-5 text-[#9ca3af]">
          {isSignedPipeline
            ? 'Updates are signature-verified before install (signed release channel).'
            : updateManifestUrl
              ? `Manifest ${updateManifestUrl}`
              : 'Set an update manifest URL in Settings to enable manual update checks.'}
        </p>
        {appUpdateState.latestVersion && appUpdateState.status === 'update-available' ? (
          <p className="text-xs leading-5 text-[#cbd2dc]">
            Latest published version {appUpdateState.latestVersion}
            {appUpdateState.publishedAt ? ` — ${new Date(appUpdateState.publishedAt).toLocaleString()}` : ''}
          </p>
        ) : null}
        {appUpdateState.notes ? (
          <p className="rounded-xl border border-white/8 bg-black/20 p-3 text-xs leading-5 text-[#cbd2dc]">{appUpdateState.notes}</p>
        ) : null}
        {installing ? (
          <div aria-live="polite" className="space-y-1.5">
            <p className="text-xs leading-5 text-[#cbd2dc]">
              Downloading update…{appUpdateState.downloadProgressPct !== null ? ` ${appUpdateState.downloadProgressPct}%` : ''}
            </p>
            <div className="h-1 overflow-hidden rounded-full bg-white/10">
              <div
                className="h-full rounded-full bg-accent transition-[width]"
                style={{ width: `${appUpdateState.downloadProgressPct ?? 12}%` }}
              />
            </div>
          </div>
        ) : null}
        {appUpdateState.downloadedFilePath && !isSignedPipeline ? (
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
          disabled={networkStatus === 'offline' || appUpdateState.status === 'checking' || installing}
          className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm text-white disabled:cursor-not-allowed disabled:opacity-50"
        >
          Check Now
        </button>

        {isSignedPipeline ? (
          readyToRestart ? (
            <button
              type="button"
              onClick={() => void restartToApplyUpdate()}
              className="rounded-full bg-accent px-4 py-2 text-sm font-semibold text-black"
            >
              Restart FluxNode
            </button>
          ) : (
            <button
              type="button"
              onClick={() => void downloadAndInstallAppUpdate()}
              disabled={appUpdateState.status !== 'update-available' || installing}
              className="rounded-full bg-accent px-4 py-2 text-sm font-semibold text-black disabled:cursor-not-allowed disabled:opacity-50"
            >
              {installing ? 'Installing…' : 'Download & Install'}
            </button>
          )
        ) : (
          <>
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
          </>
        )}
      </div>
    </DrawerShell>
  )
}
