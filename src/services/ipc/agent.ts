import type { Proposal } from '../../domain/copilot/proposals'
import { invokeCommand } from './tauri-commands'
import { isTauriRuntime } from './tauri-runtime'

/** Mirrors the Rust `AgentOutcome` returned by the `agent_chat` command. */
export interface AgentOutcome {
  answer: string
  proposals: Proposal[]
}

/**
 * Run one copilot turn. The agent loop never executes gated actions — it returns them as
 * `proposals` for the user to approve (see the approve-gate scope). `allowWrites` stays false in
 * the interactive path; the gate *is* the approval UX.
 */
export async function runAgentChat(
  message: string,
  options: { model?: string; allowWrites?: boolean } = {},
): Promise<AgentOutcome> {
  if (!isTauriRuntime()) {
    return {
      answer: 'The copilot runs in the FluxNode desktop app — it is not available in browser preview mode.',
      proposals: [],
    }
  }

  return invokeCommand<AgentOutcome>('agent_chat', {
    message,
    model: options.model,
    allowWrites: options.allowWrites ?? false,
  })
}
