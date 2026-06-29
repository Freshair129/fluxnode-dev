import { invokeCommand } from './tauri-commands'
import { isTauriRuntime } from './tauri-runtime'

export function canOpenPathInShell(path: string) {
  return isTauriRuntime() || !path.startsWith('browser-local://')
}

export async function toggleAppFullscreen() {
  if (!isTauriRuntime()) {
    if (document.fullscreenElement) {
      await document.exitFullscreen()
      return
    }

    await document.documentElement.requestFullscreen()
    return
  }

  await invokeCommand('window_toggle_fullscreen')
}

export async function quitApplication() {
  if (!isTauriRuntime()) {
    window.close()
    return
  }

  await invokeCommand('app_quit')
}

export async function openPathInShell(path: string) {
  if (!canOpenPathInShell(path)) {
    return
  }

  if (!isTauriRuntime()) {
    window.open(path, '_blank', 'noopener,noreferrer')
    return
  }

  await invokeCommand('shell_open_path', { path })
}
