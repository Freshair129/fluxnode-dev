//! Pure ffmpeg argument-vector compiler for FluxNode multi-track compositing.
//!
//! This module turns a `FluxNodeProject` timeline plus a `RenderPreset` into a
//! complete ffmpeg argv (everything AFTER the binary path). It performs FULL
//! multi-track compositing in a single `-filter_complex` graph: a black canvas
//! base, every video clip trimmed/timeshifted/scaled/rotated/faded and overlaid
//! in z-order, and every audio-bearing clip trimmed/retimed/gained/delayed and
//! mixed down.
//!
//! It is intentionally PURE: no process spawning, no filesystem access, no
//! global state. Everything is derived from the two input JSON values, so it is
//! fully unit-testable. The caller is responsible for prepending the ffmpeg
//! binary path and actually executing the result.
//!
//! ## Conventions
//!
//! * **Z-order**: video tracks are composited in their array order, and clips
//!   within a track likewise in array order. Layers added later overlay on top
//!   of earlier ones, so the LAST video track in `timeline.tracks` renders on
//!   TOP. This mirrors how editors stack tracks "front = last".
//! * **rotation**: `transform.rotation` is interpreted as RADIANS, matching the
//!   native unit of ffmpeg's `rotate` filter. A value of `0` is a no-op.
//! * **inputs**: one ffmpeg `-i` input is emitted per compositing clip (video or
//!   audio). No input deduplication — simplest and unambiguous for mapping.

use serde_json::Value;

/// A fully-compiled render plan: the ffmpeg argv (after the binary) plus the
/// total frame count for the composited timeline.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RenderPlan {
    /// ffmpeg arguments AFTER the binary path, e.g.
    /// `["-y", "-i", src0, "-i", src1, "-filter_complex", graph, "-map",
    /// "[vout]", "-map", "[aout]", "-c:v", enc, ..., output_path]`.
    pub args: Vec<String>,
    /// `ceil(timeline_duration_seconds * fps)`.
    pub total_frames: u32,
}

// ---------------------------------------------------------------------------
// Small JSON accessors
// ---------------------------------------------------------------------------

fn obj_f64(v: &Value, key: &str) -> Option<f64> {
    v.get(key).and_then(|x| x.as_f64())
}

fn obj_str<'a>(v: &'a Value, key: &str) -> Option<&'a str> {
    v.get(key).and_then(|x| x.as_str())
}

fn obj_bool(v: &Value, key: &str) -> bool {
    v.get(key).and_then(|x| x.as_bool()).unwrap_or(false)
}

/// Format an f64 compactly for ffmpeg (no trailing scientific notation, no
/// needless `.0` clutter beyond what's useful). We keep up to 6 decimals.
fn num(x: f64) -> String {
    if x.is_finite() {
        // Trim trailing zeros while keeping at least one digit.
        let s = format!("{:.6}", x);
        let s = s.trim_end_matches('0');
        let s = s.trim_end_matches('.');
        if s.is_empty() || s == "-" {
            "0".to_string()
        } else {
            s.to_string()
        }
    } else {
        "0".to_string()
    }
}

// ---------------------------------------------------------------------------
// Resolution / fps / duration resolution
// ---------------------------------------------------------------------------

/// Resolve a `{width,height}` object out of a JSON value, if present and valid.
fn resolution_of(v: Option<&Value>) -> Option<(u32, u32)> {
    let v = v?;
    let obj = v.as_object()?;
    let w = obj.get("width").and_then(|x| x.as_f64())?;
    let h = obj.get("height").and_then(|x| x.as_f64())?;
    if w >= 1.0 && h >= 1.0 {
        Some((w.round() as u32, h.round() as u32))
    } else {
        None
    }
}

/// Canvas dimensions: preset.resolution (when an explicit object) overrides
/// project.settings.resolution; falls back to 1920x1080.
fn resolve_canvas(project: &Value, preset: &Value) -> (u32, u32) {
    if let Some(res) = resolution_of(preset.get("resolution")) {
        return res;
    }
    if let Some(res) = resolution_of(project.get("settings").and_then(|s| s.get("resolution"))) {
        return res;
    }
    (1920, 1080)
}

/// Frames-per-second: preset.frameRate (when numeric) overrides
/// project.settings.frameRate; falls back to 30.
fn resolve_fps(project: &Value, preset: &Value) -> f64 {
    if let Some(fps) = preset.get("frameRate").and_then(|x| x.as_f64()) {
        if fps > 0.0 {
            return fps;
        }
    }
    if let Some(fps) = project
        .get("settings")
        .and_then(|s| s.get("frameRate"))
        .and_then(|x| x.as_f64())
    {
        if fps > 0.0 {
            return fps;
        }
    }
    30.0
}

