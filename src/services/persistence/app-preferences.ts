import { DEFAULT_DENSITY_MODE, normalizeDensityMode } from '../../domain/project/density'
import type { AppPreferences, KeyBinding } from '../../domain/project/types'
import { invokeCommand } from '../ipc/tauri-commands'
import { isTauriRuntime } from '../ipc/tauri-runtime'
import { DEFAULT_KEYBINDINGS } from '../shortcuts/shortcut-config'

const APP_PREFERENCES_KEY = 'fluxnode.appPreferences'

const DEFAULT_APP_PREFERENCES: AppPreferences = {
  defaultProjectDirectory: null,
  comfyUiEndpoint: 'http://127.0.0.1:8188',
  cloudApiKey: '',
  updateChannel: 'stable',
  updateManifestUrl: null,
  keybindings: DEFAULT_KEYBINDINGS,
  density: DEFAULT_DENSITY_MODE,
}

export async function loadAppPreferences(): Promise<AppPreferences> {
  if (!isTauriRuntime()) {
    return loadLocalAppPreferences()
  }

  try {
    const response = await invokeCommand<string>('load_app_preferences')
    const preferences = normalizeAppPreferences(JSON.parse(response) as Partial<AppPreferences>)
    // The cloud API key is never persisted in preferences.json anymore — it lives in the OS
    // keychain. Hydrate the in-memory copy so the UI can display/use it this session.
    return { ...preferences, cloudApiKey: await loadCloudApiKey() }
  } catch {
    return loadLocalAppPreferences()
  }
}

export async function saveAppPreferences(preferences: AppPreferences): Promise<void> {
  if (!isTauriRuntime()) {
    window.localStorage.setItem(APP_PREFERENCES_KEY, JSON.stringify(preferences))
    return
  }

  // Never round-trip the secret through the webview-writable preferences file.
  const { cloudApiKey: _cloudApiKey, ...rest } = preferences
  await invokeCommand('save_app_preferences', {
    preferencesJson: JSON.stringify({ ...rest, cloudApiKey: '' }),
  })
}

export async function loadCloudApiKey(): Promise<string> {
  if (!isTauriRuntime()) {
    return loadLocalAppPreferences().cloudApiKey
  }

  try {
    return (await invokeCommand<string>('get_cloud_api_key')) ?? ''
  } catch {
    return ''
  }
}

export async function saveCloudApiKey(apiKey: string): Promise<void> {
  const trimmed = apiKey.trim()

  if (!isTauriRuntime()) {
    const next = { ...loadLocalAppPreferences(), cloudApiKey: trimmed }
    window.localStorage.setItem(APP_PREFERENCES_KEY, JSON.stringify(next))
    return
  }

  await invokeCommand('set_cloud_api_key', { key: trimmed })
}

function loadLocalAppPreferences(): AppPreferences {
  const serialized = window.localStorage.getItem(APP_PREFERENCES_KEY)

  if (!serialized) {
    return DEFAULT_APP_PREFERENCES
  }

  try {
    return normalizeAppPreferences(JSON.parse(serialized) as Partial<AppPreferences>)
  } catch {
    return DEFAULT_APP_PREFERENCES
  }
}

function normalizeAppPreferences(preferences: Partial<AppPreferences>): AppPreferences {
  return {
    defaultProjectDirectory:
      typeof preferences.defaultProjectDirectory === 'string' && preferences.defaultProjectDirectory.trim().length > 0
        ? preferences.defaultProjectDirectory
        : null,
    comfyUiEndpoint:
      typeof preferences.comfyUiEndpoint === 'string' && preferences.comfyUiEndpoint.trim().length > 0
        ? preferences.comfyUiEndpoint
        : DEFAULT_APP_PREFERENCES.comfyUiEndpoint,
    cloudApiKey: typeof preferences.cloudApiKey === 'string' ? preferences.cloudApiKey.trim() : '',
    updateChannel:
      typeof preferences.updateChannel === 'string' && preferences.updateChannel.trim().length > 0
        ? preferences.updateChannel.trim()
        : DEFAULT_APP_PREFERENCES.updateChannel,
    updateManifestUrl:
      typeof preferences.updateManifestUrl === 'string' && preferences.updateManifestUrl.trim().length > 0
        ? preferences.updateManifestUrl.trim()
        : null,
    keybindings: normalizeKeybindings(preferences.keybindings),
    density: normalizeDensityMode(preferences.density),
  }
}

function normalizeKeybindings(value: unknown): KeyBinding[] {
  if (!Array.isArray(value)) {
    return DEFAULT_APP_PREFERENCES.keybindings
  }

  const bindings = value
    .filter((entry): entry is KeyBinding =>
      !!entry &&
      typeof entry === 'object' &&
      typeof (entry as KeyBinding).command === 'string' &&
      typeof (entry as KeyBinding).key === 'string' &&
      Array.isArray((entry as KeyBinding).modifiers) &&
      typeof (entry as KeyBinding).when === 'string',
    )
    .map((entry) => ({
      command: entry.command,
      key: entry.key,
      modifiers: entry.modifiers.filter((modifier) => typeof modifier === 'string'),
      when: entry.when,
    }))

  return bindings.length > 0 ? bindings : DEFAULT_APP_PREFERENCES.keybindings
}
