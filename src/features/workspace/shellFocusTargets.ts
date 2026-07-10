/**
 * DOM-facing focus resolution for the strata shell's focus-region palette verbs (MERIDIAN item
 * 6, carried note from item 4: K.1's keyboard alternative for entering the tab ring when focus
 * rests on body — see `services/commands/command-registry.ts`'s `workspace.focus*` entries).
 *
 * Deliberately does NOT add a permanent `tabindex` to the sky/stage/ground wrapper divs
 * themselves. `StrataShell`'s `isTabFlipRestingTarget` (item 2) treats "a plain non-focusable
 * stratum surface" as a Tab-flip resting target BY DESIGN — clicking empty canvas/timeline space
 * today leaves focus resting on `body`, so Tab still flips the horizon. Making those wrapper divs
 * broadly focusable would turn every click into that empty space into a focus target instead,
 * silently changing which element Tab-flip's guard sees and regressing item 2's behavior for the
 * single most common interaction (click into empty stratum space, then Tab). Instead:
 *  - if the region already has a real focusable descendant, focus that (a genuine tab-ring
 *    member, so subsequent Tab presses continue naturally through the region's own controls —
 *    exactly K.1's goal);
 *  - only if the region is empty (e.g. a fresh project's untouched canvas) do we fall back to
 *    focusing the wrapper itself, and even then only by toggling `tabindex` on JUST FOR the
 *    duration of that focus (removed again on blur), so the wrapper never becomes a standing
 *    click target.
 */

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'

export interface ShellFocusTargets {
  splitter: HTMLElement | null
  sky: HTMLElement | null
  stage: HTMLElement | null
  ground: HTMLElement | null
}

export function resolveShellFocusTargets(): ShellFocusTargets {
  if (typeof document === 'undefined') {
    return { splitter: null, sky: null, stage: null, ground: null }
  }

  const shell = document.querySelector<HTMLElement>('[data-meridian-shell]')

  return {
    splitter: shell?.querySelector<HTMLElement>('[role="separator"][aria-orientation="horizontal"]') ?? null,
    sky: shell?.querySelector<HTMLElement>('[data-meridian-stratum="workflow"]') ?? null,
    stage: shell?.querySelector<HTMLElement>('[data-meridian-stage-row]') ?? null,
    ground: shell?.querySelector<HTMLElement>('[data-meridian-stratum="timeline"]') ?? null,
  }
}

/** Focuses the first real focusable descendant of `container`, or `container` itself as a
 *  temporary (blur-cleaned-up) fallback when it has none. No-op for a `null` container. */
export function focusShellRegion(container: HTMLElement | null | undefined): void {
  if (!container) {
    return
  }

  const descendant = container.querySelector<HTMLElement>(FOCUSABLE_SELECTOR)

  if (descendant) {
    descendant.focus()
    return
  }

  const hadTabIndexAttribute = container.hasAttribute('tabindex')

  if (!hadTabIndexAttribute) {
    container.setAttribute('tabindex', '-1')
  }

  container.focus()

  if (!hadTabIndexAttribute) {
    const cleanup = () => {
      container.removeAttribute('tabindex')
      container.removeEventListener('blur', cleanup)
    }
    container.addEventListener('blur', cleanup, { once: true })
  }
}
