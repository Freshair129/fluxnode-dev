//! Piper `SpeechSynthesizer` backend.
//!
//! Shells out to the bundled Piper CLI (`piper.exe`), piping the utterance text to its stdin and
//! asking it to write a WAV to `--output_file`. Mirrors the subprocess pattern used by the ffmpeg
//! sidecar in `lib.rs` (blocking child, serialized stdout/stderr capture), plus the Windows
//! `CREATE_NO_WINDOW` mandate so no console flashes / steals focus.
#![allow(dead_code)]

use std::io::Write;
use std::path::PathBuf;
use std::process::{Command, Stdio};

use crate::media::traits::SpeechSynthesizer;
use crate::media::types::MediaArtifact;

/// On Windows, prevent the spawned child from flashing a console window (which also steals focus
/// from the foreground app).
#[cfg(target_os = "windows")]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

/// Applies `CREATE_NO_WINDOW` on Windows; a no-op elsewhere.
fn no_window(cmd: &mut Command) -> &mut Command {
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    cmd
}

/// Piper local-ONNX text-to-speech backend.
///
/// - `bin`         — path to the Piper CLI executable (`piper.exe`).
/// - `voice_model` — path to the ONNX voice model (`*.onnx`); Piper also needs the sibling
///   `*.onnx.json` config next to it on disk.
/// - `out_dir`     — directory the synthesized `.wav` files are written into.
pub struct PiperBackend {
    bin: PathBuf,
    voice_model: PathBuf,
    out_dir: PathBuf,
}

impl PiperBackend {
    pub fn new(bin: PathBuf, voice_model: PathBuf, out_dir: PathBuf) -> Self {
        Self {
            bin,
            voice_model,
            out_dir,
        }
    }
}

impl SpeechSynthesizer for PiperBackend {
    fn id(&self) -> &str {
        "piper"
    }

    fn synth(&self, text: &str, voice: &str) -> Result<MediaArtifact, String> {
        // A per-utterance id doubles as the asset id and the output filename stem. Uses the process
        // id + a monotonic nanosecond clock to stay unique without pulling in a uuid dependency.
        let asset_id = format!(
            "piper-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_nanos())
                .unwrap_or(0)
        );

        std::fs::create_dir_all(&self.out_dir).map_err(|error| {
            format!(
                "failed to create piper out_dir ({}): {error}",
                self.out_dir.display()
            )
        })?;

        let wav_path = self.out_dir.join(format!("{asset_id}.wav"));

        // A caller may override the model per-request via `voice` (a path to an `.onnx`); otherwise
        // fall back to the backend's configured `voice_model`.
        let model: PathBuf = if voice.trim().is_empty() {
            self.voice_model.clone()
        } else {
            PathBuf::from(voice)
        };

        let mut child = no_window(&mut Command::new(&self.bin))
            .args([
                "--model",
                &model.to_string_lossy(),
                "--output_file",
                &wav_path.to_string_lossy(),
            ])
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|error| format!("failed to launch piper ({}): {error}", self.bin.display()))?;

        // Write the utterance to stdin, then drop the handle so Piper sees EOF and starts synth.
        {
            let mut stdin = child
                .stdin
                .take()
                .ok_or("failed to open piper stdin pipe")?;
            stdin
                .write_all(text.as_bytes())
                .map_err(|error| format!("failed to write text to piper stdin: {error}"))?;
            // `stdin` drops here, closing the pipe.
        }

        // Blocks until Piper exits, collecting stdout/stderr in one shot (serialized capture).
        let output = child
            .wait_with_output()
            .map_err(|error| format!("failed to wait on piper: {error}"))?;

        if !output.status.success() {
            return Err(format!(
                "piper exited with {}: {}",
                output.status,
                String::from_utf8_lossy(&output.stderr).trim()
            ));
        }

        if !wav_path.exists() {
            return Err(format!(
                "piper reported success but produced no WAV at {} (stderr: {})",
                wav_path.display(),
                String::from_utf8_lossy(&output.stderr).trim()
            ));
        }

        Ok(MediaArtifact {
            asset_id,
            path: wav_path,
            kind: "audio".into(),
        })
    }
}
