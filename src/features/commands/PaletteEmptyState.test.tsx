import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { PaletteEmptyState } from './PaletteEmptyState'

describe('PaletteEmptyState', () => {
  it('teaches all three result classes when the query is empty (spec M.6)', () => {
    const markup = renderToStaticMarkup(<PaletteEmptyState query="" />)

    expect(markup).toContain('data-meridian-palette-empty')
    expect(markup).toContain('c1')
    expect(markup).toContain('n1')
    expect(markup).toContain('zoom 150')
    expect(markup).toContain('export 1080p')
  })

  it('names the exact syntax that would have worked when a query matched nothing', () => {
    const markup = renderToStaticMarkup(<PaletteEmptyState query="zzzznomatch" />)

    expect(markup).toContain('zzzznomatch')
    expect(markup).toContain('zoom 150')
  })

  it('treats a whitespace-only query the same as empty', () => {
    const markup = renderToStaticMarkup(<PaletteEmptyState query="   " />)

    expect(markup).toContain('Type to search commands')
  })
})
