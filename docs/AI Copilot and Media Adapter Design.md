# FluxNode — Embedded AI Copilot & Media Engine Adapter Design

> **Status:** Implemented — core layer live (§9 phases 1–3 + brain done). Not yet: in-app chat
> UI panel, in-process llama.cpp backend (stub behind `--features llama`), sidecar binaries
> (whisper/piper/sd not bundled), and runtime hardening of `--mcp`.
> **Scope:** Turn FluxNode into an *agent-native* video editor — command it by text or voice
> from inside the app, and expose it as a tool (MCP + CLI) that external agents can drive.
> **Audience:** FluxNode maintainers.
>
> **What's live in code:** Action registry (30 actions) + `action_invoke`/`action_list`; the
> `brain/` agent loop with write-tool gating (Ollama backend, E2E-verified: agent → `asset_probe`
> → ffprobe → answer); the `media/` adapter + `MediaBroker` + `GpuArbiter` with comfy/sdcpp/
> whisper/piper backends wired via `services::media_broker()`; the `rmcp` MCP server; and the
> `agent_chat` command plus `--mcp` / `--agent` CLI modes.

---

## 1. Motivation

FluxNode already ships a rich command surface — **43 `#[tauri::command]`s** covering project
I/O, asset probing (waveform/thumbnail/proxy), video decode/seek, render orchestration, export,
and ComfyUI generation (`comfy.rs`). That surface is 80% of what an AI copilot needs; it is just
not yet wired to a brain, a microphone, or an external protocol.

This document specifies four additions that share **one** underlying tool layer:

1. **In-app agent** — type a command, an LLM plans and calls FluxNode actions.
2. **Voice** — speak the same commands (STT in front of the same loop).
3. **MCP server** — external agents (Claude, other copilots) call FluxNode *as a tool*.
4. **CLI** — scripts / CI drive the same actions headless.

Plus a **Media Engine Adapter Layer** so generation backends (ComfyUI, native diffusion, cloud)
are swappable per modality, and a **GPU arbiter** so the LLM brain and media models do not fight
over VRAM.

### Goals

- One canonical **Action Registry** (SSOT); every caller (UI, agent, voice, MCP, CLI) goes
  through it. No duplicated tool definitions.
- Media backends are **pluggable per modality**. ComfyUI becomes *optional*, not a hard
  dependency.
- The brain runs **embedded / local-first** (llama.cpp), degrading to cloud only by choice.
- Respect single-desktop, single-GPU reality (RTX 3060 class): brain and media serialize on GPU.

### Non-goals

- Multi-tenant / high-throughput serving (rules out vLLM / SGLang — see §7).
- Replacing FluxNode's own node-graph UI. The node UI stays; only the *execution engine* behind
  AI nodes becomes swappable.

---

## 2. Architecture overview — One Action Layer, Many Callers

```
              Tauri UI        In-app Agent      Voice        MCP server        CLI
             (existing)      (type to command) (speak)   (external agents)  (scripts/CI)
                  │                │              │              │              │
                  └────────────────┴──────┬───────┴──────────────┴──────────────┘
                                          ▼
                              ┌───────────────────────┐
                              │    ACTION REGISTRY     │  ← single source of truth
                              │  name + desc + schema  │     (43 existing + new)
                              └───────────┬───────────┘
                            ┌─────────────┼──────────────┐
                            ▼             ▼              ▼
                     project/render   MediaBroker     other actions
                       (existing)         │
                                          ▼
                                    GpuArbiter ── serialize brain ↔ media on GPU
                                          │
                 ┌───────────────┬────────┴────────┬────────────────┐
                 ▼               ▼                 ▼                ▼
           ImageGenerator   VideoGenerator     Transcriber      Synthesizer
                 │               │                 │                │
          sd.cpp / Comfy    Comfy / Cloud      whisper.cpp     Piper / SAPI
             / Cloud
```

**Rule:** the Action Registry is the SSOT. The LLM tool schema, the MCP tool list, and the CLI
subcommands are all **derived** from it — never hand-maintained in three places.

---

## 3. Action Registry (SSOT)

### 3.1 Shape

