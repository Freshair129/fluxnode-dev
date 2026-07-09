//! Action registry — the single source of truth for every capability FluxNode exposes.
//!
//! Wave 0 contract. See `docs/AI Copilot and Media Adapter Design.md`.
//! The 43 existing `#[tauri::command]` fns are wrapped as `Action`s (Wave 1A); every caller
//! (in-app agent, voice, MCP server, CLI) goes through this registry, and the LLM tool schema /
//! MCP tool list / CLI subcommands are all *derived* from `ActionDef` — never hand-maintained.
#![allow(dead_code)]

use serde_json::Value;
use std::collections::HashMap;
use std::sync::Arc;
use tauri::AppHandle;

/// Every action returns JSON or a String error, matching the existing command convention
/// (`Result<T, String>` across the whole backend).
pub type ActionResult = Result<Value, String>;

/// How a caller should treat an action's side effects (confirmation gating, job handling).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SideEffect {
    /// Pure read — safe to auto-run (e.g. `asset_probe`, `render_get_status`).
    ReadOnly,
    /// Mutates state — confirm in interactive contexts (e.g. `save_project_state_as`).
    Mutating,
    /// Kicks off a long background job — returns a job handle, progress is polled
    /// (e.g. `generate_video`, `start_export_job`).
    LongJob,
}

/// Static description of an action. This metadata is the contract every caller derives from.
#[derive(Debug, Clone)]
pub struct ActionDef {
    pub name: &'static str,
    pub description: &'static str,
    /// JSON Schema for the params object (fed to the LLM / advertised over MCP).
    pub params: Value,
    pub side_effect: SideEffect,
}

/// One callable capability. Synchronous to match the existing `#[tauri::command]` fns;
/// async callers (brain loop, MCP server) invoke via `tokio::task::spawn_blocking`.
pub trait Action: Send + Sync {
    fn def(&self) -> &ActionDef;
    fn run(&self, app: &AppHandle, args: Value) -> ActionResult;
}

/// The registry. Built once at startup, then shared read-only.
#[derive(Default)]
pub struct Registry {
    actions: HashMap<&'static str, Arc<dyn Action>>,
}

impl Registry {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn register(&mut self, action: Arc<dyn Action>) {
        self.actions.insert(action.def().name, action);
    }

    pub fn get(&self, name: &str) -> Option<Arc<dyn Action>> {
        self.actions.get(name).cloned()
    }

    /// Iterate every action's metadata — source for LLM tool schema, MCP tools, CLI subcommands.
    pub fn defs(&self) -> impl Iterator<Item = ActionDef> + '_ {
        self.actions.values().map(|a| a.def().clone())
    }

    /// The universal entry point for agent / MCP / CLI: invoke an action by name.
    ///
    /// `allow_writes` is the single write gate every caller goes through — regardless of
    /// whether the call came from the in-app agent loop, `action_invoke` (frontend/agent), or the
    /// MCP server. When `false`, `Mutating` and `LongJob` actions are refused before `run` is
    /// ever called; only `ReadOnly` actions execute. This mirrors (and now backs) the gating that
    /// used to live only in `brain::run_agent`, which let `action_invoke` and the MCP server
    /// bypass it entirely.
    pub fn invoke(&self, app: &AppHandle, name: &str, args: Value, allow_writes: bool) -> ActionResult {
        let action = self
            .get(name)
            .ok_or_else(|| format!("unknown action: {name}"))?;

        if !allow_writes && matches!(action.def().side_effect, SideEffect::Mutating | SideEffect::LongJob) {
            return Err(format!(
                "'{name}' is a write/long-running action and requires user confirmation; not executed"
            ));
        }

        Self::validate_args(action.def(), &args)?;
        action.run(app, args)
    }

    /// Lightweight JSON-Schema-ish validation: for each property listed in `required`, checks the
    /// arg is present and (when the schema declares a `type`) roughly type-matches. This is not a
    /// full JSON Schema validator — it exists to reject obviously-malformed calls (missing
    /// required params, a string where a number was declared) before an action's `run` starts
    /// doing real I/O, without pulling in a schema-validation dependency.
    fn validate_args(def: &ActionDef, args: &Value) -> Result<(), String> {
        let Some(schema) = def.params.as_object() else {
            return Ok(());
        };
        let properties = schema.get("properties").and_then(Value::as_object);
        let required = schema.get("required").and_then(Value::as_array);

        if let Some(required) = required {
            for name in required.iter().filter_map(Value::as_str) {
                if args.get(name).is_none() {
                    return Err(format!("'{}' is missing required parameter '{name}'", def.name));
                }
            }
        }

        if let Some(properties) = properties {
            for (key, prop_schema) in properties {
                let Some(value) = args.get(key) else {
                    continue;
                };
                let Some(expected_type) = prop_schema.get("type").and_then(Value::as_str) else {
                    continue;
                };
                if !json_type_matches(expected_type, value) {
                    return Err(format!(
                        "'{}' parameter '{key}' should be of type '{expected_type}'",
                        def.name
                    ));
                }
            }
        }

        Ok(())
    }
}

/// Whether `value`'s JSON kind matches a JSON-Schema `type` keyword. `integer` accepts any whole
/// `number` (JSON has no separate integer type). Unknown `expected` strings are treated as a
/// pass (this is a lightweight check, not a schema validator).
fn json_type_matches(expected: &str, value: &Value) -> bool {
    match expected {
        "string" => value.is_string(),
        "number" => value.is_number(),
        "integer" => value.as_f64().map(|n| n.fract() == 0.0).unwrap_or(false),
        "boolean" => value.is_boolean(),
        "object" => value.is_object(),
        "array" => value.is_array(),
        "null" => value.is_null(),
        _ => true,
    }
}
