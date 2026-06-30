//! ComfyUI integration core for FluxNode.
//!
//! This module is split into two cleanly separated concerns:
//!
//! 1. A PURE translator [`build_comfy_prompt`] that turns FluxNode AI-node
//!    parameters into a ComfyUI **API-format** prompt graph. This part is fully
//!    unit-tested and has no I/O.
//!
//! 2. A small blocking HTTP client (built on `reqwest`) that submits a prompt to
//!    a user-run ComfyUI server, polls `GET /history/{prompt_id}` for completion,
//!    and fetches the produced image. The HTTP layer is intentionally not
//!    unit-tested here (it requires a live server).
//!
//! FluxNode follows a BYOM ("bring your own models") model: the user runs their
//! own ComfyUI instance (default `http://127.0.0.1:8188`) with their own
//! checkpoints / upscale models. We never assume specific model files exist; the
//! node `data.model` field is passed through verbatim as the ComfyUI loader name.

use std::time::{Duration, Instant};

use serde_json::{json, Value};

/// A reference to an image produced by ComfyUI, as reported in the history's
/// `outputs[*].images[*]` entries. These three fields map directly onto the
/// query parameters of the `GET /view` endpoint.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ComfyImageRef {
    pub filename: String,
    pub subfolder: String,
    /// ComfyUI calls this `type` (e.g. "output", "temp"). `type` is a Rust
    /// keyword, so the field is named `type_`.
    pub type_: String,
}

// ---------------------------------------------------------------------------
// Defensive field readers
// ---------------------------------------------------------------------------

fn read_str<'a>(data: &'a Value, key: &str, default: &'a str) -> &'a str {
    data.get(key).and_then(Value::as_str).unwrap_or(default)
}

fn read_u64(data: &Value, key: &str, default: u64) -> u64 {
    data.get(key)
        .and_then(Value::as_u64)
        .or_else(|| data.get(key).and_then(Value::as_f64).map(|f| f as u64))
        .unwrap_or(default)
}

fn read_f64(data: &Value, key: &str, default: f64) -> f64 {
    data.get(key)
        .and_then(Value::as_f64)
        .or_else(|| data.get(key).and_then(Value::as_u64).map(|u| u as f64))
        .unwrap_or(default)
}

// ---------------------------------------------------------------------------
// PURE translator
// ---------------------------------------------------------------------------

/// Build a ComfyUI `/prompt` "prompt" object for the given FluxNode node type.
///
/// The returned value is a JSON object keyed by string node ids, where each
/// entry is `{ "class_type": ..., "inputs": {...} }` — exactly the shape
/// ComfyUI expects under the `"prompt"` key of a `POST /prompt` request.
///
/// * `node_type`        — `"ai_generate"` or `"ai_upscale"`.
/// * `node_data`        — the node's `data` object (e.g. `AiGenerateData`).
/// * `input_image_name` — when `Some`, the filename of an image already present
///   in ComfyUI's input directory. For `ai_generate` this switches to img2img;
///   for `ai_upscale` it is required.
///
/// Returns `Err` for unknown node types or for missing required inputs.
pub fn build_comfy_prompt(
    node_type: &str,
    node_data: &Value,
    input_image_name: Option<&str>,
) -> Result<Value, String> {
    match node_type {
        "ai_generate" => build_generate(node_data, input_image_name),
        "ai_upscale" => build_upscale(node_data, input_image_name),
        other => Err(format!("unknown ComfyUI node type: {other}")),
    }
}

