import { invokeCommand } from './tauri-commands'
import { isTauriRuntime } from './tauri-runtime'

/**
 * Invoke one Action Registry action by name.
 *
 * `allowWrites` is the write gate (`action::Registry::invoke`): left false, a `Mutating` /
 * `LongJob` action does not run and comes back as a `__fluxnode_proposal__` value instead.
 * Pass `allowWrites: true` ONLY to execute a proposal the user has explicitly approved — this is
 * step A5 of `docs/copilot-approve-gate-and-timeline-edits-scope.md`. There is deliberately no
 * session-wide "allow writes" switch: approval is per action, per invocation.
 */
export async function invokeAction<T>(
  name: string,
  args: Record<string, unknown>,
  options: { allowWrites?: boolean } = {},
): Promise<T> {
  if (!isTauriRuntime()) {
    throw new Error(`"${name}" runs in the FluxNode desktop app — it is not available in browser preview mode.`)
  }

  // Tauri maps camelCase command params to snake_case (`allowWrites` -> `allow_writes`); keys
  // inside the nested `args` object are passed through verbatim and must already be Rust-native.
  return invokeCommand<T>('action_invoke', {
    name,
    args,
    allowWrites: options.allowWrites ?? false,
  })
}
