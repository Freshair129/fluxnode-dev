import type { WaveformCacheEntry, WaveformPeak } from '../../domain/project/types'
import { invokeCommand } from './tauri-commands'
import { isTauriRuntime } from './tauri-runtime'

interface GenerateWaveformResponse {
  assetId: string
  sourcePath: string
  cachePath: string
  peaks: Array<{ min: number; max: number }>
  generatedAt: string
}

export async function generateWaveformPeaks(
  assetId: string,
  sourcePath: string,
  bucketCount: number,
): Promise<WaveformCacheEntry> {
  if (!isTauriRuntime()) {
    return {
      assetId,
      sourcePath,
      cachePath: `browser-local://${assetId}.waveform.json`,
      peaks: buildFallbackWaveform(sourcePath, bucketCount),
      generatedAt: new Date().toISOString(),
    }
  }

  const response = await invokeCommand<string>('asset_generate_waveform', {
    assetId,
    sourcePath,
    bucketCount,
  })

  const parsed = JSON.parse(response) as GenerateWaveformResponse
  return {
    assetId: parsed.assetId,
    sourcePath: parsed.sourcePath,
    cachePath: parsed.cachePath,
    peaks: parsed.peaks,
    generatedAt: parsed.generatedAt,
  }
}

function buildFallbackWaveform(sourcePath: string, bucketCount: number): WaveformPeak[] {
  const seed = Array.from(sourcePath).reduce((sum, char) => sum + char.charCodeAt(0), 0)
  return Array.from({ length: bucketCount }, (_, index) => {
    const base = Math.sin((seed + index * 17) * 0.11)
    const spread = (Math.cos((seed + index * 29) * 0.07) + 1) / 2
    const max = Number((0.2 + spread * 0.8).toFixed(3))
    const min = Number((-0.15 - Math.abs(base) * 0.75).toFixed(3))
    return { min, max }
  })
}
