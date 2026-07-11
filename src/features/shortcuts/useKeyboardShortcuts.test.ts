import { describe, expect, it } from 'vitest'
import { resolveStratumScope } from './useKeyboardShortcuts'

/**
 * `resolveStratumScope` is pure (see its doc comment for why) but built around `Element.closest`.
 * This repo's vitest config has no jsdom environment, so these mocks duck-type just the
 * `closest`/`getAttribute` calls the function actually uses, rather than pulling in a real DOM.
 */
function stratumTarget(stratum: string | null): EventTarget {
  return {
    closest: (selector: string) => {
      if (selector !== '[data-meridian-stratum]') {
        return null
      }
      return stratum === null ? null : { getAttribute: (name: string) => (name === 'data-meridian-stratum' ? stratum : null) }
    },
  } as unknown as EventTarget
}

describe('resolveStratumScope', () => {
  it('resolves to the stratum the target is inside, regardless of horizon emphasis', () => {
    expect(resolveStratumScope('workflow', stratumTarget('timeline'))).toBe('timeline')
    expect(resolveStratumScope('timeline', stratumTarget('workflow'))).toBe('workflow')
  })

  it('falls back to activeView when the target is not inside a tagged stratum', () => {
    expect(resolveStratumScope('workflow', stratumTarget(null))).toBe('workflow')
    expect(resolveStratumScope('timeline', stratumTarget(null))).toBe('timeline')
  })

  it('falls back to activeView for null or non-Element targets', () => {
    expect(resolveStratumScope('workflow', null)).toBe('workflow')
    expect(resolveStratumScope('timeline', {} as EventTarget)).toBe('timeline')
  })

  it('ignores an unrecognized data-meridian-stratum value', () => {
    expect(resolveStratumScope('workflow', stratumTarget('something-else'))).toBe('workflow')
  })
})