/// Total timeline duration = max(startTime + duration) across all clips on all
/// tracks. Returns 0.0 for an empty timeline.
fn timeline_duration(project: &Value) -> f64 {
    let mut dur = 0.0_f64;
    let tracks = project
        .get("timeline")
        .and_then(|t| t.get("tracks"))
        .and_then(|t| t.as_array());
    if let Some(tracks) = tracks {
        for track in tracks {
            if let Some(clips) = track.get("clips").and_then(|c| c.as_array()) {
                for clip in clips {
                    let start = obj_f64(clip, "startTime").unwrap_or(0.0);
                    let d = obj_f64(clip, "duration").unwrap_or(0.0);
                    dur = dur.max(start + d);
                }
            }
        }
    }
    dur
}

// ---------------------------------------------------------------------------
// Asset lookup
// ---------------------------------------------------------------------------

fn asset_for<'a>(project: &'a Value, asset_id: &str) -> Option<&'a Value> {
    project
        .get("assets")
        .and_then(|a| a.get("assets"))
        .and_then(|a| a.as_object())
        .and_then(|m| m.get(asset_id))
}

fn asset_source_path(asset: &Value) -> Option<String> {
    obj_str(asset, "sourcePath").map(|s| s.to_string())
}

/// A video-bearing asset can supply pixels: `video` or `image`.
fn asset_has_video(asset: &Value) -> bool {
    matches!(obj_str(asset, "type"), Some("video") | Some("image"))
}

/// An audio-bearing asset can supply samples: `audio` or `video`
/// (a video clip's embedded audio track).
fn asset_has_audio(asset: &Value) -> bool {
    matches!(obj_str(asset, "type"), Some("video") | Some("audio"))
}

// ---------------------------------------------------------------------------
// Encoder selection
// ---------------------------------------------------------------------------

/// Map a preset's codec/format to a concrete ffmpeg video encoder.
///
/// h264 -> h264_nvenc, hevc/h265 -> hevc_nvenc, vp9/webm -> libvpx-vp9,
/// prores -> prores_ks, av1 -> libaom-av1, else fallback mpeg4.
pub fn select_video_encoder(preset: &Value) -> &'static str {
    let codec = obj_str(preset, "videoCodec")
        .unwrap_or("")
        .to_ascii_lowercase();
    let format = obj_str(preset, "format").unwrap_or("").to_ascii_lowercase();

    match codec.as_str() {
        "h264" | "avc" => return "h264_nvenc",
        "h265" | "hevc" => return "hevc_nvenc",
        "vp9" => return "libvpx-vp9",
        "prores" => return "prores_ks",
        "av1" => return "libaom-av1",
        _ => {}
    }

    match format.as_str() {
        "webm" => "libvpx-vp9",
        "mov" => "prores_ks",
        _ => "mpeg4",
    }
}

/// Quality flag pair appropriate for the chosen encoder.
fn quality_args(encoder: &str, preset: &Value) -> Vec<String> {
    let quality = obj_str(preset, "quality").unwrap_or("high");
    match encoder {
        "h264_nvenc" | "hevc_nvenc" => {
            let cq = match quality {
                "draft" => "32",
                "medium" => "26",
                "high" => "20",
                "lossless" => "12",
                _ => "20",
            };
            vec!["-cq".to_string(), cq.to_string()]
        }
        "libvpx-vp9" => {
            let crf = match quality {
                "draft" => "40",
                "medium" => "33",
                "high" => "24",
                "lossless" => "10",
                _ => "24",
            };
            vec![
                "-crf".to_string(),
                crf.to_string(),
                "-b:v".to_string(),
                "0".to_string(),
            ]
        }
        "libaom-av1" => {
            let crf = match quality {
                "draft" => "45",
                "medium" => "36",
                "high" => "28",
                "lossless" => "12",
                _ => "30",
            };
            vec![
                "-crf".to_string(),
                crf.to_string(),
                "-b:v".to_string(),
                "0".to_string(),
            ]
        }
        "prores_ks" => {
            // ProRes profile: 3 = HQ, 4 = 4444 for lossless.
            let profile = if quality == "lossless" { "4" } else { "3" };
            vec!["-profile:v".to_string(), profile.to_string()]
        }
        // mpeg4 and anything else: use a qscale.
        _ => {
            let q = match quality {
                "draft" => "8",
                "medium" => "5",
                "high" => "3",
                "lossless" => "1",
                _ => "3",
            };
            vec!["-q:v".to_string(), q.to_string()]
        }
    }
}

// ---------------------------------------------------------------------------
// Filter graph construction
// ---------------------------------------------------------------------------

/// One compositing clip resolved against its asset, with its assigned ffmpeg
/// input index.
struct ResolvedClip {
    input_index: usize,
    #[allow(dead_code)] // kept for debugging/inspection of the resolved graph
    source_path: String,
    start_time: f64,
    in_point: f64,
    out_point: f64,
    speed: f64,
    volume: f64,
    opacity: f64,
    // transform
    tx: f64,
    ty: f64,
    scale_x: f64,
    scale_y: f64,
    rotation: f64,
}

