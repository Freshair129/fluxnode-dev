//! One local ComfyUI + Lalin narrated-scene run with a shared Hub GPU lease.
//!
//! The Hub is advisory coordination for clients that use it. Before asking ComfyUI to
//! unload its model cache, this flow requires a fresh Comfy Desktop session started by
//! the AI-Studio launcher, an empty Comfy queue, and an empty Lalin job slot. It never
//! terminates provider processes. A missing/ambiguous release receipt keeps the Hub
//! lease active so the next cooperating GPU client remains blocked.

use std::fs;
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{mpsc, Arc};
use std::thread::{self, JoinHandle};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use reqwest::blocking::{Client, Response};
use serde::Serialize;
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter, Manager};

const DEFAULT_COMFY_URL: &str = "http://127.0.0.1:8188";
const DEFAULT_LALIN_URL: &str = "http://127.0.0.1:8756";
const DEFAULT_HUB_URL: &str = "http://127.0.0.1:8787";
const DEFAULT_MIN_FREE_VRAM_MB: u64 = 9_216;
const VRAM_RELEASE_TOLERANCE_MB: u64 = 512;
const HUB_HEARTBEAT_SECONDS: u64 = 10;
const HUB_REQUEST_TIMEOUT: Duration = Duration::from_secs(8);
const JOB_POLL_TIMEOUT: Duration = Duration::from_secs(1_800);
const MAX_SCENE_AUDIO_BYTES: u64 = 256 * 1024 * 1024;
const MAX_SCENE_IMAGE_BYTES: u64 = 64 * 1024 * 1024;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VoiceOption {
    id: String,
    name: String,
    language: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NarratedSceneResult {
    run_id: String,
    image_path: String,
    audio_path: String,
    comfy_prompt_id: String,
    lalin_job_id: String,
    gpu_uuid: String,
    comfy_free_vram_before_mb: u64,
    comfy_free_vram_after_mb: u64,
    lalin_free_vram_before_mb: u64,
    lalin_free_vram_after_mb: u64,
    lalin_release_status: String,
    lalin_model: Option<String>,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct ProgressEvent {
    stage: String,
    status: String,
    message: String,
}

struct HubConfig {
    base_url: String,
    token: String,
    owner_id: String,
}

struct HubLease {
    id: String,
    gpu_uuid: String,
    free_vram_mb: u64,
}

struct HeartbeatGuard {
    stop: mpsc::Sender<()>,
    worker: Option<JoinHandle<()>>,
    failed: Arc<AtomicBool>,
}

impl HeartbeatGuard {
    fn ensure_live(&self) -> Result<(), String> {
        if self.failed.load(Ordering::Acquire) {
            Err(
                "GPU lease heartbeat failed; the lease is retained and the workflow stopped."
                    .to_string(),
            )
        } else {
            Ok(())
        }
    }
}

impl Drop for HeartbeatGuard {
    fn drop(&mut self) {
        let _ = self.stop.send(());
        if let Some(worker) = self.worker.take() {
            let _ = worker.join();
        }
    }
}

pub fn list_voices() -> Result<Vec<VoiceOption>, String> {
    let base_url = local_base_url("FLUXNODE_LALIN_URL", DEFAULT_LALIN_URL, "Lalin")?;
    let client = http_client(HUB_REQUEST_TIMEOUT)?;
    let response = client
        .get(format!("{base_url}/voices"))
        .send()
        .map_err(|error| format!("Lalin voice list is unavailable: {error}"))?;
    let body = read_json_response(response, "Lalin voice list")?;
    let voices = body
        .get("voices")
        .and_then(Value::as_array)
        .ok_or_else(|| "Lalin returned an invalid voice list.".to_string())?;

    Ok(voices
        .iter()
        .filter_map(|voice| {
            let id = voice.get("id")?.as_str()?.trim();
            let name = voice.get("name")?.as_str()?.trim();
            if id.is_empty() || name.is_empty() {
                return None;
            }
            Some(VoiceOption {
                id: id.to_string(),
                name: name.to_string(),
                language: voice
                    .get("language")
                    .and_then(Value::as_str)
                    .unwrap_or("th")
                    .to_string(),
            })
        })
        .collect())
}

pub fn run(
    app: AppHandle,
    image_prompt: String,
    narration: String,
    voice_id: String,
) -> Result<String, String> {
    run_blocking(app, image_prompt, narration, voice_id)
        .and_then(|result| serde_json::to_string(&result).map_err(|error| error.to_string()))
}

fn run_blocking(
    app: AppHandle,
    image_prompt: String,
    narration: String,
    voice_id: String,
) -> Result<NarratedSceneResult, String> {
    let app_data_directory = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("Could not resolve FluxNode app-data path: {error}"))?;
    run_blocking_with_progress(
        &app_data_directory,
        |stage, status, message| emit(&app, stage, status, message),
        image_prompt,
        narration,
        voice_id,
    )
}

fn run_blocking_with_progress<F>(
    app_data_directory: &Path,
    mut progress: F,
    image_prompt: String,
    narration: String,
    voice_id: String,
) -> Result<NarratedSceneResult, String>
where
    F: FnMut(&str, &str, &str),
{
    let image_prompt = image_prompt.trim();
    let narration = narration.trim();
    let voice_id = voice_id.trim();
    if image_prompt.is_empty() || image_prompt.len() > 4_000 {
        return Err("Image prompt must contain 1–4,000 characters.".to_string());
    }
    if narration.is_empty() || narration.len() > 8_000 {
        return Err("Narration must contain 1–8,000 characters.".to_string());
    }
    if voice_id.is_empty() || voice_id.len() > 160 {
        return Err("Choose a Lalin voice profile before starting.".to_string());
    }
    if std::env::var("FLUXNODE_COMFY_CLEAN_SESSION").as_deref() != Ok("1") {
        return Err(
            "Safe Comfy model release needs a fresh Comfy Desktop session from the AI-Studio workflow launcher. Close any existing Comfy session, then run scripts/start-ai-studio-workflow.ps1.".to_string(),
        );
    }

    let comfy_url = local_base_url("FLUXNODE_COMFY_URL", DEFAULT_COMFY_URL, "ComfyUI")?;
    let lalin_url = local_base_url("FLUXNODE_LALIN_URL", DEFAULT_LALIN_URL, "Lalin")?;
    let hub = hub_config()?;
    let minimum_free_vram_mb = std::env::var("FLUXNODE_GPU_MIN_FREE_VRAM_MB")
        .ok()
        .and_then(|value| value.parse::<u64>().ok())
        .filter(|value| *value > 0)
        .unwrap_or(DEFAULT_MIN_FREE_VRAM_MB);
    let client = http_client(Duration::from_secs(20))?;

    progress(
        "preflight",
        "running",
        "Checking local providers and queues.",
    );
    ensure_comfy_ready(&client, &comfy_url)?;
    ensure_comfy_queue_idle(&client, &comfy_url)?;
    ensure_lalin_idle(&client, &lalin_url)?;
    ensure_voice_exists(&client, &lalin_url, voice_id)?;

    let comfy_lease = acquire_lease(
        &client,
        &hub,
        "comfyui",
        "narrated-scene-image",
        minimum_free_vram_mb,
    )?;
    let comfy_heartbeat = heartbeat_guard(&client, &hub, &comfy_lease)?;
    progress(
        "image",
        "running",
        "Generating the Qwen image in Comfy Desktop.",
    );

    // Recheck after acquiring the shared lease so a newly queued external Comfy job causes
    // a fail-closed stop before this flow submits or unloads anything.
    ensure_comfy_queue_idle(&client, &comfy_url)?;
    let graph = build_qwen_prompt(
        image_prompt,
        &format!("FluxNode_Narrated_{}", timestamp_compact()),
    );
    let prompt_id = crate::comfy::submit_prompt(&comfy_url, &graph)?;
    let image_ref = crate::comfy::wait_for_output(&comfy_url, &prompt_id, 1_200)?;
    let image_bytes = crate::comfy::fetch_image(&comfy_url, &image_ref)?;
    if image_bytes.len() < 8
        || image_bytes.len() as u64 > MAX_SCENE_IMAGE_BYTES
        || image_bytes.get(0..8) != Some(b"\x89PNG\r\n\x1a\n")
    {
        return Err("ComfyUI did not return a valid PNG image.".to_string());
    }
    comfy_heartbeat.ensure_live()?;
    ensure_comfy_queue_idle(&client, &comfy_url)?;

    let run_id = format!("{}-{}", timestamp_compact(), std::process::id());
    let run_directory = app_data_directory.join("narrated-scene-runs").join(&run_id);
    fs::create_dir_all(&run_directory)
        .map_err(|error| format!("Could not create scene staging directory: {error}"))?;
    let image_path = run_directory.join("scene.png");
    write_file(&image_path, &image_bytes)?;

    progress(
        "image-release",
        "running",
        "Releasing the Comfy model and verifying VRAM.",
    );
    // ComfyUI /free returns before the prompt worker consumes its flag. It also unloads every
    // Comfy model in this runtime, so this call is permitted only in a fresh runtime launched
    // by the trusted local launcher and after both queue arrays are verified empty.
    ensure_comfy_queue_idle(&client, &comfy_url)?;
    let free_response = client
        .post(format!("{comfy_url}/free"))
        .json(&json!({ "unload_models": true, "free_memory": true }))
        .send()
        .map_err(|error| format!("ComfyUI model-release request failed: {error}"))?;
    if !free_response.status().is_success() {
        return Err(format!(
            "ComfyUI model-release request returned {}.",
            free_response.status()
        ));
    }
    let comfy_free_after_mb = verify_comfy_release(
        &client,
        &hub,
        &comfy_url,
        &comfy_lease,
        comfy_lease.free_vram_mb,
        &comfy_heartbeat,
    )?;
    let comfy_receipt = release_receipt("comfyui", &prompt_id);
    release_lease(&client, &hub, &comfy_lease, comfy_receipt)?;
    verify_hub_lease_free(&client, &hub, &comfy_lease.gpu_uuid)?;
    drop(comfy_heartbeat);

    progress(
        "narration",
        "running",
        "Generating narration with the selected Lalin voice.",
    );
    ensure_lalin_idle(&client, &lalin_url)?;
    let lalin_lease = acquire_lease(
        &client,
        &hub,
        "lalin",
        "narrated-scene-tts",
        minimum_free_vram_mb,
    )?;
    let lalin_heartbeat = heartbeat_guard(&client, &hub, &lalin_lease)?;
    let (job_id, job) = start_lalin_tts(&client, &lalin_url, narration, voice_id)?;
    let (release_status, release_model, output_path) =
        wait_for_lalin_tts(&client, &lalin_url, &job_id, &lalin_heartbeat)?;
    ensure_lalin_used_cuda(&client, &lalin_url)?;
    if release_status != "released" && release_status != "not_applicable" {
        progress(
            "narration-release",
            "blocked",
            "Lalin did not confirm an owned-model release; the Hub lease remains held.",
        );
        return Err(format!(
            "Lalin completed job {job_id} with GPU release status '{release_status}'. FluxNode kept the Hub lease and stopped before export."
        ));
    }
    lalin_heartbeat.ensure_live()?;
    let audio_bytes = download_lalin_audio(&client, &lalin_url, &output_path)?;
    let audio_path = run_directory.join("narration.wav");
    write_file(&audio_path, &audio_bytes)?;
    let lalin_free_after_mb = wait_for_vram_release(
        &client,
        &hub,
        &lalin_lease,
        lalin_lease.free_vram_mb,
        &lalin_heartbeat,
    )?;
    if lalin_free_after_mb + VRAM_RELEASE_TOLERANCE_MB < lalin_lease.free_vram_mb {
        return Err("Lalin reported an idle model release but Hub telemetry did not confirm VRAM recovery; the Hub lease is retained.".to_string());
    }
    let lalin_receipt = release_receipt("lalin", &job_id);
    release_lease(&client, &hub, &lalin_lease, lalin_receipt)?;
    verify_hub_lease_free(&client, &hub, &lalin_lease.gpu_uuid)?;
    drop(lalin_heartbeat);

    progress(
        "complete",
        "done",
        "Image and narration are ready to add to the timeline.",
    );
    let _ = job;
    Ok(NarratedSceneResult {
        run_id,
        image_path: image_path.to_string_lossy().to_string(),
        audio_path: audio_path.to_string_lossy().to_string(),
        comfy_prompt_id: prompt_id,
        lalin_job_id: job_id,
        gpu_uuid: lalin_lease.gpu_uuid,
        comfy_free_vram_before_mb: comfy_lease.free_vram_mb,
        comfy_free_vram_after_mb: comfy_free_after_mb,
        lalin_free_vram_before_mb: lalin_lease.free_vram_mb,
        lalin_free_vram_after_mb: lalin_free_after_mb,
        lalin_release_status: release_status,
        lalin_model: release_model,
    })
}

fn ensure_comfy_ready(client: &Client, base_url: &str) -> Result<(), String> {
    let stats = get_json(
        client,
        &format!("{base_url}/system_stats"),
        "ComfyUI system stats",
    )?;
    let devices = stats
        .get("devices")
        .and_then(Value::as_array)
        .ok_or_else(|| "ComfyUI system stats did not report its device list.".to_string())?;
    let cuda_devices = devices
        .iter()
        .filter(|device| device.get("type").and_then(Value::as_str) == Some("cuda"))
        .collect::<Vec<_>>();
    if cuda_devices.len() != 1 || cuda_devices[0].get("index").and_then(Value::as_u64) != Some(0) {
        return Err("ComfyUI must expose exactly one CUDA device at index 0 so its default workload maps to the leased GPU.".to_string());
    }
    for (endpoint, expected) in [
        (
            "/models/diffusion_models",
            "qwen_image_2.1_turbo_int8_convrot.safetensors",
        ),
        ("/models/text_encoders", "qwen3vl_8b_w4a8.safetensors"),
        ("/models/vae", "qwen_image_2.1_vae_bf16.safetensors"),
    ] {
        let models = get_json(
            client,
            &format!("{base_url}{endpoint}"),
            "ComfyUI model catalog",
        )?;
        let available = models
            .as_array()
            .is_some_and(|items| items.iter().any(|item| item.as_str() == Some(expected)));
        if !available {
            return Err(format!(
                "ComfyUI is missing the installed Qwen workflow model: {expected}"
            ));
        }
    }
    let object_info = get_json(
        client,
        &format!("{base_url}/object_info"),
        "ComfyUI node catalog",
    )?;
    for node in ["TextEncodeQwenImage21", "QwenImage21Cache"] {
        if object_info.get(node).is_none() {
            return Err(format!(
                "ComfyUI does not have the required Qwen node {node}."
            ));
        }
    }
    Ok(())
}

fn ensure_comfy_queue_idle(client: &Client, base_url: &str) -> Result<(), String> {
    let queue = get_json(client, &format!("{base_url}/queue"), "ComfyUI queue")?;
    if is_queue_idle(&queue) {
        Ok(())
    } else {
        Err(
            "ComfyUI has another queued or running job; FluxNode did not submit or release models."
                .to_string(),
        )
    }
}

fn is_queue_idle(queue: &Value) -> bool {
    ["queue_running", "queue_pending"].iter().all(|key| {
        queue
            .get(*key)
            .and_then(Value::as_array)
            .is_some_and(Vec::is_empty)
    })
}

fn ensure_lalin_idle(client: &Client, base_url: &str) -> Result<(), String> {
    let status = get_json(
        client,
        &format!("{base_url}/runtime/status"),
        "Lalin runtime status",
    )?;
    let tts_device = status
        .get("runtime")
        .and_then(|runtime| runtime.get("devices"))
        .and_then(|devices| devices.get("tts"))
        .ok_or_else(|| "Lalin did not report its TTS device selection.".to_string())?;
    if tts_device.get("requested").and_then(Value::as_str) == Some("cpu") {
        return Err(
            "Lalin TTS is configured for CPU; the narrated GPU workflow requires its CUDA backend."
                .to_string(),
        );
    }
    let activity = status
        .get("activity")
        .ok_or_else(|| "Lalin did not report its job activity.".to_string())?;
    let state = activity.get("state").and_then(Value::as_str);
    if state != Some("idle") {
        return Err(format!(
            "Lalin did not confirm an idle job state (reported {}).",
            state.unwrap_or("unknown")
        ));
    }
    Ok(())
}

fn ensure_lalin_used_cuda(client: &Client, base_url: &str) -> Result<(), String> {
    let status = get_json(
        client,
        &format!("{base_url}/runtime/status"),
        "Lalin runtime status",
    )?;
    let effective_device = status
        .get("runtime")
        .and_then(|runtime| runtime.get("devices"))
        .and_then(|devices| devices.get("tts"))
        .and_then(|tts| tts.get("effective"))
        .and_then(Value::as_str);
    if effective_device == Some("cuda") {
        Ok(())
    } else {
        Err(format!(
            "Lalin completed the request with effective TTS device '{}'; FluxNode requires confirmed CUDA use and kept the GPU lease held.",
            effective_device.unwrap_or("unknown")
        ))
    }
}

fn ensure_voice_exists(client: &Client, base_url: &str, voice_id: &str) -> Result<(), String> {
    let body = get_json(client, &format!("{base_url}/voices"), "Lalin voice list")?;
    let found = body
        .get("voices")
        .and_then(Value::as_array)
        .is_some_and(|voices| {
            voices
                .iter()
                .any(|voice| voice.get("id").and_then(Value::as_str) == Some(voice_id))
        });
    if found {
        Ok(())
    } else {
        Err("The selected voice profile is no longer available in Lalin.".to_string())
    }
}

fn build_qwen_prompt(image_prompt: &str, filename_prefix: &str) -> Value {
    json!({
        "1": {
            "class_type": "UNETLoader",
            "inputs": { "unet_name": "qwen_image_2.1_turbo_int8_convrot.safetensors", "weight_dtype": "default" }
        },
        "2": {
            "class_type": "CLIPLoader",
            "inputs": { "clip_name": "qwen3vl_8b_w4a8.safetensors", "type": "qwen_image", "device": "default" }
        },
        "3": {
            "class_type": "VAELoader",
            "inputs": { "vae_name": "qwen_image_2.1_vae_bf16.safetensors" }
        },
        "4": {
            "class_type": "TextEncodeQwenImage21",
            "inputs": { "clip": ["2", 0], "prompt": image_prompt, "negative_prompt": "", "resolution": 512 }
        },
        "5": {
            "class_type": "QwenImage21Cache",
            "inputs": { "model": ["1", 0], "device": "auto", "dtype": "int8" }
        },
        "6": {
            "class_type": "KSampler",
            "inputs": {
                "seed": 42,
                "steps": 8,
                "cfg": 1.0,
                "sampler_name": "euler",
                "scheduler": "simple",
                "denoise": 1.0,
                "model": ["5", 0],
                "positive": ["4", 0],
                "negative": ["4", 1],
                "latent_image": ["4", 2]
            }
        },
        "7": {
            "class_type": "VAEDecode",
            "inputs": { "samples": ["6", 0], "vae": ["3", 0] }
        },
        "8": {
            "class_type": "SaveImage",
            "inputs": { "filename_prefix": filename_prefix, "images": ["7", 0] }
        }
    })
}

fn hub_config() -> Result<HubConfig, String> {
    let base_url = local_base_url("LOCAL_LLM_HUB_URL", DEFAULT_HUB_URL, "local-llm-hub")?;
    let token = std::env::var("LOCAL_LLM_HUB_TOKEN")
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .ok_or_else(|| {
            "LOCAL_LLM_HUB_TOKEN is missing. Start FluxNode from the AI-Studio workflow launcher."
                .to_string()
        })?;
    Ok(HubConfig {
        base_url,
        token,
        owner_id: format!("fluxnode-windows-{}", std::process::id()),
    })
}

fn local_base_url(env_key: &str, default: &str, label: &str) -> Result<String, String> {
    let raw = std::env::var(env_key).unwrap_or_else(|_| default.to_string());
    let url = reqwest::Url::parse(raw.trim())
        .map_err(|error| format!("Invalid {label} endpoint: {error}"))?;
    let host = url.host_str().unwrap_or_default();
    let is_loopback = host.eq_ignore_ascii_case("localhost")
        || host
            .trim_matches(['[', ']'])
            .parse::<std::net::IpAddr>()
            .is_ok_and(|address| address.is_loopback());
    if url.scheme() != "http"
        || !is_loopback
        || url.username() != ""
        || url.password().is_some()
        || url.query().is_some()
        || url.fragment().is_some()
        || !matches!(url.path(), "" | "/")
    {
        return Err(format!(
            "{label} endpoint must be a plain loopback HTTP base URL."
        ));
    }
    Ok(url.as_str().trim_end_matches('/').to_string())
}

fn acquire_lease(
    client: &Client,
    hub: &HubConfig,
    application: &str,
    operation: &str,
    minimum_free_vram_mb: u64,
) -> Result<HubLease, String> {
    let status = hub_request(client, hub, "GET", "/v1/gpu/leases/status", None)?;
    if status.get("telemetry_available").and_then(Value::as_bool) != Some(true) {
        return Err(
            "GPU telemetry is unavailable; FluxNode refused to start a workload.".to_string(),
        );
    }
    let devices = status
        .get("devices")
        .and_then(Value::as_array)
        .ok_or_else(|| "GPU Hub returned no device status.".to_string())?;
    if devices.len() != 1 {
        return Err(format!(
            "Expected one NVIDIA device for Comfy/Lalin cuda:0 mapping; Hub reported {} devices.",
            devices.len()
        ));
    }
    let candidate = devices
        .iter()
        .filter(|device| is_free_hub_device(device, minimum_free_vram_mb))
        .max_by_key(|device| device.get("free_vram_mb").and_then(Value::as_u64).unwrap_or(0))
        .ok_or_else(|| {
            format!("No free GPU has at least {minimum_free_vram_mb} MiB available; an active/orphaned lease or low VRAM blocks this run.")
        })?;
    let gpu_uuid = candidate
        .get("gpu_uuid")
        .and_then(Value::as_str)
        .ok_or_else(|| "GPU Hub did not identify the selected device.".to_string())?;
    let acquired = hub_request(
        client,
        hub,
        "POST",
        "/v1/gpu/leases/acquire",
        Some(json!({
            "owner_id": hub.owner_id,
            "application": application,
            "operation": operation,
            "gpu_uuid": gpu_uuid,
            "minimum_free_vram_mb": minimum_free_vram_mb
        })),
    )?;
    let lease = HubLease {
        id: acquired
            .get("lease_id")
            .and_then(Value::as_str)
            .ok_or_else(|| "GPU Hub did not return a lease id.".to_string())?
            .to_string(),
        gpu_uuid: gpu_uuid.to_string(),
        free_vram_mb: acquired
            .get("free_vram_mb")
            .and_then(Value::as_u64)
            .ok_or_else(|| "GPU Hub did not report free VRAM at lease acquisition.".to_string())?,
    };
    Ok(lease)
}

fn heartbeat_guard(
    client: &Client,
    hub: &HubConfig,
    lease: &HubLease,
) -> Result<HeartbeatGuard, String> {
    let (stop, receiver) = mpsc::channel::<()>();
    let failed = Arc::new(AtomicBool::new(false));
    let thread_failed = Arc::clone(&failed);
    let client = client.clone();
    let base_url = hub.base_url.clone();
    let token = hub.token.clone();
    let owner_id = hub.owner_id.clone();
    let lease_id = lease.id.clone();
    let worker = thread::Builder::new()
        .name("fluxnode-gpu-lease-heartbeat".to_string())
        .spawn(move || loop {
            match receiver.recv_timeout(Duration::from_secs(HUB_HEARTBEAT_SECONDS)) {
                Ok(()) | Err(mpsc::RecvTimeoutError::Disconnected) => break,
                Err(mpsc::RecvTimeoutError::Timeout) => {}
            }
            let url = format!("{base_url}/v1/gpu/leases/{lease_id}/heartbeat");
            let response = client
                .post(url)
                .bearer_auth(&token)
                .json(&json!({ "owner_id": owner_id }))
                .send();
            if !matches!(response, Ok(ref response) if response.status().is_success()) {
                thread_failed.store(true, Ordering::Release);
                break;
            }
        })
        .map_err(|error| format!("Could not start GPU lease heartbeat: {error}"))?;
    Ok(HeartbeatGuard {
        stop,
        worker: Some(worker),
        failed,
    })
}

fn hub_request(
    client: &Client,
    hub: &HubConfig,
    method: &str,
    path: &str,
    body: Option<Value>,
) -> Result<Value, String> {
    let url = format!("{}{path}", hub.base_url);
    let mut request = match method {
        "GET" => client.get(url),
        "POST" => client.post(url),
        _ => return Err("Unsupported GPU Hub method.".to_string()),
    }
    .bearer_auth(&hub.token);
    if let Some(body) = body {
        request = request.json(&body);
    }
    let response = request
        .timeout(HUB_REQUEST_TIMEOUT)
        .send()
        .map_err(|error| format!("GPU Hub {method} {path} failed: {error}"))?;
    read_json_response(response, &format!("GPU Hub {path}"))
}

fn release_lease(
    client: &Client,
    hub: &HubConfig,
    lease: &HubLease,
    provider_release_receipt: Value,
) -> Result<(), String> {
    let response = hub_request(
        client,
        hub,
        "POST",
        &format!("/v1/gpu/leases/{}/release", lease.id),
        Some(json!({
            "owner_id": hub.owner_id,
            "provider_release_receipt": provider_release_receipt
        })),
    )?;
    if response.get("status").and_then(Value::as_str) == Some("released") {
        Ok(())
    } else {
        Err("GPU Hub did not acknowledge lease release; the workflow stopped.".to_string())
    }
}

fn release_receipt(provider: &str, workload_id: &str) -> Value {
    json!({
        "provider": provider,
        "workload_id": workload_id,
        "status": "idle_confirmed",
        "verified_at": utc_timestamp()
    })
}

fn verify_hub_lease_free(client: &Client, hub: &HubConfig, gpu_uuid: &str) -> Result<(), String> {
    let status = hub_request(
        client,
        hub,
        "GET",
        &format!("/v1/gpu/leases/status?gpu_uuid={gpu_uuid}"),
        None,
    )?;
    let free = hub_status_single_device(&status, gpu_uuid).is_some_and(|device| {
        device.get("state").and_then(Value::as_str) == Some("free")
            && device.get("lease_state").is_some_and(Value::is_null)
    });
    if free {
        Ok(())
    } else {
        Err("GPU Hub did not confirm that the provider lease is free; the next stage was not started.".to_string())
    }
}

fn verify_comfy_release(
    client: &Client,
    hub: &HubConfig,
    comfy_url: &str,
    lease: &HubLease,
    baseline_free_mb: u64,
    heartbeat: &HeartbeatGuard,
) -> Result<u64, String> {
    let deadline = Instant::now() + Duration::from_secs(60);
    let minimum_free_mb = baseline_free_mb.saturating_sub(VRAM_RELEASE_TOLERANCE_MB);
    let mut consecutive = 0;
    let mut last_free = 0;
    while Instant::now() < deadline {
        heartbeat.ensure_live()?;
        ensure_comfy_queue_idle(client, comfy_url)?;
        last_free = hub_free_vram(client, hub, lease)?;
        if last_free >= minimum_free_mb {
            consecutive += 1;
            if consecutive >= 2 {
                return Ok(last_free);
            }
        } else {
            consecutive = 0;
        }
        thread::sleep(Duration::from_secs(1));
    }
    Err(format!(
        "ComfyUI /free was accepted but idle VRAM release was not verified (free {last_free} MiB; needed at least {minimum_free_mb} MiB). The Hub lease remains held."
    ))
}

fn wait_for_vram_release(
    client: &Client,
    hub: &HubConfig,
    lease: &HubLease,
    baseline_free_mb: u64,
    heartbeat: &HeartbeatGuard,
) -> Result<u64, String> {
    let deadline = Instant::now() + Duration::from_secs(60);
    let minimum_free_mb = baseline_free_mb.saturating_sub(VRAM_RELEASE_TOLERANCE_MB);
    let mut consecutive = 0;
    let mut last_free = 0;
    while Instant::now() < deadline {
        heartbeat.ensure_live()?;
        last_free = hub_free_vram(client, hub, lease)?;
        if last_free >= minimum_free_mb {
            consecutive += 1;
            if consecutive >= 2 {
                return Ok(last_free);
            }
        } else {
            consecutive = 0;
        }
        thread::sleep(Duration::from_secs(1));
    }
    Err(format!(
        "Lalin release receipt was received but Hub did not verify VRAM recovery (free {last_free} MiB; needed at least {minimum_free_mb} MiB). The Hub lease remains held."
    ))
}

fn hub_free_vram(client: &Client, hub: &HubConfig, lease: &HubLease) -> Result<u64, String> {
    let status = hub_request(
        client,
        hub,
        "GET",
        &format!("/v1/gpu/leases/status?gpu_uuid={}", lease.gpu_uuid),
        None,
    )?;
    let device = hub_status_single_device(&status, &lease.gpu_uuid).ok_or_else(|| {
        "GPU Hub did not return exactly the leased device during VRAM verification.".to_string()
    })?;
    if device.get("state").and_then(Value::as_str) != Some("active")
        || device.get("lease_state").and_then(Value::as_str) != Some("active")
        || device.get("lease_id").and_then(Value::as_str) != Some(lease.id.as_str())
    {
        return Err("GPU Hub lease expired or changed ownership while verifying provider release; the workflow stopped.".to_string());
    }
    device
        .get("free_vram_mb")
        .and_then(Value::as_u64)
        .ok_or_else(|| "GPU Hub did not return free VRAM for the leased device.".to_string())
}

fn is_free_hub_device(device: &Value, minimum_free_vram_mb: u64) -> bool {
    device.get("state").and_then(Value::as_str) == Some("free")
        && device.get("lease_state").is_some_and(Value::is_null)
        && device
            .get("free_vram_mb")
            .and_then(Value::as_u64)
            .is_some_and(|free| free >= minimum_free_vram_mb)
}

fn hub_status_single_device<'a>(status: &'a Value, gpu_uuid: &str) -> Option<&'a Value> {
    if status.get("telemetry_available").and_then(Value::as_bool) != Some(true) {
        return None;
    }
    let devices = status.get("devices")?.as_array()?;
    if devices.len() != 1 {
        return None;
    }
    devices
        .first()
        .filter(|device| device.get("gpu_uuid").and_then(Value::as_str) == Some(gpu_uuid))
}