Each action is a record: stable `name`, human `description`, JSON-Schema `params`, and a handler.
The existing 43 Tauri commands become thin wrappers over registry entries (or the registry wraps
them). Metadata is the contract fed to every caller.

```rust
pub struct ActionDef {
    pub name: &'static str,          // "render_start", "generate_video"
    pub description: &'static str,   // shown to the LLM and advertised over MCP
    pub params: serde_json::Value,   // JSON Schema
    pub side_effect: SideEffect,     // ReadOnly | Mutating | LongJob — gates confirmation
}

#[async_trait]
pub trait Action: Send + Sync {
    fn def(&self) -> &ActionDef;
    async fn run(&self, ctx: &AppCtx, args: serde_json::Value) -> Result<serde_json::Value>;
}

pub struct Registry { actions: HashMap<&'static str, Arc<dyn Action>> }
```

### 3.2 Derivations (generated, not hand-written)

- **LLM tool schema** — map each `ActionDef` → provider tool-call JSON (or a GBNF grammar).
- **MCP tools** — map each `ActionDef` → an `rmcp` tool.
- **CLI** — map each `ActionDef` → a subcommand (`fluxnode do <name> --json '{...}'`).

### 3.3 Safety classification

`side_effect` drives caller behavior:
- `ReadOnly` (e.g. `asset_probe`, `render_get_status`) — auto-run, no confirm.
- `Mutating` (e.g. `save_project_state_as`) — confirm in interactive contexts.
- `LongJob` (e.g. `generate_video`, `start_export_job`) — return a job handle, stream progress.

---

## 4. The Brain (in-app agent)

### 4.1 Loop

```
user text ──► LLM (tool-calling) ──► pick action from Registry ──► run ──► feed result back
   ▲                                                                          │
   └──────────────────────── spoken/typed reply ◄────────────────────────────┘
```

Borrow the backend-switch pattern from the sibling G-Maiden project's `master.rs`:
`Auto | Local | Cloud`. Local is the default; cloud (Claude API) is opt-in.

### 4.2 Engine: llama.cpp (embedded), not Ollama-as-daemon, not vLLM

For the **"embedded in the program"** goal, run llama.cpp **in-process** via the `llama-cpp-2`
crate. This gives:

- Single process, no external daemon, `.gguf` bundled with the app.
- **GBNF grammar** — force tool-call output to a valid JSON schema, so small models rarely
  malform a call.
- Direct control of load/unload for the GPU arbiter (§6).

Run with `--jinja` to use the model's native chat template (native tool parsing), or a GBNF
grammar for guaranteed-valid JSON. Ollama remains a fine *alternative* backend (separate process)
for users who already run it, but it is not the embedding path. vLLM / SGLang are explicitly out
(§7).

### 4.3 Model shortlist (GGUF + tool-calling, RTX 3060 class)

The brain shares VRAM with media generation, so pick by VRAM tier, not one fixed model.

| Tier | Model | Quant / VRAM | Tool-calling | GGUF source |
|---|---|---|---|---|
| **0 — coexist with media busy** | Qwen3-4B-Instruct | Q4_K_M · ~2.5–3 GB | strong, native parser | `unsloth/`, `bartowski/`, Qwen official |
| **1 — media idle (default)** | Qwen3-8B | Q4_K_M · ~5–6 GB | excellent | `unsloth/Qwen3-8B-GGUF` |
| **1 — alt** | Hermes-3-Llama-3.1-8B | Q4_K_M · ~5 GB | tuned for function-call + structured output | `NousResearch/`, `bartowski/` |
| **2 — tool accuracy specialist** | watt-tool-8B | Q4_K_M · ~5 GB | top BFCL scores | `bartowski/watt-tool-8B-GGUF` |
| **2 — alt** | functionary-small-v3.2 | Q4_K_M · ~5 GB | native tool API in llama.cpp | `meetkai/` |
| **Fallback — VRAM starved** | Qwen3-1.7B | Q4_K_M · ~1.5 GB | basic command parsing | `unsloth/Qwen3-1.7B-GGUF` |

**Default:** Qwen3-4B as the always-on brain; promote to Qwen3-8B / Hermes-3 when media is idle;
switch to watt-tool if tool-call accuracy becomes the bottleneck.

