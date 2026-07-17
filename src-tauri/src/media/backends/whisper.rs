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

use crate::media::traits::{Transcriber, Transcript, TranscriptSegment};

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
        // whisper.cpp only accepts 16 kHz mono 16-bit PCM WAV; anything else (mp4/mp3/48kHz/stereo)
        // makes the CLI error out. Decode + resample to a temp WAV via the bundled ffmpeg sidecar
        // first, transcribe that, then clean up the temp WAV and the `<tmp>.json` whisper leaves
        // beside it — regardless of success.
        let ffmpeg = crate::sidecar_path("ffmpeg");
        let tmp_wav = whisper_tmp_wav();
        let tmp_wav_str = tmp_wav.to_string_lossy().to_string();

        let result = convert_to_whisper_wav(&ffmpeg, audio_path, &tmp_wav_str)
            .and_then(|()| self.run_whisper(&tmp_wav_str));

        let _ = std::fs::remove_file(&tmp_wav);
        let _ = std::fs::remove_file(format!("{tmp_wav_str}.json"));

        result
    }
}

impl WhisperBackend {
    /// Run the whisper.cpp CLI on an already-16kHz-mono WAV and parse its JSON output.
    fn run_whisper(&self, wav_path: &str) -> Result<Transcript, String> {
        // `-oj` (== `--output-json`) writes `<wav_path>.json` next to the input. We ask for it and
        // then read that file back. `-nt` (no-timestamps) is intentionally NOT set — we want the
        // per-segment start/end offsets that the JSON carries.
        let output = no_window(&mut Command::new(&self.bin))
            .args(["-m", &self.model.to_string_lossy(), "-f", wav_path, "-oj"])
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

        // whisper.cpp writes the JSON to `<wav_path>.json` (input path + ".json" suffix).
        let json_path = format!("{wav_path}.json");
        let raw = std::fs::read_to_string(&json_path).map_err(|error| {
            format!(
                "whisper.cpp produced no JSON at {json_path}: {error} (stderr: {})",
                String::from_utf8_lossy(&output.stderr).trim()
            )
        })?;

        parse_whisper_json(&raw)
    }
}

/// A unique temp path for the resampled WAV. Uniqueness (pid + a process-local counter) avoids
/// collisions when several transcriptions run concurrently; no timestamp needed.
fn whisper_tmp_wav() -> PathBuf {
    use std::sync::atomic::{AtomicU64, Ordering};
    static COUNTER: AtomicU64 = AtomicU64::new(0);
    let n = COUNTER.fetch_add(1, Ordering::Relaxed);
    std::env::temp_dir().join(format!("fluxnode-whisper-{}-{n}.wav", std::process::id()))
}

/// Decode + resample any audio/video to whisper.cpp's required 16 kHz mono 16-bit PCM WAV via the
/// bundled ffmpeg sidecar.
fn convert_to_whisper_wav(ffmpeg: &std::path::Path, input: &str, out_wav: &str) -> Result<(), String> {
    let output = no_window(&mut Command::new(ffmpeg))
        .args([
            "-y", "-v", "error", "-i", input, "-vn", "-ar", "16000", "-ac", "1", "-c:a",
            "pcm_s16le", out_wav,
        ])
        .output()
        .map_err(|error| format!("failed to launch ffmpeg ({}): {error}", ffmpeg.display()))?;

    if !output.status.success() {
        return Err(format!(
            "ffmpeg failed to resample {input} for whisper ({}): {}",
            output.status,
            String::from_utf8_lossy(&output.stderr).trim()
        ));
    }
    Ok(())
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_whisper_json_maps_offsets_to_seconds() {
        let raw = r#"{ "transcription": [
            { "offsets": { "from": 0, "to": 2500 }, "text": " Hello world" },
            { "offsets": { "from": 3000, "to": 4200 }, "text": " again" }
        ] }"#;
        let t = parse_whisper_json(raw).unwrap();
        assert_eq!(t.text, "Hello world again");
        assert_eq!(t.segments.len(), 2);
        assert_eq!(t.segments[0].start, 0.0);
        assert_eq!(t.segments[0].end, 2.5);
        assert_eq!(t.segments[0].text, "Hello world");
        assert_eq!(t.segments[1].start, 3.0);
        assert_eq!(t.segments[1].end, 4.2);
    }

    #[test]
    fn parse_whisper_json_rejects_malformed() {
        assert!(parse_whisper_json("{}").is_err());
        assert!(parse_whisper_json("not json").is_err());
    }

    /// Integration: the ffmpeg pre-convert must emit exactly what whisper.cpp requires — 16 kHz
    /// mono 16-bit PCM. Skips cleanly if the ffmpeg/ffprobe sidecars aren't staged (e.g. CI without
    /// bundled binaries).
    #[test]
    fn pre_convert_produces_16khz_mono_pcm() {
        let ffmpeg = crate::sidecar_path("ffmpeg");
        let ffprobe = crate::sidecar_path("ffprobe");
        if !ffmpeg.exists() || !ffprobe.exists() {
            eprintln!("skipping pre_convert test: ffmpeg/ffprobe sidecar not present");
            return;
        }

        let dir = std::env::temp_dir();
        let src = dir.join("fluxnode-whisper-pretest-src.wav");
        let out = dir.join("fluxnode-whisper-pretest-out.wav");
        let src_str = src.to_string_lossy().to_string();
        let out_str = out.to_string_lossy().to_string();

        // A deliberately non-conforming source: 48 kHz stereo.
        let gen = no_window(&mut Command::new(&ffmpeg))
            .args([
                "-y", "-v", "error", "-f", "lavfi", "-i",
                "sine=frequency=440:sample_rate=48000", "-ac", "2", "-t", "1", &src_str,
            ])
            .output()
            .expect("run ffmpeg to make the test source");
        assert!(gen.status.success(), "ffmpeg source gen failed");

        convert_to_whisper_wav(&ffmpeg, &src_str, &out_str).expect("pre-convert");

        let probe = no_window(&mut Command::new(&ffprobe))
            .args([
                "-v", "error", "-select_streams", "a:0", "-show_entries",
                "stream=codec_name,sample_rate,channels", "-of", "default=noprint_wrappers=1",
                &out_str,
            ])
            .output()
            .expect("run ffprobe");
        let report = String::from_utf8_lossy(&probe.stdout);

        let _ = std::fs::remove_file(&src);
        let _ = std::fs::remove_file(&out);

        assert!(report.contains("codec_name=pcm_s16le"), "report: {report}");
        assert!(report.contains("sample_rate=16000"), "report: {report}");
        assert!(report.contains("channels=1"), "report: {report}");
    }
}
