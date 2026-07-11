export interface PaletteEmptyStateProps {
  query: string
}

/**
 * Spec M.6: "Every empty state names the key that fixes it." Two variants: before the user has
 * typed anything (teach the three result classes + the two shipped verbs), and after a query
 * that matched nothing (name the exact syntax that would have worked).
 *
 * Uses a local `InlineExample` rather than the `Kbd` primitive (`components/Kbd.tsx`) — `Kbd` is
 * `aria-hidden` by design (it's a decorative shortcut hint alongside an already-labeled row), but
 * these examples ARE the content a screen reader user needs to hear to learn the syntax, so they
 * must stay in the accessible text.
 */
export function PaletteEmptyState({ query }: PaletteEmptyStateProps) {
  const hasQuery = query.trim().length > 0

  return (
    <div data-meridian-palette-empty className="px-4 py-6 text-sm text-text-secondary">
      {hasQuery ? (
        <p>
          No matches for <span className="font-mono text-text-data">&ldquo;{query}&rdquo;</span>. Try a command name, an
          address like <InlineExample>c1</InlineExample> or <InlineExample>n1</InlineExample>, or a verb like{' '}
          <InlineExample>zoom 150</InlineExample>.
        </p>
      ) : (
        <div className="space-y-2">
          <p>Type to search commands, or jump straight to something:</p>
          <ul className="space-y-1 pl-1">
            <li>
              <InlineExample>c1</InlineExample>, <InlineExample>n1</InlineExample>, or a clip/node name — select it and
              bring it into view
            </li>
            <li>
              <InlineExample>zoom 150</InlineExample> — set the timeline zoom to 150%
            </li>
            <li>
              <InlineExample>export 1080p</InlineExample> — queue a render with a matching preset
            </li>
          </ul>
        </div>
      )}
    </div>
  )
}

function InlineExample({ children }: { children: string }) {
  return (
    <code className="rounded-md border border-white/15 bg-white/5 px-1 py-0.5 font-mono text-[11px] text-text-data">
      {children}
    </code>
  )
}
