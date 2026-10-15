//! ComfyUI-backed [`ImageGenerator`].
//!
//! This is the "power path" backend: it wraps FluxNode's existing ComfyUI client
//! (`crate::comfy`) and drives a user-run ComfyUI server (BYOM). Because it is an
//! external server it advertises `embedded: false` and a *higher* priority number
//! than the native sd.cpp backend, so the broker prefers sd.cpp for simple
//! txt2img and only routes here when a feature (img2img / controlnet / ipadapter /
//! inpaint / custom_graph) demands ComfyUI.
//!
//! Flow of [`ComfyBackend::generate`]:
//!   1. translate the normalized [`ImageRequest`] into an `ai_generate` node-data
//!      `Value`, then into a ComfyUI prompt graph via `crate::comfy::build_comfy_prompt`;
//!   2. `submit_prompt` -> `wait_for_output` -> `fetch_image` to get PNG bytes;
//!   3. write the bytes to a temp PNG and return a [`MediaArtifact`].
//!
//! All I/O is blocking; the caller already holds an owned [`GpuLease`] for the
//! whole call. We keep `gpu` bound (named `_gpu`) so it is not dropped early — it
//! releases the GPU / reloads the brain only when `generate` returns.

use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};

use serde_json::json;
use tauri::AppHandle;

use crate::comfy::{build_comfy_prompt, fetch_image, submit_prompt, wait_for_output};
use crate::media::gpu::GpuLease;
use crate::media::traits::ImageGenerator;
use crate::media::types::{FeatureSet, ImageCaps, ImageRequest, MediaArtifact};

/// Default checkpoint used when a request does not pin one via `model_hint`.
/// FluxNode is BYOM, so this is only a best-effort fallback; the user's ComfyUI
/// server must actually have a checkpoint by this name for it to succeed.
const DEFAULT_CHECKPOINT: &str = "sd_xl_base_1.0.safetensors";

/// Monotonic counter used to make generated asset ids / filenames unique within a
/// process run (in addition to the ComfyUI prompt id).
static COUNTER: AtomicU64 = AtomicU64::new(0);

/// An [`ImageGenerator`] that renders a single image through a user-run ComfyUI server.
pub struct ComfyBackend {
    /// Base URL of the ComfyUI server, e.g. `http://127.0.0.1:8188`.
    endpoint: String,
    /// How long to wait for ComfyUI to produce an image before giving up.
    timeout_secs: u64,
}

impl ComfyBackend {
    /// Create a backend targeting `endpoint` (e.g. `http://127.0.0.1:8188`) with the
    /// given per-generation output timeout in seconds.
    pub fn new(endpoint: impl Into<String>, timeout_secs: u64) -> Self {
        Self {
            endpoint: endpoint.into(),
            timeout_secs,
        }
    }

    /// Convenience constructor using the conventional local ComfyUI endpoint and a
    /// 300s output timeout.
    pub fn local() -> Self {
        Self::new("http://127.0.0.1:8188", 300)
    }

    /// Map a normalized [`ImageRequest`] onto the `data` object that
    /// `build_comfy_prompt`'s `ai_generate` branch reads (see `crate::comfy`:
    /// field names `model`, `prompt`, `negativePrompt`, `steps`, `cfg`).
    fn node_data(req: &ImageRequest) -> serde_json::Value {
        let model = req
            .model_hint
            .as_deref()
            .filter(|m| !m.is_empty())
            .unwrap_or(DEFAULT_CHECKPOINT);

        let mut data = json!({
            "model": model,
            "prompt": req.prompt,
            "negativePrompt": req.negative.clone().unwrap_or_default(),
            "steps": req.steps,
            // ImageRequest carries no CFG; use the same default the translator uses.
            "cfg": 7.0,
            "width": req.width,
            "height": req.height,
        });
        if let Some(seed) = req.seed {
            data["seed"] = json!(seed);
        }
        data
    }
}

impl ImageGenerator for ComfyBackend {
    fn id(&self) -> &str {
        "comfyui"
    }

    fn caps(&self) -> ImageCaps {
        ImageCaps {
            // ComfyUI can serve any checkpoint family the user has installed.
            models: &["sdxl", "sd15", "sd3", "flux"],
            // The power path: everything is supported.
            features: FeatureSet {
                img2img: true,
                controlnet: true,
                ipadapter: true,
                inpaint: true,
                custom_graph: true,
            },
            // External user-run server, not in-process.
            embedded: false,
            // Higher than sd.cpp so the native backend wins simple cases; ComfyUI
            // is only picked when a feature it uniquely supports is requested.
            priority: 20,
        }
    }

    fn generate(
        &self,
        _app: &AppHandle,
        req: ImageRequest,
        gpu: GpuLease,
    ) -> Result<MediaArtifact, String> {
        let result = (|| {
            // 1. Build the ComfyUI prompt graph from the request. If the request carries a source
            //    image, drive img2img by passing its file name as the LoadImage input.
            //    TODO(comfy upload): ComfyUI resolves LoadImage names against its own `input/` dir,
            //    so the file must first be POSTed to `/upload/image`. Until staging exists, this
            //    relies on the user having placed the basename in ComfyUI's input folder.
            let data = Self::node_data(&req);
            let input_name = req
                .input
                .as_ref()
                .and_then(|p| p.file_name())
                .map(|n| n.to_string_lossy().into_owned());
            let prompt = build_comfy_prompt("ai_generate", &data, input_name.as_deref())
                .map_err(|e| format!("comfyui: failed to build prompt: {e}"))?;

            // 2. Submit, wait for the output image, then fetch its bytes.
            let prompt_id = submit_prompt(&self.endpoint, &prompt)
                .map_err(|e| format!("comfyui: submit failed: {e}"))?;
            let image_ref = wait_for_output(&self.endpoint, &prompt_id, self.timeout_secs)
                .map_err(|e| format!("comfyui: no output: {e}"))?;
            let bytes = fetch_image(&self.endpoint, &image_ref)
                .map_err(|e| format!("comfyui: fetch failed: {e}"))?;

            // 3. Derive a stable-ish, unique asset id and write the PNG to a temp path.
            let n = COUNTER.fetch_add(1, Ordering::Relaxed);
            let asset_id = format!("comfy-{prompt_id}-{n}");
            let path = write_png(&asset_id, &bytes)?;

            Ok(MediaArtifact {
                asset_id,
                path,
                kind: "image".into(),
            })
        })();

        gpu.finish_with(result)
    }
}

/// Write PNG `bytes` into the OS temp dir under a unique filename and return the
/// path. The broker / asset store may later move or re-register this file; a temp
/// location keeps this backend self-contained with no `AppHandle` path lookups.
fn write_png(asset_id: &str, bytes: &[u8]) -> Result<PathBuf, String> {
    let mut path = std::env::temp_dir();
    path.push(format!("fluxnode-{asset_id}.png"));
    std::fs::write(&path, bytes)
        .map_err(|e| format!("comfyui: failed to write {}: {e}", path.display()))?;
    Ok(path)
}
