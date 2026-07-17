//! Action wrappers over the existing `#[tauri::command]` fns (Packet 1A).
//!
//! Each command becomes a struct implementing `crate::action::Action`, so the same capability is
//! reachable from the in-app agent, voice, MCP server, and CLI through one registry.
//! Seeded from the Wave-1A benchmark winner (see `bench/wave1a/`); extend by wrapping the
//! remaining commands in the same style.
#![allow(dead_code)]

use crate::action::{Action, ActionDef, ActionResult, SideEffect};
use crate::media::types::{FeatureSet, ImageRequest};
use serde_json::{json, Value};
use std::sync::Arc;
use std::sync::OnceLock;
use tauri::AppHandle;

/// `asset_id` in the wrapped asset commands is only a cache/output filename key, so agent
/// callers that only know a raw file path may omit it; derive a stable, filename-safe id from
/// the source file's stem instead.
fn asset_id_or_derived(args: &Value, source_path: &str) -> String {
    if let Some(id) = args
        .get("asset_id")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|id| !id.is_empty())
    {
        return id.to_string();
    }
    let stem = std::path::Path::new(source_path)
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("asset");
    let safe: String = stem
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() || c == '-' || c == '_' { c } else { '-' })
        .collect();
    format!("agent-{safe}")
}

pub struct InspectAssetPath;

impl Action for InspectAssetPath {
    fn def(&self) -> &ActionDef {
        static DEF: OnceLock<ActionDef> = OnceLock::new();
        DEF.get_or_init(|| ActionDef {
            name: "inspect_asset_path",
            description: "Inspect an asset path and return the inspection result.",
            params: json!({
                "type": "object",
                "properties": { "path": { "type": "string" } },
                "required": ["path"]
            }),
            side_effect: SideEffect::ReadOnly,
        })
    }

    fn run(&self, app: &AppHandle, args: Value) -> ActionResult {
        let path = args
            .get("path")
            .and_then(Value::as_str)
            .ok_or_else(|| "Missing or invalid 'path'".to_string())?
            .to_string();

        let inspection = crate::inspect_asset_path(app.clone(), path)?;
        let inspection = serde_json::from_str::<Value>(&inspection)
            .unwrap_or_else(|_| Value::String(inspection));

        Ok(json!({ "inspection": inspection }))
    }
}

pub struct AssetProbe;

impl Action for AssetProbe {
    fn def(&self) -> &ActionDef {
        static DEF: OnceLock<ActionDef> = OnceLock::new();
        DEF.get_or_init(|| ActionDef {
            name: "asset_probe",
            description: "Probe an asset path and return ffprobe metadata.",
            params: json!({
                "type": "object",
                "properties": { "path": { "type": "string" } },
                "required": ["path"]
            }),
            side_effect: SideEffect::ReadOnly,
        })
    }

    fn run(&self, app: &AppHandle, args: Value) -> ActionResult {
        let path = args
            .get("path")
            .and_then(Value::as_str)
            .ok_or_else(|| "Missing or invalid 'path'".to_string())?
            .to_string();

        let probe = crate::asset_probe_blocking(app, path)?;
        let probe = serde_json::from_str::<Value>(&probe).unwrap_or_else(|_| Value::String(probe));

        Ok(json!({ "probe": probe }))
    }
}

pub struct LoadProjectState;
impl Action for LoadProjectState {
    fn def(&self) -> &ActionDef {
        static DEF: OnceLock<ActionDef> = OnceLock::new();
        DEF.get_or_init(|| ActionDef {
            name: "load_project_state",
            description: "Load the current project state.",
            params: json!({ "type":"object", "properties":{} }),
            side_effect: SideEffect::ReadOnly,
        })
    }

    fn run(&self, app: &AppHandle, _args: Value) -> ActionResult {
        let project_json = crate::load_project_state(app.clone())?;
        Ok(json!({ "project_json": project_json }))
    }
}

pub struct OpenProjectAtPath;
impl Action for OpenProjectAtPath {
    fn def(&self) -> &ActionDef {
        static DEF: OnceLock<ActionDef> = OnceLock::new();
        DEF.get_or_init(|| ActionDef {
            name: "open_project_at_path",
            description: "Open a project from a specific path.",
            params: json!({
                "type":"object",
                "properties":{
                    "path":{"type":"string"}
                },
                "required":["path"]
            }),
            side_effect: SideEffect::Mutating,
        })
    }

    fn run(&self, app: &AppHandle, args: Value) -> ActionResult {
        let path = args
            .get("path")
            .and_then(Value::as_str)
            .ok_or_else(|| "Missing or invalid 'path'".to_string())?
            .to_string();
        let project_json = crate::open_project_at_path(app.clone(), path)?;
        Ok(json!({ "project_json": project_json }))
    }
}

pub struct CreateProjectAtPath;
impl Action for CreateProjectAtPath {
    fn def(&self) -> &ActionDef {
        static DEF: OnceLock<ActionDef> = OnceLock::new();
        DEF.get_or_init(|| ActionDef {
            name: "create_project_at_path",
            description: "Create a project at a specific path.",
            params: json!({
                "type":"object",
                "properties":{
                    "path":{"type":"string"},
                    "project_json":{"type":"string"}
                },
                "required":["path","project_json"]
            }),
            side_effect: SideEffect::Mutating,
        })
    }

