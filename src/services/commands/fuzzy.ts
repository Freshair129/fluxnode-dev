/**
 * Dependency-free fuzzy subsequence matcher shared by the command palette's three result
 * classes (commands, addressed objects, verbs) — see `paletteResults.ts` for how the scores
 * this module produces get merged into one ranked list. Kept pure (no React, no Zustand, no
 * DOM) so it can be unit tested directly, mirroring the split already used for horizon math in
 * `domain/project/horizon.ts` and ledger math in `domain/project/jobLedger.ts`.
 *
 * No fuzzy-matching dependency is added (MERIDIAN item 6 hard constraint: no cmdk, no
 * fuzzy-search lib) — this is a small, from-scratch subsequence scorer.
 */

const WORD_BOUNDARY_RE = /[\s._\-/:]/

/**
 * Scores how well `query` fuzzy-matches `target` as an in-order (not necessarily contiguous)
 * subsequence of characters, case-insensitively. Returns `null` when `query` is NOT a
 * subsequence of `target` (no match at all). Returns `0` for an empty query (matches
 * everything, ranks lowest among real matches via the merge step's own tiebreaks).
 *
 * Higher score = better match. Rewards, in order of weight:
 *  - every matched character (base score)
 *  - matches that land on a word boundary (start of string, or right after
 *    whitespace/`.`/`_`/`-`/`/`/`:`)
 *  - runs of consecutive matched characters (a contiguous "smith" > scattered "s-m-i-t-h")
 * Lightly penalizes longer targets so a tight match ranks above a loose match buried in a much
 * longer string.
 */
export function fuzzyScore(query: string, target: string): number | null {
  if (query.length === 0) {
    return 0
  }

  if (target.length === 0) {
    return null
  }

  const q = query.toLowerCase()
  const t = target.toLowerCase()

  let queryIndex = 0
  let score = 0
  let previousMatchIndex = -1
  let consecutiveRun = 0

  for (let targetIndex = 0; targetIndex < t.length && queryIndex < q.length; targetIndex += 1) {
    if (t[targetIndex] !== q[queryIndex]) {
      continue
    }

    const isWordStart = targetIndex === 0 || WORD_BOUNDARY_RE.test(t[targetIndex - 1])
    const isConsecutive = previousMatchIndex === targetIndex - 1

    consecutiveRun = isConsecutive ? consecutiveRun + 1 : 1
    score += 10 + (isWordStart ? 8 : 0) + (isConsecutive ? consecutiveRun * 4 : 0)

    previousMatchIndex = targetIndex
    queryIndex += 1
  }

  if (queryIndex < q.length) {
    return null
  }

  const lengthPenalty = Math.max(0, t.length - q.length) * 0.1
  return score - lengthPenalty
}

/** `true` exactly when `fuzzyScore` would find a match (every query char present, in order). */
export function fuzzyMatches(query: string, target: string): boolean {
  return fuzzyScore(query, target) !== null
}

/** Best (highest) score across several candidate strings for the same query, or `null` if none match. */
export function bestFuzzyScore(query: string, candidates: readonly string[]): number | null {
  let best: number | null = null

  for (const candidate of candidates) {
    const score = fuzzyScore(query, candidate)
    if (score !== null && (best === null || score > best)) {
      best = score
    }
  }

  return best
}
