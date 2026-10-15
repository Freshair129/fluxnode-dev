import { createServer } from 'vite'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url))
const projectRoot = path.resolve(scriptDirectory, '../..')
const outputDirectory = path.resolve(process.argv[2])
const now = '2026-10-15T00:00:00.000Z'

const vite = await createServer({
  root: projectRoot,
  configFile: path.join(projectRoot, 'vite.config.ts'),
  appType: 'custom',
  logLevel: 'silent',
  server: { middlewareMode: true },
})

try {
  const { createDefaultProject } = await vite.ssrLoadModule('/src/domain/project/defaults.ts')
  const project = createDefaultProject()

  project.meta.id = 'fluxnode-native-acceptance'
  project.meta.name = 'FluxNode native acceptance fixture'
  project.meta.createdAt = now
  project.meta.updatedAt = now
  project.meta.thumbnailPath = null
  project.meta.sharing.workspaceId = `workspace-${project.meta.id}`
  project.settings = {
    ...project.settings,
    resolution: { width: 160, height: 120 },
    frameRate: 5,
  }
  project.assets = { assets: {} }
  project.timeline = {
    ...project.timeline,
    tracks: [],
    playhead: 0,
    inPoint: null,
    outPoint: null,
    zoom: 1,
    scrollX: 0,
  }
  project.workflow = {
    ...project.workflow,
    nodes: [
      {
        id: 'fixture-ai-generate',
        type: 'ai_generate',
        position: { x: 0, y: 0 },
        data: {
          computeSource: 'project',
          model: 'fixture-checkpoint.safetensors',
          prompt: 'fixture only',
          negativePrompt: '',
          steps: 1,
          width: 64,
          height: 64,
        },
        collapsed: false,
        bypassed: false,
        executionError: null,
        label: 'Fixture AI Generate',
      },
    ],
    groups: [],
    edges: [],
    viewport: { x: 0, y: 0, zoom: 1 },
    computeMode: 'local',
  }
  project.output = {
    ...project.output,
    activePresetId: 'fixture-mpeg4',
    queue: [],
    exportDefaults: {
      ...project.output.exportDefaults,
      outputDirectory,
      useProxyRenders: false,
      openFolderAfterExport: false,
    },
  }
  project.audio = {
    ...project.audio,
    masterVolume: 1,
    scrubEnabled: false,
    waveformDensity: 'balanced',
  }

  process.stdout.write(JSON.stringify(project))
} finally {
  await vite.close()
}
