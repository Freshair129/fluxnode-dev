import type {
  FluxNodeProject,
  RenderJobStartResult,
  RenderJobStatus,
  RenderPreset,
} from '../../domain/project/types'
import { invokeCommand } from './tauri-commands'
import { isTauriRuntime } from './tauri-runtime'

export async function startRenderJob(
  project: FluxNodeProject,
  preset: RenderPreset,
  jobId: string,
): Promise<RenderJobStartResult> {
  const totalFrames = Math.max(
    1,
    Math.round(
      ((project.timeline.outPoint ?? getTimelineEnd(project)) - (project.timeline.inPoint ?? 0)) *
        project.settings.frameRate,
    ),
  )
  const outputExtension = preset.format === 'png_sequence' ? 'zip' : preset.format
  const outputPath = `${project.output.exportDefaults.outputDirectory}/${project.meta.id}-${jobId}.${outputExtension}`
  const startedAt = new Date().toISOString()

  if (!isTauriRuntime()) {
    return {
      jobId,
      outputPath,
      manifestPath: `browser-local://${jobId}.render.json`,
      statusPath: `browser-local://${jobId}.status.json`,
      startedAt,
      totalFrames,
    }
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
    const now = new Date().toISOString()
    return {
      jobId,
      status: 'completed',
      progress: 100,
      currentFrame: 100,
      totalFrames: 100,
      updatedAt: now,
      completedAt: now,
      estimatedTimeRemaining: 0,
      outputPath: `browser-local://${jobId}.mp4`,
      outputFileSize: 1_048_576,
      error: null,
    }
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

export async function retryRenderJob(jobId: string, resumeFromCurrentFrame = true): Promise<void> {
  if (!isTauriRuntime()) {
    return
  }

  await invokeCommand('render_retry', {
    jobId,
    resumeFromCurrentFrame,
  })
}

function getTimelineEnd(project: FluxNodeProject) {
  return Math.max(
    ...project.timeline.tracks.flatMap((track) => track.clips.map((clip) => clip.startTime + clip.duration)),
    0,
  )
}
