//! whisper.cpp `Transcriber` backend.
//!
//! Shells out to the bundled whisper.cpp CLI (`whisper-cli.exe` / `main.exe`) exactly like the
//! ffmpeg sidecar path in `lib.rs` (blocking `Command::output()`), parses the emitted JSON, and
//! maps it onto the frozen `Transcript` / `TranscriptSegment` contract in `super::super::traits`.
//!
//! CPU-bound: the `Transcriber` trait takes no `GpuLease`.
#![allow(dead_code)]

use std::path::PathBuf;
use std::process::Command;

use serde_json::Value;

use crate::media::traits::{Transcript, Transcriber, TranscriptSegment};

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

/// whisper.cpp speech-to-text backend.
///
/// - `bin`   — path to the whisper.cpp CLI executable (`whisper-cli.exe` or legacy `main.exe`).
/// - `model` — path to the GGML/GGUF model file (e.g. `ggml-base.en.bin`).
pub struct WhisperBackend {
    bin: PathBuf,
    model: PathBuf,
}

impl WhisperBackend {
    pub fn new(bin: PathBuf, model: PathBuf) -> Self {
        Self { bin, model }
    }
}

impl Transcriber for WhisperBackend {
    fn id(&self) -> &str {
        "whisper.cpp"
    }

    fn transcribe(&self, audio_path: &str) -> Result<Transcript, String> {
        // TODO(ffmpeg pre-convert): whisper.cpp only accepts 16kHz mono 16-bit PCM WAV. If
        // `audio_path` is anything else (mp4/mp3/48kHz/stereo) the CLI errors out. The lead should
        // decode+resample first via the existing ffmpeg sidecar, e.g.:
        //   ffmpeg -i <audio_path> -ar 16000 -ac 1 -c:a pcm_s16le <tmp>.wav
        // using `sidecar_path("ffmpeg")` from lib.rs, then pass <tmp>.wav here. Not implemented
        // here to avoid duplicating the sidecar resolver / ffmpeg piping in this file.

        // `-oj` (== `--output-json`) writes `<audio_path>.json` next to the input. We ask for it and
        // then read that file back. `-nt` (no-timestamps) is intentionally NOT set — we want the
        // per-segment start/end offsets that the JSON carries.
        let output = no_window(&mut Command::new(&self.bin))
            .args([
                "-m",
                &self.model.to_string_lossy(),
                "-f",
                audio_path,
                "-oj",
            ])
            .output()
            .map_err(|error| {
                format!(
                    "failed to launch whisper.cpp ({}): {error}",
                    self.bin.display()
                )
            })?;

        if !output.status.success() {
            return Err(format!(
                "whisper.cpp exited with {}: {}",
                output.status,
                String::from_utf8_lossy(&output.stderr).trim()
            ));
        }

        // whisper.cpp writes the JSON to `<audio_path>.json` (input path + ".json" suffix).
        let json_path = format!("{audio_path}.json");
        let raw = std::fs::read_to_string(&json_path).map_err(|error| {
            format!(
                "whisper.cpp produced no JSON at {json_path}: {error} (stderr: {})",
                String::from_utf8_lossy(&output.stderr).trim()
            )
        })?;

        parse_whisper_json(&raw)
    }
}

/// Parses whisper.cpp `-oj` output into the frozen `Transcript` contract.
///
/// The JSON shape is:
/// ```json
/// { "transcription": [
///     { "timestamps": { "from": "00:00:00,000", "to": "00:00:02,500" },
///       "offsets":    { "from": 0, "to": 2500 },
///       "text": " Hello world" }
/// ] }
/// ```
/// `offsets.from` / `offsets.to` are integer milliseconds — the most robust field to key on
/// (independent of the human-readable `timestamps` formatting).
fn parse_whisper_json(raw: &str) -> Result<Transcript, String> {
    let root: Value =
        serde_json::from_str(raw).map_err(|error| format!("invalid whisper JSON: {error}"))?;

    let items = root
        .get("transcription")
        .and_then(|value| value.as_array())
        .ok_or("whisper JSON missing `transcription` array")?;

    let mut segments = Vec::with_capacity(items.len());
    let mut full = String::new();

    for item in items {
        let text = item
            .get("text")
            .and_then(|value| value.as_str())
            .unwrap_or("")
            .trim()
            .to_string();

        let start = item
            .get("offsets")
            .and_then(|off| off.get("from"))
            .and_then(|value| value.as_f64())
            .map(|ms| ms / 1000.0)
            .unwrap_or(0.0);
        let end = item
            .get("offsets")
            .and_then(|off| off.get("to"))
            .and_then(|value| value.as_f64())
            .map(|ms| ms / 1000.0)
            .unwrap_or(start);

        if !text.is_empty() {
            if !full.is_empty() {
                full.push(' ');
            }
            full.push_str(&text);
        }

        segments.push(TranscriptSegment { start, end, text });
    }

    Ok(Transcript {
        text: full,
        segments,
    })
}
