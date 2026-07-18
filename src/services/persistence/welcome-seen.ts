const WELCOME_SEEN_KEY = 'fluxnode.welcomeSeen'

/**
 * First-run gate for the welcome/template modal. localStorage (not AppPreferences) on purpose:
 * it must be readable SYNCHRONOUSLY at store creation so the modal neither flashes on a
 * returning user's boot nor pops in late on a first run — `loadAppPreferences()` is async.
 * Works identically in the Tauri webview and browser mode; the e2e suite clears storage per
 * test, so every spec still boots with the modal visible.
 */
export function hasSeenWelcome(): boolean {
  try {
    return typeof window !== 'undefined' && window.localStorage.getItem(WELCOME_SEEN_KEY) === '1'
  } catch {
    return false
  }
}

export function markWelcomeSeen(): void {
  try {
    window.localStorage.setItem(WELCOME_SEEN_KEY, '1')
  } catch {
    // Storage unavailable (locked-down webview / private mode) — the modal shows again next boot.
  }
}
