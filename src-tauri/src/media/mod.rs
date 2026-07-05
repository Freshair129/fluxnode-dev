//! Media Engine Adapter Layer.
//!
//! One trait per modality (`traits`), normalized request/response types (`types`), a `GpuArbiter`
//! that serializes brain and media on one GPU (`gpu`), and pluggable `backends`. The `MediaBroker`
//! routes each request to a supporting backend, preferring native/light ones (sd.cpp over ComfyUI).
//!
//! See `docs/AI Copilot and Media Adapter Design.md`.
#![allow(dead_code)]

pub mod backends;
pub mod gpu;
pub mod traits;
pub mod types;

use std::sync::Arc;
use tauri::AppHandle;

use gpu::{GpuArbiter, GpuNeed};
use traits::{ImageGenerator, JobStartResult, SpeechSynthesizer, Transcriber, VideoGenerator};
use types::{ImageRequest, MediaArtifact, VideoRequest};

/// Routes media requests to registered backends and owns the GPU arbiter.
pub struct MediaBroker {
    image: Vec<Arc<dyn ImageGenerator>>,
    video: Vec<Arc<dyn VideoGenerator>>,
    stt: Option<Arc<dyn Transcriber>>,
    tts: Option<Arc<dyn SpeechSynthesizer>>,
    gpu: Arc<GpuArbiter>,
}

impl MediaBroker {
    pub fn new(gpu: Arc<GpuArbiter>) -> Self {
        Self {
            image: Vec::new(),
            video: Vec::new(),
            stt: None,
            tts: None,
            gpu,
        }
    }

    // ---- registration (multiple image/video backends may coexist) ----
    pub fn add_image(&mut self, backend: Arc<dyn ImageGenerator>) {
        self.image.push(backend);
    }
    pub fn add_video(&mut self, backend: Arc<dyn VideoGenerator>) {
        self.video.push(backend);
    }
    pub fn set_stt(&mut self, backend: Arc<dyn Transcriber>) {
        self.stt = Some(backend);
    }
    pub fn set_tts(&mut self, backend: Arc<dyn SpeechSynthesizer>) {
        self.tts = Some(backend);
    }

    // ---- routing: filter by capability, then prefer native/light (lowest priority value) ----
    fn pick_image(&self, req: &ImageRequest) -> Option<Arc<dyn ImageGenerator>> {
        let mut candidates: Vec<_> = self
            .image
            .iter()
            .filter(|b| b.caps().supports(req))
            .cloned()
            .collect();
        candidates.sort_by_key(|b| b.caps().priority);
        candidates.into_iter().next()
    }

    fn pick_video(&self, req: &VideoRequest) -> Option<Arc<dyn VideoGenerator>> {
        let mut candidates: Vec<_> = self
            .video
            .iter()
            .filter(|b| b.caps().supports(req))
            .cloned()
            .collect();
        candidates.sort_by_key(|b| b.caps().priority);
        candidates.into_iter().next()
    }

    // ---- dispatch ----
    pub fn generate_image(
        &self,
        app: &AppHandle,
        req: ImageRequest,
    ) -> Result<MediaArtifact, String> {
        let backend = self
            .pick_image(&req)
            .ok_or("no image backend supports this request")?;
        let lease = self.gpu.acquire(GpuNeed::Heavy);
        backend.generate(app, req, lease)
    }

    pub fn generate_video(
        &self,
        app: &AppHandle,
        job_id: String,
        req: VideoRequest,
    ) -> Result<JobStartResult, String> {
        let backend = self
            .pick_video(&req)
            .ok_or("no video backend supports this request")?;
        // The lease moves into the backend's background thread and releases when the job ends.
        let lease = self.gpu.acquire(GpuNeed::Heavy);
        backend.start(app, job_id, req, lease)
    }

    pub fn transcribe(&self, audio_path: &str) -> Result<traits::Transcript, String> {
        let be = self.stt.as_ref().ok_or("no STT backend registered")?;
        be.transcribe(audio_path)
    }

    pub fn synth(&self, text: &str, voice: &str) -> Result<MediaArtifact, String> {
        let be = self.tts.as_ref().ok_or("no TTS backend registered")?;
        be.synth(text, voice)
    }
}
