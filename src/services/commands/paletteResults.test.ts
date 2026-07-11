import { describe, expect, it } from 'vitest'
import { mergePaletteResults, type PaletteResult } from './paletteResults'

function result(overrides: Partial<PaletteResult> & Pick<PaletteResult, 'key' | 'title'>): PaletteResult {
  return { kind: 'command', score: 0, ...overrides }
}

describe('mergePaletteResults', () => {
  it('orders by score descending across all three result classes', () => {
    const commands = [result({ key: 'command:a', title: 'A', score: 5 })]
    const objects = [result({ key: 'object:clip:x', title: 'X', kind: 'object', score: 20 })]
    const verbs = [result({ key: 'verb:zoom', title: 'Zoom', kind: 'verb', score: 10 })]

    const merged = mergePaletteResults(commands, objects, verbs)

    expect(merged.map((entry) => entry.key)).toEqual(['object:clip:x', 'verb:zoom', 'command:a'])
  })

  it('breaks score ties by recency (most-recently-used first)', () => {
    const commands = [
      result({ key: 'command:a', title: 'A', score: 10 }),
      result({ key: 'command:b', title: 'B', score: 10 }),
    ]

    const merged = mergePaletteResults(commands, [], [], ['command:b', 'command:a'])

    expect(merged.map((entry) => entry.key)).toEqual(['command:b', 'command:a'])
  })

  it('ranks ids absent from recencyOrder after ids present in it, on a score tie', () => {
    const commands = [
      result({ key: 'command:never-used', title: 'Never Used', score: 10 }),
      result({ key: 'command:used', title: 'Used', score: 10 }),
    ]

    const merged = mergePaletteResults(commands, [], [], ['command:used'])

    expect(merged.map((entry) => entry.key)).toEqual(['command:used', 'command:never-used'])
  })

  it('falls back to alphabetical title order on a full score+recency tie', () => {
    const commands = [
      result({ key: 'command:zebra', title: 'Zebra', score: 10 }),
      result({ key: 'command:apple', title: 'Apple', score: 10 }),
    ]

    const merged = mergePaletteResults(commands, [], [], [])

    expect(merged.map((entry) => entry.title)).toEqual(['Apple', 'Zebra'])
  })

  it('caps the merged result list at 50 entries', () => {
    const commands = Array.from({ length: 80 }, (_, index) =>
      result({ key: `command:${index}`, title: `Command ${index}`, score: index }),
    )

    const merged = mergePaletteResults(commands, [], [], [])

    expect(merged).toHaveLength(50)
    // Highest-scored 50 survive the cap.
    expect(merged[0].title).toBe('Command 79')
  })

  it('returns an empty array when every input is empty', () => {
    expect(mergePaletteResults([], [], [])).toEqual([])
  })
})
