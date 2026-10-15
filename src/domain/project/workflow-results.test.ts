import { describe, expect, it } from 'vitest'
import type { WorkflowNode } from './types'
import { hasMaterializedWorkflowResult } from './workflow-results'

const materializedResult: WorkflowNode = {
  id: 'node-media-02',
  type: 'media_source',
  position: { x: 80, y: 420 },
  data: {
    assetId: 'asset-result-01',
    timelineClipId: 'clip-result-01',
    sourceWorkflowNodeId: 'node-ai-generate-01',
    sourceWorkflowResultId: 'prompt-result-01',
  },
  collapsed: false,
  bypassed: false,
  executionError: null,
  label: 'Generated image',
}

describe('generated workflow result materialization identity', () => {
  it('keeps repeat clicks on the same Comfy result idempotent', () => {
    expect(
      hasMaterializedWorkflowResult(
        [materializedResult],
        'node-ai-generate-01',
        'prompt-result-01',
      ),
    ).toBe(true)
  })

  it('allows a later run of the same node to add its distinct result', () => {
    expect(
      hasMaterializedWorkflowResult(
        [materializedResult],
        'node-ai-generate-01',
        'prompt-result-02',
      ),
    ).toBe(false)
  })
})
