import type {
  Asset,
  Clip,
  DetachedPanelKind,
  FluxNodeProject,
  Track,
  WorkflowEdge,
  WorkflowNode,
} from './types'

export type ProjectTemplateId = 'quick-edit' | 'ai-workflow' | 'shader-fx'

function nowIso() {
  return new Date().toISOString()
}

function createProjectId(templateId: ProjectTemplateId) {
  return `project-${templateId}-${Date.now()}`
}

function createVideoAsset(): Asset {
  return {
    id: 'asset-video-01',
    name: 'sci-fi-scene-01.mp4',
    type: 'video',
    sourcePath: 'C:/FluxNode/media/sci-fi-scene-01.mp4',
    relativePath: null,
    proxyPath: null,
    preferProxyForEditing: true,
    duration: 12.4,
    metadata: {
      codec: 'H.264',
      width: 3840,
      height: 2160,
      frameRate: 30,
      channels: 2,
      sampleRate: 48000,
      fileSize: 124_000_000,
    },
    status: 'linked',
  }
}

function createAudioAsset(): Asset {
  return {
    id: 'asset-audio-01',
    name: 'pulse-bed.wav',
    type: 'audio',
    sourcePath: 'C:/FluxNode/media/pulse-bed.wav',
    relativePath: null,
    proxyPath: null,
    preferProxyForEditing: false,
    duration: 18.2,
    metadata: {
      codec: 'PCM',
      width: null,
      height: null,
      frameRate: null,
      channels: 2,
      sampleRate: 48000,
      fileSize: 42_000_000,
    },
    status: 'linked',
  }
}

function createLinkedVideoClip(): Clip {
  return {
    id: 'clip-video-01',
    assetId: 'asset-video-01',
    trackId: 'track-video-01',
    startTime: 0,
    duration: 8,
    inPoint: 0,
    outPoint: 8,
    speed: 1,
    volume: 1,
    opacity: 1,
    transform: {
      x: 0,
      y: 0,
      scaleX: 1,
      scaleY: 1,
      rotation: 0,
      anchorX: 0.5,
      anchorY: 0.5,
    },
    keyframes: [
      {
        id: 'kf-01',
        time: 0,
        property: 'opacity',
        value: 1,
        easing: 'linear',
      },
    ],
    linkedClipId: 'clip-audio-01',
    workflowNodeId: 'node-media-01',
  }
}

function createLinkedAudioClip(): Clip {
  return {
    id: 'clip-audio-01',
    assetId: 'asset-audio-01',
    trackId: 'track-audio-01',
    startTime: 0,
    duration: 8,
    inPoint: 0,
    outPoint: 8,
    speed: 1,
    volume: 0.8,
    opacity: 1,
    transform: {
      x: 0,
      y: 0,
      scaleX: 1,
      scaleY: 1,
      rotation: 0,
      anchorX: 0.5,
      anchorY: 0.5,
    },
    keyframes: [],
    linkedClipId: 'clip-video-01',
    workflowNodeId: 'node-media-02',
  }
}

function createTracks(): Track[] {
  return [
    {
      id: 'track-video-01',
      name: 'Video Track 1',
      type: 'video',
      locked: false,
      visible: true,
      muted: false,
      solo: false,
      volume: 1,
      pan: 0,
      height: 84,
      clips: [createLinkedVideoClip()],
    },
    {
      id: 'track-audio-01',
      name: 'Audio Track 1',
      type: 'audio',
      locked: false,
      visible: true,
      muted: false,
      solo: false,
      volume: 1,
      pan: 0,
      height: 72,
      clips: [createLinkedAudioClip()],
    },
  ]
}

function createShaderNode(id: string, position: { x: number; y: number }, label: string): WorkflowNode {
  return {
    id,
    type: 'shader',
    position,
    data: {
      shaderSource: 'vec3 glow = color.rgb * 1.1;',
      uniforms: {
        exposure: {
          type: 'float',
          value: 1.15,
        },
      },
      presetId: 'neon-glow',
    },
    collapsed: false,
    bypassed: false,
    executionError: null,
    label,
  }
}

function createUpscaleNode(): WorkflowNode {
  return {
    id: 'node-ai-upscale-01',
    type: 'ai_upscale',
    position: { x: 630, y: 235 },
    data: {
      model: 'fluxnode-upscale-4x',
      scaleFactor: 4,
      computeSource: 'project',
    },
    collapsed: false,
    bypassed: false,
    executionError: null,
    label: 'AI Upscale',
  }
}

function createColorCorrectNode(): WorkflowNode {
  return {
    id: 'node-color-01',
    type: 'color_correct',
    position: { x: 620, y: 235 },
    data: {
      lift: 0.02,
      gamma: 1.08,
      gain: 1.12,
    },
    collapsed: false,
    bypassed: false,
    executionError: null,
    label: 'Color Finish',
  }
}

