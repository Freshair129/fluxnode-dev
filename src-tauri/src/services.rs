//! Process-wide wired services: the shared brain and the GPU arbiter that evicts it for media
//! jobs. Building the arbiter with `Some(brain)` is what connects the two — when a heavy media
//! job acquires the GPU, the arbiter calls the brain's `BrainVram::unload`, and reloads it on
//! release. Both are lazy singletons so every caller shares the same instances.
#![allow(dead_code)]

use std::sync::{Arc, OnceLock};

use crate::brain::ollama::OllamaBrain;
use crate::media::gpu::{BrainVram, GpuArbiter};

/// Default local tool-calling model for the in-app brain.
pub const DEFAULT_BRAIN_MODEL: &str = "qwen3.5:4b";

/// The shared brain instance (also implements `BrainVram`).
pub fn brain() -> Arc<OllamaBrain> {
    static BRAIN: OnceLock<Arc<OllamaBrain>> = OnceLock::new();
    BRAIN
        .get_or_init(|| Arc::new(OllamaBrain::local(DEFAULT_BRAIN_MODEL)))
        .clone()
}

/// The shared GPU arbiter, wired to evict the brain from VRAM during heavy media jobs.
pub fn gpu_arbiter() -> Arc<GpuArbiter> {
    static ARBITER: OnceLock<Arc<GpuArbiter>> = OnceLock::new();
    ARBITER
        .get_or_init(|| GpuArbiter::new(Some(brain() as Arc<dyn BrainVram>)))
        .clone()
}