    fn run(&self, app: &AppHandle, args: Value) -> ActionResult {
        let path = args
            .get("path")
            .and_then(Value::as_str)
            .ok_or_else(|| "Missing or invalid 'path'".to_string())?
            .to_string();
        let project_json = args
            .get("project_json")
            .and_then(Value::as_str)
            .ok_or_else(|| "Missing or invalid 'project_json'".to_string())?
            .to_string();
        let created_project_json = crate::create_project_at_path(app.clone(), path, project_json)?;
        Ok(json!({ "project_json": created_project_json }))
    }
}

pub struct SaveProjectState;
impl Action for SaveProjectState {
    fn def(&self) -> &ActionDef {
        static DEF: OnceLock<ActionDef> = OnceLock::new();
        DEF.get_or_init(|| ActionDef {
            name: "save_project_state",
            description: "Save the current project state.",
            params: json!({
                "type":"object",
                "properties":{
                    "project_json":{"type":"string"}
                },
                "required":["project_json"]
            }),
            side_effect: SideEffect::Mutating,
        })
    }

    fn run(&self, app: &AppHandle, args: Value) -> ActionResult {
        let project_json = args
            .get("project_json")
            .and_then(Value::as_str)
            .ok_or_else(|| "Missing or invalid 'project_json'".to_string())?
            .to_string();
        crate::save_project_state(app.clone(), project_json)?;
        Ok(json!({ "ok": true }))
    }
}

pub struct SaveProjectStateAs;
impl Action for SaveProjectStateAs {
    fn def(&self) -> &ActionDef {
        static DEF: OnceLock<ActionDef> = OnceLock::new();
        DEF.get_or_init(|| ActionDef {
            name: "save_project_state_as",
            description: "Save the current project state to a specific path.",
            params: json!({
                "type":"object",
                "properties":{
                    "path":{"type":"string"},
                    "project_json":{"type":"string"}
                },
                "required":["path","project_json"]
            }),
            side_effect: SideEffect::Mutating,
        })
    }

    fn run(&self, app: &AppHandle, args: Value) -> ActionResult {
        let path = args
            .get("path")
            .and_then(Value::as_str)
            .ok_or_else(|| "Missing or invalid 'path'".to_string())?
            .to_string();
        let project_json = args
            .get("project_json")
            .and_then(Value::as_str)
            .ok_or_else(|| "Missing or invalid 'project_json'".to_string())?
            .to_string();
        crate::save_project_state_as(app.clone(), path, project_json)?;
        Ok(json!({ "ok": true }))
    }
}

pub struct AutosaveProjectState;
impl Action for AutosaveProjectState {
    fn def(&self) -> &ActionDef {
        static DEF: OnceLock<ActionDef> = OnceLock::new();
        DEF.get_or_init(|| ActionDef {
            name: "autosave_project_state",
            description: "Autosave the current project state.",
            params: json!({
                "type":"object",
                "properties":{
                    "project_json":{"type":"string"}
                },
                "required":["project_json"]
            }),
            side_effect: SideEffect::Mutating,
        })
    }

    fn run(&self, app: &AppHandle, args: Value) -> ActionResult {
        let project_json = args
            .get("project_json")
            .and_then(Value::as_str)
            .ok_or_else(|| "Missing or invalid 'project_json'".to_string())?
            .to_string();
        let path = crate::autosave_project_state(app.clone(), project_json)?;
        Ok(json!({ "path": path }))
    }
}

pub struct LoadRecentProjects;
impl Action for LoadRecentProjects {
    fn def(&self) -> &ActionDef {
        static DEF: OnceLock<ActionDef> = OnceLock::new();
        DEF.get_or_init(|| ActionDef {
            name: "load_recent_projects",
            description: "Load the recent projects list.",
            params: json!({ "type":"object", "properties":{} }),
            side_effect: SideEffect::ReadOnly,
        })
    }

    fn run(&self, app: &AppHandle, _args: Value) -> ActionResult {
        let recent_projects = crate::load_recent_projects(app.clone())?;
        let recent_projects = serde_json::from_str::<Value>(&recent_projects)
            .unwrap_or_else(|_| Value::String(recent_projects));
        Ok(json!({ "recent_projects": recent_projects }))
    }
}

pub struct GetCurrentProjectPath;
impl Action for GetCurrentProjectPath {
    fn def(&self) -> &ActionDef {
        static DEF: OnceLock<ActionDef> = OnceLock::new();
        DEF.get_or_init(|| ActionDef {
            name: "get_current_project_path",
            description: "Get the current project path.",
            params: json!({ "type":"object", "properties":{} }),
            side_effect: SideEffect::ReadOnly,
        })
    }

    fn run(&self, app: &AppHandle, _args: Value) -> ActionResult {
        let path = crate::get_current_project_path(app.clone())?;
        Ok(json!({ "path": path }))
    }
}

pub struct MarkProjectOpened;
impl Action for MarkProjectOpened {
    fn def(&self) -> &ActionDef {
        static DEF: OnceLock<ActionDef> = OnceLock::new();
        DEF.get_or_init(|| ActionDef {
            name: "mark_project_opened",
            description: "Mark a project as opened.",
            params: json!({
                "type":"object",
                "properties":{
                    "project_json":{"type":"string"}
                },
                "required":["project_json"]
            }),
            side_effect: SideEffect::Mutating,
        })
    }

