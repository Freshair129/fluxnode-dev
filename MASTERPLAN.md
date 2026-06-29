# FluxNode — MASTERPLAN

เอกสารนี้เป็น Technical Specification สำหรับระบบและ feature ที่ยังขาดจาก PRD/SRS/Design Guide
ใช้เป็น reference หลักในการ implement FluxNode ทุก Phase

---

## สารบัญ

1. [Data Model & Schema](#1-data-model--schema)
2. [Project & File Management](#2-project--file-management)
3. [Undo/Redo System](#3-undoredo-system)
4. [IPC Layer (Tauri)](#4-ipc-layer-tauri)
5. [Audio System](#5-audio-system)
6. [Export & Output](#6-export--output)
7. [Error Handling & Resilience](#7-error-handling--resilience)
8. [Node Graph Validation](#8-node-graph-validation)
9. [Keyboard Shortcuts](#9-keyboard-shortcuts)
10. [UX Essentials](#10-ux-essentials)
11. [Performance & System Requirements](#11-performance--system-requirements)
12. [Timeline ↔ Workflow Sync Protocol](#12-timeline--workflow-sync-protocol)

---

## 1. Data Model & Schema

### 1.1 Project Root

```typescript
interface FluxNodeProject {
  version: string                    // schema version เช่น "1.0.0"
  meta: ProjectMeta
  settings: ProjectSettings
  assets: AssetRegistry
  timeline: TimelineState
  workflow: WorkflowState
}

interface ProjectMeta {
  id: string                         // uuid v4
  name: string
  createdAt: string                  // ISO 8601
  updatedAt: string
  thumbnailPath: string | null       // relative path to .fluxnode/thumbnails/
}

interface ProjectSettings {
  resolution: { width: number; height: number }  // default: 1920x1080
  frameRate: number                               // default: 30
  sampleRate: number                              // default: 48000
  bitDepth: number                                // default: 16
  colorSpace: "sRGB" | "Rec709" | "Rec2020"       // default: Rec709
  proxyEnabled: boolean
  proxyResolution: { width: number; height: number }  // default: 960x540
}
```

### 1.2 Asset Registry

```typescript
interface AssetRegistry {
  assets: Record<string, Asset>      // key = asset id
}

interface Asset {
  id: string
  name: string
  type: "video" | "audio" | "image" | "shader" | "lut"
  sourcePath: string                 // absolute path to original file
  relativePath: string | null        // relative path if copied into project
  proxyPath: string | null           // path to proxy file
  duration: number | null            // seconds (null for images)
  metadata: MediaMetadata
  status: "linked" | "missing" | "importing" | "proxy_generating"
}

interface MediaMetadata {
  codec: string | null
  width: number | null
  height: number | null
  frameRate: number | null
  channels: number | null            // audio channels
  sampleRate: number | null
  fileSize: number                   // bytes
}
```

### 1.3 Timeline State

```typescript
interface TimelineState {
  tracks: Track[]
  playhead: number                   // current time in seconds
  inPoint: number | null
  outPoint: number | null
  zoom: number                       // zoom level (1.0 = default)
  scrollX: number                    // horizontal scroll position
}

interface Track {
  id: string
  name: string
  type: "video" | "audio" | "subtitle"
  locked: boolean
  visible: boolean                   // eye icon toggle
  muted: boolean                     // audio mute
  solo: boolean                      // solo playback
  height: number                     // track height in px
  clips: Clip[]
}

interface Clip {
  id: string
  assetId: string                    // reference to AssetRegistry
  trackId: string
  startTime: number                  // position on timeline (seconds)
  duration: number                   // clip duration (seconds)
  inPoint: number                    // source in point (trimming)
  outPoint: number                   // source out point (trimming)
  speed: number                      // playback speed (1.0 = normal)
  volume: number                     // 0.0 - 1.0 (audio clips)
  opacity: number                    // 0.0 - 1.0 (video clips)
  transform: ClipTransform
  keyframes: Keyframe[]
  linkedClipId: string | null        // linked audio/video pair
  workflowNodeId: string | null      // link to workflow node (sync)
}

interface ClipTransform {
  x: number
  y: number
  scaleX: number
  scaleY: number
  rotation: number                   // degrees
  anchorX: number
  anchorY: number
}

interface Keyframe {
  id: string
  time: number                       // relative to clip start
  property: string                   // "volume" | "opacity" | "transform.x" | etc.
  value: number
  easing: "linear" | "ease-in" | "ease-out" | "ease-in-out" | "bezier"
  bezierHandles?: { x1: number; y1: number; x2: number; y2: number }
}
```

### 1.4 Workflow State (Node Graph)

```typescript
interface WorkflowState {
  nodes: WorkflowNode[]
  edges: WorkflowEdge[]
  viewport: { x: number; y: number; zoom: number }
  computeMode: "local" | "cloud"
}

interface WorkflowNode {
  id: string
  type: NodeType
  position: { x: number; y: number }
  data: NodeData                     // type-specific data (see §1.5)
  collapsed: boolean
  label: string | null               // custom label override
}

type NodeType =
  | "media_source"
  | "camera"
  | "shader"
  | "compositor"
  | "output"
  | "audio_mix"
  | "transform"
  | "color_correct"
  | "ai_generate"
  | "ai_upscale"

interface WorkflowEdge {
  id: string
  source: string                     // source node id
  sourceHandle: string               // output port name
  target: string                     // target node id
  targetHandle: string               // input port name
}
```

### 1.5 Node Data Types

```typescript
// แต่ละ NodeType มี data shape เฉพาะ

interface MediaSourceData {
  assetId: string | null             // link to AssetRegistry
  timelineClipId: string | null      // sync link to timeline
}

interface CameraData {
  mode: "orthographic" | "perspective"
  fov: number                        // perspective only (default: 60)
  position: { x: number; y: number; z: number }
  rotation: { x: number; y: number; z: number }
  zoom: number
}

interface ShaderData {
  shaderSource: string               // GLSL fragment shader code
  uniforms: Record<string, UniformValue>
  presetId: string | null            // built-in shader preset reference
}

interface UniformValue {
  type: "float" | "vec2" | "vec3" | "vec4" | "sampler2D" | "int"
  value: number | number[] | string
}

interface CompositorData {
  blendMode: "normal" | "add" | "multiply" | "screen" | "overlay"
  layers: { nodeId: string; opacity: number; order: number }[]
}

interface OutputData {
  format: OutputFormat
  resolution: { width: number; height: number } | "project"  // "project" = use project settings
  frameRate: number | "project"
}

interface AiGenerateData {
  prompt: string
  negativePrompt: string
  model: string                      // ComfyUI model name
  steps: number
  cfg: number
  seed: number | "random"
  computeSource: "local" | "cloud" | "project"  // "project" = inherit from workflow
}

interface AiUpscaleData {
  model: string
  scaleFactor: 2 | 4
  computeSource: "local" | "cloud" | "project"
}

type NodeData =
  | MediaSourceData
  | CameraData
  | ShaderData
  | CompositorData
  | OutputData
  | AiGenerateData
  | AiUpscaleData
  | Record<string, unknown>          // extensible for future node types
```

### 1.6 Node Port Type System

```typescript
// กำหนด data type ของแต่ละ port เพื่อ validation
type PortDataType = "video" | "audio" | "image" | "mask" | "number" | "color" | "any"

interface PortDefinition {
  name: string                       // handle name
  dataType: PortDataType
  required: boolean
  multiple: boolean                  // accepts multiple connections?
}

// Port definitions per node type (see §8 for validation rules)
const NODE_PORT_DEFINITIONS: Record<NodeType, { inputs: PortDefinition[]; outputs: PortDefinition[] }> = {
  media_source: {
    inputs: [],
    outputs: [
      { name: "video", dataType: "video", required: false, multiple: false },
      { name: "audio", dataType: "audio", required: false, multiple: false },
    ],
  },
  camera: {
    inputs: [
      { name: "scene", dataType: "video", required: true, multiple: false },
    ],
    outputs: [
      { name: "render", dataType: "video", required: false, multiple: false },
    ],
  },
  shader: {
    inputs: [
      { name: "input", dataType: "video", required: true, multiple: false },
      { name: "mask", dataType: "mask", required: false, multiple: false },
    ],
    outputs: [
      { name: "output", dataType: "video", required: false, multiple: false },
    ],
  },
  compositor: {
    inputs: [
      { name: "layer", dataType: "video", required: true, multiple: true },
    ],
    outputs: [
      { name: "composite", dataType: "video", required: false, multiple: false },
    ],
  },
  output: {
    inputs: [
      { name: "video", dataType: "video", required: true, multiple: false },
      { name: "audio", dataType: "audio", required: false, multiple: false },
    ],
    outputs: [],
  },
  audio_mix: {
    inputs: [
      { name: "input", dataType: "audio", required: true, multiple: true },
    ],
    outputs: [
      { name: "mix", dataType: "audio", required: false, multiple: false },
    ],
  },
  ai_generate: {
    inputs: [
      { name: "reference", dataType: "image", required: false, multiple: false },
    ],
    outputs: [
      { name: "output", dataType: "video", required: false, multiple: false },
    ],
  },
  ai_upscale: {
    inputs: [
      { name: "input", dataType: "video", required: true, multiple: false },
    ],
    outputs: [
      { name: "output", dataType: "video", required: false, multiple: false },
    ],
  },
  transform: {
    inputs: [
      { name: "input", dataType: "video", required: true, multiple: false },
    ],
    outputs: [
      { name: "output", dataType: "video", required: false, multiple: false },
    ],
  },
  color_correct: {
    inputs: [
      { name: "input", dataType: "video", required: true, multiple: false },
    ],
    outputs: [
      { name: "output", dataType: "video", required: false, multiple: false },
    ],
  },
}
```

---

## 2. Project & File Management

### 2.1 Project File Structure

```
MyProject.fluxnode/                    ← directory-based project (like .xcodeproj)
├── project.json                       ← main project file (FluxNodeProject schema)
├── autosave/
│   ├── snapshot-{timestamp}.json      ← periodic auto-save snapshots
│   └── wal.jsonl                      ← Write-Ahead Log (incremental changes)
├── thumbnails/
│   ├── project-thumb.png              ← project thumbnail for recent list
│   └── {asset-id}-thumb.png           ← asset thumbnails
├── proxies/
│   └── {asset-id}-proxy.mp4           ← generated proxy files
├── cache/
│   ├── waveforms/                     ← cached audio waveform data
│   └── renders/                       ← cached intermediate renders
└── exports/                           ← default export output directory
```

### 2.2 Save/Load Behavior

| Action | Behavior |
|--------|----------|
| **New Project** | สร้าง `.fluxnode/` directory + `project.json` พร้อม default settings |
| **Save (Ctrl+S)** | เขียน full `project.json` + clear WAL |
| **Auto-save** | ทุก 60 วินาที เขียน snapshot ลง `autosave/` เก็บ 10 snapshots ล่าสุด |
| **WAL** | ทุก state mutation จะถูก append เป็น JSON line ใน `wal.jsonl` |
| **Open Project** | อ่าน `project.json` แล้ว replay WAL ถ้ามี (crash recovery) |
| **Recent Projects** | เก็บ list ไว้ใน Tauri app data: `%APPDATA%/FluxNode/recent.json` |

### 2.3 Asset Reference Strategy

```
Strategy: "Link + Copy Option"

Default: Media files ถูก reference ด้วย absolute path (linked)
Option:  User สามารถเลือก "Copy to Project" เพื่อ copy file เข้า project folder

เมื่อเปิด project:
  1. Scan ทุก asset ใน registry
  2. ตรวจสอบ file ยัง exist ไหม
  3. ถ้า missing → mark status: "missing" + แสดง warning badge บน clip
  4. User สามารถ relink file ได้ผ่าน context menu

Relative path resolution:
  - ถ้า asset อยู่ใน project folder → เก็บ relativePath
  - ถ้า asset อยู่นอก project → เก็บ sourcePath (absolute)
  - Load priority: relativePath → sourcePath → "missing"
```

### 2.4 Recent Projects

```typescript
// %APPDATA%/FluxNode/recent.json
interface RecentProjectsStore {
  projects: RecentProject[]          // max 20 items, sorted by lastOpened desc
}

interface RecentProject {
  path: string                       // absolute path to .fluxnode/ directory
  name: string
  lastOpened: string                 // ISO 8601
  thumbnailPath: string | null
}
```

---

## 3. Undo/Redo System

### 3.1 Architecture: Command Pattern

```typescript
interface Command {
  id: string
  type: string                       // e.g. "clip.move", "node.add", "track.delete"
  label: string                      // human-readable label for Edit menu
  timestamp: number
  do: () => void                     // apply the change
  undo: () => void                   // reverse the change
}
```

### 3.2 History Stack

```typescript
interface HistoryManager {
  undoStack: Command[]               // max 200 items
  redoStack: Command[]
  
  execute(cmd: Command): void        // run cmd.do(), push to undoStack, clear redoStack
  undo(): void                       // pop undoStack, run cmd.undo(), push to redoStack
  redo(): void                       // pop redoStack, run cmd.do(), push to undoStack
  
  beginGroup(label: string): void    // group multiple commands into single undo step
  endGroup(): void
}
```

### 3.3 Command Types

```
Timeline Commands:
  clip.add         — add clip to track
  clip.remove      — remove clip from track
  clip.move        — move clip position/track
  clip.trim        — change in/out points
  clip.split       — split clip at playhead
  clip.speed       — change playback speed
  clip.transform   — change position/scale/rotation
  track.add        — add track
  track.remove     — remove track (+ all clips)
  track.reorder    — change track order
  keyframe.add     — add keyframe
  keyframe.remove  — remove keyframe
  keyframe.move    — move keyframe time/value

Workflow Commands:
  node.add         — add node to canvas
  node.remove      — remove node (+ connected edges)
  node.move        — move node position
  node.update      — change node data/settings
  edge.add         — connect two nodes
  edge.remove      — disconnect nodes

Project Commands:
  asset.import     — add asset to registry
  asset.remove     — remove asset from registry
  settings.update  — change project settings
```

### 3.4 Group Operations

บาง action ต้อง group หลาย commands เข้าด้วยกัน:
- **Delete track** = `track.remove` + N x `clip.remove`
- **Delete node** = `node.remove` + N x `edge.remove`
- **Paste multiple clips** = N x `clip.add`
- **Drag-select and move** = N x `clip.move` or `node.move`

ทุก group undo/redo เป็น step เดียว

---

## 4. IPC Layer (Tauri)

### 4.1 Architecture Overview

```
┌──────────────────────────────────────────────────────────┐
│  React (Frontend)                                        │
│  ┌──────────┐  ┌──────────┐  ┌──────────────────────┐    │
│  │ Zustand   │  │ React    │  │ WebSocket Client     │    │
│  │ Store     │  │ Flow     │  │ (ComfyUI/Cloud)      │    │
│  └─────┬────┘  └──────────┘  └──────────────────────┘    │
│        │                                                  │
│  ──────┼── Tauri invoke() / listen() ──────────────────   │
│        │                                                  │
├────────┼─────────────────────────────────────────────────┤
│  Rust (Backend)                                          │
│  ┌─────┴────┐  ┌──────────┐  ┌──────────────────────┐    │
│  │ Command   │  │ Video    │  │ File System          │    │
│  │ Handler   │  │ Engine   │  │ Watcher              │    │
│  └──────────┘  └──────────┘  └──────────────────────┘    │
└──────────────────────────────────────────────────────────┘
```

### 4.2 Tauri Commands (React → Rust)

```rust
// ===== Project Commands =====
#[tauri::command]
fn project_new(name: String, path: String, settings: ProjectSettings) -> Result<FluxNodeProject>

#[tauri::command]
fn project_open(path: String) -> Result<FluxNodeProject>

#[tauri::command]
fn project_save(project: FluxNodeProject) -> Result<()>

#[tauri::command]
fn project_export_render(config: RenderConfig) -> Result<String>  // returns job id

// ===== Asset Commands =====
#[tauri::command]
fn asset_import(paths: Vec<String>) -> Result<Vec<Asset>>  // probe metadata, gen thumbnails

#[tauri::command]
fn asset_probe(path: String) -> Result<MediaMetadata>  // ffprobe wrapper

#[tauri::command]
fn asset_generate_proxy(asset_id: String, target_resolution: Resolution) -> Result<String>

#[tauri::command]
fn asset_generate_thumbnail(asset_id: String, time: f64) -> Result<String>  // returns path

#[tauri::command]
fn asset_generate_waveform(asset_id: String) -> Result<Vec<f32>>

// ===== Video Engine Commands =====
#[tauri::command]
fn video_decode_frame(asset_id: String, time: f64) -> Result<FrameData>  // single frame

#[tauri::command]
fn video_start_playback(config: PlaybackConfig) -> Result<()>  // start realtime decode

#[tauri::command]
fn video_stop_playback() -> Result<()>

#[tauri::command]
fn video_seek(time: f64) -> Result<FrameData>

// ===== Render Commands =====
#[tauri::command]
fn render_start(config: RenderConfig) -> Result<String>  // returns job id

#[tauri::command]
fn render_cancel(job_id: String) -> Result<()>

#[tauri::command]
fn render_get_status(job_id: String) -> Result<RenderStatus>

// ===== File System Commands =====
#[tauri::command]
fn fs_pick_files(filters: Vec<FileFilter>) -> Result<Vec<String>>  // native file dialog

#[tauri::command]
fn fs_pick_directory() -> Result<String>

#[tauri::command]
fn fs_watch_assets(paths: Vec<String>) -> Result<()>  // watch for external changes
```

### 4.3 Tauri Events (Rust → React)

```typescript
// Frontend listens via: listen("event-name", callback)

// Render progress
interface RenderProgressEvent {
  jobId: string
  frame: number
  totalFrames: number
  percentage: number
  estimatedTimeRemaining: number     // seconds
  stage: "decoding" | "processing" | "encoding"
}

// Playback frame delivery
interface PlaybackFrameEvent {
  time: number
  frameData: string                  // base64 encoded frame or shared memory ref
}

// Asset file change detection
interface AssetChangedEvent {
  assetId: string
  changeType: "modified" | "deleted" | "moved"
  newPath?: string
}

// ComfyUI status
interface ComfyStatusEvent {
  connected: boolean
  queueSize: number
  currentJob: string | null
  gpuMemoryUsage: number             // percentage
}

// Error
interface BackendErrorEvent {
  source: "video_engine" | "render" | "file_system" | "comfy"
  message: string
  severity: "warning" | "error" | "fatal"
  recoverable: boolean
}
```

### 4.4 Tauri Capability Scope

```json
// src-tauri/capabilities/default.json
{
  "permissions": [
    "core:default",
    "dialog:default",
    "fs:allow-read",
    "fs:allow-write",
    "shell:allow-open",
    "window:default",
    "path:default"
  ],
  "scope": {
    "fs": {
      "allow": [
        "$APPDATA/FluxNode/**",
        "$DOCUMENT/**",
        "$DESKTOP/**",
        "$HOME/Videos/**",
        "$HOME/Movies/**"
      ]
    }
  }
}
```

---

## 5. Audio System

### 5.1 Audio Pipeline

```
┌─────────┐    ┌───────────┐    ┌────────────┐    ┌──────────┐
│ Decode   │ →  │ Mix /     │ →  │ Effects    │ →  │ Output   │
│ (ffmpeg) │    │ Volume    │    │ (optional) │    │ (device) │
└─────────┘    └───────────┘    └────────────┘    └──────────┘
```

### 5.2 Track Audio Controls

```typescript
interface AudioTrackState {
  volume: number          // 0.0 - 2.0 (1.0 = unity gain, allow boost to 2x)
  pan: number             // -1.0 (left) to 1.0 (right)
  muted: boolean
  solo: boolean           // solo = mute all other tracks
}

// Mix rules:
// - Solo: ถ้ามี track ที่ solo อยู่ → เล่นเฉพาะ solo tracks
// - Mute: track ที่ mute ไม่เล่น (แม้จะ solo อยู่)
// - Volume: per-track volume × per-clip volume × master volume
// - Linked clips: video+audio clip ที่ linked กัน move/trim ไปด้วยกัน
```

### 5.3 Waveform Visualization

```
Generation:
  1. asset_generate_waveform() → Rust decode audio → downsample to peaks
  2. เก็บ cache ไว้ใน cache/waveforms/{asset-id}.bin
  3. Format: array of min/max pairs per pixel column
  4. Resolution: 1 sample per pixel at default zoom

Display:
  - แสดงบน audio track/clip ใน Timeline
  - Scale ตาม zoom level (re-sample from cached data)
  - Color: subtle waveform (#4ade80 at 30% opacity)
```

### 5.4 Audio Scrubbing

```
เมื่อ user drag playhead:
  - ถ้า drag ช้า (< 2x speed): เล่น audio ที่ pitch-shifted ตาม speed
  - ถ้า drag เร็ว (> 2x speed): เล่น short audio burst ที่ playhead position
  - ถ้า J/K/L shuttle: เล่น audio ที่ pitch-shifted ตาม shuttle speed
  
Preview latency target: < 50ms
```

### 5.5 Audio in Workflow Mode

```
Node: audio_mix
  - รับ multiple audio inputs
  - ปรับ volume/pan per input
  - Output mixed audio ไปยัง output node

Node: output
  - มี audio input port
  - ถ้าไม่มี audio connected → final render ไม่มีเสียง
  - ถ้ามี → mux audio + video ตอน export
```

---

## 6. Export & Output

### 6.1 Supported Formats

```typescript
type OutputFormat = {
  container: "mp4" | "mov" | "webm" | "mkv" | "gif" | "png_sequence"
  videoCodec: "h264" | "h265" | "prores" | "vp9" | "av1" | null    // null for audio-only
  audioCodec: "aac" | "pcm" | "opus" | "mp3" | null                // null for no audio
  quality: "draft" | "medium" | "high" | "lossless"
}

// Preset export profiles
const EXPORT_PRESETS: Record<string, OutputFormat> = {
  "youtube_1080p": { container: "mp4", videoCodec: "h264", audioCodec: "aac", quality: "high" },
  "youtube_4k":    { container: "mp4", videoCodec: "h265", audioCodec: "aac", quality: "high" },
  "twitter":       { container: "mp4", videoCodec: "h264", audioCodec: "aac", quality: "medium" },
  "prores_master": { container: "mov", videoCodec: "prores", audioCodec: "pcm", quality: "lossless" },
  "web_vp9":       { container: "webm", videoCodec: "vp9", audioCodec: "opus", quality: "high" },
  "gif_preview":   { container: "gif", videoCodec: null, audioCodec: null, quality: "draft" },
  "frame_sequence":{ container: "png_sequence", videoCodec: null, audioCodec: null, quality: "lossless" },
}
```

### 6.2 Render Config

```typescript
interface RenderConfig {
  outputPath: string
  format: OutputFormat
  resolution: { width: number; height: number }
  frameRate: number
  range: "full" | "in_out" | { start: number; end: number }  // what to render
  useProxy: false                    // always render from original sources
  denoising: boolean                 // AI-generated content denoising
  metadata: {
    title: string | null
    comment: string | null
  }
}
```

### 6.3 Render Queue

```typescript
interface RenderJob {
  id: string
  config: RenderConfig
  status: "queued" | "rendering" | "paused" | "completed" | "failed" | "cancelled"
  progress: number                   // 0.0 - 1.0
  currentFrame: number
  totalFrames: number
  startedAt: string | null
  completedAt: string | null
  estimatedTimeRemaining: number | null
  error: string | null
  outputFileSize: number | null      // bytes
}

// Behavior:
// - Queue supports multiple jobs (sequential execution)
// - User can reorder queue
// - Running job can be paused/resumed/cancelled
// - Failed jobs can be retried
// - Completed jobs show output file size + path + "Open in Explorer" button
```

### 6.4 Proxy Workflow

```
Import (large file detected: > 1080p or > 100MB):
  → Prompt: "Generate proxy for smoother editing?"
  → If yes: generate proxy in background (960x540, H.264, low bitrate)
  → Proxy stored in: .fluxnode/proxies/{asset-id}-proxy.mp4

During editing:
  → Timeline/Preview ใช้ proxy file (ถ้ามี)
  → Status bar แสดง "Proxy Mode" indicator
  → User สามารถ toggle proxy on/off per asset

During export:
  → ใช้ original source file เสมอ (never export from proxy)
  → ถ้า original missing → error + skip asset
```

---

## 7. Error Handling & Resilience

### 7.1 Error Categories & Responses

```typescript
type ErrorCategory =
  | "comfy_connection"     // ComfyUI server not reachable
  | "comfy_execution"      // ComfyUI workflow execution failed
  | "cloud_network"        // cloud API network error
  | "cloud_auth"           // cloud API authentication failed
  | "cloud_quota"          // cloud API rate limit / quota exceeded
  | "asset_missing"        // referenced file not found
  | "asset_corrupt"        // file exists but cannot be decoded
  | "render_failed"        // render pipeline error
  | "disk_full"            // insufficient disk space
  | "gpu_oom"              // GPU out of memory
  | "internal"             // unexpected error

interface ErrorResponse {
  category: ErrorCategory
  message: string                    // technical message (for logs)
  userMessage: string                // user-friendly message (for UI)
  recoverable: boolean
  suggestedAction: SuggestedAction
}
```

### 7.2 Recovery Strategy per Category

```
comfy_connection:
  ├─ Auto-retry: 3 attempts, backoff 2s/4s/8s
  ├─ UI: toast "Connecting to ComfyUI..." with spinner
  ├─ After 3 fails: toast "ComfyUI not available" + disable local compute
  └─ Offer: "Switch to Cloud" or "Retry" or "Check ComfyUI setup"

comfy_execution:
  ├─ No auto-retry (user may need to fix workflow)
  ├─ UI: red badge on failed node + error message in node inspector
  └─ Log: full ComfyUI error output in console panel

cloud_network:
  ├─ Auto-retry: 3 attempts, exponential backoff
  ├─ UI: toast "Cloud connection issue, retrying..."
  ├─ After 3 fails: offer "Switch to Local" or "Retry"
  └─ Queue: mark job as "failed", retain in queue for manual retry

cloud_auth:
  ├─ No auto-retry
  ├─ UI: modal "Authentication failed. Please check your API key."
  └─ Link to settings panel

cloud_quota:
  ├─ No auto-retry
  ├─ UI: modal showing quota usage + reset time
  └─ Offer: "Switch to Local"

asset_missing:
  ├─ UI: yellow warning badge on clip thumbnail + "Media Offline" overlay
  ├─ Context menu: "Relink Media..." → file picker
  └─ Batch relink: scan folder for matching filenames

asset_corrupt:
  ├─ UI: red badge on clip + "Cannot decode" message
  └─ Offer: "Remove from timeline" or "Replace with..."

render_failed:
  ├─ Stop render, retain completed frames
  ├─ UI: error message with frame number where failure occurred
  └─ Offer: "Retry from failed frame" or "Cancel"

disk_full:
  ├─ Pause operation immediately
  ├─ UI: modal "Insufficient disk space (need ~{size})"
  └─ Offer: "Clear cache ({size} recoverable)" or "Choose different location"

gpu_oom:
  ├─ Reduce resolution and retry once
  ├─ UI: toast "GPU memory exceeded, trying lower resolution..."
  └─ If still fails: "Switch to CPU rendering (slower)"
```

### 7.3 Offline Mode

```
เมื่อไม่มี internet connection:

Available:
  ✓ Timeline editing (ทุก feature)
  ✓ Workflow editing (node connections, layout)
  ✓ Local ComfyUI processing (ถ้า ComfyUI running)
  ✓ Local render/export
  ✓ Project save/load
  ✓ Proxy generation

Unavailable:
  ✗ Cloud compute → disabled toggle, grey out
  ✗ Cloud-only AI models → show "Requires internet" badge

Available with connectivity:
  ✓ Workspace sharing (roles, invites, share link, collaborator presence)
  ✓ Cloud co-edit conflict detection + local/remote resolution
  ✓ Manual update checks via configured manifest URL
  ✓ Current version display + download handoff
  ✓ Update package download to local app data
  ✓ Install downloaded update package

Detection:
  - Check connectivity on app start
  - Periodic check every 30 seconds (lightweight ping)
  - Status bar indicator: 🟢 Online / 🔴 Offline
  - Auto-switch compute to local when going offline
```

---

## 8. Node Graph Validation

### 8.1 Connection Rules

```typescript
function canConnect(source: PortDefinition, target: PortDefinition): boolean {
  // Rule 1: Type compatibility
  if (source.dataType !== target.dataType && source.dataType !== "any" && target.dataType !== "any") {
    return false
  }
  
  // Rule 2: No self-connections
  if (sourceNodeId === targetNodeId) return false
  
  // Rule 3: No cycles (DAG only)
  if (wouldCreateCycle(sourceNodeId, targetNodeId)) return false
  
  // Rule 4: Single connection to non-multiple ports
  if (!target.multiple && hasExistingConnection(targetNodeId, target.name)) return false
  
  return true
}
```

### 8.2 Validation Timing

```
Real-time (ขณะลาก edge):
  - Highlight compatible ports (green)
  - Dim incompatible ports (grey)
  - Show connection preview line

On connect:
  - Validate type compatibility
  - Cycle detection (DFS)
  - Replace existing connection on single-input ports

On execute/render:
  - Full graph validation
  - Check all required inputs are connected
  - Check no orphan subgraphs (warn only)
  - Topological sort for execution order
```

### 8.3 Visual Feedback

```
Port colors (by data type):
  video  → #e0ff00 (accent neon)
  audio  → #3b82f6 (cloud blue)
  image  → #a78bfa (purple)
  mask   → #f97316 (orange)
  number → #6b7280 (grey)
  color  → rainbow gradient border
  any    → white

Edge colors: match the data type of the source port

Invalid connection attempt:
  → Edge snaps back with subtle shake animation
  → Tooltip: "Cannot connect {type} to {type}"
```

---

## 9. Keyboard Shortcuts

### 9.1 Global Shortcuts

```
Ctrl+N          New Project
Ctrl+O          Open Project
Ctrl+S          Save Project
Ctrl+Shift+S    Save As
Ctrl+Z          Undo
Ctrl+Shift+Z    Redo (alternative: Ctrl+Y)
Ctrl+Q          Quit
Tab             Toggle Timeline ↔ Workflow view
F11             Fullscreen toggle
Ctrl+,          Open Settings
```

### 9.2 Timeline Mode

```
Space           Play / Pause
J               Play reverse (press again: 2x, 4x)
K               Pause
L               Play forward (press again: 2x, 4x)
Home            Go to start
End             Go to end
←/→             Move playhead 1 frame
Shift+←/→       Move playhead 10 frames
I               Set In point
O               Set Out point
Ctrl+Shift+X    Clear In/Out points

C               Cut/Split clip at playhead
Delete          Delete selected clip(s)
Ctrl+C          Copy selected clip(s)
Ctrl+V          Paste clip(s) at playhead
Ctrl+D          Duplicate selected clip(s)
Ctrl+A          Select all clips

Ctrl+Shift+↑    Move clip to track above
Ctrl+Shift+↓    Move clip to track below

+/-             Zoom timeline in/out
Ctrl+0          Fit timeline to window
```

### 9.3 Workflow Mode

```
Space (hold)    Pan canvas (hand tool)
Scroll          Zoom canvas
Ctrl+A          Select all nodes
Delete          Delete selected node(s) + edges
Ctrl+C          Copy selected node(s)
Ctrl+V          Paste node(s)
Ctrl+D          Duplicate selected node(s)
F               Fit all nodes to view
Ctrl+G          Group selected nodes

1-9             Quick-add node (1=Media, 2=Camera, 3=Shader, etc.)
N               Open Node picker/search
```

### 9.4 Customization

```typescript
// Shortcuts stored in: %APPDATA%/FluxNode/keybindings.json
interface KeyBinding {
  command: string              // e.g. "timeline.split"
  key: string                  // e.g. "C"
  modifiers: string[]          // e.g. ["Ctrl", "Shift"]
  when: "global" | "timeline" | "workflow"
}

// User can override defaults via Settings → Keyboard Shortcuts
// Conflict detection: warn when assigning key already in use
```

---

## 10. UX Essentials

### 10.1 Onboarding & Empty State

```
First launch:
  1. Welcome modal: "Welcome to FluxNode"
  2. Quick setup: choose default project directory
  3. Optional: connect ComfyUI (guide user to install if not found)
  4. Show 3 template projects:
     - "Quick Edit" — simple timeline with sample clips
     - "AI Workflow" — node graph with AI generate pipeline
     - "Shader FX" — shader node chain example

Empty project state:
  Timeline: "Drop media here or press Ctrl+I to import"
  Workflow: "Press N to add your first node" + floating hint arrows
```

### 10.2 Context Menus

```
Right-click on Clip:
  ├─ Cut at Playhead (C)
  ├─ Delete (Del)
  ├─ Duplicate (Ctrl+D)
  ├─ ──────────────
  ├─ Speed → [0.25x, 0.5x, 1x, 2x, 4x, Custom...]
  ├─ Transform...
  ├─ ──────────────
  ├─ Unlink Audio/Video
  ├─ Replace Media...
  ├─ Show in Workflow
  └─ Properties

Right-click on Track:
  ├─ Add Track Above
  ├─ Add Track Below
  ├─ Delete Track
  ├─ ──────────────
  ├─ Rename Track
  ├─ Lock/Unlock Track
  └─ Track Height → [Small, Medium, Large]

Right-click on Node:
  ├─ Duplicate (Ctrl+D)
  ├─ Delete (Del)
  ├─ ──────────────
  ├─ Bypass (disable without deleting)
  ├─ Preview Output
  ├─ ──────────────
  ├─ Compute: Local / Cloud
  ├─ Show in Timeline
  └─ Properties

Right-click on Canvas (empty):
  ├─ Add Node → [submenu of node types]
  ├─ Paste (Ctrl+V)
  ├─ ──────────────
  ├─ Fit to View (F)
  └─ Select All (Ctrl+A)
```

### 10.3 Multi-Monitor Support

```
Phase 1 (MVP): Single window, ไม่ support detach
Phase 3: Detachable panels

Detachable panels:
  - Preview monitor → pop out เป็น window แยก
  - Node inspector → pop out
  - Timeline → pop out

Implementation:
  - Tauri multi-window API
  - Shared state ผ่าน Zustand + Tauri events
  - Window position/size saved per project
```

### 10.4 Accessibility (a11y)

```
Minimum standards:
  - All interactive elements: keyboard focusable
  - All buttons/icons: aria-label
  - Color contrast: meet WCAG AA for text elements
  - Focus indicator: visible ring on all focusable elements
  - Screen reader: major regions (header, timeline, canvas) have landmarks

Not in MVP scope:
  - Full screen reader narration of timeline/node state
  - High contrast theme
  - Reduced motion mode
```

---

## 11. Performance & System Requirements

### 11.1 Minimum System Requirements

```
OS:         Windows 10+ (64-bit) / macOS 12+ / Ubuntu 22.04+
CPU:        4 cores, 2.0 GHz (Intel i5 / AMD Ryzen 5 หรือเทียบเท่า)
RAM:        8 GB (16 GB recommended)
GPU:        DirectX 12 / Vulkan compatible, 2 GB VRAM
            (สำหรับ AI features: NVIDIA GPU with 6 GB+ VRAM recommended)
Disk:       500 MB for app + space for project files
Display:    1280x720 minimum, 1920x1080 recommended
```

### 11.2 Memory Management

```
Video frame buffer:
  - ไม่ load ทั้ง video file เข้า RAM
  - Decode on-demand: buffer ±30 frames รอบ playhead
  - ถ้า RAM usage > 70% of available → evict oldest frames from cache
  - Background decode thread pool: 2-4 threads

Asset thumbnails:
  - Generate once, cache to disk (thumbnails/)
  - Load lazily when visible in UI

Node preview:
  - Render preview at reduced resolution (max 512x512)
  - Cache last preview per node
  - Re-render only when inputs change

Memory limits:
  - Soft limit: 4 GB app memory usage → start evicting caches
  - Hard limit: 6 GB → block new allocations, warn user
  - Monitor via Rust side, report to React for UI indicator
```

### 11.3 GPU Utilization

```
WebGPU (preferred, Phase 2+):
  - Shader node preview rendering
  - Video overlay compositing
  - AI inference acceleration (via compute shaders)

Fallback: WebGL 2.0 (Phase 1 MVP)
  - Basic shader preview
  - 2D compositing only

Rust-side GPU:
  - FFmpeg hardware decode (NVDEC/VideoToolbox/VA-API)
  - Final render encoding (NVENC/VideoToolbox)
  - ComfyUI uses its own GPU access (separate process)

GPU memory management:
  - Monitor VRAM usage via Rust
  - Warn at 80% VRAM usage
  - Auto-reduce preview resolution at 90%
  - Kill GPU operations at 95% to prevent system crash
```

### 11.4 Large Canvas Performance

```
Target: smooth interaction with 100+ nodes

Strategies:
  1. React Flow virtualization (built-in) — only render visible nodes
  2. Edge rendering: use SVG for < 200 edges, switch to Canvas for 200+
  3. Node collapse: collapsed nodes render as compact chips
  4. Level-of-detail: at low zoom, hide node details, show only labels
  5. Debounce node data updates: batch state writes every 16ms (60fps)
```

---

## 12. Timeline ↔ Workflow Sync Protocol

### 12.1 Sync Model

```
Bidirectional sync ระหว่าง 2 views ผ่าน shared Zustand store

Direction 1: Timeline → Workflow
  เมื่อ user import media ลง timeline:
    → Auto-create "Media Source" node ใน workflow
    → Set clip.workflowNodeId = node.id
    → Set node.data.timelineClipId = clip.id
    → Set node.data.assetId = clip.assetId

  เมื่อ user ลบ clip จาก timeline:
    → ถาม: "Remove linked workflow node?"
    → If yes: remove node + connected edges
    → If no: node becomes "unlinked" (data stays, no timeline reference)

Direction 2: Workflow → Timeline
  เมื่อ output node มี result:
    → ถ้ามี linked timeline clip → update clip preview
    → ถ้าไม่มี → สร้าง new clip on timeline? (optional, configurable)

  เมื่อ user ลบ node ที่ linked กับ clip:
    → Timeline clip retains original media (ไม่ถูกลบ)
    → clip.workflowNodeId = null
```

### 12.2 State Ownership

```
Shared state (source of truth = Zustand store):
  - Asset registry
  - Project settings
  - Playhead position

Timeline-owned state:
  - Track order and configuration
  - Clip positions, trim points, speed
  - Keyframes
  - Audio mix settings

Workflow-owned state:
  - Node positions and connections
  - Node-specific data (shader code, AI params)
  - Compute mode (local/cloud)
  - Viewport position/zoom

Sync links (bidirectional references):
  - clip.workflowNodeId ↔ node.data.timelineClipId
  - ทั้งสอง field ต้อง update พร้อมกัน (atomic operation)
```

### 12.3 Conflict Resolution

```
Scenario: user แก้ asset ในทั้ง 2 views พร้อมกัน (unlikely ในภาพปัจจุบันที่มี 1 view active)

Rule: Last-write-wins ที่ Zustand store level
  - ทุก mutation ผ่าน Zustand action
  - Action ตรวจ validity ก่อน apply
  - ถ้า asset ถูก unlink ไปแล้ว → mutation ที่อ้าง link เก่า จะ no-op

Future consideration:
  - ถ้ามี split-view (Timeline + Workflow visible simultaneously)
  - ต้อง debounce sync events เพื่อไม่ให้ infinite loop
  - ใช้ transaction ID เพื่อ prevent echo: mutation ที่มาจาก sync ไม่ trigger sync กลับ
```

---

## Implementation Priority Matrix

```
┌─────────────────────────────────────┬──────────┬───────────────────────┐
│ System                              │ Phase    │ Dependency            │
├─────────────────────────────────────┼──────────┼───────────────────────┤
│ §1  Data Model & Schema             │ MVP      │ None (foundation)     │
│ §2  Project & File Management       │ MVP      │ §1                    │
│ §3  Undo/Redo System                │ MVP      │ §1                    │
│ §4  IPC Layer (Tauri)               │ MVP      │ §1                    │
│ §9  Keyboard Shortcuts              │ MVP      │ None                  │
│ §12 Timeline ↔ Workflow Sync        │ MVP      │ §1                    │
│ §10 UX Essentials (onboarding)      │ MVP      │ None                  │
│ §8  Node Graph Validation           │ Phase 2  │ §1.6                  │
│ §5  Audio System                    │ Phase 2  │ §1, §4                │
│ §6  Export & Output                 │ Phase 2  │ §4                    │
│ §7  Error Handling & Resilience     │ Phase 2  │ §4                    │
│ §11 Performance & System Req        │ Phase 2  │ §4                    │
│ §10 UX (multi-monitor, a11y)        │ Phase 3  │ §4                    │
└─────────────────────────────────────┴──────────┴───────────────────────┘
```
