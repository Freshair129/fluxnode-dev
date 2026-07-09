import { invokeCommand } from './tauri-commands'
import { isTauriRuntime } from './tauri-runtime'
import type { AppUpdateManifest } from '../../domain/project/types'

interface AppUpdateCheckPayload {
  currentVersion: string
  latestVersion: string
  updateAvailable: boolean
  downloadUrl: string | null
  sha256: string | null
  notes: string | null
  publishedAt: string | null
  checkedAt: string
  channel: string | null
}

const BROWSER_APP_VERSION = '0.0.0-browser'

export async function getCurrentAppVersion() {
  if (!isTauriRuntime()) {
    return BROWSER_APP_VERSION
  }

  return invokeCommand<string>('get_app_version')
}

export async function checkForAppUpdate(manifestUrl: string) {
  const trimmedUrl = manifestUrl.trim()

  if (!trimmedUrl) {
    throw new Error('Update manifest URL is not configured.')
  }

  if (isTauriRuntime()) {
    const response = await invokeCommand<string>('check_for_app_update', {
      manifestUrl: trimmedUrl,
    })
    const payload = JSON.parse(response) as AppUpdateCheckPayload
    return {
      ...payload,
      sha256: payload.sha256 ?? null,
      checkedAt: new Date().toISOString(),
    } satisfies AppUpdateCheckPayload
  }

  const currentVersion = await getCurrentAppVersion()
  const response = await fetch(trimmedUrl, {
    cache: 'no-store',
    headers: {
      accept: 'application/json',
    },
  })

  if (!response.ok) {
    throw new Error(`Update manifest request failed with status ${response.status}.`)
  }

  const manifest = normalizeManifest(await response.json())

  return {
    currentVersion,
    latestVersion: manifest.version,
    updateAvailable: compareVersions(manifest.version, currentVersion) > 0,
    downloadUrl: manifest.downloadUrl,
    sha256: manifest.sha256,
    notes: manifest.notes,
    publishedAt: manifest.publishedAt,
    checkedAt: new Date().toISOString(),
    channel: manifest.channel,
  } satisfies AppUpdateCheckPayload
}

export async function downloadAppUpdatePackage(downloadUrl: string, expectedSha256: string | null) {
  const trimmedUrl = downloadUrl.trim()

  if (!trimmedUrl) {
    throw new Error('Update download URL is not available.')
  }

  if (isTauriRuntime()) {
    // The backend refuses to write an update package unless the manifest supplied a
    // SHA-256 that matches the downloaded bytes — surface a clear error rather than
    // sending an empty hash the backend will reject.
    if (!expectedSha256 || !expectedSha256.trim()) {
      throw new Error('Update manifest is missing a sha256 checksum; refusing to download an unverified package.')
    }

    return invokeCommand<string>('download_app_update', {
      downloadUrl: trimmedUrl,
      expectedSha256: expectedSha256.trim(),
    })
  }

  window.open(trimmedUrl, '_blank', 'noopener,noreferrer')
  return trimmedUrl
}

function normalizeManifest(value: unknown): AppUpdateManifest {
  if (!value || typeof value !== 'object') {
    throw new Error('Update manifest payload is invalid.')
  }

  const record = value as Record<string, unknown>
  const version = typeof record.version === 'string' ? record.version.trim() : ''

  if (!version) {
    throw new Error('Update manifest is missing a version field.')
  }

  return {
    version,
    downloadUrl: typeof record.downloadUrl === 'string' && record.downloadUrl.trim().length > 0 ? record.downloadUrl.trim() : null,
    sha256: typeof record.sha256 === 'string' && record.sha256.trim().length > 0 ? record.sha256.trim() : null,
    notes: typeof record.notes === 'string' && record.notes.trim().length > 0 ? record.notes.trim() : null,
    publishedAt: typeof record.publishedAt === 'string' && record.publishedAt.trim().length > 0 ? record.publishedAt.trim() : null,
    channel: typeof record.channel === 'string' && record.channel.trim().length > 0 ? record.channel.trim() : null,
  }
}

function compareVersions(left: string, right: string) {
  const leftParts = toVersionParts(left)
  const rightParts = toVersionParts(right)
  const length = Math.max(leftParts.length, rightParts.length)

  for (let index = 0; index < length; index += 1) {
    const leftPart = leftParts[index] ?? 0
    const rightPart = rightParts[index] ?? 0

    if (leftPart > rightPart) {
      return 1
    }

    if (leftPart < rightPart) {
      return -1
    }
  }

  return 0
}

function toVersionParts(value: string) {
  const match = value.trim().match(/\d+(?:\.\d+)*/)
  if (!match) {
    return [0]
  }

  return match[0]
    .split('.')
    .map((part) => Number.parseInt(part, 10))
    .filter((part) => Number.isFinite(part))
}