fn build_generate(data: &Value, input_image_name: Option<&str>) -> Result<Value, String> {
    let model = read_str(data, "model", "");
    if model.is_empty() {
        return Err("ai_generate requires a non-empty `model` (checkpoint name)".to_string());
    }
    let prompt = read_str(data, "prompt", "");
    let negative = read_str(data, "negativePrompt", "");
    let steps = read_u64(data, "steps", 20);
    let cfg = read_f64(data, "cfg", 7.0);

    // Node id layout (string ids "1".."9"):
    //   1 CheckpointLoaderSimple
    //   2 CLIPTextEncode (positive)
    //   3 CLIPTextEncode (negative)
    //   4 latent source: EmptyLatentImage (txt2img) OR VAEEncode (img2img)
    //   5 KSampler
    //   6 VAEDecode
    //   7 SaveImage
    //   8 LoadImage              (img2img only)
    let mut graph = json!({
        "1": {
            "class_type": "CheckpointLoaderSimple",
            "inputs": { "ckpt_name": model }
        },
        "2": {
            "class_type": "CLIPTextEncode",
            "inputs": { "text": prompt, "clip": ["1", 1] }
        },
        "3": {
            "class_type": "CLIPTextEncode",
            "inputs": { "text": negative, "clip": ["1", 1] }
        },
        "5": {
            "class_type": "KSampler",
            "inputs": {
                "seed": 0,
                "steps": steps,
                "cfg": cfg,
                "sampler_name": "euler",
                "scheduler": "normal",
                "denoise": 1.0,
                "model": ["1", 0],
                "positive": ["2", 0],
                "negative": ["3", 0],
                "latent_image": ["4", 0]
            }
        },
        "6": {
            "class_type": "VAEDecode",
            "inputs": { "samples": ["5", 0], "vae": ["1", 2] }
        },
        "7": {
            "class_type": "SaveImage",
            "inputs": { "filename_prefix": "FluxNode", "images": ["6", 0] }
        }
    });

    let obj = graph.as_object_mut().expect("graph is an object");

    match input_image_name {
        Some(image) => {
            // img2img: LoadImage -> VAEEncode supplies the latent, lower denoise.
            obj.insert(
                "8".to_string(),
                json!({
                    "class_type": "LoadImage",
                    "inputs": { "image": image }
                }),
            );
            obj.insert(
                "4".to_string(),
                json!({
                    "class_type": "VAEEncode",
                    "inputs": { "pixels": ["8", 0], "vae": ["1", 2] }
                }),
            );
            // Reduce denoise so the input image is preserved (standard img2img).
            obj["5"]["inputs"]["denoise"] = json!(0.7);
        }
        None => {
            // txt2img: start from an empty 512x512 latent.
            obj.insert(
                "4".to_string(),
                json!({
                    "class_type": "EmptyLatentImage",
                    "inputs": { "width": 512, "height": 512, "batch_size": 1 }
                }),
            );
        }
    }

    Ok(graph)
}

fn build_upscale(data: &Value, input_image_name: Option<&str>) -> Result<Value, String> {
    let image = input_image_name
        .ok_or_else(|| "ai_upscale requires an input image".to_string())?;
    let model = read_str(data, "model", "");
    if model.is_empty() {
        return Err("ai_upscale requires a non-empty `model` (upscale model name)".to_string());
    }

    // Node id layout:
    //   1 LoadImage
    //   2 UpscaleModelLoader
    //   3 ImageUpscaleWithModel
    //   4 SaveImage
    let graph = json!({
        "1": {
            "class_type": "LoadImage",
            "inputs": { "image": image }
        },
        "2": {
            "class_type": "UpscaleModelLoader",
            "inputs": { "model_name": model }
        },
        "3": {
            "class_type": "ImageUpscaleWithModel",
            "inputs": { "upscale_model": ["2", 0], "image": ["1", 0] }
        },
        "4": {
            "class_type": "SaveImage",
            "inputs": { "filename_prefix": "FluxNode_upscale", "images": ["3", 0] }
        }
    });

    Ok(graph)
}

// ---------------------------------------------------------------------------
// Blocking HTTP client (not unit-tested; needs a live ComfyUI server)
// ---------------------------------------------------------------------------

fn http_client(timeout: Duration) -> Result<reqwest::blocking::Client, String> {
    reqwest::blocking::Client::builder()
        .timeout(timeout)
        .build()
        .map_err(|e| format!("failed to build HTTP client: {e}"))
}

fn trim_endpoint(endpoint: &str) -> &str {
    endpoint.trim_end_matches('/')
}

