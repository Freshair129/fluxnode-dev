import { useMemo, useState } from 'react'
import { useProjectStore } from '../../store/project-store'
import { runAgentChat } from '../../services/ipc/agent'
import {
  applyProposalsToProject,
  isSupportedFrontendProposal,
  summarizeProposal,
  type Proposal,
} from '../../domain/copilot/proposals'
import { isRoughCutIntent, planSilenceCuts } from '../../domain/copilot/rough-cut'
import { transcribeAudio } from '../../services/ipc/transcribe'

/**
 * Slice-1 copilot surface: send a message to the agent, review the gated proposals it returns as
 * ghost edits, and approve them into the timeline as one undoable step (`applyCopilotProposals`).
 * The agent never mutates the project directly — it can only propose (see the approve-gate scope).
 */
export function CopilotPanel({ onClose }: { onClose: () => void }) {
  const project = useProjectStore((state) => state.project)
  const applyCopilotProposals = useProjectStore((state) => state.applyCopilotProposals)

  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [answer, setAnswer] = useState<string | null>(null)
  const [proposals, setProposals] = useState<Proposal[]>([])
  const [error, setError] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)

  const supported = useMemo(() => proposals.filter(isSupportedFrontendProposal), [proposals])
  const unsupported = useMemo(() => proposals.filter((p) => !isSupportedFrontendProposal(p)), [proposals])

  // Textual ghost preview: the clip-count delta per affected track, computed with the SAME op logic
  // the executor uses, so what you see is exactly what approval produces.
  const ghost = useMemo(() => {
    if (supported.length === 0) return []
    const after = applyProposalsToProject(project, supported)
    return project.timeline.tracks
      .map((before) => {
        const a = after.timeline.tracks.find((t) => t.id === before.id)
        if (!a || a.clips.length === before.clips.length) return null
        return { name: before.name, before: before.clips.length, after: a.clips.length }
      })
      .filter((x): x is { name: string; before: number; after: number } => x !== null)
  }, [project, supported])

  async function send() {
    const message = input.trim()
    if (!message || busy) return
    // "cut the silences" and friends run the deterministic rough-cut, not the LLM.
    if (isRoughCutIntent(message)) {
      setInput('')
      await roughCut()
      return
    }
    setBusy(true)
    setError(null)
    setNote(null)
    setAnswer(null)
    setProposals([])
    try {
      const outcome = await runAgentChat(message)
      setAnswer(outcome.answer)
      setProposals(outcome.proposals)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  function approve() {
    if (supported.length === 0) return
    applyCopilotProposals(supported)
    setNote(`Applied ${supported.length} edit${supported.length === 1 ? '' : 's'} as one undo step.`)
    setProposals([])
  }

  function reject() {
    setProposals([])
    setNote('Proposals dismissed.')
  }

  // The rough-cut concierge: transcribe the first track's clip, plan the silence cuts
  // deterministically (planSilenceCuts), and surface them as proposals — same review/ghost/approve
  // path as any other edit. No LLM reasoning composes the plan, so it stays reliable at scale.
  async function roughCut() {
    if (busy) return
    setBusy(true)
    setError(null)
    setNote(null)
    setAnswer(null)
    setProposals([])
    try {
      const track = project.timeline.tracks.find((t) => t.clips.length > 0)
      if (!track) {
        setError('No clips on the timeline to rough-cut.')
        return
      }
      const firstClip = track.clips[0]
      const asset = project.assets.assets[firstClip.assetId]
      const transcript = await transcribeAudio(asset?.sourcePath ?? firstClip.assetId)
      const plan = planSilenceCuts(track, transcript)
      if (plan.length === 0) {
        setAnswer(`Transcribed "${track.name}" — no silences long enough to cut.`)
        return
      }
      setAnswer(`Found ${plan.length} silence${plan.length === 1 ? '' : 's'} to cut on "${track.name}". Review and approve below.`)
      setProposals(plan)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <section
      aria-label="FluxNode copilot"
      className="fixed bottom-4 right-4 z-40 flex max-h-[70vh] w-[22rem] flex-col overflow-hidden rounded-2xl border border-white/10 bg-[#111214]/95 text-white shadow-[0_24px_80px_rgba(0,0,0,0.55)] backdrop-blur-xl"
    >
      <header className="flex items-center justify-between border-b border-white/10 px-4 py-3">
        <span className="text-sm font-semibold tracking-tight">
          Copilot <span className="text-[#e0ff00]">·</span> propose &amp; approve
        </span>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close copilot"
          className="rounded-md px-2 py-1 text-xs text-[#9ca3af] transition hover:bg-white/5 hover:text-white"
        >
          ✕
        </button>
      </header>

      <div className="flex-1 space-y-3 overflow-y-auto px-4 py-3 text-sm">
        {answer ? <p className="whitespace-pre-wrap text-[#d1d5db]">{answer}</p> : null}
        {error ? <p className="rounded-lg bg-red-500/10 px-3 py-2 text-red-300">{error}</p> : null}
        {note ? <p className="rounded-lg bg-[#e0ff00]/10 px-3 py-2 text-[#e0ff00]">{note}</p> : null}

        {supported.length > 0 ? (
          <div className="rounded-xl border border-[#e0ff00]/30 bg-black/30 p-3">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-[#e0ff00]">
              {supported.length} proposed edit{supported.length === 1 ? '' : 's'}
            </p>
            <ul className="space-y-1.5">
              {supported.map((p, i) => (
                <li key={i} className="text-[#d1d5db]">
                  • {summarizeProposal(p, project)}
                </li>
              ))}
            </ul>
            {ghost.length > 0 ? (
              <div className="mt-2 border-t border-white/10 pt-2 text-xs text-[#9ca3af]">
                {ghost.map((g) => (
                  <div key={g.name}>
                    {g.name}: {g.before} → {g.after} clips
                  </div>
                ))}
              </div>
            ) : null}
            <div className="mt-3 flex gap-2">
              <button
                type="button"
                onClick={approve}
                className="rounded-lg bg-[#e0ff00] px-3 py-1.5 text-xs font-semibold text-black transition hover:brightness-110"
              >
                Approve &amp; apply
              </button>
              <button
                type="button"
                onClick={reject}
                className="rounded-lg border border-white/15 px-3 py-1.5 text-xs text-[#d1d5db] transition hover:bg-white/5"
              >
                Reject
              </button>
            </div>
          </div>
        ) : null}

        {unsupported.length > 0 ? (
          <div className="rounded-xl border border-white/10 bg-black/20 p-3 text-xs text-[#9ca3af]">
            {unsupported.length} other proposal{unsupported.length === 1 ? '' : 's'} require approval but
            aren’t materializable in this build yet:
            <ul className="mt-1 space-y-1">
              {unsupported.map((p, i) => (
                <li key={i}>• {summarizeProposal(p, project)}</li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>

      <div className="border-t border-white/10 p-3">
        <button
          type="button"
          onClick={() => void roughCut()}
          disabled={busy}
          className="mb-2 w-full rounded-lg border border-[#e0ff00]/30 bg-[#e0ff00]/5 px-3 py-1.5 text-xs font-semibold text-[#e0ff00] transition enabled:hover:bg-[#e0ff00]/10 disabled:cursor-not-allowed disabled:opacity-40"
        >
          ✂ Rough-cut silences
        </button>
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              void send()
            }
          }}
          rows={2}
          placeholder="e.g. remove 2s–4s on the first track and ripple"
          className="w-full resize-none rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-sm text-white placeholder:text-[#6b7280] focus:border-[#e0ff00]/50 focus:outline-none"
        />
        <div className="mt-2 flex justify-end">
          <button
            type="button"
            onClick={() => void send()}
            disabled={busy || input.trim().length === 0}
            className="rounded-lg bg-[#3b82f6] px-4 py-1.5 text-xs font-semibold text-white transition enabled:hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {busy ? 'Thinking…' : 'Send'}
          </button>
        </div>
      </div>
    </section>
  )
}
