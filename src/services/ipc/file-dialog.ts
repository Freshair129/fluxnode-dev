import { invokeCommand } from './tauri-commands'
import { isTauriRuntime } from './tauri-runtime'

async function pickPathWithFallback(
  tauriCommand: 'fs_pick_directory' | 'fs_pick_media_file',
  promptMessage: string,
  initialDirectory?: string | null,
) {
  if (!isTauriRuntime()) {
    return window.prompt(promptMessage)?.trim() || null
  }

  const response = await invokeCommand<string | null>(tauriCommand, {
    initialDirectory: initialDirectory?.trim() || null,
  })
  return response?.trim() || null
}

export function pickProjectDirectory(initialDirectory?: string | null) {
  return pickPathWithFallback(
    'fs_pick_directory',
    'Enter a .fluxnode project directory path',
    initialDirectory,
  )
}

export function pickRelinkDirectory(initialDirectory?: string | null) {
  return pickPathWithFallback(
    'fs_pick_directory',
    'Enter a folder path to scan for missing media by filename',
    initialDirectory,
  )
}

export function pickMediaFile(promptMessage: string, initialDirectory?: string | null) {
  return pickPathWithFallback('fs_pick_media_file', promptMessage, initialDirectory)
}
