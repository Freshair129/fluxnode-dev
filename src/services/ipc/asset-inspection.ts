import type { AssetInspection } from '../../domain/project/types'
import { invokeCommand } from './tauri-commands'
import { isTauriRuntime } from './tauri-runtime'

export async function inspectAssetPath(path: string): Promise<AssetInspection> {
  if (!isTauriRuntime()) {
    return {
      path,
      exists: false,
      isFile: false,
      fileSize: 0,
      fileName: path.split(/[\\/]/).at(-1) ?? path,
      extension: path.includes('.') ? path.split('.').at(-1) ?? null : null,
    }
  }

  const response = await invokeCommand<string>('inspect_asset_path', { path })
  return JSON.parse(response) as AssetInspection
}