fn read_transform(clip: &Value) -> (f64, f64, f64, f64, f64) {
    let t = clip.get("transform");
    let g = |key: &str, default: f64| t.and_then(|t| obj_f64(t, key)).unwrap_or(default);
    (
        g("x", 0.0),
        g("y", 0.0),
        g("scaleX", 1.0),
        g("scaleY", 1.0),
        g("rotation", 0.0),
    )
}

/// Build an atempo filter chain that realizes an arbitrary speed multiplier.
/// ffmpeg's atempo accepts 0.5..=2.0 per instance, so we decompose.
fn atempo_chain(speed: f64) -> String {
    let mut s = speed;
    if !(s.is_finite()) || s <= 0.0 {
        s = 1.0;
    }
    if (s - 1.0).abs() < 1e-6 {
        return "atempo=1.0".to_string();
    }
    let mut factors: Vec<f64> = Vec::new();
    let mut remaining = s;
    // Decompose speed-up (>2.0) into chained 2.0 stages.
    while remaining > 2.0 {
        factors.push(2.0);
        remaining /= 2.0;
    }
    // Decompose slow-down (<0.5) into chained 0.5 stages.
    while remaining < 0.5 {
        factors.push(0.5);
        remaining /= 0.5;
    }
    factors.push(remaining);
    factors
        .into_iter()
        .map(|f| format!("atempo={}", num(f)))
        .collect::<Vec<_>>()
        .join(",")
}

/// Audio solo/mute resolution. Returns the set of track indices (by their
/// position among ALL tracks) that should be audible. If any track is soloed,
/// only soloed (and non-muted) tracks are audible; otherwise all non-muted.
fn audible_tracks(project: &Value) -> Vec<bool> {
    let tracks = project
        .get("timeline")
        .and_then(|t| t.get("tracks"))
        .and_then(|t| t.as_array())
        .cloned()
        .unwrap_or_default();

    let any_solo = tracks.iter().any(|t| obj_bool(t, "solo"));
    tracks
        .iter()
        .map(|t| {
            let muted = obj_bool(t, "muted");
            let solo = obj_bool(t, "solo");
            if muted {
                false
            } else if any_solo {
                solo
            } else {
                true
            }
        })
        .collect()
}

