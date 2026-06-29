import { invokeCommand } from './tauri-commands'
import { isTauriRuntime } from './tauri-runtime'

export async function generateAssetProxy(
  assetId: string,
  sourcePath: string,
  width: number,
  height: number,
): Promise<string> {
  if (!isTauriRuntime()) {
    return `browser-local://${assetId}-${width}x${height}.proxy.mp4`
  }

  const response = await invokeCommand<string>('asset_generate_proxy', {
    assetId,
    sourcePath,
    targetWidth: width,
    targetHeight: height,
  })

  return response
}