> Model landscape moves fast — verify current BFCL rankings and GGUF availability before locking.

### 4.4 Voice

Put STT in front of the existing loop; nothing else changes.

- **STT:** `whisper.cpp` via `whisper-rs` (CPU-friendly, native). Mic → text → agent loop.
- **TTS (reply):** Piper (local ONNX) or Windows SAPI. Native, no ComfyUI, no cloud.

---

## 5. Media Engine Adapter Layer

### 5.1 Principles

1. **One trait per modality** (image / video / STT / TTS) — not one god-interface.
2. **Job-based, non-blocking** — video generation runs for minutes; return a `JobHandle` and
   stream `Progress`. Mirror the existing `render_start` / `render_get_status` pattern.
3. **Normalized request/response** — callers send standard params; each backend maps them to its
   native form (a ComfyUI graph, an sd.cpp arg set, a cloud request body).
4. **Capability discovery** — each backend advertises what it supports so the broker can route.
5. **GPU arbitration** — the broker owns the choke point where brain and media serialize on VRAM.

### 5.2 Types & traits

```rust
// Normalized requests
pub struct ImageRequest {
    pub prompt: String,
    pub negative: Option<String>,
    pub width: u32, pub height: u32,
    pub steps: u32, pub seed: Option<i64>,
    pub model_hint: Option<String>,   // "flux", "sdxl" — backend picks the concrete model
}
pub struct VideoRequest { pub prompt: String, pub seconds: f32, pub fps: u32, /* ... */ }

pub struct MediaArtifact { pub asset_id: String, pub path: PathBuf, pub kind: MediaKind }
pub struct Progress { pub pct: f32, pub stage: String }

// Capability traits
#[async_trait]
pub trait ImageGenerator: Send + Sync {
    fn id(&self) -> &str;
    fn caps(&self) -> ImageCaps;
    async fn generate(&self, req: ImageRequest, gpu: GpuLease) -> Result<MediaArtifact>;
}

#[async_trait]
pub trait VideoGenerator: Send + Sync {
    fn id(&self) -> &str;
    fn caps(&self) -> VideoCaps;
    async fn start(&self, req: VideoRequest, gpu: GpuLease,
                   tx: mpsc::Sender<Progress>) -> Result<JobHandle>;
}

#[async_trait]
pub trait Transcriber: Send + Sync {          // CPU-only, no GPU lease
    async fn transcribe(&self, audio: AudioRef) -> Result<Transcript>;
}

#[async_trait]
pub trait SpeechSynthesizer: Send + Sync {
    async fn synth(&self, text: &str, voice: VoiceId) -> Result<MediaArtifact>;
}
```

### 5.3 Broker

```rust
pub struct MediaBroker {
    image: Vec<Arc<dyn ImageGenerator>>,
    video: Vec<Arc<dyn VideoGenerator>>,
    stt:   Arc<dyn Transcriber>,
    tts:   Arc<dyn SpeechSynthesizer>,
    gpu:   Arc<GpuArbiter>,
}

impl MediaBroker {
    pub async fn generate_video(&self, req: VideoRequest,
                                tx: mpsc::Sender<Progress>) -> Result<JobHandle> {
        let be = self.pick_video(&req).ok_or(Error::NoBackend)?;  // route by hint/caps
        let lease = self.gpu.acquire(GpuNeed::Heavy).await?;      // unloads the LLM
        be.start(req, lease, tx).await
    }
    fn pick_video(&self, req: &VideoRequest) -> Option<Arc<dyn VideoGenerator>> {
        self.video.iter().find(|b| b.caps().supports(req)).cloned()
    }

    // Image gen registers MULTIPLE backends (sd.cpp + ComfyUI). Route by capability,
    // then prefer the cheapest/native one so sd.cpp wins the common case.
    fn pick_image(&self, req: &ImageRequest) -> Option<Arc<dyn ImageGenerator>> {
        let mut c: Vec<_> = self.image.iter()
            .filter(|b| b.caps().supports(req))   // model + required features
            .cloned().collect();
        c.sort_by_key(|b| b.caps().priority());   // native/light first → sd.cpp default
        c.into_iter().next()                      // ComfyUI chosen only when sd.cpp can't
    }
}
```