fn start_lalin_tts(
    client: &Client,
    lalin_url: &str,
    text: &str,
    voice_id: &str,
) -> Result<(String, Value), String> {
    let response = client
        .post(format!("{lalin_url}/tts"))
        .timeout(HUB_REQUEST_TIMEOUT)
        .json(&json!({
            "text": text,
            "voice_id": voice_id,
            "language": "th",
            "speed": 1.0,
            "release_gpu_model": true
        }))
        .send()
        .map_err(|error| format!("Could not submit narration to Lalin: {error}"))?;
    let body = read_json_response(response, "Lalin TTS submission")?;
    let job_id = body
        .get("job_id")
        .and_then(Value::as_str)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| "Lalin did not return a TTS job id.".to_string())?
        .to_string();
    Ok((job_id, body))
}

fn wait_for_lalin_tts(
    client: &Client,
    lalin_url: &str,
    job_id: &str,
    heartbeat: &HeartbeatGuard,
) -> Result<(String, Option<String>, String), String> {
    let deadline = Instant::now() + JOB_POLL_TIMEOUT;
    loop {
        heartbeat.ensure_live()?;
        let job = get_json(
            client,
            &format!("{lalin_url}/jobs/{job_id}"),
            "Lalin TTS job",
        )?;
        let last_status = job
            .get("status")
            .and_then(Value::as_str)
            .unwrap_or("unknown");
        match last_status {
            "done" => {
                let release = job
                    .get("result")
                    .and_then(|result| result.get("gpu_release"))
                    .or_else(|| job.get("gpu_release"))
                    .ok_or_else(|| "Lalin finished without its required GPU release receipt; the Hub lease remains held.".to_string())?;
                let status = release
                    .get("status")
                    .and_then(Value::as_str)
                    .unwrap_or("unknown")
                    .to_string();
                let model = release
                    .get("model")
                    .and_then(Value::as_str)
                    .map(str::to_string);
                let output = job
                    .get("result")
                    .and_then(|result| result.get("output"))
                    .and_then(Value::as_str)
                    .ok_or_else(|| "Lalin completed without an output WAV path.".to_string())?
                    .to_string();
                return Ok((status, model, output));
            }
            "error" | "cancelled" => {
                return Err(format!(
                    "Lalin TTS job {job_id} ended with status {}: {}",
                    job.get("status")
                        .and_then(Value::as_str)
                        .unwrap_or("unknown"),
                    job.get("error")
                        .and_then(Value::as_str)
                        .unwrap_or("no error details")
                ));
            }
            _ => {}
        }
        if Instant::now() >= deadline {
            return Err(format!("Timed out waiting for Lalin job {job_id} (status {last_status}); the Hub lease remains held."));
        }
        thread::sleep(Duration::from_millis(1_000));
    }
}

