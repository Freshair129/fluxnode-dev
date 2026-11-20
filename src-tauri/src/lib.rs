use reqwest::blocking::Client;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;
use std::fs::{self, OpenOptions};
use std::io::{BufRead, BufReader, Write};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::{Arc, Mutex, Once, OnceLock};
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use sysinfo::{Disks, System};
use tauri::{AppHandle, Emitter, Manager, WebviewUrl, WebviewWindowBuilder};

mod action;
mod actions;
mod brain;
mod comfy;
mod mcp;
mod media;
mod narrated_scene;
mod render_graph;
mod security;
mod services;
mod workflow_graph;

static ASSET_WATCH_STATE: OnceLock<Mutex<HashMap<String, WatchedAsset>>> = OnceLock::new();
static ASSET_WATCH_THREAD: Once = Once::new();

#[derive(Serialize)]
struct HealthSummary {
    status: String,
    app_data_dir: String,
    os: String,
    os_version: Option<String>,
    arch: String,
    cpu_cores: usize,
    total_memory_gb: Option<f64>,
    available_memory_gb: Option<f64>,
    disk_free_gb: Option<f64>,
    disk_capacity_gb: Option<f64>,
    vram_total_gb: Option<f64>,
    vram_used_gb: Option<f64>,
    vram_utilization_pct: Option<f64>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct AssetInspection {
    path: String,
    exists: bool,
    is_file: bool,
    file_size: u64,
    file_name: String,
    extension: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ExportJobStartResult {
    manifest_path: String,
    output_path: String,
    export_directory: String,
    started_at: String,
}

#[derive(Serialize)]
struct WaveformPeak {
    min: f32,
    max: f32,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct WaveformCacheResult {
    asset_id: String,
    source_path: String,
    cache_path: String,
    peaks: Vec<WaveformPeak>,
    generated_at: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct PreviewFrameData {
    asset_id: String,
    source_path: String,
    source_file_name: Option<String>,
    source_result_id: Option<String>,
    requested_time: f64,
    width: u32,
    height: u32,
    mime_type: String,
    data_url: String,
    generated_at: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct RenderJobStartResult {
    job_id: String,
    output_path: String,
    manifest_path: String,
    status_path: String,
    started_at: String,
    total_frames: u32,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct RenderJobStatus {
    job_id: String,
    status: String,
    progress: u32,
    current_frame: u32,
    total_frames: u32,
    updated_at: String,
    completed_at: Option<String>,
    estimated_time_remaining: Option<u32>,
    output_path: String,
    output_file_size: Option<u64>,
    error: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct AssetProbeResult {
    codec: Option<String>,
    width: Option<u32>,
    height: Option<u32>,
    frame_rate: Option<f64>,
    channels: Option<u8>,
    sample_rate: Option<u32>,
    file_size: u64,
    duration: Option<f64>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ThumbnailResult {
    asset_id: String,
    thumbnail_path: String,
    mime_type: String,
    generated_at: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct AssetCopyResult {
    asset_id: String,
    relative_path: String,
    absolute_path: String,
    copied_at: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct DetachedPanelLayoutPayload {
    detached: bool,
    width: f64,
    height: f64,
    x: Option<f64>,
    y: Option<f64>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct AssetWatchTarget {
    asset_id: String,
    path: String,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct AssetWatchEvent {
    asset_id: String,
    path: String,
    change_type: String,
    exists: bool,
    modified_at: Option<u64>,
    file_size: Option<u64>,
    detected_at: String,
}

#[derive(Clone, PartialEq, Eq)]
struct PathObservation {
    exists: bool,
    modified_at: Option<u64>,
    file_size: Option<u64>,
}

#[derive(Clone)]
struct WatchedAsset {
    path: String,
    last_observation: PathObservation,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct AppUpdateManifest {
    version: String,
    download_url: Option<String>,
    notes: Option<String>,
    published_at: Option<String>,
    channel: Option<String>,
    /// Hex-encoded SHA-256 of the file at `download_url`. Required (not `Option` in practice —
    /// see `check_for_app_update`) so `download_app_update` can verify the downloaded bytes
    /// before writing them to disk. See `SIGNING.md` for the full threat-model note.
    sha256: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct AppUpdateCheckResult {
    current_version: String,
    latest_version: String,
    update_available: bool,
    download_url: Option<String>,
    notes: Option<String>,
    published_at: Option<String>,
    checked_at: String,
    channel: Option<String>,
    sha256: Option<String>,
}

#[tauri::command]
fn health_ping(app: AppHandle) -> Result<String, String> {
    let app_data_dir = ensure_app_dir(&app)?;
    let mut system = System::new_all();
    system.refresh_memory();
    let disks = Disks::new_with_refreshed_list();
    let disk_stats = find_disk_stats(&app_data_dir, &disks);
    let (vram_total_gb, vram_used_gb) = read_vram_telemetry();
    let vram_utilization_pct = match (vram_total_gb, vram_used_gb) {
        (Some(total), Some(used)) if total > 0.0 => Some(((used / total) * 1000.0).round() / 10.0),
        _ => None,
    };
    let summary = HealthSummary {
        status: "ok".to_string(),
        app_data_dir: app_data_dir.to_string_lossy().to_string(),
        os: std::env::consts::OS.to_string(),
        os_version: System::long_os_version(),
        arch: std::env::consts::ARCH.to_string(),
        cpu_cores: std::thread::available_parallelism()
            .map(|parallelism| parallelism.get())
            .unwrap_or(1),
        total_memory_gb: Some(bytes_to_gb(system.total_memory())),
        available_memory_gb: Some(bytes_to_gb(system.available_memory())),
        disk_free_gb: disk_stats.map(|(free, _)| bytes_to_gb(free)),
        disk_capacity_gb: disk_stats.map(|(_, capacity)| bytes_to_gb(capacity)),
        vram_total_gb,
        vram_used_gb,
        vram_utilization_pct,
    };

    serde_json::to_string(&summary).map_err(|error| error.to_string())
}

fn bytes_to_gb(bytes: u64) -> f64 {
    ((bytes as f64 / 1_073_741_824.0) * 10.0).round() / 10.0
}

fn find_disk_stats(path: &Path, disks: &Disks) -> Option<(u64, u64)> {
    let candidate = path.canonicalize().unwrap_or_else(|_| path.to_path_buf());

    disks
        .iter()
        .filter_map(|disk| {
            let mount = disk.mount_point();
            if candidate.starts_with(mount) {
                Some((
                    mount.as_os_str().len(),
                    disk.available_space(),
                    disk.total_space(),
                ))
            } else {
                None
            }
        })
        .max_by_key(|(mount_len, _, _)| *mount_len)
        .map(|(_, free, total)| (free, total))
}

fn read_vram_telemetry() -> (Option<f64>, Option<f64>) {
    #[cfg(target_os = "windows")]
    {
        let total = query_windows_vram_total_gb();
        let used = query_windows_vram_used_gb();
        return (total, used);
    }

    #[allow(unreachable_code)]
    (None, None)
}

#[cfg(target_os = "windows")]
fn query_windows_vram_total_gb() -> Option<f64> {
    if let Some(total_gb) = query_nvidia_smi_memory_gb("memory.total") {
        return (total_gb > 0.0).then_some(total_gb);
    }

    let script = "(Get-CimInstance Win32_VideoController | Where-Object {$_.AdapterRAM -gt 0} | Sort-Object AdapterRAM -Descending | Select-Object -First 1 -ExpandProperty AdapterRAM)";
    read_powershell_number(script).map(|bytes| ((bytes / 1_073_741_824.0) * 10.0).round() / 10.0)
}

#[cfg(target_os = "windows")]
fn query_windows_vram_used_gb() -> Option<f64> {
    if let Some(used_gb) = query_nvidia_smi_memory_gb("memory.used") {
        return Some(used_gb);
    }

    let dedicated_usage_bytes = read_powershell_number(
        "(Get-Counter '\\GPU Process Memory(*)\\Dedicated Usage').CounterSamples | Measure-Object -Property CookedValue -Sum | Select-Object -ExpandProperty Sum",
    );

    let total = query_windows_vram_total_gb();

    match (dedicated_usage_bytes, total) {
        (Some(bytes), Some(total_gb)) if total_gb > 0.0 => {
            let used_gb = ((bytes / 1_073_741_824.0) * 10.0).round() / 10.0;
            Some(used_gb.min(total_gb))
        }
        _ => None,
    }
}

#[cfg(target_os = "windows")]
fn query_nvidia_smi_memory_gb(field: &str) -> Option<f64> {
    let query = format!("--query-gpu={field}");
    let output = Command::new("nvidia-smi")
        .args([query.as_str(), "--format=csv,noheader,nounits"])
        .output()
        .ok()?;

    if !output.status.success() {
        return None;
    }

    let stdout = String::from_utf8(output.stdout).ok()?;
    parse_nvidia_smi_memory_gb(&stdout)
}

fn parse_nvidia_smi_memory_gb(output: &str) -> Option<f64> {
    let values: Vec<f64> = output
        .lines()
        .filter_map(|line| line.trim().parse::<f64>().ok())
        .collect();

    if values.is_empty()
        || values
            .iter()
            .any(|value| !value.is_finite() || *value < 0.0)
    {
        return None;
    }

    Some(values.iter().sum::<f64>() / 1024.0)
}

#[cfg(target_os = "windows")]
fn read_powershell_number(script: &str) -> Option<f64> {
    let output = Command::new("powershell")
        .args(["-NoProfile", "-Command", script])
        .output()
        .ok()?;

    if !output.status.success() {
        return None;
    }

    let stdout = String::from_utf8(output.stdout).ok()?;
    let trimmed = stdout.trim();

    if trimmed.is_empty() {
        return None;
    }

    trimmed
        .lines()
        .last()
        .and_then(|line| line.trim().replace(',', "").parse::<f64>().ok())
}

#[tauri::command]
fn load_project_state(app: AppHandle) -> Result<Option<String>, String> {
    let Some(project_dir) = get_current_project_dir(&app)? else {
        return Ok(None);
    };

    load_project_from_dir(&app, &project_dir)
}

#[tauri::command]
fn open_project_at_path(app: AppHandle, path: String) -> Result<Option<String>, String> {
    let project_dir = security::ensure_allowed_path(&app, &normalize_project_dir(&path))?;

    if !project_dir.exists() {
        return Ok(None);
    }

    let project_json = load_project_from_dir(&app, &project_dir)?;

    if let Some(ref project_json) = project_json {
        set_current_project_dir(&app, &project_dir)?;
        mark_project_opened_at_path(&app, project_json, &project_dir)?;
    }

    Ok(project_json)
}

#[tauri::command]
fn create_project_at_path(
    app: AppHandle,
    path: String,
    project_json: String,
) -> Result<String, String> {
    let project_dir = security::ensure_allowed_path(&app, &normalize_project_dir(&path))?;
    write_project_state_to_dir(&app, &project_dir, &project_json, true)?;
    Ok(project_dir.to_string_lossy().to_string())
}

#[tauri::command]
fn save_project_state(app: AppHandle, project_json: String) -> Result<(), String> {
    let project_dir = get_or_create_current_project_dir(&app, &project_json)?;
    write_project_state_to_dir(&app, &project_dir, &project_json, true)
}

#[tauri::command]
fn save_project_state_as(app: AppHandle, path: String, project_json: String) -> Result<(), String> {
    let project_dir = security::ensure_allowed_path(&app, &normalize_project_dir(&path))?;
    write_project_state_to_dir(&app, &project_dir, &project_json, true)
}

#[tauri::command]
fn autosave_project_state(app: AppHandle, project_json: String) -> Result<String, String> {
    let project_dir = get_or_create_current_project_dir(&app, &project_json)?;
    ensure_project_structure(&project_dir)?;
    let autosave_dir = project_dir.join("autosave");

    let timestamp = current_timestamp();
    let snapshot_id = format!("snapshot-{timestamp}");
    let snapshot_path = autosave_dir.join(format!("{snapshot_id}.json"));
    security::atomic_write(&snapshot_path, project_json.as_bytes())
        .map_err(|error| error.to_string())?;

    trim_autosave_snapshots(&autosave_dir)?;
    // The autosave snapshot is now a durable recovery source, so the crash-recovery WAL can be
    // truncated too — previously only explicit saves cleared it, letting the WAL grow across a
    // long session of nothing-but-autosaves (mirrors LocalProjectRepository.autosave).
    truncate_wal(&project_dir)?;

    let snapshot = serde_json::json!({
        "id": snapshot_id,
        "timestamp": timestamp,
        "project": serde_json::from_str::<Value>(&project_json).map_err(|error| error.to_string())?
    });

    serde_json::to_string(&snapshot).map_err(|error| error.to_string())
}

// The crash-recovery WAL is a bounded ring buffer: at most WAL_LIMIT entries are kept per
// project. Every WAL_SNAPSHOT_INTERVAL-th entry embeds a full project snapshot; the rest carry
// only immer forward patches. The TypeScript store hands us BOTH a full `projectSnapshot` and
// `patches` on every entry (see appendWalSafely in project-store.ts) and leaves it to the
// repository to decide what to actually persist — so, mirroring LocalProjectRepository, we drop
// the redundant per-entry snapshot most of the time. Because WAL_SNAPSHOT_INTERVAL < WAL_LIMIT,
// any trimmed window of the ring buffer still contains at least one snapshot, so recovery can
// always reconstruct the latest state without re-baselining on trim.
const WAL_LIMIT: usize = 50;
const WAL_SNAPSHOT_INTERVAL: usize = 10;

#[tauri::command]
fn append_wal_entry(app: AppHandle, entry_json: String) -> Result<(), String> {
    let project_dir = get_or_create_project_dir_from_wal(&app, &entry_json)?;
    ensure_project_structure(&project_dir)?;
    let wal_path = project_dir.join("autosave").join("wal.jsonl");

    let existing = read_wal_lines(&wal_path)?;
    let next_lines = build_bounded_wal_lines(existing, &entry_json)?;

    let mut body = next_lines.join("\n");
    if !body.is_empty() {
        body.push('\n');
    }
    // atomic_write fsyncs the temp file before renaming it into place, so the entry is durable on
    // disk before we return success — the WAL exists specifically to survive a crash.
    security::atomic_write(&wal_path, body.as_bytes()).map_err(|error| error.to_string())
}

/// Reads the WAL file into its non-empty JSONL lines (empty vec when the file is absent).
fn read_wal_lines(wal_path: &Path) -> Result<Vec<String>, String> {
    if !wal_path.exists() {
        return Ok(Vec::new());
    }

    let content = fs::read_to_string(wal_path).map_err(|error| error.to_string())?;
    Ok(content
        .lines()
        .filter(|line| !line.trim().is_empty())
        .map(|line| line.to_string())
        .collect())
}

/// Appends one entry to the WAL line list, deciding whether to persist a full snapshot or just
/// patches, then trims the result to the most recent WAL_LIMIT entries (ring buffer). Pure so it
/// is unit-testable without an AppHandle or filesystem.
fn build_bounded_wal_lines(existing: Vec<String>, entry_json: &str) -> Result<Vec<String>, String> {
    let entry = serde_json::from_str::<Value>(entry_json).map_err(|error| error.to_string())?;

    // Count how many entries sit after the most recent embedded snapshot. If there is no snapshot
    // yet (fresh/truncated WAL) or the gap has reached the interval, embed a fresh one.
    let mut since_snapshot = 0usize;
    let mut found_snapshot = false;
    for line in existing.iter().rev() {
        if let Ok(value) = serde_json::from_str::<Value>(line) {
            if value.get("projectSnapshot").is_some() {
                found_snapshot = true;
                break;
            }
        }
        since_snapshot += 1;
    }

    let has_snapshot = entry
        .get("projectSnapshot")
        .is_some_and(|value| !value.is_null());
    let embed_snapshot =
        has_snapshot && (!found_snapshot || since_snapshot >= WAL_SNAPSHOT_INTERVAL);

    let mut stored = serde_json::Map::new();
    for key in ["id", "timestamp", "type", "label"] {
        if let Some(value) = entry.get(key) {
            stored.insert(key.to_string(), value.clone());
        }
    }
    if embed_snapshot {
        stored.insert(
            "projectSnapshot".to_string(),
            entry.get("projectSnapshot").cloned().unwrap_or(Value::Null),
        );
    } else {
        stored.insert(
            "patches".to_string(),
            entry
                .get("patches")
                .cloned()
                .unwrap_or_else(|| Value::Array(Vec::new())),
        );
    }

    let stored_line =
        serde_json::to_string(&Value::Object(stored)).map_err(|error| error.to_string())?;

    let mut lines = existing;
    lines.push(stored_line);
    if lines.len() > WAL_LIMIT {
        let overflow = lines.len() - WAL_LIMIT;
        lines.drain(0..overflow);
    }

    Ok(lines)
}

#[tauri::command]
fn load_recent_projects(app: AppHandle) -> Result<String, String> {
    let recents_path = ensure_app_dir(&app)?.join("recent.json");

    if !recents_path.exists() {
        return Ok("[]".to_string());
    }

    fs::read_to_string(recents_path).map_err(|error| error.to_string())
}

#[tauri::command]
fn get_current_project_path(app: AppHandle) -> Result<Option<String>, String> {
    Ok(get_current_project_dir(&app)?.map(|path| path.to_string_lossy().to_string()))
}

#[tauri::command]
fn inspect_asset_path(app: AppHandle, path: String) -> Result<String, String> {
    let path_buf = security::ensure_allowed_path(&app, Path::new(&path))?;
    let metadata = fs::metadata(&path_buf).ok();
    let exists = metadata.is_some();
    let is_file = metadata
        .as_ref()
        .map(|value| value.is_file())
        .unwrap_or(false);
    let file_size = metadata.as_ref().map(|value| value.len()).unwrap_or(0);
    let file_name = path_buf
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or(&path)
        .to_string();
    let extension = path_buf
        .extension()
        .and_then(|value| value.to_str())
        .map(|value| value.to_string());

    serde_json::to_string(&AssetInspection {
        path,
        exists,
        is_file,
        file_size,
        file_name,
        extension,
    })
    .map_err(|error| error.to_string())
}

// --- ffmpeg / ffprobe sidecar helpers ---------------------------------------

#[cfg(target_os = "windows")]
const SIDECAR_TRIPLE: &str = "x86_64-pc-windows-msvc";
#[cfg(all(target_os = "macos", target_arch = "aarch64"))]
const SIDECAR_TRIPLE: &str = "aarch64-apple-darwin";
#[cfg(all(target_os = "macos", target_arch = "x86_64"))]
const SIDECAR_TRIPLE: &str = "x86_64-apple-darwin";
#[cfg(target_os = "linux")]
const SIDECAR_TRIPLE: &str = "x86_64-unknown-linux-gnu";

/// Resolves a bundled sidecar (`ffmpeg` / `ffprobe`) across dev and release.
/// Release: Tauri places `<name><EXE_SUFFIX>` next to the app executable.
/// Dev: the staged `<name>-<triple><EXE_SUFFIX>` lives in `src-tauri/binaries/`.
/// `pub(crate)` so media backends (e.g. the whisper pre-convert) reuse the one resolver.
pub(crate) fn sidecar_path(name: &str) -> PathBuf {
    let plain = format!("{name}{}", std::env::consts::EXE_SUFFIX);
    let triple = format!("{name}-{SIDECAR_TRIPLE}{}", std::env::consts::EXE_SUFFIX);

    // Explicit override: lets isolated dev worktrees / CI point at a shared
    // binaries directory without copying the (gitignored) sidecars.
    if let Ok(dir) = std::env::var("FLUXNODE_FFMPEG_DIR") {
        for candidate in [&triple, &plain] {
            let path = PathBuf::from(&dir).join(candidate);
            if path.exists() {
                return path;
            }
        }
    }

    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            for candidate in [&plain, &triple] {
                let path = dir.join(candidate);
                if path.exists() {
                    return path;
                }
            }
        }
    }

    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("binaries")
        .join(&triple)
}

/// Runs `ffprobe` and returns the parsed JSON report for a media file.
fn run_ffprobe(path: &str) -> Result<Value, String> {
    let bin = sidecar_path("ffprobe");
    let output = Command::new(&bin)
        .args([
            "-v",
            "quiet",
            "-print_format",
            "json",
            "-show_format",
            "-show_streams",
            path,
        ])
        .output()
        .map_err(|error| format!("failed to launch ffprobe ({}): {error}", bin.display()))?;

    if !output.status.success() {
        return Err(format!(
            "ffprobe exited with {}: {}",
            output.status,
            String::from_utf8_lossy(&output.stderr).trim()
        ));
    }

    serde_json::from_slice(&output.stdout).map_err(|error| error.to_string())
}

/// Parses an ffprobe `r_frame_rate` like "30000/1001" into fps.
fn parse_frame_rate(raw: &str) -> Option<f64> {
    let (num, den) = raw.split_once('/')?;
    let num: f64 = num.parse().ok()?;
    let den: f64 = den.parse().ok()?;
    if den == 0.0 {
        None
    } else {
        Some(num / den)
    }
}

/// Builds an `AssetProbeResult` from a parsed ffprobe JSON report.
fn probe_result_from_ffprobe(report: &Value, file_size: u64) -> AssetProbeResult {
    let streams = report
        .get("streams")
        .and_then(|value| value.as_array())
        .cloned()
        .unwrap_or_default();

    let video = streams
        .iter()
        .find(|stream| stream.get("codec_type").and_then(|value| value.as_str()) == Some("video"));
    let audio = streams
        .iter()
        .find(|stream| stream.get("codec_type").and_then(|value| value.as_str()) == Some("audio"));

    let duration = report
        .get("format")
        .and_then(|format| format.get("duration"))
        .and_then(|value| value.as_str())
        .and_then(|value| value.parse::<f64>().ok())
        .or_else(|| {
            video
                .or(audio)
                .and_then(|stream| stream.get("duration"))
                .and_then(|value| value.as_str())
                .and_then(|value| value.parse::<f64>().ok())
        });

    let codec = video
        .or(audio)
        .and_then(|stream| stream.get("codec_name"))
        .and_then(|value| value.as_str())
        .map(|value| value.to_string());

    AssetProbeResult {
        codec,
        width: video
            .and_then(|stream| stream.get("width"))
            .and_then(|value| value.as_u64())
            .map(|value| value as u32),
        height: video
            .and_then(|stream| stream.get("height"))
            .and_then(|value| value.as_u64())
            .map(|value| value as u32),
        frame_rate: video
            .and_then(|stream| stream.get("r_frame_rate"))
            .and_then(|value| value.as_str())
            .and_then(parse_frame_rate),
        channels: audio
            .and_then(|stream| stream.get("channels"))
            .and_then(|value| value.as_u64())
            .map(|value| value as u8),
        sample_rate: audio
            .and_then(|stream| stream.get("sample_rate"))
            .and_then(|value| value.as_str())
            .and_then(|value| value.parse::<u32>().ok()),
        file_size,
        duration,
    }
}

/// Extension-heuristic fallback used only when ffprobe is unavailable/fails.
fn probe_result_from_extension(extension: &str, file_size: u64) -> AssetProbeResult {
    match extension {
        "mp4" | "mov" | "mkv" | "webm" => AssetProbeResult {
            codec: Some("H.264".to_string()),
            width: Some(if file_size > 100_000_000 { 3840 } else { 1920 }),
            height: Some(if file_size > 100_000_000 { 2160 } else { 1080 }),
            frame_rate: Some(if extension == "webm" { 24.0 } else { 30.0 }),
            channels: Some(2),
            sample_rate: Some(48_000),
            file_size,
            duration: Some(if file_size > 500_000_000 { 36.0 } else { 12.0 }),
        },
        "wav" | "mp3" | "flac" | "aac" => AssetProbeResult {
            codec: Some(match extension {
                "wav" => "PCM".to_string(),
                "mp3" => "MP3".to_string(),
                "flac" => "FLAC".to_string(),
                _ => "AAC".to_string(),
            }),
            width: None,
            height: None,
            frame_rate: None,
            channels: Some(2),
            sample_rate: Some(48_000),
            file_size,
            duration: Some(if file_size > 50_000_000 { 180.0 } else { 32.0 }),
        },
        "png" | "jpg" | "jpeg" | "webp" => AssetProbeResult {
            codec: Some(extension.to_uppercase()),
            width: Some(1920),
            height: Some(1080),
            frame_rate: None,
            channels: None,
            sample_rate: None,
            file_size,
            duration: None,
        },
        _ => AssetProbeResult {
            codec: None,
            width: None,
            height: None,
            frame_rate: None,
            channels: None,
            sample_rate: None,
            file_size,
            duration: None,
        },
    }
}

// Heavy: shells out to ffprobe. Run off the main thread (see `asset_probe`).
#[tauri::command]
async fn asset_probe(app: AppHandle, path: String) -> Result<String, String> {
    tokio::task::spawn_blocking(move || asset_probe_blocking(&app, path))
        .await
        .map_err(|error| error.to_string())?
}

/// Synchronous body shared by the `asset_probe` command (via `spawn_blocking`) and the
/// action-registry wrapper (`actions::AssetProbe`), so both paths get the same path containment.
fn asset_probe_blocking(app: &AppHandle, path: String) -> Result<String, String> {
    let path_buf = security::ensure_allowed_path(app, Path::new(&path))?;
    let resolved_path = path_buf.to_string_lossy().to_string();
    let metadata = fs::metadata(&path_buf).ok();
    let file_size = metadata.as_ref().map(|value| value.len()).unwrap_or(0);
    let extension = path_buf
        .extension()
        .and_then(|value| value.to_str())
        .map(|value| value.to_lowercase())
        .unwrap_or_default();

    // Real metadata via ffprobe; fall back to extension heuristics only if it fails.
    let probe = match run_ffprobe(&resolved_path) {
        Ok(report) => probe_result_from_ffprobe(&report, file_size),
        Err(_) => probe_result_from_extension(&extension, file_size),
    };

    serde_json::to_string(&probe).map_err(|error| error.to_string())
}

/// Decodes audio to mono float PCM via ffmpeg and reduces it into `bucket_count`
/// waveform peaks (max absolute amplitude per bucket, clamped to 0.0..=1.0).
///
/// Returns `None` when ffmpeg can't be launched, exits non-zero, or yields no
/// usable samples — callers should fall back to the byte/seed heuristics.
fn decode_waveform_peaks_via_ffmpeg(
    source_path: &str,
    bucket_count: usize,
) -> Option<Vec<WaveformPeak>> {
    let bin = sidecar_path("ffmpeg");
    let output = Command::new(&bin)
        .args([
            "-v",
            "quiet",
            "-i",
            source_path,
            "-ac",
            "1",
            "-filter:a",
            "aresample=8000",
            "-f",
            "f32le",
            "-",
        ])
        .output()
        .ok()?;

    if !output.status.success() {
        return None;
    }

    waveform_peaks_from_f32le(&output.stdout, bucket_count)
}

/// Interprets `bytes` as little-endian f32 PCM samples and buckets them into
/// `bucket_count` peaks. Returns `None` if there are no complete samples.
fn waveform_peaks_from_f32le(bytes: &[u8], bucket_count: usize) -> Option<Vec<WaveformPeak>> {
    let bucket_count = bucket_count.max(1);
    let sample_count = bytes.len() / 4;
    if sample_count == 0 {
        return None;
    }

    let samples: Vec<f32> = (0..sample_count)
        .map(|index| {
            let offset = index * 4;
            f32::from_le_bytes([
                bytes[offset],
                bytes[offset + 1],
                bytes[offset + 2],
                bytes[offset + 3],
            ])
        })
        .collect();

    let chunk_size = ((sample_count as f64) / (bucket_count as f64))
        .ceil()
        .max(1.0) as usize;

    let peaks = (0..bucket_count)
        .map(|index| {
            let start = index * chunk_size;
            let end = usize::min(sample_count, start + chunk_size);
            let mut peak = 0.0_f32;
            if start < end {
                for sample in &samples[start..end] {
                    let amplitude = sample.abs();
                    if amplitude > peak {
                        peak = amplitude;
                    }
                }
            }
            let peak = peak.clamp(0.0, 1.0);
            WaveformPeak {
                min: -peak,
                max: peak,
            }
        })
        .collect();

    Some(peaks)
}

// Heavy: shells out to ffmpeg to decode audio for waveform peaks. Run off the main thread.
#[tauri::command]
async fn asset_generate_waveform(
    app: AppHandle,
    asset_id: String,
    source_path: String,
    bucket_count: usize,
) -> Result<String, String> {
    tokio::task::spawn_blocking(move || {
        asset_generate_waveform_blocking(&app, asset_id, source_path, bucket_count)
    })
    .await
    .map_err(|error| error.to_string())?
}

fn asset_generate_waveform_blocking(
    app: &AppHandle,
    asset_id: String,
    source_path: String,
    bucket_count: usize,
) -> Result<String, String> {
    let project_dir = get_current_project_dir(app)?
        .or_else(|| {
            ensure_app_dir(app)
                .ok()
                .map(|dir| dir.join("workspace").join("unsaved.fluxnode"))
        })
        .ok_or_else(|| "Unable to resolve project directory for waveform cache".to_string())?;
    ensure_project_structure(&project_dir)?;

    let buckets = bucket_count.max(8);
    let path = PathBuf::from(&source_path);
    let peaks = decode_waveform_peaks_via_ffmpeg(&source_path, buckets).unwrap_or_else(|| {
        if path.exists() {
            match fs::read(&path) {
                Ok(bytes) => build_waveform_peaks_from_bytes(&bytes, buckets),
                Err(_) => build_waveform_peaks_from_seed(&source_path, buckets),
            }
        } else {
            build_waveform_peaks_from_seed(&source_path, buckets)
        }
    });

    let waveform_dir = project_dir.join("cache").join("waveforms");
    fs::create_dir_all(&waveform_dir).map_err(|error| error.to_string())?;
    let cache_path = waveform_dir.join(format!("{asset_id}.json"));

    let cache_payload = serde_json::json!({
        "assetId": asset_id,
        "sourcePath": source_path,
        "generatedAt": current_timestamp(),
        "peaks": peaks
    });

    fs::write(
        &cache_path,
        serde_json::to_string_pretty(&cache_payload).map_err(|error| error.to_string())?,
    )
    .map_err(|error| error.to_string())?;

    serde_json::to_string(&WaveformCacheResult {
        asset_id,
        source_path,
        cache_path: cache_path.to_string_lossy().to_string(),
        peaks,
        generated_at: current_timestamp(),
    })
    .map_err(|error| error.to_string())
}

/// Minimal, dependency-free base64 (standard alphabet, padded) encoder.
fn base64_encode(input: &[u8]) -> String {
    const ALPHABET: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::with_capacity(input.len().div_ceil(3) * 4);
    for chunk in input.chunks(3) {
        let b0 = chunk[0] as u32;
        let b1 = *chunk.get(1).unwrap_or(&0) as u32;
        let b2 = *chunk.get(2).unwrap_or(&0) as u32;
        let triple = (b0 << 16) | (b1 << 8) | b2;
        out.push(ALPHABET[((triple >> 18) & 0x3f) as usize] as char);
        out.push(ALPHABET[((triple >> 12) & 0x3f) as usize] as char);
        if chunk.len() > 1 {
            out.push(ALPHABET[((triple >> 6) & 0x3f) as usize] as char);
        } else {
            out.push('=');
        }
        if chunk.len() > 2 {
            out.push(ALPHABET[(triple & 0x3f) as usize] as char);
        } else {
            out.push('=');
        }
    }
    out
}

/// Strict decoder for the standard padded base64 emitted by FluxNode and ComfyUI.
fn decode_base64(input: &str) -> Result<Vec<u8>, String> {
    fn value(byte: u8) -> Result<u32, String> {
        match byte {
            b'A'..=b'Z' => Ok((byte - b'A') as u32),
            b'a'..=b'z' => Ok((byte - b'a' + 26) as u32),
            b'0'..=b'9' => Ok((byte - b'0' + 52) as u32),
            b'+' => Ok(62),
            b'/' => Ok(63),
            _ => Err(format!("invalid base64 byte: {byte}")),
        }
    }

    if !input.len().is_multiple_of(4) {
        return Err("base64 input must use complete padded groups".to_string());
    }
    let mut output = Vec::with_capacity(input.len() / 4 * 3);
    let group_count = input.len() / 4;
    for (index, group) in input.as_bytes().chunks_exact(4).enumerate() {
        let last_group = index + 1 == group_count;
        let third_padded = group[2] == b'=';
        let fourth_padded = group[3] == b'=';
        if group[0] == b'=' || group[1] == b'=' {
            return Err("invalid base64 padding position".to_string());
        }
        if (third_padded || fourth_padded) && !last_group {
            return Err("base64 padding is only valid in the final group".to_string());
        }
        if third_padded && !fourth_padded {
            return Err("invalid base64 padding sequence".to_string());
        }

        let first = value(group[0])?;
        let second = value(group[1])?;
        let third = if third_padded { 0 } else { value(group[2])? };
        let fourth = if fourth_padded { 0 } else { value(group[3])? };
        if third_padded && (second & 0x0f) != 0 {
            return Err("non-canonical base64 padding bits".to_string());
        }
        if fourth_padded && !third_padded && (third & 0x03) != 0 {
            return Err("non-canonical base64 padding bits".to_string());
        }

        let triple = (first << 18) | (second << 12) | (third << 6) | fourth;
        output.push(((triple >> 16) & 0xff) as u8);
        if !third_padded {
            output.push(((triple >> 8) & 0xff) as u8);
        }
        if !fourth_padded {
            output.push((triple & 0xff) as u8);
        }
    }
    Ok(output)
}

const MAX_GENERATED_PNG_BYTES: usize = 64 * 1024 * 1024;
const PNG_MAGIC: [u8; 8] = [0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A];

fn is_safe_asset_id(asset_id: &str) -> bool {
    !asset_id.is_empty()
        && asset_id.len() <= 100
        && asset_id
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'_' | b'-'))
}

fn generated_png_file_name(asset_id: &str, source_file_name: &str) -> String {
    let source_path = source_file_name.replace('\\', "/");
    let safe_source = security::sanitize_download_filename(
        &format!("https://fluxnode.invalid/{source_path}"),
        "generated.png",
    );
    let stem = Path::new(&safe_source)
        .file_stem()
        .and_then(|value| value.to_str())
        .filter(|value| !value.is_empty())
        .unwrap_or("generated");
    format!("{asset_id}-{stem}.png")
}

fn decode_generated_png(data_url: &str) -> Result<Vec<u8>, String> {
    const PREFIX: &str = "data:image/png;base64,";
    let payload = data_url
        .strip_prefix(PREFIX)
        .ok_or_else(|| "Generated result must be an image/png data URL".to_string())?;
    let max_encoded_bytes = MAX_GENERATED_PNG_BYTES.div_ceil(3) * 4;
    if payload.len() > max_encoded_bytes {
        return Err(format!(
            "Generated PNG exceeds the {} MiB limit",
            MAX_GENERATED_PNG_BYTES / (1024 * 1024)
        ));
    }
    let bytes = decode_base64(payload)?;
    if bytes.is_empty() || bytes.len() > MAX_GENERATED_PNG_BYTES {
        return Err("Generated PNG is empty or exceeds the size limit".to_string());
    }
    if !bytes.starts_with(&PNG_MAGIC) {
        return Err("Generated result does not contain a valid PNG signature".to_string());
    }
    Ok(bytes)
}

fn validate_generated_png_with_ffprobe(bytes: &[u8], asset_id: &str) -> Result<(), String> {
    let probe_path = std::env::temp_dir().join(format!(
        "fluxnode-generated-check-{}-{}-{asset_id}.png",
        std::process::id(),
        current_timestamp().replace([':', '.', '-'], "")
    ));
    let validation = (|| {
        let mut file = OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&probe_path)
            .map_err(|error| {
                format!("could not create generated-image validation file: {error}")
            })?;
        file.write_all(bytes)
            .map_err(|error| format!("could not write generated-image validation file: {error}"))?;
        drop(file);

        let report = run_ffprobe(&probe_path.to_string_lossy())
            .map_err(|error| format!("generated result is not a decodable PNG: {error}"))?;
        let has_video_stream =
            report
                .get("streams")
                .and_then(Value::as_array)
                .is_some_and(|streams| {
                    streams.iter().any(|stream| {
                        stream.get("codec_type").and_then(Value::as_str) == Some("video")
                            && stream.get("width").and_then(Value::as_u64).unwrap_or(0) > 0
                            && stream.get("height").and_then(Value::as_u64).unwrap_or(0) > 0
                    })
                });
        if !has_video_stream {
            return Err("generated PNG has no decodable image dimensions".to_string());
        }
        Ok(())
    })();
    let _ = fs::remove_file(probe_path);
    validation
}

/// Extracts a single video frame at `time` (seconds) into `dest` (a PNG path)
/// using the bundled ffmpeg sidecar, then returns the PNG bytes.
/// Returns Err on a missing binary, ffmpeg failure, or an unreadable output —
/// callers fall back to the SVG placeholder.
fn extract_thumbnail_frame(source_path: &str, time: f64, dest: &Path) -> Result<Vec<u8>, String> {
    let bin = sidecar_path("ffmpeg");
    if !bin.exists() {
        return Err(format!("ffmpeg sidecar not found at {}", bin.display()));
    }
    let output = Command::new(&bin)
        .args([
            "-ss",
            &format!("{time}"),
            "-i",
            source_path,
            "-frames:v",
            "1",
            "-vf",
            "scale=320:-1",
            "-y",
        ])
        .arg(dest)
        .output()
        .map_err(|error| format!("failed to launch ffmpeg ({}): {error}", bin.display()))?;

    if !output.status.success() {
        return Err(format!(
            "ffmpeg exited with {}: {}",
            output.status,
            String::from_utf8_lossy(&output.stderr).trim()
        ));
    }

    let bytes = fs::read(dest).map_err(|error| error.to_string())?;
    if bytes.is_empty() {
        return Err("ffmpeg produced an empty thumbnail".to_string());
    }
    Ok(bytes)
}

#[cfg(test)]
mod waveform_tests {
    use super::*;

    #[test]
    fn waveform_peaks_from_f32le_buckets_samples() {
        // 8 samples ascending in absolute amplitude, 4 buckets.
        let samples: [f32; 8] = [0.1, -0.2, 0.3, -0.4, 0.5, -0.6, 0.7, -0.8];
        let mut bytes = Vec::new();
        for sample in samples {
            bytes.extend_from_slice(&sample.to_le_bytes());
        }

        let peaks = waveform_peaks_from_f32le(&bytes, 4).expect("should produce peaks");
        assert_eq!(peaks.len(), 4);
        for peak in &peaks {
            assert!(
                peak.max >= 0.0 && peak.max <= 1.0,
                "max in range, got {}",
                peak.max
            );
            assert!(
                peak.min >= -1.0 && peak.min <= 0.0,
                "min in range, got {}",
                peak.min
            );
        }
        // Last bucket holds the largest magnitude sample (0.8).
        assert!(
            (peaks[3].max - 0.8).abs() < 1e-6,
            "expected 0.8, got {}",
            peaks[3].max
        );
    }

    #[test]
    fn waveform_peaks_from_f32le_rejects_empty() {
        assert!(waveform_peaks_from_f32le(&[], 8).is_none());
        // Fewer than one complete f32 sample.
        assert!(waveform_peaks_from_f32le(&[0u8, 1, 2], 8).is_none());
    }

    #[test]
    fn decode_waveform_peaks_via_ffmpeg_decodes_real_audio() {
        let ffmpeg = sidecar_path("ffmpeg");
        if !ffmpeg.exists() {
            eprintln!("skipping: ffmpeg sidecar not staged");
            return;
        }

        let out = std::env::temp_dir().join("fluxnode-waveform-test.wav");
        let _ = fs::remove_file(&out);

        let status = Command::new(&ffmpeg)
            .args(["-y", "-f", "lavfi", "-i", "sine=frequency=440:duration=1"])
            .arg(&out)
            .status()
            .expect("ffmpeg should launch");
        assert!(
            status.success(),
            "ffmpeg failed to synthesize the test tone"
        );

        let bucket_count = 64;
        let peaks = decode_waveform_peaks_via_ffmpeg(&out.to_string_lossy(), bucket_count)
            .expect("ffmpeg decode should produce peaks for a real audio file");

        assert_eq!(peaks.len(), bucket_count, "expected one peak per bucket");
        for peak in &peaks {
            assert!(
                peak.max >= 0.0 && peak.max <= 1.0,
                "max in 0..=1, got {}",
                peak.max
            );
            assert!(
                peak.min >= -1.0 && peak.min <= 0.0,
                "min in -1..=0, got {}",
                peak.min
            );
        }
        assert!(
            peaks.iter().any(|peak| peak.max > 0.1),
            "a 440Hz sine tone should yield at least one clearly non-zero peak"
        );

        let _ = fs::remove_file(&out);
    }
}

// Heavy: shells out to ffmpeg to extract/scale a frame. Run off the main thread.
#[tauri::command]
async fn asset_generate_thumbnail(
    app: AppHandle,
    asset_id: String,
    source_path: String,
    time: f64,
) -> Result<String, String> {
    tokio::task::spawn_blocking(move || {
        asset_generate_thumbnail_blocking(&app, asset_id, source_path, time)
    })
    .await
    .map_err(|error| error.to_string())?
}

fn asset_generate_thumbnail_blocking(
    app: &AppHandle,
    asset_id: String,
    source_path: String,
    time: f64,
) -> Result<String, String> {
    let project_dir = get_current_project_dir(app)?
        .or_else(|| {
            ensure_app_dir(app)
                .ok()
                .map(|dir| dir.join("workspace").join("unsaved.fluxnode"))
        })
        .ok_or_else(|| {
            "Unable to resolve project directory for thumbnail generation".to_string()
        })?;
    ensure_project_structure(&project_dir)?;

    let thumbnail_dir = project_dir.join("thumbnails");
    fs::create_dir_all(&thumbnail_dir).map_err(|error| error.to_string())?;
    let generated_at = current_timestamp();

    // Preferred path: extract a real video frame via the bundled ffmpeg sidecar.
    let png_file = thumbnail_dir.join(format!("{asset_id}-thumb.png"));
    if let Ok(bytes) = extract_thumbnail_frame(&source_path, time, &png_file) {
        let data_url = format!("data:image/png;base64,{}", base64_encode(&bytes));
        return serde_json::to_string(&ThumbnailResult {
            asset_id,
            thumbnail_path: data_url,
            mime_type: "image/png".to_string(),
            generated_at,
        })
        .map_err(|error| error.to_string());
    }

    // Fallback: SVG placeholder so the app never hard-crashes when ffmpeg is
    // missing or fails to decode the source.
    let thumbnail_file = thumbnail_dir.join(format!("{asset_id}-thumb.svg"));
    let source_path_buf = PathBuf::from(&source_path);
    let file_name = source_path_buf
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or(&source_path);
    let svg = format!(
        r##"<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180" viewBox="0 0 320 180">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#161a25"/>
      <stop offset="100%" stop-color="#0c0f14"/>
    </linearGradient>
  </defs>
  <rect width="100%" height="100%" rx="24" fill="url(#bg)"/>
  <rect x="16" y="16" width="288" height="148" rx="18" fill="rgba(255,255,255,0.04)" stroke="rgba(224,255,0,0.35)"/>
  <text x="50%" y="46%" text-anchor="middle" fill="#f8fafc" font-size="18" font-family="Arial, sans-serif">{}</text>
  <text x="50%" y="60%" text-anchor="middle" fill="#94a3b8" font-size="12" font-family="Arial, sans-serif">Thumbnail at {:.1}s</text>
  <text x="50%" y="72%" text-anchor="middle" fill="#64748b" font-size="11" font-family="Arial, sans-serif">{}</text>
</svg>"##,
        escape_xml(file_name),
        time,
        escape_xml(&generated_at)
    );
    fs::write(&thumbnail_file, &svg).map_err(|error| error.to_string())?;

    let data_url = format!("data:image/svg+xml;charset=utf-8,{}", url_encode_svg(&svg));

    serde_json::to_string(&ThumbnailResult {
        asset_id,
        thumbnail_path: data_url,
        mime_type: "image/svg+xml".to_string(),
        generated_at,
    })
    .map_err(|error| error.to_string())
}

#[cfg(test)]
mod thumbnail_tests {
    use super::*;

    #[test]
    fn base64_encode_matches_known_vectors() {
        assert_eq!(base64_encode(b""), "");
        assert_eq!(base64_encode(b"f"), "Zg==");
        assert_eq!(base64_encode(b"fo"), "Zm8=");
        assert_eq!(base64_encode(b"foo"), "Zm9v");
        assert_eq!(base64_encode(b"foob"), "Zm9vYg==");
        assert_eq!(base64_encode(b"fooba"), "Zm9vYmE=");
        assert_eq!(base64_encode(b"foobar"), "Zm9vYmFy");
    }

    #[test]
    fn generated_png_payload_requires_png_data_url_signature_and_safe_name() {
        let bytes = [PNG_MAGIC.as_slice(), b"fixture"].concat();
        let data_url = format!("data:image/png;base64,{}", base64_encode(&bytes));
        assert_eq!(decode_generated_png(&data_url).expect("png payload"), bytes);
        assert!(decode_generated_png("data:image/svg+xml;base64,AA==").is_err());
        assert!(decode_generated_png("data:image/png;base64,AA==").is_err());
        assert!(decode_base64("AA=A").is_err());
        assert!(decode_base64("A").is_err());

        let file_name = generated_png_file_name("asset-42", r"..\..\unsafe\render final.png");
        assert_eq!(file_name, "asset-42-renderfinal.png");
        assert!(!file_name.contains('/') && !file_name.contains('\\'));
        assert!(!is_safe_asset_id("../outside"));
        assert!(is_safe_asset_id("asset-42_abc"));
    }

    #[test]
    fn extract_thumbnail_frame_produces_real_png_via_ffmpeg() {
        let ffmpeg = sidecar_path("ffmpeg");
        if !ffmpeg.exists() {
            eprintln!("skipping: ffmpeg sidecar not staged");
            return;
        }

        let clip = std::env::temp_dir().join("fluxnode-thumb-test.mp4");
        let _ = fs::remove_file(&clip);

        let status = Command::new(&ffmpeg)
            .args([
                "-y",
                "-f",
                "lavfi",
                "-i",
                "testsrc=size=320x240:rate=25:duration=1",
                "-c:v",
                "mpeg4",
                "-frames:v",
                "25",
            ])
            .arg(&clip)
            .status()
            .expect("ffmpeg should launch");
        assert!(
            status.success(),
            "ffmpeg failed to synthesize the test clip"
        );

        let dest = std::env::temp_dir().join("fluxnode-thumb-test.png");
        let _ = fs::remove_file(&dest);

        let bytes = extract_thumbnail_frame(&clip.to_string_lossy(), 0.2, &dest)
            .expect("frame extraction should succeed");

        // PNG magic bytes: 89 50 4E 47 0D 0A 1A 0A
        const PNG_MAGIC: [u8; 8] = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A];
        assert!(
            bytes.starts_with(&PNG_MAGIC),
            "extracted thumbnail should be a real PNG"
        );

        let data_url = format!("data:image/png;base64,{}", base64_encode(&bytes));
        assert!(data_url.starts_with("data:image/png;base64,"));
        // The PNG header round-trips through base64 to "iVBORw0KGgo".
        assert!(
            data_url[..40].contains("iVBORw0KGgo"),
            "data_url should encode the PNG magic bytes"
        );

        let _ = fs::remove_file(&clip);
        let _ = fs::remove_file(&dest);
    }
}

#[tauri::command]
fn asset_copy_into_project(
    app: AppHandle,
    asset_id: String,
    source_path: String,
) -> Result<String, String> {
    let project_dir = get_current_project_dir(&app)?
        .or_else(|| {
            ensure_app_dir(&app)
                .ok()
                .map(|dir| dir.join("workspace").join("unsaved.fluxnode"))
        })
        .ok_or_else(|| "Unable to resolve project directory for asset copy".to_string())?;
    ensure_project_structure(&project_dir)?;

    let source = security::ensure_allowed_path(&app, Path::new(&source_path))?;
    if !source.exists() {
        return Err(format!("Source asset does not exist: {source_path}"));
    }

    let media_dir = project_dir.join("media");
    fs::create_dir_all(&media_dir).map_err(|error| error.to_string())?;
    let file_name = source
        .file_name()
        .and_then(|value| value.to_str())
        .ok_or_else(|| "Source asset filename could not be resolved".to_string())?;
    let destination_name = format!("{asset_id}-{file_name}");
    let destination = media_dir.join(&destination_name);
    fs::copy(&source, &destination).map_err(|error| error.to_string())?;

    serde_json::to_string(&AssetCopyResult {
        asset_id,
        relative_path: format!("media/{destination_name}"),
        absolute_path: destination.to_string_lossy().to_string(),
        copied_at: current_timestamp(),
    })
    .map_err(|error| error.to_string())
}

/// Materialize a successful ComfyUI PNG into the current project's media folder. This is invoked
/// only after the user clicks the workflow's explicit "Add to timeline" control.
#[tauri::command]
async fn workflow_materialize_generated_image(
    app: AppHandle,
    project_json: String,
    asset_id: String,
    source_file_name: String,
    data_url: String,
) -> Result<String, String> {
    tokio::task::spawn_blocking(move || {
        workflow_materialize_generated_image_blocking(
            &app,
            &project_json,
            &asset_id,
            &source_file_name,
            &data_url,
        )
    })
    .await
    .map_err(|error| error.to_string())?
}

fn workflow_materialize_generated_image_blocking(
    app: &AppHandle,
    project_json: &str,
    asset_id: &str,
    source_file_name: &str,
    data_url: &str,
) -> Result<String, String> {
    if !is_safe_asset_id(asset_id) {
        return Err("Generated asset id contains unsupported characters".to_string());
    }
    let bytes = decode_generated_png(data_url)?;
    validate_generated_png_with_ffprobe(&bytes, asset_id)?;
    let project_dir = get_or_create_current_project_dir(app, project_json)?;
    let media_dir = security::ensure_allowed_path(app, &project_dir.join("media"))?;
    ensure_project_structure(&project_dir)?;
    fs::create_dir_all(&media_dir).map_err(|error| error.to_string())?;
    let destination_name = generated_png_file_name(asset_id, source_file_name);
    let destination = media_dir.join(&destination_name);
    if destination.exists() {
        return Err(format!(
            "Generated asset already exists: {}",
            destination.display()
        ));
    }
    security::atomic_write(&destination, &bytes).map_err(|error| error.to_string())?;

    serde_json::to_string(&AssetCopyResult {
        asset_id: asset_id.to_string(),
        relative_path: format!("media/{destination_name}"),
        absolute_path: destination.to_string_lossy().to_string(),
        copied_at: current_timestamp(),
    })
    .map_err(|error| error.to_string())
}

#[tauri::command]
fn fs_pick_media_file(initial_directory: Option<String>) -> Result<Option<String>, String> {
    let mut dialog = rfd::FileDialog::new();
    if let Some(directory) = initial_directory.as_deref() {
        dialog = dialog.set_directory(directory);
    }

    let picked = dialog
        .add_filter(
            "Media",
            &[
                "mp4", "mov", "mkv", "webm", "wav", "mp3", "flac", "aac", "png", "jpg", "jpeg",
                "webp",
            ],
        )
        .pick_file();

    // The user explicitly chose this path via a native dialog — legitimize it (and its parent
    // directory) as an allowed root for subsequent path-containment checks this session.
    if let Some(path) = &picked {
        security::register_picked_path(path);
    }

    Ok(picked.map(|path| path.to_string_lossy().to_string()))
}

#[tauri::command]
fn fs_pick_directory(initial_directory: Option<String>) -> Result<Option<String>, String> {
    let mut dialog = rfd::FileDialog::new();
    if let Some(directory) = initial_directory.as_deref() {
        dialog = dialog.set_directory(directory);
    }

    let picked = dialog.pick_folder();

    if let Some(path) = &picked {
        security::register_picked_path(path);
    }

    Ok(picked.map(|path| path.to_string_lossy().to_string()))
}

#[tauri::command]
fn load_app_preferences(app: AppHandle) -> Result<String, String> {
    let preferences_path = app_preferences_path(&app)?;
    // Defense in depth: the path is always app-dir-derived (never caller-supplied), but routing
    // it through the same containment check as every other path-taking command guards against a
    // future regression that lets a caller influence it.
    let preferences_path =
        security::ensure_allowed_path(&app, &preferences_path).unwrap_or(preferences_path);

    if !preferences_path.exists() {
        return Ok(r#"{"defaultProjectDirectory":null,"comfyUiEndpoint":"http://127.0.0.1:8188","cloudApiKey":"","updateChannel":"stable","updateManifestUrl":null,"allowRemoteComfy":false}"#.to_string());
    }

    fs::read_to_string(preferences_path).map_err(|error| error.to_string())
}

#[tauri::command]
fn save_app_preferences(app: AppHandle, preferences_json: String) -> Result<(), String> {
    let preferences_path = app_preferences_path(&app)?;
    let preferences_path =
        security::ensure_allowed_path(&app, &preferences_path).unwrap_or(preferences_path);

    // Route `cloudApiKey` through the OS keychain instead of persisting it to preferences.json
    // in plaintext: if the incoming payload carries a (non-empty) key, stash it via `keyring`
    // and rewrite the on-disk field to an empty string. Best-effort parse: if the payload isn't
    // the expected JSON object, fall through and write it unchanged (matches prior behavior).
    let sanitized_json = match serde_json::from_str::<Value>(&preferences_json) {
        Ok(mut value) => {
            if let Some(obj) = value.as_object_mut() {
                if let Some(key) = obj.get("cloudApiKey").and_then(Value::as_str) {
                    let key = key.to_string();
                    if let Err(error) = store_cloud_api_key(&key) {
                        // Non-fatal: preferences still save; the key just isn't persisted.
                        eprintln!("failed to store cloud API key in the OS keychain: {error}");
                    }
                    obj.insert("cloudApiKey".to_string(), Value::String(String::new()));
                }
            }
            serde_json::to_string(&value).unwrap_or_else(|_| preferences_json.clone())
        }
        Err(_) => preferences_json,
    };

    security::atomic_write(&preferences_path, sanitized_json.as_bytes())
        .map_err(|error| error.to_string())
}

const CLOUD_API_KEY_SERVICE: &str = "com.fluxnode.app";
const CLOUD_API_KEY_ACCOUNT: &str = "cloud-api-key";

/// Stores (or clears, when `key` is empty) the cloud API key in the OS credential store
/// (Windows Credential Manager / macOS Keychain / Linux Secret Service, via the `keyring`
/// crate) instead of writing it to `preferences.json` in plaintext.
fn store_cloud_api_key(key: &str) -> Result<(), String> {
    let entry = keyring::Entry::new(CLOUD_API_KEY_SERVICE, CLOUD_API_KEY_ACCOUNT)
        .map_err(|error| error.to_string())?;
    if key.trim().is_empty() {
        return match entry.delete_password() {
            Ok(()) => Ok(()),
            Err(keyring::Error::NoEntry) => Ok(()),
            Err(error) => Err(error.to_string()),
        };
    }
    entry.set_password(key).map_err(|error| error.to_string())
}

/// Reads the cloud API key back from the OS credential store. Returns `""` (not an error) when
/// nothing has been stored yet.
fn read_cloud_api_key() -> Result<String, String> {
    let entry = keyring::Entry::new(CLOUD_API_KEY_SERVICE, CLOUD_API_KEY_ACCOUNT)
        .map_err(|error| error.to_string())?;
    match entry.get_password() {
        Ok(password) => Ok(password),
        Err(keyring::Error::NoEntry) => Ok(String::new()),
        Err(error) => Err(error.to_string()),
    }
}

/// Explicitly set the cloud API key (OS keychain-backed). Prefer this over embedding the key in
/// the `save_app_preferences` payload when the frontend only needs to update the key itself.
#[tauri::command]
fn set_cloud_api_key(key: String) -> Result<(), String> {
    store_cloud_api_key(&key)
}

/// Reads the cloud API key back out of the OS keychain (never out of preferences.json, which
/// only ever stores an empty placeholder for this field — see `save_app_preferences`).
#[tauri::command]
fn get_cloud_api_key() -> Result<String, String> {
    read_cloud_api_key()
}

#[tauri::command]
fn get_app_version() -> Result<String, String> {
    Ok(env!("CARGO_PKG_VERSION").to_string())
}

/// Checks a remote update manifest for a newer version.
///
/// Hardening (see also `download_app_update` and `SIGNING.md`): the manifest URL must be
/// `https://`, the response body is size-capped, and a `sha256` field is required in the
/// manifest so the eventual download can be integrity-checked before it's written to disk.
/// NOTE: this is *download verification*, not *publisher authentication* — it proves the
/// downloaded bytes match what the manifest said, not that the manifest itself came from
/// FluxNode. The proper long-term fix is `tauri-plugin-updater` with a signed update artifact.
#[tauri::command]
fn check_for_app_update(manifest_url: String) -> Result<String, String> {
    let trimmed_url = manifest_url.trim();
    if trimmed_url.is_empty() {
        return Err("Update manifest URL is not configured.".to_string());
    }
    security::ensure_https_url(trimmed_url)?;

    let client = Client::builder()
        .timeout(Duration::from_secs(8))
        .build()
        .map_err(|error| error.to_string())?;
    let response = client
        .get(trimmed_url)
        .header("accept", "application/json")
        .send()
        .map_err(|error| error.to_string())?;
    let response = response
        .error_for_status()
        .map_err(|error| error.to_string())?;
    let body = security::read_capped_bytes(response, security::MAX_JSON_RESPONSE_BYTES)?;
    let manifest: AppUpdateManifest =
        serde_json::from_slice(&body).map_err(|error| error.to_string())?;

    let latest_version = manifest.version.trim().to_string();
    if latest_version.is_empty() {
        return Err("Update manifest is missing a version field.".to_string());
    }

    let download_url = manifest.download_url.and_then(normalize_optional_string);
    if let Some(url) = &download_url {
        security::ensure_https_url(url)?;
    }
    let sha256 = manifest.sha256.and_then(normalize_optional_string);
    if download_url.is_some() && sha256.is_none() {
        return Err(
            "Update manifest is missing a required 'sha256' field for the download URL."
                .to_string(),
        );
    }

    let current_version = env!("CARGO_PKG_VERSION").to_string();
    let result = AppUpdateCheckResult {
        update_available: compare_versions(&latest_version, &current_version) > 0,
        current_version,
        latest_version,
        download_url,
        notes: manifest.notes.and_then(normalize_optional_string),
        published_at: manifest.published_at.and_then(normalize_optional_string),
        checked_at: iso_timestamp_now(),
        channel: manifest.channel.and_then(normalize_optional_string),
        sha256,
    };

    serde_json::to_string(&result).map_err(|error| error.to_string())
}

/// Downloads an update package after checking its integrity against `expected_sha256` (from the
/// manifest returned by `check_for_app_update`).
///
/// Hardening: HTTPS-only, response body size-capped, output filename derived from a
/// whitelist-charset basename (never the raw URL) so a malicious/compromised manifest can't
/// escape the updates directory, and the downloaded bytes are rejected if they don't match the
/// expected SHA-256 hash. This is still *not* publisher signature verification — see the note on
/// `check_for_app_update` and `SIGNING.md`.
#[tauri::command]
fn download_app_update(
    app: AppHandle,
    download_url: String,
    expected_sha256: String,
) -> Result<String, String> {
    let trimmed_url = download_url.trim();
    if trimmed_url.is_empty() {
        return Err("Update download URL is not available.".to_string());
    }
    security::ensure_https_url(trimmed_url)?;
    let expected_sha256 = expected_sha256.trim().to_lowercase();
    if expected_sha256.is_empty() {
        return Err("An expected SHA-256 hash is required to download an update.".to_string());
    }

    let client = Client::builder()
        .timeout(Duration::from_secs(120))
        .build()
        .map_err(|error| error.to_string())?;
    let response = client
        .get(trimmed_url)
        .send()
        .map_err(|error| error.to_string())?;
    let response = response
        .error_for_status()
        .map_err(|error| error.to_string())?;
    let bytes = security::read_capped_bytes(response, security::MAX_DOWNLOAD_BYTES)?;

    let actual_sha256 = security::sha256_hex(&bytes);
    if actual_sha256 != expected_sha256 {
        return Err(format!(
            "Downloaded update failed integrity check (expected sha256 {expected_sha256}, got {actual_sha256}); refusing to write it to disk"
        ));
    }

    let updates_dir = ensure_app_dir(&app)?.join("updates");
    fs::create_dir_all(&updates_dir).map_err(|error| error.to_string())?;

    let file_name = security::sanitize_download_filename(trimmed_url, "fluxnode-update.bin");
    let output_path = updates_dir.join(file_name);
    security::atomic_write(&output_path, &bytes).map_err(|error| error.to_string())?;

    Ok(output_path.to_string_lossy().to_string())
}

#[tauri::command]
fn window_toggle_fullscreen(app: AppHandle) -> Result<(), String> {
    let window = app
        .get_webview_window("main")
        .ok_or_else(|| "Main window is not available".to_string())?;
    let is_fullscreen = window.is_fullscreen().map_err(|error| error.to_string())?;
    window
        .set_fullscreen(!is_fullscreen)
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn app_quit(app: AppHandle) -> Result<(), String> {
    app.exit(0);
    Ok(())
}

#[tauri::command]
fn shell_open_path(app: AppHandle, path: String) -> Result<(), String> {
    let resolved = security::ensure_shell_openable(&app, Path::new(&path))?;

    #[cfg(target_os = "windows")]
    {
        Command::new("explorer")
            .arg(&resolved)
            .spawn()
            .map_err(|error| error.to_string())?;
        return Ok(());
    }

    #[cfg(target_os = "macos")]
    {
        Command::new("open")
            .arg(&resolved)
            .spawn()
            .map_err(|error| error.to_string())?;
        return Ok(());
    }

    #[cfg(target_os = "linux")]
    {
        Command::new("xdg-open")
            .arg(&resolved)
            .spawn()
            .map_err(|error| error.to_string())?;
        return Ok(());
    }

    #[allow(unreachable_code)]
    Err("Shell open is not supported on this platform".to_string())
}

fn normalize_optional_string(value: String) -> Option<String> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed.to_string())
    }
}

fn compare_versions(left: &str, right: &str) -> i32 {
    let left_parts = parse_version_parts(left);
    let right_parts = parse_version_parts(right);
    let length = left_parts.len().max(right_parts.len());

    for index in 0..length {
        let left_part = *left_parts.get(index).unwrap_or(&0);
        let right_part = *right_parts.get(index).unwrap_or(&0);

        if left_part > right_part {
            return 1;
        }

        if left_part < right_part {
            return -1;
        }
    }

    0
}

fn parse_version_parts(value: &str) -> Vec<u32> {
    let numeric = value
        .trim()
        .chars()
        .map(|character| {
            if character.is_ascii_digit() || character == '.' {
                character
            } else {
                ' '
            }
        })
        .collect::<String>();

    numeric
        .split_whitespace()
        .next()
        .unwrap_or("0")
        .split('.')
        .filter_map(|part| part.parse::<u32>().ok())
        .collect()
}

#[tauri::command]
fn panel_window_open(
    app: AppHandle,
    panel: String,
    width: f64,
    height: f64,
    x: Option<f64>,
    y: Option<f64>,
) -> Result<String, String> {
    let label = format!("fluxnode-panel-{panel}");

    if let Some(window) = app.get_webview_window(&label) {
        let _ = window.show();
        let _ = window.set_focus();
        return serialize_detached_panel_layout(Some(&window), true);
    }

    let mut builder = WebviewWindowBuilder::new(
        &app,
        &label,
        WebviewUrl::App(format!("index.html?panel={panel}").into()),
    )
    .title(format!("FluxNode {}", capitalize_panel_name(&panel)))
    .inner_size(width, height)
    .resizable(true)
    .visible(true);

    if let (Some(pos_x), Some(pos_y)) = (x, y) {
        builder = builder.position(pos_x, pos_y);
    }

    let window = builder.build().map_err(|error| error.to_string())?;
    serialize_detached_panel_layout(Some(&window), true)
}

#[tauri::command]
fn panel_window_close(app: AppHandle, panel: String) -> Result<Option<String>, String> {
    let label = format!("fluxnode-panel-{panel}");
    let Some(window) = app.get_webview_window(&label) else {
        return Ok(None);
    };

    let payload = serialize_detached_panel_layout(Some(&window), false)?;
    window.close().map_err(|error| error.to_string())?;
    Ok(Some(payload))
}

#[tauri::command]
fn panel_window_broadcast_state(app: AppHandle, snapshot_json: String) -> Result<(), String> {
    let snapshot =
        serde_json::from_str::<Value>(&snapshot_json).map_err(|error| error.to_string())?;
    app.emit("fluxnode://detached-panel-state", snapshot)
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn asset_watch_sync(app: AppHandle, targets_json: String) -> Result<(), String> {
    let targets = serde_json::from_str::<Vec<AssetWatchTarget>>(&targets_json)
        .map_err(|error| error.to_string())?;
    ensure_asset_watch_thread(&app);
    let watch_state = asset_watch_state();
    let mut guard = watch_state
        .lock()
        .map_err(|_| "Asset watch state lock poisoned".to_string())?;
    let mut next_targets = HashMap::new();

    for target in targets {
        let normalized_path = target.path.replace('\\', "/");
        let last_observation = guard
            .get(&target.asset_id)
            .filter(|existing| existing.path == normalized_path)
            .map(|existing| existing.last_observation.clone())
            .unwrap_or_else(|| observe_path(Path::new(&normalized_path)));

        next_targets.insert(
            target.asset_id,
            WatchedAsset {
                path: normalized_path,
                last_observation,
            },
        );
    }

    *guard = next_targets;
    Ok(())
}

/// Transcodes `src` into a real low-resolution proxy mp4 at `dst`, scaled to
/// `width`x`height`. Uses the `mpeg4` software encoder (always present in the
/// bundled LGPL ffmpeg build, no GPU required). Returns `Err` on a missing
/// binary or a non-zero ffmpeg exit so callers can fall back gracefully.
fn transcode_proxy(
    ffmpeg: &Path,
    src: &str,
    dst: &Path,
    width: u32,
    height: u32,
) -> Result<(), String> {
    let output = Command::new(ffmpeg)
        .args([
            "-y",
            "-i",
            src,
            "-vf",
            &format!("scale={width}:{height}"),
            "-c:v",
            "mpeg4",
            "-q:v",
            "5",
            "-c:a",
            "aac",
            "-b:a",
            "128k",
        ])
        .arg(dst)
        .output()
        .map_err(|error| format!("failed to launch ffmpeg ({}): {error}", ffmpeg.display()))?;

    if !output.status.success() {
        return Err(format!(
            "ffmpeg exited with {}: {}",
            output.status,
            String::from_utf8_lossy(&output.stderr).trim()
        ));
    }

    Ok(())
}

// Heavy: shells out to ffmpeg to transcode a proxy. Run off the main thread.
#[tauri::command]
async fn asset_generate_proxy(
    app: AppHandle,
    asset_id: String,
    source_path: String,
    target_width: u32,
    target_height: u32,
) -> Result<String, String> {
    tokio::task::spawn_blocking(move || {
        asset_generate_proxy_blocking(&app, asset_id, source_path, target_width, target_height)
    })
    .await
    .map_err(|error| error.to_string())?
}

fn asset_generate_proxy_blocking(
    app: &AppHandle,
    asset_id: String,
    source_path: String,
    target_width: u32,
    target_height: u32,
) -> Result<String, String> {
    let project_dir = get_current_project_dir(app)?
        .or_else(|| {
            ensure_app_dir(app)
                .ok()
                .map(|dir| dir.join("workspace").join("unsaved.fluxnode"))
        })
        .ok_or_else(|| "Unable to resolve project directory for proxy generation".to_string())?;
    ensure_project_structure(&project_dir)?;

    let proxy_dir = project_dir.join("proxies");
    fs::create_dir_all(&proxy_dir).map_err(|error| error.to_string())?;
    let proxy_path = proxy_dir.join(format!("{asset_id}-proxy.mp4"));

    // Prefer a real transcode with the bundled ffmpeg. If the binary is missing
    // or ffmpeg fails for any reason, fall back to the text placeholder so the
    // app never hard-crashes on proxy generation.
    let ffmpeg = sidecar_path("ffmpeg");
    if ffmpeg.exists()
        && transcode_proxy(
            &ffmpeg,
            &source_path,
            &proxy_path,
            target_width,
            target_height,
        )
        .is_ok()
    {
        return Ok(proxy_path.to_string_lossy().to_string());
    }

    let proxy_payload = format!(
        "FluxNode proxy artifact\nasset={asset_id}\nsource={source_path}\nresolution={}x{}\ncreated={}\n",
        target_width,
        target_height,
        current_timestamp(),
    );
    fs::write(&proxy_path, proxy_payload).map_err(|error| error.to_string())?;

    Ok(proxy_path.to_string_lossy().to_string())
}

#[cfg(test)]
mod proxy_tests {
    use super::*;

    #[test]
    fn transcode_proxy_writes_real_scaled_video() {
        let ffmpeg = sidecar_path("ffmpeg");
        let ffprobe = sidecar_path("ffprobe");
        if !ffmpeg.exists() || !ffprobe.exists() {
            eprintln!("skipping: ffmpeg/ffprobe sidecars not staged");
            return;
        }

        // Synthesize a real source clip at 640x480.
        let source = std::env::temp_dir().join("fluxnode-proxy-source.mp4");
        let _ = fs::remove_file(&source);
        let status = Command::new(&ffmpeg)
            .args([
                "-y",
                "-f",
                "lavfi",
                "-i",
                "testsrc=size=640x480:rate=25:duration=1",
                "-f",
                "lavfi",
                "-i",
                "sine=frequency=440:duration=1",
                "-c:v",
                "mpeg4",
                "-c:a",
                "aac",
                "-shortest",
            ])
            .arg(&source)
            .status()
            .expect("ffmpeg should launch");
        assert!(
            status.success(),
            "ffmpeg failed to synthesize the source clip"
        );

        // Transcode it into a downscaled proxy.
        let proxy = std::env::temp_dir().join("fluxnode-proxy-out.mp4");
        let _ = fs::remove_file(&proxy);
        let target_width = 320u32;
        let target_height = 240u32;
        transcode_proxy(
            &ffmpeg,
            &source.to_string_lossy(),
            &proxy,
            target_width,
            target_height,
        )
        .expect("transcode_proxy should succeed");

        // The proxy must be a real video at the requested width.
        let report = run_ffprobe(&proxy.to_string_lossy()).expect("ffprobe should read the proxy");
        let size = fs::metadata(&proxy).map(|meta| meta.len()).unwrap_or(0);
        let probe = probe_result_from_ffprobe(&report, size);

        assert_eq!(
            probe.width,
            Some(target_width),
            "proxy width should match target"
        );
        assert_eq!(
            probe.height,
            Some(target_height),
            "proxy height should match target"
        );
        assert!(
            probe.codec.is_some(),
            "proxy should have a decodable video codec"
        );
        assert!(size > 0, "proxy file should be non-empty");

        let _ = fs::remove_file(&source);
        let _ = fs::remove_file(&proxy);
    }
}

/// Decodes a real frame at `requested_time` (seconds) scaled to `width`x`height`
/// using the bundled ffmpeg sidecar and returns a PNG `PreviewFrameData`.
/// Falls back to the SVG placeholder from `build_preview_frame` when ffmpeg is
/// missing or the extraction/encode fails, so callers never hard-crash.
fn decode_preview_frame(
    asset_id: String,
    source_path: String,
    requested_time: f64,
    width: u32,
    height: u32,
) -> PreviewFrameData {
    let bin = sidecar_path("ffmpeg");
    if !bin.exists() {
        return build_preview_frame(asset_id, source_path, requested_time, width, height);
    }

    let dest = std::env::temp_dir().join(format!(
        "fluxnode-preview-{}-{}.png",
        asset_id
            .bytes()
            .fold(0_u32, |sum, byte| sum.wrapping_add(byte as u32)),
        current_timestamp().replace([':', '.', '-'], "")
    ));
    let _ = fs::remove_file(&dest);

    let result = (|| -> Result<Vec<u8>, String> {
        let output = Command::new(&bin)
            .args([
                "-ss",
                &format!("{requested_time}"),
                "-i",
                &source_path,
                "-frames:v",
                "1",
                "-vf",
                &format!("scale={width}:{height}"),
                "-y",
            ])
            .arg(&dest)
            .output()
            .map_err(|error| format!("failed to launch ffmpeg ({}): {error}", bin.display()))?;

        if !output.status.success() {
            return Err(format!(
                "ffmpeg exited with {}: {}",
                output.status,
                String::from_utf8_lossy(&output.stderr).trim()
            ));
        }

        let bytes = fs::read(&dest).map_err(|error| error.to_string())?;
        if bytes.is_empty() {
            return Err("ffmpeg produced an empty preview frame".to_string());
        }
        Ok(bytes)
    })();

    let _ = fs::remove_file(&dest);

    match result {
        Ok(bytes) => {
            let data_url = format!("data:image/png;base64,{}", base64_encode(&bytes));
            PreviewFrameData {
                asset_id,
                source_path,
                source_file_name: None,
                source_result_id: None,
                requested_time,
                width,
                height,
                mime_type: "image/png".to_string(),
                data_url,
                generated_at: current_timestamp(),
            }
        }
        Err(_) => build_preview_frame(asset_id, source_path, requested_time, width, height),
    }
}

/// Executes the workflow subgraph feeding `node_id` (deterministic VFX nodes via
/// ffmpeg) and returns a real PNG preview frame of that node's output. Falls back
/// to the SVG placeholder when compilation or ffmpeg fails (e.g. AI-only graphs).
// Heavy: compiles a workflow subgraph and shells out to ffmpeg. Run off the main thread.
#[tauri::command]
async fn workflow_render_node(
    project_json: String,
    node_id: String,
    width: u32,
    height: u32,
) -> Result<String, String> {
    tokio::task::spawn_blocking(move || {
        workflow_render_node_blocking(project_json, node_id, width, height)
    })
    .await
    .map_err(|error| error.to_string())?
}

fn workflow_render_node_blocking(
    project_json: String,
    node_id: String,
    width: u32,
    height: u32,
) -> Result<String, String> {
    let project_value = serde_json::from_str::<Value>(&project_json).map_err(|e| e.to_string())?;

    let temp_out = std::env::temp_dir().join(format!(
        "fluxnode-node-{}-{}.mp4",
        node_id
            .bytes()
            .fold(0_u32, |sum, byte| sum.wrapping_add(byte as u32)),
        current_timestamp().replace([':', '.', '-'], "")
    ));
    let temp_out_str = temp_out.to_string_lossy().to_string();
    let _ = fs::remove_file(&temp_out);

    let frame = (|| -> Result<PreviewFrameData, String> {
        let bin = sidecar_path("ffmpeg");
        if !bin.exists() {
            return Err("ffmpeg sidecar not found".to_string());
        }
        let plan = workflow_graph::build_workflow_plan(&project_value, &node_id, &temp_out_str)?;
        let lease = acquire_ffmpeg_gpu_lease(&plan.args)?;
        let operation = (|| {
            let output = Command::new(&bin)
                .args(&plan.args)
                .output()
                .map_err(|e| format!("failed to launch ffmpeg: {e}"))?;
            if !output.status.success() {
                return Err(format!(
                    "ffmpeg failed: {}",
                    String::from_utf8_lossy(&output.stderr).trim()
                ));
            }
            // Grab the first frame of the node's rendered output as the preview.
            Ok(decode_preview_frame(
                node_id.clone(),
                temp_out_str.clone(),
                0.0,
                width,
                height,
            ))
        })();
        finish_ffmpeg_gpu_operation(lease, operation)
    })();

    let _ = fs::remove_file(&temp_out);

    let result = frame.unwrap_or_else(|_| {
        build_preview_frame(node_id.clone(), String::new(), 0.0, width, height)
    });
    serde_json::to_string(&result).map_err(|e| e.to_string())
}

/// Reads the `allowRemoteComfy` preference (defaults to `false`). Used by the SSRF guard in
/// `comfy_ping`/`comfy_generate` — see `security::ensure_safe_comfy_endpoint`.
fn read_allow_remote_comfy(app: &AppHandle) -> bool {
    let Ok(path) = app_preferences_path(app) else {
        return false;
    };
    let Ok(contents) = fs::read_to_string(path) else {
        return false;
    };
    let Ok(value) = serde_json::from_str::<Value>(&contents) else {
        return false;
    };
    value
        .get("allowRemoteComfy")
        .and_then(Value::as_bool)
        .unwrap_or(false)
}

/// Checks whether the user's ComfyUI server is reachable (BYOM).
///
/// SSRF guard: `endpoint` is caller-supplied, so it's validated as loopback/private-LAN unless
/// the user opted into `allowRemoteComfy` — otherwise this would let a caller point FluxNode's
/// HTTP client at an arbitrary host (see `security::ensure_safe_comfy_endpoint`).
#[tauri::command]
fn comfy_ping(app: AppHandle, endpoint: String) -> bool {
    let allow_remote = read_allow_remote_comfy(&app);
    if security::ensure_safe_comfy_endpoint(&endpoint, allow_remote).is_err() {
        return false;
    }
    comfy::ping(&endpoint)
}

/// Executes an AI node against the user's local ComfyUI and returns the
/// generated image as a real PNG `PreviewFrameData`.
///
/// MVP: text-to-image `ai_generate` (no input image). Image-conditioned nodes
/// (`img2img` / `ai_upscale`) require uploading the input frame to ComfyUI,
/// which needs reqwest's `multipart` feature — tracked as a follow-up.
///
/// Heavy (polls ComfyUI + fetches the image over HTTP) — run off the main thread.
#[tauri::command]
async fn comfy_generate(
    app: AppHandle,
    project_json: String,
    node_id: String,
    endpoint: String,
    timeout_secs: u64,
) -> Result<String, String> {
    let allow_remote = read_allow_remote_comfy(&app);
    let use_local_gpu = is_local_comfy_endpoint(&endpoint);
    tokio::task::spawn_blocking(move || {
        // Validate before requesting a brain unload; rejected endpoints must have no side effects.
        security::ensure_safe_comfy_endpoint(&endpoint, allow_remote)?;
        let operation =
            || comfy_generate_blocking(project_json, node_id, endpoint, timeout_secs, allow_remote);
        if use_local_gpu {
            let lease = services::gpu_arbiter().acquire(media::gpu::GpuNeed::Heavy)?;
            lease.finish_with(operation())
        } else {
            // A private-LAN ComfyUI server uses its own machine's GPU. Do not unload the local
            // Ollama model for work that does not share FluxNode's local GPU.
            operation()
        }
    })
    .await
    .map_err(|error| error.to_string())?
}

/// Lists the saved voice profiles available from the loopback Lalin API.
#[tauri::command]
async fn narrated_scene_list_voices() -> Result<Vec<narrated_scene::VoiceOption>, String> {
    tokio::task::spawn_blocking(narrated_scene::list_voices)
        .await
        .map_err(|error| error.to_string())?
}

/// Runs one GPU-coordinated Qwen image + Lalin TTS scene workflow.
#[tauri::command]
async fn narrated_scene_run(
    app: AppHandle,
    image_prompt: String,
    narration: String,
    voice_id: String,
) -> Result<String, String> {
    tokio::task::spawn_blocking(move || narrated_scene::run(app, image_prompt, narration, voice_id))
        .await
        .map_err(|error| error.to_string())?
}

fn is_local_comfy_endpoint(endpoint: &str) -> bool {
    let Ok(url) = reqwest::Url::parse(endpoint) else {
        return false;
    };
    let Some(host) = url.host_str() else {
        return false;
    };
    if host.eq_ignore_ascii_case("localhost") {
        return true;
    }
    host.trim_matches(['[', ']'])
        .parse::<std::net::IpAddr>()
        .is_ok_and(|address| address.is_loopback())
}

fn comfy_generate_blocking(
    project_json: String,
    node_id: String,
    endpoint: String,
    timeout_secs: u64,
    allow_remote_comfy: bool,
) -> Result<String, String> {
    security::ensure_safe_comfy_endpoint(&endpoint, allow_remote_comfy)?;

    let project_value = serde_json::from_str::<Value>(&project_json).map_err(|e| e.to_string())?;
    let node = project_value
        .get("workflow")
        .and_then(|w| w.get("nodes"))
        .and_then(|n| n.as_array())
        .ok_or_else(|| "Project workflow nodes are missing".to_string())?
        .iter()
        .find(|n| n.get("id").and_then(|v| v.as_str()) == Some(node_id.as_str()))
        .ok_or_else(|| format!("Node {node_id} not found in the workflow"))?;
    let node_type = node
        .get("type")
        .and_then(|v| v.as_str())
        .ok_or_else(|| "Node type is missing".to_string())?;
    let node_data = node.get("data").cloned().unwrap_or(Value::Null);

    if !comfy::ping(&endpoint) {
        return Err(format!(
            "ComfyUI is not reachable at {endpoint}. Start ComfyUI and confirm the endpoint in Settings."
        ));
    }

    let prompt = comfy::build_comfy_prompt(node_type, &node_data, None)?;
    let prompt_id = comfy::submit_prompt(&endpoint, &prompt)?;
    let image_ref = comfy::wait_for_output(&endpoint, &prompt_id, timeout_secs.max(5))?;
    let bytes = comfy::fetch_image(&endpoint, &image_ref)?;
    if bytes.is_empty() {
        return Err("ComfyUI returned an empty image".to_string());
    }

    let frame = PreviewFrameData {
        asset_id: node_id,
        source_path: String::new(),
        source_file_name: Some(image_ref.filename),
        // ComfyUI assigns a distinct prompt id for each generation. Keep it with
        // the preview so repeated clicks remain idempotent without blocking later runs.
        source_result_id: Some(prompt_id),
        requested_time: 0.0,
        width: 0,
        height: 0,
        mime_type: "image/png".to_string(),
        data_url: format!("data:image/png;base64,{}", base64_encode(&bytes)),
        generated_at: current_timestamp(),
    };
    serde_json::to_string(&frame).map_err(|e| e.to_string())
}

// Heavy: shells out to ffmpeg to extract/scale a frame. Run off the main thread.
#[tauri::command]
async fn video_decode_frame(
    asset_id: String,
    source_path: String,
    requested_time: f64,
    width: u32,
    height: u32,
) -> Result<String, String> {
    tokio::task::spawn_blocking(move || {
        video_decode_frame_blocking(asset_id, source_path, requested_time, width, height)
    })
    .await
    .map_err(|error| error.to_string())?
}

fn video_decode_frame_blocking(
    asset_id: String,
    source_path: String,
    requested_time: f64,
    width: u32,
    height: u32,
) -> Result<String, String> {
    serde_json::to_string(&decode_preview_frame(
        asset_id,
        source_path,
        requested_time,
        width,
        height,
    ))
    .map_err(|error| error.to_string())
}

// Heavy: shells out to ffmpeg to extract/scale a frame. Run off the main thread.
#[tauri::command]
async fn video_seek(
    asset_id: String,
    source_path: String,
    requested_time: f64,
    width: u32,
    height: u32,
) -> Result<String, String> {
    tokio::task::spawn_blocking(move || {
        video_decode_frame_blocking(asset_id, source_path, requested_time, width, height)
    })
    .await
    .map_err(|error| error.to_string())?
}

#[cfg(test)]
mod preview_decode_tests {
    use super::*;

    #[test]
    fn video_decode_frame_returns_real_png_data_url() {
        let ffmpeg = sidecar_path("ffmpeg");
        if !ffmpeg.exists() {
            eprintln!("skipping: ffmpeg sidecar not staged");
            return;
        }

        let clip = std::env::temp_dir().join("fluxnode-preview-decode-test.mp4");
        let _ = fs::remove_file(&clip);

        let status = Command::new(&ffmpeg)
            .args([
                "-y",
                "-f",
                "lavfi",
                "-i",
                "testsrc=size=320x240:rate=25:duration=1",
                "-c:v",
                "mpeg4",
                "-frames:v",
                "25",
            ])
            .arg(&clip)
            .status()
            .expect("ffmpeg should launch");
        assert!(
            status.success(),
            "ffmpeg failed to synthesize the test clip"
        );

        let json = video_decode_frame_blocking(
            "preview-asset".to_string(),
            clip.to_string_lossy().to_string(),
            0.2,
            160,
            120,
        )
        .expect("video_decode_frame should succeed");

        let frame: Value = serde_json::from_str(&json).expect("result should be valid JSON");
        assert_eq!(frame["mimeType"], "image/png", "mime should be image/png");

        let data_url = frame["dataUrl"]
            .as_str()
            .expect("dataUrl should be a string");
        assert!(
            data_url.starts_with("data:image/png;base64,"),
            "data_url should be a PNG data URL, got: {}",
            &data_url[..data_url.len().min(40)]
        );

        // Decode the base64 payload and verify the PNG magic bytes.
        let payload = &data_url["data:image/png;base64,".len()..];
        let decoded = base64_decode_str(payload).expect("payload should decode");
        const PNG_MAGIC: [u8; 8] = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A];
        assert!(
            decoded.starts_with(&PNG_MAGIC),
            "decoded payload should be a real PNG"
        );

        let _ = fs::remove_file(&clip);
    }

    fn base64_decode_str(input: &str) -> Result<Vec<u8>, String> {
        decode_base64(input)
    }
}

#[tauri::command]
fn start_export_job(
    app: AppHandle,
    job_id: String,
    project_json: String,
    preset_json: String,
) -> Result<String, String> {
    let project_value =
        serde_json::from_str::<Value>(&project_json).map_err(|error| error.to_string())?;
    let preset_value =
        serde_json::from_str::<Value>(&preset_json).map_err(|error| error.to_string())?;

    let project_meta = project_value
        .get("meta")
        .and_then(|value| value.as_object())
        .ok_or_else(|| "Project meta is missing".to_string())?;
    let output_state = project_value
        .get("output")
        .and_then(|value| value.as_object())
        .ok_or_else(|| "Project output state is missing".to_string())?;
    let export_defaults = output_state
        .get("exportDefaults")
        .and_then(|value| value.as_object())
        .ok_or_else(|| "Project export defaults are missing".to_string())?;

    let project_id = project_meta
        .get("id")
        .and_then(|value| value.as_str())
        .ok_or_else(|| "Project id is missing".to_string())?;
    let project_name = project_meta
        .get("name")
        .and_then(|value| value.as_str())
        .ok_or_else(|| "Project name is missing".to_string())?;
    let output_directory = export_defaults
        .get("outputDirectory")
        .and_then(|value| value.as_str())
        .ok_or_else(|| "Project output directory is missing".to_string())?;
    let format = preset_value
        .get("format")
        .and_then(|value| value.as_str())
        .ok_or_else(|| "Render preset format is missing".to_string())?;

    let started_at = current_timestamp();
    let output_extension = if format == "png_sequence" {
        "zip"
    } else {
        format
    };
    let export_dir = resolve_export_directory(&app, output_directory)?;
    fs::create_dir_all(&export_dir).map_err(|error| error.to_string())?;

    let output_path = export_dir.join(format!("{project_id}-{job_id}.{output_extension}"));
    let manifest_path = export_dir.join(format!("{job_id}.export.json"));
    let manifest = serde_json::json!({
        "jobId": job_id,
        "projectId": project_id,
        "projectName": project_name,
        "startedAt": started_at,
        "outputPath": output_path.to_string_lossy(),
        "audioOutput": describe_workflow_audio_output(&project_value),
        "preset": preset_value,
        "projectSnapshot": project_value
    });

    fs::write(
        &manifest_path,
        serde_json::to_string_pretty(&manifest).map_err(|error| error.to_string())?,
    )
    .map_err(|error| error.to_string())?;

    serde_json::to_string(&ExportJobStartResult {
        manifest_path: manifest_path.to_string_lossy().to_string(),
        output_path: output_path.to_string_lossy().to_string(),
        export_directory: export_dir.to_string_lossy().to_string(),
        started_at,
    })
    .map_err(|error| error.to_string())
}

// --- real ffmpeg render execution -------------------------------------------

static RENDER_PIDS: OnceLock<Mutex<HashMap<String, u32>>> = OnceLock::new();

fn render_pids() -> &'static Mutex<HashMap<String, u32>> {
    RENDER_PIDS.get_or_init(|| Mutex::new(HashMap::new()))
}

/// Force-kills a tracked render process (and its child encoders).
fn kill_render_process(job_id: &str) {
    let pid = render_pids()
        .lock()
        .ok()
        .and_then(|map| map.get(job_id).copied());
    if let Some(pid) = pid {
        #[cfg(target_os = "windows")]
        let _ = Command::new("taskkill")
            .args(["/F", "/T", "/PID", &pid.to_string()])
            .output();
        #[cfg(not(target_os = "windows"))]
        let _ = Command::new("kill").args(["-9", &pid.to_string()]).output();
        if let Ok(mut map) = render_pids().lock() {
            map.remove(job_id);
        }
    }
}

fn ffmpeg_plan_uses_gpu_encoder(plan_args: &[String]) -> bool {
    plan_args
        .iter()
        .any(|argument| argument.ends_with("_nvenc"))
}

fn acquire_ffmpeg_gpu_lease(plan_args: &[String]) -> Result<Option<media::gpu::GpuLease>, String> {
    if ffmpeg_plan_uses_gpu_encoder(plan_args) {
        services::gpu_arbiter()
            .acquire(media::gpu::GpuNeed::Heavy)
            .map(Some)
    } else {
        Ok(None)
    }
}

fn finish_ffmpeg_gpu_operation<T>(
    lease: Option<media::gpu::GpuLease>,
    operation: Result<T, String>,
) -> Result<T, String> {
    match lease {
        Some(lease) => lease.finish_with(operation),
        None => operation,
    }
}

/// Spawns ffmpeg for a compiled render plan and a monitor thread that streams
/// real `-progress` output into the status file. The status file must already
/// read `rendering` before this is called.
fn spawn_ffmpeg_render(
    job_id: String,
    plan_args: Vec<String>,
    status_path: PathBuf,
) -> Result<(), String> {
    let gpu_lease = match acquire_ffmpeg_gpu_lease(&plan_args) {
        Ok(lease) => lease,
        Err(error) => {
            if let Ok(mut status) = read_render_status(&status_path) {
                status.status = "failed".to_string();
                status.completed_at = Some(current_timestamp());
                status.updated_at = current_timestamp();
                status.error = Some(error.clone());
                let _ = write_render_status(&status_path, &status);
            }
            return Err(error);
        }
    };
    let ffmpeg = sidecar_path("ffmpeg");
    let mut args: Vec<String> = vec!["-nostats".into(), "-progress".into(), "pipe:1".into()];
    args.extend(plan_args);

    let mut child = match Command::new(&ffmpeg)
        .args(&args)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
    {
        Ok(child) => child,
        Err(error) => {
            let message = format!("failed to launch ffmpeg ({}): {error}", ffmpeg.display());
            return finish_ffmpeg_gpu_operation(gpu_lease, Err(message));
        }
    };

    let pid = child.id();
    if let Ok(mut map) = render_pids().lock() {
        map.insert(job_id.clone(), pid);
    }

    let stdout = child.stdout.take();
    let stderr = child.stderr.take();

    std::thread::spawn(move || {
        // Drain stderr concurrently so ffmpeg never blocks on a full pipe.
        let stderr_handle = stderr.map(|err| {
            std::thread::spawn(move || {
                use std::io::Read;
                let mut buf = String::new();
                let _ = BufReader::new(err).read_to_string(&mut buf);
                buf
            })
        });

        if let Some(out) = stdout {
            for line in BufReader::new(out).lines().map_while(Result::ok) {
                let Some(rest) = line.strip_prefix("frame=") else {
                    continue;
                };
                let Ok(frame) = rest.trim().parse::<u32>() else {
                    continue;
                };
                if let Ok(mut status) = read_render_status(&status_path) {
                    // The job was cancelled/paused out from under us — stop here.
                    if status.status == "cancelled" || status.status == "paused" {
                        break;
                    }
                    let total = status.total_frames.max(1);
                    status.current_frame = frame.min(total);
                    status.progress =
                        ((status.current_frame as f64 / total as f64) * 100.0).round() as u32;
                    status.status = "rendering".to_string();
                    status.estimated_time_remaining =
                        Some(total.saturating_sub(status.current_frame));
                    status.updated_at = current_timestamp();
                    let _ = write_render_status(&status_path, &status);
                }
            }
        }

        let exit = child.wait();
        if let Ok(mut map) = render_pids().lock() {
            map.remove(&job_id);
        }

        let stderr_log = stderr_handle.and_then(|handle| handle.join().ok());
        let stderr_tail = stderr_log
            .as_deref()
            .map(|log| {
                let tail: Vec<&str> = log.lines().filter(|line| !line.trim().is_empty()).collect();
                let start = tail.len().saturating_sub(4);
                tail[start..].join(" ")
            })
            .unwrap_or_default();
        let mut status = read_render_status(&status_path).ok();
        let was_stopped = status
            .as_ref()
            .is_some_and(|status| status.status == "cancelled" || status.status == "paused");
        let ffmpeg_succeeded = matches!(&exit, Ok(code) if code.success());
        let operation = if was_stopped || ffmpeg_succeeded {
            Ok(())
        } else if !stderr_tail.is_empty() {
            Err(stderr_tail)
        } else if let Err(error) = &exit {
            Err(format!("ffmpeg render wait failed: {error}"))
        } else {
            Err("ffmpeg render failed".to_string())
        };
        let completion = finish_ffmpeg_gpu_operation(gpu_lease, operation);

        if let Some(status) = status.as_mut() {
            // Cancellation and pause remain the user's chosen final states, but a failed
            // brain restore still needs to be visible in the persisted job status.
            if was_stopped {
                if let Err(error) = completion {
                    status.error = Some(error);
                    status.updated_at = current_timestamp();
                    let _ = write_render_status(&status_path, status);
                }
                return;
            }
            match completion {
                Ok(()) => {
                    status.status = "completed".to_string();
                    status.current_frame = status.total_frames;
                    status.progress = 100;
                    status.completed_at = Some(current_timestamp());
                    status.estimated_time_remaining = Some(0);
                    status.output_file_size =
                        fs::metadata(&status.output_path).ok().map(|m| m.len());
                    status.error = None;
                }
                Err(error) => {
                    status.status = "failed".to_string();
                    status.completed_at = Some(current_timestamp());
                    status.error = Some(error);
                }
            }
            status.updated_at = current_timestamp();
            let _ = write_render_status(&status_path, status);
        } else if let Err(error) = completion {
            eprintln!("FluxNode render job {job_id} completed without status file: {error}");
        }
    });

    Ok(())
}

/// Merges an explicit `{width,height}` resolution into a preset JSON value, replacing whatever
/// `resolution` held before — a concrete object, or the `"project"` sentinel string
/// (`RenderPreset.resolution: {width,height} | 'project'` on the TS side) — with the override.
/// A `None` override leaves the preset untouched. Pure and independent of any AppHandle/filesystem
/// state, unlike `restart_render_from_manifest`, so it is unit-testable on its own (see the
/// `apply_resolution_override_*` tests below) even though nothing else in this render-retry path
/// currently has direct test coverage.
fn apply_resolution_override(mut preset: Value, resolution_override: Option<(u32, u32)>) -> Value {
    if let Some((width, height)) = resolution_override {
        if let Some(obj) = preset.as_object_mut() {
            obj.insert(
                "resolution".to_string(),
                serde_json::json!({ "width": width, "height": height }),
            );
        }
    }
    preset
}

/// Rebuilds and re-runs a job's render plan from its manifest — used by resume and retry, neither
/// of which can truly resume mid-stream (a single ffmpeg encode can't), so both re-render from the
/// start. `resolution_override`, when given, replaces the manifest's ORIGINAL preset resolution for
/// this pass only — it is never written back to the manifest file. That is what makes the GPU-OOM
/// fallback (`scheduleRenderAutoRetry` in project-store.ts, which halves `job.config.resolution`
/// and schedules an automatic retry) actually take effect: without it, this function always
/// rebuilt the plan from the untouched original manifest, so a "reduced resolution" retry silently
/// re-ran the identical, already-failing ffmpeg invocation.
fn restart_render_from_manifest(
    app: &AppHandle,
    job_id: &str,
    resolution_override: Option<(u32, u32)>,
) -> Result<(), String> {
    let project_dir = get_current_project_dir(app)?
        .ok_or_else(|| "No active project directory is available".to_string())?;
    let render_cache_dir = project_dir.join("cache").join("renders");
    let manifest_path = render_cache_dir.join(format!("{job_id}.render.json"));
    let status_path = render_cache_dir.join(format!("{job_id}.status.json"));

    let manifest: Value =
        serde_json::from_str(&fs::read_to_string(&manifest_path).map_err(|e| e.to_string())?)
            .map_err(|e| e.to_string())?;
    let project_value = manifest
        .get("projectSnapshot")
        .cloned()
        .ok_or_else(|| "Render manifest is missing projectSnapshot".to_string())?;
    let preset_value = manifest
        .get("preset")
        .cloned()
        .ok_or_else(|| "Render manifest is missing preset".to_string())?;
    let preset_value = apply_resolution_override(preset_value, resolution_override);
    let output_path = manifest
        .get("outputPath")
        .and_then(|v| v.as_str())
        .ok_or_else(|| "Render manifest is missing outputPath".to_string())?
        .to_string();

    let plan = render_graph::build_render_plan(&project_value, &preset_value, &output_path)?;
    let total_frames = plan.total_frames.max(1);

    let mut status = read_render_status(&status_path)?;
    status.status = "rendering".to_string();
    status.current_frame = 0;
    status.progress = 0;
    status.total_frames = total_frames;
    status.completed_at = None;
    status.error = None;
    status.output_file_size = None;
    status.estimated_time_remaining = Some(total_frames);
    status.updated_at = current_timestamp();
    write_render_status(&status_path, &status)?;

    spawn_ffmpeg_render(job_id.to_string(), plan.args, status_path)
}

#[tauri::command]
fn render_start(
    app: AppHandle,
    job_id: String,
    project_json: String,
    preset_json: String,
) -> Result<String, String> {
    let project_dir = get_or_create_current_project_dir(&app, &project_json)?;
    ensure_project_structure(&project_dir)?;
    let project_value =
        serde_json::from_str::<Value>(&project_json).map_err(|error| error.to_string())?;
    let preset_value =
        serde_json::from_str::<Value>(&preset_json).map_err(|error| error.to_string())?;
    let started_at = current_timestamp();

    let output_state = project_value
        .get("output")
        .and_then(|value| value.as_object())
        .ok_or_else(|| "Project output state is missing".to_string())?;
    let export_defaults = output_state
        .get("exportDefaults")
        .and_then(|value| value.as_object())
        .ok_or_else(|| "Project export defaults are missing".to_string())?;
    let output_directory = export_defaults
        .get("outputDirectory")
        .and_then(|value| value.as_str())
        .ok_or_else(|| "Project output directory is missing".to_string())?;
    let format = preset_value
        .get("format")
        .and_then(|value| value.as_str())
        .ok_or_else(|| "Render preset format is missing".to_string())?;
    let project_id = project_value
        .get("meta")
        .and_then(|value| value.get("id"))
        .and_then(|value| value.as_str())
        .ok_or_else(|| "Project id is missing".to_string())?;

    let output_extension = if format == "png_sequence" {
        "zip"
    } else {
        format
    };
    let output_dir = resolve_export_directory(&app, output_directory)?;
    fs::create_dir_all(&output_dir).map_err(|error| error.to_string())?;
    let output_path = output_dir.join(format!("{project_id}-{job_id}.{output_extension}"));

    let output_str = output_path.to_string_lossy().to_string();
    let render_cache_dir = project_dir.join("cache").join("renders");
    fs::create_dir_all(&render_cache_dir).map_err(|error| error.to_string())?;
    let manifest_path = render_cache_dir.join(format!("{job_id}.render.json"));
    let status_path = render_cache_dir.join(format!("{job_id}.status.json"));

    // Compile the timeline into a concrete multi-track ffmpeg invocation.
    let plan = render_graph::build_render_plan(&project_value, &preset_value, &output_str)?;
    let total_frames = plan.total_frames.max(1);

    let manifest = serde_json::json!({
        "jobId": job_id,
        "projectSnapshot": project_value,
        "audioOutput": describe_workflow_audio_output(&project_value),
        "preset": preset_value,
        "outputPath": output_str,
        "startedAt": started_at,
        "totalFrames": total_frames
    });

    let status = RenderJobStatus {
        job_id: job_id.clone(),
        status: "rendering".to_string(),
        progress: 0,
        current_frame: 0,
        total_frames,
        updated_at: started_at.clone(),
        completed_at: None,
        estimated_time_remaining: Some(total_frames),
        output_path: output_str.clone(),
        output_file_size: None,
        error: None,
    };

    fs::write(
        &manifest_path,
        serde_json::to_string_pretty(&manifest).map_err(|error| error.to_string())?,
    )
    .map_err(|error| error.to_string())?;
    write_render_status(&status_path, &status)?;

    // Kick off the real encode in the background; progress streams into the
    // status file and the frontend polls render_get_status.
    spawn_ffmpeg_render(job_id.clone(), plan.args, status_path.clone())?;

    serde_json::to_string(&RenderJobStartResult {
        job_id,
        output_path: output_str,
        manifest_path: manifest_path.to_string_lossy().to_string(),
        status_path: status_path.to_string_lossy().to_string(),
        started_at,
        total_frames,
    })
    .map_err(|error| error.to_string())
}

#[tauri::command]
fn render_get_status(app: AppHandle, job_id: String) -> Result<String, String> {
    let project_dir = get_current_project_dir(&app)?
        .ok_or_else(|| "No active project directory is available".to_string())?;
    let status_path = project_dir
        .join("cache")
        .join("renders")
        .join(format!("{job_id}.status.json"));
    // The background render thread maintains the status file in real time;
    // just read and return the latest snapshot.
    let status = read_render_status(&status_path)?;
    serde_json::to_string(&status).map_err(|error| error.to_string())
}

#[tauri::command]
fn render_cancel(app: AppHandle, job_id: String) -> Result<(), String> {
    let project_dir = get_current_project_dir(&app)?
        .ok_or_else(|| "No active project directory is available".to_string())?;
    let status_path = project_dir
        .join("cache")
        .join("renders")
        .join(format!("{job_id}.status.json"));
    let mut status = read_render_status(&status_path)?;
    if status.status == "completed" {
        return Ok(());
    }
    // Mark cancelled BEFORE killing so the monitor thread doesn't flip it to failed.
    status.status = "cancelled".to_string();
    status.updated_at = current_timestamp();
    status.completed_at = Some(current_timestamp());
    status.estimated_time_remaining = Some(0);
    write_render_status(&status_path, &status)?;
    kill_render_process(&job_id);
    Ok(())
}

#[tauri::command]
fn render_pause(app: AppHandle, job_id: String) -> Result<(), String> {
    let project_dir = get_current_project_dir(&app)?
        .ok_or_else(|| "No active project directory is available".to_string())?;
    let status_path = project_dir
        .join("cache")
        .join("renders")
        .join(format!("{job_id}.status.json"));
    let mut status = read_render_status(&status_path)?;
    if status.status != "rendering" {
        return Ok(());
    }
    // Mark paused BEFORE killing so the monitor thread leaves it paused.
    status.status = "paused".to_string();
    status.updated_at = current_timestamp();
    status.estimated_time_remaining =
        Some(status.total_frames.saturating_sub(status.current_frame));
    write_render_status(&status_path, &status)?;
    kill_render_process(&job_id);
    Ok(())
}

#[tauri::command]
fn render_resume(app: AppHandle, job_id: String) -> Result<(), String> {
    // A single ffmpeg encode cannot resume mid-stream, so re-render from the start. Resuming a
    // paused job is unrelated to the GPU-OOM fallback path — no resolution override here.
    restart_render_from_manifest(&app, &job_id, None)
}

/// `resolution_override_width`/`_height` are set together or not at all — the frontend always
/// sends both from a single `{width,height}` job config (`services/ipc/render-job.ts`), so
/// `(Some, None)`/`(None, Some)` should not occur in practice; treated as "no override" here
/// rather than an error, since a partial/malformed override should not block a retry outright.
#[tauri::command]
fn render_retry(
    app: AppHandle,
    job_id: String,
    resume_from_current_frame: bool,
    resolution_override_width: Option<u32>,
    resolution_override_height: Option<u32>,
) -> Result<(), String> {
    // ffmpeg cannot resume a partial encode; always re-render from frame 0.
    let _ = resume_from_current_frame;
    let resolution_override = match (resolution_override_width, resolution_override_height) {
        (Some(width), Some(height)) => Some((width, height)),
        _ => None,
    };
    restart_render_from_manifest(&app, &job_id, resolution_override)
}

#[tauri::command]
fn mark_project_opened(app: AppHandle, project_json: String) -> Result<(), String> {
    let project_dir = get_or_create_current_project_dir(&app, &project_json)?;
    mark_project_opened_at_path(&app, &project_json, &project_dir)
}

fn load_project_from_dir(app: &AppHandle, project_dir: &Path) -> Result<Option<String>, String> {
    let project_path = project_dir.join("project.json");

    if !project_path.exists() {
        return Ok(None);
    }

    let base_project = fs::read_to_string(&project_path).map_err(|error| error.to_string())?;
    let wal_snapshot = reconstruct_project_from_wal(project_dir)?;

    if let Some(snapshot) = wal_snapshot {
        return Ok(Some(snapshot));
    }

    if let Some(snapshot) = read_latest_autosave_snapshot(project_dir)? {
        return Ok(Some(snapshot));
    }

    set_current_project_dir(app, project_dir)?;
    Ok(Some(base_project))
}

fn write_project_state_to_dir(
    app: &AppHandle,
    project_dir: &Path,
    project_json: &str,
    clear_wal: bool,
) -> Result<(), String> {
    ensure_project_structure(project_dir)?;
    security::atomic_write(&project_dir.join("project.json"), project_json.as_bytes())
        .map_err(|error| error.to_string())?;

    if clear_wal {
        truncate_wal(project_dir)?;
    }

    set_current_project_dir(app, project_dir)?;
    mark_project_opened_at_path(app, project_json, project_dir)
}

fn mark_project_opened_at_path(
    app: &AppHandle,
    project_json: &str,
    project_dir: &Path,
) -> Result<(), String> {
    let app_dir = ensure_app_dir(app)?;
    let recents_path = app_dir.join("recent.json");
    let project_value =
        serde_json::from_str::<Value>(project_json).map_err(|error| error.to_string())?;
    let meta = project_value
        .get("meta")
        .and_then(|value| value.as_object())
        .ok_or_else(|| "Project meta is missing".to_string())?;

    let project_name = meta
        .get("name")
        .and_then(|value| value.as_str())
        .ok_or_else(|| "Project name is missing".to_string())?;
    let thumbnail = meta.get("thumbnailPath").cloned().unwrap_or(Value::Null);
    let path_string = project_dir.to_string_lossy().to_string();

    let mut recents = if recents_path.exists() {
        serde_json::from_str::<Vec<Value>>(
            &fs::read_to_string(&recents_path).map_err(|error| error.to_string())?,
        )
        .map_err(|error| error.to_string())?
    } else {
        Vec::new()
    };

    recents.retain(|entry| {
        entry.get("path").and_then(|value| value.as_str()) != Some(path_string.as_str())
    });
    recents.insert(
        0,
        serde_json::json!({
            "path": path_string,
            "name": project_name,
            "lastOpened": current_timestamp(),
            "thumbnailPath": thumbnail
        }),
    );
    recents.truncate(20);

    fs::write(
        recents_path,
        serde_json::to_string_pretty(&recents).map_err(|error| error.to_string())?,
    )
    .map_err(|error| error.to_string())
}

fn ensure_project_structure(project_dir: &Path) -> Result<(), String> {
    fs::create_dir_all(project_dir.join("autosave")).map_err(|error| error.to_string())?;
    fs::create_dir_all(project_dir.join("thumbnails")).map_err(|error| error.to_string())?;
    fs::create_dir_all(project_dir.join("proxies")).map_err(|error| error.to_string())?;
    fs::create_dir_all(project_dir.join("media")).map_err(|error| error.to_string())?;
    fs::create_dir_all(project_dir.join("cache").join("waveforms"))
        .map_err(|error| error.to_string())?;
    fs::create_dir_all(project_dir.join("cache").join("renders"))
        .map_err(|error| error.to_string())?;
    fs::create_dir_all(project_dir.join("exports")).map_err(|error| error.to_string())?;
    Ok(())
}

fn trim_autosave_snapshots(autosave_dir: &Path) -> Result<(), String> {
    let mut entries = fs::read_dir(autosave_dir)
        .map_err(|error| error.to_string())?
        .filter_map(Result::ok)
        .filter(|entry| entry.file_name().to_string_lossy().starts_with("snapshot-"))
        .collect::<Vec<_>>();

    entries.sort_by_key(|entry| entry.file_name());

    while entries.len() > 10 {
        if let Some(entry) = entries.first() {
            fs::remove_file(entry.path()).map_err(|error| error.to_string())?;
        }
        entries.remove(0);
    }

    Ok(())
}

/// Reconstructs the latest project described by the WAL: finds the most recent embedded snapshot
/// (scanning backward) and replays the forward immer patches of every entry after it. Mirrors
/// reconstructProjectFromWal in the TypeScript LocalProjectRepository. Returns the serialized
/// project, or None when the WAL holds no snapshot to base off of. Replaying patches (rather than
/// the old "return the last full snapshot" behavior) is what keeps recovery correct now that most
/// entries carry only patches instead of a full project.
fn reconstruct_project_from_wal(project_dir: &Path) -> Result<Option<String>, String> {
    let wal_path = project_dir.join("autosave").join("wal.jsonl");
    let lines = read_wal_lines(&wal_path)?;
    if lines.is_empty() {
        return Ok(None);
    }

    let entries = lines
        .iter()
        .filter_map(|line| serde_json::from_str::<Value>(line).ok())
        .collect::<Vec<_>>();

    let Some(base_index) = entries.iter().rposition(|entry| {
        entry
            .get("projectSnapshot")
            .is_some_and(|value| !value.is_null())
    }) else {
        return Ok(None);
    };

    let mut project = entries[base_index]
        .get("projectSnapshot")
        .cloned()
        .unwrap_or(Value::Null);

    for entry in &entries[base_index + 1..] {
        if let Some(patches) = entry.get("patches").and_then(|value| value.as_array()) {
            if !patches.is_empty() {
                apply_immer_patches(&mut project, patches);
            }
        }
    }

    serde_json::to_string(&project)
        .map(Some)
        .map_err(|error| error.to_string())
}

/// Applies immer-style forward patches (`op` = "add" | "replace" | "remove", `path` = array of
/// object keys / array indices) to a serde_json value in place, including immer's array `length`
/// shrink patch. Paths that no longer resolve are skipped rather than panicking.
fn apply_immer_patches(root: &mut Value, patches: &[Value]) {
    for patch in patches {
        let Some(op) = patch.get("op").and_then(|value| value.as_str()) else {
            continue;
        };
        let Some(path) = patch.get("path").and_then(|value| value.as_array()) else {
            continue;
        };
        let value = patch.get("value").cloned();

        if path.is_empty() {
            if op != "remove" {
                if let Some(value) = value {
                    *root = value;
                }
            }
            continue;
        }

        apply_immer_patch_at(root, path, op, value);
    }
}

fn apply_immer_patch_at(root: &mut Value, path: &[Value], op: &str, value: Option<Value>) {
    let Some((last, parents)) = path.split_last() else {
        return;
    };

    let mut current = root;
    for segment in parents {
        current = match current {
            Value::Object(map) => {
                let Some(child) = segment.as_str().and_then(|key| map.get_mut(key)) else {
                    return;
                };
                child
            }
            Value::Array(items) => {
                let Some(child) = segment
                    .as_u64()
                    .and_then(|index| items.get_mut(index as usize))
                else {
                    return;
                };
                child
            }
            _ => return,
        };
    }

    match current {
        Value::Object(map) => {
            let Some(key) = last.as_str() else {
                return;
            };
            if op == "remove" {
                map.remove(key);
            } else if let Some(value) = value {
                map.insert(key.to_string(), value);
            }
        }
        Value::Array(items) => {
            // immer emits a `length` replace patch when an array shrinks.
            if last.as_str() == Some("length") {
                if let Some(new_len) = value.as_ref().and_then(|value| value.as_u64()) {
                    items.truncate(new_len as usize);
                }
                return;
            }

            let Some(index) = last.as_u64().map(|index| index as usize) else {
                return;
            };
            match op {
                "remove" => {
                    if index < items.len() {
                        items.remove(index);
                    }
                }
                "add" => {
                    let value = value.unwrap_or(Value::Null);
                    if index >= items.len() {
                        items.push(value);
                    } else {
                        items.insert(index, value);
                    }
                }
                _ => {
                    if let Some(value) = value {
                        if index >= items.len() {
                            items.push(value);
                        } else {
                            items[index] = value;
                        }
                    }
                }
            }
        }
        _ => {}
    }
}

/// Truncates the crash-recovery WAL to empty. Called whenever a durable copy of the project
/// becomes current (explicit save AND autosave), so the WAL can never grow without bound.
fn truncate_wal(project_dir: &Path) -> Result<(), String> {
    let wal_path = project_dir.join("autosave").join("wal.jsonl");
    security::atomic_write(&wal_path, b"").map_err(|error| error.to_string())
}

fn read_latest_autosave_snapshot(project_dir: &Path) -> Result<Option<String>, String> {
    let autosave_dir = project_dir.join("autosave");

    if !autosave_dir.exists() {
        return Ok(None);
    }

    let mut snapshots = fs::read_dir(&autosave_dir)
        .map_err(|error| error.to_string())?
        .filter_map(Result::ok)
        .filter(|entry| entry.file_name().to_string_lossy().starts_with("snapshot-"))
        .collect::<Vec<_>>();

    snapshots.sort_by_key(|entry| entry.file_name());
    let Some(entry) = snapshots.last() else {
        return Ok(None);
    };

    let snapshot_value = serde_json::from_str::<Value>(
        &fs::read_to_string(entry.path()).map_err(|error| error.to_string())?,
    )
    .map_err(|error| error.to_string())?;

    if let Some(project) = snapshot_value.get("project") {
        return serde_json::to_string(project)
            .map(Some)
            .map_err(|error| error.to_string());
    }

    Ok(None)
}

fn ensure_app_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let base_dir = app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?
        .join("FluxNode");

    fs::create_dir_all(&base_dir).map_err(|error| error.to_string())?;
    Ok(base_dir)
}

fn current_project_pointer_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(ensure_app_dir(app)?.join("current-project-path.txt"))
}

fn app_preferences_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(ensure_app_dir(app)?.join("preferences.json"))
}

fn get_current_project_dir(app: &AppHandle) -> Result<Option<PathBuf>, String> {
    let pointer_path = current_project_pointer_path(app)?;

    if !pointer_path.exists() {
        return Ok(None);
    }

    let value = fs::read_to_string(pointer_path).map_err(|error| error.to_string())?;
    let trimmed = value.trim();

    if trimmed.is_empty() {
        return Ok(None);
    }

    Ok(Some(PathBuf::from(trimmed)))
}

fn set_current_project_dir(app: &AppHandle, project_dir: &Path) -> Result<(), String> {
    let pointer_path = current_project_pointer_path(app)?;
    fs::write(pointer_path, project_dir.to_string_lossy().to_string())
        .map_err(|error| error.to_string())
}

fn get_or_create_current_project_dir(
    app: &AppHandle,
    project_json: &str,
) -> Result<PathBuf, String> {
    if let Some(path) = get_current_project_dir(app)? {
        return Ok(path);
    }

    let default_dir = default_project_dir(app, project_json)?;
    ensure_project_structure(&default_dir)?;
    set_current_project_dir(app, &default_dir)?;
    Ok(default_dir)
}

fn get_or_create_project_dir_from_wal(
    app: &AppHandle,
    entry_json: &str,
) -> Result<PathBuf, String> {
    if let Some(path) = get_current_project_dir(app)? {
        return Ok(path);
    }

    let value = serde_json::from_str::<Value>(entry_json).map_err(|error| error.to_string())?;
    let project_snapshot = value
        .get("projectSnapshot")
        .ok_or_else(|| "WAL entry is missing projectSnapshot".to_string())?;
    let default_dir = default_project_dir(
        app,
        &serde_json::to_string(project_snapshot).map_err(|error| error.to_string())?,
    )?;
    ensure_project_structure(&default_dir)?;
    set_current_project_dir(app, &default_dir)?;
    Ok(default_dir)
}

fn default_project_dir(app: &AppHandle, project_json: &str) -> Result<PathBuf, String> {
    let project_value =
        serde_json::from_str::<Value>(project_json).map_err(|error| error.to_string())?;
    let project_id = project_value
        .get("meta")
        .and_then(|value| value.get("id"))
        .and_then(|value| value.as_str())
        .unwrap_or("fluxnode-project");

    Ok(ensure_app_dir(app)?
        .join("workspace")
        .join(format!("{project_id}.fluxnode")))
}

fn normalize_project_dir(path: &str) -> PathBuf {
    let path_buf = PathBuf::from(path);
    let normalized = if path_buf.extension().and_then(|value| value.to_str()) == Some("fluxnode") {
        path_buf
    } else {
        PathBuf::from(format!("{}.fluxnode", path_buf.to_string_lossy()))
    };

    normalized
}

fn resolve_export_directory(app: &AppHandle, configured_path: &str) -> Result<PathBuf, String> {
    let configured = PathBuf::from(configured_path);

    if configured.is_absolute() {
        return Ok(configured);
    }

    Ok(ensure_app_dir(app)?.join(Path::new(configured_path)))
}

fn asset_watch_state() -> &'static Mutex<HashMap<String, WatchedAsset>> {
    ASSET_WATCH_STATE.get_or_init(|| Mutex::new(HashMap::new()))
}

fn ensure_asset_watch_thread(app: &AppHandle) {
    let app_handle = app.clone();
    ASSET_WATCH_THREAD.call_once(move || {
        std::thread::spawn(move || loop {
            let mut pending_events = Vec::new();

            if let Ok(mut watched_assets) = asset_watch_state().lock() {
                for (asset_id, watched_asset) in watched_assets.iter_mut() {
                    let next_observation = observe_path(Path::new(&watched_asset.path));

                    if next_observation != watched_asset.last_observation {
                        pending_events.push(AssetWatchEvent {
                            asset_id: asset_id.clone(),
                            path: watched_asset.path.clone(),
                            change_type: classify_asset_change(
                                &watched_asset.last_observation,
                                &next_observation,
                            ),
                            exists: next_observation.exists,
                            modified_at: next_observation.modified_at,
                            file_size: next_observation.file_size,
                            detected_at: current_timestamp(),
                        });
                        watched_asset.last_observation = next_observation;
                    }
                }
            }

            for event in pending_events {
                let _ = app_handle.emit("fluxnode://asset-watch", &event);
            }

            std::thread::sleep(Duration::from_secs(3));
        });
    });
}

fn observe_path(path: &Path) -> PathObservation {
    match fs::metadata(path) {
        Ok(metadata) => {
            let modified_at = metadata
                .modified()
                .ok()
                .and_then(|value| value.duration_since(UNIX_EPOCH).ok())
                .map(|value| value.as_secs());

            PathObservation {
                exists: true,
                modified_at,
                file_size: Some(metadata.len()),
            }
        }
        Err(_) => PathObservation {
            exists: false,
            modified_at: None,
            file_size: None,
        },
    }
}

fn classify_asset_change(previous: &PathObservation, current: &PathObservation) -> String {
    if previous.exists && !current.exists {
        return "deleted".to_string();
    }

    if !previous.exists && current.exists {
        return "restored".to_string();
    }

    if previous.modified_at != current.modified_at {
        return "modified".to_string();
    }

    if previous.file_size != current.file_size {
        return "resized".to_string();
    }

    "changed".to_string()
}

fn build_waveform_peaks_from_bytes(bytes: &[u8], bucket_count: usize) -> Vec<WaveformPeak> {
    if bytes.is_empty() {
        return build_waveform_peaks_from_seed("empty", bucket_count);
    }

    let chunk_size = ((bytes.len() as f64) / (bucket_count as f64)).ceil() as usize;

    (0..bucket_count)
        .map(|index| {
            let start = index * chunk_size;
            let end = usize::min(bytes.len(), start + chunk_size);
            let chunk = if start < end {
                &bytes[start..end]
            } else {
                &bytes[bytes.len() - 1..bytes.len()]
            };
            let mut min = 1.0_f32;
            let mut max = -1.0_f32;

            for byte in chunk {
                let normalized = (*byte as f32 / 255.0) * 2.0 - 1.0;
                if normalized < min {
                    min = normalized;
                }
                if normalized > max {
                    max = normalized;
                }
            }

            WaveformPeak { min, max }
        })
        .collect()
}

fn build_waveform_peaks_from_seed(seed: &str, bucket_count: usize) -> Vec<WaveformPeak> {
    let seed_value = seed
        .bytes()
        .fold(0_u32, |sum, byte| sum.wrapping_add(byte as u32));

    (0..bucket_count)
        .map(|index| {
            let angle = ((seed_value + (index as u32 * 17)) as f32) * 0.11;
            let spread = ((((seed_value + (index as u32 * 29)) as f32) * 0.07).cos() + 1.0) / 2.0;
            let max = 0.2 + spread * 0.8;
            let min = -0.15 - angle.sin().abs() * 0.75;
            WaveformPeak { min, max }
        })
        .collect()
}

fn build_preview_frame(
    asset_id: String,
    source_path: String,
    requested_time: f64,
    width: u32,
    height: u32,
) -> PreviewFrameData {
    let label = PathBuf::from(&source_path)
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or(source_path.as_str())
        .to_string();
    let seed = source_path
        .bytes()
        .fold(0_u32, |sum, byte| sum.wrapping_add(byte as u32));
    let primary = format!("#{:06x}", (seed.wrapping_mul(2654435761) & 0x00ff_ffff));
    let secondary = format!("#{:06x}", ((seed ^ 0x00ab_cdef) & 0x00ff_ffff));
    let svg = format!(
        r##"<svg xmlns="http://www.w3.org/2000/svg" width="{width}" height="{height}" viewBox="0 0 {width} {height}">
<defs>
  <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0%" stop-color="{primary}"/>
    <stop offset="100%" stop-color="{secondary}"/>
  </linearGradient>
</defs>
<rect width="100%" height="100%" fill="url(#bg)"/>
<rect x="{frame_x}" y="{frame_y}" width="{frame_w}" height="{frame_h}" rx="22" fill="rgba(12,15,20,0.76)" stroke="rgba(255,255,255,0.16)"/>
<circle cx="{orb_x}" cy="{orb_y}" r="{orb_r}" fill="rgba(224,255,0,0.18)"/>
<text x="50%" y="42%" text-anchor="middle" fill="#f8fafc" font-size="{title_size}" font-family="Arial, sans-serif">{label}</text>
<text x="50%" y="54%" text-anchor="middle" fill="#dbe4ef" font-size="{meta_size}" font-family="Arial, sans-serif">Decoded frame at {requested_time:.2}s</text>
<text x="50%" y="65%" text-anchor="middle" fill="#a7b4c4" font-size="{meta_size}" font-family="Arial, sans-serif">{asset_id}</text>
</svg>"##,
        width = width,
        height = height,
        primary = primary,
        secondary = secondary,
        frame_x = width / 10,
        frame_y = height / 7,
        frame_w = width - (width / 5),
        frame_h = height - (height / 3),
        orb_x = width - (width / 6),
        orb_y = height / 4,
        orb_r = u32::max(28, width / 14),
        title_size = u32::max(18, width / 26),
        meta_size = u32::max(12, width / 44),
        label = escape_xml(&label),
        requested_time = requested_time,
        asset_id = escape_xml(&asset_id),
    );
    let data_url = format!("data:image/svg+xml;charset=utf-8,{}", url_encode_svg(&svg));

    PreviewFrameData {
        asset_id,
        source_path,
        source_file_name: None,
        source_result_id: None,
        requested_time,
        width,
        height,
        mime_type: "image/svg+xml".to_string(),
        data_url,
        generated_at: current_timestamp(),
    }
}

fn escape_xml(value: &str) -> String {
    value
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&apos;")
}

fn url_encode_svg(value: &str) -> String {
    value
        .bytes()
        .flat_map(|byte| match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                vec![byte as char]
            }
            _ => format!("%{:02X}", byte).chars().collect::<Vec<_>>(),
        })
        .collect()
}

