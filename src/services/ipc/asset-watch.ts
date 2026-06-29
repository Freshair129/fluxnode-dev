import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import type { Asset, AssetWatchEvent, AssetWatchTarget } from '../../domain/project/types'
import { invokeCommand } from './tauri-commands'
import { isTauriRuntime } from './tauri-runtime'

function resolveAssetWatchPath(asset: Asset, currentProjectPath: string | null) {
  if (!asset.relativePath || !currentProjectPath) {
    return asset.relativePath ? asset.relativePath.replace(/\\/g, '/') : asset.sourcePath
  }

  const normalizedProjectPath = currentProjectPath.replace(/\\/g, '/').replace(/\/$/, '')
  const normalizedRelativePath = asset.relativePath.replace(/\\/g, '/')
  return `${normalizedProjectPath}/${normalizedRelativePath}`
}

export function buildAssetWatchTargets(assets: Asset[], currentProjectPath: string | null): AssetWatchTarget[] {
  return assets.map((asset) => ({
    assetId: asset.id,
    path: resolveAssetWatchPath(asset, currentProjectPath),
  }))
}

export async function syncAssetWatchTargets(targets: AssetWatchTarget[]) {
  if (!isTauriRuntime()) {
    return
  }

  await invokeCommand('asset_watch_sync', {
    targetsJson: JSON.stringify(targets),
  })
}

export async function listenForAssetWatchEvents(
  onEvent: (event: AssetWatchEvent) => void,
): Promise<UnlistenFn> {
  if (!isTauriRuntime()) {
    return () => undefined
  }

  return listen<AssetWatchEvent>('fluxnode://asset-watch', (event) => {
    onEvent(event.payload)
  })
}
