import { FolderOpen, Layers3, WandSparkles, X } from 'lucide-react'
import { useEffect } from 'react'
import { pickProjectDirectory } from '../../services/ipc/file-dialog'
import type { ProjectTemplateId } from '../../domain/project/defaults'
import { useProjectStore } from '../../store/project-store'
import { useModalA11y } from '../settings/useModalA11y'

const templates = [
  {
    id: 'quick-edit' as ProjectTemplateId,
    name: 'Quick Edit',
    description: 'Timeline-first cut with linked video and audio clips.',
    icon: FolderOpen,
  },
  {
    id: 'ai-workflow' as ProjectTemplateId,
    name: 'AI Workflow',
    description: 'Node graph starter wired for media, grading, AI upscale, and output.',
    icon: WandSparkles,
  },
  {
    id: 'shader-fx' as ProjectTemplateId,
    name: 'Shader FX',
    description: 'Effect stack foundation with shader and color finishing nodes.',
    icon: Layers3,
  },
]

export function WelcomeModal() {
  const dismissWelcome = useProjectStore((state) => state.dismissWelcome)
  const applyTemplate = useProjectStore((state) => state.applyTemplate)
  const recentProjects = useProjectStore((state) => state.recentProjects)
  const openProjectFromPath = useProjectStore((state) => state.openProjectFromPath)
  const preferences = useProjectStore((state) => state.preferences)
  const runtimeHealth = useProjectStore((state) => state.runtimeHealth)
  const setDefaultProjectDirectory = useProjectStore((state) => state.setDefaultProjectDirectory)
  const openSettings = useProjectStore((state) => state.openSettings)
  const dialogRef = useModalA11y<HTMLElement>()
  const localComputeReady = runtimeHealth.status !== 'degraded'
  const localComputeTone = localComputeReady ? 'border-emerald-400/20 bg-emerald-500/10 text-emerald-50' : 'border-amber-300/20 bg-amber-500/10 text-amber-50'

  async function handleChooseDefaultDirectory() {
    const path = await pickProjectDirectory(preferences.defaultProjectDirectory)

    if (path) {
      await setDefaultProjectDirectory(path)
    }
  }

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.preventDefault()
        dismissWelcome()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [dismissWelcome])

  return (
    <div className="absolute inset-0 z-20 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
      <section
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="welcome-modal-title"
        tabIndex={-1}
        className="w-full max-w-4xl rounded-[2rem] border border-white/10 bg-[#101112] p-6 shadow-[0_30px_120px_rgba(0,0,0,0.5)] outline-none"
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-[11px] uppercase tracking-[0.35em] text-[#e0ff00]">Welcome to FluxNode</p>
            <h2 id="welcome-modal-title" className="mt-2 font-display text-3xl font-semibold tracking-tight text-white">
              Timeline speed, workflow depth, one shared project model.
            </h2>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-[#9ca3af]">
              Quick setup now covers the MVP desktop path: choose a default project directory, confirm local compute readiness, and start from a template or recent project.
            </p>
          </div>
          <button
            type="button"
            onClick={dismissWelcome}
            aria-label="Close welcome modal"
            className="inline-flex h-11 w-11 items-center justify-center rounded-full border border-white/10 bg-white/5 text-white"
          >
            <X size={18} />
          </button>
        </div>

        <div className="mt-6 rounded-[1.5rem] border border-white/10 bg-black/20 p-5">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="max-w-2xl">
              <p className="text-[11px] uppercase tracking-[0.28em] text-[#7f8691]">Quick Setup</p>
              <p className="mt-3 text-sm leading-6 text-[#9ca3af]">
                Choose where FluxNode should start its project pickers, then check whether local compute can use the desktop runtime.
              </p>
              <p className="mt-3 break-all text-sm leading-6 text-white">
                {preferences.defaultProjectDirectory ?? 'Default project directory not configured yet'}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => void handleChooseDefaultDirectory()}
                className="rounded-full bg-[#e0ff00] px-4 py-2 text-sm font-semibold text-black transition hover:brightness-95"
              >
                Choose Default Directory
              </button>
            </div>
          </div>
          <div className="mt-4 grid gap-3 md:grid-cols-2">
            <div className="rounded-[1.1rem] border border-white/8 bg-white/[0.03] px-4 py-3">
              <p className="text-[11px] uppercase tracking-[0.22em] text-[#7f8691]">Desktop Runtime</p>
              <p className="mt-2 text-sm text-white">{runtimeHealth.backend}</p>
              <p className="mt-2 text-xs text-[#9ca3af]">Health {runtimeHealth.status}</p>
            </div>
            <div className="rounded-[1.1rem] border border-white/8 bg-white/[0.03] px-4 py-3">
              <p className="text-[11px] uppercase tracking-[0.22em] text-[#7f8691]">Local Compute Guide</p>
              <div aria-live="polite" className={`mt-2 rounded-[0.9rem] border px-3 py-2 text-xs ${localComputeTone}`}>
                {localComputeReady ? 'ComfyUI-ready path detected for local workflows.' : 'ComfyUI is not ready yet. Local compute needs setup or recovery.'}
              </div>
              <p className="mt-3 text-sm leading-6 text-white">
                Target endpoint: {preferences.comfyUiEndpoint}
              </p>
              <ol className="mt-3 space-y-2 text-sm leading-6 text-[#cbd2dc]">
                <li>1. Install or open ComfyUI on this machine.</li>
                <li>2. Start the server and keep it listening on the endpoint above.</li>
                <li>3. Return to FluxNode and use local compute for offline workflows.</li>
              </ol>
              {!localComputeReady ? (
                <div className="mt-4 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={openSettings}
                    className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm text-white"
                  >
                    Open Settings
                  </button>
                </div>
              ) : null}
            </div>
          </div>
        </div>

        <div className="mt-6 grid gap-4 md:grid-cols-3">
          {templates.map((template) => {
            const Icon = template.icon

            return (
              <article
                key={template.name}
                className="rounded-[1.5rem] border border-white/10 bg-[linear-gradient(180deg,rgba(255,255,255,0.05),rgba(255,255,255,0.02))] p-5"
              >
                <Icon size={20} className="text-[#e0ff00]" />
                <h3 className="mt-4 text-lg font-semibold text-white">{template.name}</h3>
                <p className="mt-2 text-sm leading-6 text-[#9ca3af]">{template.description}</p>
                <button
                  type="button"
                  onClick={() => void applyTemplate(template.id)}
                  className="mt-5 rounded-full bg-[#e0ff00] px-4 py-2 text-sm font-semibold text-black transition hover:brightness-95"
                >
                  Start Template
                </button>
              </article>
            )
          })}
        </div>

        {recentProjects.length > 0 ? (
          <div className="mt-6 rounded-[1.5rem] border border-white/10 bg-black/20 p-5">
            <p className="text-[11px] uppercase tracking-[0.28em] text-[#7f8691]">Recent Projects</p>
            <div className="mt-4 grid gap-3 md:grid-cols-2">
              {recentProjects.slice(0, 4).map((project) => (
                <button
                  key={project.path}
                  type="button"
                  onClick={() => void openProjectFromPath(project.path)}
                  className="rounded-[1.1rem] border border-white/8 bg-white/[0.03] px-4 py-3 text-left transition hover:border-[#e0ff00]/25"
                >
                  <div className="flex gap-3">
                    <div className="flex h-14 w-20 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-white/8 bg-[#111214]">
                      {project.thumbnailPath ? (
                        <img
                          src={project.thumbnailPath}
                          alt={project.name}
                          className="h-full w-full object-cover"
                        />
                      ) : (
                        <span className="text-[10px] uppercase tracking-[0.2em] text-[#7f8691]">No Thumb</span>
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold text-white">{project.name}</p>
                      <p className="mt-1 text-xs text-[#9ca3af]">{new Date(project.lastOpened).toLocaleString()}</p>
                      <p className="mt-2 break-all text-[11px] leading-5 text-[#7f8691]">{project.path}</p>
                    </div>
                  </div>
                </button>
              ))}
            </div>
          </div>
        ) : null}

        <div className="mt-6 flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={dismissWelcome}
            className="rounded-full bg-[#e0ff00] px-5 py-3 text-sm font-semibold text-black transition hover:brightness-95"
          >
            Continue Current Project
          </button>
          <span className="text-xs text-[#7f8691]">Template selection now creates ready-to-edit project shapes backed by the shared FluxNode store.</span>
        </div>
      </section>
    </div>
  )
}
