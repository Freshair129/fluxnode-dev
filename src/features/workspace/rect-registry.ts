import { rectFromDomRect, type Rect } from '../../domain/project/lineageThread'

/**
 * Resolves the viewport rect of a lineage endpoint ON DEMAND, by DOM query — item-5 brief:
 * "Do NOT maintain a live subscription per element (hundreds of clips/nodes; a ResizeObserver
 * farm is not warranted)." Endpoints are identified by the `data-meridian-clip-id`/
 * `data-meridian-node-id` attributes added to TimelineView/WorkflowView's rendered clip/node
 * elements. This module is intentionally thin and DOM-facing — all the math lives in the
 * dependency-free `domain/project/lineageThread.ts` so it can be unit tested without jsdom
 * (this repo's vitest runs in the plain node environment; see that module's header comment).
 */

export type LineageEndpointKind = 'clip' | 'node'

function attributeFor(kind: LineageEndpointKind): string {
  return kind === 'clip' ? 'data-meridian-clip-id' : 'data-meridian-node-id'
}

function escapeAttributeValue(value: string): string {
  if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') {
    return CSS.escape(value)
  }

  // Minimal fallback for environments without CSS.escape (defensive only — Tauri's WebView2/
  // Chromium runtime and every evergreen browser this app targets support it).
  return value.replace(/["\\]/g, '\\$&')
}

export function resolveEndpointElement(kind: LineageEndpointKind, id: string): HTMLElement | null {
  if (typeof document === 'undefined' || !id) {
    return null
  }

  return document.querySelector<HTMLElement>(`[${attributeFor(kind)}="${escapeAttributeValue(id)}"]`)
}

/** Returns `null` when the element isn't in the DOM (virtualized away, collapsed stratum, unmounted) — see item-5 brief point 1. */
export function resolveEndpointRect(kind: LineageEndpointKind, id: string): Rect | null {
  const element = resolveEndpointElement(kind, id)

  if (!element) {
    return null
  }

  const domRect = element.getBoundingClientRect()

  if (domRect.width === 0 && domRect.height === 0) {
    return null
  }

  return rectFromDomRect(domRect)
}

/** The visible bounds of a stratum (sky/ground), tagged by item 4's `data-meridian-stratum`. */
export function resolveStratumRect(stratum: 'workflow' | 'timeline'): Rect | null {
  if (typeof document === 'undefined') {
    return null
  }

  const element = document.querySelector<HTMLElement>(`[data-meridian-stratum="${stratum}"]`)
  return element ? rectFromDomRect(element.getBoundingClientRect()) : null
}

/** The stage row's rect (item 3's `data-meridian-stage-row`) — the horizon-crossing reference the thread clips behind. */
export function resolveStageRowRect(): Rect | null {
  if (typeof document === 'undefined') {
    return null
  }

  const element = document.querySelector<HTMLElement>('[data-meridian-stage-row]')
  return element ? rectFromDomRect(element.getBoundingClientRect()) : null
}

export function resolveShellElement(): HTMLElement | null {
  if (typeof document === 'undefined') {
    return null
  }

  return document.querySelector<HTMLElement>('[data-meridian-shell]')
}

export function scrollEndpointIntoView(kind: LineageEndpointKind, id: string, smooth: boolean): void {
  const element = resolveEndpointElement(kind, id)
  element?.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: smooth ? 'smooth' : 'auto' })
}