    fn run(&self, app: &AppHandle, args: Value) -> ActionResult {
        let project_json = args
            .get("project_json")
            .and_then(Value::as_str)
            .ok_or_else(|| "Missing or invalid 'project_json'".to_string())?
            .to_string();
        crate::mark_project_opened(app.clone(), project_json)?;
        Ok(json!({ "ok": true }))
    }
}

pub struct AssetGenerateWaveform;
impl Action for AssetGenerateWaveform {
    fn def(&self) -> &ActionDef {
        static DEF: OnceLock<ActionDef> = OnceLock::new();
        DEF.get_or_init(|| ActionDef {
            name: "asset_generate_waveform",
            description: "Generate waveform data for a media file. Works on a raw file path; no open project is required.",
            params: json!({
                "type":"object",
                "properties":{
                    "asset_id":{"type":"string","description":"Optional cache key; derived from source_path when omitted."},
                    "source_path":{"type":"string"},
                    "bucket_count":{"type":"integer","minimum":0}
                },
                "required":["source_path","bucket_count"]
            }),
            side_effect: SideEffect::Mutating,
        })
    }

    fn run(&self, app: &AppHandle, args: Value) -> ActionResult {
        let source_path = args
            .get("source_path")
            .and_then(Value::as_str)
            .ok_or_else(|| "Missing or invalid 'source_path'".to_string())?
            .to_string();
        let asset_id = asset_id_or_derived(&args, &source_path);
        let bucket_count = args
            .get("bucket_count")
            .and_then(Value::as_u64)
            .ok_or_else(|| "Missing or invalid 'bucket_count'".to_string())?;
        let waveform = crate::asset_generate_waveform_blocking(
            app,
            asset_id,
            source_path,
            bucket_count as usize,
        )?;
        let waveform =
            serde_json::from_str::<Value>(&waveform).unwrap_or_else(|_| Value::String(waveform));
        Ok(json!({ "waveform": waveform }))
    }
}

pub struct AssetGenerateThumbnail;
impl Action for AssetGenerateThumbnail {
    fn def(&self) -> &ActionDef {
        static DEF: OnceLock<ActionDef> = OnceLock::new();
        DEF.get_or_init(|| ActionDef {
            name: "asset_generate_thumbnail",
            description: "Generate a thumbnail image from a video file. Works on a raw file path; no open project is required.",
            params: json!({
                "type":"object",
                "properties":{
                    "asset_id":{"type":"string","description":"Optional cache key; derived from source_path when omitted."},
                    "source_path":{"type":"string"},
                    "time":{"type":"number"}
                },
                "required":["source_path","time"]
            }),
            side_effect: SideEffect::Mutating,
        })
    }

    fn run(&self, app: &AppHandle, args: Value) -> ActionResult {
        let source_path = args
            .get("source_path")
            .and_then(Value::as_str)
            .ok_or_else(|| "Missing or invalid 'source_path'".to_string())?
            .to_string();
        let asset_id = asset_id_or_derived(&args, &source_path);
        let time = args
            .get("time")
            .and_then(Value::as_f64)
            .ok_or_else(|| "Missing or invalid 'time'".to_string())?;
        let thumbnail = crate::asset_generate_thumbnail_blocking(app, asset_id, source_path, time)?;
        let thumbnail =
            serde_json::from_str::<Value>(&thumbnail).unwrap_or_else(|_| Value::String(thumbnail));
        Ok(json!({ "thumbnail": thumbnail }))
    }
}

pub struct AssetCopyIntoProject;
impl Action for AssetCopyIntoProject {
    fn def(&self) -> &ActionDef {
        static DEF: OnceLock<ActionDef> = OnceLock::new();
        DEF.get_or_init(|| ActionDef {
            name: "asset_copy_into_project",
            description: "Copy an asset into the current project.",
            params: json!({
                "type":"object",
                "properties":{
                    "asset_id":{"type":"string"},
                    "source_path":{"type":"string"}
                },
                "required":["asset_id","source_path"]
            }),
            side_effect: SideEffect::Mutating,
        })
    }

    fn run(&self, app: &AppHandle, args: Value) -> ActionResult {
        let asset_id = args
            .get("asset_id")
            .and_then(Value::as_str)
            .ok_or_else(|| "Missing or invalid 'asset_id'".to_string())?
            .to_string();
        let source_path = args
            .get("source_path")
            .and_then(Value::as_str)
            .ok_or_else(|| "Missing or invalid 'source_path'".to_string())?
            .to_string();
        let path = crate::asset_copy_into_project(app.clone(), asset_id, source_path)?;
        Ok(json!({ "path": path }))
    }
}

pub struct AssetGenerateProxy;
impl Action for AssetGenerateProxy {
    fn def(&self) -> &ActionDef {
        static DEF: OnceLock<ActionDef> = OnceLock::new();
        DEF.get_or_init(|| ActionDef {
            name: "asset_generate_proxy",
            description: "Generate a lower-resolution proxy video from a video file. Works on a raw file path; no open project is required.",
            params: json!({
                "type":"object",
                "properties":{
                    "asset_id":{"type":"string","description":"Optional cache key; derived from source_path when omitted."},
                    "source_path":{"type":"string"},
                    "target_width":{"type":"integer","minimum":0},
                    "target_height":{"type":"integer","minimum":0}
                },
                "required":["source_path","target_width","target_height"]
            }),
            side_effect: SideEffect::LongJob,
        })
    }

