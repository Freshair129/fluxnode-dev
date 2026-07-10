import { describe, expect, it } from 'vitest'
import {
  indexClipAddresses,
  indexNodeAddresses,
  resolveAddressedObjects,
  scoreAddressedObject,
} from './objectAddress'

describe('indexClipAddresses / indexNodeAddresses', () => {
  it('assigns positional c1, c2, … addresses in array order', () => {
    const clips = indexClipAddresses([
      { id: 'clip-a', name: 'intro.mp4' },
      { id: 'clip-b', name: null },
    ])

    expect(clips[0]).toMatchObject({ kind: 'clip', id: 'clip-a', address: 'c1', name: 'intro.mp4' })
    expect(clips[1]).toMatchObject({ kind: 'clip', id: 'clip-b', address: 'c2' })
    // Unnamed source falls back to a readable "<Type> <address>" label, not a blank string.
    expect(clips[1].name).toBe('Clip c2')
  })

  it('assigns positional n1, n2, … addresses in array order', () => {
    const nodes = indexNodeAddresses([
      { id: 'node-a', name: 'Upscale pass' },
      { id: 'node-b', name: '' },
    ])

    expect(nodes[0]).toMatchObject({ kind: 'node', id: 'node-a', address: 'n1', name: 'Upscale pass' })
    expect(nodes[1]).toMatchObject({ kind: 'node', id: 'node-b', address: 'n2', name: 'Node n2' })
  })
})

describe('scoreAddressedObject', () => {
  const node = { kind: 'node' as const, id: 'node-xyz', address: 'n7', name: 'AI Generate' }

  it('gives an exact address match the top score, beating a fuzzy name match', () => {
    const addressScore = scoreAddressedObject('n7', node)
    const nameScore = scoreAddressedObject('ai gen', node)
    expect(addressScore).toBe(1000)
    expect(nameScore).not.toBeNull()
    expect(addressScore as number).toBeGreaterThan(nameScore as number)
  })

  it('matches by display name', () => {
    expect(scoreAddressedObject('generate', node)).not.toBeNull()
  })

  it('matches by raw id', () => {
    expect(scoreAddressedObject('node-xyz', node)).not.toBeNull()
  })

  it('returns null when nothing matches', () => {
    expect(scoreAddressedObject('zzzzz', node)).toBeNull()
  })

  it('returns null for blank queries (objects only surface once the user types)', () => {
    expect(scoreAddressedObject('   ', node)).toBeNull()
  })

  it('address matching is case-insensitive', () => {
    expect(scoreAddressedObject('N7', node)).toBe(1000)
  })
})

describe('resolveAddressedObjects', () => {
  it('returns only matching objects, best score first', () => {
    const objects = indexNodeAddresses([
      { id: 'a', name: 'Camera Rig' },
      { id: 'b', name: 'Color Correct' },
      { id: 'c', name: 'Compositor' },
    ])

    const matches = resolveAddressedObjects('co', objects)

    expect(matches.map((match) => match.object.id).sort()).toEqual(['b', 'c'])
    expect(matches[0].score).toBeGreaterThanOrEqual(matches[matches.length - 1].score)
  })

  it('returns an empty array when nothing matches', () => {
    expect(resolveAddressedObjects('zzz', indexNodeAddresses([{ id: 'a', name: 'Camera' }]))).toEqual([])
  })
})
