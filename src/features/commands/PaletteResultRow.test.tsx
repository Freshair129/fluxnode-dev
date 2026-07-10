import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { PaletteResult } from '../../services/commands/paletteResults'
import { PaletteResultRow } from './PaletteResultRow'

function baseResult(overrides: Partial<PaletteResult> = {}): PaletteResult {
  return { key: 'command:timeline.split', kind: 'command', title: 'Split Clip at Playhead', score: 10, ...overrides }
}

describe('PaletteResultRow', () => {
  it('renders as a combobox listbox option, tagged for the orchestrator\'s DOM measurement', () => {
    const markup = renderToStaticMarkup(
      <ul>
        <PaletteResultRow id="row-0" result={baseResult()} active={false} onSelect={() => {}} onPointerMove={() => {}} />
      </ul>,
    )

    expect(markup).toContain('role="option"')
    expect(markup).toContain('id="row-0"')
    expect(markup).toContain('data-meridian-palette-item')
    expect(markup).toContain('data-meridian-palette-item-kind="command"')
    expect(markup).toContain('aria-selected="false"')
    expect(markup).toContain('Split Clip at Playhead')
  })

  it('marks the active row aria-selected and applies the active visual tone', () => {
    const markup = renderToStaticMarkup(
      <ul>
        <PaletteResultRow id="row-0" result={baseResult()} active onSelect={() => {}} onPointerMove={() => {}} />
      </ul>,
    )

    expect(markup).toContain('aria-selected="true"')
    expect(markup).toContain('bg-accent/10')
  })

  it('shows the disabled reason and marks aria-disabled for a disabled command (spec H: "disabled ones may show, greyed, with the reason if cheap")', () => {
    const markup = renderToStaticMarkup(
      <ul>
        <PaletteResultRow
          id="row-0"
          result={baseResult({ disabled: true, disabledReason: 'No selection to duplicate' })}
          active={false}
          onSelect={() => {}}
          onPointerMove={() => {}}
        />
      </ul>,
    )

    expect(markup).toContain('aria-disabled="true"')
    expect(markup).toContain('No selection to duplicate')
    expect(markup).toContain('opacity-45')
  })

  it('renders an inline shortcut hint when the result carries one', () => {
    const markup = renderToStaticMarkup(
      <ul>
        <PaletteResultRow id="row-0" result={baseResult({ shortcut: 'Ctrl+K' })} active={false} onSelect={() => {}} onPointerMove={() => {}} />
      </ul>,
    )

    expect(markup).toContain('<kbd')
    expect(markup).toContain('>K<')
  })

  it('renders no shortcut markup when the result has none', () => {
    const markup = renderToStaticMarkup(
      <ul>
        <PaletteResultRow id="row-0" result={baseResult()} active={false} onSelect={() => {}} onPointerMove={() => {}} />
      </ul>,
    )

    expect(markup).not.toContain('<kbd')
  })

  it('renders the kind badge and an optional subtitle', () => {
    const markup = renderToStaticMarkup(
      <ul>
        <PaletteResultRow
          id="row-0"
          result={baseResult({ kind: 'object', title: 'c14', subtitle: 'intro.mp4' })}
          active={false}
          onSelect={() => {}}
          onPointerMove={() => {}}
        />
      </ul>,
    )

    expect(markup).toContain('Object')
    expect(markup).toContain('intro.mp4')
  })
})