#[allow(dead_code)] // retained for tests and as a fallback frame estimate
fn estimate_total_frames(project_value: &Value) -> u32 {
    let frame_rate = project_value
        .get("settings")
        .and_then(|value| value.get("frameRate"))
        .and_then(|value| value.as_f64())
        .unwrap_or(30.0);
    let timeline = match project_value
        .get("timeline")
        .and_then(|value| value.as_object())
    {
        Some(value) => value,
        None => return 120,
    };
    let out_point = timeline.get("outPoint").and_then(|value| value.as_f64());
    let tracks = timeline
        .get("tracks")
        .and_then(|value| value.as_array())
        .cloned()
        .unwrap_or_default();

    let mut duration = out_point.unwrap_or(0.0);
    for track in tracks {
        if let Some(clips) = track.get("clips").and_then(|value| value.as_array()) {
            for clip in clips {
                let start = clip
                    .get("startTime")
                    .and_then(|value| value.as_f64())
                    .unwrap_or(0.0);
                let clip_duration = clip
                    .get("duration")
                    .and_then(|value| value.as_f64())
                    .unwrap_or(0.0);
                duration = duration.max(start + clip_duration);
            }
        }
    }

    (duration * frame_rate).round() as u32
}

fn describe_workflow_audio_output(project_value: &Value) -> Value {
    let Some(workflow) = project_value
        .get("workflow")
        .and_then(|value| value.as_object())
    else {
        return serde_json::json!({
            "mode": "muted",
            "summary": "Workflow state missing"
        });
    };

    let nodes = workflow
        .get("nodes")
        .and_then(|value| value.as_array())
        .cloned()
        .unwrap_or_default();
    let edges = workflow
        .get("edges")
        .and_then(|value| value.as_array())
        .cloned()
        .unwrap_or_default();

    let output_node_id = nodes.iter().find_map(|node| {
        if node.get("type").and_then(|value| value.as_str()) == Some("output") {
            node.get("id")
                .and_then(|value| value.as_str())
                .map(|value| value.to_string())
        } else {
            None
        }
    });

    let Some(output_node_id) = output_node_id else {
        return serde_json::json!({
            "mode": "muted",
            "summary": "No output node available"
        });
    };

    let output_audio_edge = edges.iter().find(|edge| {
        edge.get("target").and_then(|value| value.as_str()) == Some(output_node_id.as_str())
            && edge.get("targetHandle").and_then(|value| value.as_str()) == Some("audio")
    });

    let Some(output_audio_edge) = output_audio_edge else {
        return serde_json::json!({
            "mode": "muted",
            "summary": "No audio connected to output"
        });
    };

    let source_node_id = output_audio_edge
        .get("source")
        .and_then(|value| value.as_str())
        .unwrap_or_default();
    let source_node = nodes
        .iter()
        .find(|node| node.get("id").and_then(|value| value.as_str()) == Some(source_node_id));

    let Some(source_node) = source_node else {
        return serde_json::json!({
            "mode": "muted",
            "summary": "Audio connection source missing"
        });
    };

    let source_label = source_node
        .get("label")
        .and_then(|value| value.as_str())
        .filter(|value| !value.is_empty())
        .unwrap_or(source_node_id);
    let source_type = source_node
        .get("type")
        .and_then(|value| value.as_str())
        .unwrap_or_default();

    if source_type == "audio_mix" {
        let input_count = edges
            .iter()
            .filter(|edge| {
                edge.get("target").and_then(|value| value.as_str()) == Some(source_node_id)
                    && edge.get("targetHandle").and_then(|value| value.as_str()) == Some("input")
            })
            .count();

        return serde_json::json!({
            "mode": "muxed",
            "summary": format!("{source_label} muxes {input_count} input(s)")
        });
    }

    serde_json::json!({
        "mode": "muxed",
        "summary": format!("{source_label} routed directly to output")
    })
}

