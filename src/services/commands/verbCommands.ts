/**
 * MERIDIAN item 6 — the palette's "verbs with arguments" result class (spec H). Unlike
 * `verbs.ts` (pure verb-token/argument-text parsing) this file is allowed to touch the store —
 * it's the small, honest table of REAL verbs that exist today. Per the item-6 brief: "don't fake
 * verbs that don't do anything — if only one real verb exists, ship one and say so." Two real
 * verbs ship here:
 *
 *  - `zoom <percent>` — sets the timeline zoom via the existing `adjustTimelineZoom` action
 *    (a relative-delta action; this verb computes the delta from the current zoom so the palette
 *    can offer an absolute-feeling "zoom to N%" verb without the store gaining a new action).
 *  - `export <preset>` — resolves a render preset by name/id against `project.output.presets`
 *    (fuzzy, reusing `fuzzy.ts`), sets it active via the existing `setActiveRenderPreset`, and
 *    queues the render via the existing `enqueueRender`. Both are real, already-shipped store
 *    actions (see TimelineView's zoom mini-buttons and the export flow in `project-store.ts`) —
 *    this verb is a new INPUT surface for them, not new behavior.
 */
import type { CommandContext } from './command-registry'
import { fuzzyScore } from './fuzzy'

export interface VerbCommandResult {
  /** What the palette shows for this verb candidate right now (may be provisional/disabled while args are incomplete). */
  title: string
  subtitle?: string
  disabled: boolean
  disabledReason?: string
}

export interface VerbCommandSpec {
  verb: string
  argsHint: string
  /** Pure-ish description of what this verb WOULD do with the given (possibly incomplete) args — reads ctx.store but never writes. */
  describe: (ctx: CommandContext, argsText: string) => VerbCommandResult
  /** Executes the verb. Only called by the palette when `describe(...).disabled` is false. */
  run: (ctx: CommandContext, argsText: string) => void
}

const MIN_ZOOM = 0.25
const MAX_ZOOM = 6

function parseZoomPercent(argsText: string): number | null {
  const value = Number(argsText.trim().replace(/%$/, ''))
  return Number.isFinite(value) && value > 0 ? value : null
}

const zoomVerb: VerbCommandSpec = {
  verb: 'zoom',
  argsHint: '<percent>',
  describe: (ctx, argsText) => {
    const percent = parseZoomPercent(argsText)

    if (percent === null) {
      return { title: 'zoom <percent>', disabled: true, disabledReason: 'Enter a percent, e.g. "zoom 150"' }
    }

    const clampedRatio = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, percent / 100))
    const currentPercent = Math.round(ctx.store.project.timeline.zoom * 100)
    return {
      title: `Zoom timeline to ${Math.round(clampedRatio * 100)}%`,
      subtitle: `Currently ${currentPercent}%`,
      disabled: false,
    }
  },
  run: (ctx, argsText) => {
    const percent = parseZoomPercent(argsText)
    if (percent === null) {
      return
    }
    const targetRatio = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, percent / 100))
    ctx.store.adjustTimelineZoom(targetRatio - ctx.store.project.timeline.zoom)
  },
}

function resolvePreset(ctx: CommandContext, argsText: string) {
  const query = argsText.trim()
  if (query.length === 0) {
    return null
  }

  const presets = ctx.store.project.output.presets
  let best: { preset: (typeof presets)[number]; score: number } | null = null

  for (const preset of presets) {
    const score = Math.max(fuzzyScore(query, preset.name) ?? -1, fuzzyScore(query, preset.id) ?? -1)
    if (score >= 0 && (best === null || score > best.score)) {
      best = { preset, score }
    }
  }

  return best?.preset ?? null
}

const exportVerb: VerbCommandSpec = {
  verb: 'export',
  argsHint: '<preset name>',
  describe: (ctx, argsText) => {
    if (argsText.trim().length === 0) {
      return { title: 'export <preset name>', disabled: true, disabledReason: 'Type a render preset name, e.g. "export 1080p"' }
    }

    const preset = resolvePreset(ctx, argsText)

    if (!preset) {
      return { title: `export ${argsText}`, disabled: true, disabledReason: `No render preset matches "${argsText}"` }
    }

    return { title: `Export using "${preset.name}"`, subtitle: 'Queues a render with this preset active', disabled: false }
  },
  run: (ctx, argsText) => {
    const preset = resolvePreset(ctx, argsText)
    if (!preset) {
      return
    }
    ctx.store.setActiveRenderPreset(preset.id)
    void ctx.store.enqueueRender()
  },
}

/** The full, honest verb table. Exactly two real verbs ship today — see this file's header comment. */
export const VERB_COMMANDS: readonly VerbCommandSpec[] = [zoomVerb, exportVerb]