function createOutputNode(position: { x: number; y: number }): WorkflowNode {
  return {
    id: 'node-output-01',
    type: 'output',
    position,
    data: {
      format: 'mp4',
      resolution: 'project',
      frameRate: 'project',
    },
    collapsed: false,
    bypassed: false,
    executionError: null,
    label: 'Output',
  }
}

function createWorkflowNodes(templateId: ProjectTemplateId): WorkflowNode[] {
  const videoMediaNode: WorkflowNode = {
    id: 'node-media-01',
    type: 'media_source',
    position: { x: 80, y: 240 },
    data: {
      assetId: 'asset-video-01',
      timelineClipId: 'clip-video-01',
    },
    collapsed: false,
    bypassed: false,
    executionError: null,
    label: 'Video Source',
  }

  const audioMediaNode: WorkflowNode = {
    id: 'node-media-02',
    type: 'media_source',
    position: { x: 80, y: 420 },
    data: {
      assetId: 'asset-audio-01',
      timelineClipId: 'clip-audio-01',
    },
    collapsed: false,
    bypassed: false,
    executionError: null,
    label: 'Audio Source',
  }

  const audioMixNode: WorkflowNode = {
    id: 'node-audio-mix-01',
    type: 'audio_mix',
    position: { x: 420, y: 400 },
    data: {
      bus: 'master',
      gain: 1,
      inputs: [
        {
          sourceNodeId: 'node-media-02',
          volume: 0.9,
          pan: 0,
        },
      ],
    },
    collapsed: false,
    bypassed: false,
    executionError: null,
    label: 'Audio Mix',
  }

  if (templateId === 'quick-edit') {
    return [videoMediaNode, audioMediaNode, audioMixNode, createOutputNode({ x: 680, y: 280 })]
  }

  if (templateId === 'shader-fx') {
    return [
      videoMediaNode,
      audioMediaNode,
      audioMixNode,
      createShaderNode('node-shader-01', { x: 350, y: 230 }, 'Chromatic Glow'),
      createColorCorrectNode(),
      createOutputNode({ x: 900, y: 280 }),
    ]
  }

  return [
    videoMediaNode,
    audioMediaNode,
    audioMixNode,
    createShaderNode('node-shader-01', { x: 340, y: 230 }, 'Prompt Grade'),
    createUpscaleNode(),
    createOutputNode({ x: 920, y: 280 }),
  ]
}

function createWorkflowEdges(templateId: ProjectTemplateId): WorkflowEdge[] {
  if (templateId === 'quick-edit') {
    return [
      {
        id: 'edge-01',
        source: 'node-media-01',
        sourceHandle: 'video',
        target: 'node-output-01',
        targetHandle: 'video',
      },
      {
        id: 'edge-02',
        source: 'node-audio-mix-01',
        sourceHandle: 'mix',
        target: 'node-output-01',
        targetHandle: 'audio',
      },
      {
        id: 'edge-03',
        source: 'node-media-02',
        sourceHandle: 'audio',
        target: 'node-audio-mix-01',
        targetHandle: 'input',
      },
    ]
  }

  if (templateId === 'shader-fx') {
    return [
      {
        id: 'edge-01',
        source: 'node-media-01',
        sourceHandle: 'video',
        target: 'node-shader-01',
        targetHandle: 'input',
      },
      {
        id: 'edge-02',
        source: 'node-shader-01',
        sourceHandle: 'output',
        target: 'node-color-01',
        targetHandle: 'input',
      },
      {
        id: 'edge-03',
        source: 'node-color-01',
        sourceHandle: 'output',
        target: 'node-output-01',
        targetHandle: 'video',
      },
      {
        id: 'edge-04',
        source: 'node-audio-mix-01',
        sourceHandle: 'mix',
        target: 'node-output-01',
        targetHandle: 'audio',
      },
      {
        id: 'edge-05',
        source: 'node-media-02',
        sourceHandle: 'audio',
        target: 'node-audio-mix-01',
        targetHandle: 'input',
      },
    ]
  }

  return [
    {
      id: 'edge-01',
      source: 'node-media-01',
      sourceHandle: 'video',
      target: 'node-shader-01',
      targetHandle: 'input',
    },
    {
      id: 'edge-02',
      source: 'node-shader-01',
      sourceHandle: 'output',
      target: 'node-ai-upscale-01',
      targetHandle: 'input',
    },
    {
      id: 'edge-03',
      source: 'node-ai-upscale-01',
      sourceHandle: 'output',
      target: 'node-output-01',
      targetHandle: 'video',
    },
    {
      id: 'edge-04',
      source: 'node-audio-mix-01',
      sourceHandle: 'mix',
      target: 'node-output-01',
      targetHandle: 'audio',
    },
    {
      id: 'edge-05',
      source: 'node-media-02',
      sourceHandle: 'audio',
      target: 'node-audio-mix-01',
      targetHandle: 'input',
    },
  ]
}

