import type { MediaSourceData, WorkflowNode } from './types'

/** Whether this exact AI generation has already been materialized into the workflow. */
export function hasMaterializedWorkflowResult(
  nodes: readonly WorkflowNode[],
  sourceNodeId: string,
  resultId: string,
): boolean {
  if (!resultId.trim()) return false

  return nodes.some((node) => {
    if (node.type !== 'media_source') return false
    const data = node.data as MediaSourceData
    return data.sourceWorkflowNodeId === sourceNodeId && data.sourceWorkflowResultId === resultId
  })
}
