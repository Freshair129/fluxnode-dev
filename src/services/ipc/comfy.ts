import type { PreviewFrameData } from '../../domain/project/types'
import { invokeCommand } from './tauri-commands'
import { isTauriRuntime } from './tauri-runtime'

/**
 * Check whether the user's ComfyUI server is reachable.
 *
 * Browser mode (no Tauri backend) cannot reach a local ComfyUI instance, so it
 * resolves to `false` gracefully instead of throwing.
 */
export async function pingComfy(endpoint: string): Promise<boolean> {
  if (!isTauriRuntime()) {
    return false
  }

  try {
    return await invokeCommand<boolean>('comfy_ping', { endpoint })
  } catch {
    return false
  }
}

/**
 * Run an `ai_generate` node's prompt against the user's ComfyUI server.
 *
 * Returns the generated frame as a `PreviewFrameData` (the backend serializes it
 * to camelCase JSON). Rejects in browser mode, or when ComfyUI is unreachable or
 * the node type/inputs are unsupported — callers surface that via the AppError path.
 */
export async function generateComfyNode(
  projectJson: string,
  nodeId: string,
  endpoint: string,
  timeoutSecs: number,
): Promise<PreviewFrameData> {
  if (!isTauriRuntime()) {
    throw new Error('ComfyUI generation is only available in the desktop app.')
  }

  const response = await invokeCommand<string>('comfy_generate', {
    projectJson,
    nodeId,
    endpoint,
    timeoutSecs,
  })

  return JSON.parse(response) as PreviewFrameData
}