    fn run(&self, app: &AppHandle, args: Value) -> ActionResult {
        let source_path = args
            .get("source_path")
            .and_then(Value::as_str)
            .ok_or_else(|| "Missing or invalid 'source_path'".to_string())?
            .to_string();
        let asset_id = asset_id_or_derived(&args, &source_path);
        let target_width = args
            .get("target_width")
            .and_then(Value::as_u64)
            .ok_or_else(|| "Missing or invalid 'target_width'".to_string())?;
        let target_height = args
            .get("target_height")
            .and_then(Value::as_u64)
            .ok_or_else(|| "Missing or invalid 'target_height'".to_string())?;
        let proxy = crate::asset_generate_proxy_blocking(
            app,
            asset_id,
            source_path,
            target_width as u32,
            target_height as u32,
        )?;
        let proxy = serde_json::from_str::<Value>(&proxy).unwrap_or_else(|_| Value::String(proxy));
        Ok(json!({ "proxy": proxy }))
    }
}

pub struct VideoDecodeFrame;
impl Action for VideoDecodeFrame {
    fn def(&self) -> &ActionDef {
        static DEF: OnceLock<ActionDef> = OnceLock::new();
        DEF.get_or_init(|| ActionDef {
            name: "video_decode_frame",
            description: "Decode a video frame for an asset.",
            params: json!({
                "type":"object",
                "properties":{
                    "asset_id":{"type":"string"},
                    "source_path":{"type":"string"},
                    "requested_time":{"type":"number"},
                    "width":{"type":"integer","minimum":0},
                    "height":{"type":"integer","minimum":0}
                },
                "required":["asset_id","source_path","requested_time","width","height"]
            }),
            side_effect: SideEffect::ReadOnly,
        })
    }

    fn run(&self, _app: &AppHandle, args: Value) -> ActionResult {
        let asset_id = args
            .get("asset_id")
            .and_then(Value::as_str)
            .ok_or_else(|| "Missing or invalid 'asset_id'".to_string())?
            .to_string();
        let source_path = args
            .get("source_path")
            .and_then(Value::as_str)
            .ok_or_else(|| "Missing or invalid 'source_path'".to_string())?
            .to_string();
        let requested_time = args
            .get("requested_time")
            .and_then(Value::as_f64)
            .ok_or_else(|| "Missing or invalid 'requested_time'".to_string())?;
        let width = args
            .get("width")
            .and_then(Value::as_u64)
            .ok_or_else(|| "Missing or invalid 'width'".to_string())?;
        let height = args
            .get("height")
            .and_then(Value::as_u64)
            .ok_or_else(|| "Missing or invalid 'height'".to_string())?;
        let frame = crate::video_decode_frame_blocking(
            asset_id,
            source_path,
            requested_time,
            width as u32,
            height as u32,
        )?;
        let frame = serde_json::from_str::<Value>(&frame).unwrap_or_else(|_| Value::String(frame));
        Ok(json!({ "frame": frame }))
    }
}

pub struct RenderStart;
impl Action for RenderStart {
    fn def(&self) -> &ActionDef {
        static DEF: OnceLock<ActionDef> = OnceLock::new();
        DEF.get_or_init(|| ActionDef {
            name: "render_start",
            description: "Start a render job.",
            params: json!({
                "type":"object",
                "properties":{
                    "job_id":{"type":"string"},
                    "project_json":{"type":"string"},
                    "preset_json":{"type":"string"}
                },
                "required":["job_id","project_json","preset_json"]
            }),
            side_effect: SideEffect::LongJob,
        })
    }

    fn run(&self, app: &AppHandle, args: Value) -> ActionResult {
        let job_id = args
            .get("job_id")
            .and_then(Value::as_str)
            .ok_or_else(|| "Missing or invalid 'job_id'".to_string())?
            .to_string();
        let project_json = args
            .get("project_json")
            .and_then(Value::as_str)
            .ok_or_else(|| "Missing or invalid 'project_json'".to_string())?
            .to_string();
        let preset_json = args
            .get("preset_json")
            .and_then(Value::as_str)
            .ok_or_else(|| "Missing or invalid 'preset_json'".to_string())?
            .to_string();
        let render = crate::render_start(app.clone(), job_id, project_json, preset_json)?;
        let render =
            serde_json::from_str::<Value>(&render).unwrap_or_else(|_| Value::String(render));
        Ok(json!({ "render": render }))
    }
}

pub struct RenderGetStatus;
impl Action for RenderGetStatus {
    fn def(&self) -> &ActionDef {
        static DEF: OnceLock<ActionDef> = OnceLock::new();
        DEF.get_or_init(|| ActionDef {
            name: "render_get_status",
            description: "Get the current render status.",
            params: json!({
                "type":"object",
                "properties":{
                    "job_id":{"type":"string"}
                },
                "required":["job_id"]
            }),
            side_effect: SideEffect::ReadOnly,
        })
    }