### 5.4 ComfyUI as one backend (not the core)

```rust
pub struct ComfyBackend { client: ComfyClient /* from comfy.rs */ }

#[async_trait]
impl VideoGenerator for ComfyBackend {
    fn id(&self) -> &str { "comfyui" }
    fn caps(&self) -> VideoCaps { VideoCaps { max_seconds: 10.0, models: &["wan","ltx","hunyuan"] } }
    async fn start(&self, req: VideoRequest, _gpu: GpuLease,
                   tx: mpsc::Sender<Progress>) -> Result<JobHandle> {
        let graph = self.map_to_workflow(&req);     // normalized → ComfyUI graph
        self.client.queue_prompt(graph, tx).await   // reuse existing comfy_generate path
    }
}
```

### 5.5 Image gen — sd.cpp and ComfyUI together

Image generation registers **two `ImageGenerator` backends at once**, and the broker routes per
request. They complement rather than duplicate:

| | stable-diffusion.cpp | ComfyUI |
|---|---|---|
| Form | native, in-process, no Python | separate Python server |
| Cold start | fast (load GGUF) | slow (boot server + nodes) |
| Coverage | txt2img/img2img, LoRA, basic ControlNet | full node graph, custom nodes, IPAdapter chains, newest models |
| Footprint | light | heavy |
| Availability | **always** (ships with app) | only if user installed/running |

Roles: **sd.cpp = the fast path that always works** (guarantees image gen even with no ComfyUI);
**ComfyUI = the power path** for workflows sd.cpp can't express. Routing (`pick_image`, §5.3):

| Request | Backend |
|---|---|
| Plain txt2img / img2img (SDXL/Flux) | sd.cpp |
| LoRA + single ControlNet | sd.cpp |
| Custom node graph / IPAdapter chain / unsupported feature | ComfyUI |
| ComfyUI not installed / not running | sd.cpp (guaranteed fallback) |
| Explicit user choice | forced backend |

`ImageCaps` carries the routing signals:

```rust
pub struct ImageCaps {
    pub models: &'static [&'static str],   // "sd15","sdxl","sd3","flux"
    pub features: FeatureSet,              // controlnet, ipadapter, inpaint, custom_graph
    pub embedded: bool,                    // true for sd.cpp (always available)
    // priority(): native/light backends sort first
}
```

Both backends share the same `GpuArbiter`, so only one is resident at a time — no extra VRAM
contention from running two image engines.

---

## 6. GPU Arbiter (VRAM contention)

On a single consumer GPU the brain LLM and the diffusion models cannot both be resident during a
heavy job. The arbiter serializes them: before a `Heavy` media job, unload the LLM to reclaim
VRAM; reload it when the job's `GpuLease` drops.

```rust
pub struct GpuArbiter { sem: Semaphore, llm: Arc<LlamaEngine> }

impl GpuArbiter {
    pub async fn acquire(&self, need: GpuNeed) -> Result<GpuLease> {
        let permit = self.sem.acquire().await?;
        if matches!(need, GpuNeed::Heavy) {
            self.llm.unload().await;                // llama.cpp keep_alive = 0
        }
        Ok(GpuLease { _permit: permit, reload_llm: self.llm.clone() })
    }
}
// Drop for GpuLease → reload the LLM automatically when the media job finishes.
```

- `GpuNeed::Heavy` — video/image diffusion → unload LLM first.
- `GpuNeed::Light` — small image at low res may coexist with a 4B brain; policy-configurable.
- STT/TTS are CPU-bound and take no lease.

---

## 7. Engine decisions & rationale

### 7.1 llama.cpp vs vLLM / SGLang

vLLM and SGLang optimize **throughput under many concurrent requests** (PagedAttention /
RadixAttention, continuous batching) — a datacenter, multi-user concern. FluxNode is a
single-user desktop app issuing one request at a time, so that advantage is unused, while the
costs are real: Linux-first, poor Windows story, heavy Python + CUDA stack, and they run as a
separate server (cannot be embedded). **Verdict: llama.cpp for the embedded brain.**

### 7.2 Model format decides the runtime

- **GGUF** → llama.cpp / Ollama / LM Studio (embeddable, quantized).
- **safetensors** (default on Hugging Face) → Transformers / vLLM / SGLang (servers).

