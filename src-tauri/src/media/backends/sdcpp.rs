//! stable-diffusion.cpp (`sd` CLI) `ImageGenerator` backend.
//!
//! Shells out to the bundled stable-diffusion.cpp CLI (`sd.exe`) exactly like the ffmpeg sidecar
//! path in `lib.rs` and the sibling `whisper.rs` backend (blocking `Command::output()` +
//! `CREATE_NO_WINDOW` on Windows). Maps the frozen `ImageRequest` contract onto `sd`'s flags and
//! returns a `MediaArtifact` pointing at the emitted PNG.
//!
//! This is the fast / native image path: it has no Python/ComfyUI server dependency and is always
//! embedded, so it is preferred (`priority: 10`) over the ComfyUI backend for the common txt2img /
//! img2img / inpaint / controlnet case. It deliberately does NOT advertise `ipadapter` or
//! `custom_graph` — those node-graph chains route to ComfyUI.
#![allow(dead_code)]

use std::path::PathBuf;
use std::process::Command;
use std::sync::atomic::{AtomicU64, Ordering};

use tauri::AppHandle;

use crate::media::gpu::GpuLease;
use crate::media::traits::ImageGenerator;
use crate::media::types::{FeatureSet, ImageCaps, ImageRequest, MediaArtifact};

/// On Windows, prevent the spawned child from flashing a console window (which also steals focus
/// from the foreground app). Mirrors the mandate to set `CREATE_NO_WINDOW` on every spawn.
#[cfg(target_os = "windows")]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

/// Applies `CREATE_NO_WINDOW` on Windows; a no-op elsewhere. Keeps the call-sites clean and the
/// platform `#[cfg]` in one place.
fn no_window(cmd: &mut Command) -> &mut Command {
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    cmd
}

/// Monotonic counter used to derive unique asset ids / output filenames without touching the wall
/// clock (`Date::now`). Process-lifetime unique; combined with the pid-free `out_dir` this is enough
/// to avoid collisions between concurrent generations (which the `GpuLease` already serializes).
static COUNTER: AtomicU64 = AtomicU64::new(0);

/// stable-diffusion.cpp text/image-to-image backend.
///
/// - `bin`     — path to the `sd` CLI executable (`sd.exe` on Windows).
/// - `model`   — path to the diffusion checkpoint (a `.gguf` / `.safetensors` model file).
/// - `out_dir` — directory the emitted `.png` files are written to.
pub struct SdCppBackend {
    bin: PathBuf,
    model: PathBuf,
    out_dir: PathBuf,
}

impl SdCppBackend {
    pub fn new(bin: PathBuf, model: PathBuf, out_dir: PathBuf) -> Self {
        Self {
            bin,
            model,
            out_dir,
        }
    }
}

impl ImageGenerator for SdCppBackend {
    fn id(&self) -> &str {
        "stable-diffusion.cpp"
    }

    fn caps(&self) -> ImageCaps {
        ImageCaps {
            models: &["sd15", "sdxl", "sd3", "flux"],
            features: FeatureSet {
                img2img: true,
                controlnet: true,
                inpaint: true,
                // sd.cpp is the fast/native path but lacks node-graph & ip-adapter chains — those
                // requests route to the ComfyUI backend instead.
                ipadapter: false,
                custom_graph: false,
            },
            // In-process CLI, no external server to stand up.
            embedded: true,
            // Lower = preferred. 10 < ComfyBackend's 20, so sd.cpp wins the simple common case.
            priority: 10,
        }
    }

    fn generate(
        &self,
        _app: &AppHandle,
        req: ImageRequest,
        gpu: GpuLease,
    ) -> Result<MediaArtifact, String> {
        let result = (|| {
            // Unique, clock-free id → both the asset id and the output filename.
            let n = COUNTER.fetch_add(1, Ordering::Relaxed);
            let asset_id = format!("sdcpp-{n}");
            let out_path = self.out_dir.join(format!("{asset_id}.png"));

            // Ensure the output directory exists so `sd` can write into it.
            if let Some(parent) = out_path.parent() {
                std::fs::create_dir_all(parent).map_err(|error| {
                    format!(
                        "failed to create sd.cpp output dir ({}): {error}",
                        parent.display()
                    )
                })?;
            }

            let model = self.model.to_string_lossy().to_string();
            let out = out_path.to_string_lossy().to_string();
            let width = req.width.to_string();
            let height = req.height.to_string();
            let steps = req.steps.to_string();

            let mut cmd = Command::new(&self.bin);
            no_window(&mut cmd);

            // Mode: txt2img by default; img2img when the request asks for it (or inpaint, which sd.cpp
            // also drives through the img2img `-M img2img` mode with a mask — the mask/input plumbing
            // is the TODO below).
            if req.features.img2img || req.features.inpaint {
                cmd.args(["-M", "img2img"]);
                // img2img / inpaint need a source image; error early with a clear message if missing.
                let input = req.input.as_ref().ok_or_else(|| {
                    "sd.cpp img2img/inpaint requires ImageRequest.input (source image)".to_string()
                })?;
                cmd.args(["-i", &input.to_string_lossy()]);
                // Inpaint additionally takes a mask (paired with the source image).
                if let Some(mask) = req.mask.as_ref() {
                    cmd.args(["--mask", &mask.to_string_lossy()]);
                }
            } else {
                cmd.args(["-M", "txt2img"]);
            }

            cmd.args(["-m", &model]);
            cmd.args(["-p", &req.prompt]);
            if let Some(negative) = req.negative.as_deref() {
                cmd.args(["-n", negative]);
            }
            cmd.args(["-W", &width]);
            cmd.args(["-H", &height]);
            cmd.args(["--steps", &steps]);
            if let Some(seed) = req.seed {
                cmd.args(["-s", &seed.to_string()]);
            }
            cmd.args(["-o", &out]);

            let output = cmd.output().map_err(|error| {
                format!("failed to launch sd.cpp ({}): {error}", self.bin.display())
            })?;

            if !output.status.success() {
                return Err(format!(
                    "sd.cpp exited with {}: {}",
                    output.status,
                    String::from_utf8_lossy(&output.stderr).trim()
                ));
            }

            // sd.cpp is expected to have written the PNG at `-o`; verify before registering the artifact.
            if !out_path.exists() {
                return Err(format!(
                    "sd.cpp reported success but no image at {} (stderr: {})",
                    out_path.display(),
                    String::from_utf8_lossy(&output.stderr).trim()
                ));
            }

            Ok(MediaArtifact {
                asset_id,
                path: out_path,
                kind: "image".into(),
            })
        })();

        gpu.finish_with(result)
    }
}
