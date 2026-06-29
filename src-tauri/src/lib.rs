use reqwest::blocking::Client;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;
use std::fs::{self, OpenOptions};
use std::io::{BufRead, BufReader, Write};
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::{Mutex, Once, OnceLock};
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use sysinfo::{Disks, System};
use tauri::{AppHandle, Emitter, Manager, WebviewUrl, WebviewWindowBuilder};

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
    let script = "(Get-CimInstance Win32_VideoController | Where-Object {$_.AdapterRAM -gt 0} | Sort-Object AdapterRAM -Descending | Select-Object -First 1 -ExpandProperty AdapterRAM)";
    read_powershell_number(script).map(|bytes| ((bytes / 1_073_741_824.0) * 10.0).round() / 10.0)
}

#[cfg(target_os = "windows")]
fn query_windows_vram_used_gb() -> Option<f64> {
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
    let project_dir = normalize_project_dir(&path);

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
fn create_project_at_path(app: AppHandle, path: String, project_json: String) -> Result<String, String> {
    let project_dir = normalize_project_dir(&path);
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
    let project_dir = normalize_project_dir(&path);
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
    fs::write(snapshot_path, &project_json).map_err(|error| error.to_string())?;

    trim_autosave_snapshots(&autosave_dir)?;

    let snapshot = serde_json::json!({
        "id": snapshot_id,
        "timestamp": timestamp,
        "project": serde_json::from_str::<Value>(&project_json).map_err(|error| error.to_string())?
    });

    serde_json::to_string(&snapshot).map_err(|error| error.to_string())
}

#[tauri::command]
fn append_wal_entry(app: AppHandle, entry_json: String) -> Result<(), String> {
    let project_dir = get_or_create_project_dir_from_wal(&app, &entry_json)?;
    ensure_project_structure(&project_dir)?;
    let wal_path = project_dir.join("autosave").join("wal.jsonl");
    let mut file = OpenOptions::new()
        .create(true)
        .append(true)
        .open(wal_path)
        .map_err(|error| error.to_string())?;

    writeln!(file, "{entry_json}").map_err(|error| error.to_string())
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
fn inspect_asset_path(path: String) -> Result<String, String> {
    let path_buf = PathBuf::from(&path);
    let metadata = fs::metadata(&path_buf).ok();
    let exists = metadata.is_some();
    let is_file = metadata.as_ref().map(|value| value.is_file()).unwrap_or(false);
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
fn sidecar_path(name: &str) -> PathBuf {
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

#[tauri::command]
fn asset_probe(path: String) -> Result<String, String> {
    let path_buf = PathBuf::from(&path);
    let metadata = fs::metadata(&path_buf).ok();
    let file_size = metadata.as_ref().map(|value| value.len()).unwrap_or(0);
    let extension = path_buf
        .extension()
        .and_then(|value| value.to_str())
        .map(|value| value.to_lowercase())
        .unwrap_or_default();

    // Real metadata via ffprobe; fall back to extension heuristics only if it fails.
    let probe = match run_ffprobe(&path) {
        Ok(report) => probe_result_from_ffprobe(&report, file_size),
        Err(_) => probe_result_from_extension(&extension, file_size),
    };

    serde_json::to_string(&probe).map_err(|error| error.to_string())
}

#[tauri::command]
fn asset_generate_waveform(
    app: AppHandle,
    asset_id: String,
    source_path: String,
    bucket_count: usize,
) -> Result<String, String> {
    let project_dir = get_current_project_dir(&app)?
        .or_else(|| ensure_app_dir(&app).ok().map(|dir| dir.join("workspace").join("unsaved.fluxnode")))
        .ok_or_else(|| "Unable to resolve project directory for waveform cache".to_string())?;
    ensure_project_structure(&project_dir)?;

    let path = PathBuf::from(&source_path);
    let peaks = if path.exists() {
        let bytes = fs::read(&path).map_err(|error| error.to_string())?;
        build_waveform_peaks_from_bytes(&bytes, bucket_count.max(8))
    } else {
        build_waveform_peaks_from_seed(&source_path, bucket_count.max(8))
    };

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

#[tauri::command]
fn asset_generate_thumbnail(
    app: AppHandle,
    asset_id: String,
    source_path: String,
    time: f64,
) -> Result<String, String> {
    let project_dir = get_current_project_dir(&app)?
        .or_else(|| ensure_app_dir(&app).ok().map(|dir| dir.join("workspace").join("unsaved.fluxnode")))
        .ok_or_else(|| "Unable to resolve project directory for thumbnail generation".to_string())?;
    ensure_project_structure(&project_dir)?;

    let thumbnail_dir = project_dir.join("thumbnails");
    fs::create_dir_all(&thumbnail_dir).map_err(|error| error.to_string())?;
    let thumbnail_file = thumbnail_dir.join(format!("{asset_id}-thumb.svg"));
    let source_path_buf = PathBuf::from(&source_path);
    let file_name = source_path_buf
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or(&source_path);
    let generated_at = current_timestamp();
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

#[tauri::command]
fn asset_copy_into_project(app: AppHandle, asset_id: String, source_path: String) -> Result<String, String> {
    let project_dir = get_current_project_dir(&app)?
        .or_else(|| ensure_app_dir(&app).ok().map(|dir| dir.join("workspace").join("unsaved.fluxnode")))
        .ok_or_else(|| "Unable to resolve project directory for asset copy".to_string())?;
    ensure_project_structure(&project_dir)?;

    let source = PathBuf::from(&source_path);
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

#[tauri::command]
fn fs_pick_media_file(initial_directory: Option<String>) -> Result<Option<String>, String> {
    let mut dialog = rfd::FileDialog::new();
    if let Some(directory) = initial_directory.as_deref() {
        dialog = dialog.set_directory(directory);
    }

    Ok(dialog
        .add_filter("Media", &["mp4", "mov", "mkv", "webm", "wav", "mp3", "flac", "aac", "png", "jpg", "jpeg", "webp"])
        .pick_file()
        .map(|path| path.to_string_lossy().to_string()))
}

#[tauri::command]
fn fs_pick_directory(initial_directory: Option<String>) -> Result<Option<String>, String> {
    let mut dialog = rfd::FileDialog::new();
    if let Some(directory) = initial_directory.as_deref() {
        dialog = dialog.set_directory(directory);
    }

    Ok(dialog
        .pick_folder()
        .map(|path| path.to_string_lossy().to_string()))
}

#[tauri::command]
fn load_app_preferences(app: AppHandle) -> Result<String, String> {
    let preferences_path = app_preferences_path(&app)?;

    if !preferences_path.exists() {
        return Ok(r#"{"defaultProjectDirectory":null,"comfyUiEndpoint":"http://127.0.0.1:8188","cloudApiKey":"","updateChannel":"stable","updateManifestUrl":null}"#.to_string());
    }

    fs::read_to_string(preferences_path).map_err(|error| error.to_string())
}

#[tauri::command]
fn save_app_preferences(app: AppHandle, preferences_json: String) -> Result<(), String> {
    let preferences_path = app_preferences_path(&app)?;
    fs::write(preferences_path, preferences_json).map_err(|error| error.to_string())
}

#[tauri::command]
fn get_app_version() -> Result<String, String> {
    Ok(env!("CARGO_PKG_VERSION").to_string())
}

#[tauri::command]
fn check_for_app_update(manifest_url: String) -> Result<String, String> {
    let trimmed_url = manifest_url.trim();
    if trimmed_url.is_empty() {
        return Err("Update manifest URL is not configured.".to_string());
    }

    let client = Client::builder()
        .timeout(Duration::from_secs(8))
        .build()
        .map_err(|error| error.to_string())?;
    let response = client
        .get(trimmed_url)
        .header("accept", "application/json")
        .send()
        .map_err(|error| error.to_string())?;
    let response = response.error_for_status().map_err(|error| error.to_string())?;
    let manifest = response
        .json::<AppUpdateManifest>()
        .map_err(|error| error.to_string())?;

    let latest_version = manifest.version.trim().to_string();
    if latest_version.is_empty() {
        return Err("Update manifest is missing a version field.".to_string());
    }

    let current_version = env!("CARGO_PKG_VERSION").to_string();
    let result = AppUpdateCheckResult {
        update_available: compare_versions(&latest_version, &current_version) > 0,
        current_version,
        latest_version,
        download_url: manifest.download_url.and_then(normalize_optional_string),
        notes: manifest.notes.and_then(normalize_optional_string),
        published_at: manifest.published_at.and_then(normalize_optional_string),
        checked_at: iso_timestamp_now(),
        channel: manifest.channel.and_then(normalize_optional_string),
    };

    serde_json::to_string(&result).map_err(|error| error.to_string())
}

#[tauri::command]
fn download_app_update(app: AppHandle, download_url: String) -> Result<String, String> {
    let trimmed_url = download_url.trim();
    if trimmed_url.is_empty() {
        return Err("Update download URL is not available.".to_string());
    }

    let client = Client::builder()
        .timeout(Duration::from_secs(60))
        .build()
        .map_err(|error| error.to_string())?;
    let response = client
        .get(trimmed_url)
        .send()
        .map_err(|error| error.to_string())?;
    let response = response.error_for_status().map_err(|error| error.to_string())?;
    let bytes = response.bytes().map_err(|error| error.to_string())?;

    let updates_dir = ensure_app_dir(&app)?.join("updates");
    fs::create_dir_all(&updates_dir).map_err(|error| error.to_string())?;

    let file_name = trimmed_url
        .rsplit('/')
        .next()
        .and_then(|segment| {
            let trimmed = segment.trim();
            if trimmed.is_empty() {
                None
            } else {
                Some(trimmed)
            }
        })
        .unwrap_or("fluxnode-update.bin");

    let output_path = updates_dir.join(file_name);
    fs::write(&output_path, &bytes).map_err(|error| error.to_string())?;

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
fn shell_open_path(path: String) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        Command::new("explorer")
            .arg(path)
            .spawn()
            .map_err(|error| error.to_string())?;
        return Ok(());
    }

    #[cfg(target_os = "macos")]
    {
        Command::new("open")
            .arg(path)
            .spawn()
            .map_err(|error| error.to_string())?;
        return Ok(());
    }

    #[cfg(target_os = "linux")]
    {
        Command::new("xdg-open")
            .arg(path)
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
    let snapshot = serde_json::from_str::<Value>(&snapshot_json).map_err(|error| error.to_string())?;
    app.emit("fluxnode://detached-panel-state", snapshot)
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn asset_watch_sync(app: AppHandle, targets_json: String) -> Result<(), String> {
    let targets = serde_json::from_str::<Vec<AssetWatchTarget>>(&targets_json).map_err(|error| error.to_string())?;
    ensure_asset_watch_thread(&app);
    let watch_state = asset_watch_state();
    let mut guard = watch_state.lock().map_err(|_| "Asset watch state lock poisoned".to_string())?;
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

#[tauri::command]
fn asset_generate_proxy(
    app: AppHandle,
    asset_id: String,
    source_path: String,
    target_width: u32,
    target_height: u32,
) -> Result<String, String> {
    let project_dir = get_current_project_dir(&app)?
        .or_else(|| ensure_app_dir(&app).ok().map(|dir| dir.join("workspace").join("unsaved.fluxnode")))
        .ok_or_else(|| "Unable to resolve project directory for proxy generation".to_string())?;
    ensure_project_structure(&project_dir)?;

    let proxy_dir = project_dir.join("proxies");
    fs::create_dir_all(&proxy_dir).map_err(|error| error.to_string())?;
    let proxy_path = proxy_dir.join(format!("{asset_id}-proxy.mp4"));
    let proxy_payload = format!(
        "FluxNode proxy artifact\nasset={asset_id}\nsource={source_path}\nresolution={}x{}\ncreated={}\n",
        target_width,
        target_height,
        current_timestamp(),
    );
    fs::write(&proxy_path, proxy_payload).map_err(|error| error.to_string())?;

    Ok(proxy_path.to_string_lossy().to_string())
}

#[tauri::command]
fn video_decode_frame(
    asset_id: String,
    source_path: String,
    requested_time: f64,
    width: u32,
    height: u32,
) -> Result<String, String> {
    serde_json::to_string(&build_preview_frame(
        asset_id,
        source_path,
        requested_time,
        width,
        height,
    ))
    .map_err(|error| error.to_string())
}

#[tauri::command]
fn video_seek(
    asset_id: String,
    source_path: String,
    requested_time: f64,
    width: u32,
    height: u32,
) -> Result<String, String> {
    serde_json::to_string(&build_preview_frame(
        asset_id,
        source_path,
        requested_time,
        width,
        height,
    ))
    .map_err(|error| error.to_string())
}

#[tauri::command]
fn start_export_job(
    app: AppHandle,
    job_id: String,
    project_json: String,
    preset_json: String,
) -> Result<String, String> {
    let project_value = serde_json::from_str::<Value>(&project_json).map_err(|error| error.to_string())?;
    let preset_value = serde_json::from_str::<Value>(&preset_json).map_err(|error| error.to_string())?;

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
    let output_extension = if format == "png_sequence" { "zip" } else { format };
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

#[tauri::command]
fn render_start(
    app: AppHandle,
    job_id: String,
    project_json: String,
    preset_json: String,
) -> Result<String, String> {
    let project_dir = get_or_create_current_project_dir(&app, &project_json)?;
    ensure_project_structure(&project_dir)?;
    let project_value = serde_json::from_str::<Value>(&project_json).map_err(|error| error.to_string())?;
    let preset_value = serde_json::from_str::<Value>(&preset_json).map_err(|error| error.to_string())?;
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

    let output_extension = if format == "png_sequence" { "zip" } else { format };
    let output_dir = resolve_export_directory(&app, output_directory)?;
    fs::create_dir_all(&output_dir).map_err(|error| error.to_string())?;
    let output_path = output_dir.join(format!("{project_id}-{job_id}.{output_extension}"));

    let total_frames = estimate_total_frames(&project_value).max(1);
    let render_cache_dir = project_dir.join("cache").join("renders");
    fs::create_dir_all(&render_cache_dir).map_err(|error| error.to_string())?;
    let manifest_path = render_cache_dir.join(format!("{job_id}.render.json"));
    let status_path = render_cache_dir.join(format!("{job_id}.status.json"));

    let manifest = serde_json::json!({
        "jobId": job_id,
        "projectSnapshot": project_value,
        "audioOutput": describe_workflow_audio_output(&project_value),
        "preset": preset_value,
        "outputPath": output_path.to_string_lossy(),
        "startedAt": started_at,
        "totalFrames": total_frames
    });

    let status = RenderJobStatus {
        job_id: job_id.clone(),
        status: "queued".to_string(),
        progress: 0,
        current_frame: 0,
        total_frames,
        updated_at: started_at.clone(),
        completed_at: None,
        estimated_time_remaining: Some(total_frames),
        output_path: output_path.to_string_lossy().to_string(),
        output_file_size: None,
        error: None,
    };

    fs::write(
        &manifest_path,
        serde_json::to_string_pretty(&manifest).map_err(|error| error.to_string())?,
    )
    .map_err(|error| error.to_string())?;
    write_render_status(&status_path, &status)?;

    serde_json::to_string(&RenderJobStartResult {
        job_id,
        output_path: output_path.to_string_lossy().to_string(),
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
    let status_path = project_dir.join("cache").join("renders").join(format!("{job_id}.status.json"));
    let mut status = read_render_status(&status_path)?;

    match status.status.as_str() {
        "queued" => {
            status.status = "rendering".to_string();
            if status.current_frame == 0 {
                status.current_frame = u32::min(12, status.total_frames);
            }
        }
        "rendering" => {
            status.current_frame = u32::min(status.total_frames, status.current_frame.saturating_add(u32::max(1, status.total_frames / 3)));
            if status.current_frame >= status.total_frames {
                status.status = "completed".to_string();
                status.completed_at = Some(current_timestamp());
                fs::write(
                    &status.output_path,
                    format!("FluxNode render artifact for job {}\n", status.job_id),
                )
                .map_err(|error| error.to_string())?;
                status.output_file_size = fs::metadata(&status.output_path).ok().map(|value| value.len());
                status.estimated_time_remaining = Some(0);
            }
        }
        "paused" => {}
        _ => {}
    }

    status.progress = if status.total_frames == 0 {
        0
    } else {
        ((status.current_frame as f64 / status.total_frames as f64) * 100.0).round() as u32
    };
    status.updated_at = current_timestamp();
    if status.status == "rendering" {
      status.estimated_time_remaining = Some(status.total_frames.saturating_sub(status.current_frame));
    }

    write_render_status(&status_path, &status)?;
    serde_json::to_string(&status).map_err(|error| error.to_string())
}

#[tauri::command]
fn render_cancel(app: AppHandle, job_id: String) -> Result<(), String> {
    let project_dir = get_current_project_dir(&app)?
        .ok_or_else(|| "No active project directory is available".to_string())?;
    let status_path = project_dir.join("cache").join("renders").join(format!("{job_id}.status.json"));
    let mut status = read_render_status(&status_path)?;
    status.status = "cancelled".to_string();
    status.updated_at = current_timestamp();
    status.completed_at = Some(current_timestamp());
    status.estimated_time_remaining = Some(0);
    write_render_status(&status_path, &status)
}

#[tauri::command]
fn render_pause(app: AppHandle, job_id: String) -> Result<(), String> {
    let project_dir = get_current_project_dir(&app)?
        .ok_or_else(|| "No active project directory is available".to_string())?;
    let status_path = project_dir.join("cache").join("renders").join(format!("{job_id}.status.json"));
    let mut status = read_render_status(&status_path)?;
    status.status = "paused".to_string();
    status.updated_at = current_timestamp();
    status.estimated_time_remaining = Some(status.total_frames.saturating_sub(status.current_frame));
    write_render_status(&status_path, &status)
}

#[tauri::command]
fn render_resume(app: AppHandle, job_id: String) -> Result<(), String> {
    let project_dir = get_current_project_dir(&app)?
        .ok_or_else(|| "No active project directory is available".to_string())?;
    let status_path = project_dir.join("cache").join("renders").join(format!("{job_id}.status.json"));
    let mut status = read_render_status(&status_path)?;
    status.status = "queued".to_string();
    status.updated_at = current_timestamp();
    status.estimated_time_remaining = Some(status.total_frames.saturating_sub(status.current_frame));
    write_render_status(&status_path, &status)
}

#[tauri::command]
fn render_retry(app: AppHandle, job_id: String, resume_from_current_frame: bool) -> Result<(), String> {
    let project_dir = get_current_project_dir(&app)?
        .ok_or_else(|| "No active project directory is available".to_string())?;
    let status_path = project_dir.join("cache").join("renders").join(format!("{job_id}.status.json"));
    let mut status = read_render_status(&status_path)?;

    if !resume_from_current_frame {
        status.current_frame = 0;
        status.progress = 0;
    }

    status.status = "queued".to_string();
    status.updated_at = current_timestamp();
    status.completed_at = None;
    status.output_file_size = None;
    status.error = None;
    status.estimated_time_remaining = Some(status.total_frames.saturating_sub(status.current_frame));
    write_render_status(&status_path, &status)
}

#[tauri::command]
fn mark_project_opened(app: AppHandle, project_json: String) -> Result<(), String> {
    let project_dir = get_or_create_current_project_dir(&app, &project_json)?;
    mark_project_opened_at_path(&app, &project_json, &project_dir)
}

fn load_project_from_dir(app: &AppHandle, project_dir: &PathBuf) -> Result<Option<String>, String> {
    let project_path = project_dir.join("project.json");

    if !project_path.exists() {
        return Ok(None);
    }

    let base_project = fs::read_to_string(&project_path).map_err(|error| error.to_string())?;
    let wal_snapshot = read_latest_wal_snapshot(project_dir)?;

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
    project_dir: &PathBuf,
    project_json: &str,
    clear_wal: bool,
) -> Result<(), String> {
    ensure_project_structure(project_dir)?;
    fs::write(project_dir.join("project.json"), project_json).map_err(|error| error.to_string())?;

    if clear_wal {
        fs::write(project_dir.join("autosave").join("wal.jsonl"), "").map_err(|error| error.to_string())?;
    }

    set_current_project_dir(app, project_dir)?;
    mark_project_opened_at_path(app, project_json, project_dir)
}

fn mark_project_opened_at_path(app: &AppHandle, project_json: &str, project_dir: &Path) -> Result<(), String> {
    let app_dir = ensure_app_dir(app)?;
    let recents_path = app_dir.join("recent.json");
    let project_value = serde_json::from_str::<Value>(project_json).map_err(|error| error.to_string())?;
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
        serde_json::from_str::<Vec<Value>>(&fs::read_to_string(&recents_path).map_err(|error| error.to_string())?)
            .map_err(|error| error.to_string())?
    } else {
        Vec::new()
    };

    recents.retain(|entry| entry.get("path").and_then(|value| value.as_str()) != Some(path_string.as_str()));
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
    fs::create_dir_all(project_dir.join("cache").join("waveforms")).map_err(|error| error.to_string())?;
    fs::create_dir_all(project_dir.join("cache").join("renders")).map_err(|error| error.to_string())?;
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

fn read_latest_wal_snapshot(project_dir: &Path) -> Result<Option<String>, String> {
    let wal_path = project_dir.join("autosave").join("wal.jsonl");

    if !wal_path.exists() {
        return Ok(None);
    }

    let file = fs::File::open(&wal_path).map_err(|error| error.to_string())?;
    let reader = BufReader::new(file);
    let lines = reader.lines().collect::<Result<Vec<_>, _>>().map_err(|error| error.to_string())?;

    for line in lines.into_iter().rev() {
        let Ok(value) = serde_json::from_str::<Value>(&line) else {
            continue;
        };

        if let Some(snapshot) = value.get("projectSnapshot") {
            return serde_json::to_string(snapshot)
                .map(Some)
                .map_err(|error| error.to_string());
        }
    }

    Ok(None)
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

    let snapshot_value = serde_json::from_str::<Value>(&fs::read_to_string(entry.path()).map_err(|error| error.to_string())?)
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
    fs::write(pointer_path, project_dir.to_string_lossy().to_string()).map_err(|error| error.to_string())
}

fn get_or_create_current_project_dir(app: &AppHandle, project_json: &str) -> Result<PathBuf, String> {
    if let Some(path) = get_current_project_dir(app)? {
        return Ok(path);
    }

    let default_dir = default_project_dir(app, project_json)?;
    ensure_project_structure(&default_dir)?;
    set_current_project_dir(app, &default_dir)?;
    Ok(default_dir)
}

fn get_or_create_project_dir_from_wal(app: &AppHandle, entry_json: &str) -> Result<PathBuf, String> {
    if let Some(path) = get_current_project_dir(app)? {
        return Ok(path);
    }

    let value = serde_json::from_str::<Value>(entry_json).map_err(|error| error.to_string())?;
    let project_snapshot = value
        .get("projectSnapshot")
        .ok_or_else(|| "WAL entry is missing projectSnapshot".to_string())?;
    let default_dir = default_project_dir(app, &serde_json::to_string(project_snapshot).map_err(|error| error.to_string())?)?;
    ensure_project_structure(&default_dir)?;
    set_current_project_dir(app, &default_dir)?;
    Ok(default_dir)
}

fn default_project_dir(app: &AppHandle, project_json: &str) -> Result<PathBuf, String> {
    let project_value = serde_json::from_str::<Value>(project_json).map_err(|error| error.to_string())?;
    let project_id = project_value
        .get("meta")
        .and_then(|value| value.get("id"))
        .and_then(|value| value.as_str())
        .unwrap_or("fluxnode-project");

    Ok(ensure_app_dir(app)?.join("workspace").join(format!("{project_id}.fluxnode")))
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
                            change_type: classify_asset_change(&watched_asset.last_observation, &next_observation),
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
            let chunk = if start < end { &bytes[start..end] } else { &bytes[bytes.len() - 1..bytes.len()] };
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
    let seed_value = seed.bytes().fold(0_u32, |sum, byte| sum.wrapping_add(byte as u32));

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
    let seed = source_path.bytes().fold(0_u32, |sum, byte| sum.wrapping_add(byte as u32));
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

fn estimate_total_frames(project_value: &Value) -> u32 {
    let frame_rate = project_value
        .get("settings")
        .and_then(|value| value.get("frameRate"))
        .and_then(|value| value.as_f64())
        .unwrap_or(30.0);
    let timeline = match project_value.get("timeline").and_then(|value| value.as_object()) {
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
                let start = clip.get("startTime").and_then(|value| value.as_f64()).unwrap_or(0.0);
                let clip_duration = clip.get("duration").and_then(|value| value.as_f64()).unwrap_or(0.0);
                duration = duration.max(start + clip_duration);
            }
        }
    }

    (duration * frame_rate).round() as u32
}

fn describe_workflow_audio_output(project_value: &Value) -> Value {
    let Some(workflow) = project_value.get("workflow").and_then(|value| value.as_object()) else {
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
            node.get("id").and_then(|value| value.as_str()).map(|value| value.to_string())
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
    let source_node = nodes.iter().find(|node| {
        node.get("id").and_then(|value| value.as_str()) == Some(source_node_id)
    });

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
    fs::write(
        status_path,
        serde_json::to_string_pretty(&serializable).map_err(|error| error.to_string())?,
    )
    .map_err(|error| error.to_string())
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
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
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
            shell_open_path,
            start_export_job,
            video_decode_frame,
            video_seek,
            window_toggle_fullscreen
        ])
        .run(tauri::generate_context!())
        .expect("error while running FluxNode");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn url_encode_svg_passes_unreserved_and_escapes_the_rest() {
        assert_eq!(url_encode_svg("abcXYZ-_.~09"), "abcXYZ-_.~09");
        assert_eq!(url_encode_svg("a b"), "a%20b");
        assert_eq!(url_encode_svg("<svg>"), "%3Csvg%3E");
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
        assert!(status.success(), "ffmpeg failed to synthesize the test clip");

        let report = run_ffprobe(&out.to_string_lossy()).expect("ffprobe should succeed");
        let size = fs::metadata(&out).map(|meta| meta.len()).unwrap_or(0);
        let probe = probe_result_from_ffprobe(&report, size);

        assert_eq!(probe.width, Some(320));
        assert_eq!(probe.height, Some(240));
        assert_eq!(probe.frame_rate, Some(25.0));
        assert!(probe.codec.is_some(), "codec should be detected");
        assert_eq!(probe.channels, Some(1));
        let duration = probe.duration.expect("duration should be present");
        assert!((duration - 1.0).abs() < 0.25, "duration ~1s, got {duration}");

        let _ = fs::remove_file(&out);
    }
}
