import type { ExportJobStartResult, FluxNodeProject, RenderPreset } from '../../domain/project/types'
import { isTauriRuntime } from './tauri-runtime'
import { invokeCommand } from './tauri-commands'

export async function startExportJob(
  project: FluxNodeProject,
  preset: RenderPreset,
  jobId: string,
): Promise<ExportJobStartResult> {
  const outputExtension = preset.format === 'png_sequence' ? 'zip' : preset.format
  const outputPath = `${project.output.exportDefaults.outputDirectory}/${project.meta.id}-${jobId}.${outputExtension}`
  const startedAt = new Date().toISOString()

  if (!isTauriRuntime()) {
    return {
      manifestPath: `browser-local://${jobId}.export.json`,
      outputPath,
      exportDirectory: project.output.exportDefaults.outputDirectory,
      startedAt,
    }
  }

  const response = await invokeCommand<string>('start_export_job', {
    jobId,
    projectJson: JSON.stringify(project),
    presetJson: JSON.stringify(preset),
  })

  return JSON.parse(response) as ExportJobStartResult
}
