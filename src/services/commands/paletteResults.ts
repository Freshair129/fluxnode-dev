/**
 * Dependency-free result merging/ordering for the command palette. Takes the three already-
 * scored result classes (commands, addressed objects, verbs — spec H) and produces one ranked
 * list: score descending, most-recently-used first on ties, alphabetical as the final tiebreak.
 * Kept pure so the merge order itself is unit testable without mounting the palette component.
 */

export type PaletteResultKind = 'command' | 'object' | 'verb'

export interface PaletteResult {
  /** Stable key: `command:<id>`, `object:<kind>:<id>`, or `verb:<verb>`. */
  key: string
  kind: PaletteResultKind
  title: string
  subtitle?: string
  score: number
  shortcut?: string
  disabled?: boolean
  disabledReason?: string
}

const RESULT_CAP = 50

/**
 * Merges and ranks the three result-class arrays. `recencyOrder` is most-recent-first: an id's
 * index in it is its recency rank (lower = more recently used); ids not present rank after every
 * recent id. Ties after score+recency fall back to alphabetical title so the order is
 * deterministic (no result "jitters" between renders for equally-ranked entries).
 */
export function mergePaletteResults(
  commandResults: readonly PaletteResult[],
  objectResults: readonly PaletteResult[],
  verbResults: readonly PaletteResult[],
  recencyOrder: readonly string[] = [],
): PaletteResult[] {
  const recencyIndex = new Map<string, number>()
  recencyOrder.forEach((key, index) => {
    if (!recencyIndex.has(key)) {
      recencyIndex.set(key, index)
    }
  })

  const combined = [...commandResults, ...objectResults, ...verbResults]

  const ranked = combined
    .map((result, insertionIndex) => ({ result, insertionIndex }))
    .sort((a, b) => {
      if (a.result.score !== b.result.score) {
        return b.result.score - a.result.score
      }

      const recencyA = recencyIndex.get(a.result.key) ?? Number.POSITIVE_INFINITY
      const recencyB = recencyIndex.get(b.result.key) ?? Number.POSITIVE_INFINITY
      if (recencyA !== recencyB) {
        return recencyA - recencyB
      }

      const titleCompare = a.result.title.localeCompare(b.result.title)
      if (titleCompare !== 0) {
        return titleCompare
      }

      // Stable fallback: preserve original class order (commands, then objects, then verbs)
      // for genuinely identical entries.
      return a.insertionIndex - b.insertionIndex
    })
    .map((entry) => entry.result)

  return ranked.slice(0, RESULT_CAP)
}
