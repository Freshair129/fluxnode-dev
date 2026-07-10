/**
 * Dependency-free "verb + arguments" parsing for the command palette's third result class (spec
 * H: "verbs with arguments", e.g. `export mp4-1080p`, `zoom 150`). Kept pure — no store, no DOM
 * — so parsing/matching can be unit tested directly. The actual verb table (which verbs exist,
 * what they do) lives in `verbCommands.ts`, which is allowed to touch the store; this module
 * only knows how to split input into a verb token + argument text and match it against a list of
 * known verb names.
 */

export interface ParsedVerbInput {
  verb: string
  /** Raw text after the verb token, whitespace-trimmed. Empty string if no args were typed yet. */
  argsText: string
}

/**
 * Splits `input` into a leading verb token and the remaining argument text. Returns `null` for
 * blank input. A single word with no trailing space still parses (verb = that word, args = '')
 * so the palette can show the verb's argument hint while the user is still typing the verb name.
 */
export function parseVerbInput(input: string): ParsedVerbInput | null {
  const trimmed = input.trim()

  if (trimmed.length === 0) {
    return null
  }

  const spaceIndex = trimmed.indexOf(' ')

  if (spaceIndex === -1) {
    return { verb: trimmed, argsText: '' }
  }

  return {
    verb: trimmed.slice(0, spaceIndex),
    argsText: trimmed.slice(spaceIndex + 1).trim(),
  }
}

export interface KnownVerb {
  verb: string
  argsHint: string
}

/**
 * Which known verb(s) does `parsed.verb` name or prefix-match, case-insensitively? Prefix match
 * (not fuzzy) is deliberate: verbs are a small, memorized vocabulary (spec H's own example is a
 * literal `gen n7 seed 41`), so "type the start of the word" is the right mental model, not
 * scattered-character fuzzy matching.
 *
 * Generic over `T extends KnownVerb` (rather than fixed to `KnownVerb`) so `verbCommands.ts` can
 * pass its richer `VerbCommandSpec[]` (which carries `describe`/`run` alongside `verb`/
 * `argsHint`) and get the same concrete type back, without this pure module needing to know
 * anything about those extra fields.
 */
export function matchKnownVerbs<T extends KnownVerb>(parsedVerb: string, knownVerbs: readonly T[]): T[] {
  const needle = parsedVerb.toLowerCase()
  return knownVerbs.filter((known) => known.verb.toLowerCase().startsWith(needle))
}

/** Whole-word (not prefix) match — used once the user has typed the full verb and moved on to args. */
export function isExactVerb(parsedVerb: string, knownVerb: KnownVerb): boolean {
  return parsedVerb.toLowerCase() === knownVerb.verb.toLowerCase()
}
