import { listen } from '@tauri-apps/api/event'
import { AlertTriangle, AudioLines, Check, Clapperboard, ExternalLink, Image as ImageIcon, LoaderCircle, Sparkles, X } from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'
import { DrawerShell } from '../status/drawers/DrawerShell'
import { canOpenPathInShell } from '../../services/ipc/app-shell'
import {
  listNarratedSceneVoices,
  runNarratedScene,
  type NarratedSceneProgress,
  type NarratedSceneResult,
  type NarratedSceneVoice,
} from '../../services/ipc/narrated-scene'
import { useProjectStore } from '../../store/project-store'

const SAMPLE_IMAGE_PROMPT = 'A small lantern boat crossing a quiet river in northern Thailand at blue hour, warm reflections, cinematic composition, no text'
const SAMPLE_NARRATION = 'เมื่อแสงสุดท้ายแตะผิวน้ำ เรือโคมไฟลำเล็กก็เริ่มออกเดินทาง'

export function NarratedSceneModal({ onClose }: { onClose: () => void }) {
  const projectId = useProjectStore((state) => state.project.meta.id)
  const projectName = useProjectStore((state) => state.project.meta.name)
  const projectPath = useProjectStore((state) => state.ui.currentProjectPath)
  const openRenderOutput = useProjectStore((state) => state.openRenderOutput)
  const [selectedRenderJobId, setSelectedRenderJobId] = useState<string | null>(null)
  const renderJob = useProjectStore((state) =>
    selectedRenderJobId ? state.project.output.queue.find((job) => job.id === selectedRenderJobId) : undefined,
  )

  const [voices, setVoices] = useState<NarratedSceneVoice[]>([])
  const [voiceId, setVoiceId] = useState('')
  const [imagePrompt, setImagePrompt] = useState(SAMPLE_IMAGE_PROMPT)
  const [narration, setNarration] = useState(SAMPLE_NARRATION)
  const [progress, setProgress] = useState<NarratedSceneProgress>({
    stage: 'ready',
    status: 'idle',
    message: 'Choose a saved Lalin voice profile and edit the scene text.',
  })
  const [scene, setScene] = useState<NarratedSceneResult | null>(null)
  const [busy, setBusy] = useState(false)
  const [voiceError, setVoiceError] = useState<string | null>(null)
  const [workflowError, setWorkflowError] = useState<string | null>(null)
  const [exportWarning, setExportWarning] = useState<string | null>(null)

  useEffect(() => {
    let disposed = false
    let unlisten: (() => void) | undefined

    void listen<NarratedSceneProgress>('narrated-scene-progress', (event) => {
      if (!disposed) setProgress(event.payload)
    })
      .then((stopListening) => {
        if (disposed) stopListening()
        else unlisten = stopListening
      })
      .catch((error: unknown) => {
        if (!disposed) setVoiceError(errorMessage(error))
      })

    void listNarratedSceneVoices()
      .then((availableVoices) => {
        if (disposed) return
        setVoices(availableVoices)
        if (availableVoices.length > 0) setVoiceId(availableVoices[0].id)
      })
      .catch((error: unknown) => {
        if (!disposed) setVoiceError(errorMessage(error))
      })

    return () => {
      disposed = true
      unlisten?.()
    }
  }, [])

  async function handleGenerate() {
    if (busy || !projectPath || !voiceId) return
    setBusy(true)
    setScene(null)
    setSelectedRenderJobId(null)
    setWorkflowError(null)
    setExportWarning(null)
    setProgress({ stage: 'preflight', status: 'running', message: 'Checking Comfy, Lalin, queues, and the shared GPU lease.' })
    try {
      const generated = await runNarratedScene({ imagePrompt, narration, voiceId })
      setScene(generated)
      setProgress({ stage: 'project', status: 'running', message: 'Copying the PNG and WAV into the saved project, then queueing the CPU MP4 export.' })
      const jobId = await useProjectStore.getState().materializeNarratedScene(generated, projectId)
      if (jobId) {
        setSelectedRenderJobId(jobId)
        setProgress({ stage: 'export', status: 'queued', message: 'Image and narration are on the timeline. CPU H.264 MP4 export is queued.' })
      } else {
        setExportWarning('The image and narration were added to the project, but FluxNode did not start the automatic MP4 export. Check the Export queue for the validation error.')
        setProgress({ stage: 'project', status: 'done', message: 'Generated media was saved into the project timeline.' })
      }
    } catch (error) {
      const message = errorMessage(error)
      setWorkflowError(message)
      setProgress({ stage: 'stopped', status: 'error', message })
    } finally {
      setBusy(false)
    }
  }

  const close = () => {
    if (!busy) onClose()
  }

  return (
    <DrawerShell icon={Clapperboard} title="Narrated Scene" onClose={close} widthClassName="w-full max-w-2xl">
      <div className="space-y-4">
        <p className="text-sm leading-6 text-[#cbd2dc]">
          Generate one Qwen image in Comfy Desktop, release its model, create Thai narration in Lalin, then save both clips into this project and render a CPU H.264 MP4.
        </p>
        <section aria-label="Current project" className="rounded-xl border border-white/8 bg-black/20 p-3">
          <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[#858d99]">Project</div>
          <div className="mt-1 truncate text-sm text-white" title={projectPath ?? projectName}>{projectName}</div>
          {projectPath ? <div className="mt-1 truncate text-xs text-[#858d99]" title={projectPath}>{projectPath}</div> : null}
          {!projectPath ? <div className="mt-2 text-xs text-amber-200">Save this project before generating so the PNG and WAV have a durable home.</div> : null}
        </section>

        <label className="block space-y-2">
          <span className="text-xs font-medium text-[#e5e7eb]">Image prompt</span>
          <textarea
            value={imagePrompt}
            onChange={(event) => setImagePrompt(event.target.value)}
            disabled={busy}
            maxLength={4000}
            rows={3}
            className="w-full resize-y rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm leading-5 text-white outline-none focus:border-[#e0ff00]/50 disabled:opacity-60"
          />
        </label>

        <label className="block space-y-2">
          <span className="text-xs font-medium text-[#e5e7eb]">Thai narration</span>
          <textarea
            value={narration}
            onChange={(event) => setNarration(event.target.value)}
            disabled={busy}
            maxLength={8000}
            rows={3}
            className="w-full resize-y rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm leading-5 text-white outline-none focus:border-[#e0ff00]/50 disabled:opacity-60"
          />
        </label>

        <label className="block space-y-2">
          <span className="text-xs font-medium text-[#e5e7eb]">Lalin voice</span>
          <select
            value={voiceId}
            onChange={(event) => setVoiceId(event.target.value)}
            disabled={busy || voices.length === 0}
            className="w-full rounded-xl border border-white/10 bg-[#151618] px-3 py-2.5 text-sm text-white outline-none focus:border-[#e0ff00]/50 disabled:opacity-60"
          >
            {voices.length === 0 ? <option value="">No saved voices available</option> : null}
            {voices.map((voice) => <option key={voice.id} value={voice.id}>{voice.name} · {voice.language}</option>)}
          </select>
        </label>

        {voiceError ? <InlineNotice tone="error" icon={<AlertTriangle size={15} />} message={`Could not load Lalin voices: ${voiceError}`} /> : null}
        {workflowError ? <InlineNotice tone="error" icon={<AlertTriangle size={15} />} message={workflowError} /> : null}
        {exportWarning ? <InlineNotice tone="warning" icon={<AlertTriangle size={15} />} message={exportWarning} /> : null}

        <section aria-live="polite" aria-label="Workflow status" className="rounded-xl border border-white/8 bg-[#151618]/90 p-3">
          <div className="flex items-start gap-3">
            {busy ? <LoaderCircle size={17} className="mt-0.5 animate-spin text-[#e0ff00]" aria-hidden="true" /> : progress.status === 'done' || progress.status === 'queued' ? <Check size={17} className="mt-0.5 text-emerald-300" aria-hidden="true" /> : <Sparkles size={17} className="mt-0.5 text-[#e0ff00]" aria-hidden="true" />}
            <div className="min-w-0 flex-1">
              <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[#858d99]">{progress.stage} · {progress.status}</div>
              <p className="mt-1 text-sm leading-5 text-[#e5e7eb]">{progress.message}</p>
            </div>
          </div>
        </section>

        {scene ? (
          <section aria-label="Generated outputs" className="space-y-2 rounded-xl border border-white/8 bg-black/20 p-3">
            <div className="flex items-center gap-2 text-xs font-semibold text-white"><ImageIcon size={14} className="text-[#e0ff00]" /> Image and narration saved</div>
            <p className="break-all text-[11px] leading-5 text-[#a8b0bc]">Image: {scene.imagePath}</p>
            <p className="break-all text-[11px] leading-5 text-[#a8b0bc]">WAV: {scene.audioPath}</p>
            <p className="break-all text-[11px] leading-5 text-[#7f8792]">Comfy prompt {scene.comfyPromptId} · Lalin job {scene.lalinJobId} · run {scene.runId}</p>
            <div className="grid gap-2 text-[11px] leading-5 text-[#a8b0bc] sm:grid-cols-2">
              <div className="flex items-center gap-1.5"><ImageIcon size={12} /> Comfy VRAM {scene.comfyFreeVramBeforeMb} → {scene.comfyFreeVramAfterMb} MiB free</div>
              <div className="flex items-center gap-1.5"><AudioLines size={12} /> Lalin VRAM {scene.lalinFreeVramBeforeMb} → {scene.lalinFreeVramAfterMb} MiB free</div>
            </div>
            <p className="text-[11px] text-emerald-200">Lalin release receipt: {scene.lalinReleaseStatus}{scene.lalinModel ? ` · ${scene.lalinModel}` : ''}</p>
          </section>
        ) : null}

        {renderJob ? (
          <section aria-label="MP4 export status" className="rounded-xl border border-white/8 bg-black/20 p-3">
            <div className="flex items-center justify-between gap-2">
              <div className="text-xs font-semibold text-white">MP4 export · {renderJob.status}</div>
              <div className="text-xs tabular-nums text-[#9ca3af]">{Math.round(renderJob.progress)}%</div>
            </div>
            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/10">
              <div className="h-full bg-[#e0ff00] transition-[width]" style={{ width: `${Math.max(0, Math.min(100, renderJob.progress))}%` }} />
            </div>
            <p className="mt-2 break-all text-[11px] text-[#858d99]">{renderJob.outputPath}</p>
            {renderJob.lastError ? <p className="mt-2 text-xs text-rose-200">{renderJob.lastError}</p> : null}
            {renderJob.status === 'completed' && canOpenPathInShell(renderJob.outputPath) ? (
              <button type="button" onClick={() => void openRenderOutput(renderJob.id)} className="mt-3 inline-flex items-center gap-2 rounded-full bg-emerald-500/15 px-3 py-2 text-xs font-medium text-emerald-100 hover:bg-emerald-500/25">
                <ExternalLink size={13} /> Open MP4
              </button>
            ) : null}
          </section>
        ) : null}

        <div className="flex justify-end gap-2 border-t border-white/8 pt-4">
          <button type="button" onClick={close} disabled={busy} className="inline-flex items-center gap-1.5 rounded-full border border-white/10 px-4 py-2 text-sm text-white disabled:cursor-not-allowed disabled:opacity-50">
            <X size={14} /> {busy ? 'Workflow running' : 'Close'}
          </button>
          <button
            type="button"
            onClick={() => void handleGenerate()}
            disabled={busy || !projectPath || !voiceId || !imagePrompt.trim() || !narration.trim()}
            className="inline-flex items-center gap-2 rounded-full bg-[#e0ff00] px-4 py-2 text-sm font-semibold text-black transition hover:brightness-95 disabled:cursor-not-allowed disabled:opacity-45"
          >
            <Sparkles size={14} /> {busy ? 'Working…' : scene ? 'Generate another' : 'Generate scene + MP4'}
          </button>
        </div>
        <p className="text-[10px] leading-4 text-[#7f8792]">
          GPU leases coordinate clients that use the Hub. Other local programs can still allocate GPU memory outside this cooperative lease.
        </p>
      </div>
    </DrawerShell>
  )
}

function InlineNotice({ message, tone, icon }: { message: string; tone: 'error' | 'warning'; icon: ReactNode }) {
  return (
    <div role="alert" className={`flex items-start gap-2 rounded-xl border p-3 text-xs leading-5 ${tone === 'error' ? 'border-rose-400/20 bg-rose-500/10 text-rose-100' : 'border-amber-400/20 bg-amber-500/10 text-amber-100'}`}>
      <span className="mt-0.5 shrink-0">{icon}</span><span className="min-w-0 break-words">{message}</span>
    </div>
  )
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  if (typeof error === 'string') return error
  return 'An unexpected error stopped the narrated-scene workflow.'
}