    fn run(&self, app: &AppHandle, args: Value) -> ActionResult {
        let job_id = args
            .get("job_id")
            .and_then(Value::as_str)
            .ok_or_else(|| "Missing or invalid 'job_id'".to_string())?
            .to_string();
        let status = crate::render_get_status(app.clone(), job_id)?;
        let status =
            serde_json::from_str::<Value>(&status).unwrap_or_else(|_| Value::String(status));
        Ok(json!({ "status": status }))
    }
}

pub struct RenderCancel;
impl Action for RenderCancel {
    fn def(&self) -> &ActionDef {
        static DEF: OnceLock<ActionDef> = OnceLock::new();
        DEF.get_or_init(|| ActionDef {
            name: "render_cancel",
            description: "Cancel a render job.",
            params: json!({
                "type":"object",
                "properties":{
                    "job_id":{"type":"string"}
                },
                "required":["job_id"]
            }),
            side_effect: SideEffect::Mutating,
        })
    }

    fn run(&self, app: &AppHandle, args: Value) -> ActionResult {
        let job_id = args
            .get("job_id")
            .and_then(Value::as_str)
            .ok_or_else(|| "Missing or invalid 'job_id'".to_string())?
            .to_string();
        crate::render_cancel(app.clone(), job_id)?;
        Ok(json!({ "ok": true }))
    }
}

pub struct RenderPause;
impl Action for RenderPause {
    fn def(&self) -> &ActionDef {
        static DEF: OnceLock<ActionDef> = OnceLock::new();
        DEF.get_or_init(|| ActionDef {
            name: "render_pause",
            description: "Pause a render job.",
            params: json!({
                "type":"object",
                "properties":{
                    "job_id":{"type":"string"}
                },
                "required":["job_id"]
            }),
            side_effect: SideEffect::Mutating,
        })
    }

    fn run(&self, app: &AppHandle, args: Value) -> ActionResult {
        let job_id = args
            .get("job_id")
            .and_then(Value::as_str)
            .ok_or_else(|| "Missing or invalid 'job_id'".to_string())?
            .to_string();
        crate::render_pause(app.clone(), job_id)?;
        Ok(json!({ "ok": true }))
    }
}

pub struct RenderResume;
impl Action for RenderResume {
    fn def(&self) -> &ActionDef {
        static DEF: OnceLock<ActionDef> = OnceLock::new();
        DEF.get_or_init(|| ActionDef {
            name: "render_resume",
            description: "Resume a render job.",
            params: json!({
                "type":"object",
                "properties":{
                    "job_id":{"type":"string"}
                },
                "required":["job_id"]
            }),
            side_effect: SideEffect::Mutating,
        })
    }

    fn run(&self, app: &AppHandle, args: Value) -> ActionResult {
        let job_id = args
            .get("job_id")
            .and_then(Value::as_str)
            .ok_or_else(|| "Missing or invalid 'job_id'".to_string())?
            .to_string();
        crate::render_resume(app.clone(), job_id)?;
        Ok(json!({ "ok": true }))
    }
}

pub struct StartExportJob;
impl Action for StartExportJob {
    fn def(&self) -> &ActionDef {
        static DEF: OnceLock<ActionDef> = OnceLock::new();
        DEF.get_or_init(|| ActionDef {
            name: "start_export_job",
            description: "Start an export job.",
            params: json!({
                "type":"object",
                "properties":{
                    "job_id":{"type":"string"},
                    "project_json":{"type":"string"},
                    "preset_json":{"type":"string"}
                },
                "required":["job_id","project_json","preset_json"]
            }),
            side_effect: SideEffect::LongJob,
        })
    }

    fn run(&self, app: &AppHandle, args: Value) -> ActionResult {
        let job_id = args
            .get("job_id")
            .and_then(Value::as_str)
            .ok_or_else(|| "Missing or invalid 'job_id'".to_string())?
            .to_string();
        let project_json = args
            .get("project_json")
            .and_then(Value::as_str)
            .ok_or_else(|| "Missing or invalid 'project_json'".to_string())?
            .to_string();
        let preset_json = args
            .get("preset_json")
            .and_then(Value::as_str)
            .ok_or_else(|| "Missing or invalid 'preset_json'".to_string())?
            .to_string();
        let export_job = crate::start_export_job(app.clone(), job_id, project_json, preset_json)?;
        let export_job = serde_json::from_str::<Value>(&export_job)
            .unwrap_or_else(|_| Value::String(export_job));
        Ok(json!({ "export_job": export_job }))
    }
}

pub struct ComfyPing;
impl Action for ComfyPing {
    fn def(&self) -> &ActionDef {
        static DEF: OnceLock<ActionDef> = OnceLock::new();
        DEF.get_or_init(|| ActionDef {
            name: "comfy_ping",
            description: "Ping a ComfyUI endpoint.",
            params: json!({
                "type":"object",
                "properties":{
                    "endpoint":{"type":"string"}
                },
                "required":["endpoint"]
            }),
            side_effect: SideEffect::ReadOnly,
        })
    }

    fn run(&self, app: &AppHandle, args: Value) -> ActionResult {
        let endpoint = args
            .get("endpoint")
            .and_then(Value::as_str)
            .ok_or_else(|| "Missing or invalid 'endpoint'".to_string())?
            .to_string();
        Ok(json!({ "alive": crate::comfy_ping(app.clone(), endpoint) }))
    }
}

