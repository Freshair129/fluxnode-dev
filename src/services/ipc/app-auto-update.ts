import { isTauriRuntime } from './tauri-runtime'

/**
 * Signed auto-update pipeline (tauri-plugin-updater + tauri-plugin-process).
 *
 * This is the desktop-default update path: the plugin fetches `latest.json` from the endpoint in
 * `tauri.conf.json`, verifies the minisign signature against the compiled-in public key,
 * downloads + stages the installer, and `relaunch()` applies it. The legacy manifest-URL flow in
 * `app-update.ts` (sha256-only, no publisher authentication) remains as the browser-mode and
 * custom-manifest fallback.
 *
 * All plugin imports are dynamic so browser-mode bundles never pull the Tauri plugin code.
 */

export interface NativeUpdateHandle {
  version: string
  notes: string | null
  date: string | null
  /** Downloads, signature-verifies, and stages the update. Resolves when ready to relaunch. */
  downloadAndInstall: (onProgress: (pct: number | null) => void) => Promise<void>
}

/** `null` = already up to date; `'unsupported'` = not running under Tauri. */
export async function checkNativeUpdate(): Promise<NativeUpdateHandle | null | 'unsupported'> {
  if (!isTauriRuntime()) {
    return 'unsupported'
  }

  const { check } = await import('@tauri-apps/plugin-updater')
  const update = await check()

  if (!update) {
    return null
  }

  return {
    version: update.version,
    notes: update.body ?? null,
    date: update.date ?? null,
    downloadAndInstall: async (onProgress) => {
      let totalBytes: number | null = null
      let receivedBytes = 0

      await update.downloadAndInstall((event) => {
        if (event.event === 'Started') {
          totalBytes = event.data.contentLength ?? null
          onProgress(totalBytes ? 0 : null)
        } else if (event.event === 'Progress') {
          receivedBytes += event.data.chunkLength
          onProgress(totalBytes ? Math.min(100, Math.round((receivedBytes / totalBytes) * 100)) : null)
        } else if (event.event === 'Finished') {
          onProgress(100)
        }
      })
    },
  }
}

export async function relaunchApp(): Promise<void> {
  const { relaunch } = await import('@tauri-apps/plugin-process')
  await relaunch()
}
