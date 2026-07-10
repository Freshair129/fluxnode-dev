import { useEffect, useRef } from 'react'

/**
 * Shared modal accessibility helper. Traps Tab focus inside the dialog,
 * moves initial focus onto the dialog (or its first focusable element) when it
 * opens, and restores focus to the element that previously held it on unmount.
 *
 * Additive only: it does not change layout, styling, or any interaction
 * behavior beyond keeping keyboard focus inside the open dialog.
 */
export function useModalA11y<T extends HTMLElement>(active = true) {
  const containerRef = useRef<T | null>(null)

  useEffect(() => {
    const container = containerRef.current

    if (!container || !active) {
      return
    }

    const previouslyFocused = document.activeElement as HTMLElement | null

    const focusableSelector =
      'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'

    const getFocusable = () =>
      Array.from(container.querySelectorAll<HTMLElement>(focusableSelector)).filter(
        (element) => element.offsetParent !== null || element === document.activeElement,
      )

    // Move initial focus into the dialog without stealing it from an element
    // the user may have already focused (e.g. an autoFocus input).
    //
    // `preventScroll` matters here: a dialog card taller than the viewport overflows its centered
    // backdrop, so the default focus-scroll would drag the document to chase the first focusable
    // element and strand the dialog's own header (and close button) above y=0, with nothing to
    // scroll it back. The Tab-trap below deliberately keeps the default scrolling behavior, since
    // there the scroll is following a keypress the user just made.
    if (!container.contains(document.activeElement)) {
      const focusable = getFocusable()
      const initialTarget = focusable[0] ?? container
      initialTarget.focus({ preventScroll: true })
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key !== 'Tab') {
        return
      }

      const focusable = getFocusable()

      if (focusable.length === 0) {
        event.preventDefault()
        container?.focus()
        return
      }

      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      const active = document.activeElement as HTMLElement | null

      if (event.shiftKey) {
        if (active === first || !container?.contains(active)) {
          event.preventDefault()
          last.focus()
        }
        return
      }

      if (active === last || !container?.contains(active)) {
        event.preventDefault()
        first.focus()
      }
    }

    container.addEventListener('keydown', handleKeyDown)

    return () => {
      container.removeEventListener('keydown', handleKeyDown)

      if (previouslyFocused && typeof previouslyFocused.focus === 'function') {
        previouslyFocused.focus()
      }
    }
  }, [active])

  return containerRef
}
