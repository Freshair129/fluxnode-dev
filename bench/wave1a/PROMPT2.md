You are writing Rust for the FluxNode project (Tauri v2). Follow the pattern EXACTLY. Output ONLY Rust code to stdout — no prose, no explanation, no markdown fences, do NOT create or edit any files.

# Pattern (already-shipped seed in src/actions/mod.rs)

```rust
use crate::action::{Action, ActionDef, ActionResult, SideEffect};
use serde_json::{json, Value};
use std::sync::OnceLock;
use tauri::AppHandle;

pub struct AssetProbe;
impl Action for AssetProbe {
    fn def(&self) -> &ActionDef {
        static DEF: OnceLock<ActionDef> = OnceLock::new();
        DEF.get_or_init(|| ActionDef {
            name: "asset_probe",
            description: "Probe an asset path and return ffprobe metadata.",
            params: json!({ "type":"object", "properties":{ "path":{"type":"string"} }, "required":["path"] }),
            side_effect: SideEffect::ReadOnly,
        })
    }
    fn run(&self, _app: &AppHandle, args: Value) -> ActionResult {
        let path = args.get("path").and_then(Value::as_str)
            .ok_or_else(|| "Missing or invalid 'path'".to_string())?.to_string();
        let probe = crate::asset_probe(path)?;
        let probe = serde_json::from_str::<Value>(&probe).unwrap_or_else(|_| Value::String(probe));
        Ok(json!({ "probe": probe }))
    }
}
```

# Rules
- One `pub struct` + `impl Action` per command below. PascalCase the struct from the fn name.
- Commands that take `app: AppHandle` → call `crate::<name>(app.clone(), ...)`. Pass `_app`→`app` (rename param to `app` when used).
- Each arg comes out of `args` via `args.get("<field>")`. Strings via `.as_str()`, numbers via `.as_u64()`/`.as_f64()`, bools via `.as_bool()`, `Option<String>` via `.get().and_then(as_str)` (None if absent). Missing REQUIRED field → `return Err("...".into())`.
- The wrapped fn returns `Result<T,String>` where T is String/Option<String>/bool. If T is a JSON string, parse-or-wrap like the example (`from_str.unwrap_or_else(Value::String)`). If bool/Option, wrap with `json!`.
- Build `params` as a correct JSON Schema for each arg (types + required).
- Do NOT emit the `use` lines or `InspectAssetPath`/`AssetProbe` (already exist) — output ONLY the new structs+impls, ready to append to src/actions/mod.rs.

# Commands to wrap (name — signature — side_effect)

PROJECT I/O:
- load_project_state(app) -> Result<Option<String>,String> — ReadOnly
- open_project_at_path(app, path: String) -> Result<Option<String>,String> — Mutating
- create_project_at_path(app, path: String, project_json: String) -> Result<String,String> — Mutating
- save_project_state(app, project_json: String) -> Result<(),String> — Mutating   (return json!({"ok":true}))
- save_project_state_as(app, path: String, project_json: String) -> Result<(),String> — Mutating
- autosave_project_state(app, project_json: String) -> Result<String,String> — Mutating
- load_recent_projects(app) -> Result<String,String> — ReadOnly  (JSON string → parse)
- get_current_project_path(app) -> Result<Option<String>,String> — ReadOnly
- mark_project_opened(app, project_json: String) -> Result<(),String> — Mutating

ASSET:
- asset_generate_waveform(app, asset_id: String, source_path: String, bucket_count: u64) -> Result<String,String> — Mutating (JSON→parse)
- asset_generate_thumbnail(app, asset_id: String, source_path: String, time: f64) -> Result<String,String> — Mutating (JSON→parse)
- asset_copy_into_project(app, asset_id: String, source_path: String) -> Result<String,String> — Mutating
- asset_generate_proxy(app, asset_id: String, source_path: String, target_width: u64, target_height: u64) -> Result<String,String> — LongJob (JSON→parse)
- video_decode_frame(asset_id: String, source_path: String, requested_time: f64, width: u64, height: u64) -> Result<String,String> — ReadOnly (JSON→parse)

RENDER / EXPORT:
- render_start(app, job_id: String, project_json: String, preset_json: String) -> Result<String,String> — LongJob (JSON→parse)
- render_get_status(app, job_id: String) -> Result<String,String> — ReadOnly (JSON→parse)
- render_cancel(app, job_id: String) -> Result<(),String> — Mutating
- render_pause(app, job_id: String) -> Result<(),String> — Mutating
- render_resume(app, job_id: String) -> Result<(),String> — Mutating
- start_export_job(app, job_id: String, project_json: String, preset_json: String) -> Result<String,String> — LongJob (JSON→parse)

COMFY:
- comfy_ping(endpoint: String) -> bool — ReadOnly  (wrap: Ok(json!({"alive": crate::comfy_ping(endpoint)})) — note: no `?`, returns bool)
- comfy_generate(project_json: String, node_id: String, endpoint: String, timeout_secs: u64) -> Result<String,String> — LongJob (JSON→parse)

APP:
- health_ping(app) -> Result<String,String> — ReadOnly (JSON→parse)
- load_app_preferences(app) -> Result<String,String> — ReadOnly (JSON→parse)
- save_app_preferences(app, preferences_json: String) -> Result<(),String> — Mutating
- get_app_version() -> Result<String,String> — ReadOnly  (SKIP — already exists as example; do NOT emit)

Output the Rust now.
