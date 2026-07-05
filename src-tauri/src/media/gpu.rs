//! GPU arbiter — serializes the LLM brain and the diffusion media models on a single GPU.
//!
//! On a consumer card (RTX 3060 class) the brain and a diffusion model cannot both stay resident
//! during a heavy job, so the arbiter grants exclusive access: before a `Heavy` job it unloads the
//! brain to reclaim VRAM, and reloads it when the job's `GpuLease` is dropped.
#![allow(dead_code)]

use std::sync::{Arc, Condvar, Mutex};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum GpuNeed {
    /// Diffusion (image / video) — unload the brain first.
    Heavy,
    /// A small job that may coexist with a small brain (policy-configurable; today it still
    /// serializes but does not evict the brain).
    Light,
}

/// Hook the brain implements so the arbiter can free / restore its VRAM.
/// Wave 3 (llama.cpp) provides the real implementation; until then the arbiter runs with `None`.
pub trait BrainVram: Send + Sync {
    fn unload(&self);
    fn reload(&self);
}

/// Serializes GPU access across brain and media. Hold as `Arc<GpuArbiter>`.
pub struct GpuArbiter {
    busy: Mutex<bool>,
    cv: Condvar,
    brain: Option<Arc<dyn BrainVram>>,
}

impl GpuArbiter {
    pub fn new(brain: Option<Arc<dyn BrainVram>>) -> Arc<Self> {
        Arc::new(Self {
            busy: Mutex::new(false),
            cv: Condvar::new(),
            brain,
        })
    }

    /// Acquire exclusive GPU access, blocking until it is free. For a `Heavy` need the brain is
    /// unloaded before returning. The returned lease reloads the brain on drop.
    pub fn acquire(self: &Arc<Self>, need: GpuNeed) -> GpuLease {
        {
            let mut busy = self.busy.lock().unwrap_or_else(|p| p.into_inner());
            while *busy {
                busy = self.cv.wait(busy).unwrap_or_else(|p| p.into_inner());
            }
            *busy = true;
        }
        let evict = need == GpuNeed::Heavy;
        if evict {
            if let Some(b) = &self.brain {
                b.unload();
            }
        }
        GpuLease {
            arbiter: self.clone(),
            reload: evict,
        }
    }

    fn release(&self, reload: bool) {
        if reload {
            if let Some(b) = &self.brain {
                b.reload();
            }
        }
        let mut busy = self.busy.lock().unwrap_or_else(|p| p.into_inner());
        *busy = false;
        self.cv.notify_one();
    }
}

/// RAII lease on the GPU. Owned (no lifetime) so it can be moved into a background job thread and
/// held for the whole render. Dropping it releases the GPU and reloads the brain if it was evicted.
pub struct GpuLease {
    arbiter: Arc<GpuArbiter>,
    reload: bool,
}

impl Drop for GpuLease {
    fn drop(&mut self) {
        self.arbiter.release(self.reload);
    }
}
