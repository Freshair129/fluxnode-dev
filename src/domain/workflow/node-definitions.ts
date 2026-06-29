import type { NodeType, PortDefinition } from '../project/types'

export const NODE_PORT_DEFINITIONS: Record<
  NodeType,
  { inputs: PortDefinition[]; outputs: PortDefinition[] }
> = {
  media_source: {
    inputs: [],
    outputs: [
      { name: 'video', dataType: 'video', required: false, multiple: false },
      { name: 'audio', dataType: 'audio', required: false, multiple: false },
    ],
  },
  camera: {
    inputs: [{ name: 'scene', dataType: 'video', required: true, multiple: false }],
    outputs: [{ name: 'render', dataType: 'video', required: false, multiple: false }],
  },
  shader: {
    inputs: [
      { name: 'input', dataType: 'video', required: true, multiple: false },
      { name: 'mask', dataType: 'mask', required: false, multiple: false },
    ],
    outputs: [{ name: 'output', dataType: 'video', required: false, multiple: false }],
  },
  compositor: {
    inputs: [{ name: 'layer', dataType: 'video', required: true, multiple: true }],
    outputs: [{ name: 'composite', dataType: 'video', required: false, multiple: false }],
  },
  output: {
    inputs: [
      { name: 'video', dataType: 'video', required: true, multiple: false },
      { name: 'audio', dataType: 'audio', required: false, multiple: false },
    ],
    outputs: [],
  },
  audio_mix: {
    inputs: [{ name: 'input', dataType: 'audio', required: true, multiple: true }],
    outputs: [{ name: 'mix', dataType: 'audio', required: false, multiple: false }],
  },
  ai_generate: {
    inputs: [{ name: 'reference', dataType: 'image', required: false, multiple: false }],
    outputs: [{ name: 'output', dataType: 'video', required: false, multiple: false }],
  },
  ai_upscale: {
    inputs: [{ name: 'input', dataType: 'video', required: true, multiple: false }],
    outputs: [{ name: 'output', dataType: 'video', required: false, multiple: false }],
  },
  transform: {
    inputs: [{ name: 'input', dataType: 'video', required: true, multiple: false }],
    outputs: [{ name: 'output', dataType: 'video', required: false, multiple: false }],
  },
  color_correct: {
    inputs: [{ name: 'input', dataType: 'video', required: true, multiple: false }],
    outputs: [{ name: 'output', dataType: 'video', required: false, multiple: false }],
  },
}
