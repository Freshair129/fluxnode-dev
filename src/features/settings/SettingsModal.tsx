import { Keyboard, MonitorCog, PlugZap, RotateCcw, X } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import type { ShortcutScope } from '../../domain/project/types'
import { pickProjectDirectory } from '../../services/ipc/file-dialog'
import {
  captureEventAsBinding,
  DEFAULT_KEYBINDINGS,
  detectKeybindingConflict,
  formatKeybinding,
  SHORTCUT_DEFINITIONS,
  type ShortcutCommand,
} from '../../services/shortcuts/shortcut-config'
import { useProjectStore } from '../../store/project-store'

const shortcutGroups: Array<{ title: string; scope: ShortcutScope }> = [
  { title: 'Global', scope: 'global' },
  { title: 'Timeline', scope: 'timeline' },
  { title: 'Workflow', scope: 'workflow' },
]

export function SettingsModal() {
  const closeSettings = useProjectStore((state) => state.closeSettings)
  const preferences = useProjectStore((state) => state.preferences)
  const exportDefaults = useProjectStore((state) => state.project.output.exportDefaults)
  const runtimeHealth = useProjectStore((state) => state.runtimeHealth)
  const setDefaultProjectDirectory = useProjectStore((state) => state.setDefaultProjectDirectory)
  const setUpdateChannel = useProjectStore((state) => state.setUpdateChannel)
  const setUpdateManifestUrl = useProjectStore((state) => state.setUpdateManifestUrl)
  const setExportOutputDirectory = useProjectStore((state) => state.setExportOutputDirectory)
  const toggleOpenFolderAfterExport = useProjectStore((state) => state.toggleOpenFolderAfterExport)
  const setCloudApiKey = useProjectStore((state) => state.setCloudApiKey)
  const setKeybinding = useProjectStore((state) => state.setKeybinding)
  const resetKeybinding = useProjectStore((state) => state.resetKeybinding)
  const [editingCommand, setEditingCommand] = useState<ShortcutCommand | null>(null)
  const [captureMessage, setCaptureMessage] = useState<string | null>(null)
  const [cloudApiKeyDraft, setCloudApiKeyDraft] = useState(preferences.cloudApiKey)
  const [updateChannelDraft, setUpdateChannelDraft] = useState(preferences.updateChannel)
  const [updateManifestUrlDraft, setUpdateManifestUrlDraft] = useState(preferences.updateManifestUrl ?? '')

  const keybindingMap = useMemo(
    () => new Map(preferences.keybindings.map((binding) => [binding.command, binding])),
    [preferences.keybindings],
  )

  async function handleChooseDefaultDirectory() {
    const path = await pickProjectDirectory(preferences.defaultProjectDirectory)

    if (path) {
      await setDefaultProjectDirectory(path)
    }
  }

  async function handleChooseExportDirectory() {
    const path = await pickProjectDirectory(exportDefaults.outputDirectory)

    if (path) {
      setExportOutputDirectory(path)
    }
  }

  useEffect(() => {
    setCloudApiKeyDraft(preferences.cloudApiKey)
  }, [preferences.cloudApiKey])

  useEffect(() => {
    setUpdateChannelDraft(preferences.updateChannel)
    setUpdateManifestUrlDraft(preferences.updateManifestUrl ?? '')
  }, [preferences.updateChannel, preferences.updateManifestUrl])

  useEffect(() => {
    function handleEscape(event: KeyboardEvent) {
      if (event.key === 'Escape' && !editingCommand) {
        event.preventDefault()
        closeSettings()
      }
    }

    window.addEventListener('keydown', handleEscape)
    return () => window.removeEventListener('keydown', handleEscape)
  }, [closeSettings, editingCommand])

  useEffect(() => {
    if (!editingCommand) {
      return
    }

    const definition = SHORTCUT_DEFINITIONS.find((item) => item.command === editingCommand)
    if (!definition) {
      return
    }
    const activeCommand = editingCommand
    const activeWhen = definition.when

    function handleCapture(event: KeyboardEvent) {
      event.preventDefault()
      const candidate = captureEventAsBinding(event, activeCommand, activeWhen)
      const conflict = detectKeybindingConflict(preferences.keybindings, candidate)

      if (conflict) {
        const conflictLabel =
          SHORTCUT_DEFINITIONS.find((item) => item.command === conflict.command)?.label ?? conflict.command
        setCaptureMessage(`Conflict: already used by ${conflictLabel}`)
        return
      }

      setCaptureMessage(`Saved ${formatKeybinding(candidate)}`)
      void setKeybinding(activeCommand, candidate.key, candidate.modifiers)
      setEditingCommand(null)
    }

    window.addEventListener('keydown', handleCapture)
    return () => window.removeEventListener('keydown', handleCapture)
  }, [editingCommand, preferences.keybindings, setKeybinding])

  return (
    <div className="absolute inset-0 z-30 flex items-center justify-center bg-black/65 p-4 backdrop-blur-sm">
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-modal-title"
        className="w-full max-w-6xl rounded-[2rem] border border-white/10 bg-[#101112] p-6 shadow-[0_30px_120px_rgba(0,0,0,0.55)]"
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-[11px] uppercase tracking-[0.35em] text-[#e0ff00]">Settings</p>
            <h2 id="settings-modal-title" className="mt-2 font-display text-3xl font-semibold tracking-tight text-white">
              App preferences, desktop behaviors, and editable shortcuts.
            </h2>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-[#9ca3af]">
              This settings surface now persists default workspace preferences and real keybinding overrides with conflict checks.
            </p>
          </div>
          <button
            type="button"
            onClick={closeSettings}
            aria-label="Close settings"
            className="inline-flex h-11 w-11 items-center justify-center rounded-full border border-white/10 bg-white/5 text-white"
          >
            <X size={18} />
          </button>
        </div>

        <div className="mt-6 grid gap-4 xl:grid-cols-[1fr_1.2fr]">
          <div className="space-y-4">
            <section className="rounded-[1.5rem] border border-white/10 bg-black/20 p-5">
              <div className="flex items-center gap-3">
                <MonitorCog size={18} className="text-[#e0ff00]" />
                <h3 className="text-sm font-semibold uppercase tracking-[0.2em] text-white">Workspace</h3>
              </div>
              <p className="mt-3 text-sm leading-6 text-[#9ca3af]">
                New project, open, and save-as pickers start from this directory when available.
              </p>
              <div className="mt-4 rounded-[1.25rem] border border-white/8 bg-[#111214] p-4">
                <p className="text-[11px] uppercase tracking-[0.22em] text-[#7f8691]">Default Project Directory</p>
                <p className="mt-3 break-all text-sm leading-6 text-white">
                  {preferences.defaultProjectDirectory ?? 'Not configured yet'}
                </p>
                <div className="mt-4 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => void handleChooseDefaultDirectory()}
                    className="rounded-full bg-[#e0ff00] px-4 py-2 text-sm font-semibold text-black"
                  >
                    Choose Directory
                  </button>
                  <button
                    type="button"
                    onClick={() => void setDefaultProjectDirectory(null)}
                    className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm text-white"
                  >
                    Clear
                  </button>
                </div>
              </div>
            </section>

            <section className="rounded-[1.5rem] border border-white/10 bg-black/20 p-5">
              <div className="flex items-center gap-3">
                <MonitorCog size={18} className="text-[#f59e0b]" />
                <h3 className="text-sm font-semibold uppercase tracking-[0.2em] text-white">Export Defaults</h3>
              </div>
              <p className="mt-3 text-sm leading-6 text-[#9ca3af]">
                These settings are saved inside the current project and drive queued render jobs.
              </p>
              <div className="mt-4 rounded-[1.25rem] border border-white/8 bg-[#111214] p-4">
                <p className="text-[11px] uppercase tracking-[0.22em] text-[#7f8691]">Output Directory</p>
                <p className="mt-3 break-all text-sm leading-6 text-white">{exportDefaults.outputDirectory}</p>
                <div className="mt-4 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => void handleChooseExportDirectory()}
                    className="rounded-full bg-[#f59e0b] px-4 py-2 text-sm font-semibold text-black"
                  >
                    Choose Output Directory
                  </button>
                </div>
              </div>
              <div className="mt-4 rounded-[1.25rem] border border-white/8 bg-[#111214] p-4">
                <p className="text-[11px] uppercase tracking-[0.22em] text-[#7f8691]">Export Behavior</p>
                <div className="mt-4 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={toggleOpenFolderAfterExport}
                    className={`rounded-full px-4 py-2 text-sm ${
                      exportDefaults.openFolderAfterExport
                        ? 'bg-[#e0ff00] font-semibold text-black'
                        : 'border border-white/10 bg-white/5 text-white'
                    }`}
                  >
                    {exportDefaults.openFolderAfterExport ? 'Reveal Output After Export: On' : 'Reveal Output After Export: Off'}
                  </button>
                </div>
                <p className="mt-4 text-sm leading-6 text-[#9ca3af]">
                  Export jobs always render from original source files. Proxy media is only used during editing previews.
                </p>
              </div>
            </section>

            <section className="rounded-[1.5rem] border border-white/10 bg-black/20 p-5">
              <div className="flex items-center gap-3">
                <PlugZap size={18} className="text-[#3b82f6]" />
                <h3 className="text-sm font-semibold uppercase tracking-[0.2em] text-white">Compute Setup</h3>
              </div>
              <div className="mt-4 grid gap-3 md:grid-cols-2">
                <InfoCard label="Local ComfyUI Endpoint" value={preferences.comfyUiEndpoint} />
                <InfoCard label="Runtime Backend" value={`${runtimeHealth.backend} / ${runtimeHealth.status}`} />
                <InfoCard
                  label="Memory Headroom"
                  value={
                    runtimeHealth.availableMemoryGb !== null && runtimeHealth.totalMemoryGb !== null
                      ? `${runtimeHealth.availableMemoryGb.toFixed(1)} GB free / ${runtimeHealth.totalMemoryGb.toFixed(1)} GB total`
                      : `${runtimeHealth.deviceMemoryGb ?? '?'} GB device memory`
                  }
                />
                <InfoCard
                  label="Disk Headroom"
                  value={
                    runtimeHealth.diskFreeGb !== null && runtimeHealth.diskCapacityGb !== null
                      ? `${runtimeHealth.diskFreeGb.toFixed(1)} GB free / ${runtimeHealth.diskCapacityGb.toFixed(1)} GB total`
                      : 'Disk telemetry pending'
                  }
                />
                <InfoCard
                  label="VRAM Pressure"
                  value={
                    runtimeHealth.vramTotalGb !== null
                      ? `${runtimeHealth.vramUsedGb?.toFixed(1) ?? '?'} GB used / ${runtimeHealth.vramTotalGb.toFixed(1)} GB total (${runtimeHealth.vramUtilizationPct?.toFixed(1) ?? '?'}%)`
                      : 'VRAM telemetry pending'
                  }
                />
              </div>
              <div className="mt-4 rounded-[1.25rem] border border-white/8 bg-[#111214] p-4">
                <label className="text-[11px] uppercase tracking-[0.22em] text-[#7f8691]">Cloud API Key</label>
                <input
                  type="password"
                  value={cloudApiKeyDraft}
                  onChange={(event) => setCloudApiKeyDraft(event.target.value)}
                  placeholder="Paste cloud API key for authenticated render jobs"
                  className="mt-3 w-full rounded-[1rem] border border-white/10 bg-black/20 px-4 py-3 text-sm text-white outline-none placeholder:text-[#7f8691]"
                />
                <div className="mt-4 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => void setCloudApiKey(cloudApiKeyDraft)}
                    className="rounded-full bg-[#3b82f6] px-4 py-2 text-sm font-semibold text-white"
                  >
                    Save API Key
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setCloudApiKeyDraft('')
                      void setCloudApiKey('')
                    }}
                    className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm text-white"
                  >
                    Clear
                  </button>
                </div>
              </div>
              <div className="mt-4 rounded-[1.25rem] border border-white/8 bg-[#111214] p-4">
                <label className="text-[11px] uppercase tracking-[0.22em] text-[#7f8691]">Update Channel</label>
                <input
                  type="text"
                  value={updateChannelDraft}
                  onChange={(event) => setUpdateChannelDraft(event.target.value)}
                  placeholder="stable"
                  className="mt-3 w-full rounded-[1rem] border border-white/10 bg-black/20 px-4 py-3 text-sm text-white outline-none placeholder:text-[#7f8691]"
                />
                <label className="mt-4 block text-[11px] uppercase tracking-[0.22em] text-[#7f8691]">Update Manifest URL</label>
                <input
                  type="url"
                  value={updateManifestUrlDraft}
                  onChange={(event) => setUpdateManifestUrlDraft(event.target.value)}
                  placeholder="https://releases.example.com/fluxnode/stable.json"
                  className="mt-3 w-full rounded-[1rem] border border-white/10 bg-black/20 px-4 py-3 text-sm text-white outline-none placeholder:text-[#7f8691]"
                />
                <div className="mt-4 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      void setUpdateChannel(updateChannelDraft)
                      void setUpdateManifestUrl(updateManifestUrlDraft)
                    }}
                    className="rounded-full bg-[#e0ff00] px-4 py-2 text-sm font-semibold text-black"
                  >
                    Save Update Source
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setUpdateChannelDraft('stable')
                      setUpdateManifestUrlDraft('')
                      void setUpdateChannel('stable')
                      void setUpdateManifestUrl(null)
                    }}
                    className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm text-white"
                  >
                    Clear
                  </button>
                </div>
              </div>
              <p className="mt-4 text-sm leading-6 text-[#9ca3af]">
                Local compute stays available offline when ComfyUI is running. Update checks remain manual and use the configured manifest URL so offline mode can disable them cleanly.
              </p>
            </section>
          </div>

          <section className="rounded-[1.5rem] border border-white/10 bg-black/20 p-5">
            <div className="flex items-center gap-3">
              <Keyboard size={18} className="text-[#e0ff00]" />
              <h3 className="text-sm font-semibold uppercase tracking-[0.2em] text-white">Keyboard Shortcuts</h3>
            </div>
            <p className="mt-3 text-sm leading-6 text-[#9ca3af]">
              Click a shortcut to capture a new key combo. Conflicts within the same scope are blocked before saving.
            </p>
            <div className="mt-3 rounded-[1.1rem] border border-white/8 bg-[#111214] px-4 py-3 text-sm text-white">
              {editingCommand
                ? `Capturing shortcut for ${SHORTCUT_DEFINITIONS.find((item) => item.command === editingCommand)?.label ?? editingCommand}. Press a key combo now.`
                : captureMessage ?? 'Select any row below to edit its binding.'}
            </div>
            <div className="mt-4 space-y-4">
              {shortcutGroups.map((group) => (
                <div key={group.title} className="rounded-[1.25rem] border border-white/8 bg-[#111214] p-4">
                  <p className="text-[11px] uppercase tracking-[0.22em] text-[#7f8691]">{group.title}</p>
                  <div className="mt-3 space-y-2">
                    {SHORTCUT_DEFINITIONS.filter((definition) => definition.when === group.scope).map((definition) => {
                      const binding = keybindingMap.get(definition.command) ?? DEFAULT_KEYBINDINGS.find((item) => item.command === definition.command)

                      if (!binding) {
                        return null
                      }

                      return (
                        <div
                          key={definition.command}
                          className="flex flex-wrap items-center justify-between gap-3 rounded-[1rem] border border-white/8 bg-black/20 px-4 py-3"
                        >
                          <div className="min-w-0 flex-1">
                            <p className="text-sm font-medium text-white">{definition.label}</p>
                            <p className="mt-1 text-[11px] uppercase tracking-[0.18em] text-[#7f8691]">{definition.command}</p>
                          </div>
                          <div className="flex flex-wrap items-center gap-2">
                            <button
                              type="button"
                              onClick={() => {
                                setCaptureMessage(null)
                                setEditingCommand(definition.command)
                              }}
                              className={`rounded-full border px-3 py-2 text-xs ${
                                editingCommand === definition.command
                                  ? 'border-[#e0ff00]/35 bg-[#e0ff00]/10 text-[#f5ffd5]'
                                  : 'border-white/10 bg-white/5 text-white'
                              }`}
                            >
                              {formatKeybinding(binding)}
                            </button>
                            <button
                              type="button"
                              onClick={() => void resetKeybinding(definition.command)}
                              className="inline-flex items-center gap-1 rounded-full border border-white/10 bg-white/5 px-3 py-2 text-xs text-white"
                            >
                              <RotateCcw size={12} />
                              Reset
                            </button>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              ))}
            </div>
          </section>
        </div>
      </section>
    </div>
  )
}

function InfoCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[1.25rem] border border-white/8 bg-[#111214] p-4">
      <p className="text-[11px] uppercase tracking-[0.22em] text-[#7f8691]">{label}</p>
      <p className="mt-3 break-all text-sm leading-6 text-white">{value}</p>
    </div>
  )
}
