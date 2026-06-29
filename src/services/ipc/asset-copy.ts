import type { AssetCopyResult } from '../../domain/project/types'
import { invokeCommand } from './tauri-commands'
import { isTauriRuntime } from './tauri-runtime'

export async function copyAssetIntoProject(assetId: string, sourcePath: string): Promise<AssetCopyResult> {
  const fileName = sourcePath.split(/[\\/]/).at(-1) ?? `${assetId}.bin`
  const relativePath = `media/${assetId}-${fileName}`

  if (!isTauriRuntime()) {
    return {
      assetId,
      relativePath,
      absolutePath: `browser-local://project/${relativePath}`,
      copiedAt: new Date().toISOString(),
    }
  }

  const response = await invokeCommand<string>('asset_copy_into_project', {
    assetId,
    sourcePath,
  })

  return JSON.parse(response) as AssetCopyResult
}
