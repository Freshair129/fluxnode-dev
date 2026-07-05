//! Media backend traits — one per modality. Synchronous and job-based to match FluxNode's
//! existing render pipeline (background thread + status file + frontend polling).
//!
//! - Fast ops (`ImageGenerator`, `Transcriber`, `SpeechSynthesizer`) block and return a result.
//! - Long ops (`VideoGenerator`) take an owned `GpuLease`, move it into a background thread, and
//!   return a `JobStartResult` immediately; status is surfaced like `render_get_status`.
#![allow(dead_code)]

use super::gpu::GpuLease;
use super::types::{ImageCaps, ImageRequest, MediaArtifact, VideoCaps, VideoRequest};
use serde::{Deserialize, Serialize};
use tauri::AppHandle;

/// Returned by a long job; the frontend polls its status file exactly like a render job.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct JobStartResult {
    pub job_id: String,
    pub status_path: String,
}

/// Fast, blocking image generation (sd.cpp native, or a single ComfyUI image).
pub trait ImageGenerator: Send + Sync {
    fn id(&self) -> &str;
    fn caps(&self) -> ImageCaps;
    /// Holds the `GpuLease` for the duration of the (blocking) generation.
    fn generate(
        &self,
        app: &AppHandle,
        req: ImageRequest,
        gpu: GpuLease,
    ) -> Result<MediaArtifact, String>;
}

/// Long-running video generation. Spawns a background job; progress is written to a status file.
pub trait VideoGenerator: Send + Sync {
    fn id(&self) -> &str;
    fn caps(&self) -> VideoCaps;
    /// Moves `gpu` into the background thread so the brain stays evicted until the job ends.
    fn start(
        &self,
        app: &AppHandle,
        job_id: String,
        req: VideoRequest,
        gpu: GpuLease,
    ) -> Result<JobStartResult, String>;
}

/// Speech-to-text (whisper.cpp). CPU-bound, so it takes no `GpuLease`.
pub trait Transcriber: Send + Sync {
    fn id(&self) -> &str;
    fn transcribe(&self, audio_path: &str) -> Result<Transcript, String>;
}

/// Text-to-speech (Piper local ONNX, or Windows SAPI).
pub trait SpeechSynthesizer: Send + Sync {
    fn id(&self) -> &str;
    fn synth(&self, text: &str, voice: &str) -> Result<MediaArtifact, String>;
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Transcript {
    pub text: String,
    pub segments: Vec<TranscriptSegment>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TranscriptSegment {
    pub start: f64,
    pub end: f64,
    pub text: String,
}