pub struct ComfyGenerate;
impl Action for ComfyGenerate {
    fn def(&self) -> &ActionDef {
        static DEF: OnceLock<ActionDef> = OnceLock::new();
        DEF.get_or_init(|| ActionDef {
            name: "comfy_generate",
            description: "Run a ComfyUI generation request.",
            params: json!({
                "type":"object",
                "properties":{
                    "project_json":{"type":"string"},
                    "node_id":{"type":"string"},
                    "endpoint":{"type":"string"},
                    "timeout_secs":{"type":"integer","minimum":0}
                },
                "required":["project_json","node_id","endpoint","timeout_secs"]
            }),
            side_effect: SideEffect::LongJob,
        })
    }

    fn run(&self, app: &AppHandle, args: Value) -> ActionResult {
        let project_json = args
            .get("project_json")
            .and_then(Value::as_str)
            .ok_or_else(|| "Missing or invalid 'project_json'".to_string())?
            .to_string();
        let node_id = args
            .get("node_id")
            .and_then(Value::as_str)
            .ok_or_else(|| "Missing or invalid 'node_id'".to_string())?
            .to_string();
        let endpoint = args
            .get("endpoint")
            .and_then(Value::as_str)
            .ok_or_else(|| "Missing or invalid 'endpoint'".to_string())?
            .to_string();
        let timeout_secs = args
            .get("timeout_secs")
            .and_then(Value::as_u64)
            .ok_or_else(|| "Missing or invalid 'timeout_secs'".to_string())?;
        let allow_remote = crate::read_allow_remote_comfy(app);
        let result = crate::comfy_generate_blocking(
            project_json,
            node_id,
            endpoint,
            timeout_secs,
            allow_remote,
        )?;
        let result =
            serde_json::from_str::<Value>(&result).unwrap_or_else(|_| Value::String(result));
        Ok(json!({ "result": result }))
    }
}

pub struct HealthPing;
impl Action for HealthPing {
    fn def(&self) -> &ActionDef {
        static DEF: OnceLock<ActionDef> = OnceLock::new();
        DEF.get_or_init(|| ActionDef {
            name: "health_ping",
            description: "Return current app health information.",
            params: json!({ "type":"object", "properties":{} }),
            side_effect: SideEffect::ReadOnly,
        })
    }

    fn run(&self, app: &AppHandle, _args: Value) -> ActionResult {
        let health = crate::health_ping(app.clone())?;
        let health =
            serde_json::from_str::<Value>(&health).unwrap_or_else(|_| Value::String(health));
        Ok(json!({ "health": health }))
    }
}

pub struct LoadAppPreferences;
impl Action for LoadAppPreferences {
    fn def(&self) -> &ActionDef {
        static DEF: OnceLock<ActionDef> = OnceLock::new();
        DEF.get_or_init(|| ActionDef {
            name: "load_app_preferences",
            description: "Load application preferences.",
            params: json!({ "type":"object", "properties":{} }),
            side_effect: SideEffect::ReadOnly,
        })
    }

    fn run(&self, app: &AppHandle, _args: Value) -> ActionResult {
        let preferences = crate::load_app_preferences(app.clone())?;
        let preferences = serde_json::from_str::<Value>(&preferences)
            .unwrap_or_else(|_| Value::String(preferences));
        Ok(json!({ "preferences": preferences }))
    }
}

pub struct SaveAppPreferences;
impl Action for SaveAppPreferences {
    fn def(&self) -> &ActionDef {
        static DEF: OnceLock<ActionDef> = OnceLock::new();
        DEF.get_or_init(|| ActionDef {
            name: "save_app_preferences",
            description: "Save application preferences.",
            params: json!({
                "type":"object",
                "properties":{
                    "preferences_json":{"type":"string"}
                },
                "required":["preferences_json"]
            }),
            side_effect: SideEffect::Mutating,
        })
    }

    fn run(&self, app: &AppHandle, args: Value) -> ActionResult {
        let preferences_json = args
            .get("preferences_json")
            .and_then(Value::as_str)
            .ok_or_else(|| "Missing or invalid 'preferences_json'".to_string())?
            .to_string();
        crate::save_app_preferences(app.clone(), preferences_json)?;
        Ok(json!({ "ok": true }))
    }
}

// ---------------------------------------------------------------------------
// Timeline-edit actions — FrontendEdit: authored by the agent, materialized in the frontend store
// so undo/WAL/validation stay authoritative. `invoke` turns these into proposals; `run` is a
// never-reached safety net.
// ---------------------------------------------------------------------------

pub struct TimelineRemoveRange;
impl Action for TimelineRemoveRange {
    fn def(&self) -> &ActionDef {
        static DEF: OnceLock<ActionDef> = OnceLock::new();
        DEF.get_or_init(|| ActionDef {
            name: "timeline_remove_range",
            description: "Propose deleting a time range [start, end) in seconds from one timeline \
                track. With ripple=true, later clips slide left to close the gap — use this to cut \
                silences or dead air. This is a proposal: it is previewed and only applied after \
                the user approves.",
            params: json!({
                "type":"object",
                "properties":{
                    "trackId":{"type":"string","description":"Id of the track to edit."},
                    "start":{"type":"number","description":"Range start in seconds."},
                    "end":{"type":"number","description":"Range end in seconds (must be greater than start)."},
                    "ripple":{"type":"boolean","description":"Shift later clips left to close the gap."}
                },
                "required":["trackId","start","end","ripple"]
            }),
            side_effect: SideEffect::FrontendEdit,
        })
    }

