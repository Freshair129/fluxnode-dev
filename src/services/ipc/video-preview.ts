import type { PreviewFrameData } from '../../domain/project/types'
import { invokeCommand } from './tauri-commands'
import { isTauriRuntime } from './tauri-runtime'

interface TauriPreviewFrameResponse {
  assetId: string
  sourcePath: string
  requestedTime: number
  width: number
  height: number
  mimeType: string
  dataUrl: string
  generatedAt: string
}

export async function decodePreviewFrame(
  assetId: string,
  sourcePath: string,
  requestedTime: number,
  width: number,
  height: number,
): Promise<PreviewFrameData> {
  if (!isTauriRuntime()) {
    return buildFallbackFrame(assetId, sourcePath, requestedTime, width, height)
  }

  const response = await invokeCommand<string>('video_decode_frame', {
    assetId,
    sourcePath,
    requestedTime,
    width,
    height,
  })

  return JSON.parse(response) as TauriPreviewFrameResponse
}

function buildFallbackFrame(
  assetId: string,
  sourcePath: string,
  requestedTime: number,
  width: number,
  height: number,
): PreviewFrameData {
  const label = sourcePath.split(/[\\/]/).at(-1) ?? sourcePath
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
      <defs>
        <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stop-color="#1a2230"/>
          <stop offset="100%" stop-color="#0b0f14"/>
        </linearGradient>
      </defs>
      <rect width="100%" height="100%" fill="url(#bg)"/>
      <circle cx="${width * 0.78}" cy="${height * 0.28}" r="${Math.max(26, width * 0.08)}" fill="rgba(224,255,0,0.18)"/>
      <rect x="${width * 0.08}" y="${height * 0.16}" width="${width * 0.84}" height="${height * 0.68}" rx="18" fill="rgba(255,255,255,0.05)" stroke="rgba(255,255,255,0.14)"/>
      <text x="50%" y="42%" text-anchor="middle" fill="#f8fafc" font-size="${Math.max(18, width * 0.038)}" font-family="Arial, sans-serif">${escapeXml(label)}</text>
      <text x="50%" y="54%" text-anchor="middle" fill="#cbd5e1" font-size="${Math.max(12, width * 0.024)}" font-family="Arial, sans-serif">Preview at ${requestedTime.toFixed(2)}s</text>
      <text x="50%" y="66%" text-anchor="middle" fill="#94a3b8" font-size="${Math.max(11, width * 0.02)}" font-family="Arial, sans-serif">${escapeXml(assetId)}</text>
    </svg>
  `.trim()

  return {
    assetId,
    sourcePath,
    requestedTime,
    width,
    height,
    mimeType: 'image/svg+xml',
    dataUrl: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`,
    generatedAt: new Date().toISOString(),
  }
}

function escapeXml(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;')
}
