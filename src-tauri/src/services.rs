//! Process-wide wired services: the shared brain and the GPU arbiter that evicts it for media
//! jobs. Building the arbiter with `Some(brain)` is what connects the two — when a heavy media
//! job acquires the GPU, the arbiter calls the brain's `BrainVram::unload`, and reloads it on
//! release. Both are lazy singletons so every caller shares the same instances.
#![allow(dead_code)]

use std::path::PathBuf;
use std::sync::{Arc, OnceLock};

use crate::brain::ollama::OllamaBrain;
use crate::media::backends::comfy::ComfyBackend;
use crate::media::backends::piper::PiperBackend;
use crate::media::backends::sdcpp::SdCppBackend;
use crate::media::backends::whisper::WhisperBackend;
use crate::media::gpu::{BrainVram, GpuArbiter};
use crate::media::MediaBroker;

/// Default local tool-calling model for the in-app brain. `qwen3.5:4b` is not a real Ollama tag
/// (Ollama's Qwen3 line is `qwen3:*`, no ".5"); overridable via `FLUXNODE_BRAIN_MODEL` for
/// anyone pinned to a different local tag.
pub const DEFAULT_BRAIN_MODEL: &str = "qwen3:4b";

/// The shared brain instance (also implements `BrainVram`).
pub fn brain() -> Arc<OllamaBrain> {
    static BRAIN: OnceLock<Arc<OllamaBrain>> = OnceLock::new();
    BRAIN
        .get_or_init(|| {
            let model = std::env::var("FLUXNODE_BRAIN_MODEL")
                .ok()
                .filter(|value| !value.trim().is_empty())
                .unwrap_or_else(|| DEFAULT_BRAIN_MODEL.to_string());
            Arc::new(OllamaBrain::local(model))
        })
        .clone()
}

/// The shared GPU arbiter, wired to evict the brain from VRAM during heavy media jobs.
pub fn gpu_arbiter() -> Arc<GpuArbiter> {
    static ARBITER: OnceLock<Arc<GpuArbiter>> = OnceLock::new();
    ARBITER
        .get_or_init(|| GpuArbiter::new(Some(brain() as Arc<dyn BrainVram>)))
        .clone()
}

/// Resolve an env var to a path only if it is set AND the file exists (opt-in backend config).
fn env_path(var: &str) -> Option<PathBuf> {
    std::env::var(var)
        .ok()
        .map(PathBuf::from)
        .filter(|p| p.exists())
}

/// The shared media broker, wired to the GPU arbiter. ComfyUI (image) is always registered
/// (it only needs a running server). The native sidecar backends (sd.cpp / whisper / piper) are
/// registered only when their binary + model paths are provided via env vars and exist on disk,
/// since those binaries are not bundled yet:
///   FLUXNODE_SD_BIN + FLUXNODE_SD_MODEL, FLUXNODE_WHISPER_BIN + FLUXNODE_WHISPER_MODEL,
///   FLUXNODE_PIPER_BIN + FLUXNODE_PIPER_VOICE
pub fn media_broker() -> &'static MediaBroker {
    static BROKER: OnceLock<MediaBroker> = OnceLock::new();
    BROKER.get_or_init(|| {
        let out_dir = std::env::temp_dir().join("fluxnode-media");
        let mut broker = MediaBroker::new(gpu_arbiter());

        // Always available: ComfyUI power path (BYO running server).
        broker.add_image(Arc::new(ComfyBackend::local()));

        // Native fast path — opt-in until the sd binary/model are bundled.
        if let (Some(bin), Some(model)) = (env_path("FLUXNODE_SD_BIN"), env_path("FLUXNODE_SD_MODEL"))
        {
            broker.add_image(Arc::new(SdCppBackend::new(bin, model, out_dir.clone())));
        }
        if let (Some(bin), Some(model)) =
            (env_path("FLUXNODE_WHISPER_BIN"), env_path("FLUXNODE_WHISPER_MODEL"))
        {
            broker.set_stt(Arc::new(WhisperBackend::new(bin, model)));
        }
        if let (Some(bin), Some(voice)) =
            (env_path("FLUXNODE_PIPER_BIN"), env_path("FLUXNODE_PIPER_VOICE"))
        {
            broker.set_tts(Arc::new(PiperBackend::new(bin, voice, out_dir)));
        }

        broker
    })
}