fn download_lalin_audio(
    client: &Client,
    lalin_url: &str,
    output_path: &str,
) -> Result<Vec<u8>, String> {
    let filename = Path::new(output_path)
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or_else(|| "Lalin returned an invalid output filename.".to_string())?;
    if !filename.starts_with("tts_")
        || !filename.ends_with(".wav")
        || !filename.chars().all(|character| {
            character.is_ascii_alphanumeric() || matches!(character, '_' | '-' | '.')
        })
    {
        return Err("Lalin returned an unexpected output WAV filename.".to_string());
    }
    let response = client
        .get(format!("{lalin_url}/files/download/{filename}"))
        .timeout(Duration::from_secs(60))
        .send()
        .map_err(|error| format!("Could not download Lalin WAV: {error}"))?;
    if !response.status().is_success() {
        return Err(format!(
            "Lalin WAV download returned {}.",
            response.status()
        ));
    }
    let bytes = crate::security::read_capped_bytes(response, MAX_SCENE_AUDIO_BYTES)?;
    if bytes.len() < 12 || bytes.get(0..4) != Some(b"RIFF") || bytes.get(8..12) != Some(b"WAVE") {
        return Err("Lalin returned an invalid WAV file.".to_string());
    }
    Ok(bytes)
}

fn read_json_response(response: Response, label: &str) -> Result<Value, String> {
    let status = response.status();
    let bytes =
        crate::security::read_capped_bytes(response, crate::security::MAX_JSON_RESPONSE_BYTES)
            .map_err(|error| format!("Could not read {label}: {error}"))?;
    if !status.is_success() {
        let body = String::from_utf8_lossy(&bytes);
        return Err(format!("{label} returned {status}: {body}"));
    }
    serde_json::from_slice(&bytes)
        .map_err(|error| format!("{label} returned invalid JSON: {error}"))
}