/// Compile the full render plan.
pub fn build_render_plan(
    project: &Value,
    preset: &Value,
    output_path: &str,
) -> Result<RenderPlan, String> {
    if !project.is_object() {
        return Err("project must be a JSON object".to_string());
    }
    if !preset.is_object() {
        return Err("preset must be a JSON object".to_string());
    }

    let (canvas_w, canvas_h) = resolve_canvas(project, preset);
    let fps = resolve_fps(project, preset);
    let duration = timeline_duration(project);
    // Base duration must be > 0 for lavfi color; clamp to a single frame.
    let base_duration = if duration > 0.0 { duration } else { 1.0 / fps };
    let total_frames = (duration * fps).ceil() as u32;

    let master_volume = project
        .get("audio")
        .and_then(|a| obj_f64(a, "masterVolume"))
        .unwrap_or(1.0);

    let tracks = project
        .get("timeline")
        .and_then(|t| t.get("tracks"))
        .and_then(|t| t.as_array())
        .cloned()
        .unwrap_or_default();

    let audible = audible_tracks(project);

    // Collect video and audio compositing clips, assigning input indices in a
    // single shared input list (one -i per clip).
    let mut inputs: Vec<String> = Vec::new();
    let mut video_clips: Vec<ResolvedClip> = Vec::new();
    let mut audio_clips: Vec<ResolvedClip> = Vec::new();

    for (track_idx, track) in tracks.iter().enumerate() {
        let track_type = obj_str(track, "type").unwrap_or("");
        let track_volume = obj_f64(track, "volume").unwrap_or(1.0);
        let track_audible = audible.get(track_idx).copied().unwrap_or(true);
        let clips = match track.get("clips").and_then(|c| c.as_array()) {
            Some(c) => c,
            None => continue,
        };

        for clip in clips {
            let asset_id = match obj_str(clip, "assetId") {
                Some(id) => id,
                None => continue,
            };
            let asset = match asset_for(project, asset_id) {
                Some(a) => a,
                None => continue,
            };
            let source = match asset_source_path(asset) {
                Some(p) => p,
                None => continue,
            };

            let start_time = obj_f64(clip, "startTime").unwrap_or(0.0);
            let in_point = obj_f64(clip, "inPoint").unwrap_or(0.0);
            let out_point = obj_f64(clip, "outPoint")
                .unwrap_or_else(|| in_point + obj_f64(clip, "duration").unwrap_or(0.0));
            let mut speed = obj_f64(clip, "speed").unwrap_or(1.0);
            if !speed.is_finite() || speed <= 0.0 {
                speed = 1.0;
            }
            let clip_volume = obj_f64(clip, "volume").unwrap_or(1.0);
            let opacity = obj_f64(clip, "opacity").unwrap_or(1.0);
            let (tx, ty, scale_x, scale_y, rotation) = read_transform(clip);

            // VIDEO compositing: only on video tracks, with video-bearing asset.
            if track_type == "video" && asset_has_video(asset) {
                let input_index = inputs.len();
                inputs.push(source.clone());
                video_clips.push(ResolvedClip {
                    input_index,
                    source_path: source.clone(),
                    start_time,
                    in_point,
                    out_point,
                    speed,
                    volume: clip_volume,
                    opacity,
                    tx,
                    ty,
                    scale_x,
                    scale_y,
                    rotation,
                });
            }

            // AUDIO compositing: any audio-bearing asset on an audible track.
            // Covers dedicated audio tracks AND video clips' embedded audio.
            if track_audible && asset_has_audio(asset) && track_type != "subtitle" {
                let effective_volume = clip_volume * track_volume * master_volume;
                let input_index = inputs.len();
                inputs.push(source.clone());
                audio_clips.push(ResolvedClip {
                    input_index,
                    source_path: source,
                    start_time,
                    in_point,
                    out_point,
                    speed,
                    volume: effective_volume,
                    opacity,
                    tx,
                    ty,
                    scale_x,
                    scale_y,
                    rotation,
                });
            }
        }
    }

    // ---- Build the filter_complex graph ----
    let mut graph_parts: Vec<String> = Vec::new();

    // VIDEO: black base canvas.
    let base_label = "base";
    graph_parts.push(format!(
        "color=c=black:s={}x{}:r={}:d={}[{}]",
        canvas_w,
        canvas_h,
        num(fps),
        num(base_duration),
        base_label
    ));

    // Each video clip: trim -> setpts (retime + shift) -> scale -> [rotate] ->
    // [opacity] -> overlay onto the accumulating base.
    let mut accum = base_label.to_string();
    for (i, vc) in video_clips.iter().enumerate() {
        let src_label = format!("v{}src", i);
        let effective_dur = (vc.out_point - vc.in_point).max(0.0) / vc.speed;
        let end_t = vc.start_time + effective_dur;

        // Per-clip processing chain on input [idx:v].
        let mut chain: Vec<String> = Vec::new();
        chain.push(format!(
            "trim=start={}:end={}",
            num(vc.in_point),
            num(vc.out_point)
        ));
        // Retime by speed and shift onto the timeline.
        chain.push(format!(
            "setpts=(PTS-STARTPTS)/{}+{}/TB",
            num(vc.speed),
            num(vc.start_time)
        ));
        // Scale relative to canvas using the clip's scale factors.
        let sw = (canvas_w as f64 * vc.scale_x).round().max(1.0);
        let sh = (canvas_h as f64 * vc.scale_y).round().max(1.0);
        chain.push(format!("scale={}:{}", sw as i64, sh as i64));
        // Rotation (radians), only when non-zero.
        if vc.rotation.abs() > 1e-6 {
            chain.push(format!(
                "rotate={}:c=none:ow=rotw({}):oh=roth({})",
                num(vc.rotation),
                num(vc.rotation),
                num(vc.rotation)
            ));
        }
        // Opacity via alpha multiply when < 1.
        if vc.opacity < 1.0 - 1e-6 {
            chain.push("format=yuva420p".to_string());
            chain.push(format!("colorchannelmixer=aa={}", num(vc.opacity)));
        }

        graph_parts.push(format!(
            "[{}:v]{}[{}]",
            vc.input_index,
            chain.join(","),
            src_label
        ));

        // Overlay this processed layer onto the accumulator, enabled only
        // during the clip's active window.
        let out_label = if i + 1 == video_clips.len() {
            "vout".to_string()
        } else {
            format!("vtmp{}", i)
        };
        graph_parts.push(format!(
            "[{}][{}]overlay=x={}:y={}:enable='between(t,{},{})'[{}]",
            accum,
            src_label,
            num(vc.tx),
            num(vc.ty),
            num(vc.start_time),
            num(end_t),
            out_label
        ));
        accum = out_label;
    }

    // If there were no video clips at all, the base IS the output.
    let video_out_label = if video_clips.is_empty() {
        // Relabel base -> vout via a passthrough null so the map target exists.
        graph_parts.push(format!("[{}]null[vout]", base_label));
        "vout".to_string()
    } else {
        accum
    };

    // AUDIO: per-clip atrim -> asetpts -> atempo -> volume -> adelay, then amix.
    let has_audio = !audio_clips.is_empty();
    let mut audio_labels: Vec<String> = Vec::new();
    for (i, ac) in audio_clips.iter().enumerate() {
        let label = format!("a{}", i);
        let delay_ms = (ac.start_time * 1000.0).max(0.0);
        let mut chain: Vec<String> = Vec::new();
        chain.push(format!(
            "atrim=start={}:end={}",
            num(ac.in_point),
            num(ac.out_point)
        ));
        chain.push("asetpts=PTS-STARTPTS".to_string());
        chain.push(atempo_chain(ac.speed));
        chain.push(format!("volume={}", num(ac.volume)));
        chain.push(format!("adelay={}|{}", num(delay_ms), num(delay_ms)));
        graph_parts.push(format!(
            "[{}:a]{}[{}]",
            ac.input_index,
            chain.join(","),
            label
        ));
        audio_labels.push(label);
    }

    if has_audio {
        let joined: String = audio_labels.iter().map(|l| format!("[{}]", l)).collect();
        graph_parts.push(format!(
            "{}amix=inputs={}:normalize=0[aout]",
            joined,
            audio_labels.len()
        ));
    }

    let filter_complex = graph_parts.join(";");

    // ---- Assemble argv ----
    let video_encoder = select_video_encoder(preset);
    let format = obj_str(preset, "format")
        .unwrap_or("mp4")
        .to_ascii_lowercase();
    let is_image_sequence = format == "png_sequence";

    let mut args: Vec<String> = Vec::new();
    args.push("-y".to_string());

    // Inputs.
    for input in &inputs {
        args.push("-i".to_string());
        args.push(input.clone());
    }

    // Filter graph.
    args.push("-filter_complex".to_string());
    args.push(filter_complex);

    // Maps.
    args.push("-map".to_string());
    args.push(format!("[{}]", video_out_label));
    if has_audio && !is_image_sequence {
        args.push("-map".to_string());
        args.push("[aout]".to_string());
    }

    // Video encoder + quality + fps.
    args.push("-c:v".to_string());
    args.push(video_encoder.to_string());
    for q in quality_args(video_encoder, preset) {
        args.push(q);
    }
    args.push("-r".to_string());
    args.push(num(fps));

    // Audio encoder (only if we mapped audio).
    if has_audio && !is_image_sequence {
        args.push("-c:a".to_string());
        args.push("aac".to_string());
        if let Some(kbps) = preset.get("audioBitrateKbps").and_then(|x| x.as_f64()) {
            if kbps > 0.0 {
                args.push("-b:a".to_string());
                args.push(format!("{}k", kbps.round() as i64));
            }
        }
    }

    // Output.
    args.push(output_path.to_string());

    Ok(RenderPlan { args, total_frames })
}

