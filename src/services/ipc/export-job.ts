import type { ExportJobStartResult, FluxNodeProject, RenderPreset } from '../../domain/project/types'
import { isTauriRuntime } from './tauri-runtime'
import { invokeCommand } from './tauri-commands'
import { RENDER_UNAVAILABLE_IN_BROWSER_MESSAGE } from './render-job'

export async function startExportJob(
  project: FluxNodeProject,
  preset: RenderPreset,
  jobId: string,
): Promise<ExportJobStartResult> {
  if (!isTauriRuntime()) {
    // No project directory to write a manifest into — refuse rather than returning an
    // `ExportJobStartResult` that names a manifest which was never written (see
    // RENDER_UNAVAILABLE_IN_BROWSER_MESSAGE, shared with render-job.ts so every caller in the
    // enqueueRender handoff fails with the same accurate reason).
    throw new Error(RENDER_UNAVAILABLE_IN_BROWSER_MESSAGE)
  }

  const response = await invokeCommand<string>('start_export_job', {
    jobId,
    projectJson: JSON.stringify(project),
    presetJson: JSON.stringify(preset),
  })

  return JSON.parse(response) as ExportJobStartResult
}
