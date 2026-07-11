import { describe, expect, it } from 'vitest'
import { isExactVerb, matchKnownVerbs, parseVerbInput } from './verbs'

describe('parseVerbInput', () => {
  it('splits a verb and its argument text', () => {
    expect(parseVerbInput('zoom 150')).toEqual({ verb: 'zoom', argsText: '150' })
  })

  it('trims surrounding whitespace from both the verb and the args', () => {
    expect(parseVerbInput('  export   mp4-1080p  ')).toEqual({ verb: 'export', argsText: 'mp4-1080p' })
  })

  it('collapses to just the verb with empty args when no space was typed yet', () => {
    expect(parseVerbInput('zoom')).toEqual({ verb: 'zoom', argsText: '' })
  })

  it('keeps everything after the first space as one argument string (args may contain spaces)', () => {
    expect(parseVerbInput('export high quality mp4')).toEqual({ verb: 'export', argsText: 'high quality mp4' })
  })

  it('returns null for blank input', () => {
    expect(parseVerbInput('')).toBeNull()
    expect(parseVerbInput('   ')).toBeNull()
  })
})

describe('matchKnownVerbs', () => {
  const knownVerbs = [
    { verb: 'zoom', argsHint: '<percent>' },
    { verb: 'export', argsHint: '<preset>' },
  ]

  it('prefix-matches case-insensitively', () => {
    expect(matchKnownVerbs('zo', knownVerbs)).toEqual([knownVerbs[0]])
    expect(matchKnownVerbs('EX', knownVerbs)).toEqual([knownVerbs[1]])
  })

  it('returns an empty array when no known verb starts with the input', () => {
    expect(matchKnownVerbs('xyz', knownVerbs)).toEqual([])
  })

  it('matches every verb for an empty prefix', () => {
    expect(matchKnownVerbs('', knownVerbs)).toEqual(knownVerbs)
  })
})

describe('isExactVerb', () => {
  it('is true only for a full, case-insensitive match', () => {
    expect(isExactVerb('zoom', { verb: 'zoom', argsHint: '<percent>' })).toBe(true)
    expect(isExactVerb('Zoom', { verb: 'zoom', argsHint: '<percent>' })).toBe(true)
    expect(isExactVerb('zo', { verb: 'zoom', argsHint: '<percent>' })).toBe(false)
  })
})