/// Lightweight liveness check against `GET {endpoint}/system_stats`.
/// Returns `true` only on a 2xx response within a short timeout.
pub fn ping(endpoint: &str) -> bool {
    let client = match http_client(Duration::from_secs(3)) {
        Ok(c) => c,
        Err(_) => return false,
    };
    let url = format!("{}/system_stats", trim_endpoint(endpoint));
    matches!(client.get(url).send(), Ok(resp) if resp.status().is_success())
}

/// Submit a prompt graph via `POST {endpoint}/prompt` and return its
/// `prompt_id`. The body is `{"prompt": <prompt>}`.
pub fn submit_prompt(endpoint: &str, prompt: &Value) -> Result<String, String> {
    let client = http_client(Duration::from_secs(30))?;
    let url = format!("{}/prompt", trim_endpoint(endpoint));
    let body = json!({ "prompt": prompt });

    let resp = client
        .post(url)
        .json(&body)
        .send()
        .map_err(|e| format!("failed to submit prompt: {e}"))?;

    let status = resp.status();
    let text = resp
        .text()
        .map_err(|e| format!("failed to read submit response: {e}"))?;
    if !status.is_success() {
        return Err(format!("ComfyUI rejected prompt ({status}): {text}"));
    }

    let parsed: Value = serde_json::from_str(&text)
        .map_err(|e| format!("invalid submit response JSON: {e} (body: {text})"))?;
    parsed
        .get("prompt_id")
        .and_then(Value::as_str)
        .map(str::to_string)
        .ok_or_else(|| format!("submit response missing prompt_id: {text}"))
}

/// Poll `GET {endpoint}/history/{prompt_id}` until the prompt has produced an
/// image or `timeout_secs` elapses. Returns the first image reference found in
/// the outputs.
pub fn wait_for_output(
    endpoint: &str,
    prompt_id: &str,
    timeout_secs: u64,
) -> Result<ComfyImageRef, String> {
    let client = http_client(Duration::from_secs(15))?;
    let url = format!("{}/history/{}", trim_endpoint(endpoint), prompt_id);
    let deadline = Instant::now() + Duration::from_secs(timeout_secs);

    loop {
        let resp = client
            .get(&url)
            .send()
            .map_err(|e| format!("failed to poll history: {e}"))?;

        if resp.status().is_success() {
            let history: Value = resp
                .json()
                .map_err(|e| format!("invalid history JSON: {e}"))?;
            // History is keyed by prompt_id; the entry may not exist yet while
            // the job is still queued.
            if let Some(entry) = history.get(prompt_id) {
                if let Some(image) = first_image_in_outputs(entry) {
                    return Ok(image);
                }
                // Entry present but no image and execution finished with a
                // status of error -> surface it instead of spinning.
                if let Some(status) = entry.get("status") {
                    let completed = status
                        .get("completed")
                        .and_then(Value::as_bool)
                        .unwrap_or(false);
                    let status_str = status.get("status_str").and_then(Value::as_str);
                    if completed && status_str == Some("error") {
                        return Err(format!(
                            "ComfyUI reported an execution error for prompt {prompt_id}"
                        ));
                    }
                }
            }
        }

        if Instant::now() >= deadline {
            return Err(format!(
                "timed out after {timeout_secs}s waiting for ComfyUI output (prompt {prompt_id})"
            ));
        }
        std::thread::sleep(Duration::from_millis(750));
    }
}

/// Extract the first `images[0]` entry from any node's outputs in a history
/// entry, returning it as a [`ComfyImageRef`].
fn first_image_in_outputs(entry: &Value) -> Option<ComfyImageRef> {
    let outputs = entry.get("outputs")?.as_object()?;
    for node_output in outputs.values() {
        if let Some(images) = node_output.get("images").and_then(Value::as_array) {
            if let Some(img) = images.first() {
                let filename = img.get("filename").and_then(Value::as_str)?;
                let subfolder = img
                    .get("subfolder")
                    .and_then(Value::as_str)
                    .unwrap_or("");
                let type_ = img.get("type").and_then(Value::as_str).unwrap_or("output");
                return Some(ComfyImageRef {
                    filename: filename.to_string(),
                    subfolder: subfolder.to_string(),
                    type_: type_.to_string(),
                });
            }
        }
    }
    None
}

