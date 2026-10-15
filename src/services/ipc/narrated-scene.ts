import { invokeCommand } from './tauri-commands'
import { isTauriRuntime } from './tauri-runtime'

export interface NarratedSceneVoice {
  id: string
  name: string
  language: string
}

export interface NarratedSceneResult {
  runId: string
  imagePath: string
  audioPath: string
  comfyPromptId: string
  lalinJobId: string
  gpuUuid: string
  comfyFreeVramBeforeMb: number
  comfyFreeVramAfterMb: number
  lalinFreeVramBeforeMb: number
  lalinFreeVramAfterMb: number
  lalinReleaseStatus: string
  lalinModel: string | null
}

export interface NarratedSceneProgress {
  stage: string
  status: string
  message: string
}

export async function listNarratedSceneVoices(): Promise<NarratedSceneVoice[]> {
  if (!isTauriRuntime()) {
    throw new Error('Narrated scene generation is only available in the FluxNode desktop app.')
  }
  return invokeCommand<NarratedSceneVoice[]>('narrated_scene_list_voices')
}

export async function runNarratedScene(input: {
  imagePrompt: string
  narration: string
  voiceId: string
}): Promise<NarratedSceneResult> {
  if (!isTauriRuntime()) {
    throw new Error('Narrated scene generation is only available in the FluxNode desktop app.')
  }
  const response = await invokeCommand<string>('narrated_scene_run', {
    imagePrompt: input.imagePrompt,
    narration: input.narration,
    voiceId: input.voiceId,
  })
  return JSON.parse(response) as NarratedSceneResult
}