function createDefaultPanelLayouts(): Record<DetachedPanelKind, FluxNodeProject['meta']['panelLayouts'][DetachedPanelKind]> {
  return {
    preview: { detached: false, width: 1120, height: 760, x: null, y: null },
    timeline: { detached: false, width: 1280, height: 840, x: null, y: null },
    inspector: { detached: false, width: 480, height: 720, x: null, y: null },
  }
}

function createDefaultWorkspaceSharing(projectId: string, createdAt: string): FluxNodeProject['meta']['sharing'] {
  return {
    enabled: false,
    workspaceId: `workspace-${projectId}`,
    shareLink: null,
    accessLevel: 'private',
    ownerName: 'Studio Owner',
    ownerEmail: null,
    collaborators: [],
    invites: [],
    lastSyncedAt: createdAt,
  }
}

export function createTemplateProject(templateId: ProjectTemplateId): FluxNodeProject {
  const createdAt = nowIso()
  const projectId = createProjectId(templateId)
  const templateName =
    templateId === 'quick-edit'
      ? 'Quick Edit'
      : templateId === 'shader-fx'
        ? 'Shader FX'
        : 'AI Workflow'

  return {
    version: '1.0.0',
    meta: {
      id: projectId,
      name: `FluxNode ${templateName}`,
      createdAt,
      updatedAt: createdAt,
      thumbnailPath: null,
      panelLayouts: createDefaultPanelLayouts(),
      sharing: createDefaultWorkspaceSharing(projectId, createdAt),
      section11TargetProfileOverride: null,
      section11ProofHistory: [],
      section11CoverageMapHistory: [],
      section11CapturePacketHistory: [],
    },
    settings: {
      resolution: { width: 1920, height: 1080 },
      frameRate: 30,
      sampleRate: 48000,
      bitDepth: 16,
      colorSpace: 'Rec709',
      proxyEnabled: true,
      proxyResolution: { width: 960, height: 540 },
    },
    assets: {
      assets: {
        'asset-video-01': createVideoAsset(),
        'asset-audio-01': createAudioAsset(),
      },
    },
    timeline: {
      tracks: createTracks(),
      playhead: 2.8,
      inPoint: 0,
      outPoint: 8,
      zoom: 1,
      scrollX: 0,
    },
    workflow: {
      nodes: createWorkflowNodes(templateId),
      groups: [],
      edges: createWorkflowEdges(templateId),
      viewport: { x: 0, y: 0, zoom: 1 },
      computeMode: 'local',
    },
    output: {
      presets: [
        {
          id: 'preset-hq-1080p',
          name: 'HQ 1080p',
          format: 'mp4',
          videoCodec: 'h264',
          audioCodec: 'aac',
          quality: 'high',
          resolution: 'project',
          frameRate: 'project',
          videoBitrateMbps: 18,
          audioBitrateKbps: 320,
        },
        {
          id: 'preset-review-webm',
          name: 'Review WebM',
          format: 'webm',
          videoCodec: 'vp9',
          audioCodec: 'opus',
          quality: 'high',
          resolution: { width: 1280, height: 720 },
          frameRate: 24,
          videoBitrateMbps: 8,
          audioBitrateKbps: 192,
        },
        {
          id: 'preset-prores-master',
          name: 'ProRes Master',
          format: 'mov',
          videoCodec: 'prores',
          audioCodec: 'pcm',
          quality: 'lossless',
          resolution: 'project',
          frameRate: 'project',
          videoBitrateMbps: 120,
          audioBitrateKbps: 1536,
        },
        {
          id: 'preset-4k60-master',
          name: '4K 60 Master',
          format: 'mov',
          videoCodec: 'prores',
          audioCodec: 'pcm',
          quality: 'lossless',
          resolution: { width: 3840, height: 2160 },
          frameRate: 60,
          videoBitrateMbps: 180,
          audioBitrateKbps: 1536,
        },
        {
          id: 'preset-gif-preview',
          name: 'GIF Preview',
          format: 'gif',
          videoCodec: null,
          audioCodec: null,
          quality: 'draft',
          resolution: { width: 960, height: 540 },
          frameRate: 12,
          videoBitrateMbps: 0,
          audioBitrateKbps: 0,
        },
        {
          id: 'preset-frame-sequence',
          name: 'Frame Sequence',
          format: 'png_sequence',
          videoCodec: null,
          audioCodec: null,
          quality: 'lossless',
          resolution: 'project',
          frameRate: 'project',
          videoBitrateMbps: 0,
          audioBitrateKbps: 0,
        },
      ],
      activePresetId: 'preset-hq-1080p',
      queue: [],
      exportDefaults: {
        outputDirectory: 'D:/FluxNode/exports',
        useProxyRenders: false,
        openFolderAfterExport: true,
      },
    },
    audio: {
      masterVolume: 0.85,
      scrubEnabled: true,
      waveformDensity: 'balanced',
    },
  }
}

export function createDefaultProject(): FluxNodeProject {
  return createTemplateProject('ai-workflow')
}
