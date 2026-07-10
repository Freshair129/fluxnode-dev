/**
 * Dependency-free "addressed object" resolution for the command palette's second result class
 * (spec H: "objects by address or name" — `c14`, `n7.t3`). Kept pure (plain arrays in, plain
 * arrays out — no React, no Zustand, no DOM) so address assignment and matching can be unit
 * tested directly; the thin DOM/store-facing glue lives in `CommandPalette.tsx`.
 *
 * Scope note: this codebase has no persisted `c<N>`/`n<N>` address field (clips/nodes carry
 * opaque ids) and no Take model (see `domain/project/lineageThread.ts`'s binding orchestrator
 * decision). Addresses here are assigned positionally — `c1`, `c2`, … in timeline order; `n1`,
 * `n2`, … in workflow-node array order — which is deterministic and stable across renders of the
 * same project state, honestly approximating the spec's addressing scheme without inventing a
 * `n7.t3` Take address this codebase can't back.
 */
import { bestFuzzyScore } from './fuzzy'

export type AddressedObjectKind = 'clip' | 'node'

export interface AddressableSource {
  id: string
  /** Clip: linked asset name (or null if unresolved/missing). Node: `label`, or null if unset. */
  name: string | null
}

export interface AddressedObject {
  kind: AddressedObjectKind
  id: string
  address: string
  /** Display name — falls back to a "<Type> <address>" shape when the source has no name. */
  name: string
}

function indexBy(kind: AddressedObjectKind, prefix: string, sources: readonly AddressableSource[], fallbackLabel: string): AddressedObject[] {
  return sources.map((source, index) => {
    const address = `${prefix}${index + 1}`
    return {
      kind,
      id: source.id,
      address,
      name: source.name && source.name.trim().length > 0 ? source.name : `${fallbackLabel} ${address}`,
    }
  })
}

/** Assigns `c1, c2, …` addresses to clips in timeline order. */
export function indexClipAddresses(clips: readonly AddressableSource[]): AddressedObject[] {
  return indexBy('clip', 'c', clips, 'Clip')
}

/** Assigns `n1, n2, …` addresses to workflow nodes in graph array order. */
export function indexNodeAddresses(nodes: readonly AddressableSource[]): AddressedObject[] {
  return indexBy('node', 'n', nodes, 'Node')
}

/**
 * Score of how well `query` addresses `object` — matched against its address (exact address
 * match always wins, so typing `c3` unambiguously beats a fuzzy name hit), its display name, and
 * its raw id (so pasting/typing a full id still resolves). `null` when none match.
 */
export function scoreAddressedObject(query: string, object: AddressedObject): number | null {
  const trimmed = query.trim()

  if (trimmed.length === 0) {
    return null
  }

  if (trimmed.toLowerCase() === object.address.toLowerCase()) {
    return 1000
  }

  return bestFuzzyScore(trimmed, [object.address, object.name, object.id])
}

export interface AddressedObjectMatch {
  object: AddressedObject
  score: number
}

/** All objects `query` addresses, best score first. */
export function resolveAddressedObjects(query: string, objects: readonly AddressedObject[]): AddressedObjectMatch[] {
  const matches: AddressedObjectMatch[] = []

  for (const object of objects) {
    const score = scoreAddressedObject(query, object)
    if (score !== null) {
      matches.push({ object, score })
    }
  }

  return matches.sort((a, b) => b.score - a.score)
}