// ===========================================================================
// Tests
// ===========================================================================

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    /// Helper: locate the value following the first occurrence of `flag`.
    fn arg_after<'a>(args: &'a [String], flag: &str) -> Option<&'a String> {
        args.iter()
            .position(|a| a == flag)
            .and_then(|i| args.get(i + 1))
    }

    fn count(args: &[String], target: &str) -> usize {
        args.iter().filter(|a| a.as_str() == target).count()
    }

    fn filter_graph(plan: &RenderPlan) -> &String {
        arg_after(&plan.args, "-filter_complex").expect("filter_complex present")
    }

    /// A timeline with 2 video tracks (2 video clips) + 1 audio clip.
    fn sample_project() -> Value {
        json!({
            "settings": {
                "resolution": { "width": 1920, "height": 1080 },
                "frameRate": 30.0
            },
            "audio": { "masterVolume": 1.0 },
            "assets": {
                "assets": {
                    "vid-a": { "type": "video", "sourcePath": "C:/m/a.mp4" },
                    "vid-b": { "type": "video", "sourcePath": "C:/m/b.mp4" },
                    "aud-c": { "type": "audio", "sourcePath": "C:/m/c.wav" }
                }
            },
            "timeline": {
                "tracks": [
                    {
                        "type": "video", "muted": false, "solo": false, "volume": 1.0,
                        "clips": [
                            {
                                "assetId": "vid-a", "startTime": 0.0, "duration": 8.0,
                                "inPoint": 0.0, "outPoint": 8.0, "speed": 1.0,
                                "volume": 1.0, "opacity": 1.0,
                                "transform": { "x": 0.0, "y": 0.0, "scaleX": 1.0, "scaleY": 1.0, "rotation": 0.0 }
                            }
                        ]
                    },
                    {
                        "type": "video", "muted": false, "solo": false, "volume": 1.0,
                        "clips": [
                            {
                                "assetId": "vid-b", "startTime": 2.0, "duration": 4.0,
                                "inPoint": 1.0, "outPoint": 5.0, "speed": 1.0,
                                "volume": 1.0, "opacity": 0.5,
                                "transform": { "x": 100.0, "y": 50.0, "scaleX": 0.5, "scaleY": 0.5, "rotation": 0.0 }
                            }
                        ]
                    },
                    {
                        "type": "audio", "muted": false, "solo": false, "volume": 0.8,
                        "clips": [
                            {
                                "assetId": "aud-c", "startTime": 1.0, "duration": 6.0,
                                "inPoint": 0.0, "outPoint": 6.0, "speed": 1.0,
                                "volume": 0.9, "opacity": 1.0,
                                "transform": { "x": 0.0, "y": 0.0, "scaleX": 1.0, "scaleY": 1.0, "rotation": 0.0 }
                            }
                        ]
                    }
                ]
            }
        })
    }

    fn h264_preset() -> Value {
        json!({
            "format": "mp4",
            "videoCodec": "h264",
            "audioCodec": "aac",
            "quality": "high",
            "resolution": "project",
            "frameRate": "project",
            "audioBitrateKbps": 320
        })
    }

    #[test]
    fn input_count_matches_compositing_clips() {
        let plan = build_render_plan(&sample_project(), &h264_preset(), "out.mp4").unwrap();
        // 2 video clips (each video-typed asset ALSO carries audio) + 1 audio
        // clip = 2 video inputs + 3 audio inputs = 5 "-i" flags. One input is
        // emitted per compositing pass (video pass + audio pass).
        assert_eq!(count(&plan.args, "-i"), 5);
    }

    #[test]
    fn total_frames_is_ceil_duration_times_fps() {
        // max extent = audio start 1 + 6 = 7? video b: 2+4=6; video a: 8.
        // So duration = 8s * 30fps = 240 frames.
        let plan = build_render_plan(&sample_project(), &h264_preset(), "out.mp4").unwrap();
        assert_eq!(plan.total_frames, 240);
    }

    #[test]
    fn video_graph_has_base_trim_setpts_and_overlays() {
        let plan = build_render_plan(&sample_project(), &h264_preset(), "out.mp4").unwrap();
        let g = filter_graph(&plan);
        assert!(
            g.contains("color=c=black:s=1920x1080"),
            "black base present: {g}"
        );
        assert!(g.contains("trim=start=0:end=8"), "first clip trim: {g}");
        assert!(g.contains("trim=start=1:end=5"), "second clip trim: {g}");
        assert!(g.contains("setpts=(PTS-STARTPTS)"), "setpts present: {g}");
        // One overlay per video layer (2 video clips => 2 overlays).
        assert_eq!(g.matches("overlay=").count(), 2, "two overlays: {g}");
        // Final video label.
        assert!(g.contains("[vout]"), "vout label present: {g}");
    }

    #[test]
    fn overlay_count_equals_video_layers() {
        // Convention: one overlay per video clip (each layer composited onto base).
        let plan = build_render_plan(&sample_project(), &h264_preset(), "out.mp4").unwrap();
        let g = filter_graph(&plan);
        assert_eq!(g.matches("overlay=").count(), 2);
    }

    #[test]
    fn opacity_applied_only_when_below_one() {
        let plan = build_render_plan(&sample_project(), &h264_preset(), "out.mp4").unwrap();
        let g = filter_graph(&plan);
        // Second clip has opacity 0.5 -> colorchannelmixer present exactly once.
        assert_eq!(g.matches("colorchannelmixer=aa=0.5").count(), 1, "{g}");
        // First clip opacity 1.0 -> no extra colorchannelmixer for it.
        assert_eq!(g.matches("colorchannelmixer").count(), 1, "{g}");
    }

    #[test]
    fn scale_uses_transform_factors_relative_to_canvas() {
        let plan = build_render_plan(&sample_project(), &h264_preset(), "out.mp4").unwrap();
        let g = filter_graph(&plan);
        // Clip A scaleX/Y = 1 => 1920x1080. Clip B 0.5 => 960x540.
        assert!(g.contains("scale=1920:1080"), "{g}");
        assert!(g.contains("scale=960:540"), "{g}");
    }

    #[test]
    fn overlay_uses_transform_position_and_enable_window() {
        let plan = build_render_plan(&sample_project(), &h264_preset(), "out.mp4").unwrap();
        let g = filter_graph(&plan);
        // Clip B is offset (100,50) and active between t=2 and t=6.
        assert!(
            g.contains("overlay=x=100:y=50:enable='between(t,2,6)'"),
            "{g}"
        );
    }

    #[test]
    fn audio_graph_has_atrim_atempo_volume_adelay_amix() {
        let plan = build_render_plan(&sample_project(), &h264_preset(), "out.mp4").unwrap();
        let g = filter_graph(&plan);
        assert!(g.contains("atrim=start=0:end=6"), "atrim: {g}");
        assert!(g.contains("asetpts=PTS-STARTPTS"), "asetpts: {g}");
        assert!(g.contains("atempo=1.0"), "atempo: {g}");
        // effective volume = clip 0.9 * track 0.8 * master 1.0 = 0.72.
        assert!(g.contains("volume=0.72"), "volume: {g}");
        // adelay = startTime 1.0s => 1000ms, stereo (the dedicated audio clip).
        assert!(g.contains("adelay=1000|1000"), "adelay: {g}");
        // 3 audio sources (2 video-clip audio + 1 dedicated) mixed via amix.
        assert!(g.contains("amix=inputs=3:normalize=0"), "amix: {g}");
        assert!(g.contains("[aout]"), "aout: {g}");
    }

    #[test]
    fn maps_present_for_video_and_audio() {
        let plan = build_render_plan(&sample_project(), &h264_preset(), "out.mp4").unwrap();
        assert!(plan.args.iter().any(|a| a == "[vout]"));
        assert!(plan.args.iter().any(|a| a == "[aout]"));
        assert_eq!(count(&plan.args, "-map"), 2);
        // Output path is last arg.
        assert_eq!(plan.args.last().unwrap(), "out.mp4");
    }

    #[test]
    fn encoder_selection_per_preset() {
        assert_eq!(
            select_video_encoder(&json!({ "videoCodec": "h264", "format": "mp4" })),
            "h264_nvenc"
        );
        assert_eq!(
            select_video_encoder(&json!({ "videoCodec": "h265", "format": "mp4" })),
            "hevc_nvenc"
        );
        assert_eq!(
            select_video_encoder(&json!({ "videoCodec": "hevc", "format": "mkv" })),
            "hevc_nvenc"
        );
        assert_eq!(
            select_video_encoder(&json!({ "videoCodec": "vp9", "format": "webm" })),
            "libvpx-vp9"
        );
        assert_eq!(
            select_video_encoder(&json!({ "videoCodec": "prores", "format": "mov" })),
            "prores_ks"
        );
        assert_eq!(
            select_video_encoder(&json!({ "videoCodec": "av1", "format": "mp4" })),
            "libaom-av1"
        );
        // No codec but webm format -> vp9 fallback.
        assert_eq!(
            select_video_encoder(&json!({ "videoCodec": null, "format": "webm" })),
            "libvpx-vp9"
        );
        // Unknown -> mpeg4 fallback.
        assert_eq!(
            select_video_encoder(&json!({ "videoCodec": "weird", "format": "xyz" })),
            "mpeg4"
        );
    }

    #[test]
    fn encoder_args_wired_into_plan() {
        let plan = build_render_plan(&sample_project(), &h264_preset(), "out.mp4").unwrap();
        assert_eq!(
            arg_after(&plan.args, "-c:v").map(|s| s.as_str()),
            Some("h264_nvenc")
        );
        assert_eq!(
            arg_after(&plan.args, "-c:a").map(|s| s.as_str()),
            Some("aac")
        );
        // fps flag.
        assert_eq!(arg_after(&plan.args, "-r").map(|s| s.as_str()), Some("30"));
        // nvenc quality flag.
        assert_eq!(arg_after(&plan.args, "-cq").map(|s| s.as_str()), Some("20"));
        // audio bitrate.
        assert_eq!(
            arg_after(&plan.args, "-b:a").map(|s| s.as_str()),
            Some("320k")
        );
    }

    #[test]
    fn empty_timeline_is_handled_gracefully() {
        let project = json!({
            "settings": { "resolution": { "width": 1280, "height": 720 }, "frameRate": 24.0 },
            "audio": { "masterVolume": 1.0 },
            "assets": { "assets": {} },
            "timeline": { "tracks": [] }
        });
        let plan = build_render_plan(&project, &h264_preset(), "empty.mp4").unwrap();
        // No inputs.
        assert_eq!(count(&plan.args, "-i"), 0);
        assert_eq!(plan.total_frames, 0);
        let g = filter_graph(&plan);
        // Base canvas still produced and relabeled to vout.
        assert!(g.contains("color=c=black:s=1280x720"), "{g}");
        assert!(g.contains("[vout]"), "{g}");
        // No audio => single video map only.
        assert_eq!(count(&plan.args, "-map"), 1);
        assert!(!plan.args.iter().any(|a| a == "[aout]"));
    }

    #[test]
    fn video_only_timeline_omits_audio_map() {
        let project = json!({
            "settings": { "resolution": { "width": 1920, "height": 1080 }, "frameRate": 30.0 },
            "audio": { "masterVolume": 1.0 },
            "assets": {
                "assets": {
                    "img-a": { "type": "image", "sourcePath": "C:/m/a.png" }
                }
            },
            "timeline": {
                "tracks": [
                    {
                        "type": "video", "muted": false, "solo": false, "volume": 1.0,
                        "clips": [
                            {
                                "assetId": "img-a", "startTime": 0.0, "duration": 5.0,
                                "inPoint": 0.0, "outPoint": 5.0, "speed": 1.0,
                                "volume": 1.0, "opacity": 1.0,
                                "transform": { "x": 0.0, "y": 0.0, "scaleX": 1.0, "scaleY": 1.0, "rotation": 0.0 }
                            }
                        ]
                    }
                ]
            }
        });
        let plan = build_render_plan(&project, &h264_preset(), "vid.mp4").unwrap();
        // One video input, no audio.
        assert_eq!(count(&plan.args, "-i"), 1);
        assert_eq!(count(&plan.args, "-map"), 1);
        assert!(!plan.args.iter().any(|a| a == "[aout]"));
        assert!(!plan.args.iter().any(|a| a == "-c:a"));
        let g = filter_graph(&plan);
        assert_eq!(g.matches("overlay=").count(), 1, "{g}");
        assert!(!g.contains("amix"), "{g}");
    }

    #[test]
    fn rotation_emits_rotate_filter_when_nonzero() {
        let mut project = sample_project();
        // Give clip A a rotation of 1.5708 radians (~90deg).
        project["timeline"]["tracks"][0]["clips"][0]["transform"]["rotation"] = json!(1.5708);
        let plan = build_render_plan(&project, &h264_preset(), "out.mp4").unwrap();
        let g = filter_graph(&plan);
        assert!(g.contains("rotate=1.5708"), "{g}");
    }

    #[test]
    fn solo_track_silences_non_soloed_audio() {
        let mut project = sample_project();
        // Add a second audio track and solo it; the original audio (track idx 2)
        // should be excluded.
        project["assets"]["assets"]["aud-d"] =
            json!({ "type": "audio", "sourcePath": "C:/m/d.wav" });
        let solo_track = json!({
            "type": "audio", "muted": false, "solo": true, "volume": 1.0,
            "clips": [
                {
                    "assetId": "aud-d", "startTime": 0.0, "duration": 3.0,
                    "inPoint": 0.0, "outPoint": 3.0, "speed": 1.0,
                    "volume": 1.0, "opacity": 1.0,
                    "transform": { "x": 0.0, "y": 0.0, "scaleX": 1.0, "scaleY": 1.0, "rotation": 0.0 }
                }
            ]
        });
        project["timeline"]["tracks"]
            .as_array_mut()
            .unwrap()
            .push(solo_track);

        let plan = build_render_plan(&project, &h264_preset(), "out.mp4").unwrap();
        // Inputs: 2 video + only the soloed audio = 3 (original audio excluded).
        assert_eq!(count(&plan.args, "-i"), 3);
        let g = filter_graph(&plan);
        // Only one audio chain => amix inputs=1.
        assert!(g.contains("amix=inputs=1:normalize=0"), "{g}");
    }

    #[test]
    fn muted_track_excluded_from_audio() {
        let mut project = sample_project();
        // Mute ALL tracks (both video tracks and the audio track). With every
        // track muted, no audio chain is produced at all.
        project["timeline"]["tracks"][0]["muted"] = json!(true);
        project["timeline"]["tracks"][1]["muted"] = json!(true);
        project["timeline"]["tracks"][2]["muted"] = json!(true);
        let plan = build_render_plan(&project, &h264_preset(), "out.mp4").unwrap();
        // 2 video inputs remain (muting affects audio only, not video pixels);
        // all audio muted out => no audio inputs.
        assert_eq!(count(&plan.args, "-i"), 2);
        assert!(!plan.args.iter().any(|a| a == "[aout]"));
        assert!(!plan.args.iter().any(|a| a == "-c:a"));
    }

    #[test]
    fn muting_audio_track_keeps_video_clip_audio() {
        let mut project = sample_project();
        // Mute only the dedicated audio track (idx 2). Video clips still carry
        // their embedded audio, so audio mapping persists.
        project["timeline"]["tracks"][2]["muted"] = json!(true);
        let plan = build_render_plan(&project, &h264_preset(), "out.mp4").unwrap();
        // 2 video inputs + 2 video-clip audio inputs = 4 inputs.
        assert_eq!(count(&plan.args, "-i"), 4);
        assert!(plan.args.iter().any(|a| a == "[aout]"));
        let g = filter_graph(&plan);
        assert!(g.contains("amix=inputs=2:normalize=0"), "{g}");
    }

    #[test]
    fn fast_speed_chains_atempo_stages() {
        // speed 4.0 -> atempo=2.0,atempo=2.0.
        assert_eq!(atempo_chain(4.0), "atempo=2,atempo=2");
        // speed 0.25 -> atempo=0.5,atempo=0.5.
        assert_eq!(atempo_chain(0.25), "atempo=0.5,atempo=0.5");
        // speed 1.0 -> single passthrough.
        assert_eq!(atempo_chain(1.0), "atempo=1.0");
    }

    #[test]
    fn preset_resolution_overrides_project_settings() {
        let project = sample_project();
        let preset = json!({
            "format": "webm",
            "videoCodec": "vp9",
            "quality": "high",
            "resolution": { "width": 1280, "height": 720 },
            "frameRate": 24
        });
        let plan = build_render_plan(&project, &preset, "out.webm").unwrap();
        let g = filter_graph(&plan);
        assert!(g.contains("color=c=black:s=1280x720"), "{g}");
        // fps from preset = 24.
        assert_eq!(arg_after(&plan.args, "-r").map(|s| s.as_str()), Some("24"));
        // total_frames recomputed at 24 fps: 8s * 24 = 192.
        assert_eq!(plan.total_frames, 192);
        // vp9 encoder + crf quality flag.
        assert_eq!(
            arg_after(&plan.args, "-c:v").map(|s| s.as_str()),
            Some("libvpx-vp9")
        );
        assert_eq!(
            arg_after(&plan.args, "-crf").map(|s| s.as_str()),
            Some("24")
        );
    }

    #[test]
    fn non_object_inputs_error() {
        assert!(build_render_plan(&json!("nope"), &h264_preset(), "x.mp4").is_err());
        assert!(build_render_plan(&sample_project(), &json!(5), "x.mp4").is_err());
    }
}
