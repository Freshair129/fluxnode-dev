import type { ThumbnailResult } from '../../domain/project/types'
import { invokeCommand } from './tauri-commands'
import { isTauriRuntime } from './tauri-runtime'

export async function generateAssetThumbnail(
  assetId: string,
  sourcePath: string,
  time: number,
): Promise<ThumbnailResult> {
  if (!isTauriRuntime()) {
    const svg = `
      <svg xmlns="http://www.w3.org/2000/svg" width="320" height="180" viewBox="0 0 320 180">
        <rect width="100%" height="100%" fill="#111827"/>
        <rect x="20" y="20" width="280" height="140" rx="16" fill="#1f2937" stroke="#e0ff00" stroke-opacity="0.35"/>
        <text x="50%" y="48%" text-anchor="middle" fill="#f8fafc" font-size="18" font-family="Arial, sans-serif">${escapeXml(sourcePath.split(/[\\/]/).at(-1) ?? sourcePath)}</text>
        <text x="50%" y="62%" text-anchor="middle" fill="#94a3b8" font-size="12" font-family="Arial, sans-serif">Thumb at ${time.toFixed(1)}s</text>
      </svg>
    `.trim()

    return {
      assetId,
      thumbnailPath: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`,
      mimeType: 'image/svg+xml',
      generatedAt: new Date().toISOString(),
    }
  }

  const response = await invokeCommand<string>('asset_generate_thumbnail', {
    assetId,
    sourcePath,
    time,
  })
  return JSON.parse(response) as ThumbnailResult
}

function escapeXml(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;')
}
