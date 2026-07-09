/**
 * Shared keydown-target guards, extracted from `features/workspace/StrataShell` (item 2) so
 * `useKeyboardShortcuts` (item 5's `F` follow-thread binding) can reuse them without creating a
 * static import cycle: `StrataShell` lazy-imports `App` for `PanelFallback`, and `App`
 * statically imports `useKeyboardShortcuts` — a direct `useKeyboardShortcuts -> StrataShell`
 * import would close that loop synchronously. This neutral module has no dependencies of its
 * own, so both sides can import it safely.
 */

/** Is the keydown target an editable control (input/textarea/select/contentEditable/combobox)? */
export function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false
  }

  if (['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) {
    return true
  }

  if (target.isContentEditable) {
    return true
  }

  return target.closest('[role="combobox"]') !== null
}

/**
 * Every dialog/overlay in this app (ConfirmDialog, PromptDialog, WelcomeModal, SettingsModal,
 * WorkspaceSharingModal, ShortcutsCheatSheet) renders `aria-modal="true"`. Checking for that
 * attribute avoids threading a global "is a dialog open" flag through the store just for this
 * guard.
 */
export function isOverlayOpen(): boolean {
  return document.querySelector('[aria-modal="true"]') !== null
}
