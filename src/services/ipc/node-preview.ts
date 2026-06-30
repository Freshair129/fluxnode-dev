import type { PreviewFrameData } from '../../domain/project/types'
import { invokeCommand } from './tauri-commands'

export async function renderNodePreview(
  projectJson: string,
  nodeId: string,
  width: number,
  height: number,
): Promise<PreviewFrameData> {
  const response = await invokeCommand<string>('workflow_render_node', {
    projectJson,
    nodeId,
    width,
    height,
  })

  return JSON.parse(response) as PreviewFrameData
}
