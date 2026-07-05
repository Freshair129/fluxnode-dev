//! Action wrappers over the existing `#[tauri::command]` fns (Packet 1A).
//!
//! Each command becomes a struct implementing `crate::action::Action`, so the same capability is
//! reachable from the in-app agent, voice, MCP server, and CLI through one registry.
//! Seeded from the Wave-1A benchmark winner (see `bench/wave1a/`); extend by wrapping the
//! remaining commands in the same style.
#![allow(dead_code)]

use crate::action::{Action, ActionDef, ActionResult, SideEffect};
use serde_json::{json, Value};
use std::sync::Arc;
use std::sync::OnceLock;
use tauri::AppHandle;

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

    fn run(&self, _app: &AppHandle, args: Value) -> ActionResult {
        let path = args
            .get("path")
            .and_then(Value::as_str)
            .ok_or_else(|| "Missing or invalid 'path'".to_string())?
            .to_string();

        let inspection = crate::inspect_asset_path(path)?;
        let inspection =
            serde_json::from_str::<Value>(&inspection).unwrap_or_else(|_| Value::String(inspection));

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

    fn run(&self, _app: &AppHandle, args: Value) -> ActionResult {
        let path = args
            .get("path")
            .and_then(Value::as_str)
            .ok_or_else(|| "Missing or invalid 'path'".to_string())?
            .to_string();

        let probe = crate::asset_probe(path)?;
        let probe = serde_json::from_str::<Value>(&probe).unwrap_or_else(|_| Value::String(probe));

        Ok(json!({ "probe": probe }))
    }
}

/// Register every wrapped command into the registry. Extend as more wrappers land.
pub fn register_all(reg: &mut crate::action::Registry) {
    reg.register(Arc::new(InspectAssetPath));
    reg.register(Arc::new(AssetProbe));
}
