//! Normalized media request/response types. Backends map these to their native form
//! (a ComfyUI prompt graph, an sd.cpp arg set, a cloud request body).
#![allow(dead_code)]

use serde::{Deserialize, Serialize};
use std::path::PathBuf;

/// Feature flags a request may require. Backends advertise which ones they support, and the
/// broker routes accordingly (e.g. `ipadapter`/`custom_graph` → ComfyUI, plain txt2img → sd.cpp).
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct FeatureSet {
    pub img2img: bool,
    pub controlnet: bool,
    pub ipadapter: bool,
    pub inpaint: bool,
    pub custom_graph: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ImageRequest {
    pub prompt: String,
    #[serde(default)]
    pub negative: Option<String>,
    pub width: u32,
    pub height: u32,
    #[serde(default = "default_steps")]
    pub steps: u32,
    #[serde(default)]
    pub seed: Option<i64>,
    /// "flux", "sdxl", "sd3" — the backend resolves this to a concrete checkpoint.
    #[serde(default)]
    pub model_hint: Option<String>,
    /// Features this request needs; drives backend routing.
    #[serde(default)]
    pub features: FeatureSet,
    /// Source image for img2img / inpaint (required when `features.img2img` or `.inpaint`).
    #[serde(default)]
    pub input: Option<PathBuf>,
    /// Mask image for inpaint (paired with `input`).
    #[serde(default)]
    pub mask: Option<PathBuf>,
}
fn default_steps() -> u32 {
    20
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VideoRequest {
    pub prompt: String,
    pub seconds: f32,
    #[serde(default = "default_fps")]
    pub fps: u32,
    #[serde(default)]
    pub model_hint: Option<String>,
}
fn default_fps() -> u32 {
    24
}

/// A finished media output, registered into the project asset store.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MediaArtifact {
    pub asset_id: String,
    pub path: PathBuf,
    /// "image" | "video" | "audio".
    pub kind: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Progress {
    pub pct: f32,
    pub stage: String,
}

/// What an `ImageGenerator` can do — used by the broker to route a request.
#[derive(Debug, Clone)]
pub struct ImageCaps {
    /// Model families this backend can serve (e.g. `["sd15", "sdxl", "sd3", "flux"]`).
    pub models: &'static [&'static str],
    pub features: FeatureSet,
    /// true = in-process, always available (sd.cpp); false = external server (ComfyUI).
    pub embedded: bool,
    /// Lower = preferred. Native/light backends get a smaller number so they sort first.
    pub priority: u8,
}

impl ImageCaps {
    pub fn supports(&self, req: &ImageRequest) -> bool {
        let model_ok = req
            .model_hint
            .as_deref()
            .map(|m| self.models.contains(&m))
            .unwrap_or(true);
        let need = &req.features;
        let feat_ok = (!need.img2img || self.features.img2img)
            && (!need.controlnet || self.features.controlnet)
            && (!need.ipadapter || self.features.ipadapter)
            && (!need.inpaint || self.features.inpaint)
            && (!need.custom_graph || self.features.custom_graph);
        model_ok && feat_ok
    }
}

/// What a `VideoGenerator` can do.
#[derive(Debug, Clone)]
pub struct VideoCaps {
    pub models: &'static [&'static str],
    pub max_seconds: f32,
    pub embedded: bool,
    pub priority: u8,
}

impl VideoCaps {
    pub fn supports(&self, req: &VideoRequest) -> bool {
        let model_ok = req
            .model_hint
            .as_deref()
            .map(|m| self.models.contains(&m))
            .unwrap_or(true);
        model_ok && req.seconds <= self.max_seconds
    }
}
