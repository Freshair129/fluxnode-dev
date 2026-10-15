import type { AssetCopyResult } from '../../domain/project/types'
import { invokeCommand } from './tauri-commands'
import { isTauriRuntime } from './tauri-runtime'

/** Save a generated PNG into the active FluxNode project, preserving its safe ComfyUI filename. */
export async function materializeGeneratedWorkflowImage(
  projectJson: string,
  assetId: string,
  sourceFileName: string,
  dataUrl: string,
): Promise<AssetCopyResult> {
  if (!isTauriRuntime()) {
    throw new Error('Generated workflow images can only be saved in the desktop app.')
  }

  const response = await invokeCommand<string>('workflow_materialize_generated_image', {
    projectJson,
    assetId,
    sourceFileName,
    dataUrl,
  })
  return JSON.parse(response) as AssetCopyResult
}
