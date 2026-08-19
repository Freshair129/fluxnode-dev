import { useEffect, useState } from 'react'
import { useProjectStore } from '../../store/project-store'
import { runAgentChat } from '../../services/ipc/agent'
import { partitionProposals, type Proposal } from '../../domain/copilot/proposals'
import { isRoughCutIntent, planSilenceCuts } from '../../domain/copilot/rough-cut'
import { transcribeAudio } from '../../services/ipc/transcribe'
import { ProposalReview } from './ProposalReview'

/**
 * Copilot surface: send a message to the agent, review the gated proposals it returns, and
 * approve them — timeline edits into the store as one undoable step, backend actions back through
 * the registry with writes allowed (approve-gate step A5). The agent never mutates anything
 * directly: `Registry::invoke` only ever hands back a proposal, and nothing here runs without an
 * explicit per-batch (frontend) or per-action (backend) approval.
 */
export function CopilotPanel({ onClose }: { onClose: () => void }) {
  const project = useProjectStore((state) => state.project)
  const approveCopilotProposals = useProjectStore((state) => state.approveCopilotProposals)
  // Proposals live in the store so the timeline can render ghost edits from them.
  const proposals = useProjectStore((state) => state.copilotProposals)
  const setProposals = useProjectStore((state) => state.setCopilotProposals)
  const outcomes = useProjectStore((state) => state.copilotOutcomes)
  const resetCopilotSession = useProjectStore((state) => state.resetCopilotSession)

  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [answer, setAnswer] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)

  // Clear the ghost preview when the copilot closes.
  useEffect(() => () => resetCopilotSession(), [resetCopilotSession])

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
    resetCopilotSession()
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

  /** Approve every timeline edit at once — one approval, one undo step. Backend actions and
   *  unsupported proposals stay pending so they can be dealt with individually. */
  async function approveFrontend() {
    const { frontend, backend, unsupported } = partitionProposals(proposals)
    if (frontend.length === 0 || busy) return
    setBusy(true)
    setError(null)
    try {
      await approveCopilotProposals(frontend)
      setNote(`Applied ${frontend.length} edit${frontend.length === 1 ? '' : 's'} as one undo step.`)
      setProposals([...backend, ...unsupported])
    } finally {
      setBusy(false)
    }
  }

  /** Run ONE approved backend action. Deliberately per-action: these are real, non-undoable
   *  side effects, so there is no bulk approve and no session-wide writes toggle. */
  async function runBackend(proposal: Proposal) {
    if (busy) return
    setBusy(true)
    setError(null)
    setNote(null)
    try {
      await approveCopilotProposals([proposal])
      setProposals(proposals.filter((pending) => pending !== proposal))
    } finally {
      setBusy(false)
    }
  }

  function reject() {
    resetCopilotSession()
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
    resetCopilotSession()
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

        <ProposalReview
          proposals={proposals}
          project={project}
          outcomes={outcomes}
          busy={busy}
          onApproveFrontend={() => void approveFrontend()}
          onRunBackend={(proposal) => void runBackend(proposal)}
          onReject={reject}
        />
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
