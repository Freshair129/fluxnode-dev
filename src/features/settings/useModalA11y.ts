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
    if (!container.contains(document.activeElement)) {
      const focusable = getFocusable()
      const initialTarget = focusable[0] ?? container
      initialTarget.focus()
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
      const focused = document.activeElement as HTMLElement | null

      if (event.shiftKey) {
        if (focused === first || !container?.contains(focused)) {
          event.preventDefault()
          last.focus()
        }
        return
      }

      if (focused === last || !container?.contains(focused)) {
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