    fn run(&self, _app: &AppHandle, _args: Value) -> ActionResult {
        Err("timeline_remove_range is materialized in the frontend after approval, not run in Rust"
            .to_string())
    }
}

pub struct TimelineSplitClip;
impl Action for TimelineSplitClip {
    fn def(&self) -> &ActionDef {
        static DEF: OnceLock<ActionDef> = OnceLock::new();
        DEF.get_or_init(|| ActionDef {
            name: "timeline_split_clip",
            description: "Propose splitting a timeline clip into two at an absolute time (seconds). \
                The split point must be strictly inside the clip. This is a proposal: previewed and \
                only applied after the user approves.",
            params: json!({
                "type":"object",
                "properties":{
                    "clipId":{"type":"string","description":"Id of the clip to split."},
                    "time":{"type":"number","description":"Absolute timeline time in seconds to cut at."}
                },
                "required":["clipId","time"]
            }),
            side_effect: SideEffect::FrontendEdit,
        })
    }

    fn run(&self, _app: &AppHandle, _args: Value) -> ActionResult {
        Err("timeline_split_clip is materialized in the frontend after approval, not run in Rust"
            .to_string())
    }
}

pub struct TimelineTrimClip;
impl Action for TimelineTrimClip {
    fn def(&self) -> &ActionDef {
        static DEF: OnceLock<ActionDef> = OnceLock::new();
        DEF.get_or_init(|| ActionDef {
            name: "timeline_trim_clip",
            description: "Propose trimming one edge of a timeline clip by a signed delta (seconds). \
                edge='end' with positive delta extends the tail, negative trims it; edge='start' \
                with positive delta trims the head, negative extends it. This is a proposal: \
                previewed and only applied after the user approves.",
            params: json!({
                "type":"object",
                "properties":{
                    "clipId":{"type":"string","description":"Id of the clip to trim."},
                    "edge":{"type":"string","enum":["start","end"],"description":"Which edge to move."},
                    "delta":{"type":"number","description":"Seconds to move the edge (signed)."}
                },
                "required":["clipId","edge","delta"]
            }),
            side_effect: SideEffect::FrontendEdit,
        })
    }

    fn run(&self, _app: &AppHandle, _args: Value) -> ActionResult {
        Err("timeline_trim_clip is materialized in the frontend after approval, not run in Rust"
            .to_string())
    }
}

/// Register every wrapped command into the registry.
pub fn register_all(reg: &mut crate::action::Registry) {
    reg.register(Arc::new(InspectAssetPath));
    reg.register(Arc::new(AssetProbe));
    reg.register(Arc::new(LoadProjectState));
    reg.register(Arc::new(OpenProjectAtPath));
    reg.register(Arc::new(CreateProjectAtPath));
    reg.register(Arc::new(SaveProjectState));
    reg.register(Arc::new(SaveProjectStateAs));
    reg.register(Arc::new(AutosaveProjectState));
    reg.register(Arc::new(LoadRecentProjects));
    reg.register(Arc::new(GetCurrentProjectPath));
    reg.register(Arc::new(MarkProjectOpened));
    reg.register(Arc::new(AssetGenerateWaveform));
    reg.register(Arc::new(AssetGenerateThumbnail));
    reg.register(Arc::new(AssetCopyIntoProject));
    reg.register(Arc::new(AssetGenerateProxy));
    reg.register(Arc::new(VideoDecodeFrame));
    reg.register(Arc::new(RenderStart));
    reg.register(Arc::new(RenderGetStatus));
    reg.register(Arc::new(RenderCancel));
    reg.register(Arc::new(RenderPause));
    reg.register(Arc::new(RenderResume));
    reg.register(Arc::new(StartExportJob));
    reg.register(Arc::new(ComfyPing));
    reg.register(Arc::new(ComfyGenerate));
    reg.register(Arc::new(HealthPing));
    reg.register(Arc::new(LoadAppPreferences));
    reg.register(Arc::new(SaveAppPreferences));
    // Media generation (routed through the shared MediaBroker + GpuArbiter).
    reg.register(Arc::new(GenerateImage));
    reg.register(Arc::new(Transcribe));
    reg.register(Arc::new(Synthesize));
    // Timeline-edit (FrontendEdit) actions.
    reg.register(Arc::new(TimelineRemoveRange));
    reg.register(Arc::new(TimelineSplitClip));
    reg.register(Arc::new(TimelineTrimClip));
}

// ---------------------------------------------------------------------------
// Media actions — route through the shared MediaBroker (services::media_broker).
// ---------------------------------------------------------------------------