fn read_render_status(status_path: &Path) -> Result<RenderJobStatus, String> {
    let value = fs::read_to_string(status_path).map_err(|error| error.to_string())?;
    serde_json::from_str::<RenderJobStatusSerde>(&value)
        .map(|parsed| parsed.into_render_status())
        .map_err(|error| error.to_string())
}

fn write_render_status(status_path: &Path, status: &RenderJobStatus) -> Result<(), String> {
    let serializable = RenderJobStatusSerde::from_render_status(status);
    let body = serde_json::to_string_pretty(&serializable).map_err(|error| error.to_string())?;
    security::atomic_write(status_path, body.as_bytes()).map_err(|error| error.to_string())
}

fn serialize_detached_panel_layout(
    window: Option<&tauri::WebviewWindow>,
    detached: bool,
) -> Result<String, String> {
    let (width, height, x, y) = if let Some(window) = window {
        let size = window.inner_size().map_err(|error| error.to_string())?;
        let position = window.outer_position().ok();
        (
            size.width as f64,
            size.height as f64,
            position.map(|value| value.x as f64),
            position.map(|value| value.y as f64),
        )
    } else {
        (960.0, 720.0, None, None)
    };

    serde_json::to_string(&DetachedPanelLayoutPayload {
        detached,
        width,
        height,
        x,
        y,
    })
    .map_err(|error| error.to_string())
}

