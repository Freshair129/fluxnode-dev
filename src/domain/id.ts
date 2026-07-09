// Monotonic id generator shared across the store/domain/persistence layers.
//
// `Date.now()`-based ids (and `${type}-${Date.now()}` variants) collide when two
// ids are minted within the same millisecond, which happens routinely for
// history commands, WAL entries, and generated entities during fast user
// interaction or programmatic batches. `nextId` appends a module-level
// monotonic counter so ids are guaranteed unique within a session regardless
// of timing, while remaining sortable/informative like the previous scheme.
let counter = 0

export function nextId(prefix: string): string {
  counter += 1
  return `${prefix}-${Date.now()}-${counter}`
}