fn get_json(client: &Client, url: &str, label: &str) -> Result<Value, String> {
    let response = client
        .get(url)
        .timeout(HUB_REQUEST_TIMEOUT)
        .send()
        .map_err(|error| format!("{label} is unavailable: {error}"))?;
    read_json_response(response, label)
}

fn http_client(timeout: Duration) -> Result<Client, String> {
    Client::builder()
        .timeout(timeout)
        .build()
        .map_err(|error| format!("Could not create local workflow HTTP client: {error}"))
}

fn write_file(path: &Path, bytes: &[u8]) -> Result<(), String> {
    fs::write(path, bytes).map_err(|error| {
        format!(
            "Could not write generated media {}: {error}",
            path.display()
        )
    })
}

fn emit(app: &AppHandle, stage: &str, status: &str, message: &str) {
    let _ = app.emit(
        "narrated-scene-progress",
        ProgressEvent {
            stage: stage.to_string(),
            status: status.to_string(),
            message: message.to_string(),
        },
    );
}

fn timestamp_compact() -> String {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis().to_string())
        .unwrap_or_else(|_| "run".to_string())
}

fn utc_timestamp() -> String {
    let seconds = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs())
        .unwrap_or_default();
    let days = (seconds / 86_400) as i64;
    let day_seconds = seconds % 86_400;
    let (year, month, day) = civil_from_days(days);
    format!(
        "{year:04}-{month:02}-{day:02}T{:02}:{:02}:{:02}Z",
        day_seconds / 3_600,
        (day_seconds % 3_600) / 60,
        day_seconds % 60
    )
}