pub struct GenerateImage;
impl Action for GenerateImage {
    fn def(&self) -> &ActionDef {
        static DEF: OnceLock<ActionDef> = OnceLock::new();
        DEF.get_or_init(|| ActionDef {
            name: "generate_image",
            description: "Generate an image from a text prompt (routes to sd.cpp or ComfyUI).",
            params: json!({
                "type": "object",
                "properties": {
                    "prompt": { "type": "string" },
                    "negative": { "type": "string" },
                    "width": { "type": "integer", "minimum": 64, "default": 1024 },
                    "height": { "type": "integer", "minimum": 64, "default": 1024 },
                    "steps": { "type": "integer", "minimum": 1, "default": 20 },
                    "seed": { "type": "integer" },
                    "model_hint": { "type": "string" }
                },
                "required": ["prompt"]
            }),
            side_effect: SideEffect::LongJob,
        })
    }

    fn run(&self, app: &AppHandle, args: Value) -> ActionResult {
        let prompt = args
            .get("prompt")
            .and_then(Value::as_str)
            .ok_or_else(|| "Missing or invalid 'prompt'".to_string())?
            .to_string();
        let req = ImageRequest {
            prompt,
            negative: args
                .get("negative")
                .and_then(Value::as_str)
                .map(str::to_string),
            width: args.get("width").and_then(Value::as_u64).unwrap_or(1024) as u32,
            height: args.get("height").and_then(Value::as_u64).unwrap_or(1024) as u32,
            steps: args.get("steps").and_then(Value::as_u64).unwrap_or(20) as u32,
            seed: args.get("seed").and_then(Value::as_i64),
            model_hint: args
                .get("model_hint")
                .and_then(Value::as_str)
                .map(str::to_string),
            features: FeatureSet::default(),
            input: None,
            mask: None,
        };
        let art = crate::services::media_broker().generate_image(app, req)?;
        Ok(json!({ "asset_id": art.asset_id, "path": art.path, "kind": art.kind }))
    }
}

pub struct Transcribe;
impl Action for Transcribe {
    fn def(&self) -> &ActionDef {
        static DEF: OnceLock<ActionDef> = OnceLock::new();
        DEF.get_or_init(|| ActionDef {
            name: "transcribe",
            description: "Transcribe an audio file to text with timestamps (whisper.cpp).",
            params: json!({
                "type": "object",
                "properties": { "audio_path": { "type": "string" } },
                "required": ["audio_path"]
            }),
            side_effect: SideEffect::ReadOnly,
        })
    }

    fn run(&self, _app: &AppHandle, args: Value) -> ActionResult {
        let audio_path = args
            .get("audio_path")
            .and_then(Value::as_str)
            .ok_or_else(|| "Missing or invalid 'audio_path'".to_string())?;
        let transcript = crate::services::media_broker().transcribe(audio_path)?;
        serde_json::to_value(transcript).map_err(|e| format!("serialize transcript: {e}"))
    }
}

pub struct Synthesize;
impl Action for Synthesize {
    fn def(&self) -> &ActionDef {
        static DEF: OnceLock<ActionDef> = OnceLock::new();
        DEF.get_or_init(|| ActionDef {
            name: "synthesize",
            description: "Synthesize speech from text to a WAV file (Piper / SAPI).",
            params: json!({
                "type": "object",
                "properties": {
                    "text": { "type": "string" },
                    "voice": { "type": "string" }
                },
                "required": ["text"]
            }),
            side_effect: SideEffect::Mutating,
        })
    }

    fn run(&self, _app: &AppHandle, args: Value) -> ActionResult {
        let text = args
            .get("text")
            .and_then(Value::as_str)
            .ok_or_else(|| "Missing or invalid 'text'".to_string())?;
        let voice = args
            .get("voice")
            .and_then(Value::as_str)
            .unwrap_or("default");
        let art = crate::services::media_broker().synth(text, voice)?;
        Ok(json!({ "asset_id": art.asset_id, "path": art.path, "kind": art.kind }))
    }
}

/// Process-global registry, built once. The single source every caller (Tauri command below,
/// MCP server, future agent loop) resolves actions through.
pub fn registry() -> &'static crate::action::Registry {
    static REG: OnceLock<crate::action::Registry> = OnceLock::new();
    REG.get_or_init(|| {
        let mut reg = crate::action::Registry::new();
        register_all(&mut reg);
        reg
    })
}

/// Invoke an action by name — the universal entry point exposed to the frontend / agent.
///
/// `allow_writes` defaults to `false` (read-only) unless the caller explicitly passes `true` —
/// `Registry::invoke` is the single write gate (see `action::Registry::invoke`), so this command
/// can no longer be used to bypass confirmation for `Mutating`/`LongJob` actions the way it could
/// before the gate lived only in `brain::run_agent`.
#[tauri::command]
pub fn action_invoke(
    app: AppHandle,
    name: String,
    args: Value,
    allow_writes: Option<bool>,
) -> Result<Value, String> {
    registry().invoke(&app, &name, args, allow_writes.unwrap_or(false))
}

/// List every registered action's metadata (name, description, JSON-Schema params, side effect)
/// so a caller can build a tool list / palette.
#[tauri::command]
pub fn action_list() -> Value {
    let actions: Vec<Value> = registry()
        .defs()
        .map(|d| {
            json!({
                "name": d.name,
                "description": d.description,
                "params": d.params,
                "side_effect": format!("{:?}", d.side_effect),
            })
        })
        .collect();
    json!({ "actions": actions })
}