/// Fetch the raw bytes of an image via `GET {endpoint}/view`.
pub fn fetch_image(endpoint: &str, image: &ComfyImageRef) -> Result<Vec<u8>, String> {
    let client = http_client(Duration::from_secs(60))?;
    let url = format!("{}/view", trim_endpoint(endpoint));

    let resp = client
        .get(url)
        .query(&[
            ("filename", image.filename.as_str()),
            ("subfolder", image.subfolder.as_str()),
            ("type", image.type_.as_str()),
        ])
        .send()
        .map_err(|e| format!("failed to fetch image: {e}"))?;

    if !resp.status().is_success() {
        return Err(format!(
            "ComfyUI /view returned {} for {}",
            resp.status(),
            image.filename
        ));
    }

    resp.bytes()
        .map(|b| b.to_vec())
        .map_err(|e| format!("failed to read image bytes: {e}"))
}

// ---------------------------------------------------------------------------
// Tests (PURE translator only)
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    /// Find the single node with the given `class_type`, panicking if there is
    /// not exactly one.
    fn node_of<'a>(graph: &'a Value, class_type: &str) -> &'a Value {
        let obj = graph.as_object().expect("graph is an object");
        let matches: Vec<&Value> = obj
            .values()
            .filter(|n| n.get("class_type").and_then(Value::as_str) == Some(class_type))
            .collect();
        assert_eq!(
            matches.len(),
            1,
            "expected exactly one {class_type} node, found {}",
            matches.len()
        );
        matches[0]
    }

    fn nodes_of<'a>(graph: &'a Value, class_type: &str) -> Vec<&'a Value> {
        graph
            .as_object()
            .expect("graph is an object")
            .values()
            .filter(|n| n.get("class_type").and_then(Value::as_str) == Some(class_type))
            .collect()
    }

    fn generate_data() -> Value {
        json!({
            "prompt": "a neon cat",
            "negativePrompt": "blurry, low quality",
            "model": "sd_xl_base_1.0.safetensors",
            "steps": 30,
            "cfg": 8.5
        })
    }

    #[test]
    fn txt2img_has_checkpoint_with_model() {
        let graph = build_comfy_prompt("ai_generate", &generate_data(), None).unwrap();
        let ckpt = node_of(&graph, "CheckpointLoaderSimple");
        assert_eq!(
            ckpt["inputs"]["ckpt_name"],
            json!("sd_xl_base_1.0.safetensors")
        );
    }

    #[test]
    fn txt2img_has_two_cliptextencode_with_prompts() {
        let graph = build_comfy_prompt("ai_generate", &generate_data(), None).unwrap();
        let encoders = nodes_of(&graph, "CLIPTextEncode");
        assert_eq!(encoders.len(), 2, "expected positive + negative encoders");

        let texts: Vec<&str> = encoders
            .iter()
            .map(|n| n["inputs"]["text"].as_str().unwrap())
            .collect();
        assert!(texts.contains(&"a neon cat"), "positive prompt present");
        assert!(
            texts.contains(&"blurry, low quality"),
            "negative prompt present"
        );

        // Both must wire their clip from the checkpoint loader.
        for n in encoders {
            assert_eq!(n["inputs"]["clip"], json!(["1", 1]));
        }
    }

    #[test]
    fn txt2img_ksampler_uses_steps_cfg_and_fixed_sampler() {
        let graph = build_comfy_prompt("ai_generate", &generate_data(), None).unwrap();
        let ks = node_of(&graph, "KSampler");
        assert_eq!(ks["inputs"]["steps"], json!(30));
        assert_eq!(ks["inputs"]["cfg"], json!(8.5));
        assert_eq!(ks["inputs"]["sampler_name"], json!("euler"));
        assert_eq!(ks["inputs"]["scheduler"], json!("normal"));
        assert_eq!(ks["inputs"]["seed"], json!(0));
        assert_eq!(ks["inputs"]["denoise"], json!(1.0));
        // Wired from model + both encoders + latent.
        assert_eq!(ks["inputs"]["model"], json!(["1", 0]));
    }

    #[test]
    fn txt2img_has_empty_latent_and_no_loadimage() {
        let graph = build_comfy_prompt("ai_generate", &generate_data(), None).unwrap();
        let latent = node_of(&graph, "EmptyLatentImage");
        assert_eq!(latent["inputs"]["width"], json!(512));
        assert_eq!(latent["inputs"]["height"], json!(512));
        assert!(nodes_of(&graph, "LoadImage").is_empty());
        assert!(nodes_of(&graph, "VAEEncode").is_empty());
    }

    #[test]
    fn txt2img_has_vaedecode_and_saveimage() {
        let graph = build_comfy_prompt("ai_generate", &generate_data(), None).unwrap();
        let _ = node_of(&graph, "VAEDecode");
        let save = node_of(&graph, "SaveImage");
        assert!(save["inputs"]["images"].is_array());
    }

    #[test]
    fn img2img_uses_loadimage_and_vaeencode() {
        let graph =
            build_comfy_prompt("ai_generate", &generate_data(), Some("seed.png")).unwrap();
        let load = node_of(&graph, "LoadImage");
        assert_eq!(load["inputs"]["image"], json!("seed.png"));
        let encode = node_of(&graph, "VAEEncode");
        assert_eq!(encode["inputs"]["pixels"], json!(["8", 0]));
        // No empty latent in img2img mode.
        assert!(nodes_of(&graph, "EmptyLatentImage").is_empty());
        // Denoise is reduced for img2img.
        let ks = node_of(&graph, "KSampler");
        assert_eq!(ks["inputs"]["denoise"], json!(0.7));
        // KSampler latent comes from the VAEEncode node ("4").
        assert_eq!(ks["inputs"]["latent_image"], json!(["4", 0]));
    }

    #[test]
    fn generate_missing_fields_fall_back_to_defaults() {
        // Only model provided; steps/cfg/prompts missing.
        let data = json!({ "model": "some_checkpoint.safetensors" });
        let graph = build_comfy_prompt("ai_generate", &data, None).unwrap();
        let ks = node_of(&graph, "KSampler");
        assert_eq!(ks["inputs"]["steps"], json!(20), "default steps");
        assert_eq!(ks["inputs"]["cfg"], json!(7.0), "default cfg");
        let encoders = nodes_of(&graph, "CLIPTextEncode");
        for n in encoders {
            assert_eq!(n["inputs"]["text"], json!(""), "default empty prompt");
        }
    }

    #[test]
    fn generate_errors_without_model() {
        let data = json!({ "prompt": "hi" });
        assert!(build_comfy_prompt("ai_generate", &data, None).is_err());
    }

    #[test]
    fn upscale_has_loader_and_upscale_node() {
        let data = json!({ "model": "RealESRGAN_x4.pth", "scaleFactor": 4 });
        let graph = build_comfy_prompt("ai_upscale", &data, Some("frame.png")).unwrap();
        let loader = node_of(&graph, "UpscaleModelLoader");
        assert_eq!(loader["inputs"]["model_name"], json!("RealESRGAN_x4.pth"));
        let up = node_of(&graph, "ImageUpscaleWithModel");
        assert_eq!(up["inputs"]["upscale_model"], json!(["2", 0]));
        assert_eq!(up["inputs"]["image"], json!(["1", 0]));
        let load = node_of(&graph, "LoadImage");
        assert_eq!(load["inputs"]["image"], json!("frame.png"));
        let _ = node_of(&graph, "SaveImage");
    }

    #[test]
    fn upscale_errors_without_input_image() {
        let data = json!({ "model": "RealESRGAN_x4.pth", "scaleFactor": 4 });
        assert!(build_comfy_prompt("ai_upscale", &data, None).is_err());
    }

    #[test]
    fn upscale_errors_without_model() {
        let data = json!({ "scaleFactor": 2 });
        assert!(build_comfy_prompt("ai_upscale", &data, Some("frame.png")).is_err());
    }

    #[test]
    fn unknown_node_type_errors() {
        let data = json!({});
        assert!(build_comfy_prompt("transform", &data, None).is_err());
        assert!(build_comfy_prompt("", &data, None).is_err());
    }
}
