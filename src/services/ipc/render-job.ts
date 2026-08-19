import type {
  FluxNodeProject,
  RenderJobStartResult,
  RenderJobStatus,
  RenderPreset,
} from '../../domain/project/types'
import { invokeCommand } from './tauri-commands'
import { isTauriRuntime } from './tauri-runtime'

/**
 * There is no browser-mode render or export: both need ffmpeg, which only the Rust backend has.
 * Every browser-mode IPC function in this module and in `export-job.ts` throws this SAME message
 * (rather than each inventing its own wording, or — worse — fabricating a fake success) so a
 * caller sees one consistent, accurate reason no matter which call it was that failed.
 */
export const RENDER_UNAVAILABLE_IN_BROWSER_MESSAGE =
  'Rendering and export run in the FluxNode desktop app — they are not available in browser preview mode.'

export async function startRenderJob(
  project: FluxNodeProject,
  preset: RenderPreset,
  jobId: string,
): Promise<RenderJobStartResult> {
  if (!isTauriRuntime()) {
    // No ffmpeg to hand this off to — refuse rather than returning a `RenderJobStartResult` that
    // names a job which will never actually render (see RENDER_UNAVAILABLE_IN_BROWSER_MESSAGE).
    throw new Error(RENDER_UNAVAILABLE_IN_BROWSER_MESSAGE)
  }

  const response = await invokeCommand<string>('render_start', {
    jobId,
    projectJson: JSON.stringify(project),
    presetJson: JSON.stringify(preset),
  })

  return JSON.parse(response) as RenderJobStartResult
}

export async function pollRenderJobStatus(jobId: string): Promise<RenderJobStatus> {
  if (!isTauriRuntime()) {
    // No status file to read — throwing (rather than reporting a fake `completed`) routes through
    // the caller's existing failure handling in `refreshRenderStatuses`, which turns a rejected
    // poll into a real `failed` status carrying this message, instead of a fabricated success.
    throw new Error(RENDER_UNAVAILABLE_IN_BROWSER_MESSAGE)
  }

  const response = await invokeCommand<string>('render_get_status', { jobId })
  return JSON.parse(response) as RenderJobStatus
}

export async function cancelRenderJob(jobId: string): Promise<void> {
  if (!isTauriRuntime()) {
    return
  }

  await invokeCommand('render_cancel', { jobId })
}

export async function pauseRenderJob(jobId: string): Promise<void> {
  if (!isTauriRuntime()) {
    return
  }

  await invokeCommand('render_pause', { jobId })
}

export async function resumeRenderJob(jobId: string): Promise<void> {
  if (!isTauriRuntime()) {
    return
  }

  await invokeCommand('render_resume', { jobId })
}

/**
 * `resolutionOverride`, when given, is what this retry attempt should ACTUALLY render at —
 * distinct from whatever resolution the job's original manifest was submitted with. Without it,
 * `render_retry` rebuilds the plan from that untouched original manifest every time, so a
 * GPU-OOM fallback that reduces `job.config.resolution` in the store (see
 * `scheduleRenderAutoRetry` in project-store.ts) would silently re-run the identical,
 * already-failing ffmpeg invocation. Sent as `null`, not omitted, when there is no override —
 * matches this codebase's `Option<T>` IPC convention (see e.g. `panel_window_open`'s `x`/`y`).
 */
export async function retryRenderJob(
  jobId: string,
  resumeFromCurrentFrame = true,
  resolutionOverride: { width: number; height: number } | null = null,
): Promise<void> {
  if (!isTauriRuntime()) {
    return
  }

  await invokeCommand('render_retry', {
    jobId,
    resumeFromCurrentFrame,
    resolutionOverrideWidth: resolutionOverride?.width ?? null,
    resolutionOverrideHeight: resolutionOverride?.height ?? null,
  })
}
