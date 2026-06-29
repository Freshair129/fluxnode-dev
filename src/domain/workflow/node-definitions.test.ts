import { describe, expect, it } from 'vitest'
import { NODE_PORT_DEFINITIONS } from './node-definitions'

const ALLOWED_DATA_TYPES = new Set([
  'video',
  'audio',
  'image',
  'mask',
  'number',
  'color',
  'any',
])

describe('NODE_PORT_DEFINITIONS', () => {
  const entries = Object.entries(NODE_PORT_DEFINITIONS)

  it('defines all 10 node types', () => {
    expect(entries).toHaveLength(10)
  })

  it('gives every node type input and output port arrays', () => {
    for (const [type, def] of entries) {
      expect(Array.isArray(def.inputs), `${type}.inputs`).toBe(true)
      expect(Array.isArray(def.outputs), `${type}.outputs`).toBe(true)
    }
  })

  it('uses only known data types on every port', () => {
    for (const [type, def] of entries) {
      for (const port of [...def.inputs, ...def.outputs]) {
        expect(ALLOWED_DATA_TYPES.has(port.dataType), `${type}.${port.name}: ${port.dataType}`).toBe(true)
      }
    }
  })

  it('keeps the output node as a pure sink (no outputs)', () => {
    expect(NODE_PORT_DEFINITIONS.output.outputs).toHaveLength(0)
    expect(NODE_PORT_DEFINITIONS.output.inputs.length).toBeGreaterThan(0)
  })

  it('keeps media_source as a pure source (no inputs)', () => {
    expect(NODE_PORT_DEFINITIONS.media_source.inputs).toHaveLength(0)
    expect(NODE_PORT_DEFINITIONS.media_source.outputs.length).toBeGreaterThan(0)
  })
})