The HF "Use this model" menu lists vLLM/SGLang when a model ships **safetensors-only** (no GGUF
quant yet). When choosing the brain, prefer models that have a GGUF quant (`*-GGUF` repos from
unsloth / bartowski / official). Exotic safetensors-only architectures are usually **media**
models — run those through their own backend (ComfyUI / diffusers / cloud), never llama.cpp.

### 7.3 Media backend strategy — ComfyUI is optional

| Modality | Native / embeddable | Python server | Cloud | Recommendation |
|---|---|---|---|---|
| STT | **whisper.cpp** ✅ | — | — | Native. Never needed ComfyUI. |
| TTS | **Piper / SAPI** ✅ | XTTS | ElevenLabs | Native. |
| Image gen | **stable-diffusion.cpp** ✅ (SD/SDXL/SD3/Flux, GGUF) | diffusers / ComfyUI | Fal / Replicate | Both: sd.cpp native fast path + ComfyUI power path, broker-routed (§5.5). |
| Video gen | — (no mature native) | **ComfyUI** / diffusers | Fal / Replicate / Luma / Runway | **The only gap.** Cloud backend, or ComfyUI for offline local. |
| Audio/music gen | — | diffusers | Fal / cloud | Cloud or Python; not ComfyUI-bound. |

**Fully-native, zero-Python baseline:** `whisper.cpp + Piper + stable-diffusion.cpp` covers
STT + TTS + image. The only reason to keep **ComfyUI** is **local offline video generation**;
otherwise a **cloud VideoGenerator** removes the Python dependency entirely. Either way, the
adapter layer makes this a per-modality config switch — no agent code changes.

---

## 8. External surface (MCP + CLI)

### 8.1 MCP server

- Use the official Rust SDK `rmcp` (`modelcontextprotocol/rust-sdk`).
- Transports: **stdio** (for `claude mcp add fluxnode …` locally) and **HTTP/SSE** (networked
  agents).
- Each MCP tool wraps one Registry action; `ReadOnly` actions are safe to expose broadly,
  `Mutating`/`LongJob` should be gated by config.

### 8.2 CLI

- `fluxnode do <action> --json '{...}'` → run one action.
- `fluxnode agent "cut the clip 8:50–9:40 and add subtitles"` → run the full agent loop headless.

### 8.3 Running-instance vs headless (decision)

| Mode | Meaning | Use |
|---|---|---|
| **A. Attach to running instance** | App hosts a local control server (localhost port / named pipe); MCP + CLI connect; changes appear live in the open editor | Agents assisting the human's current session |
| **B. Headless** | CLI/MCP spawns a UI-less process for render/export, then exits | Batch render, CI, automation |

Build both; ship **A first** (highest value: an agent editing the project you have open). MCP and
CLI are thin clients over the same control server.

---

## 9. Rollout phases

1. **Action Registry** — refactor the 43 commands behind the registry + schema; add derivations
   for LLM tools.
2. **Media Adapter** — land the traits + `MediaBroker` + `GpuArbiter`; wrap `comfy.rs` as the
   first `VideoGenerator`; add `whisper.cpp` `Transcriber`.
3. **Brain** — embed llama.cpp (`llama-cpp-2`), Qwen3-4B default, GBNF tool-calling, text UI.
4. **Native media** — add `stable-diffusion.cpp` `ImageGenerator`; make ComfyUI optional.
5. **Voice** — whisper STT in front of the loop + Piper TTS reply.
6. **External surface** — `rmcp` MCP server (stdio) + CLI over the control server.
7. **Cloud fallbacks** — Claude brain backend; Fal/Replicate `VideoGenerator`.

---

## 10. Open questions

- Control-server transport for mode A: localhost TCP vs named pipe (Windows-first).
- Confirmation policy for `Mutating` actions when driven by an *external* agent over MCP.
- Whether `GpuNeed::Light` co-residency (4B brain + small image job) is worth the complexity or
  should always serialize.
- stable-diffusion.cpp Rust binding: existing crate vs thin FFI wrapper.
- Project-asset provenance: tag AI-generated artifacts in the asset store for later audit.
