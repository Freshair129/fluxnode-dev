import type { Transcript } from '../../domain/copilot/rough-cut'
import { invokeCommand } from './tauri-commands'
import { isTauriRuntime } from './tauri-runtime'

/**
 * Transcribe an audio/video file to timestamped segments via the Rust `transcribe` action
 * (whisper.cpp). ReadOnly, so it runs without approval. In browser preview mode — or wherever the
 * whisper sidecar isn't present — a small canned transcript keeps the rough-cut flow demoable.
 */
export async function transcribeAudio(audioPath: string): Promise<Transcript> {
  if (!isTauriRuntime()) {
    return demoTranscript()
  }
  // `transcribe` is a media action, reachable only through the registry's `action_invoke` command
  // (media actions have no standalone Tauri command). Args use the Rust-native key `audio_path` —
  // Tauri's camelCase→snake_case conversion applies to command params, not to nested `args` keys.
  return invokeCommand<Transcript>('action_invoke', {
    name: 'transcribe',
    args: { audio_path: audioPath },
  })
}

function demoTranscript(): Transcript {
  return {
    text: 'welcome back … so today',
    segments: [
      { start: 0, end: 1, text: 'welcome back' },
      { start: 2.5, end: 3.5, text: 'so today' },
    ],
  }
}