// Gregorian civil date conversion from days since 1970-01-01.
fn civil_from_days(days_since_epoch: i64) -> (i64, i64, i64) {
    let z = days_since_epoch + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let day_of_era = z - era * 146_097;
    let year_of_era =
        (day_of_era - day_of_era / 1_460 + day_of_era / 36_524 - day_of_era / 146_096) / 365;
    let mut year = year_of_era + era * 400;
    let day_of_year = day_of_era - (365 * year_of_era + year_of_era / 4 - year_of_era / 100);
    let month_prime = (5 * day_of_year + 2) / 153;
    let day = day_of_year - (153 * month_prime + 2) / 5 + 1;
    let month = month_prime + if month_prime < 10 { 3 } else { -9 };
    year += if month <= 2 { 1 } else { 0 };
    (year, month, day)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn qwen_prompt_uses_installed_models_and_api_graph_connections() {
        let graph = build_qwen_prompt("A blue teapot", "FluxNode_test");
        assert_eq!(graph["1"]["class_type"], "UNETLoader");
        assert_eq!(
            graph["1"]["inputs"]["unet_name"],
            "qwen_image_2.1_turbo_int8_convrot.safetensors"
        );
        assert_eq!(
            graph["2"]["inputs"]["clip_name"],
            "qwen3vl_8b_w4a8.safetensors"
        );
        assert_eq!(
            graph["3"]["inputs"]["vae_name"],
            "qwen_image_2.1_vae_bf16.safetensors"
        );
        assert_eq!(graph["4"]["inputs"]["prompt"], "A blue teapot");
        assert_eq!(graph["6"]["inputs"]["latent_image"], json!(["4", 2]));
        assert_eq!(graph["8"]["inputs"]["filename_prefix"], "FluxNode_test");
    }

    #[test]
    fn queue_is_idle_only_when_both_arrays_are_present_and_empty() {
        assert!(is_queue_idle(
            &json!({ "queue_running": [], "queue_pending": [] })
        ));
        assert!(!is_queue_idle(
            &json!({ "queue_running": [["one"]], "queue_pending": [] })
        ));
        assert!(!is_queue_idle(&json!({ "queue_running": [] })));
    }

    #[test]
    fn hub_status_matches_the_shared_api_device_schema_and_fails_closed() {
        // Mirrors the documented Hub `/v1/gpu/leases/status` payload: `state` and nullable
        // `lease_state` are the contract fields; a nonexistent `lease_status` is not used.
        let free_status = json!({
            "telemetry_available": true,
            "devices": [{
                "gpu_uuid": "GPU-test-0",
                "state": "free",
                "lease_state": null,
                "lease_id": null,
                "free_vram_mb": 10_000,
                "total_vram_mb": 12_288
            }]
        });
        let device = hub_status_single_device(&free_status, "GPU-test-0").unwrap();
        assert!(is_free_hub_device(device, 9_216));

        for state in ["active", "orphaned", "unknown"] {
            let blocked = json!({
                "telemetry_available": true,
                "devices": [{
                    "gpu_uuid": "GPU-test-0",
                    "state": state,
                    "lease_state": state,
                    "lease_id": "lease-test",
                    "free_vram_mb": 10_000
                }]
            });
            assert!(!is_free_hub_device(
                hub_status_single_device(&blocked, "GPU-test-0").unwrap(),
                9_216
            ));
        }

        let unavailable = json!({ "telemetry_available": false, "devices": [] });
        assert!(hub_status_single_device(&unavailable, "GPU-test-0").is_none());
        let ambiguous = json!({
            "telemetry_available": true,
            "devices": [free_status["devices"][0].clone(), free_status["devices"][0].clone()]
        });
        assert!(hub_status_single_device(&ambiguous, "GPU-test-0").is_none());
    }

    #[test]
    fn release_receipt_timestamp_is_timezone_aware_iso_8601() {
        let receipt = release_receipt("comfyui", "prompt-123");
        let timestamp = receipt["verified_at"].as_str().unwrap();
        assert!(timestamp.ends_with('Z'));
        assert_eq!(timestamp.len(), 20);
        assert_eq!(civil_from_days(0), (1970, 1, 1));
    }

    #[test]
    #[ignore = "requires the locally owned Comfy Desktop session, Lalin CUDA API, and a free Hub lease"]
    fn live_narrated_scene_generates_real_local_image_and_tts() {
        assert_eq!(
            std::env::var("FLUXNODE_COMFY_CLEAN_SESSION").as_deref(),
            Ok("1"),
            "run scripts/acceptance/run-narrated-scene-live.ps1 to validate Comfy ownership first"
        );
        assert!(
            std::env::var("LOCAL_LLM_HUB_TOKEN")
                .ok()
                .is_some_and(|token| !token.trim().is_empty()),
            "live acceptance requires the Hub token supplied by the local launcher"
        );

        let app_data_directory = std::env::var_os("FLUXNODE_LIVE_APP_DATA_DIR")
            .map(std::path::PathBuf::from)
            .expect("live acceptance app-data directory must be set to the evidence drive");
        let result = run_blocking_with_progress(
            &app_data_directory,
            |stage, status, message| println!("PROGRESS {stage} {status}: {message}"),
            "A small lantern boat gliding across a dark Thai river at blue hour, cinematic wide shot, soft gold reflections, realistic atmosphere".to_string(),
            "เมื่อแสงสุดท้ายแตะผิวน้ำ เรือโคมไฟลำเล็กก็เริ่มออกเดินทาง".to_string(),
            "b8c819fd489f".to_string(),
        )
        .unwrap_or_else(|error| panic!("live narrated-scene workflow failed: {error}"));

        let image_path = Path::new(&result.image_path);
        let audio_path = Path::new(&result.audio_path);
        let image_bytes = fs::read(image_path).expect("FluxNode-staged image exists");
        let audio_bytes = fs::read(audio_path).expect("FluxNode-staged narration exists");
        assert!(image_bytes.starts_with(b"\x89PNG\r\n\x1a\n"));
        assert!(audio_bytes.starts_with(b"RIFF"));
        assert_eq!(result.lalin_release_status, "released");
        assert!(
            result.comfy_free_vram_after_mb + VRAM_RELEASE_TOLERANCE_MB
                >= result.comfy_free_vram_before_mb
        );
        assert!(
            result.lalin_free_vram_after_mb + VRAM_RELEASE_TOLERANCE_MB
                >= result.lalin_free_vram_before_mb
        );
        println!(
            "LIVE_NARRATED_SCENE_RESULT={}",
            serde_json::to_string(&result).unwrap()
        );
    }
}
