import type { AssetProbeResult } from '../../domain/project/types'
import { invokeCommand } from './tauri-commands'
import { isTauriRuntime } from './tauri-runtime'

export async function probeAssetMetadata(path: string): Promise<AssetProbeResult> {
  if (!isTauriRuntime()) {
    return buildFallbackProbe(path, 0)
  }

  const response = await invokeCommand<string>('asset_probe', { path })
  return JSON.parse(response) as AssetProbeResult
}

export function buildFallbackProbe(path: string, fileSize: number): AssetProbeResult {
  const extension = path.split('.').at(-1)?.toLowerCase() ?? ''

  if (['mp4', 'mov', 'mkv', 'webm'].includes(extension)) {
    return {
      codec: 'H.264',
      width: 3840,
      height: 2160,
      frameRate: 30,
      channels: 2,
      sampleRate: 48000,
      fileSize,
      duration: 12,
    }
  }

  if (['wav', 'mp3', 'flac', 'aac'].includes(extension)) {
    return {
      codec: extension === 'wav' ? 'PCM' : extension.toUpperCase(),
      width: null,
      height: null,
      frameRate: null,
      channels: 2,
      sampleRate: 48000,
      fileSize,
      duration: 18,
    }
  }

  if (['png', 'jpg', 'jpeg', 'webp'].includes(extension)) {
    return {
      codec: extension.toUpperCase(),
      width: 1920,
      height: 1080,
      frameRate: null,
      channels: null,
      sampleRate: null,
      fileSize,
      duration: null,
    }
  }

  return {
    codec: null,
    width: null,
    height: null,
    frameRate: null,
    channels: null,
    sampleRate: null,
    fileSize,
    duration: null,
  }
}