fn capitalize_panel_name(panel: &str) -> String {
    let mut chars = panel.chars();
    match chars.next() {
        Some(first) => format!("{}{}", first.to_ascii_uppercase(), chars.as_str()),
        None => "Panel".to_string(),
    }
}

#[derive(serde::Serialize, serde::Deserialize)]
struct RenderJobStatusSerde {
    job_id: String,
    status: String,
    progress: u32,
    current_frame: u32,
    total_frames: u32,
    updated_at: String,
    completed_at: Option<String>,
    estimated_time_remaining: Option<u32>,
    output_path: String,
    output_file_size: Option<u64>,
    error: Option<String>,
}

impl RenderJobStatusSerde {
    fn from_render_status(status: &RenderJobStatus) -> Self {
        Self {
            job_id: status.job_id.clone(),
            status: status.status.clone(),
            progress: status.progress,
            current_frame: status.current_frame,
            total_frames: status.total_frames,
            updated_at: status.updated_at.clone(),
            completed_at: status.completed_at.clone(),
            estimated_time_remaining: status.estimated_time_remaining,
            output_path: status.output_path.clone(),
            output_file_size: status.output_file_size,
            error: status.error.clone(),
        }
    }

    fn into_render_status(self) -> RenderJobStatus {
        RenderJobStatus {
            job_id: self.job_id,
            status: self.status,
            progress: self.progress,
            current_frame: self.current_frame,
            total_frames: self.total_frames,
            updated_at: self.updated_at,
            completed_at: self.completed_at,
            estimated_time_remaining: self.estimated_time_remaining,
            output_path: self.output_path,
            output_file_size: self.output_file_size,
            error: self.error,
        }
    }
}

