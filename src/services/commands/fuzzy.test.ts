import { describe, expect, it } from 'vitest'
import { bestFuzzyScore, fuzzyMatches, fuzzyScore } from './fuzzy'

describe('fuzzyScore', () => {
  it('returns null when a query character is missing from the target', () => {
    expect(fuzzyScore('xyz', 'Split Clip')).toBeNull()
  })

  it('matches an exact, case-insensitive string', () => {
    expect(fuzzyScore('split', 'Split Clip')).not.toBeNull()
  })

  it('matches non-contiguous subsequences', () => {
    expect(fuzzyScore('spc', 'Split Clip')).not.toBeNull()
  })

  it('scores a prefix match higher than the same characters scattered later', () => {
    const prefixScore = fuzzyScore('spl', 'Split Clip')
    const scatteredScore = fuzzyScore('spl', 'Set Playhead Left')
    expect(prefixScore).not.toBeNull()
    expect(scatteredScore).not.toBeNull()
    expect(prefixScore as number).toBeGreaterThan(scatteredScore as number)
  })

  it('scores a contiguous run higher than the same characters split across word boundaries', () => {
    const contiguous = fuzzyScore('del', 'Delete Clip')
    const split = fuzzyScore('del', 'Duplicate Element')
    expect(contiguous).not.toBeNull()
    expect(split).not.toBeNull()
    expect(contiguous as number).toBeGreaterThan(split as number)
  })

  it('rewards word-boundary matches over mid-word matches of equal length', () => {
    // "c" + "l" both match at a word start in "Clip Library" (C, L)...
    const wordStart = fuzzyScore('cl', 'Clip Library')
    // ...but in "Recliner" the run is mid-word, no boundary bonus.
    const midWord = fuzzyScore('cl', 'Recliner')
    expect(wordStart).not.toBeNull()
    expect(midWord).not.toBeNull()
    expect(wordStart as number).toBeGreaterThan(midWord as number)
  })

  it('treats an empty query as a universal zero-score match', () => {
    expect(fuzzyScore('', 'anything')).toBe(0)
  })

  it('never matches a non-empty query against an empty target', () => {
    expect(fuzzyScore('a', '')).toBeNull()
  })

  it('is case-insensitive', () => {
    expect(fuzzyScore('SPLIT', 'split clip')).toEqual(fuzzyScore('split', 'split clip'))
  })

  it('applies a length penalty so a tight match beats the same query buried in a much longer string', () => {
    const tight = fuzzyScore('fit', 'Fit')
    const buried = fuzzyScore('fit', 'Fit to a much much longer viewport title string')
    expect(tight).not.toBeNull()
    expect(buried).not.toBeNull()
    expect(tight as number).toBeGreaterThan(buried as number)
  })
})

describe('fuzzyMatches', () => {
  it('mirrors fuzzyScore null-ness as a boolean', () => {
    expect(fuzzyMatches('abc', 'a-b-c')).toBe(true)
    expect(fuzzyMatches('xyz', 'a-b-c')).toBe(false)
  })
})

describe('bestFuzzyScore', () => {
  it('returns the highest score across candidates', () => {
    const score = bestFuzzyScore('fit', ['unrelated', 'Fit to View', 'also unrelated'])
    expect(score).toBe(fuzzyScore('fit', 'Fit to View'))
  })

  it('returns null when no candidate matches', () => {
    expect(bestFuzzyScore('zzz', ['abc', 'def'])).toBeNull()
  })

  it('returns null for an empty candidate list', () => {
    expect(bestFuzzyScore('abc', [])).toBeNull()
  })
})