fn current_timestamp() -> String {
    let duration = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default();

    format!("{}", duration.as_secs())
}

fn iso_timestamp_now() -> String {
    let duration = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default();

    format!("{}Z", duration.as_secs())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
/// Chat with the in-app copilot: runs the agent loop (Ollama brain) against the live Action
/// registry, letting the model call FluxNode tools to answer. `model` defaults to a local
/// tool-calling model.
///
/// Heavy (drives an LLM chat loop + tool calls that may shell out) — genuinely run off the main
/// thread via `spawn_blocking`. (Previously this doc comment claimed that already; the fn body
/// was plain synchronous `#[tauri::command]`, which Tauri dispatches ON the UI/main thread — the
/// claim was false until this conversion.)
#[tauri::command]
async fn agent_chat(
    app: AppHandle,
    message: String,
    model: Option<String>,
    allow_writes: Option<bool>,
) -> Result<brain::AgentOutcome, String> {
    tokio::task::spawn_blocking(move || agent_chat_blocking(app, message, model, allow_writes))
        .await
        .map_err(|error| error.to_string())?
}

fn agent_chat_blocking(
    app: AppHandle,
    message: String,
    model: Option<String>,
    allow_writes: Option<bool>,
) -> Result<brain::AgentOutcome, String> {
    // Default: the shared brain (wired to the GPU arbiter). A custom model spins up a one-off.
    let allow_writes = allow_writes.unwrap_or(false); // gate write/long tools unless opted in
    match model {
        None => {
            let engine = services::brain();
            let coordinated = brain::GpuCoordinatedBrain::new(
                engine.as_ref(),
                engine.clone(),
                services::gpu_arbiter(),
            );
            brain::run_agent(
                &app,
                actions::registry(),
                &coordinated,
                &message,
                8,
                allow_writes,
            )
        }
        Some(model) => {
            let engine = Arc::new(brain::ollama::OllamaBrain::local(model));
            let coordinated = brain::GpuCoordinatedBrain::new(
                engine.as_ref(),
                engine.clone(),
                services::gpu_arbiter(),
            );
            brain::run_agent(
                &app,
                actions::registry(),
                &coordinated,
                &message,
                8,
                allow_writes,
            )
        }
    }
}

pub fn run() {
    let args: Vec<String> = std::env::args().collect();

    // Headless MCP mode: expose the Action registry over stdio for external agents, then exit
    // without ever starting the GUI. Invoked as `fluxnode --mcp` (spawned by an MCP client).
    if args.iter().any(|a| a == "--mcp") {
        let allow_writes = args.iter().any(|a| a == "--allow-writes");
        run_mcp(allow_writes);
        return;
    }

    // Headless agent mode: `fluxnode --agent "<message>" [--allow-writes]` runs one agent-loop
    // turn against the live registry and prints the answer. End-to-end smoke test / scripting.
    if let Some(i) = args.iter().position(|a| a == "--agent") {
        let message = args.get(i + 1).cloned().unwrap_or_default();
        let allow_writes = args.iter().any(|a| a == "--allow-writes");
        run_agent_cli(&message, allow_writes);
        return;
    }

    tauri::Builder::default()
        // Signed auto-updates (tauri-plugin-updater) + relaunch-after-install
        // (tauri-plugin-process). Registered only for the GUI entry — the headless
        // --mcp/--agent builders never update themselves.
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .invoke_handler(tauri::generate_handler![
            actions::action_invoke,
            actions::action_list,
            agent_chat,
            append_wal_entry,
            app_quit,
            asset_copy_into_project,
            asset_generate_thumbnail,
            asset_generate_proxy,
            asset_generate_waveform,
            asset_probe,
            asset_watch_sync,
            autosave_project_state,
            check_for_app_update,
            create_project_at_path,
            download_app_update,
            fs_pick_directory,
            fs_pick_media_file,
            get_app_version,
            get_cloud_api_key,
            get_current_project_path,
            health_ping,
            inspect_asset_path,
            load_app_preferences,
            load_project_state,
            load_recent_projects,
            mark_project_opened,
            open_project_at_path,
            panel_window_broadcast_state,
            panel_window_close,
            panel_window_open,
            render_cancel,
            render_get_status,
            render_pause,
            render_resume,
            render_retry,
            render_start,
            save_project_state,
            save_project_state_as,
            save_app_preferences,
            set_cloud_api_key,
            shell_open_path,
            start_export_job,
            comfy_ping,
            comfy_generate,
            narrated_scene_list_voices,
            narrated_scene_run,
            video_decode_frame,
            video_seek,
            workflow_render_node,
            workflow_materialize_generated_image,
            window_toggle_fullscreen
        ])
        .run(tauri::generate_context!())
        .expect("error while running FluxNode");
}

/// Headless entry for `fluxnode --mcp`: builds an `AppHandle` (actions need it for app-dir I/O),
/// then serves the Action registry over stdio via `rmcp`. Blocks until the client disconnects.
///
/// The MCP entry builds an AppHandle without the configured GUI windows, then serves JSON-RPC over
/// stdin/stdout until the client disconnects. Tauri still owns a small Tao event-target helper
/// window on Windows; it is not a FluxNode application window. Never `println!` here — stdout is
/// the JSON-RPC channel.
fn run_mcp(allow_writes: bool) {
    let mut context = tauri::generate_context!();
    // `Builder::build` creates every window listed in the application config. MCP needs an
    // AppHandle for filesystem-backed actions, but it must stay headless, so remove window
    // declarations before Tauri constructs any native windows.
    context.config_mut().app.windows.clear();
    let app = tauri::Builder::default()
        .build(context)
        .expect("failed to build FluxNode (mcp mode)");
    let handle = app.handle().clone();

    let registry = std::sync::Arc::new({
        let mut reg = action::Registry::new();
        actions::register_all(&mut reg);
        reg
    });

    let runtime = tokio::runtime::Builder::new_multi_thread()
        .enable_all()
        .build()
        .expect("failed to build tokio runtime for mcp mode");

    if let Err(err) = runtime.block_on(mcp::serve_stdio(registry, handle, allow_writes)) {
        eprintln!("fluxnode mcp server error: {err}");
    }
}

/// Headless entry for `fluxnode --agent "<message>" [--allow-writes]`: builds an `AppHandle`,
/// runs one agent-loop conversation against the live registry via the shared brain, and prints
/// the final answer to stdout. End-to-end smoke test without the GUI.
fn run_agent_cli(message: &str, allow_writes: bool) {
    let mut context = tauri::generate_context!();
    context.config_mut().app.windows.clear();
    let app = tauri::Builder::default()
        .build(context)
        .expect("failed to build FluxNode (agent mode)");
    let handle = app.handle().clone();
    let engine = services::brain();
    let coordinated =
        brain::GpuCoordinatedBrain::new(engine.as_ref(), engine.clone(), services::gpu_arbiter());

    match brain::run_agent(
        &handle,
        actions::registry(),
        &coordinated,
        message,
        8,
        allow_writes,
    ) {
        // stdout stays the plain answer (the bench harness reads it); proposals go to stderr so
        // scripting can still see what the run would change without approval.
        Ok(outcome) => {
            println!("{}", outcome.answer);
            if !outcome.proposals.is_empty() {
                eprintln!(
                    "proposals: {}",
                    serde_json::to_string(&outcome.proposals).unwrap_or_default()
                );
            }
        }
        Err(err) => eprintln!("agent error: {err}"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_nvidia_smi_mib_values_as_gib_and_sums_adapters() {
        assert_eq!(parse_nvidia_smi_memory_gb("12288\n"), Some(12.0));
        assert_eq!(parse_nvidia_smi_memory_gb("8192\n4096\n"), Some(12.0));
        assert_eq!(parse_nvidia_smi_memory_gb("N/A\n"), None);
    }

    #[test]
    fn apply_resolution_override_replaces_a_concrete_resolution() {
        let preset =
            serde_json::json!({ "id": "p1", "resolution": { "width": 3840, "height": 2160 } });
        let result = apply_resolution_override(preset, Some((1920, 1080)));
        assert_eq!(
            result["resolution"],
            serde_json::json!({ "width": 1920, "height": 1080 })
        );
        // Every other field survives untouched.
        assert_eq!(result["id"], serde_json::json!("p1"));
    }

    #[test]
    fn apply_resolution_override_replaces_the_project_sentinel() {
        // A preset can defer resolution to project settings via the string "project" instead of
        // an object — an override must win regardless of what it's replacing.
        let preset = serde_json::json!({ "resolution": "project" });
        let result = apply_resolution_override(preset, Some((1280, 720)));
        assert_eq!(
            result["resolution"],
            serde_json::json!({ "width": 1280, "height": 720 })
        );
    }

    #[test]
    fn apply_resolution_override_is_a_no_op_when_none() {
        let preset = serde_json::json!({ "resolution": { "width": 3840, "height": 2160 } });
        let result = apply_resolution_override(preset.clone(), None);
        assert_eq!(result, preset);
    }

    #[test]
    fn url_encode_svg_passes_unreserved_and_escapes_the_rest() {
        assert_eq!(url_encode_svg("abcXYZ-_.~09"), "abcXYZ-_.~09");
        assert_eq!(url_encode_svg("a b"), "a%20b");
        assert_eq!(url_encode_svg("<svg>"), "%3Csvg%3E");
    }

    #[test]
    fn apply_immer_patches_handles_replace_add_remove_and_length() {
        let mut value = serde_json::json!({
            "meta": { "name": "old", "stale": 1 },
            "list": [1, 2, 3],
        });
        apply_immer_patches(
            &mut value,
            &[
                serde_json::json!({ "op": "replace", "path": ["meta", "name"], "value": "new" }),
                serde_json::json!({ "op": "add", "path": ["meta", "extra"], "value": true }),
                serde_json::json!({ "op": "remove", "path": ["meta", "stale"] }),
                serde_json::json!({ "op": "replace", "path": ["list", 0], "value": 9 }),
                serde_json::json!({ "op": "replace", "path": ["list", "length"], "value": 2 }),
            ],
        );
        assert_eq!(value["meta"]["name"], serde_json::json!("new"));
        assert_eq!(value["meta"]["extra"], serde_json::json!(true));
        assert!(value["meta"].get("stale").is_none());
        assert_eq!(value["list"], serde_json::json!([9, 2]));
    }

    #[test]
    fn build_bounded_wal_lines_embeds_base_snapshot_then_drops_it() {
        let base = serde_json::json!({
            "id": "a", "timestamp": "t", "type": "x", "label": "l",
            "projectSnapshot": { "meta": { "name": "p" } },
            "patches": [],
        })
        .to_string();

        let first = build_bounded_wal_lines(Vec::new(), &base).unwrap();
        assert_eq!(first.len(), 1);
        let stored: Value = serde_json::from_str(&first[0]).unwrap();
        assert!(
            stored.get("projectSnapshot").is_some(),
            "first entry embeds a snapshot"
        );
        assert!(
            stored.get("patches").is_none(),
            "snapshot entry drops redundant patches"
        );

        // A subsequent entry (snapshot still within interval) stores patches only, even though the
        // store handed us a full projectSnapshot alongside them.
        let follow = serde_json::json!({
            "id": "b", "timestamp": "t", "type": "x", "label": "l",
            "projectSnapshot": { "meta": { "name": "p2" } },
            "patches": [{ "op": "replace", "path": ["meta", "name"], "value": "p2" }],
        })
        .to_string();
        let second = build_bounded_wal_lines(first, &follow).unwrap();
        assert_eq!(second.len(), 2);
        let stored: Value = serde_json::from_str(&second[1]).unwrap();
        assert!(
            stored.get("projectSnapshot").is_none(),
            "non-base entry drops the snapshot"
        );
        assert!(stored.get("patches").is_some());
    }

    #[test]
    fn build_bounded_wal_lines_caps_at_wal_limit_and_retains_a_snapshot() {
        let mut lines: Vec<String> = Vec::new();
        for i in 0..(WAL_LIMIT * 2) {
            let entry = serde_json::json!({
                "id": format!("id-{i}"), "timestamp": "t", "type": "x", "label": "l",
                "projectSnapshot": { "meta": { "seq": i } },
                "patches": [{ "op": "replace", "path": ["meta", "seq"], "value": i }],
            })
            .to_string();
            lines = build_bounded_wal_lines(lines, &entry).unwrap();
            assert!(
                lines.len() <= WAL_LIMIT,
                "never exceeds the ring-buffer cap"
            );
        }
        assert_eq!(lines.len(), WAL_LIMIT);
        let has_snapshot = lines.iter().any(|line| {
            serde_json::from_str::<Value>(line)
                .map(|value| value.get("projectSnapshot").is_some())
                .unwrap_or(false)
        });
        assert!(
            has_snapshot,
            "a trimmed window still contains a snapshot to reconstruct from"
        );
    }

    #[test]
    fn reconstruct_project_from_wal_replays_patches_onto_latest_snapshot() {
        let dir =
            std::env::temp_dir().join(format!("fluxnode-wal-reconstruct-{}", std::process::id()));
        let autosave = dir.join("autosave");
        fs::create_dir_all(&autosave).unwrap();

        let mut lines: Vec<String> = Vec::new();
        let base = serde_json::json!({
            "id": "a", "timestamp": "t", "type": "x", "label": "l",
            "projectSnapshot": { "meta": { "name": "base" }, "value": 1 },
            "patches": [],
        })
        .to_string();
        lines = build_bounded_wal_lines(lines, &base).unwrap();
        let patch = serde_json::json!({
            "id": "b", "timestamp": "t", "type": "x", "label": "l",
            "projectSnapshot": { "meta": { "name": "later" }, "value": 2 },
            "patches": [{ "op": "replace", "path": ["value"], "value": 2 }],
        })
        .to_string();
        lines = build_bounded_wal_lines(lines, &patch).unwrap();

        let body = format!("{}\n", lines.join("\n"));
        fs::write(autosave.join("wal.jsonl"), body).unwrap();

        let reconstructed = reconstruct_project_from_wal(&dir)
            .unwrap()
            .expect("WAL contains a snapshot");
        let value: Value = serde_json::from_str(&reconstructed).unwrap();
        // Base snapshot is retained (the follow-up entry's snapshot was dropped in favor of its
        // patches), and the forward patch is replayed on top of it.
        assert_eq!(value["meta"]["name"], serde_json::json!("base"));
        assert_eq!(
            value["value"],
            serde_json::json!(2),
            "forward patch replayed on recovery"
        );

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn estimate_total_frames_uses_frame_rate_and_clip_extent() {
        let project = serde_json::json!({
            "settings": { "frameRate": 30.0 },
            "timeline": {
                "outPoint": 0.0,
                "tracks": [
                    { "clips": [ { "startTime": 2.0, "duration": 8.0 } ] }
                ]
            }
        });
        // extent = 2s + 8s = 10s at 30fps => 300 frames
        assert_eq!(estimate_total_frames(&project), 300);
    }

    #[test]
    fn estimate_total_frames_falls_back_without_timeline() {
        let project = serde_json::json!({ "settings": { "frameRate": 30.0 } });
        assert_eq!(estimate_total_frames(&project), 120);
    }

    #[test]
    fn asset_probe_reads_real_metadata_via_ffprobe() {
        let ffmpeg = sidecar_path("ffmpeg");
        let ffprobe = sidecar_path("ffprobe");
        if !ffmpeg.exists() || !ffprobe.exists() {
            eprintln!("skipping: ffmpeg/ffprobe sidecars not staged");
            return;
        }

        let out = std::env::temp_dir().join("fluxnode-probe-test.mp4");
        let _ = fs::remove_file(&out);

        let status = Command::new(&ffmpeg)
            .args([
                "-y",
                "-f",
                "lavfi",
                "-i",
                "testsrc=size=320x240:rate=25:duration=1",
                "-f",
                "lavfi",
                "-i",
                "sine=frequency=440:duration=1",
                "-c:v",
                "mpeg4",
                "-c:a",
                "aac",
                "-shortest",
            ])
            .arg(&out)
            .status()
            .expect("ffmpeg should launch");
        assert!(
            status.success(),
            "ffmpeg failed to synthesize the test clip"
        );

        let report = run_ffprobe(&out.to_string_lossy()).expect("ffprobe should succeed");
        let size = fs::metadata(&out).map(|meta| meta.len()).unwrap_or(0);
        let probe = probe_result_from_ffprobe(&report, size);

        assert_eq!(probe.width, Some(320));
        assert_eq!(probe.height, Some(240));
        assert_eq!(probe.frame_rate, Some(25.0));
        assert!(probe.codec.is_some(), "codec should be detected");
        assert_eq!(probe.channels, Some(1));
        let duration = probe.duration.expect("duration should be present");
        assert!(
            (duration - 1.0).abs() < 0.25,
            "duration ~1s, got {duration}"
        );

        let _ = fs::remove_file(&out);
    }
}

#[cfg(test)]
mod render_pipeline_tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn ffmpeg_gpu_lease_is_required_only_for_nvenc_plans() {
        assert!(!ffmpeg_plan_uses_gpu_encoder(&[
            "-c:v".to_string(),
            "libx264".to_string(),
        ]));
        assert!(ffmpeg_plan_uses_gpu_encoder(&[
            "-c:v".to_string(),
            "h264_nvenc".to_string(),
        ]));
        assert!(ffmpeg_plan_uses_gpu_encoder(&[
            "-c:v".to_string(),
            "hevc_nvenc".to_string(),
        ]));
        assert!(!ffmpeg_plan_uses_gpu_encoder(&[
            "-c:v".to_string(),
            "libx264".to_string(),
        ]));
    }

    #[test]
    fn render_plan_produces_a_real_composited_video() {
        let ffmpeg = sidecar_path("ffmpeg");
        let ffprobe = sidecar_path("ffprobe");
        if !ffmpeg.exists() || !ffprobe.exists() {
            eprintln!("skipping: ffmpeg/ffprobe sidecars not staged");
            return;
        }

        let dir = std::env::temp_dir();
        let vsrc = dir.join("fluxnode-render-vsrc.mp4");
        let asrc = dir.join("fluxnode-render-asrc.wav");
        let out = dir.join("fluxnode-render-out.mp4");
        for f in [&vsrc, &asrc, &out] {
            let _ = fs::remove_file(f);
        }

        // Synthesize a 1s 320x240@25 video (with audio) and a 1s tone.
        let ok_v = Command::new(&ffmpeg)
            .args([
                "-y",
                "-f",
                "lavfi",
                "-i",
                "testsrc=size=320x240:rate=25:duration=1",
                "-f",
                "lavfi",
                "-i",
                "sine=frequency=440:duration=1",
                "-c:v",
                "mpeg4",
                "-c:a",
                "aac",
                "-shortest",
            ])
            .arg(&vsrc)
            .status()
            .expect("ffmpeg should launch")
            .success();
        assert!(ok_v, "failed to synthesize the video source");
        let ok_a = Command::new(&ffmpeg)
            .args(["-y", "-f", "lavfi", "-i", "sine=frequency=220:duration=1"])
            .arg(&asrc)
            .status()
            .expect("ffmpeg should launch")
            .success();
        assert!(ok_a, "failed to synthesize the audio source");

        let project = json!({
            "settings": { "resolution": { "width": 320, "height": 240 }, "frameRate": 25.0 },
            "audio": { "masterVolume": 1.0 },
            "assets": { "assets": {
                "v": { "type": "video", "sourcePath": vsrc.to_string_lossy() },
                "a": { "type": "audio", "sourcePath": asrc.to_string_lossy() }
            }},
            "timeline": { "tracks": [
                { "type": "video", "muted": false, "solo": false, "volume": 1.0, "clips": [
                    { "assetId": "v", "startTime": 0.0, "duration": 1.0, "inPoint": 0.0, "outPoint": 1.0,
                      "speed": 1.0, "volume": 1.0, "opacity": 1.0,
                      "transform": { "x": 0.0, "y": 0.0, "scaleX": 1.0, "scaleY": 1.0, "rotation": 0.0 } }
                ]},
                { "type": "audio", "muted": false, "solo": false, "volume": 1.0, "clips": [
                    { "assetId": "a", "startTime": 0.0, "duration": 1.0, "inPoint": 0.0, "outPoint": 1.0,
                      "speed": 1.0, "volume": 1.0, "opacity": 1.0,
                      "transform": { "x": 0.0, "y": 0.0, "scaleX": 1.0, "scaleY": 1.0, "rotation": 0.0 } }
                ]}
            ]}
        });
        let preset = json!({
            "format": "mp4", "videoCodec": "mpeg4", "audioCodec": "aac",
            "resolution": { "width": 320, "height": 240 }, "framerate": 25, "quality": "medium"
        });

        let out_str = out.to_string_lossy().to_string();
        let plan = crate::render_graph::build_render_plan(&project, &preset, &out_str)
            .expect("build_render_plan should succeed");
        assert_eq!(plan.total_frames, 25, "1s @ 25fps => 25 frames");

        let result = Command::new(&ffmpeg)
            .args(&plan.args)
            .output()
            .expect("ffmpeg should launch");
        assert!(
            result.status.success(),
            "ffmpeg render failed: {}",
            String::from_utf8_lossy(&result.stderr)
        );

        let report = run_ffprobe(&out_str).expect("ffprobe should read the rendered output");
        let probe =
            probe_result_from_ffprobe(&report, fs::metadata(&out).map(|m| m.len()).unwrap_or(0));
        assert_eq!(probe.width, Some(320), "composited canvas width");
        assert_eq!(probe.height, Some(240), "composited canvas height");
        let d = probe.duration.expect("rendered duration should be present");
        assert!((d - 1.0).abs() < 0.4, "rendered duration ~1s, got {d}");

        for f in [&vsrc, &asrc, &out] {
            let _ = fs::remove_file(f);
        }
    }
}

#[cfg(test)]
mod workflow_exec_tests {
    use super::*;
    use serde_json::{json, Value};

    #[test]
    fn workflow_render_node_produces_a_real_png_preview() {
        let ffmpeg = sidecar_path("ffmpeg");
        if !ffmpeg.exists() {
            eprintln!("skipping: ffmpeg sidecar not staged");
            return;
        }

        let vsrc = std::env::temp_dir().join("fluxnode-wf-src.mp4");
        let _ = fs::remove_file(&vsrc);
        let ok = Command::new(&ffmpeg)
            .args([
                "-y",
                "-f",
                "lavfi",
                "-i",
                "testsrc=size=320x240:rate=25:duration=1",
                "-c:v",
                "mpeg4",
            ])
            .arg(&vsrc)
            .status()
            .expect("ffmpeg should launch")
            .success();
        assert!(ok, "failed to synthesize source");

        // media_source -> transform -> output
        let project = json!({
            "settings": { "resolution": { "width": 160, "height": 120 }, "frameRate": 25.0 },
            "audio": { "masterVolume": 1.0 },
            "assets": { "assets": { "v": { "type": "video", "sourcePath": vsrc.to_string_lossy() } } },
            "workflow": {
                "nodes": [
                    { "id": "m1", "type": "media_source", "bypassed": false, "data": { "assetId": "v" } },
                    { "id": "t1", "type": "transform", "bypassed": false, "data": {} },
                    { "id": "o1", "type": "output", "bypassed": false, "data": {} }
                ],
                "edges": [
                    { "id": "e1", "source": "m1", "sourceHandle": "video", "target": "t1", "targetHandle": "input" },
                    { "id": "e2", "source": "t1", "sourceHandle": "output", "target": "o1", "targetHandle": "video" }
                ]
            }
        });

        let result = workflow_render_node_blocking(project.to_string(), "o1".to_string(), 160, 120)
            .expect("workflow_render_node should return");
        let parsed: Value = serde_json::from_str(&result).expect("valid json");
        let data_url = parsed.get("dataUrl").and_then(|v| v.as_str()).unwrap_or("");
        assert!(
            data_url.starts_with("data:image/png;base64,"),
            "expected a real PNG node preview, got: {}",
            &data_url[..data_url.len().min(40)]
        );

        let _ = fs::remove_file(&vsrc);
    }

    #[test]
    fn comfy_generate_reports_unreachable_server() {
        let project = json!({
            "workflow": { "nodes": [
                { "id": "g1", "type": "ai_generate", "bypassed": false,
                  "data": { "prompt": "a cat", "negativePrompt": "", "model": "sd.ckpt", "steps": 20, "cfg": 7.0 } }
            ], "edges": [] }
        });
        // Port 1 refuses connections — ping fails fast, so no ComfyUI is needed.
        let err = comfy_generate_blocking(
            project.to_string(),
            "g1".to_string(),
            "http://127.0.0.1:1".to_string(),
            5,
            false,
        )
        .expect_err("unreachable ComfyUI should error");
        assert!(
            err.contains("not reachable"),
            "expected unreachable error, got: {err}"
        );
    }
}
